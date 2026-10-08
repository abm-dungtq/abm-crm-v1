import type { BridgeEvent } from '@abm/contracts';
import { isConstraintFailure } from '../guarded-tx';
import { slaDueSql } from './assignment';
import { ATTACHMENT_ONLY_TEXT, appendStaffContext, markMessageSent, scheduleCompletion } from './conversation-flow';
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

/** A fromSelf event without command id matches a system message sent within this window. */
const ECHO_WINDOW_MS = 120_000;
/** Outgoing messages are at most this long, so a longer echo is compared by its leading part. */
const ECHO_MATCH_CHARS = 2000;

export interface IngestResult { accepted: number; rejected: number }

/** Channel account a message belongs to. */
export interface ChannelAccountRef { id: string; organization_id: string }
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
}

/** Decides whether a fromSelf message echoes a message the system sent; when it does, it marks that message sent. */
export type EchoMatcher = (conversationId: string) => Promise<boolean>;

const findZaloAccount = (db: D1Database, externalId: string) =>
  db.prepare("SELECT id, organization_id FROM channel_account WHERE channel = 'zalo' AND external_id = ?").bind(externalId).first<ChannelAccountRef>();

const upsertConversation = (db: D1Database, account: ChannelAccountRef, threadId: string, kind: 'direct' | 'group', displayName: string | null, now: string) =>
  db.prepare(`INSERT INTO conversation (id, organization_id, channel_account_id, kind, external_thread_id, display_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_account_id, external_thread_id) DO UPDATE SET kind = excluded.kind,
      display_name = COALESCE(excluded.display_name, conversation.display_name), updated_at = excluded.updated_at
    RETURNING id, mode`).bind(crypto.randomUUID(), account.organization_id, account.id, kind, threadId, displayName, now, now);

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

/**
 * Stores one message of a known channel account. A fromSelf message that `isEcho`
 * recognises adds nothing; any other fromSelf message is a staff reply typed outside the CRM (`staff_phone`)
 * and hands the conversation to people. A customer message queues the bot's reply in `ai` mode.
 * The same external message id twice stores one message.
 */
export async function ingestMessage(db: D1Database, account: ChannelAccountRef, event: InboundMessage, now: Date, isEcho: EchoMatcher) {
  const nowIso = now.toISOString();
  // A direct thread is named after the customer; our own messages and group members do not rename it.
  const senderName = event.senderName?.trim();
  const name = !event.fromSelf && event.threadKind === 'direct' && senderName ? senderName : null;
  const conv = await upsertConversation(db, account, event.threadId, event.threadKind, name, nowIso).first<ConversationRef>();
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
  const updates = [db.prepare(`UPDATE conversation SET last_inbound_at = ?1, last_message_at = ?1, updated_at = ?1,
      sla_due_at = CASE WHEN mode = 'human' AND kind = 'direct' THEN COALESCE(sla_due_at, ${slaDueSql('?1')}) ELSE sla_due_at END
    WHERE id = ?2`).bind(nowIso, conv.id)];
  if (conv.mode !== 'ai') updates.push(appendStaffContext(db, conv.id, `Khách: ${text}`, nowIso));
  await db.batch(updates);
  if (conv.mode === 'ai') await scheduleCompletion(db, conv.id, messageId, event.text, now);
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
  const res = await db.prepare(`UPDATE channel_account SET qr_image = ?, qr_expires_at = ?, status = 'qr_pending', last_seen_at = ?, updated_at = ?
    WHERE id = ?`).bind(event.imageDataUrl, event.expiresAt, now, now, event.accountId).run();
  return res.meta.changes === 1;
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
