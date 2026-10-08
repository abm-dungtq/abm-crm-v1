import { createHmac } from 'node:crypto';
import {
  BRIDGE_EVENTS_MAX, COMMAND_KINDS, bridgeEventSchema,
  type BridgeCommandResult, type BridgeEvent,
} from '@abm/contracts';
import { z } from 'zod';
import { CodedError, errorCode, silentLogger, type Logger } from './config';

/**
 * Client of the Worker's bridge API (ADR-008). Every request is signed:
 *   X-Bridge-Timestamp: Unix time in whole seconds
 *   X-Bridge-Signature: hex HMAC-SHA256(BRIDGE_SECRET, timestamp + "." + body); a GET signs timestamp + "."
 * The body is serialized once and that exact string is both signed and sent. No Origin header is sent.
 */

/** Hex HMAC-SHA256 of `timestamp.body`, as the Worker verifies it. */
export function signBridgeRequest(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
}

const claimedCommandSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(COMMAND_KINDS),
  channelAccountId: z.string().nullable(),
  conversationId: z.string().nullable(),
  payload: z.unknown(),
  attempts: z.number().int().positive(),
  leaseExpiresAt: z.string().optional(),
});
export type BridgeCommand = z.infer<typeof claimedCommandSchema>;
const pollResponseSchema = z.object({ ok: z.literal(true), data: z.array(claimedCommandSchema) });
const ingestResponseSchema = z.object({ ok: z.literal(true), data: z.object({ accepted: z.number(), rejected: z.number() }) });

/** Delays before the 2nd, 3rd and 4th attempt of a request that failed on the network or with a 5xx. */
export const RETRY_DELAYS_MS = [2000, 4000, 8000] as const;
/** Events kept in memory while the Worker is unreachable; the oldest are dropped beyond this. */
const MAX_PENDING_EVENTS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;

type SendOutcome = { kind: 'ok'; json: unknown } | { kind: 'retryable'; code: string } | { kind: 'rejected'; status: number };

export interface CrmClientOptions {
  baseUrl: string;
  secret: string;
  pollWaitSeconds: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Current time in milliseconds. */
  now?: () => number;
  log?: Logger;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class CrmClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly log: Logger;
  private readonly pending: BridgeEvent[] = [];
  /** Tail of the push chain: at most one pushEvents request is in flight. */
  private flushing: Promise<void> = Promise.resolve();

  constructor(private readonly options: CrmClientOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? silentLogger;
  }

  /** Number of events waiting to be delivered. */
  get pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Queues events and delivers them in batches of at most 100, one request at a time. A batch that fails on the
   * network, with a 5xx, or with 401/403 (a wrong secret or clock: the Worker never saw the events) is retried after
   * 2, 4 and 8 seconds, then kept for the next flush. A batch the Worker refuses as invalid (any other 4xx, such
   * as 422) is dropped. Events that do not match the contract are dropped here so they cannot sink a batch.
   */
  pushEvents(events: BridgeEvent[]): Promise<void> {
    for (const event of events) {
      const parsed = bridgeEventSchema.safeParse(event);
      if (!parsed.success) {
        this.log('error', 'event.invalid', { type: typeof event?.type === 'string' ? event.type : 'unknown' });
        continue;
      }
      this.pending.push(event);
    }
    const overflow = this.pending.length - MAX_PENDING_EVENTS;
    if (overflow > 0) {
      this.pending.splice(0, overflow);
      this.log('error', 'event.dropped_overflow', { count: overflow });
    }
    return this.flush();
  }

  /** Delivers queued events; resolves when this flush has finished (delivered or deferred). Never rejects. */
  flush(): Promise<void> {
    this.flushing = this.flushing.then(() => this.drain()).catch((error: unknown) => {
      this.log('error', 'events.flush_failed', { code: errorCode(error) });
    });
    return this.flushing;
  }

  private async drain(): Promise<void> {
    while (this.pending.length) {
      const batch = this.pending.slice(0, BRIDGE_EVENTS_MAX);
      const outcome = await this.withRetry(() => this.request('POST', '/api/bridge/events', JSON.stringify({ events: batch })));
      if (outcome.kind === 'retryable') {
        this.log('warn', 'events.deferred', { count: this.pending.length, code: outcome.code });
        return;
      }
      this.pending.splice(0, batch.length);
      if (outcome.kind === 'rejected') {
        this.log('error', 'events.refused', { count: batch.length, status: outcome.status });
        continue;
      }
      const parsed = ingestResponseSchema.safeParse(outcome.json);
      if (parsed.success && parsed.data.data.rejected > 0) {
        this.log('warn', 'events.rejected', { accepted: parsed.data.data.accepted, rejected: parsed.data.data.rejected });
      }
    }
  }

  /** Long-polls the Worker for bridge commands; throws a CodedError when the request fails. */
  async pollCommands(): Promise<BridgeCommand[]> {
    const wait = this.options.pollWaitSeconds;
    const outcome = await this.request('GET', `/api/bridge/commands?wait=${wait}`, '', wait * 1000 + REQUEST_TIMEOUT_MS);
    if (outcome.kind === 'retryable') throw new CodedError(outcome.code);
    if (outcome.kind === 'rejected') throw new CodedError(`CRM_HTTP_${outcome.status}`);
    const parsed = pollResponseSchema.safeParse(outcome.json);
    if (!parsed.success) throw new CodedError('CRM_BAD_RESPONSE');
    return parsed.data.data;
  }

  /**
   * Reports a command result. Network errors and 5xx are retried after 2, 4 and 8 seconds and then every 8 seconds
   * while `retryUntil` (epoch ms, normally the lease expiry) has not passed. A 4xx is final. A stale result is
   * answered with { ignored: true }, which counts as delivered. Returns true when the Worker accepted the request.
   */
  async postResult(id: string, result: BridgeCommandResult, retryUntil = 0): Promise<boolean> {
    const body = JSON.stringify(result);
    const path = `/api/bridge/commands/${encodeURIComponent(id)}/result`;
    let outcome = await this.withRetry(() => this.request('POST', path, body));
    while (outcome.kind === 'retryable' && this.now() + RETRY_DELAYS_MS[2] < retryUntil) {
      await this.sleep(RETRY_DELAYS_MS[2]);
      outcome = await this.request('POST', path, body);
    }
    if (outcome.kind === 'ok') return true;
    this.log('error', 'result.undelivered', {
      commandId: id, ...(outcome.kind === 'rejected' ? { status: outcome.status } : { code: outcome.code }),
    });
    return false;
  }

  private async withRetry(send: () => Promise<SendOutcome>): Promise<SendOutcome> {
    let outcome = await send();
    for (const delay of RETRY_DELAYS_MS) {
      if (outcome.kind !== 'retryable') break;
      await this.sleep(delay);
      outcome = await send();
    }
    return outcome;
  }

  private async request(method: 'GET' | 'POST', path: string, body: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<SendOutcome> {
    const timestamp = String(Math.floor(this.now() / 1000));
    const headers: Record<string, string> = {
      'X-Bridge-Timestamp': timestamp,
      'X-Bridge-Signature': signBridgeRequest(this.options.secret, timestamp, body),
    };
    if (method === 'POST') headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
        method, headers, body: method === 'POST' ? body : undefined, signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return { kind: 'retryable', code: errorCode(error) === 'TimeoutError' ? 'CRM_TIMEOUT' : 'CRM_NETWORK' };
    }
    if (response.status >= 500) {
      await response.body?.cancel().catch(() => {});
      return { kind: 'retryable', code: `CRM_HTTP_${response.status}` };
    }
    // Authentication failed: nothing was processed, and it lasts until an operator fixes the secret or the clock.
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => {});
      this.log('error', 'crm.auth_failed', { code: 'CRM_AUTH', status: response.status, path: path.split('?')[0] });
      return { kind: 'retryable', code: 'CRM_AUTH' };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { kind: 'rejected', status: response.status };
    }
    try {
      return { kind: 'ok', json: await response.json() };
    } catch {
      return { kind: 'ok', json: null };
    }
  }
}
