import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { GoClawClient } from '../src/goclaw-client';
import type { WebSocketLike } from '../src/goclaw-session-cleanup';

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

  it('does not retry anything but a timeout: a 429 is one failed call', async () => {
    const { fetchMock, goclaw } = client(async () => new Response('{}', { status: 429 }));
    await expect(goclaw.complete({ agentKey: 'a', userId: 'u', text: 't' })).rejects.toThrow('GOCLAW_HTTP_429');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a network failure and a timeout by code', async () => {
    const { goclaw } = client(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(goclaw.complete({ agentKey: 'a', userId: 'u', text: 't' })).rejects.toThrow('GOCLAW_NETWORK');
    const stalled = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
    }));
    const timeout = new GoClawClient({
      baseUrl: 'http://127.0.0.1:18790/v1', apiKey: 'k', attemptsMs: [5, 5], fetch: stalled as unknown as typeof fetch,
    });
    await expect(timeout.complete({ agentKey: 'a', userId: 'u', text: 't' })).rejects.toThrow('GOCLAW_TIMEOUT');
    expect(stalled).toHaveBeenCalledTimes(2);
  });

  it('aborts a stalled first attempt and asks again with the same request', async () => {
    let calls = 0;
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      calls += 1;
      if (calls > 1) return Promise.resolve(reply('Dạ em trả lời ạ'));
      return new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)));
    });
    const goclaw = new GoClawClient({
      baseUrl: 'http://127.0.0.1:18790/v1', apiKey: 'k', attemptsMs: [5, 1000], fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(goclaw.complete({ agentKey: 'a', userId: 'u', text: 't' })).resolves.toBe('Dạ em trả lời ạ');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![0]).toBe(fetchMock.mock.calls[1]![0]);
    expect(fetchMock.mock.calls[0]![1].body).toBe(fetchMock.mock.calls[1]![1].body);
    expect(fetchMock.mock.calls[0]![1].signal!.aborted).toBe(true);
  });});

interface SentFrame { id: string; method: string; params: Record<string, unknown> }

/** Gateway socket that emits open after listeners attach, like the session-cleanup fake. */
function fakeSocket(reply: (frame: SentFrame) => { ok: boolean; payload?: unknown } | null) {
  const frames: SentFrame[] = [];
  const urls: string[] = [];
  const factory = (url: string): WebSocketLike => {
    urls.push(url);
    const listeners: Record<string, ((event?: { data: unknown }) => void)[]> = {};
    const emit = (type: string, event?: { data: unknown }) => setImmediate(() => listeners[type]?.forEach((l) => l(event)));
    emit('open');
    return {
      addEventListener: (type: string, listener: (event?: { data: unknown }) => void) => {
        (listeners[type] ??= []).push(listener);
      },
      close: () => emit('close'),
      send: (data: string) => {
        const frame = JSON.parse(data) as SentFrame;
        frames.push(frame);
        const answered = reply(frame);
        if (!answered) return;
        emit('message', { data: JSON.stringify({ type: 'res', id: frame.id, ...answered }) });
      },
    } as WebSocketLike;
  };
  return { factory, frames, urls };
}

describe('GoClawClient.completeWithMedia', () => {
  const imagePath = join('tmp', 'abc.png');

  it('sends chat.send on the shared http session with the image file', async () => {
    const socket = fakeSocket(() => ({ ok: true, payload: { content: 'Đã thấy biên lai' } }));
    const goclaw = new GoClawClient({
      baseUrl: 'http://127.0.0.1:18790/v1', apiKey: 'test-api-key', webSocket: socket.factory,
    });
    const text = await goclaw.completeWithMedia({
      agentKey: 'tu-van-oa', userId: 'zalo:own:cust', text: 'Khách gửi ảnh', mediaPaths: [imagePath],
    });

    expect(text).toBe('Đã thấy biên lai');
    expect(socket.urls).toEqual(['ws://127.0.0.1:18790/ws']);
    expect(socket.frames.map((frame) => frame.method)).toEqual(['connect', 'chat.send']);
    expect(socket.frames[0]!.params).toEqual({
      token: 'test-api-key', user_id: 'zalo:own:cust', protocolVersion: 3,
    });
    expect(socket.frames[1]!.params).toEqual({
      agentId: 'tu-van-oa',
      sessionKey: 'agent:tu-van-oa:http:direct:zalo:own:cust',
      stream: false,
      message: 'Khách gửi ảnh',
      media: [{ path: imagePath, filename: 'abc.png' }],
    });
  });

  it('throws GOCLAW_EMPTY_REPLY when chat.send content is blank', async () => {
    const socket = fakeSocket((frame) => (
      frame.method === 'connect' ? { ok: true, payload: { role: 'operator' } } : { ok: true, payload: { content: '   ' } }
    ));
    const goclaw = new GoClawClient({ baseUrl: 'http://127.0.0.1:18790/v1', apiKey: 'k', webSocket: socket.factory });
    await expect(goclaw.completeWithMedia({
      agentKey: 'a', userId: 'u', text: 't', mediaPaths: [imagePath],
    })).rejects.toThrow('GOCLAW_EMPTY_REPLY');
  });

  it('aborts each chat.send that does not answer, retries once, then throws GOCLAW_TIMEOUT', async () => {
    const socket = fakeSocket((frame) => (frame.method === 'chat.send' ? null : { ok: true, payload: {} }));
    const goclaw = new GoClawClient({
      baseUrl: 'http://127.0.0.1:18790/v1', apiKey: 'k', attemptsMs: [200, 200], webSocket: socket.factory,
    });
    await expect(goclaw.completeWithMedia({
      agentKey: 'a', userId: 'u', text: 't', mediaPaths: [imagePath],
    })).rejects.toThrow('GOCLAW_TIMEOUT');
    expect(socket.frames.map((frame) => frame.method)).toEqual(['connect', 'chat.send', 'chat.abort', 'connect', 'chat.send', 'chat.abort']);
    expect(socket.frames[2]!.params).toEqual({ sessionKey: 'agent:a:http:direct:u' });
  });

  it('answers from the retry after aborting a stalled image turn', async () => {
    let sends = 0;
    const socket = fakeSocket((frame) => {
      if (frame.method !== 'chat.send') return { ok: true, payload: {} };
      sends += 1;
      return sends === 1 ? null : { ok: true, payload: { content: 'Đã thấy biên lai' } };
    });
    const goclaw = new GoClawClient({
      baseUrl: 'http://127.0.0.1:18790/v1', apiKey: 'k', attemptsMs: [200, 1000], webSocket: socket.factory,
    });
    await expect(goclaw.completeWithMedia({
      agentKey: 'a', userId: 'u', text: 't', mediaPaths: [imagePath],
    })).resolves.toBe('Đã thấy biên lai');
    expect(socket.frames.map((frame) => frame.method)).toEqual(['connect', 'chat.send', 'chat.abort', 'connect', 'chat.send']);
  });

  it('throws GOCLAW_NETWORK when the socket cannot open', async () => {
    const goclaw = new GoClawClient({
      baseUrl: 'http://127.0.0.1:18790/v1', apiKey: 'k',
      webSocket: () => { throw new Error('refused'); },
    });
    await expect(goclaw.completeWithMedia({
      agentKey: 'a', userId: 'u', text: 't', mediaPaths: [imagePath],
    })).rejects.toThrow('GOCLAW_NETWORK');
  });

  it('throws GOCLAW_BAD_RESPONSE when chat.send is refused', async () => {
    const socket = fakeSocket((frame) => (
      frame.method === 'connect'
        ? { ok: true, payload: { role: 'operator' } }
        : { ok: false, payload: undefined }
    ));
    const goclaw = new GoClawClient({ baseUrl: 'http://127.0.0.1:18790/v1', apiKey: 'k', webSocket: socket.factory });
    await expect(goclaw.completeWithMedia({
      agentKey: 'a', userId: 'u', text: 't', mediaPaths: [imagePath],
    })).rejects.toThrow('GOCLAW_BAD_RESPONSE');
  });
});
