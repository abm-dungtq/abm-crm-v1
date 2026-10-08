import type { Env } from '../env';
import { LarkError, sendText, sendToChat } from '../lark';
import { claimCommands, completeCommand, failCommand, type ClaimedCommand } from './dispatcher';

type WorkerCommandEnv = Pick<Env, 'DB' | 'LARK_APP_ID' | 'LARK_APP_SECRET' | 'LARK_INBOX_CHAT_ID'>;

const CLAIM_LIMIT = 20;

async function runCommand(env: WorkerCommandEnv, command: ClaimedCommand) {
  const db = env.DB;
  if (command.kind !== 'send_lark') return failCommand(db, command.id, command.attempts, 'UNSUPPORTED_COMMAND');
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
    return failCommand(db, command.id, command.attempts, error instanceof LarkError ? error.message : 'LARK_SEND_FAILED');
  }
  return completeCommand(db, command.id, command.attempts, { sent: true });
}

/**
 * Runs due commands addressed to the Worker (ADR-010). Every claimed command ends completed or failed;
 * a failed one is retried later by its backoff. It never throws, so it is safe to run in the background.
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
