import { env } from 'cloudflare:test';
import type { Env, Sink } from '../../src/worker/env';

/**
 * A real Sink over the test bindings (D1, the ChatHub Durable Object, VAPID vars when set). Background work is
 * collected in `pending` so a test can await it; a failure there never fails the caller, as in production.
 */
export function testSink(overrides: Partial<Env> = {}, pending: Promise<unknown>[] = []): Sink {
  return {
    env: { ...(env as unknown as Env), ...overrides },
    waitUntil: (work) => { pending.push(work.catch(() => undefined)); },
  };
}
