import type { Env } from '../env';
import { BOT_OFF, BOT_SEND_BLOCKED_SQL, markMessageSent } from './conversation-flow';
import { MAX_COMMAND_ATTEMPTS, completeCommand, dropBotSend, failCommand, type ClaimedCommand } from './dispatcher';
import { accessToken, recordZaloOaRefreshFailure, refreshZaloOaAccount } from './zalo-oa-oauth';

/**
 * Sends `send_zalo_oa` commands through the OA Customer Service API. The access token travels in the
 * `access_token` header and is never written to a result or a log. Text is split at the last newline
 * or space before 2000 characters.
 */

export const ZALO_OA_TEXT_MAX = 2000;
const SEND_URL = 'https://openapi.zalo.me/v3.0/oa/message/cs';
export const ZALO_OA_OUTSIDE_WINDOW = 'ZALO_OA_OUTSIDE_WINDOW';
export const ZALO_OA_NOT_CONFIGURED = 'ZALO_OA_NOT_CONFIGURED';
/** Zalo codes that will not succeed on a retry: the user is outside the care window or blocked. */
const OUTSIDE_CODES = new Set([-213, -217, -227, -230, -232]);

/** The stored error keeps the raw Zalo code, for example `ZALO_OA_OUTSIDE_WINDOW:-213`. */
const outsideWindowError = (code: number) => `${ZALO_OA_OUTSIDE_WINDOW}:${code}`;
/** Staff see this in the thread. The code is the same string stored on the command. */
const outsideWindowNote = (error: string) => `Quá thời hạn trả lời của Zalo OA (${error})`;

type ZaloOaSendEnv = Pick<Env, 'DB' | 'ZALO_OA_APP_ID' | 'ZALO_OA_APP_SECRET' | 'ZALO_OA_TOKEN_KEY'>;

/**
 * Splits text into OA-sized parts at the last newline or space in the window. A window with no break
 * is cut at the limit. The break character itself is kept in neither part. Whitespace-only parts are dropped.
 */
export function splitZaloOaText(text: string, max = ZALO_OA_TEXT_MAX): string[] {
  const parts: string[] = [];
  let chars = Array.from(text);
  while (chars.length > 0) {
    if (chars.length <= max) {
      const last = chars.join('');
      if (last.trim()) parts.push(last);
      break;
    }
    let cut = -1;
    for (let i = max - 1; i >= 0; i -= 1) {
      const ch = chars[i];
      if (ch === '\n' || ch === ' ') { cut = i; break; }
    }
    const take = cut <= 0 ? max : cut;
    const part = chars.slice(0, take).join('');
    if (part.trim()) parts.push(part);
    chars = chars.slice(cut <= 0 ? max : cut + 1);
  }
  return parts;
}

interface SendProgress { sentChunks: number; firstMid: string | null }

function readProgress(payload: unknown): SendProgress | null {
  const { sentChunks, firstMid } = (payload ?? {}) as { sentChunks?: unknown; firstMid?: unknown };
  if (typeof sentChunks !== 'number' || !Number.isInteger(sentChunks) || sentChunks < 1) return null;
  return { sentChunks, firstMid: typeof firstMid === 'string' ? firstMid : null };
}

async function recordProgress(db: D1Database, command: ClaimedCommand, progress: SendProgress): Promise<boolean> {
  const res = await db.prepare(`UPDATE channel_command
      SET payload_json = json_set(payload_json, '$.sentChunks', ?1, '$.firstMid', ?2), updated_at = ?3
    WHERE id = ?4 AND status = 'claimed' AND attempts = ?5
      AND COALESCE(json_extract(payload_json, '$.sentChunks'), 0) < ?1`)
    .bind(progress.sentChunks, progress.firstMid, new Date().toISOString(), command.id, command.attempts)
    .run();
  return res.meta.changes === 1;
}

const markFailed = (db: D1Database, messageId: string) =>
  db.prepare("UPDATE message SET status = 'failed' WHERE id = ? AND status = 'pending'").bind(messageId);

async function failSend(db: D1Database, command: ClaimedCommand, messageId: string | null, error: string) {
  const moved = await failCommand(db, command.id, command.attempts, error);
  if (moved && command.attempts >= MAX_COMMAND_ATTEMPTS && messageId) await markFailed(db, messageId).run();
}

type PostOutcome =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string; tokenRejected?: boolean; outside?: boolean };

interface CsReply { error?: unknown; message_id?: unknown; data?: { message_id?: unknown } }

async function postText(token: string, userId: string, text: string): Promise<PostOutcome> {
  let res: Response;
  try {
    res = await fetch(SEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', access_token: token },
      body: JSON.stringify({ recipient: { user_id: userId }, message: { text } }),
    });
  } catch {
    return { ok: false, error: 'ZALO_OA_NETWORK' };
  }
  const payload = await res.json().catch(() => null) as CsReply | null;
  const code = typeof payload?.error === 'number' ? payload.error : null;
  if (res.status === 401 || code === -216) return { ok: false, error: 'ZALO_-216', tokenRejected: true };
  if (code !== null && OUTSIDE_CODES.has(code)) return { ok: false, error: outsideWindowError(code), outside: true };
  if (!payload || !res.ok || (code !== null && code !== 0)) {
    return { ok: false, error: code !== null ? `ZALO_${code}` : `ZALO_HTTP_${res.status}` };
  }
  const mid = payload.data?.message_id ?? payload.message_id;
  return { ok: true, messageId: typeof mid === 'string' ? mid : null };
}

interface SendRow {
  status: string; body: string; conversation_id: string; external_thread_id: string;
  channel: string; account_id: string; send_paused: number; bot_blocked: number;
}

/**
 * Runs one claimed `send_zalo_oa` command. A retry after a lost lease sends only the parts not yet
 * recorded in `sentChunks`. An expired token is refreshed once per run and the same part is tried again.
 */
export async function sendZaloOaCommand(env: ZaloOaSendEnv, command: ClaimedCommand): Promise<void> {
  const db = env.DB;
  const messageId = (command.payload as { messageId?: unknown } | null)?.messageId;
  if (typeof messageId !== 'string' || !messageId) return failSend(db, command, null, 'INVALID_PAYLOAD');
  const row = await db.prepare(`SELECT m.status, m.body, m.conversation_id, c.external_thread_id, a.channel,
      a.id AS account_id, a.send_paused, (${BOT_SEND_BLOCKED_SQL}) AS bot_blocked
    FROM message m JOIN conversation c ON c.id = m.conversation_id JOIN channel_account a ON a.id = c.channel_account_id
    WHERE m.id = ? AND m.direction = 'out'`).bind(messageId).first<SendRow>();
  if (!row || row.channel !== 'zalo_oa') return failSend(db, command, messageId, 'INVALID_PAYLOAD');
  const progress = readProgress(command.payload);
  const parts = splitZaloOaText(row.body);
  const unsentParts = progress !== null && progress.sentChunks < parts.length;
  if (row.status === 'failed' || (row.status === 'sent' && !unsentParts)) {
    await completeCommand(db, command.id, command.attempts, { sent: row.status === 'sent' });
    return;
  }
  if (row.bot_blocked === 1) {
    await dropBotSend(db, command, BOT_OFF);
    return;
  }
  if (row.send_paused === 1) return failSend(db, command, messageId, 'ACCOUNT_PAUSED');
  if (!parts.length) return failSend(db, command, messageId, 'INVALID_PAYLOAD');

  let refreshedThisRun = false;
  let token = await accessToken(db, env, row.account_id);
  if (!token) {
    refreshedThisRun = true;
    const outcome = await refreshZaloOaAccount(db, env, row.account_id);
    if (outcome === 'failed') await recordZaloOaRefreshFailure(db, row.account_id);
    token = outcome === 'failed' ? null : await accessToken(db, env, row.account_id);
    if (!token) return failSend(db, command, messageId, ZALO_OA_NOT_CONFIGURED);
  }

  let firstMid = progress?.firstMid ?? null;
  for (let index = progress?.sentChunks ?? 0; index < parts.length; index += 1) {
    let outcome = await postText(token, row.external_thread_id, parts[index]!);
    if (!outcome.ok && outcome.tokenRejected && !refreshedThisRun) {
      refreshedThisRun = true;
      const refreshed = await refreshZaloOaAccount(db, env, row.account_id);
      if (refreshed === 'failed') {
        await recordZaloOaRefreshFailure(db, row.account_id);
        return failSend(db, command, messageId, 'ZALO_OA_REFRESH_FAILED');
      }
      const next = await accessToken(db, env, row.account_id);
      if (!next) return failSend(db, command, messageId, ZALO_OA_NOT_CONFIGURED);
      token = next;
      outcome = await postText(token, row.external_thread_id, parts[index]!);
    }
    if (!outcome.ok && outcome.outside) {
      if (!(await failCommand(db, command.id, command.attempts, outcome.error, new Date(), true))) return;
      await db.batch([
        markFailed(db, messageId),
        db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, body, status, created_at)
          VALUES (?, ?, 'out', 'system', ?, 'failed', ?)`).bind(
          crypto.randomUUID(), row.conversation_id, outsideWindowNote(outcome.error), new Date().toISOString(),
        ),
      ]);
      return;
    }
    if (!outcome.ok) return failSend(db, command, messageId, outcome.error);
    firstMid ??= outcome.messageId;
    const recorded = await recordProgress(db, command, { sentChunks: index + 1, firstMid });
    if (!recorded && index + 1 < parts.length) return;
  }
  await markMessageSent(db, messageId, firstMid);
  await completeCommand(db, command.id, command.attempts, { sent: true, parts: parts.length, externalMsgId: firstMid });
}
