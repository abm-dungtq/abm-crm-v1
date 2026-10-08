import type { BridgeCommandResult } from '@abm/contracts';
import { z } from 'zod';
import { CodedError, errorCode, silentLogger, type Logger } from './config';
import type { BridgeCommand } from './crm-client';
import type { CompletionRequest } from './goclaw-client';
import type { ThreadKind } from './zalo-client';

/**
 * Executes bridge commands. Commands of one conversation run strictly one after another (never two GoClaw runs
 * or sends for the same conversation at once); commands without a conversation start right away.
 * The runner makes no business decisions: it runs what the Worker queued and reports the outcome.
 */

export const MAX_CHUNK_CHARS = 2000;
const MAX_RESULT_TEXT = 20_000;
const MAX_ERROR_CHARS = 2000;
/** Pause after a failed poll before polling again. */
const POLL_ERROR_DELAY_MS = 5000;

const completionPayload = z.object({ agentKey: z.string().min(1), userId: z.string().min(1), text: z.string() });
const sendPayload = z.object({ threadId: z.string().min(1), threadKind: z.enum(['direct', 'group']), text: z.string() });
const sessionPayload = z.object({ accountId: z.string().min(1) }).partial();

export interface RunnerCrm {
  pollCommands(): Promise<BridgeCommand[]>;
  postResult(id: string, result: BridgeCommandResult, retryUntil?: number): Promise<boolean>;
}
export interface RunnerGoClaw {
  complete(request: CompletionRequest): Promise<string>;
}
export interface RunnerAccounts {
  login(accountId: string): Promise<void>;
  logout(accountId: string): Promise<void>;
  send(accountId: string, threadId: string, threadKind: ThreadKind, text: string, commandId: string): Promise<{ msgId: string }>;
}

export interface CommandRunnerOptions {
  crm: RunnerCrm;
  goclaw: RunnerGoClaw;
  accounts: RunnerAccounts;
  sendMinDelayMs: number;
  sendMaxDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  log?: Logger;
}

type Outcome = Omit<BridgeCommandResult, 'attempts'>;

/**
 * Splits text into chunks of at most `max` characters at line boundaries. The newline where a chunk ends is the
 * boundary and belongs to neither chunk; nothing else is trimmed, so every chunk is whole lines of the original.
 * A single line longer than `max` is cut hard (never inside a surrogate pair). Whitespace-only chunks are dropped.
 */
export function splitIntoChunks(text: string, max = MAX_CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let current: string | null = null;
  const flush = () => {
    if (current !== null && current.trim()) chunks.push(current);
    current = null;
  };
  for (let line of text.split('\n')) {
    if (current !== null && current.length + 1 + line.length <= max) {
      current += `\n${line}`;
      continue;
    }
    flush();
    while (line.length > max) {
      let cut = max;
      const code = line.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
      chunks.push(line.slice(0, cut));
      line = line.slice(cut);
    }
    current = line;
  }
  flush();
  return chunks;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class CommandRunner {
  private readonly queues = new Map<string, Promise<void>>();
  /** Commands queued or running, with the attempts of their latest claim. */
  private readonly inFlight = new Map<string, BridgeCommand>();
  private readonly running = new Set<Promise<void>>();
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly log: Logger;

  constructor(private readonly options: CommandRunnerOptions) {
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    this.log = options.log ?? silentLogger;
  }

  /** Polls and dispatches until `signal` aborts. Poll errors are logged and retried after a pause. */
  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      let commands: BridgeCommand[];
      try {
        commands = await this.options.crm.pollCommands();
      } catch (error) {
        this.log('warn', 'commands.poll_failed', { code: errorCode(error) });
        if (!signal.aborted) await this.sleep(POLL_ERROR_DELAY_MS);
        continue;
      }
      if (signal.aborted) break;
      for (const command of commands) this.dispatch(command);
    }
  }

  /**
   * Queues a command behind earlier commands of the same conversation. A command already queued or running
   * (claimed again after its lease ran out) is not run twice; its result is reported with the newest attempts.
   */
  dispatch(command: BridgeCommand): void {
    const known = this.inFlight.get(command.id);
    if (known) {
      known.attempts = Math.max(known.attempts, command.attempts);
      known.leaseExpiresAt = command.leaseExpiresAt;
      return;
    }
    const tracked = { ...command };
    this.inFlight.set(command.id, tracked);
    const key = command.conversationId;
    const previous = key ? this.queues.get(key) ?? Promise.resolve() : Promise.resolve();
    const task = previous.then(() => this.execute(tracked)).finally(() => {
      this.inFlight.delete(command.id);
      this.running.delete(task);
      if (key && this.queues.get(key) === task) this.queues.delete(key);
    });
    this.running.add(task);
    if (key) this.queues.set(key, task);
  }

  /** Resolves when every dispatched command has finished. */
  async idle(): Promise<void> {
    while (this.running.size) await Promise.allSettled([...this.running]);
  }

  private async execute(command: BridgeCommand): Promise<void> {
    let outcome: Outcome;
    try {
      outcome = await this.perform(command);
    } catch (error) {
      outcome = { ok: false, error: errorCode(error) };
    }
    if (outcome.error) outcome.error = outcome.error.slice(0, MAX_ERROR_CHARS);
    this.log(outcome.ok ? 'info' : 'warn', 'command.done', {
      commandId: command.id, kind: command.kind, attempts: command.attempts, ok: outcome.ok, code: outcome.error,
    });
    const leaseEnd = command.leaseExpiresAt ? Date.parse(command.leaseExpiresAt) : NaN;
    await this.options.crm.postResult(command.id, { attempts: command.attempts, ...outcome }, Number.isFinite(leaseEnd) ? leaseEnd : 0);
  }

  private async perform(command: BridgeCommand): Promise<Outcome> {
    switch (command.kind) {
      case 'run_completion': {
        const payload = completionPayload.safeParse(command.payload);
        if (!payload.success) return { ok: false, error: 'INVALID_PAYLOAD' };
        const text = await this.options.goclaw.complete(payload.data);
        return { ok: true, text: text.slice(0, MAX_RESULT_TEXT) };
      }
      case 'send_zalo':
        return this.sendZalo(command);
      case 'zalo_login':
      case 'zalo_logout': {
        const accountId = this.sessionAccountId(command);
        if (command.kind === 'zalo_login') await this.options.accounts.login(accountId);
        else await this.options.accounts.logout(accountId);
        return { ok: true };
      }
      default:
        return { ok: false, error: 'UNSUPPORTED_COMMAND' };
    }
  }

  private sessionAccountId(command: BridgeCommand): string {
    const payload = sessionPayload.safeParse(command.payload ?? {});
    const accountId = (payload.success ? payload.data.accountId : undefined) ?? command.channelAccountId;
    if (!accountId) throw new CodedError('INVALID_PAYLOAD');
    return accountId;
  }

  private async sendZalo(command: BridgeCommand): Promise<Outcome> {
    const payload = sendPayload.safeParse(command.payload);
    if (!payload.success || !command.channelAccountId) return { ok: false, error: 'INVALID_PAYLOAD' };
    const chunks = splitIntoChunks(payload.data.text);
    if (!chunks.length) return { ok: false, error: 'EMPTY_TEXT' };
    const { sendMinDelayMs: min, sendMaxDelayMs: max } = this.options;
    let firstMsgId: string | undefined;
    for (const [index, chunk] of chunks.entries()) {
      await this.sleep(min + Math.floor(this.random() * (max - min + 1)));
      try {
        const { msgId } = await this.options.accounts.send(command.channelAccountId, payload.data.threadId, payload.data.threadKind, chunk, command.id);
        firstMsgId ??= msgId;
      } catch (error) {
        // Name a failure after some chunks went out, so a duplicate on retry can be traced.
        if (index > 0) return { ok: false, error: `${errorCode(error)}:PARTIAL_${index}_OF_${chunks.length}` };
        throw error;
      }
    }
    return { ok: true, externalMsgId: firstMsgId };
  }
}
