import { signContentPath } from '@abm/lms-core';
import { describe, expect, it } from 'vitest';
import contentWorker, { type ContentEnv } from '../src/content/index';

const stubEnv: ContentEnv = {
  LMS_CONTENT: {
    get: async (k: string) =>
      k === 'programs/p1/v2.html' ? ({ body: '<html>ok</html>' } as unknown as R2ObjectBody) : null,
  } as unknown as R2Bucket,
  CONTENT_SIGNING_SECRET: 's',
  LMS_ORIGIN: 'https://lms.test',
};

describe('abm-lms-content Worker', () => {
  it('serves 200 with strict CSP and no Set-Cookie for a valid signed path', async () => {
    const path = await signContentPath('p1', 2, 's', 7200, Date.now());
    const res = await contentWorker.fetch(
      new Request(`https://content.test${path}`),
      stubEnv,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<html>ok</html>');
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain('frame-ancestors https://lms.test');
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('returns 403 when the signed URL is expired', async () => {
    const pastMs = Date.now() - 10_000;
    const path = await signContentPath('p1', 2, 's', 1, pastMs);
    const res = await contentWorker.fetch(
      new Request(`https://content.test${path}`),
      stubEnv,
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('Liên kết đã hết hạn');
  });

  it('returns 404 when the signed version does not exist in R2', async () => {
    const path = await signContentPath('p1', 99, 's', 7200, Date.now());
    const res = await contentWorker.fetch(
      new Request(`https://content.test${path}`),
      stubEnv,
    );
    expect(res.status).toBe(404);
  });

  it('returns 405 on POST', async () => {
    const path = await signContentPath('p1', 2, 's', 7200, Date.now());
    const res = await contentWorker.fetch(
      new Request(`https://content.test${path}`, { method: 'POST' }),
      stubEnv,
    );
    expect(res.status).toBe(405);
  });
});
