import type { Env, Sink } from '../env';
import { claimCommands, failCommand, type ClaimedCommand } from './dispatcher';
import { sendMessengerCommand } from './facebook-send';
import { sendZaloOaCommand } from './zalo-oa-send';

type WorkerCommandEnv = Pick<Env, 'DB' | 'MEDIA' | 'FB_PAGE_TOKENS' | 'ZALO_OA_APP_ID' | 'ZALO_OA_APP_SECRET' | 'ZALO_OA_TOKEN_KEY'>;

const CLAIM_LIMIT = 20;

async function runCommand(env: WorkerCommandEnv, command: ClaimedCommand, sink: Sink) {
  if (command.kind === 'send_messenger') return sendMessengerCommand(env, command);
  if (command.kind === 'send_zalo_oa') return sendZaloOaCommand(env, command, sink);
  return failCommand(env.DB, command.id, command.attempts, 'UNSUPPORTED_COMMAND');
}

/**
 * Runs due commands addressed to the Worker (ADR-010): Messenger and Zalo OA sends. Every claimed command
 * ends completed or failed; a failed one is retried later by its backoff. It never throws, so it is safe to
 * run in the background. `sink` carries the request or cron context, so an inbox notice raised while sending
 * (an OA token that cannot be refreshed) is relayed live instead of being dropped with the response.
 */
export async function processWorkerCommands(env: WorkerCommandEnv, sink: Sink): Promise<void> {
  let commands: ClaimedCommand[];
  try {
    commands = await claimCommands(env.DB, 'worker', CLAIM_LIMIT);
  } catch (error) {
    console.error('worker_command_claim_error', error instanceof Error ? error.message : 'unknown');
    return;
  }
  for (const command of commands) {
    try {
      await runCommand(env, command, sink);
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
