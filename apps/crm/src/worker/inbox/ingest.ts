import type { BridgeEvent } from '@abm/contracts';
import { isConstraintFailure } from '../guarded-tx';
import { slaDueSql } from './assignment';
import {
  ATTACHMENT_ONLY_TEXT, BOT_CALL_RE, GROUP_PAUSE_MS, appendStaffContext, cancelPendingGroupReplies, markMessageSent,
  scheduleCompletion, scheduleGroupReply,
} from './conversation-flow';
import { enqueueCommand } from './dispatcher';

/**
 * Applies events pushed by the Zalo bridge sidecar. Each event is handled on its own: a failure or an
 * unknown account counts as rejected and never fails the batch, so the sidecar does not resend it forever.
 * `ingestMessage` is the message path shared with the Messenger webhook. Message text is never logged.
 */

type MessageEvent = Extract<BridgeEvent, { type: 'message' }>;
type AccountStatusEvent = Extract<BridgeEvent, { type: 'account_status' }>;
type QrEvent = Extract<BridgeEvent, { type: 'qr' }>;
type GroupListEvent = Extract<BridgeEvent, { type: 'group_list' }>;
type GroupMembersEvent = Extract<BridgeEvent, { type: 'group_members' }>;

/** A fromSelf event without command id matches a system message sent within this window. */
const ECHO_WINDOW_MS = 120_000;
/** Outgoing messages are at most this long, so a longer echo is compared by its leading part. */
const ECHO_MATCH_CHARS = 2000;

export interface IngestResult { accepted: number; rejected: number }

/** Channel account a message belongs to. */
export interface ChannelAccountRef {
  id: string;
  organization_id: string;
  /**
   * Set only for an Official Account customer message. A redelivery then finishes a follow-up that stopped
   * after the insert. Facebook and personal Zalo leave it unset, so a duplicate there still changes nothing.
   */
  channel?: 'zalo_oa';
}
interface ConversationRef { id: string; mode: 'ai' | 'human' | 'paused' }

/** One message of any channel, in the shape the shared ingest path stores. */
export interface InboundMessage {
  threadId: string;
  threadKind: 'direct' | 'group';
  msgId: string;
  /** Sent from the account itself: a system message's echo or a staff reply typed outside the CRM. */
  fromSelf: boolean;
  senderExternalId: string;
  /** Customer's display name; null or blank leaves the conversation name as it is. */
  senderName: string | null;
  text: string;
  attachments?: { url: string; name?: string; mimeType?: string }[];
  /** Group only: the message @-mentions the bot. Direct messages leave this unset. */
  mentionsSelf?: boolean;
  /** Group only: the message quotes a message the bot sent. */
  quotesSelf?: boolean;
  /** Optional avatar. A value that is not https is dropped and does not reject the message. */
  senderAvatar?: string | null;
  /** Set only after an Official Account profile lookup was attempted. Personal Zalo and Facebook leave it unset. */
  avatarCheckedAt?: string | null;
}

/** https URL of 1 to 2000 characters, or null. http and anything else are dropped. */
export function httpsAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 2000) return null;
  try {
    return new URL(trimmed).protocol === 'https:' ? trimmed : null;
  } catch {
    return null;
  }
}

/** Decides whether a fromSelf message echoes a message the system sent; when it does, it marks that message sent. */
export type EchoMatcher = (conversationId: string) => Promise<boolean>;

const findZaloAccount = (db: D1Database, externalId: string) =>
  db.prepare("SELECT id, organization_id FROM channel_account WHERE channel = 'zalo' AND external_id = ?").bind(externalId).first<ChannelAccountRef>();

const upsertConversation = (
  db: D1Database, account: ChannelAccountRef, threadId: string, kind: 'direct' | 'group', displayName: string | null, now: string,
  avatarUrl: string | null = null, avatarCheckedAt: string | null = null,
) =>
  db.prepare(`INSERT INTO conversation (id, organization_id, channel_account_id, kind, external_thread_id, display_name, avatar_url, avatar_checked_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_account_id, external_thread_id) DO UPDATE SET kind = excluded.kind,
      display_name = COALESCE(excluded.display_name, conversation.display_name),
      avatar_url = COALESCE(excluded.avatar_url, conversation.avatar_url),
      avatar_checked_at = COALESCE(excluded.avatar_checked_at, conversation.avatar_checked_at),
      updated_at = excluded.updated_at
    RETURNING id, mode`).bind(crypto.randomUUID(), account.organization_id, account.id, kind, threadId, displayName, avatarUrl, avatarCheckedAt, now, now);

/** Rule 4: true when a fromSelf event is the channel's echo of a message the system sent; that message is marked sent. */
async function applyEcho(db: D1Database, conversationId: string, event: MessageEvent, now: Date) {
  if (event.commandId) {
    const sent = await db.prepare(`SELECT m.id FROM channel_command cc
      JOIN message m ON m.id = json_extract(cc.payload_json, '$.messageId')
      WHERE cc.id = ? AND m.conversation_id = ?`).bind(event.commandId, conversationId).first<{ id: string }>();
    if (sent) {
      await markMessageSent(db, sent.id, event.msgId);
      return true;
    }
  }
  // An empty text would be contained in every body. The text must be whole lines of the sent body, so a short
  // staff reply such as "ok" is not taken for an echo of a bot message that merely contains it.
  if (event.text.length === 0) return false;
  const needle = Array.from(event.text).slice(0, ECHO_MATCH_CHARS).join('');
  const since = new Date(now.getTime() - ECHO_WINDOW_MS).toISOString();
  const match = await db.prepare(`SELECT id FROM message
    WHERE conversation_id = ? AND direction = 'out' AND status IN ('pending', 'sent') AND created_at >= ?
      AND instr(char(10) || body || char(10), char(10) || ? || char(10)) > 0
    ORDER BY created_at DESC LIMIT 1`).bind(conversationId, since, needle).first<{ id: string }>();
  if (!match) return false;
  await markMessageSent(db, match.id, event.msgId);
  return true;
}

const MEMBER_BATCH = 100;

/** Inserts or refreshes one group member. A blank name or avatar does not wipe a value already stored. */
function upsertGroupMember(
  db: D1Database, conversationId: string, externalUserId: string, displayName: string | null, now: string, avatarUrl: string | null = null,
) {
  const name = displayName?.trim() || null;
  return db.prepare(`INSERT INTO zalo_group_member (conversation_id, external_user_id, display_name, avatar_url, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(conversation_id, external_user_id) DO UPDATE SET
      display_name = COALESCE(excluded.display_name, zalo_group_member.display_name),
      avatar_url = COALESCE(excluded.avatar_url, zalo_group_member.avatar_url),
      updated_at = excluded.updated_at`).bind(conversationId, externalUserId, name, avatarUrl, now);
}

const touchGroupInbound = (db: D1Database, conversationId: string, now: string) =>
  db.prepare('UPDATE conversation SET last_inbound_at = ?, last_message_at = ?, updated_at = ? WHERE id = ?')
    .bind(now, now, now, conversationId);

/**
 * Stores one group message. Someone typing on the bot's account pauses the group for 30 minutes without
 * leaving `ai`. An ABM staff member cancels pending replies and never starts one. Anyone else starts a reply
 * only when they mention the bot, quote it, or call "Long ơi".
 */
async function ingestGroupMessage(db: D1Database, account: ChannelAccountRef, event: InboundMessage, now: Date, isEcho: EchoMatcher) {
  const nowIso = now.toISOString();
  const conv = await upsertConversation(db, account, event.threadId, 'group', null, nowIso).first<ConversationRef>();
  if (!conv) throw new Error('conversation upsert returned no row');
  if (event.fromSelf && await isEcho(conv.id)) return;

  const messageId = crypto.randomUUID();
  const inserted = await db.prepare(`INSERT INTO message
      (id, conversation_id, direction, sender_kind, sender_external_id, external_msg_id, body, attachments_json, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(conversation_id, external_msg_id) DO NOTHING`)
    .bind(messageId, conv.id, event.fromSelf ? 'out' : 'in', event.fromSelf ? 'staff_phone' : 'customer', event.senderExternalId,
      event.msgId, event.text, event.attachments?.length ? JSON.stringify(event.attachments) : null,
      event.fromSelf ? 'sent' : 'received', nowIso)
    .run();
  if (inserted.meta.changes === 0) return;

  if (event.fromSelf) {
    const pauseUntil = new Date(now.getTime() + GROUP_PAUSE_MS).toISOString();
    await db.batch([
      db.prepare('UPDATE conversation SET bot_paused_until = ?, last_message_at = ?, updated_at = ? WHERE id = ?')
        .bind(pauseUntil, nowIso, nowIso, conv.id),
      cancelPendingGroupReplies(db, conv.id, nowIso),
    ]);
    return;
  }

  await upsertGroupMember(db, conv.id, event.senderExternalId, event.senderName, nowIso, httpsAvatarUrl(event.senderAvatar)).run();
  const staff = await db.prepare('SELECT 1 AS hit FROM zalo_staff_member WHERE channel_account_id = ? AND external_user_id = ?')
    .bind(account.id, event.senderExternalId).first<{ hit: number }>();
  if (staff) {
    await db.batch([touchGroupInbound(db, conv.id, nowIso), cancelPendingGroupReplies(db, conv.id, nowIso)]);
    return;
  }
  await touchGroupInbound(db, conv.id, nowIso).run();
  if (event.mentionsSelf || event.quotesSelf || BOT_CALL_RE.test(event.text.normalize('NFC'))) {
    await scheduleGroupReply(db, conv.id, messageId, event, now);
  }
}

/** The customer line stored for staff while the conversation is not in `ai`. */
const customerContextLine = (text: string) => `Khách: ${text || ATTACHMENT_ONLY_TEXT}`;

/**
 * The turn `scheduleCompletion` appends, including a pending staff-context prefix. A redelivery uses the same
 * string to see that this turn is already on the pending reply.
 */
function completionTurn(staffContext: string | null, text: string): string {
  const body = text || ATTACHMENT_ONLY_TEXT;
  const context = staffContext ?? '';
  return (context ? `[Nhân viên đã trao đổi: ${context}]\n` : '') + body;
}

/** True when that exact line is already one line of the pending staff context. */
function contextHasLine(pending: string | null, line: string): boolean {
  const text = pending ?? '';
  return text === line || text.startsWith(`${line}\n`) || text.endsWith(`\n${line}`) || text.includes(`\n${line}\n`);
}

const touchInbound = (db: D1Database, conversationId: string, nowIso: string) =>
  db.prepare(`UPDATE conversation SET last_inbound_at = ?1, last_message_at = ?1, updated_at = ?1,
      sla_due_at = CASE WHEN mode = 'human' AND kind = 'direct' THEN COALESCE(sla_due_at, ${slaDueSql('?1')}) ELSE sla_due_at END
    WHERE id = ?2`).bind(nowIso, conversationId);

/**
 * Conversation bookkeeping for one new customer message, then the bot run when the thread is in `ai`.
 * The two writes stay in this order: a throw from the bot run leaves the message and the touch committed,
 * and an Official Account redelivery finishes the run.
 */
async function queueInboundCustomer(db: D1Database, conv: ConversationRef, messageId: string, event: InboundMessage, now: Date) {
  const nowIso = now.toISOString();
  const text = event.text || ATTACHMENT_ONLY_TEXT;
  const updates = [touchInbound(db, conv.id, nowIso)];
  if (conv.mode !== 'ai') updates.push(appendStaffContext(db, conv.id, customerContextLine(text), nowIso));
  await db.batch(updates);
  if (conv.mode === 'ai') await scheduleCompletion(db, conv.id, messageId, event.text, now);
}

/**
 * True when this customer message already has its bot run: its own completion command, or a pending reply
 * that was updated with this turn at or after the message was stored.
 */
async function oaReplyAlreadyQueued(
  db: D1Database, conversationId: string, message: { id: string; created_at: string }, staffContext: string | null, text: string,
): Promise<boolean> {
  const owned = await db.prepare('SELECT 1 AS hit FROM channel_command WHERE dedupe_key = ?')
    .bind(`completion:${message.id}`).first<{ hit: number }>();
  if (owned) return true;
  const pending = await db.prepare(`SELECT payload_json, updated_at FROM channel_command
    WHERE conversation_id = ? AND kind = 'run_completion' AND status = 'pending'
      AND json_extract(payload_json, '$.purpose') = 'reply'`)
    .bind(conversationId).first<{ payload_json: string; updated_at: string }>();
  if (!pending || pending.updated_at < message.created_at) return false;
  let stored = '';
  try {
    const payload = JSON.parse(pending.payload_json) as { text?: unknown };
    stored = typeof payload.text === 'string' ? payload.text : '';
  } catch {
    return false;
  }
  const turn = completionTurn(staffContext, text);
  return stored === turn || stored.endsWith(`\n${turn}`);
}

/**
 * Official Account only. The insert of this customer message succeeded on an earlier delivery and a later
 * write threw, so Zalo sends the event again and the insert matches the existing row. Run the missed
 * follow-up. A delivery that already finished is left as it is, so the reply text is not appended twice.
 */
async function resumeZaloOaCustomer(db: D1Database, conversationId: string, event: InboundMessage, now: Date) {
  const message = await db.prepare(`SELECT id, created_at FROM message
    WHERE conversation_id = ? AND external_msg_id = ? AND direction = 'in'`)
    .bind(conversationId, event.msgId).first<{ id: string; created_at: string }>();
  if (!message) return;
  const state = await db.prepare('SELECT mode, last_inbound_at, staff_context_pending FROM conversation WHERE id = ?')
    .bind(conversationId).first<{ mode: ConversationRef['mode']; last_inbound_at: string | null; staff_context_pending: string | null }>();
  if (!state) return;
  const touched = state.last_inbound_at !== null && state.last_inbound_at >= message.created_at;
  if (state.mode === 'ai') {
    if (await oaReplyAlreadyQueued(db, conversationId, message, state.staff_context_pending, event.text)) return;
    if (!touched) await touchInbound(db, conversationId, now.toISOString()).run();
    await scheduleCompletion(db, conversationId, message.id, event.text, now);
    return;
  }
  if (touched && contextHasLine(state.staff_context_pending, customerContextLine(event.text))) return;
  await queueInboundCustomer(db, { id: conversationId, mode: state.mode }, message.id, event, now);
}

/**
 * Stores one message of a known channel account. A fromSelf message that `isEcho`
 * recognises adds nothing; any other fromSelf message is a staff reply typed outside the CRM (`staff_phone`)
 * and hands the conversation to people. A customer message queues the bot's reply in `ai` mode.
 * The same external message id twice stores one message. An Official Account customer redelivery also
 * finishes the conversation update and the bot run when the first attempt stopped after the insert.
 */
export async function ingestMessage(db: D1Database, account: ChannelAccountRef, event: InboundMessage, now: Date, isEcho: EchoMatcher) {
  if (event.threadKind === 'group') {
    await ingestGroupMessage(db, account, event, now, isEcho);
    return;
  }
  const nowIso = now.toISOString();
  // A direct thread is named after the customer; our own messages do not rename it or replace the customer's avatar.
  const senderName = event.senderName?.trim();
  const customerDirect = !event.fromSelf && event.threadKind === 'direct';
  const name = customerDirect && senderName ? senderName : null;
  const avatarUrl = customerDirect ? httpsAvatarUrl(event.senderAvatar) : null;
  const avatarCheckedAt = customerDirect && event.avatarCheckedAt ? event.avatarCheckedAt : null;
  const conv = await upsertConversation(db, account, event.threadId, event.threadKind, name, nowIso, avatarUrl, avatarCheckedAt).first<ConversationRef>();
  if (!conv) throw new Error('conversation upsert returned no row');
  if (event.fromSelf && await isEcho(conv.id)) return;

  const messageId = crypto.randomUUID();
  const inserted = await db.prepare(`INSERT INTO message
      (id, conversation_id, direction, sender_kind, sender_external_id, external_msg_id, body, attachments_json, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(conversation_id, external_msg_id) DO NOTHING`)
    .bind(messageId, conv.id, event.fromSelf ? 'out' : 'in', event.fromSelf ? 'staff_phone' : 'customer', event.senderExternalId,
      event.msgId, event.text, event.attachments?.length ? JSON.stringify(event.attachments) : null,
      event.fromSelf ? 'sent' : 'received', nowIso)
    .run();
  if (inserted.meta.changes === 0) {
    if (!event.fromSelf && account.channel === 'zalo_oa') await resumeZaloOaCustomer(db, conv.id, event, now);
    return;
  }
  const text = event.text || ATTACHMENT_ONLY_TEXT;

  if (event.fromSelf) {
    // Someone answered outside the CRM (the shared phone, Meta Business Suite): people take over; the assignee stays as it is.
    await db.batch([
      db.prepare(`UPDATE conversation SET mode = 'human', last_staff_reply_at = ?, last_message_at = ?, sla_due_at = NULL, updated_at = ? WHERE id = ?`)
        .bind(nowIso, nowIso, nowIso, conv.id),
      appendStaffContext(db, conv.id, `Nhân viên: ${text}`, nowIso),
    ]);
    return;
  }

  // In a direct `human` conversation the customer now waits for staff: the reply deadline starts unless one is
  // already running. Group chatter has no reply deadline.
  await queueInboundCustomer(db, conv, messageId, event, now);
}

async function ingestZaloMessage(db: D1Database, event: MessageEvent, now: Date) {
  const account = await findZaloAccount(db, event.accountExternalId);
  if (!account) return false;
  await ingestMessage(db, account, event, now, (conversationId) => applyEcho(db, conversationId, event, now));
  return true;
}

/**
 * The bridge gave up on an account's session: sending stops until an admin turns it back on, and the Lark inbox
 * group is warned at most once per account per hour.
 */
async function pauseFailedAccount(db: D1Database, accountId: string, now: string) {
  const account = await db.prepare('UPDATE channel_account SET send_paused = 1, updated_at = ? WHERE id = ? RETURNING display_name')
    .bind(now, accountId).first<{ display_name: string }>();
  if (!account) return;
  await enqueueCommand(db, {
    kind: 'send_lark', target: 'worker', channelAccountId: accountId,
    payload: { text: `Tài khoản ${account.display_name} lỗi kết nối, đã tạm dừng gửi` },
    dedupeKey: `account-error:${accountId}:${now.slice(0, 13)}`,
  });
}

/** Error codes the bridge reports look like this; anything else (free text that might hold a secret) is not stored. */
const ERROR_CODE = /^[A-Za-z0-9_.:-]{1,120}$/;

/** The stored reason of an account error: the bridge's code, a placeholder for anything that is not a code, or null. */
export function accountErrorReason(lastError: string | undefined): string | null {
  if (!lastError) return null;
  return ERROR_CODE.test(lastError) ? lastError : 'UNRECOGNIZED_ERROR';
}

/** How long after an admin asks for a Zalo login a `connected` status still counts as that admin's reconnect. */
export const ADMIN_RECONNECT_WINDOW_MS = 15 * 60_000;
/** How long a login QR stays scannable after the Worker receives it. The bridge clock is not used. */
export const QR_IMAGE_TTL_MS = 90_000;

async function ingestAccountStatus(db: D1Database, event: AccountStatusEvent, now: string) {
  const connected = event.status === 'connected';
  // Only an account in error keeps a reason; any other status clears the previous one.
  const lastError = event.status === 'error' ? accountErrorReason(event.lastError) ?? 'UNKNOWN_ERROR' : null;
  // Sending resumes only when an admin asked for this login recently. A sidecar restart that logs back in by itself
  // leaves a paused account paused.
  const reconnectSince = new Date(Date.parse(now) - ADMIN_RECONNECT_WINDOW_MS).toISOString();
  try {
    const res = await db.prepare(`UPDATE channel_account SET status = ?, last_seen_at = ?, updated_at = ?, last_error = ?,
        external_id = CASE WHEN ? = 1 THEN ? ELSE external_id END,
        qr_image = CASE WHEN ? = 1 THEN NULL ELSE qr_image END,
        qr_expires_at = CASE WHEN ? = 1 THEN NULL ELSE qr_expires_at END,
        send_paused = CASE WHEN ? = 1 AND EXISTS (SELECT 1 FROM channel_command
            WHERE kind = 'zalo_login' AND channel_account_id = channel_account.id AND created_at >= ?)
          THEN 0 ELSE send_paused END
      WHERE id = ?`)
      .bind(event.status, now, now, lastError, connected ? 1 : 0, event.accountExternalId ?? null, connected ? 1 : 0, connected ? 1 : 0,
        connected ? 1 : 0, reconnectSince, event.accountId)
      .run();
    if (res.meta.changes !== 1) return false;
    if (event.status === 'error') await pauseFailedAccount(db, event.accountId, now);
    return true;
  } catch (error) {
    if (!isConstraintFailure(error)) throw error;
    // The Zalo number already belongs to another channel account; this one cannot take it.
    await db.prepare("UPDATE channel_account SET status = 'error', last_error = 'ZALO_NUMBER_IN_USE', last_seen_at = ?, updated_at = ? WHERE id = ?")
      .bind(now, now, event.accountId).run();
    return false;
  }
}

async function ingestQr(db: D1Database, event: QrEvent, now: string) {
  const expiresAt = new Date(Date.parse(now) + QR_IMAGE_TTL_MS).toISOString();
  const res = await db.prepare(`UPDATE channel_account SET qr_image = ?, qr_expires_at = ?, status = 'qr_pending', last_seen_at = ?, updated_at = ?
    WHERE id = ?`).bind(event.imageDataUrl, expiresAt, now, now, event.accountId).run();
  return res.meta.changes === 1;
}

/** Upserts the member list of one group. A group the CRM does not know yet is skipped. */
export async function ingestGroupMembers(db: D1Database, event: GroupMembersEvent, now: string): Promise<boolean> {
  const account = await findZaloAccount(db, event.accountExternalId);
  if (!account) return false;
  const conv = await db.prepare('SELECT id FROM conversation WHERE channel_account_id = ? AND external_thread_id = ?')
    .bind(account.id, event.threadId).first<{ id: string }>();
  if (!conv) return true;
  const statements = event.members.map((member) => upsertGroupMember(db, conv.id, member.id, member.name, now, httpsAvatarUrl(member.avatar)));
  for (let i = 0; i < statements.length; i += MEMBER_BATCH) await db.batch(statements.slice(i, i + MEMBER_BATCH));
  return true;
}

async function ingestGroupList(db: D1Database, event: GroupListEvent, now: string) {
  const account = await findZaloAccount(db, event.accountExternalId);
  if (!account) return false;
  if (event.groups.length) {
    await db.batch(event.groups.map((g) => upsertConversation(db, account, g.threadId, 'group', g.name.trim() || null, now)));
  }
  return true;
}

export async function ingestEvents(db: D1Database, events: BridgeEvent[]): Promise<IngestResult> {
  const result: IngestResult = { accepted: 0, rejected: 0 };
  for (const event of events) {
    const now = new Date();
    try {
      const ok = event.type === 'message' ? await ingestZaloMessage(db, event, now)
        : event.type === 'group_members' ? await ingestGroupMembers(db, event, now.toISOString())
        : event.type === 'account_status' ? await ingestAccountStatus(db, event, now.toISOString())
        : event.type === 'qr' ? await ingestQr(db, event, now.toISOString())
        : await ingestGroupList(db, event, now.toISOString());
      result[ok ? 'accepted' : 'rejected'] += 1;
    } catch (error) {
      console.error('bridge_event_error', event.type, error instanceof Error ? error.message : 'unknown');
      result.rejected += 1;
    }
  }
  return result;
}
