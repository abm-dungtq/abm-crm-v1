import { createHmac } from 'node:crypto';
import type { BridgeEvent } from '@abm/contracts';
import { describe, expect, it, vi } from 'vitest';
import { CrmClient, RETRY_DELAYS_MS, signBridgeRequest } from '../src/crm-client';

const SECRET = 'test-bridge-secret';
const NOW_MS = 1_791_400_000_123;

const message = (i: number): BridgeEvent => ({
  type: 'message', accountExternalId: 'uid-1', threadId: 'thread-1', threadKind: 'direct', msgId: `m-${i}`,
  fromSelf: false, senderExternalId: 'cust-1', senderName: '', text: `hello ${i}`, sentAt: '2026-10-08T07:00:00.000Z',
});

const ok = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } });

function client(fetchImpl: typeof fetch, sleep = vi.fn(async (_ms: number) => {})) {
  return { sleep, crm: new CrmClient({ baseUrl: 'https://crm.test', secret: SECRET, pollWaitSeconds: 20, fetch: fetchImpl, sleep, now: () => NOW_MS }) };
}

describe('signBridgeRequest', () => {
  it('matches HMAC-SHA256(secret, timestamp + "." + body) in hex', () => {
    const expected = createHmac('sha256', SECRET).update('1791400000.{"events":[]}').digest('hex');
    expect(signBridgeRequest(SECRET, '1791400000', '{"events":[]}')).toBe(expected);
    expect(signBridgeRequest(SECRET, '1791400000', '{"events":[]}')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signs a GET as timestamp + "."', () => {
    expect(signBridgeRequest(SECRET, '1791400000', '')).toBe(createHmac('sha256', SECRET).update('1791400000.').digest('hex'));
  });
});

describe('CrmClient', () => {
  it('splits 250 events into 3 signed requests of at most 100', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ok({ accepted: 100, rejected: 0 }));
    const { crm } = client(fetchMock as unknown as typeof fetch);
    await crm.pushEvents(Array.from({ length: 250 }, (_, i) => message(i)));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const sizes = fetchMock.mock.calls.map(([, init]) => (JSON.parse(String(init!.body)) as { events: unknown[] }).events.length);
    expect(sizes).toEqual([100, 100, 50]);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).toBe('https://crm.test/api/bridge/events');
      const headers = init!.headers as Record<string, string>;
      expect(headers['X-Bridge-Timestamp']).toBe('1791400000');
      expect(headers['X-Bridge-Signature']).toBe(createHmac('sha256', SECRET).update(`1791400000.${String(init!.body)}`).digest('hex'));
      expect(headers).not.toHaveProperty('Origin');
    }
    expect(crm.pendingCount).toBe(0);
  });

  it('retries a network failure after 2, 4 and 8 seconds, then keeps the events for the next flush', async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => {
      throw new TypeError('fetch failed');
    });
    const { crm, sleep } = client(fetchMock as unknown as typeof fetch);
    await crm.pushEvents([message(1), message(2)]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([...RETRY_DELAYS_MS]);
    expect(crm.pendingCount).toBe(2);

    fetchMock.mockImplementation(async () => ok({ accepted: 2, rejected: 0 }));
    await crm.flush();
    expect(crm.pendingCount).toBe(0);
  });

  it('drops a batch the Worker refuses with 422 without retrying', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 422 }));
    const { crm, sleep } = client(fetchMock as unknown as typeof fetch);
    await crm.pushEvents([message(1)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(crm.pendingCount).toBe(0);
  });

  it('keeps a batch refused with 401 or 403 and logs CRM_AUTH as an error', async () => {
    for (const status of [401, 403]) {
      const fetchMock = vi.fn(async () => new Response('{}', { status }));
      const sleep = vi.fn(async (_ms: number) => {});
      const log = vi.fn();
      const crm = new CrmClient({ baseUrl: 'https://crm.test', secret: SECRET, pollWaitSeconds: 20, fetch: fetchMock as unknown as typeof fetch, sleep, now: () => NOW_MS, log });
      await crm.pushEvents([message(1), message(2)]);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([...RETRY_DELAYS_MS]);
      expect(crm.pendingCount).toBe(2);
      expect(log).toHaveBeenCalledWith('error', 'crm.auth_failed', { code: 'CRM_AUTH', status, path: '/api/bridge/events' });
      expect(log).toHaveBeenCalledWith('warn', 'events.deferred', { count: 2, code: 'CRM_AUTH' });

      fetchMock.mockImplementation(async () => ok({ accepted: 2, rejected: 0 }));
      await crm.flush();
      expect(crm.pendingCount).toBe(0);
    }
  });

  it('drops events that break the contract before sending', async () => {
    const fetchMock = vi.fn(async () => ok({ accepted: 1, rejected: 0 }));
    const { crm } = client(fetchMock as unknown as typeof fetch);
    const bad = { ...message(2), sentAt: 'yesterday' } as BridgeEvent;
    await crm.pushEvents([message(1), bad]);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as { events: unknown[] };
    expect(body.events).toHaveLength(1);
  });

  it('polls commands with a signed GET of an empty body', async () => {
    const command = { id: 'c1', kind: 'send_zalo', target: 'bridge', channelAccountId: 'a1', conversationId: 'v1', payload: {}, attempts: 1,
      claimedAt: '2026-10-08T07:00:00.000Z', leaseExpiresAt: '2026-10-08T07:05:00.000Z' };
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ok([command]));
    const { crm } = client(fetchMock as unknown as typeof fetch);
    const commands = await crm.pollCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ id: 'c1', kind: 'send_zalo', attempts: 1 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://crm.test/api/bridge/commands?wait=20');
    expect(init!.method).toBe('GET');
    expect(init!.body).toBeUndefined();
    expect((init!.headers as Record<string, string>)['X-Bridge-Signature']).toBe(signBridgeRequest(SECRET, '1791400000', ''));
  });

  it('posts a result once and does not retry a 404', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('{}', { status: 404 }));
    const { crm, sleep } = client(fetchMock as unknown as typeof fetch);
    expect(await crm.postResult('c1', { attempts: 2, ok: true, externalMsgId: '99' })).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://crm.test/api/bridge/commands/c1/result');
    expect(JSON.parse(String(init!.body))).toEqual({ attempts: 2, ok: true, externalMsgId: '99' });
  });

  it('treats a stale result answered with ignored as delivered', async () => {
    const fetchMock = vi.fn(async () => ok({ ignored: true }));
    const { crm } = client(fetchMock as unknown as typeof fetch);
    expect(await crm.postResult('c1', { attempts: 1, ok: false, error: 'X' })).toBe(true);
  });
});
