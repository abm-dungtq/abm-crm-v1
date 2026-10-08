import type { Env } from '../env';
import { LarkError, sendToChat } from '../lark';
import { claimCommands, completeCommand, failCommand, type ClaimedCommand } from './dispatcher';

type WorkerCommandEnv = Pick<Env, 'DB' | 'LARK_APP_ID' | 'LARK_APP_SECRET' | 'LARK_INBOX_CHAT_ID'>;

const CLAIM_LIMIT = 20;

async function runCommand(env: WorkerCommandEnv, command: ClaimedCommand) {
  const db = env.DB;
  if (command.kind !== 'send_lark') return failCommand(db, command.id, command.attempts, 'UNSUPPORTED_COMMAND');
  if (!env.LARK_INBOX_CHAT_ID) return failCommand(db, command.id, command.attempts, 'LARK_NOT_CONFIGURED');
  const text = (command.payload as { text?: unknown } | null)?.text;
  if (typeof text !== 'string' || !text) return failCommand(db, command.id, command.attempts, 'INVALID_PAYLOAD');
  try {
    await sendToChat(env, env.LARK_INBOX_CHAT_ID, text);
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
