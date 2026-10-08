import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  GoClawSessionCleanup, gatewayWsUrl, isStatelessUserId, msUntilNextRun, type WebSocketLike,
} from '../src/goclaw-session-cleanup';

const NOW = new Date('2026-10-08T08:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

interface Frame { type: string; id: string; method: string; params: Record<string, unknown> }

/** In-memory gateway: sessions by key with their owner user id, and the requests each connection made. */
class FakeGateway {
  sessions = new Map<string, string>();
  connections: { userId: string | null; methods: string[] }[] = [];
  failDeleteFor = new Set<string>();
  /** Simulates an API key bound to an owner: connect answers with this user id. */
  ownerId: string | null = null;

  factory = (url: string): WebSocketLike => {
    expect(url).toBe('ws://127.0.0.1:18790/ws');
    const listeners: Record<string, ((event?: { data: unknown }) => void)[]> = {};
    const emit = (type: string, event?: { data: unknown }) => setImmediate(() => listeners[type]?.forEach((l) => l(event)));
    const connection = { userId: null as string | null, methods: [] as string[] };
    this.connections.push(connection);
    emit('open');
    const reply = (id: string, ok: boolean, payload?: unknown) =>
      emit('message', { data: JSON.stringify({ type: 'res', id, ok, ...(ok ? { payload } : { error: { code: 'UNAUTHORIZED', message: 'no' } }) }) });
    return {
      addEventListener: (type: string, listener: (event?: { data: unknown }) => void) => {
        (listeners[type] ??= []).push(listener);
      },
      close: () => emit('close'),
      send: (data: string) => {
        const frame = JSON.parse(data) as Frame;
        expect(frame.type).toBe('req');
        connection.methods.push(frame.method);
        if (frame.method === 'connect') {
          expect(frame.params.token).toBe('operator-key');
          connection.userId = this.ownerId ?? String(frame.params.user_id);
          reply(frame.id, true, { protocol: 3, role: 'operator', user_id: connection.userId });
        } else if (frame.method === 'sessions.list') {
          const sessions = [...this.sessions].filter(([, user]) => user === connection.userId).map(([key, userID]) => ({ key, userID }));
          reply(frame.id, true, { sessions, total: sessions.length });
        } else if (frame.method === 'sessions.delete') {
          const key = String(frame.params.key);
          if (this.failDeleteFor.has(connection.userId!) || this.sessions.get(key) !== connection.userId) {
            reply(frame.id, false);
          } else {
            this.sessions.delete(key);
            reply(frame.id, true, { ok: true });
          }
        }
      },
    } as WebSocketLike;
  };
}

let dir: string;
let file: string;
let gateway: FakeGateway;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'goclaw-cleanup-test-'));
  file = join(dir, 'stateless-users.json');
  gateway = new FakeGateway();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const cleanup = () => new GoClawSessionCleanup({ wsUrl: 'ws://127.0.0.1:18790/ws', apiKey: 'operator-key', file, webSocket: gateway.factory, now: () => NOW });

async function seed(users: Record<string, string>) {
  await writeFile(file, JSON.stringify({ version: 1, users: Object.fromEntries(Object.entries(users).map(([id, ranAt]) => [id, { ranAt }])) }));
}
const saved = async () => Object.keys((JSON.parse(await readFile(file, 'utf8')) as { users: Record<string, unknown> }).users).sort();

describe('GoClawSessionCleanup', () => {
  it('connects only as ids older than 24 hours and deletes only their sessions', async () => {
    await seed({ 'crm-extract:old': hoursAgo(30), 'group-summary:old': hoursAgo(25), 'crm-extract:fresh': hoursAgo(2) });
    gateway.sessions = new Map([
      ['agent:crm-extractor:http:direct:crm-extract:old', 'crm-extract:old'],
      ['agent:group-summarizer:http:direct:group-summary:old', 'group-summary:old'],
      ['agent:crm-extractor:http:direct:crm-extract:fresh', 'crm-extract:fresh'],
      ['agent:sales:http:direct:zalo:uid:cust', 'zalo:uid:cust'],
    ]);
    const job = cleanup();
    await job.load();
    const summary = await job.runOnce();

    expect(summary).toEqual({ users: 2, sessions: 2, failed: 0, dropped: 0 });
    expect(gateway.connections.map((c) => c.userId).sort()).toEqual(['crm-extract:old', 'group-summary:old']);
    expect(gateway.connections.every((c) => c.methods[0] === 'connect' && c.methods.includes('sessions.list'))).toBe(true);
    expect([...gateway.sessions.keys()].sort()).toEqual([
      'agent:crm-extractor:http:direct:crm-extract:fresh', 'agent:sales:http:direct:zalo:uid:cust',
    ]);
    expect(await saved()).toEqual(['crm-extract:fresh']);
  });

  it('keeps an id whose cleanup fails, and drops it once it is older than 7 days', async () => {
    await seed({ 'crm-extract:failing': hoursAgo(48), 'crm-extract:ancient': hoursAgo(8 * 24) });
    gateway.sessions = new Map([['s1', 'crm-extract:failing'], ['s2', 'crm-extract:ancient']]);
    gateway.failDeleteFor = new Set(['crm-extract:failing', 'crm-extract:ancient']);
    const job = cleanup();
    await job.load();

    expect(await job.runOnce()).toEqual({ users: 0, sessions: 0, failed: 1, dropped: 1 });
    expect(await saved()).toEqual(['crm-extract:failing']);
  });

  it('stops the run when the key is bound to an owner and cannot act as the id', async () => {
    await seed({ 'crm-extract:a': hoursAgo(30), 'crm-extract:b': hoursAgo(30) });
    gateway.ownerId = 'owner-1';
    const job = cleanup();
    await job.load();
    const summary = await job.runOnce();
    expect(summary.failed).toBe(1);
    expect(gateway.connections).toHaveLength(1);
    expect(gateway.connections[0]!.methods).toEqual(['connect']);
    expect(await saved()).toEqual(['crm-extract:a', 'crm-extract:b']);
  });

  it('records only stateless ids, atomically into the file', async () => {
    const job = cleanup();
    await job.record('zalo:uid:cust');
    await job.record('crm-extract:123');
    await job.record('group-summary:456');
    expect(await saved()).toEqual(['crm-extract:123', 'group-summary:456']);
    expect(isStatelessUserId('crm-extract:')).toBe(false);
  });

  it('schedules at 03:00 Asia/Saigon and derives the gateway WebSocket URL', () => {
    // 15:00 in Vietnam -> next run 12 hours later.
    expect(msUntilNextRun(NOW)).toBe(12 * 3_600_000);
    // Exactly 03:00 in Vietnam -> the next day's run.
    expect(msUntilNextRun(new Date('2026-10-08T20:00:00.000Z'))).toBe(24 * 3_600_000);
    expect(msUntilNextRun(new Date('2026-10-08T19:59:00.000Z'))).toBe(60_000);
    expect(gatewayWsUrl('http://127.0.0.1:18790/v1')).toBe('ws://127.0.0.1:18790/ws');
    expect(gatewayWsUrl('https://goclaw.example.test/v1')).toBe('wss://goclaw.example.test/ws');
  });
});
