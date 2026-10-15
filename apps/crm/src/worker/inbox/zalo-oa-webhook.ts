import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Env } from '../env';
import { ATTACHMENT_ONLY_TEXT, ZALO_OA_PLACEHOLDER_NAME } from './conversation-flow';
import { httpsAvatarUrl, ingestMessage, type ChannelAccountRef, type InboundMessage } from './ingest';
import { accessToken, zaloOaOauthCallback } from './zalo-oa-oauth';
import { splitZaloOaText } from './zalo-oa-send';

/**
 * Zalo Official Account webhook and the public OAuth callback. Zalo calls both without a browser
 * session, so the router is mounted before those checks. The signature is SHA-256 of
 * app id + raw body + timestamp + OA secret, carried in `X-ZEvent-Signature`.
 */

export const zaloOaRoutes = new Hono<{ Bindings: Env }>();

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_TEXT = 20_000;
const PROFILE_URL = 'https://openapi.zalo.me/v3.0/oa/user/detail';
const CONVERSATION_URL = 'https://openapi.zalo.me/v2.0/oa/conversation';
/** "App has not registered this api": the Zalo app lacks the user-info permission. */
const UNREGISTERED_API = -212;
const OA_AVATAR_TTL_MS = 24 * 60 * 60 * 1000;
const OA_AVATAR_BACKFILL_LIMIT = 10;
const encoder = new TextEncoder();

interface ZaloAttachment {
  type?: string;
  payload?: { url?: string; name?: string; description?: string; coordinates?: { latitude?: string; longitude?: string } };
}

interface ZaloEvent {
  app_id?: unknown;
  event_name?: unknown;
  sender?: { id?: unknown };
  recipient?: { id?: unknown };
  oa_id?: unknown;
  timestamp?: unknown;
  message?: { msg_id?: unknown; msg_ids?: unknown; text?: unknown; attachments?: ZaloAttachment[] };
}

const VISUAL_ATTACHMENTS: Record<string, true> = { image: true, gif: true, sticker: true };
const EVENT_LABELS: Record<string, string> = { user_send_business_card: '[Danh thiếp]' };
const MIME_BY_TYPE: Record<string, string> = {
  image: 'image/jpeg', gif: 'image/gif', sticker: 'image/png', video: 'video/mp4', audio: 'audio/mpeg',
};

function zaloEvents(body: unknown): ZaloEvent[] {
  if (Array.isArray(body)) return body.filter((item): item is ZaloEvent => Boolean(item) && typeof item === 'object');
  if (!body || typeof body !== 'object') return [];
  const record = body as Record<string, unknown>;
  if (Array.isArray(record.events)) return zaloEvents(record.events);
  if (typeof record.event_name === 'string') return [record as ZaloEvent];
  if (record.data && typeof record.data === 'object') return zaloEvents(record.data);
  return [];
}

async function sha256Hex(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(payload));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function textId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function describeZaloAttachment(att: ZaloAttachment): string {
  const payload = att.payload ?? {};
  switch (att.type) {
    case 'file':
      return `[Tệp] ${payload.name ?? 'tệp đính kèm'}`;
    case 'video':
      return '[Video]';
    case 'audio':
      return '[Tin nhắn thoại]';
    case 'location':
      return payload.coordinates
        ? `[Vị trí] ${payload.coordinates.latitude}, ${payload.coordinates.longitude}`
        : '[Vị trí]';
    case 'business_card':
      return payload.name ? `[Danh thiếp] ${payload.name}` : '[Danh thiếp]';
    case 'link':
      return payload.description || payload.url || '[Liên kết]';
    default:
      return '[Tin nhắn đính kèm]';
  }
}

function crmAttachments(list: ZaloAttachment[]): NonNullable<InboundMessage['attachments']> {
  const out: NonNullable<InboundMessage['attachments']> = [];
  for (const att of list) {
    const url = att.payload?.url;
    if (typeof url !== 'string' || !URL.canParse(url)) continue;
    const item: { url: string; name?: string; mimeType?: string } = { url };
    const type = att.type ?? '';
    if (type === 'file') {
      if (att.payload?.name) item.name = att.payload.name;
    } else if (type.includes('/')) {
      item.mimeType = type;
    } else if (MIME_BY_TYPE[type]) {
      item.mimeType = MIME_BY_TYPE[type];
    }
    out.push(item);
  }
  return out;
}

function eventText(name: string, message: ZaloEvent['message']): { text: string; attachments: InboundMessage['attachments'] } | null {
  const list = message?.attachments ?? [];
  const raw = typeof message?.text === 'string' ? message.text : '';
  const first = list[0];
  const visual = Boolean(first && VISUAL_ATTACHMENTS[first.type ?? '']);
  const text = (raw || (first && !visual ? describeZaloAttachment(first) : '') || EVENT_LABELS[name] || '').slice(0, MAX_TEXT);
  const attachments = crmAttachments(list);
  if (!text && attachments.length === 0) return null;
  return { text, attachments: attachments.length ? attachments : undefined };
}

const findOa = (db: D1Database, externalId: string | null) => {
  if (!externalId) return Promise.resolve(null);
  return db.prepare("SELECT id, organization_id FROM channel_account WHERE channel = 'zalo_oa' AND external_id = ?")
    .bind(externalId).first<ChannelAccountRef>();
};

/** How long after the latest send activity an echo of one exact part is still recognised as ours. */
const OWN_SEND_WINDOW_MS = 120_000;
/** Outbound rows checked for that echo. The newest send activity is first, so a retry is not pushed out. */
const OWN_SEND_CANDIDATES = 5;
/**
 * An OA welcome or auto-reply is echoed within seconds of the customer's message. It is kept visible
 * but is not staff activity and does not hand the conversation to people.
 */
const AUTO_REPLY_WINDOW_MS = 15_000;

/**
 * Drops CR, collapses each pair of spaces once, and trims. Each part the sender would post is normalized
 * the same way before it is compared with the echo.
 */
function normalizeEchoText(text: string): string {
  return text.replace(/\r/g, '').replace(/ {2}/g, ' ').trim();
}

const notEcho = async () => false;

/** True when this conversation already stored that Zalo message id. A second delivery changes nothing. */
async function messageExists(db: D1Database, conversationId: string, msgId: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS hit FROM message WHERE conversation_id = ? AND external_msg_id = ? LIMIT 1')
    .bind(conversationId, msgId).first<{ hit: number }>();
  return row !== null;
}

/**
 * Our own send: a bot reply, a CRM staff reply, or a system message still pending or sent, whose normalized
 * text equals one part `splitZaloOaText` would post. A short staff reply that merely occurs inside a longer
 * part is not ours. The row is inside the window when it was inserted recently, or when its `send_zalo_oa`
 * command was updated recently (a retry after the first attempt failed). The echo is not stored again.
 * A missing channel id may be filled in. Status stays as it is: only the send loop marks a message sent.
 */
async function linkOwnSend(db: D1Database, conversationId: string, msgId: string, text: string, now: Date): Promise<boolean> {
  const normalized = normalizeEchoText(text);
  if (!normalized) return false;
  const since = new Date(now.getTime() - OWN_SEND_WINDOW_MS).toISOString();
  const candidates = await db.prepare(`SELECT m.id, m.body FROM message m
    WHERE m.conversation_id = ?1 AND m.direction = 'out'
      AND m.sender_kind IN ('bot', 'staff_web', 'system')
      AND m.status IN ('pending', 'sent')
      AND (
        m.created_at >= ?2
        OR EXISTS (
          SELECT 1 FROM channel_command c
          WHERE c.kind = 'send_zalo_oa' AND c.conversation_id = m.conversation_id
            AND json_extract(c.payload_json, '$.messageId') = m.id AND c.updated_at >= ?2
        )
      )
    ORDER BY COALESCE((
      SELECT MAX(c.updated_at) FROM channel_command c
      WHERE c.kind = 'send_zalo_oa' AND c.conversation_id = m.conversation_id
        AND json_extract(c.payload_json, '$.messageId') = m.id
    ), m.created_at) DESC, m.rowid DESC
    LIMIT ${OWN_SEND_CANDIDATES}`).bind(conversationId, since).all<{ id: string; body: string }>();
  let ownId: string | null = null;
  for (const row of candidates.results) {
    if (splitZaloOaText(row.body).some((part) => normalizeEchoText(part) === normalized)) {
      ownId = row.id;
      break;
    }
  }
  if (!ownId) return false;
  await fillExternalMsgId(db, ownId, msgId);
  return true;
}

function storedHasImage(raw: string | null): boolean {
  if (!raw) return false;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return false; }
  if (!Array.isArray(parsed)) return false;
  return parsed.some((item) => {
    const mime = item && typeof item === 'object' ? (item as { mimeType?: unknown }).mimeType : undefined;
    return typeof mime === 'string' && mime.startsWith('image/');
  });
}

/** A photo echo. Stickers and GIFs use their own event names and Zalo types, and are not our image send. */
function echoIsImage(name: string, attachments: ZaloAttachment[] | undefined): boolean {
  if (name === 'oa_send_image') return true;
  return Boolean(attachments?.some((item) => item.type === 'image'));
}

const fillExternalMsgId = (db: D1Database, messageId: string, msgId: string) =>
  db.prepare(`UPDATE message SET external_msg_id = ?1
    WHERE id = ?2 AND direction = 'out' AND external_msg_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM message o
        WHERE o.conversation_id = message.conversation_id AND o.external_msg_id = ?1 AND o.id <> message.id
      )`).bind(msgId, messageId).run();

/**
 * An echo whose Zalo id was already stored on a `send_zalo_oa` command of this conversation.
 * The row keeps the first id `fillExternalMsgId` wrote. No second row is created.
 */
async function linkOwnRecordedMid(db: D1Database, conversationId: string, msgId: string, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - OWN_SEND_WINDOW_MS).toISOString();
  const row = await db.prepare(`SELECT json_extract(c.payload_json, '$.messageId') AS message_id
    FROM channel_command c
    WHERE c.kind = 'send_zalo_oa' AND c.conversation_id = ?1
      AND (
        c.updated_at >= ?2 OR c.created_at >= ?2
        OR EXISTS (
          SELECT 1 FROM message m
          WHERE m.id = json_extract(c.payload_json, '$.messageId')
            AND m.conversation_id = c.conversation_id AND m.created_at >= ?2
        )
      )
      AND EXISTS (
        SELECT 1 FROM json_each(json_extract(c.payload_json, '$.sentMids'))
        WHERE value = ?3
      )
    LIMIT 1`).bind(conversationId, since, msgId).first<{ message_id: string | null }>();
  if (!row?.message_id) return false;
  await fillExternalMsgId(db, row.message_id, msgId);
  return true;
}

/**
 * Fallback for an image echo that arrives before the send call records its Zalo id. The image
 * condition is in the query, and a row that is already fully sent is left alone, so a later photo
 * typed in the OA app is stored. A Zalo image URL is copied only when the row has no attachments.
 */
async function linkOwnImageSend(
  db: D1Database, conversationId: string, msgId: string, attachments: InboundMessage['attachments'], now: Date,
): Promise<boolean> {
  const since = new Date(now.getTime() - OWN_SEND_WINDOW_MS).toISOString();
  const candidates = await db.prepare(`SELECT m.id, m.attachments_json FROM message m
    WHERE m.conversation_id = ?1 AND m.direction = 'out'
      AND m.sender_kind IN ('bot', 'staff_web', 'system')
      AND (
        m.body = ?3
        OR EXISTS (
          SELECT 1 FROM json_each(m.attachments_json) AS att
          WHERE json_extract(att.value, '$.mimeType') IN ('image/jpeg', 'image/png')
        )
      )
      AND (
        m.created_at >= ?2
        OR EXISTS (
          SELECT 1 FROM channel_command c
          WHERE c.kind = 'send_zalo_oa' AND c.conversation_id = m.conversation_id
            AND json_extract(c.payload_json, '$.messageId') = m.id AND c.updated_at >= ?2
        )
      )
      AND (
        m.status = 'pending'
        OR EXISTS (
          SELECT 1 FROM channel_command c
          WHERE c.kind = 'send_zalo_oa' AND c.conversation_id = m.conversation_id
            AND json_extract(c.payload_json, '$.messageId') = m.id
            AND json_array_length(json_extract(c.payload_json, '$.sentMids')) < (
              SELECT COUNT(*) FROM json_each(m.attachments_json) AS att
              WHERE json_extract(att.value, '$.mimeType') IN ('image/jpeg', 'image/png')
            )
        )
      )
    ORDER BY COALESCE((
      SELECT MAX(c.updated_at) FROM channel_command c
      WHERE c.kind = 'send_zalo_oa' AND c.conversation_id = m.conversation_id
        AND json_extract(c.payload_json, '$.messageId') = m.id
    ), m.created_at) DESC, m.rowid DESC
    LIMIT ${OWN_SEND_CANDIDATES}`).bind(conversationId, since, ATTACHMENT_ONLY_TEXT)
    .all<{ id: string; attachments_json: string | null }>();
  const own = candidates.results[0];
  if (!own) return false;
  const echoImages = (attachments ?? []).filter((item) => item.url && item.mimeType?.startsWith('image/'));
  if (!storedHasImage(own.attachments_json) && echoImages.length) {
    await db.prepare(`UPDATE message SET attachments_json = ? WHERE id = ? AND attachments_json IS NULL`)
      .bind(JSON.stringify(echoImages), own.id).run();
  }
  await fillExternalMsgId(db, own.id, msgId);
  return true;
}

/**
 * True when the latest customer message arrived within 15 seconds and no outbound message followed it.
 * That is the OA's own welcome or auto-reply, not a person typing in the OA app.
 */
async function isAutoReply(db: D1Database, conversationId: string, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - AUTO_REPLY_WINDOW_MS).toISOString();
  const row = await db.prepare(`SELECT 1 AS hit FROM message
    WHERE id = (
      SELECT id FROM message
      WHERE conversation_id = ?1 AND direction = 'in' AND sender_kind = 'customer'
      ORDER BY created_at DESC, rowid DESC LIMIT 1
    )
    AND created_at >= ?2
    AND NOT EXISTS (
      SELECT 1 FROM message o
      WHERE o.conversation_id = message.conversation_id AND o.direction = 'out' AND o.rowid > message.rowid
    )`).bind(conversationId, since).first<{ hit: number }>();
  return row !== null;
}

/**
 * Stores an OA auto-reply as `system` / `sent`. `system` is the outbound kind that is not staff and not
 * the bot: it shows in the thread, stays out of the AI transcript, and does not switch the mode.
 * `bot` would look like a reply we composed.
 */
async function storeAutoReply(db: D1Database, conversationId: string, built: { text: string; attachments: InboundMessage['attachments'] }, msgId: string, now: Date) {
  const nowIso = now.toISOString();
  const inserted = await db.prepare(`INSERT INTO message
      (id, conversation_id, direction, sender_kind, external_msg_id, body, attachments_json, status, created_at)
    VALUES (?, ?, 'out', 'system', ?, ?, ?, 'sent', ?)
    ON CONFLICT(conversation_id, external_msg_id) DO NOTHING`)
    .bind(crypto.randomUUID(), conversationId, msgId, built.text, built.attachments?.length ? JSON.stringify(built.attachments) : null, nowIso)
    .run();
  if (inserted.meta.changes !== 1) return;
  await db.prepare('UPDATE conversation SET last_message_at = ?, updated_at = ? WHERE id = ?').bind(nowIso, nowIso, conversationId).run();
}

interface OaUserProfile { name: string | null; avatar: string | null }

/**
 * A profile lookup that reached Zalo, or a skip because this OA has no usable token.
 * A skip must not stamp `avatar_checked_at`, so a later message retries once a token exists.
 */
type OaProfileLookup = { attempted: false } | { attempted: true; profile: OaUserProfile };

/** A real looked-up name. The placeholder and a blank value must not replace a name already stored. */
function usableOaName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === ZALO_OA_PLACEHOLDER_NAME) return null;
  return trimmed;
}

/** `data.avatar`, else the 240 size, else the 120 size. Only an https URL is kept. */
function oaAvatar(data: { avatar?: unknown; avatars?: unknown } | undefined): string | null {
  if (!data) return null;
  const direct = httpsAvatarUrl(data.avatar);
  if (direct) return direct;
  const sizes = data.avatars;
  if (!sizes || typeof sizes !== 'object') return null;
  const map = sizes as Record<string, unknown>;
  return httpsAvatarUrl(map['240']) ?? httpsAvatarUrl(map['120']);
}

/** True when the row has never been checked, the stamp cannot be read, or the check is at least a day old. */
function avatarCheckStale(checkedAt: string | null, now: Date): boolean {
  if (!checkedAt) return true;
  const at = Date.parse(checkedAt);
  if (!Number.isFinite(at)) return true;
  return now.getTime() - at >= OA_AVATAR_TTL_MS;
}

interface OaConversationMessage {
  from_id?: unknown; from_display_name?: unknown; from_avatar?: unknown;
  to_id?: unknown; to_display_name?: unknown; to_avatar?: unknown;
}

/**
 * Fallback while the Zalo app has not registered the v3 user-info API (-212): the v2 conversation history
 * carries the customer's name and avatar on each message. The customer is the side whose id matches.
 */
async function oaProfileFromConversation(token: string, userId: string): Promise<OaUserProfile> {
  const url = new URL(CONVERSATION_URL);
  url.searchParams.set('data', JSON.stringify({ user_id: userId, offset: 0, count: 5 }));
  const res = await fetch(url, { headers: { access_token: token }, signal: AbortSignal.timeout(5_000) });
  const payload = await res.json().catch(() => null) as { error?: unknown; data?: unknown } | null;
  if (!res.ok || !payload || (typeof payload.error === 'number' && payload.error !== 0) || !Array.isArray(payload.data)) {
    console.warn('zalo_oa_conversation_failed', { status: res.status, error: payload?.error ?? null });
    return { name: null, avatar: null };
  }
  let name: string | null = null;
  let avatar: string | null = null;
  for (const message of payload.data as OaConversationMessage[]) {
    const side = String(message.from_id) === userId ? { name: message.from_display_name, avatar: message.from_avatar }
      : String(message.to_id) === userId ? { name: message.to_display_name, avatar: message.to_avatar } : null;
    if (!side) continue;
    name ??= usableOaName(side.name);
    avatar ??= httpsAvatarUrl(side.avatar);
    if (name && avatar) break;
  }
  return { name, avatar };
}

/**
 * Name and avatar of one OA user. `attempted: false` means there was no token, so the caller must not
 * stamp `avatar_checked_at`. -212 falls back to the conversation history; any other Zalo error is an
 * attempt whose profile is empty.
 */
async function lookupOaUserProfile(db: D1Database, env: Pick<Env, 'ZALO_OA_TOKEN_KEY'>, accountId: string, userId: string): Promise<OaProfileLookup> {
  try {
    const token = await accessToken(db, env, accountId);
    if (!token) return { attempted: false };
    const url = new URL(PROFILE_URL);
    url.searchParams.set('data', JSON.stringify({ user_id: userId }));
    const res = await fetch(url, { headers: { access_token: token }, signal: AbortSignal.timeout(5_000) });
    const payload = await res.json().catch(() => null) as { error?: unknown; data?: { display_name?: unknown; avatar?: unknown; avatars?: unknown } } | null;
    if (payload?.error === UNREGISTERED_API) {
      return { attempted: true, profile: await oaProfileFromConversation(token, userId) };
    }
    if (!res.ok || !payload || (typeof payload.error === 'number' && payload.error !== 0)) {
      console.warn('zalo_oa_profile_failed', { status: res.status, error: payload?.error ?? null });
      return { attempted: true, profile: { name: null, avatar: null } };
    }
    const avatar = oaAvatar(payload.data);
    // Field names only, never values, so a changed Zalo response shape shows up in the logs.
    if (!avatar) console.warn('zalo_oa_profile_no_avatar', { keys: Object.keys(payload.data ?? {}) });
    return { attempted: true, profile: { name: usableOaName(payload.data?.display_name), avatar } };
  } catch {
    return { attempted: true, profile: { name: null, avatar: null } };
  }
}

function receiptTime(value: unknown, now: Date): string {
  const millis = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(millis) || millis <= 0) return now.toISOString();
  return new Date(millis).toISOString();
}

async function recordReceipt(db: D1Database, ev: ZaloEvent, column: 'delivered_at' | 'seen_at', now: Date) {
  const ids = Array.isArray(ev.message?.msg_ids) ? ev.message.msg_ids.filter((id): id is string => typeof id === 'string' && id !== '') : [];
  if (!ids.length) return;
  const oaId = textId(ev.oa_id) ?? textId(ev.recipient?.id) ?? textId(ev.sender?.id);
  const sender = textId(ev.sender?.id);
  const recipient = textId(ev.recipient?.id);
  const customerId = sender && sender !== oaId ? sender : recipient && recipient !== oaId ? recipient : null;
  const account = await findOa(db, oaId);
  if (!account || !customerId) {
    if (!account) console.warn('zalo_oa_unknown_oa');
    return;
  }
  const conv = await db.prepare('SELECT id FROM conversation WHERE channel_account_id = ? AND external_thread_id = ?')
    .bind(account.id, customerId).first<{ id: string }>();
  if (!conv) return;
  const at = receiptTime(ev.timestamp, now);
  const sql = column === 'delivered_at'
    ? `UPDATE message SET delivered_at = COALESCE(delivered_at, ?) WHERE conversation_id = ? AND external_msg_id = ? AND direction = 'out'`
    : `UPDATE message SET seen_at = COALESCE(seen_at, ?) WHERE conversation_id = ? AND external_msg_id = ? AND direction = 'out'`;
  await db.batch(ids.map((id) => db.prepare(sql).bind(at, conv.id, id)));
}

async function handleUserSend(db: D1Database, env: Env, ev: ZaloEvent, name: string, now: Date) {
  const senderId = textId(ev.sender?.id);
  const msgId = textId(ev.message?.msg_id);
  if (!senderId || !msgId) return;
  const built = eventText(name, ev.message);
  if (!built) return;
  const account = await findOa(db, textId(ev.oa_id) ?? textId(ev.recipient?.id));
  if (!account) {
    console.warn('zalo_oa_unknown_oa');
    return;
  }
  const existing = await db.prepare('SELECT id, display_name, avatar_checked_at FROM conversation WHERE channel_account_id = ? AND external_thread_id = ?')
    .bind(account.id, senderId).first<{ id: string; display_name: string | null; avatar_checked_at: string | null }>();
  // A fresh stamp blocks another lookup for a day, even while the name is still the placeholder.
  // A null or stale stamp is looked up, which is how a failed first lookup is retried.
  let senderName: string | null = existing ? null : ZALO_OA_PLACEHOLDER_NAME;
  let senderAvatar: string | null = null;
  let avatarCheckedAt: string | null = null;
  if (!existing || avatarCheckStale(existing.avatar_checked_at, now)) {
    const lookup = await lookupOaUserProfile(db, env, account.id, senderId);
    if (lookup.attempted) {
      senderName = lookup.profile.name ?? (existing ? null : ZALO_OA_PLACEHOLDER_NAME);
      senderAvatar = lookup.profile.avatar;
      avatarCheckedAt = now.toISOString();
    }
  }
  const inbound: InboundMessage = {
    threadId: senderId, threadKind: 'direct', msgId, fromSelf: false, senderExternalId: senderId, senderName,
    senderAvatar, avatarCheckedAt, text: built.text, attachments: built.attachments,
  };
  await ingestMessage(db, { ...account, channel: 'zalo_oa' }, inbound, now, notEcho);
}

/**
 * Each minute, refreshes at most 10 Official Account direct threads that have never had a profile check,
 * oldest first. An OA with no valid token is left unchecked so a later run retries. An attempted lookup
 * that fails still stamps `avatar_checked_at`, so it leaves this set. An empty set does not ask for a token.
 */
export async function backfillOaSenderAvatars(db: D1Database, env: Pick<Env, 'ZALO_OA_TOKEN_KEY'>, now = new Date()): Promise<void> {
  const rows = await db.prepare(`SELECT c.id, c.channel_account_id AS accountId, c.external_thread_id AS userId
    FROM conversation c
    JOIN channel_account a ON a.id = c.channel_account_id
    WHERE a.channel = 'zalo_oa' AND c.kind = 'direct' AND c.avatar_checked_at IS NULL
    ORDER BY c.created_at ASC, c.id ASC
    LIMIT ?`).bind(OA_AVATAR_BACKFILL_LIMIT).all<{ id: string; accountId: string; userId: string }>();
  if (!rows.results.length) return;
  const nowIso = now.toISOString();
  for (const row of rows.results) {
    const lookup = await lookupOaUserProfile(db, env, row.accountId, row.userId);
    if (!lookup.attempted) continue;
    await db.prepare(`UPDATE conversation SET
        display_name = COALESCE(?, display_name),
        avatar_url = COALESCE(?, avatar_url),
        avatar_checked_at = ?,
        updated_at = ?
      WHERE id = ? AND avatar_checked_at IS NULL`)
      .bind(lookup.profile.name, lookup.profile.avatar, nowIso, nowIso, row.id)
      .run();
  }
}

/**
 * An `oa_send_*` echo. No conversation yet (a broadcast, or a thread the customer never started): ignore.
 * The same Zalo id, or our own send whose latest send activity is inside 120 seconds: ignore. A welcome
 * within 15 seconds of the customer's message: store it without handing the thread to staff. Otherwise
 * it was typed in the OA app.
 */
async function handleOaSend(db: D1Database, ev: ZaloEvent, name: string, now: Date) {
  const customerId = textId(ev.recipient?.id);
  const msgId = textId(ev.message?.msg_id);
  if (!customerId || !msgId) return;
  const built = eventText(name, ev.message);
  if (!built) return;
  const account = await findOa(db, textId(ev.oa_id) ?? textId(ev.sender?.id));
  if (!account) {
    console.warn('zalo_oa_unknown_oa');
    return;
  }
  const conv = await db.prepare('SELECT id FROM conversation WHERE channel_account_id = ? AND external_thread_id = ?')
    .bind(account.id, customerId).first<{ id: string }>();
  if (!conv) return;
  if (await messageExists(db, conv.id, msgId)) return;
  if (await linkOwnRecordedMid(db, conv.id, msgId, now)) return;
  if (echoIsImage(name, ev.message?.attachments)) {
    if (await linkOwnImageSend(db, conv.id, msgId, built.attachments, now)) return;
  } else if (await linkOwnSend(db, conv.id, msgId, built.text, now)) return;
  if (await isAutoReply(db, conv.id, now)) {
    await storeAutoReply(db, conv.id, built, msgId, now);
    return;
  }
  const inbound: InboundMessage = {
    threadId: customerId, threadKind: 'direct', msgId, fromSelf: true, senderExternalId: textId(ev.sender?.id) ?? customerId,
    senderName: null, text: built.text, attachments: built.attachments,
  };
  await ingestMessage(db, account, inbound, now, notEcho);
}

/** Stores the batch. A throw is the route's signal to answer 503 so Zalo sends the same events again. */
export async function processZaloOaWebhook(db: D1Database, env: Env, events: ZaloEvent[]): Promise<void> {
  const now = new Date();
  for (const ev of events) {
    const name = typeof ev.event_name === 'string' ? ev.event_name : '';
    if (name === 'user_received_message') await recordReceipt(db, ev, 'delivered_at', now);
    else if (name === 'user_seen_message') await recordReceipt(db, ev, 'seen_at', now);
    else if (name.startsWith('oa_send_')) await handleOaSend(db, ev, name, now);
    else if (name.startsWith('user_send_')) await handleUserSend(db, env, ev, name, now);
  }
}

zaloOaRoutes.use('*', bodyLimit({ maxSize: MAX_BODY_BYTES }));
zaloOaRoutes.get('/oauth/callback', (c) => zaloOaOauthCallback(c));

zaloOaRoutes.post('/webhook', async (c) => {
  const raw = await c.req.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return c.text('Payload không hợp lệ', 400);
  }
  const events = zaloEvents(parsed);
  const secret = c.env.ZALO_OA_WEBHOOK_SECRET;
  if (!secret) return c.text('Webhook Zalo chưa được cấu hình', 503);
  const first = events[0];
  if (!first?.app_id || first.timestamp === undefined || first.timestamp === null) {
    return c.text('Payload thiếu app_id hoặc timestamp', 400);
  }
  const header = (c.req.header('X-ZEvent-Signature') ?? '').replace(/^mac=/i, '').toLowerCase();
  const expected = await sha256Hex(`${String(first.app_id)}${raw}${String(first.timestamp)}${secret}`);
  if (!header || !timingSafeEqual(header, expected.toLowerCase())) return c.text('Invalid signature', 401);
  try {
    await processZaloOaWebhook(c.env.DB, c.env, events);
  } catch (error) {
    console.error('zalo_oa_event_error', error instanceof Error ? error.message : 'unknown');
    return c.text('Tạm thời không xử lý được', 503);
  }
  return c.text('OK', 200);
});

zaloOaRoutes.all('*', (c) => c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy' } }, 404));
