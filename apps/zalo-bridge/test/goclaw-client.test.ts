import { describe, expect, it, vi } from 'vitest';
import { GoClawClient } from '../src/goclaw-client';

const reply = (content: string | null, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }), { status, headers: { 'Content-Type': 'application/json' } });

function client(fetchImpl: (url: string | URL | Request, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(fetchImpl);
  return { fetchMock, goclaw: new GoClawClient({ baseUrl: 'http://127.0.0.1:18790/v1', apiKey: 'test-api-key', fetch: fetchMock as unknown as typeof fetch }) };
}

describe('GoClawClient.complete', () => {
  it('posts the agent model, user id header and a single user message', async () => {
    const { fetchMock, goclaw } = client(async () => reply('Chào anh, em hỗ trợ được gì ạ?'));
    const text = await goclaw.complete({ agentKey: 'sales-bot', userId: 'zalo:own-uid:cust-1', text: 'Xin chào' });

    expect(text).toBe('Chào anh, em hỗ trợ được gì ạ?');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://127.0.0.1:18790/v1/chat/completions');
    expect(init!.method).toBe('POST');
    expect(init!.headers).toMatchObject({
      Authorization: 'Bearer test-api-key',
      'X-GoClaw-User-Id': 'zalo:own-uid:cust-1',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init!.body))).toEqual({
      model: 'goclaw:sales-bot', messages: [{ role: 'user', content: 'Xin chào' }], stream: false,
    });
    expect(init!.signal).toBeInstanceOf(AbortSignal);
  });

  it('throws on an empty reply', async () => {
    const { goclaw } = client(async () => reply('   '));
    await expect(goclaw.complete({ agentKey: 'a', userId: 'u', text: 't' })).rejects.toThrow('GOCLAW_EMPTY_REPLY');
    const { goclaw: nullReply } = client(async () => reply(null));
    await expect(nullReply.complete({ agentKey: 'a', userId: 'u', text: 't' })).rejects.toThrow('GOCLAW_EMPTY_REPLY');
  });

  it('does not retry: a 429 is one failed call', async () => {
    const { fetchMock, goclaw } = client(async () => new Response('{}', { status: 429 }));
    await expect(goclaw.complete({ agentKey: 'a', userId: 'u', text: 't' })).rejects.toThrow('GOCLAW_HTTP_429');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a network failure and a timeout by code', async () => {
    const { goclaw } = client(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(goclaw.complete({ agentKey: 'a', userId: 'u', text: 't' })).rejects.toThrow('GOCLAW_NETWORK');
    const timeout = new GoClawClient({
      baseUrl: 'http://127.0.0.1:18790/v1', apiKey: 'k', timeoutMs: 5,
      fetch: ((_url: string, init: RequestInit) => new Promise((_, reject) => {
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
      })) as unknown as typeof fetch,
    });
    await expect(timeout.complete({ agentKey: 'a', userId: 'u', text: 't' })).rejects.toThrow('GOCLAW_TIMEOUT');
  });
});
