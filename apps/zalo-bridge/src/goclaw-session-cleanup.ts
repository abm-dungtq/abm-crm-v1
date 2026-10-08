import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { CodedError, errorCode, silentLogger, type Logger } from './config';

/**
 * Removes the GoClaw sessions of stateless runs (CRM extraction, group summaries). Each such run uses a fresh
 * X-GoClaw-User-Id, so its session is never reused. GoClaw lets an operator-scoped API key list and delete only
 * the sessions of the user id it connected as, so the bridge remembers every stateless user id it ran and, once a
 * day at 03:00 Vietnam time, connects to the gateway WebSocket as each id older than 24 hours and deletes that
 * user's sessions. An id whose cleanup fails is kept for the next run, and given up after 7 days.
 *
 * Wire protocol (GoClaw gateway v3, /ws): requests {type:'req', id, method, params}, responses
 * {type:'res', id, ok, payload?, error?}. First request: connect {token, user_id}. An API key bound to an owner
 * replaces user_id with the owner id; that is detected from the connect response and stops the whole run.
 */

export const STATELESS_USER_PREFIXES = ['crm-extract:', 'group-summary:'] as const;
export const MIN_AGE_MS = 24 * 60 * 60_000;
export const MAX_AGE_MS = 7 * 24 * 60 * 60_000;
/** Vietnam is UTC+7 all year: 03:00 there is 20:00 UTC. */
const RUN_HOUR_UTC = 20;
const REQUEST_TIMEOUT_MS = 15_000;
const LIST_PAGE = 100;
const MAX_PAGES = 20;

/** The subset of the WHATWG WebSocket the cleanup uses; Node 22 provides it as a global. */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'close' | 'error', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}
export type WebSocketFactory = (url: string) => WebSocketLike;

const storeSchema = z.object({ version: z.literal(1), users: z.record(z.string(), z.object({ ranAt: z.string() })) });
const responseSchema = z.object({
  type: z.literal('res'),
  id: z.string(),
  ok: z.boolean(),
  payload: z.unknown().optional(),
  error: z.object({ code: z.string().optional() }).passthrough().nullish(),
});
const connectPayload = z.object({ user_id: z.string().optional() }).passthrough();
const listPayload = z.object({ sessions: z.array(z.object({ key: z.string(), userID: z.string().optional() }).passthrough()).nullable() }).passthrough();

export function isStatelessUserId(userId: string): boolean {
  return STATELESS_USER_PREFIXES.some((prefix) => userId.startsWith(prefix) && userId.length > prefix.length);
}

/** Milliseconds from `now` to the next 03:00 Asia/Saigon. */
export function msUntilNextRun(now: Date): number {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), RUN_HOUR_UTC));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

/** ws(s)://host/ws of the gateway whose OpenAI-compatible base is e.g. http://127.0.0.1:18790/v1. */
export function gatewayWsUrl(goclawBaseUrl: string): string {
  const url = new URL(goclawBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws';
  url.search = '';
  url.hash = '';
  return url.toString();
}

/** One authenticated gateway connection; requests are answered by id. */
class GatewayConnection {
  private readonly waiting = new Map<string, { resolve: (frame: z.infer<typeof responseSchema>) => void; reject: (e: Error) => void }>();
  private closedError: CodedError | null = null;

  private constructor(private readonly ws: WebSocketLike) {
    ws.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      let json: unknown;
      try {
        json = JSON.parse(event.data);
      } catch {
        return;
      }
      const frame = responseSchema.safeParse(json);
      if (!frame.success) return; // events and unrelated frames
      const waiter = this.waiting.get(frame.data.id);
      if (!waiter) return;
      this.waiting.delete(frame.data.id);
      waiter.resolve(frame.data);
    });
    const fail = () => {
      this.closedError ??= new CodedError('GOCLAW_WS_CLOSED');
      for (const waiter of this.waiting.values()) waiter.reject(this.closedError);
      this.waiting.clear();
    };
    ws.addEventListener('close', fail);
    ws.addEventListener('error', fail);
  }

  static open(factory: WebSocketFactory, url: string): Promise<GatewayConnection> {
    return new Promise((resolve, reject) => {
      let ws: WebSocketLike;
      try {
        ws = factory(url);
      } catch {
        reject(new CodedError('GOCLAW_WS_CONNECT_FAILED'));
        return;
      }
      let settled = false;
      const timer = setTimeout(() => finish(new CodedError('GOCLAW_WS_TIMEOUT')), REQUEST_TIMEOUT_MS);
      const finish = (error: CodedError | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          ws.close();
          reject(error);
        } else {
          resolve(new GatewayConnection(ws));
        }
      };
      ws.addEventListener('open', () => finish(null));
      ws.addEventListener('error', () => finish(new CodedError('GOCLAW_WS_CONNECT_FAILED')));
      ws.addEventListener('close', () => finish(new CodedError('GOCLAW_WS_CONNECT_FAILED')));
    });
  }

  /** Sends a request and resolves with its payload; a refused request rejects with GOCLAW_RPC_<code>. */
  request(method: string, params: unknown): Promise<unknown> {
    if (this.closedError) return Promise.reject(this.closedError);
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new CodedError('GOCLAW_WS_TIMEOUT'));
      }, REQUEST_TIMEOUT_MS);
      this.waiting.set(id, {
        resolve: (frame) => {
          clearTimeout(timer);
          if (frame.ok) resolve(frame.payload);
          else reject(new CodedError(`GOCLAW_RPC_${(frame.error?.code ?? 'ERROR').slice(0, 60)}`));
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.ws.send(JSON.stringify({ type: 'req', id, method, params }));
    });
  }

  close() {
    this.closedError ??= new CodedError('GOCLAW_WS_CLOSED');
    this.ws.close();
  }
}

export interface SessionCleanupOptions {
  wsUrl: string;
  apiKey: string;
  /** JSON file holding the stateless user ids still to clean up. */
  file: string;
  webSocket?: WebSocketFactory;
  now?: () => Date;
  log?: Logger;
}

export interface CleanupSummary { users: number; sessions: number; failed: number; dropped: number }

export class GoClawSessionCleanup {
  private users = new Map<string, { ranAt: string }>();
  private readonly webSocket: WebSocketFactory;
  private readonly now: () => Date;
  private readonly log: Logger;
  private writing: Promise<void> = Promise.resolve();
  private running: Promise<CleanupSummary> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: SessionCleanupOptions) {
    this.webSocket = options.webSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? silentLogger;
  }

  /** Reads the saved ids; a missing file means none, an unreadable one is logged and treated as none. */
  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.options.file, 'utf8');
    } catch {
      return;
    }
    try {
      this.users = new Map(Object.entries(storeSchema.parse(JSON.parse(raw)).users));
    } catch {
      this.log('error', 'goclaw_cleanup.store_invalid', {});
    }
  }

  /** Number of ids waiting for cleanup. */
  get pendingCount(): number {
    return this.users.size;
  }

  /** Remembers a stateless user id that just ran; other ids are ignored. Never rejects. */
  record(userId: string): Promise<void> {
    if (!isStatelessUserId(userId)) return Promise.resolve();
    this.users.set(userId, { ranAt: this.now().toISOString() });
    return this.persist();
  }

  /** Runs the daily cleanup at 03:00 Asia/Saigon until stop(). */
  start(): void {
    if (this.timer) return;
    const schedule = () => {
      this.timer = setTimeout(() => {
        void this.runOnce().finally(schedule);
      }, msUntilNextRun(this.now()));
    };
    schedule();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Cleans every id older than 24 hours; concurrent calls share one run. */
  runOnce(): Promise<CleanupSummary> {
    this.running ??= this.cleanAll().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async cleanAll(): Promise<CleanupSummary> {
    const summary: CleanupSummary = { users: 0, sessions: 0, failed: 0, dropped: 0 };
    const now = this.now().getTime();
    for (const [userId, entry] of [...this.users]) {
      const ranAt = Date.parse(entry.ranAt);
      const age = Number.isFinite(ranAt) ? now - ranAt : Infinity;
      if (age < MIN_AGE_MS) continue;
      try {
        summary.sessions += await this.cleanUser(userId);
        summary.users += 1;
        this.forget(userId, entry);
      } catch (error) {
        const code = errorCode(error);
        if (code === 'GOCLAW_KEY_OWNER_BOUND') {
          // Every id would fail the same way; nothing can be cleaned with this key.
          this.log('error', 'goclaw_cleanup.key_owner_bound', {});
          summary.failed += 1;
          break;
        }
        if (age > MAX_AGE_MS) {
          this.forget(userId, entry);
          summary.dropped += 1;
        } else {
          summary.failed += 1;
        }
        this.log('warn', 'goclaw_cleanup.user_failed', { code, dropped: age > MAX_AGE_MS });
      }
    }
    await this.persist();
    this.log('info', 'goclaw_cleanup.done', { ...summary, pending: this.users.size });
    return summary;
  }

  /** Removes the id unless it ran again meanwhile. */
  private forget(userId: string, entry: { ranAt: string }) {
    if (this.users.get(userId)?.ranAt === entry.ranAt) this.users.delete(userId);
  }

  /** Connects as `userId`, deletes that user's sessions and returns how many were deleted. */
  private async cleanUser(userId: string): Promise<number> {
    const connection = await GatewayConnection.open(this.webSocket, this.options.wsUrl);
    try {
      const connected = connectPayload.safeParse(await connection.request('connect', { token: this.options.apiKey, user_id: userId }));
      if (!connected.success) throw new CodedError('GOCLAW_BAD_RESPONSE');
      if (connected.data.user_id !== undefined && connected.data.user_id !== userId) throw new CodedError('GOCLAW_KEY_OWNER_BOUND');
      let deleted = 0;
      for (let page = 0; page < MAX_PAGES; page++) {
        const listed = listPayload.safeParse(await connection.request('sessions.list', { limit: LIST_PAGE, offset: 0 }));
        if (!listed.success) throw new CodedError('GOCLAW_BAD_RESPONSE');
        // Only this user's sessions, even if the key could see more.
        const keys = (listed.data.sessions ?? []).filter((s) => s.userID === userId).map((s) => s.key);
        if (!keys.length) break;
        for (const key of keys) {
          await connection.request('sessions.delete', { key });
          deleted += 1;
        }
        if (keys.length < LIST_PAGE) break;
      }
      return deleted;
    } finally {
      connection.close();
    }
  }

  /** Writes the ids atomically; writes are serialized. Never rejects. */
  private persist(): Promise<void> {
    this.writing = this.writing.then(async () => {
      const body = JSON.stringify({ version: 1, users: Object.fromEntries(this.users) });
      const tmp = `${this.options.file}.${process.pid}.tmp`;
      await mkdir(dirname(this.options.file), { recursive: true });
      await writeFile(tmp, body, { encoding: 'utf8', mode: 0o600 });
      await rename(tmp, this.options.file);
    }).catch((error: unknown) => {
      this.log('error', 'goclaw_cleanup.store_write_failed', { code: errorCode(error) });
    });
    return this.writing;
  }
}
