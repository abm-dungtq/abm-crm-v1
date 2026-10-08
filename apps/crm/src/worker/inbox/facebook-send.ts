import type { Env } from '../env';
import { BOT_OFF, BOT_SEND_BLOCKED_SQL, markMessageSent } from './conversation-flow';
import { MAX_COMMAND_ATTEMPTS, cancelCommand, completeCommand, dropBotSend, failCommand, type ClaimedCommand } from './dispatcher';

/**
 * Sends `send_messenger` commands through the Graph Send API from the Worker (ADR-010). Messenger only lets a
 * Page answer within 24 hours of the customer's last message; staff may answer for 7 days with the
 * `HUMAN_AGENT` tag. The page token travels in the request URL and is never logged or stored in a result.
 */

/** Graph API version used for every Messenger call; v26.0 is the newest version Meta lists. */
export const GRAPH_API_VERSION = 'v26.0';
const GRAPH_ORIGIN = 'https://graph.facebook.com';
/** Messenger's text limit per message, in characters. */
export const MESSENGER_TEXT_MAX = 2000;
const RESPONSE_WINDOW_MS = 24 * 60 * 60_000;
const HUMAN_AGENT_WINDOW_MS = 7 * 24 * 60 * 60_000;
export const OUTSIDE_WINDOW = 'OUTSIDE_WINDOW';
/** System note shown in the conversation when a reply came too late for Messenger. */
export const OUTSIDE_WINDOW_NOTE = 'Quá thời hạn trả lời của Messenger';

type MessengerSendEnv = Pick<Env, 'DB' | 'FB_PAGE_TOKENS'>;
export type MessengerDelivery = { messaging_type: 'RESPONSE' } | { messaging_type: 'MESSAGE_TAG'; tag: 'HUMAN_AGENT' };

/**
 * Splits text into Messenger-sized parts at line breaks; a single line longer than the limit is cut.
 * Parts that are only whitespace are dropped, since Messenger rejects them.
 */
export function splitMessengerText(text: string, max = MESSENGER_TEXT_MAX): string[] {
  const parts: string[] = [];
  const push = (chars: string[]) => {
    const part = chars.join('');
    if (part.trim()) parts.push(part);
  };
  let chunk: string[] | null = null;
  for (const line of text.split('\n')) {
    let chars = Array.from(line);
    if (chunk && chunk.length + 1 + chars.length <= max) {
      chunk.push('\n', ...chars);
      continue;
    }
    if (chunk) push(chunk);
    while (chars.length > max) {
      push(chars.slice(0, max));
      chars = chars.slice(max);
    }
    chunk = chars;
  }
  if (chunk) push(chunk);
  return parts;
}

/**
 * How a message may be sent now: a normal response within 24 hours of the customer's last message, the
 * `HUMAN_AGENT` tag for a staff reply within 7 days, otherwise null (outside the window).
 */
export function messengerDelivery(senderKind: string, lastInboundAt: string | null, now: Date): MessengerDelivery | null {
  const last = lastInboundAt ? Date.parse(lastInboundAt) : NaN;
  if (!Number.isFinite(last)) return null;
  const age = now.getTime() - last;
  if (age < RESPONSE_WINDOW_MS) return { messaging_type: 'RESPONSE' };
  if (senderKind === 'staff_web' && age < HUMAN_AGENT_WINDOW_MS) return { messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' };
  return null;
}

/** The page's token from the `FB_PAGE_TOKENS` secret (JSON page id → token); null when unset or malformed. */
export function pageToken(raw: string | undefined, pageId: string): string | null {
  if (!raw) return null;
  try {
    const map = JSON.parse(raw) as unknown;
    if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
    const token = (map as Record<string, unknown>)[pageId];
    return typeof token === 'string' && token ? token : null;
  } catch {
    return null;
  }
}

type SendOutcome = { ok: true; mid: string | null } | { ok: false; error: string };

interface GraphReply { message_id?: unknown; error?: { code?: unknown; error_subcode?: unknown } }

/** One Send API call. Errors are reduced to a Graph error code; the URL (which holds the token) is never surfaced. */
async function postMessage(token: string, psid: string, text: string, delivery: MessengerDelivery, messageId: string): Promise<SendOutcome> {
  let res: Response;
  try {
    res = await fetch(`${GRAPH_ORIGIN}/${GRAPH_API_VERSION}/me/messages?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // `metadata` comes back in the echo, so the webhook recognises every part of this message as ours.
      body: JSON.stringify({ recipient: { id: psid }, ...delivery, message: { text, metadata: messageId } }),
    });
  } catch {
    return { ok: false, error: 'GRAPH_NETWORK' };
  }
  const reply = await res.json().catch(() => null) as GraphReply | null;
  if (!res.ok || !reply || reply.error) {
    const code = reply?.error?.code;
    const subcode = reply?.error?.error_subcode;
    if (typeof code !== 'number') return { ok: false, error: `GRAPH_HTTP_${res.status}` };
    return { ok: false, error: typeof subcode === 'number' ? `GRAPH_${code}_${subcode}` : `GRAPH_${code}` };
  }
  return { ok: true, mid: typeof reply.message_id === 'string' ? reply.message_id : null };
}

const markFailed = (db: D1Database, messageId: string) =>
  db.prepare("UPDATE message SET status = 'failed' WHERE id = ? AND status = 'pending'").bind(messageId);

/** A failed attempt is retried by backoff; after the last one the message is failed. */
async function failSend(db: D1Database, command: ClaimedCommand, messageId: string | null, error: string) {
  const moved = await failCommand(db, command.id, command.attempts, error);
  if (moved && command.attempts >= MAX_COMMAND_ATTEMPTS && messageId) await markFailed(db, messageId).run();
}

/** The reply came too late: no retry can succeed, so the command and the message fail now and a note explains why. */
async function failOutsideWindow(db: D1Database, command: ClaimedCommand, messageId: string, conversationId: string) {
  if (!(await failCommand(db, command.id, command.attempts, OUTSIDE_WINDOW))) return;
  await cancelCommand(db, command.id, OUTSIDE_WINDOW);
  await db.batch([
    markFailed(db, messageId),
    db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, body, status, created_at)
      VALUES (?, ?, 'out', 'system', ?, 'failed', ?)`).bind(crypto.randomUUID(), conversationId, OUTSIDE_WINDOW_NOTE, new Date().toISOString()),
  ]);
}

/** Parts of a split message already accepted by Messenger, recorded in the command payload by the claim that sent them. */
interface SendProgress { sentChunks: number; firstMid: string | null }

function readProgress(payload: unknown): SendProgress | null {
  const { sentChunks, firstMid } = (payload ?? {}) as { sentChunks?: unknown; firstMid?: unknown };
  if (typeof sentChunks !== 'number' || !Number.isInteger(sentChunks) || sentChunks < 1) return null;
  return { sentChunks, firstMid: typeof firstMid === 'string' ? firstMid : null };
}

/**
 * Records that the first `sentChunks` parts reached Messenger, only while this claim still owns the command and the
 * count only grows. False means the claim was lost: a newer claim continues the message, so this one must stop.
 */
async function recordProgress(db: D1Database, command: ClaimedCommand, progress: SendProgress): Promise<boolean> {
  const res = await db.prepare(`UPDATE channel_command
      SET payload_json = json_set(payload_json, '$.sentChunks', ?1, '$.firstMid', ?2), updated_at = ?3
    WHERE id = ?4 AND status = 'claimed' AND attempts = ?5
      AND COALESCE(json_extract(payload_json, '$.sentChunks'), 0) < ?1`)
    .bind(progress.sentChunks, progress.firstMid, new Date().toISOString(), command.id, command.attempts)
    .run();
  return res.meta.changes === 1;
}

interface SendRow {
  status: string; sender_kind: string; body: string; conversation_id: string; external_thread_id: string;
  last_inbound_at: string | null; channel: string; page_id: string | null; send_paused: number; bot_blocked: number;
}

/**
 * Runs one claimed `send_messenger` command to completion or failure. Safe to run again after a lost lease or a
 * failed attempt: the parts already sent are recorded in the command (`sentChunks`), so a retry sends only the rest.
 */
export async function sendMessengerCommand(env: MessengerSendEnv, command: ClaimedCommand): Promise<void> {
  const db = env.DB;
  const messageId = (command.payload as { messageId?: unknown } | null)?.messageId;
  if (typeof messageId !== 'string' || !messageId) return failSend(db, command, null, 'INVALID_PAYLOAD');
  const row = await db.prepare(`SELECT m.status, m.sender_kind, m.body, m.conversation_id, c.external_thread_id, c.last_inbound_at,
      a.channel, a.external_id AS page_id, a.send_paused, (${BOT_SEND_BLOCKED_SQL}) AS bot_blocked
    FROM message m JOIN conversation c ON c.id = m.conversation_id JOIN channel_account a ON a.id = c.channel_account_id
    WHERE m.id = ? AND m.direction = 'out'`).bind(messageId).first<SendRow>();
  if (!row || row.channel !== 'facebook' || !row.page_id) return failSend(db, command, messageId, 'INVALID_PAYLOAD');
  const progress = readProgress(command.payload);
  // Given up, or delivered by an earlier run (or its echo) with no part left unsent: nothing to send again.
  // The echo of a first part can mark the message sent while later parts still wait, so recorded progress wins.
  const parts = splitMessengerText(row.body);
  const unsentParts = progress !== null && progress.sentChunks < parts.length;
  if (row.status === 'failed' || (row.status === 'sent' && !unsentParts)) {
    await completeCommand(db, command.id, command.attempts, { sent: row.status === 'sent' });
    return;
  }
  // A bot message no longer goes out once the bot is off, not even later when it is back on.
  if (row.bot_blocked === 1) {
    await dropBotSend(db, command, BOT_OFF);
    return;
  }
  if (row.send_paused === 1) return failSend(db, command, messageId, 'ACCOUNT_PAUSED');
  const delivery = messengerDelivery(row.sender_kind, row.last_inbound_at, new Date());
  if (!delivery) return failOutsideWindow(db, command, messageId, row.conversation_id);
  const token = pageToken(env.FB_PAGE_TOKENS, row.page_id);
  if (!token) return failSend(db, command, messageId, 'FB_NOT_CONFIGURED');
  if (!parts.length) return failSend(db, command, messageId, 'INVALID_PAYLOAD');

  let firstMid = progress?.firstMid ?? null;
  for (let index = progress?.sentChunks ?? 0; index < parts.length; index += 1) {
    const outcome = await postMessage(token, row.external_thread_id, parts[index]!, delivery, messageId);
    if (!outcome.ok) return failSend(db, command, messageId, outcome.error);
    firstMid ??= outcome.mid;
    const recorded = await recordProgress(db, command, { sentChunks: index + 1, firstMid });
    if (!recorded && index + 1 < parts.length) return;
  }
  // The message reached Messenger, so it is sent even if this claim has meanwhile lost the command.
  await markMessageSent(db, messageId, firstMid);
  await completeCommand(db, command.id, command.attempts, { sent: true, parts: parts.length, externalMsgId: firstMid });
}
