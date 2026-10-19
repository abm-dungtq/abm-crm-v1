import type { ChannelKind, CommandKind, ConversationMode } from '@abm/contracts';
import type { Actor, Env } from '../env';
import { autoAssignOnHandoff, linkBase, slaDueSql } from './assignment';
import { commandInsertStatement, enqueueCommand, type CommandTarget } from './dispatcher';
import { HANDOFF_CATEGORIES, decideHandoff, decisionMode } from './decision-layer';
import { enqueueExtraction } from './intake';
import type { StaffMedia } from './media';
import { filenameForKey } from './media';
import { UnsafeRecoveryReplyError, assertRegistrationPolicyOutput } from './zalo-oa-registration-guard';

/**
 * Conversation rules of the customer-facing bot (ADR-009): when the bot may reply, how customer turns
 * are batched into one GoClaw call, how a reply or a handoff marker is applied, and how staff take over.
 */

/** Delay that lets a customer's burst of messages reach GoClaw as one turn. */
export const COMPLETION_DELAY_MS = 8_000;
/** Staff/customer exchange kept for the bot's next turn while a person handles the conversation. */
export const STAFF_CONTEXT_MAX_CHARS = 1500;
export const STAFF_TEXT_MAX = 2000;
/** Text that stands in for a message carrying only attachments. */
export const ATTACHMENT_ONLY_TEXT = '[Tệp đính kèm]';
/** Name stored when the OA profile lookup fails. A later message must not write it again. */
export const ZALO_OA_PLACEHOLDER_NAME = 'Khách Zalo OA';
/** Image URLs a Zalo OA completion may hand to the agent. */
const OA_IMAGE_LIMIT = 3;
export const CANCELLED_REPLY_PREFIX = '[Bot trả lời bị huỷ vì đã chuyển người] ';
export const BOT_OFF_REPLY_PREFIX = '[Bot trả lời bị huỷ vì bot đang tắt] ';
/** Error of a queued bot message dropped because the customer bot or the account's bot was turned off. */
export const BOT_OFF = 'BOT_OFF';
/** Default GoClaw agent for a Zalo group when the group has no agent of its own. */
export const GROUP_AGENT_DEFAULT = 'cham-soc-hoc-vien';
/** How long a group stays quiet after someone types on the bot's Zalo account. */
export const GROUP_PAUSE_MS = 30 * 60_000;
/**
 * "Long ơi" as its own call. Callers test NFC text, so a decomposed "ơi" still matches and "ới" does not.
 * The character before "long" is absent or not a letter, and the character after "ơi" is not a letter.
 */
export const BOT_CALL_RE = /(^|[^\p{L}])long\s+ơi(?![\p{L}])/iu;

/** The message a group reply quotes: the learner's Zalo message and who sent it. */
export interface GroupReplyTarget { msgId: string; senderId: string; senderName: string }

/** Fields of a `run_completion` reply that a group result needs. Anything else in the payload is ignored. */
export interface CompletionResultPayload {
  triggerMessageId?: string;
  replyTo?: GroupReplyTarget;
  commandId?: string;
  /** The customer's own lines of a direct reply turn, without staff context or profile prefixes. */
  customerText?: string;
}

/** Reads the group-reply fields of a command payload. A missing or odd payload yields an empty object. */
export function asCompletionPayload(value: unknown): CompletionResultPayload {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  const reply = raw.replyTo;
  let replyTo: GroupReplyTarget | undefined;
  if (reply && typeof reply === 'object') {
    const item = reply as Record<string, unknown>;
    if (typeof item.msgId === 'string' && typeof item.senderId === 'string' && typeof item.senderName === 'string') {
      replyTo = { msgId: item.msgId, senderId: item.senderId, senderName: item.senderName };
    }
  }
  return {
    triggerMessageId: typeof raw.triggerMessageId === 'string' ? raw.triggerMessageId : undefined,
    replyTo,
    commandId: typeof raw.commandId === 'string' ? raw.commandId : undefined,
    customerText: typeof raw.customerText === 'string' ? raw.customerText : undefined,
  };
}

const HANDOFF_MARKER = /^\[HANDOFF:\s*(.+?)\]\s*$/m;
const HANDOFF_MARKER_ALL = new RegExp(HANDOFF_MARKER.source, 'gm');

interface ConversationRow {
  id: string;
  organization_id: string;
  kind: 'direct' | 'group';
  mode: ConversationMode;
  external_thread_id: string;
  display_name: string | null;
  staff_context_pending: string | null;
  assignee_user_id: string | null;
  channel_account_id: string;
  channel: ChannelKind;
  account_external_id: string | null;
  account_name: string;
  agent_key: string | null;
  bot_enabled: number;
  registration_policy: number;
  registration_group_url: string | null;
  bot_switch: number | null;
  bot_reply_enabled: number;
  group_agent_key: string | null;
  bot_paused_until: string | null;
  left_at: string | null;
}

const loadConversation = (db: D1Database, id: string) => db.prepare(`SELECT c.id, c.organization_id, c.kind, c.mode,
    c.external_thread_id, c.display_name, c.staff_context_pending, c.assignee_user_id, c.channel_account_id,
    a.channel, a.external_id AS account_external_id, a.display_name AS account_name, a.agent_key, a.bot_enabled,
    a.registration_policy, a.registration_group_url,
    (SELECT enabled FROM customer_bot_switch WHERE id = 1) AS bot_switch,
    c.bot_reply_enabled, c.group_agent_key, c.bot_paused_until, c.left_at
  FROM conversation c JOIN channel_account a ON a.id = c.channel_account_id WHERE c.id = ?`).bind(id).first<ConversationRow>();

/** Audit row for inbox actions; `actor` null means the system acted (for example a bot handoff). Never holds message text. */
const auditStatement = (db: D1Database, actor: Actor | null, command: string, entityId: string, before: unknown, after: unknown, now: string) =>
  db.prepare(`INSERT INTO audit_log (id, actor_user_id, actor_kind, command, entity, entity_id, before_json, after_json, created_at)
    VALUES (?, ?, ?, ?, 'conversation', ?, ?, ?, ?)`).bind(crypto.randomUUID(), actor?.id ?? null, actor?.kind ?? 'system', command,
    entityId, JSON.stringify(before), JSON.stringify(after), now);

/** Appends one line to the pending staff context, keeping only the last 1500 characters. */
export const appendStaffContext = (db: D1Database, conversationId: string, line: string, now: string) =>
  db.prepare(`UPDATE conversation SET staff_context_pending = substr(COALESCE(staff_context_pending || char(10), '') || ?, ?),
      updated_at = ? WHERE id = ?`).bind(line, -STAFF_CONTEXT_MAX_CHARS, now, conversationId);

/**
 * Marks an outgoing message as delivered and records the channel's message id when it has none yet and
 * no other message of the conversation already holds that id.
 */
export const markMessageSent = (db: D1Database, messageId: string, externalMsgId: string | null) =>
  db.prepare(`UPDATE message SET status = 'sent',
      external_msg_id = CASE WHEN external_msg_id IS NULL AND ?1 IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM message o WHERE o.conversation_id = message.conversation_id AND o.external_msg_id = ?1) THEN ?1 ELSE external_msg_id END
    WHERE id = ?2 AND direction = 'out'`).bind(externalMsgId, messageId).run();

/** GoClaw session of a conversation: `<channel>:<account external id>:<thread id>`. */
const goclawUserId = (conv: ConversationRow) => `${conv.channel}:${conv.account_external_id ?? conv.channel_account_id}:${conv.external_thread_id}`;

function outgoingRoute(channel: ChannelKind): { target: CommandTarget; kind: CommandKind } {
  if (channel === 'facebook') return { target: 'worker', kind: 'send_messenger' };
  if (channel === 'zalo_oa') return { target: 'worker', kind: 'send_zalo_oa' };
  return { target: 'bridge', kind: 'send_zalo' };
}

/** Profile line for an OA customer who already has a real name. Gender is not stored on the conversation. */
function oaProfilePrefix(conv: ConversationRow): string {
  if (conv.channel !== 'zalo_oa') return '';
  const name = conv.display_name?.trim() ?? '';
  if (!name || name === ZALO_OA_PLACEHOLDER_NAME) return '';
  return `[Hồ sơ Zalo của khách: tên "${name}"; giới tính: không rõ]\n`;
}

function isZdnImage(url: string, mime: string): boolean {
  if (!mime.startsWith('image/') || !URL.canParse(url)) return false;
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return host === 'zdn.vn' || host.endsWith('.zdn.vn');
}

function zdnImagesFromAttachments(raw: string | null): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const urls: string[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const url = (item as { url?: unknown }).url;
    const mime = (item as { mimeType?: unknown }).mimeType;
    if (typeof url !== 'string' || typeof mime !== 'string' || !isZdnImage(url, mime)) continue;
    urls.push(url);
    if (urls.length === OA_IMAGE_LIMIT) break;
  }
  return urls;
}

function asUrlList(value: unknown): string[] {
  let parsed = value;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return []; }
  }
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}

/** Keeps the first occurrence of each URL, at most three, existing ones before the new message's. */
function mergeOaImages(current: unknown, extra: string[]): string[] {
  const out: string[] = [];
  for (const url of [...asUrlList(current), ...extra]) {
    if (out.includes(url)) continue;
    out.push(url);
    if (out.length === OA_IMAGE_LIMIT) break;
  }
  return out;
}

const messageImages = async (db: D1Database, messageId: string) => {
  const row = await db.prepare('SELECT attachments_json FROM message WHERE id = ?')
    .bind(messageId).first<{ attachments_json: string | null }>();
  return zdnImagesFromAttachments(row?.attachments_json ?? null);
};

/**
 * Rule 1: the bot replies only in a direct conversation in `ai` mode of an enabled account while the customer bot is on.
 * An account without an agent has no bot to reply with.
 */
const botMayReply = (conv: ConversationRow) =>
  conv.agent_key !== null && conv.bot_switch === 0 && conv.bot_enabled === 1 && conv.kind === 'direct' && conv.mode === 'ai';

/**
 * The group bot replies when this group and its account have the bot on, the customer bot switch is off,
 * and a pause has not been set or has already ended. A group the company number has left never gets a reply.
 * The conversation mode and the account agent are ignored: a group stays in `ai` and uses its own agent.
 */
export function groupBotMayReply(conv: ConversationRow, now: Date) {
  return conv.kind === 'group' && conv.left_at == null && conv.bot_reply_enabled === 1 && conv.bot_enabled === 1
    && conv.bot_switch === 0 && (conv.bot_paused_until === null || conv.bot_paused_until <= now.toISOString());
}

/** Drops pending group replies. A send the bridge has already claimed still goes out. */
export const cancelPendingGroupReplies = (db: D1Database, conversationId: string, now: string) =>
  db.prepare(`UPDATE channel_command SET status='failed', result_json='{"error":"GROUP_STAFF_SPOKE"}', updated_at=?
    WHERE conversation_id=? AND kind='run_completion' AND status='pending' AND json_extract(payload_json,'$.purpose')='reply'`)
    .bind(now, conversationId);

/** SQL that appends the bound customer line to a pending reply's `customerText`; a reply queued without one starts it. */
const APPEND_CUSTOMER_TEXT = "COALESCE(json_extract(payload_json, '$.customerText') || char(10), '') || ?";

/**
 * Queues the bot's reply to a customer message: extends the pending reply of the conversation with this
 * text and pushes its run time back 8 seconds, or queues a new one. Pending staff context is prefixed once
 * and then cleared. Returns false when the bot may not reply.
 */
export async function scheduleCompletion(db: D1Database, conversationId: string, messageId: string, text: string, now = new Date()) {
  const conv = await loadConversation(db, conversationId);
  if (!conv || !botMayReply(conv)) return false;
  const context = conv.staff_context_pending ?? '';
  const customerText = text || ATTACHMENT_ONLY_TEXT;
  const turn = (context ? `[Nhân viên đã trao đổi: ${context}]\n` : '') + customerText;
  const runAt = new Date(now.getTime() + COMPLETION_DELAY_MS);
  const nowIso = now.toISOString();
  let extended;
  if (conv.channel === 'zalo_oa') {
    const pending = await db.prepare(`SELECT json_extract(payload_json, '$.images') AS images FROM channel_command
      WHERE conversation_id = ? AND kind = 'run_completion' AND status = 'pending' AND json_extract(payload_json, '$.purpose') = 'reply'`)
      .bind(conversationId).first<{ images: unknown }>();
    const images = mergeOaImages(pending?.images, await messageImages(db, messageId));
    extended = await db.prepare(`UPDATE channel_command
        SET payload_json = json_set(payload_json, '$.text', json_extract(payload_json, '$.text') || char(10) || ?, '$.images', json(?),
            '$.customerText', ${APPEND_CUSTOMER_TEXT}), next_run_at = ?, updated_at = ?
      WHERE conversation_id = ? AND kind = 'run_completion' AND status = 'pending' AND json_extract(payload_json, '$.purpose') = 'reply'`)
      .bind(turn, JSON.stringify(images), customerText, runAt.toISOString(), nowIso, conversationId).run();
  } else {
    extended = await db.prepare(`UPDATE channel_command
        SET payload_json = json_set(payload_json, '$.text', json_extract(payload_json, '$.text') || char(10) || ?,
            '$.customerText', ${APPEND_CUSTOMER_TEXT}), next_run_at = ?, updated_at = ?
      WHERE conversation_id = ? AND kind = 'run_completion' AND status = 'pending' AND json_extract(payload_json, '$.purpose') = 'reply'`)
      .bind(turn, customerText, runAt.toISOString(), nowIso, conversationId).run();
  }
  if (extended.meta.changes === 0) {
    const images = conv.channel === 'zalo_oa' ? await messageImages(db, messageId) : undefined;
    await enqueueCommand(db, {
      kind: 'run_completion', target: 'bridge', channelAccountId: conv.channel_account_id, conversationId,
      payload: {
        agentKey: conv.agent_key, userId: goclawUserId(conv), text: oaProfilePrefix(conv) + turn, customerText, conversationId, purpose: 'reply',
        // Only a personal Zalo 1-1 thread has a user id the bridge can resolve to a profile name and gender.
        ...(conv.channel === 'zalo' && conv.kind === 'direct' && conv.external_thread_id
          ? { zaloUserId: conv.external_thread_id }
          : {}),
        ...(conv.channel === 'zalo_oa' ? { images: images ?? [] } : {}),
      },
      dedupeKey: `completion:${messageId}`, runAt,
    });
  }
  if (context) {
    // Compare-and-clear: a line appended meanwhile stays for the next turn.
    await db.prepare('UPDATE conversation SET staff_context_pending = NULL, updated_at = ? WHERE id = ? AND staff_context_pending = ?')
      .bind(now.toISOString(), conversationId, context).run();
  }
  return true;
}

/** One learner message that can start a group reply. Each call is its own GoClaw turn; nothing is coalesced. */
export interface GroupReplyEvent { msgId: string; senderExternalId: string; senderName: string | null; text: string }

/**
 * Queues one group reply for this message when the group bot may reply now. The GoClaw text names the group
 * and the sender. Returns false when the bot may not reply.
 */
export async function scheduleGroupReply(db: D1Database, conversationId: string, messageId: string, event: GroupReplyEvent, now = new Date()) {
  const conv = await loadConversation(db, conversationId);
  if (!conv || !groupBotMayReply(conv, now)) return false;
  const senderName = event.senderName?.trim() ?? '';
  const text = `[Nhóm Zalo "${conv.display_name ?? 'không tên'}"] ${senderName || 'Một học viên'}: ${event.text.normalize('NFC') || ATTACHMENT_ONLY_TEXT}`;
  await enqueueCommand(db, {
    kind: 'run_completion', target: 'bridge', channelAccountId: conv.channel_account_id, conversationId,
    payload: {
      agentKey: conv.group_agent_key ?? GROUP_AGENT_DEFAULT, userId: goclawUserId(conv), text, conversationId, purpose: 'reply',
      zaloUserId: event.senderExternalId, triggerMessageId: messageId,
      replyTo: { msgId: event.msgId, senderId: event.senderExternalId, senderName },
    },
    dedupeKey: `completion:${messageId}`,
  });
  return true;
}

interface OutgoingMessage {
  id: string;
  senderKind: 'bot' | 'staff_web';
  userId: string | null;
  text: string;
  /** Text the channel receives. Defaults to `text`. Empty when the stored body is only the attachment placeholder. */
  channelText?: string;
  attachments?: StaffMedia[];
  replyTo?: GroupReplyTarget;
}

/**
 * Inserts an outgoing message and the command that sends it in one batch. The command's dedupe key defaults to
 * the message id; with a caller's key, a second call with that key inserts nothing and returns the message the
 * first call queued (`replayed`).
 */
async function queueOutgoing(db: D1Database, conv: ConversationRow, message: OutgoingMessage, now: string, dedupeKey = `send:${message.id}`):
  Promise<{ target: CommandTarget; messageId: string; replayed: boolean }> {
  // Messenger and Zalo OA are sent by the Worker. Personal Zalo is sent by the bridge sidecar (ADR-010).
  const { target, kind } = outgoingRoute(conv.channel);
  const replyTo = message.replyTo;
  // The bridge sends a group reply as `@name text`. Store that exact body so its echo matches this message
  // instead of looking like someone typed on the phone.
  const body = replyTo && replyTo.senderName.trim() ? `@${replyTo.senderName} ${message.text}` : message.text;
  const outboundText = message.channelText ?? message.text;
  const storedAttachments = (message.attachments ?? []).map((item) => ({
    url: item.url, mimeType: item.mimeType, ...(item.name ? { name: item.name } : {}),
  }));
  const bridgeAttachments = kind === 'send_zalo' && message.attachments?.length
    ? message.attachments.map((item) => ({ key: item.key, mimeType: item.mimeType, filename: item.name ?? filenameForKey(item.key, item.mimeType) }))
    : undefined;
  const command = commandInsertStatement(db, {
    kind, target, channelAccountId: conv.channel_account_id,
    conversationId: conv.id, dedupeKey,
    payload: {
      messageId: message.id, threadId: conv.external_thread_id, threadKind: conv.kind, text: outboundText,
      ...(replyTo ? { replyTo } : {}),
      ...(bridgeAttachments ? { attachments: bridgeAttachments } : {}),
    },
  });
  // The message is written only together with its command, so a replayed key never leaves an orphan message.
  const [inserted] = await db.batch([
    db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, sent_by_user_id, body, attachments_json, status, created_at)
      SELECT ?, ?, 'out', ?, ?, ?, ?, 'pending', ? WHERE NOT EXISTS (SELECT 1 FROM channel_command WHERE dedupe_key = ?)`)
      .bind(message.id, conv.id, message.senderKind, message.userId, body, storedAttachments.length ? JSON.stringify(storedAttachments) : null, now, dedupeKey),
    command.statement,
  ]);
  if (inserted!.meta.changes === 1) return { target, messageId: message.id, replayed: false };
  const existing = await db.prepare("SELECT json_extract(payload_json, '$.messageId') AS messageId FROM channel_command WHERE dedupe_key = ?")
    .bind(dedupeKey).first<{ messageId: string | null }>();
  if (!existing?.messageId) throw new Error('send command dedupe conflict without a message');
  return { target, messageId: existing.messageId, replayed: true };
}

export interface FlowOutcome {
  /** True when a command for the Worker itself was queued; the caller runs processWorkerCommands. */
  workerCommandQueued: boolean;
  /**
   * The check of the customer's turn after a bot reply. The caller runs it after sending, so the reply never waits
   * for it, and runs processWorkerCommands again when its outcome queued a Worker command. It never throws.
   */
  handoffCheck?: () => Promise<FlowOutcome>;
}

/**
 * Hands the conversation to people: `human` mode, the reason, and a Lark notice to the inbox group.
 * `origin` is the request origin, used for the link when APP_URL is unset. With `onlyFromAi` nothing happens unless
 * the conversation is still in `ai` mode at that moment, so concurrent or repeated callers hand off once.
 */
export async function handoff(db: D1Database, env: Pick<Env, 'APP_URL'>, conversationId: string, reason: string, origin?: string,
  options: { onlyFromAi?: boolean } = {}): Promise<FlowOutcome> {
  const conv = await loadConversation(db, conversationId);
  if (!conv) return { workerCommandQueued: false };
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const base = linkBase(env.APP_URL, origin);
  const update = db.prepare(`UPDATE conversation SET mode = 'human', handoff_reason = ?,
      sla_due_at = CASE WHEN kind = 'direct' THEN ${slaDueSql()} ELSE NULL END, updated_at = ?
    WHERE id = ?${options.onlyFromAi ? " AND mode = 'ai'" : ''}`).bind(reason, now, now, conv.id);
  const audit = auditStatement(db, null, 'inbox.handoff', conv.id, { mode: conv.mode }, { mode: 'human', reason }, now);
  if (options.onlyFromAi) {
    if ((await update.run()).meta.changes !== 1) return { workerCommandQueued: false };
    await audit.run();
  } else {
    await db.batch([update, audit]);
  }
  const assignment = await autoAssignOnHandoff(db, conv.id, base, nowDate);
  const noOneOnDuty = assignment.status === 'no_one_on_duty' ? ' – chưa có người trực' : '';
  const text = `Handoff: ${conv.display_name ?? conv.external_thread_id} (${conv.account_name}) – ${reason}${noOneOnDuty} – ${base}/inbox/${conv.id}`;
  await enqueueCommand(db, { kind: 'send_lark', target: 'worker', conversationId: conv.id, payload: { text } });
  await requestExtraction(db, conv.id);
  return { workerCommandQueued: true };
}

/** Handoff reason when the bot could not produce a reply. */
export const BOT_SILENT_REASON = 'Bot không trả lời được';

/** The bot's reply was given up: people take over unless they already have the conversation. Hands off once. */
export const handOffSilentBot = (db: D1Database, env: Pick<Env, 'APP_URL'>, conversationId: string, origin?: string) =>
  handoff(db, env, conversationId, BOT_SILENT_REASON, origin, { onlyFromAi: true });

const QUESTION_CLIP = 300;

/**
 * Tells the Lark inbox group that a Zalo group needs a person. The conversation mode stays as it is.
 * `commandId` dedupes the notice, so one failed reply notifies Lark once.
 */
export async function notifyGroupHelp(db: D1Database, env: Pick<Env, 'APP_URL'>, conversationId: string, reason: string,
  triggerMessageId?: string, origin?: string, notice?: { commandId?: string; replyTo?: GroupReplyTarget }): Promise<FlowOutcome> {
  const conv = await loadConversation(db, conversationId);
  if (!conv || conv.kind !== 'group') return { workerCommandQueued: false };
  const questionRow = triggerMessageId
    ? await db.prepare('SELECT body FROM message WHERE id = ? AND conversation_id = ?').bind(triggerMessageId, conv.id).first<{ body: string }>()
    : null;
  const question = (questionRow?.body ?? '').slice(0, QUESTION_CLIP);
  const senderName = notice?.replyTo?.senderName.trim() || 'Một học viên';
  const groupName = conv.display_name ?? 'không tên';
  const base = linkBase(env.APP_URL, origin);
  const text = `Nhóm Zalo cần hỗ trợ: ${groupName} (${conv.account_name}) – ${senderName} hỏi: "${question}" – ${reason} – ${base}/inbox/${conv.id}`;
  await enqueueCommand(db, {
    kind: 'send_lark', target: 'worker', conversationId: conv.id, payload: { text },
    ...(notice?.commandId ? { dedupeKey: `group-help:${notice.commandId}` } : {}),
  });
  return { workerCommandQueued: true };
}

/** A reply still pending or running this long after it was queued means the bridge or GoClaw is not answering. */
export const STALE_REPLY_MS = 10 * 60_000;
const STALE_REPLY_BATCH = 50;

/**
 * Gives up bot replies queued more than 10 minutes ago that have not run (the sidecar is offline) or not finished,
 * and hands each affected conversation to people once. A late result of a given-up reply is ignored, since only a
 * claimed command accepts one. Returns the number of replies given up.
 */
export async function abandonStaleReplies(db: D1Database, env: Pick<Env, 'APP_URL'>, now = new Date()): Promise<number> {
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - STALE_REPLY_MS).toISOString();
  // A pending reply that new customer messages keep pushing back is not due yet and is left alone.
  const stale = await db.prepare(`SELECT cc.id, cc.conversation_id, cc.payload_json, c.kind AS conversation_kind
    FROM channel_command cc LEFT JOIN conversation c ON c.id = cc.conversation_id
    WHERE cc.kind = 'run_completion' AND json_extract(cc.payload_json, '$.purpose') = 'reply' AND cc.created_at < ?1
      AND ((cc.status = 'pending' AND cc.next_run_at <= ?2) OR cc.status = 'claimed')
    ORDER BY cc.created_at LIMIT ?3`).bind(cutoff, nowIso, STALE_REPLY_BATCH)
    .all<{ id: string; conversation_id: string | null; payload_json: string; conversation_kind: string | null }>();
  const directConversations = new Set<string>();
  let abandoned = 0;
  for (const row of stale.results) {
    const res = await db.prepare(`UPDATE channel_command SET status = 'failed', lease_expires_at = NULL, result_json = ?, updated_at = ?
      WHERE id = ? AND status IN ('pending', 'claimed')`).bind(JSON.stringify({ error: 'REPLY_TIMEOUT' }), nowIso, row.id).run();
    if (res.meta.changes !== 1) continue;
    abandoned += 1;
    if (!row.conversation_id) continue;
    if (row.conversation_kind === 'group') {
      try {
        const payload = asCompletionPayload(JSON.parse(row.payload_json) as unknown);
        await notifyGroupHelp(db, env, row.conversation_id, BOT_SILENT_REASON, payload.triggerMessageId, undefined,
          { commandId: row.id, replyTo: payload.replyTo });
      } catch (error) {
        console.error('stale_reply_handoff_error', error instanceof Error ? error.message : 'unknown');
      }
    } else {
      directConversations.add(row.conversation_id);
    }
  }
  for (const conversationId of directConversations) {
    try {
      await handOffSilentBot(db, env, conversationId);
    } catch (error) {
      console.error('stale_reply_handoff_error', error instanceof Error ? error.message : 'unknown');
    }
  }
  return abandoned;
}

/** Asks the CRM extractor to read the conversation; a failure is logged and never blocks the mode change. */
async function requestExtraction(db: D1Database, conversationId: string) {
  try {
    await enqueueExtraction(db, conversationId);
  } catch (error) {
    console.error('extract_enqueue_error', error instanceof Error ? error.message : 'unknown');
  }
}

/**
 * SQL condition (on a message `m` and its account `a`) that holds when a queued bot message may no longer go out:
 * the customer bot switch is on or the account's bot is off. Staff messages are never held back.
 */
export const BOT_SEND_BLOCKED_SQL = `m.sender_kind = 'bot'
  AND (a.bot_enabled = 0 OR COALESCE((SELECT enabled FROM customer_bot_switch WHERE id = 1), 0) = 1)`;

/** True when an ABM person wrote in the group after the message that triggered this reply. */
async function staffSpokeAfter(db: D1Database, conv: ConversationRow, triggerMessageId: string) {
  const row = await db.prepare(`SELECT 1 AS hit FROM message m
    WHERE m.conversation_id = ?1
      AND m.created_at > (SELECT created_at FROM message WHERE id = ?2 AND conversation_id = ?1)
      AND (m.sender_kind IN ('staff_phone', 'staff_web') OR EXISTS (
        SELECT 1 FROM zalo_staff_member s WHERE s.channel_account_id = ?3 AND s.external_user_id = m.sender_external_id))
    LIMIT 1`).bind(conv.id, triggerMessageId, conv.channel_account_id).first<{ hit: number }>();
  return row !== null;
}

async function storeUnsentReply(db: D1Database, conversationId: string, prefix: string, text: string, now: string) {
  if (!text) return;
  await db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, body, status, created_at)
    VALUES (?, ?, 'out', 'system', ?, 'failed', ?)`).bind(crypto.randomUUID(), conversationId, prefix + text, now).run();
}

/**
 * Applies a group reply. The direct `botMayReply` rule does not apply here. A reply that may no longer go out
 * is kept as a system note. A handoff marker only notifies Lark.
 */
async function applyGroupCompletion(db: D1Database, env: Pick<Env, 'APP_URL'>, conv: ConversationRow, text: string,
  reason: string | undefined, now: string, origin: string | undefined, payload: CompletionResultPayload | undefined): Promise<FlowOutcome> {
  if (!groupBotMayReply(conv, new Date(now))) {
    await storeUnsentReply(db, conv.id, BOT_OFF_REPLY_PREFIX, text, now);
    return { workerCommandQueued: false };
  }
  if (payload?.triggerMessageId && await staffSpokeAfter(db, conv, payload.triggerMessageId)) {
    await storeUnsentReply(db, conv.id, CANCELLED_REPLY_PREFIX, text, now);
    return { workerCommandQueued: false };
  }
  let workerCommandQueued = false;
  if (text) {
    const { target } = await queueOutgoing(db, conv, {
      id: crypto.randomUUID(), senderKind: 'bot', userId: null, text, replyTo: payload?.replyTo,
    }, now);
    await db.prepare('UPDATE conversation SET last_message_at = ?, updated_at = ? WHERE id = ?').bind(now, now, conv.id).run();
    workerCommandQueued = target === 'worker';
  }
  if (reason) {
    const outcome = await notifyGroupHelp(db, env, conv.id, reason, payload?.triggerMessageId, origin,
      { commandId: payload?.commandId, replyTo: payload?.replyTo });
    workerCommandQueued ||= outcome.workerCommandQueued;
  }
  return { workerCommandQueued };
}

/**
 * Applies GoClaw's reply: strips handoff marker lines and sends the remaining text while the bot may still reply
 * (rule 1, re-checked now because the switch or the mode can change while GoClaw thinks). Otherwise the text is
 * kept as a cancelled system note and nothing is sent. A marker hands off only after a reply that was allowed.
 * After an allowed reply the customer's own turn is checked as well, so a missing marker can still hand off.
 */
export async function applyCompletionResult(db: D1Database, env: HandoffCheckEnv, conversationId: string, replyText: string,
  origin?: string, payload?: CompletionResultPayload): Promise<FlowOutcome> {
  const conv = await loadConversation(db, conversationId);
  if (!conv) return { workerCommandQueued: false };
  const marker = HANDOFF_MARKER.exec(replyText);
  const text = replyText.replace(HANDOFF_MARKER_ALL, '').trim();
  const now = new Date().toISOString();
  if (conv.kind === 'group') return applyGroupCompletion(db, env, conv, text, marker?.[1]?.trim(), now, origin, payload);
  if (!botMayReply(conv)) {
    if (text) {
      const prefix = conv.mode !== 'ai' ? CANCELLED_REPLY_PREFIX : BOT_OFF_REPLY_PREFIX;
      await db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, body, status, created_at)
        VALUES (?, ?, 'out', 'system', ?, 'failed', ?)`).bind(crypto.randomUUID(), conv.id, prefix + text, now).run();
    }
    return { workerCommandQueued: false };
  }
  if (conv.channel === 'zalo_oa' && text) {
    try {
      assertRegistrationPolicyOutput(
        { reply: text, handoff: Boolean(marker) },
        conv.registration_policy === 1,
        conv.registration_group_url ? `- Link nhóm Zalo chính xác: ${conv.registration_group_url}` : '',
      );
    } catch (error) {
      if (!(error instanceof UnsafeRecoveryReplyError)) throw error;
      await db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, body, status, created_at)
        VALUES (?, ?, 'out', 'system', ?, 'failed', ?)`).bind(crypto.randomUUID(), conv.id,
        `Chưa gửi (kiểm tra 199k): ${error.message}\n${text}`, now).run();
      return handoff(db, env, conv.id, error.message, origin);
    }
  }
  let workerCommandQueued = false;
  if (text) {
    const { target } = await queueOutgoing(db, conv, { id: crypto.randomUUID(), senderKind: 'bot', userId: null, text }, now);
    await db.prepare('UPDATE conversation SET last_message_at = ?, updated_at = ? WHERE id = ?').bind(now, now, conv.id).run();
    workerCommandQueued = target === 'worker';
  }
  if (marker) {
    const outcome = await handoff(db, env, conv.id, marker[1]!.trim(), origin);
    workerCommandQueued ||= outcome.workerCommandQueued;
  }
  const customerText = payload?.customerText;
  // A turn of attachments only has no words to check.
  if (customerText && customerText.split('\n').some((line) => line !== ATTACHMENT_ONLY_TEXT)) {
    return { workerCommandQueued, handoffCheck: () => checkHandoff(db, env, conv, customerText, Boolean(marker), origin) };
  }
  return { workerCommandQueued };
}

type HandoffCheckEnv = Pick<Env, 'APP_URL' | 'HANDOFF_NET_MODE' | 'JEV_INTENT_MODE' | 'JEV_CONFIDENCE' | 'JEV_MODEL' | 'TYPESAFE_API_KEY'>;

/**
 * Checks the customer's turn on its own after the bot replied (decision-layer.ts) and logs each check to the audit
 * log without message text. In `active` mode a turn that needs a person is handed off when the bot did not hand off.
 * A failure is logged and never touches the reply already queued.
 */
async function checkHandoff(db: D1Database, env: HandoffCheckEnv, conv: ConversationRow, customerText: string, botHandedOff: boolean,
  origin: string | undefined): Promise<FlowOutcome> {
  const mode = decisionMode(env.HANDOFF_NET_MODE);
  if (mode === 'off') return { workerCommandQueued: false };
  let outcome: FlowOutcome = { workerCommandQueued: false };
  try {
    // Once the bot has handed off in active mode, Jev's answer could change nothing; shadow still asks, for comparison.
    const decision = await decideHandoff(env, customerText, !(botHandedOff && mode === 'active'));
    let handoffError: string | null = null;
    if (mode === 'active' && !botHandedOff && decision.decided) {
      try {
        outcome = await handoff(db, env, conv.id, HANDOFF_CATEGORIES[decision.decided.category].reason, origin, { onlyFromAi: true });
      } catch (error) {
        handoffError = error instanceof Error ? error.message : 'unknown';
      }
    }
    // `applied` is what happened: false when staff had already taken the conversation or the handoff failed.
    await auditStatement(db, null, 'inbox.handoffCheck', conv.id, { botHandedOff }, {
      mode, jevMode: decisionMode(env.JEV_INTENT_MODE), rule: decision.rule, jev: decision.jev ?? null, decided: decision.decided,
      applied: outcome.workerCommandQueued, ...(handoffError ? { handoffError } : {}),
    }, new Date().toISOString()).run();
  } catch (error) {
    console.error('handoff_check_error', error instanceof Error ? error.message : 'unknown');
  }
  return outcome;
}

/** Looks up a conversation of the actor's organization. */
async function loadForActor(db: D1Database, actor: Actor, conversationId: string) {
  const conv = await loadConversation(db, conversationId);
  return conv && conv.organization_id === actor.organizationId ? conv : null;
}

/** Result of a staff send; `conflict` means the client message id was already used for a different message. */
export type StaffSendOutcome =
  | { conflict: false; messageId: string; mode: ConversationMode; assigneeUserId: string | null; workerCommandQueued: boolean }
  | { conflict: true }
  | { unsupported: true }
  | { left: true };

function sameStoredAttachments(raw: string | null, files: StaffMedia[] | undefined): boolean {
  let stored: unknown = [];
  if (raw) {
    try { stored = JSON.parse(raw); } catch { return false; }
  }
  const expected = (files ?? []).map((item) => ({ url: item.url, mimeType: item.mimeType, ...(item.name ? { name: item.name } : {}) }));
  return JSON.stringify(stored) === JSON.stringify(expected);
}

/**
 * A staff member writes from the web: the message is queued for sending, recorded in the pending staff
 * context, and an `ai` conversation switches to `human`, assigned to the sender when nobody has it.
 * A `clientMessageId` makes the send idempotent: repeating it (a retry after a lost response) returns the
 * message already queued and changes nothing; reusing it for other text or by another person is a conflict.
 * Null when the conversation is not in the actor's organization. A group the company number has left is refused.
 */
export async function staffSend(
  db: D1Database, actor: Actor, conversationId: string, text: string, clientMessageId?: string, attachments?: StaffMedia[],
): Promise<StaffSendOutcome | null> {
  const conv = await loadForActor(db, actor, conversationId);
  if (!conv) return null;
  const files = attachments?.length ? attachments : undefined;
  if (files && conv.channel !== 'zalo' && conv.channel !== 'zalo_oa') return { unsupported: true };
  if (conv.kind === 'group' && conv.left_at) return { left: true };
  const trimmed = text.trim();
  const storedBody = trimmed || ATTACHMENT_ONLY_TEXT;
  // Image-only: the CRM row keeps the placeholder, and the channel is given an empty caption.
  const channelText = files ? trimmed : undefined;
  const now = new Date().toISOString();
  const dedupeKey = clientMessageId ? `send:${conv.id}:${clientMessageId}` : undefined;
  const queued = await queueOutgoing(db, conv, {
    id: crypto.randomUUID(), senderKind: 'staff_web', userId: actor.id, text: storedBody, channelText, attachments: files,
  }, now, dedupeKey);
  const workerCommandQueued = queued.target === 'worker';
  if (queued.replayed) {
    const previous = await db.prepare(`SELECT body, sent_by_user_id, attachments_json FROM message
      WHERE id = ? AND conversation_id = ? AND direction = 'out' AND sender_kind = 'staff_web'`)
      .bind(queued.messageId, conv.id).first<{ body: string; sent_by_user_id: string | null; attachments_json: string | null }>();
    if (!previous || previous.body !== storedBody || previous.sent_by_user_id !== actor.id || !sameStoredAttachments(previous.attachments_json, files)) {
      return { conflict: true };
    }
    return { conflict: false, messageId: queued.messageId, mode: conv.mode, assigneeUserId: conv.assignee_user_id, workerCommandQueued };
  }
  // A web reply in a group pauses the bot and drops pending replies. The group stays in its current mode.
  if (conv.kind === 'group') {
    const pauseUntil = new Date(Date.parse(now) + GROUP_PAUSE_MS).toISOString();
    await db.batch([
      db.prepare('UPDATE conversation SET bot_paused_until = ?, last_message_at = ?, updated_at = ? WHERE id = ?')
        .bind(pauseUntil, now, now, conv.id),
      cancelPendingGroupReplies(db, conv.id, now),
      auditStatement(db, actor, 'inbox.staffSend', conv.id, { mode: conv.mode, assigneeUserId: conv.assignee_user_id },
        { mode: conv.mode, assigneeUserId: conv.assignee_user_id, messageId: queued.messageId }, now),
    ]);
    return {
      conflict: false, messageId: queued.messageId, mode: conv.mode, assigneeUserId: conv.assignee_user_id, workerCommandQueued,
    };
  }
  const { messageId } = queued;
  const mode: ConversationMode = conv.mode === 'ai' ? 'human' : conv.mode;
  const assignee = conv.assignee_user_id ?? (conv.mode === 'ai' ? actor.id : null);
  await db.batch([
    db.prepare(`UPDATE conversation SET mode = ?, last_message_at = ?, last_staff_reply_at = ?, sla_due_at = NULL, updated_at = ?,
        assigned_at = CASE WHEN assignee_user_id IS NULL AND ? IS NOT NULL THEN ? ELSE assigned_at END,
        assignee_user_id = COALESCE(assignee_user_id, ?)
      WHERE id = ?`).bind(mode, now, now, now, assignee, now, assignee, conv.id),
    appendStaffContext(db, conv.id, `Nhân viên: ${storedBody}`, now),
    auditStatement(db, actor, 'inbox.staffSend', conv.id, { mode: conv.mode, assigneeUserId: conv.assignee_user_id },
      { mode, assigneeUserId: assignee, messageId }, now),
  ]);
  return { conflict: false, messageId, mode, assigneeUserId: assignee, workerCommandQueued };
}

/**
 * Changes the conversation mode. Taking it to `human` while nobody has it assigns it to the actor.
 * Null when the conversation is not in the actor's organization.
 */
export async function setMode(db: D1Database, actor: Actor, conversationId: string, mode: ConversationMode) {
  const conv = await loadForActor(db, actor, conversationId);
  if (!conv) return null;
  const now = new Date().toISOString();
  const assignee = conv.assignee_user_id ?? (mode === 'human' ? actor.id : null);
  await db.batch([
    // Switching a direct conversation to `human` starts the reply deadline; any other mode, or a group, has no staff
    // reply to wait for.
    db.prepare(`UPDATE conversation SET mode = ?1, updated_at = ?2,
        sla_due_at = CASE WHEN ?1 <> 'human' OR kind <> 'direct' THEN NULL WHEN mode = 'human' THEN sla_due_at ELSE ${slaDueSql('?2')} END,
        assigned_at = CASE WHEN assignee_user_id IS NULL AND ?3 IS NOT NULL THEN ?2 ELSE assigned_at END,
        assignee_user_id = COALESCE(assignee_user_id, ?3)
      WHERE id = ?4`).bind(mode, now, assignee, conv.id),
    auditStatement(db, actor, 'inbox.setMode', conv.id, { mode: conv.mode, assigneeUserId: conv.assignee_user_id },
      { mode, assigneeUserId: assignee }, now),
  ]);
  // Handing the conversation back to the bot is a natural point to capture what staff learned.
  if (mode === 'ai' && conv.mode !== 'ai') await requestExtraction(db, conv.id);
  return { mode, assigneeUserId: assignee };
}

/** An outgoing message still pending after this long without a live send command is given up. */
export const STUCK_OUTGOING_MS = 15 * 60_000;

/**
 * Marks outgoing messages failed when they have been pending for 15 minutes and no pending or claimed
 * command refers to them any more (for example the send command failed for good). Returns the count.
 */
export async function sweepStuckOutgoing(db: D1Database, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STUCK_OUTGOING_MS).toISOString();
  const res = await db.prepare(`UPDATE message SET status = 'failed'
    WHERE direction = 'out' AND status = 'pending' AND created_at < ?
      AND NOT EXISTS (SELECT 1 FROM channel_command cc
        WHERE json_extract(cc.payload_json, '$.messageId') = message.id AND cc.status IN ('pending', 'claimed'))`)
    .bind(cutoff).run();
  return res.meta.changes;
}
