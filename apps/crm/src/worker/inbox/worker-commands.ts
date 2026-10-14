import type { Env } from '../env';
import { LarkError, sendText, sendToChat } from '../lark';
import { claimCommands, completeCommand, failCommand, type ClaimedCommand } from './dispatcher';
import { sendMessengerCommand } from './facebook-send';
import { sendZaloOaCommand } from './zalo-oa-send';

type WorkerCommandEnv = Pick<Env, 'DB' | 'LARK_APP_ID' | 'LARK_APP_SECRET' | 'LARK_INBOX_CHAT_ID' | 'FB_PAGE_TOKENS' | 'ZALO_OA_APP_ID' | 'ZALO_OA_APP_SECRET' | 'ZALO_OA_TOKEN_KEY'>;

const CLAIM_LIMIT = 20;

async function runLarkCommand(env: WorkerCommandEnv, command: ClaimedCommand) {
  const db = env.DB;
  // `openId` sends a private message to one user; without it the notice goes to the inbox group.
  const { text, openId } = (command.payload ?? {}) as { text?: unknown; openId?: unknown };
  if (openId !== undefined && (typeof openId !== 'string' || !openId)) return failCommand(db, command.id, command.attempts, 'INVALID_PAYLOAD');
  const chatId = env.LARK_INBOX_CHAT_ID;
  if (openId === undefined && !chatId) return failCommand(db, command.id, command.attempts, 'LARK_NOT_CONFIGURED');
  if (typeof text !== 'string' || !text) return failCommand(db, command.id, command.attempts, 'INVALID_PAYLOAD');
  try {
    if (typeof openId === 'string') await sendText(env, openId, text);
    else if (chatId) await sendToChat(env, chatId, text);
  } catch (error) {
    if (error instanceof LarkError && /\bcode 230013\b/.test(error.message)) {
      const now = new Date();
      if (typeof openId === 'string') {
        const nowIso = now.toISOString();
        const user = await db.prepare('SELECT id, lark_link_status FROM app_user WHERE lark_open_id = ?')
          .bind(openId).first<{ id: string; lark_link_status: string | null }>();
        if (user) {
          await db.batch([
            db.prepare(`UPDATE app_user SET lark_link_status = 'error', lark_checked_at = ?, updated_at = ?, version = version + 1 WHERE id = ?`)
              .bind(nowIso, nowIso, user.id),
            db.prepare(`INSERT INTO audit_log (id, actor_user_id, actor_kind, command, entity, entity_id, before_json, after_json, created_at)
              VALUES (?, NULL, 'system', 'lark.send', 'app_user', ?, ?, ?, ?)`)
              .bind(
                crypto.randomUUID(),
                user.id,
                JSON.stringify({ lark_link_status: user.lark_link_status }),
                JSON.stringify({ lark_link_status: 'error', reason: '230013' }),
                nowIso,
              ),
          ]);
        }
      }
      return failCommand(db, command.id, command.attempts, error.message, now, true);
    }
    return failCommand(db, command.id, command.attempts, error instanceof LarkError ? error.message : 'LARK_SEND_FAILED');
  }
  return completeCommand(db, command.id, command.attempts, { sent: true });
}

async function runCommand(env: WorkerCommandEnv, command: ClaimedCommand) {
  if (command.kind === 'send_lark') return runLarkCommand(env, command);
  if (command.kind === 'send_messenger') return sendMessengerCommand(env, command);
  if (command.kind === 'send_zalo_oa') return sendZaloOaCommand(env, command);
  return failCommand(env.DB, command.id, command.attempts, 'UNSUPPORTED_COMMAND');
}

/**
 * Runs due commands addressed to the Worker (ADR-010): Lark notices and Messenger sends. Every claimed command
 * ends completed or failed; a failed one is retried later by its backoff. It never throws, so it is safe to
 * run in the background.
 */
export async function processWorkerCommands(env: WorkerCommandEnv): Promise<void> {
  let commands: ClaimedCommand[];
  try {
    commands = await claimCommands(env.DB, 'worker', CLAIM_LIMIT);
  } catch (error) {
    console.error('worker_command_claim_error', error instanceof Error ? error.message : 'unknown');
    return;
  }
  for (const command of commands) {
    try {
      await runCommand(env, command);
    } catch (error) {
      console.error('worker_command_error', command.kind, error instanceof Error ? error.message : 'unknown');
      try {
        await failCommand(env.DB, command.id, command.attempts, 'INTERNAL');
      } catch {
        // The lease expires and the command is claimed again later.
      }
    }
  }
}
