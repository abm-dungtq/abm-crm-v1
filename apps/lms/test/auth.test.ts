import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/worker/index';
import { resetDb, seedAccount, seedContact, seedOrg } from './helpers/reset-db';

const ORIGIN = 'http://lms.test';
const EMAIL = 'hocvien@bsr.com.vn';
const DEFAULT_PW = 'AbmMacDinh2026';

interface CallOpts {
  method?: string;
  body?: unknown;
  cookie?: string;
  origin?: string | null;
}

async function call(path: string, opts: CallOpts = {}) {
  const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (method !== 'GET' && method !== 'HEAD' && opts.origin !== null) {
    headers.Origin = opts.origin ?? ORIGIN;
  }
  if (opts.cookie) {
    headers.Cookie = opts.cookie;
  }
  const res = await app.fetch(
    new Request(`${ORIGIN}/api${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
    env,
  );
  const setCookie = res.headers.get('Set-Cookie') ?? '';
  const cookie = /abm_learner=([^;]*)/.exec(setCookie)?.[0];
  const json = (await res.json()) as {
    ok: boolean;
    data?: any;
    error?: { code: string; message: string };
  };
  return { status: res.status, json, setCookie, cookie };
}

beforeEach(async () => {
  await resetDb(env.DB);
  await seedOrg(env.DB, { defaultPassword: DEFAULT_PW });
  const { contactId } = await seedContact(env.DB, {
    contactId: 'ct-1',
    displayName: 'Nguyễn Văn Học',
    email: EMAIL,
  });
  await seedAccount(env.DB, {
    accountId: 'acc-1',
    contactId,
    email: EMAIL,
  });
});

describe('LMS learner auth', () => {
  it('1. default-password login -> 200, Set-Cookie contains abm_learner=, usesDefaultPassword: true', async () => {
    const res = await call('/auth/login', {
      body: { email: '  HOCVIEN@bsr.com.vn ', password: DEFAULT_PW },
    });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.setCookie).toContain('abm_learner=');
    expect(res.setCookie).toContain('HttpOnly');
    expect(res.json.data).toEqual({ usesDefaultPassword: true });

    const me = await call('/me', { cookie: res.cookie });
    expect(me.status).toBe(200);
    expect(me.json.data).toEqual({
      displayName: 'Nguyễn Văn Học',
      email: EMAIL,
      usesDefaultPassword: true,
    });
  });

  it('2. wrong password x10 -> 11th attempt with RIGHT password still returns 401 and locked_until is in the future', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await call('/auth/login', {
        body: { email: EMAIL, password: `sai-${i}` },
      });
      expect(r.status).toBe(401);
    }

    const row = await env.DB.prepare('SELECT locked_until FROM learner_account WHERE id = ?')
      .bind('acc-1')
      .first<{ locked_until: string | null }>();
    expect(row?.locked_until).not.toBeNull();
    expect(Date.parse(row!.locked_until!)).toBeGreaterThan(Date.now());

    const eleventh = await call('/auth/login', {
      body: { email: EMAIL, password: DEFAULT_PW },
    });
    expect(eleventh.status).toBe(401);
    expect(eleventh.json.error?.code).toBe('UNAUTHENTICATED');
  });

  it('3. no org default -> 401 with "chưa sẵn sàng"', async () => {
    await env.DB.prepare(
      `UPDATE org_setting
       SET learner_default_password_hash = NULL,
           learner_default_password_salt = NULL,
           learner_default_password_iterations = NULL
       WHERE organization_id = 'org-abm'`,
    ).run();

    const res = await call('/auth/login', {
      body: { email: EMAIL, password: DEFAULT_PW },
    });
    expect(res.status).toBe(401);
    expect(res.json.error?.message).toContain('chưa sẵn sàng');
  });

  it('4. change password then login with the new one -> 200, usesDefaultPassword: false; old default -> 401', async () => {
    const first = await call('/auth/login', {
      body: { email: EMAIL, password: DEFAULT_PW },
    });
    expect(first.status).toBe(200);

    const other = await call('/auth/login', {
      body: { email: EMAIL, password: DEFAULT_PW },
    });
    const same = await call('/auth/change-password', {
      cookie: first.cookie,
      body: { currentPassword: DEFAULT_PW, newPassword: DEFAULT_PW },
    });
    expect(same.status).toBe(422);

    const changed = await call('/auth/change-password', {
      cookie: first.cookie,
      body: { currentPassword: DEFAULT_PW, newPassword: 'MatKhauMoi2026' },
    });
    expect(changed.status, JSON.stringify(changed.json)).toBe(200);
    expect((await call('/me', { cookie: other.cookie })).status).toBe(401);

    const oldTry = await call('/auth/login', {
      body: { email: EMAIL, password: DEFAULT_PW },
    });
    expect(oldTry.status).toBe(401);

    const newTry = await call('/auth/login', {
      body: { email: EMAIL, password: 'MatKhauMoi2026' },
    });
    expect(newTry.status).toBe(200);
    expect(newTry.json.data).toEqual({ usesDefaultPassword: false });
  });

  it('5. disabled account -> 401; POST with foreign Origin -> 403', async () => {
    const foreign = await call('/auth/login', {
      body: { email: EMAIL, password: DEFAULT_PW },
      origin: 'https://evil.example',
    });
    expect(foreign.status).toBe(403);

    await env.DB.prepare("UPDATE learner_account SET status = 'disabled' WHERE id = 'acc-1'").run();
    const disabled = await call('/auth/login', {
      body: { email: EMAIL, password: DEFAULT_PW },
    });
    expect(disabled.status).toBe(401);
  });
});
