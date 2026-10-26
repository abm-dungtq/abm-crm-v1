import { env, type D1Migration } from 'cloudflare:test';
import { describe, expect, test } from 'vitest';

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      MEDIA: R2Bucket;
      CHAT_HUB: DurableObjectNamespace;
      TEST_MIGRATIONS: D1Migration[];
      DEMO_MODE: string;
      AUTH_MODE: string;
    }
  }
}

describe('ChatHub', () => {
  test('connects tagged sockets and fans out broadcast events by user id', async () => {
    const stub = env.CHAT_HUB.get(env.CHAT_HUB.idFromName('org-abm'));
    const res = await stub.fetch('https://chat-hub/connect', {
      headers: { Upgrade: 'websocket', 'X-Chat-User': 'u-lan' },
    });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    ws.accept();

    const received: string[] = [];
    ws.addEventListener('message', (e) => {
      received.push(String(e.data));
    });

    const b1 = await stub.fetch('https://chat-hub/broadcast', {
      method: 'POST',
      body: JSON.stringify({ userIds: ['u-lan'], event: { type: 'x' } }),
    });
    expect(await b1.json()).toEqual({ delivered: 1 });
    expect(received).toEqual(['{"type":"x"}']);

    const b2 = await stub.fetch('https://chat-hub/broadcast', {
      method: 'POST',
      body: JSON.stringify({ userIds: ['u-huy'], event: { type: 'x' } }),
    });
    expect(await b2.json()).toEqual({ delivered: 0 });
    expect(received).toEqual(['{"type":"x"}']);

    ws.close(1000, 'done');
  });
});
