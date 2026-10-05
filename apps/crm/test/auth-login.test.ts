import { env, applyD1Migrations } from 'cloudflare:test';
import { beforeEach, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';
import { hashPassword } from '../src/worker/password';

const db = env.DB;
const tables = ['user_session', '_guard', 'idempotency_key', 'outbox', 'audit_log', 'approval', 'activity', 'task', 'lead', 'lead_counter',
  'contact_point', 'account_contact', 'contact', 'account', 'app_user', 'team', 'department', 'organization'];
const ORIGIN = 'http://crm.test';
const LAN = 'lan@demo.abm.example';
const PASSWORD = 'Lan-mat-khau-2026';

async function setPassword(userId: string, password: string, extra = '') {
  const p = await hashPassword(password);
  await db.prepare(`UPDATE app_user SET password_hash = ?, password_salt = ?, password_iterations = ?${extra} WHERE id = ?`)
    .bind(p.hash, p.salt, p.iterations, userId).run();
}

beforeEach(async () => {
  await applyD1Migrations(db, env.TEST_MIGRATIONS);
  await db.batch(tables.map(t => db.prepare(`DELETE FROM ${t}`)));
  await db.batch(seedSql.split('\n').filter(l => l.startsWith('INSERT')).map(l => db.prepare(l)));
  await setPassword('u-lan', PASSWORD);
});

interface CallOptions { cookie?: string; body?: unknown; method?: string; origin?: string | null; headers?: Record<string, string> }
async function call(path: string, o: CallOptions = {}) {
  const method = o.method ?? (o.body === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...o.headers };
  if (method !== 'GET' && o.origin !== null) headers.Origin = o.origin ?? ORIGIN;
  if (o.cookie) headers.Cookie = o.cookie;
  const res = await app.fetch(new Request(`${ORIGIN}/api${path}`, {
    method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body),
  }), { ...env, AUTH_MODE: 'password' });
  const setCookie = res.headers.get('Set-Cookie') ?? '';
  const cookie = /abm_session=([^;]*)/.exec(setCookie)?.[0];
  return { status: res.status, json: await res.json() as any, setCookie, cookie };
}
const login = (email: string, password: string, origin?: string | null) => call('/auth/login', { body: { email, password }, origin });

test('test bindings keep the evaluation identity path by default', () => {
  expect(env.AUTH_MODE).toBe('');
});

test('correct password opens an HttpOnly session that resolves the actor', async () => {
  const r = await login('  LAN@demo.abm.example ', PASSWORD);
  expect(r.status).toBe(200);
  expect(r.setCookie).toContain('abm_session=');
  expect(r.setCookie).toContain('HttpOnly');
  expect(r.json.data.mustChangePassword).toBe(false);
  const me = await call('/me', { cookie: r.cookie });
  expect(me.status).toBe(200);
  expect(me.json.data.id).toBe('u-lan');
});

test('wrong password and unknown email fail with the same message', async () => {
  const wrong = await login(LAN, 'sai-mat-khau');
  const unknown = await login('khong-co@demo.abm.example', PASSWORD);
  const noPassword = await login('hung@demo.abm.example', PASSWORD);
  for (const r of [wrong, unknown, noPassword]) expect(r.status).toBe(401);
  expect(unknown.json.error.message).toBe(wrong.json.error.message);
  expect(noPassword.json.error.message).toBe(wrong.json.error.message);
});

test('ten wrong passwords lock the account even for the right password', async () => {
  for (let i = 0; i < 10; i++) expect((await login(LAN, `sai-${i}`)).status).toBe(401);
  const locked = await login(LAN, PASSWORD);
  const wrong = await login(LAN, 'sai-mat-khau');
  // A locked account must look exactly like a wrong password, so outsiders cannot learn who exists or is locked.
  expect(locked.status).toBe(401);
  expect(locked.json).toEqual(wrong.json);
  expect(locked.cookie).toBeFalsy();
  await db.prepare("UPDATE app_user SET locked_until = '2000-01-01T00:00:00.000Z' WHERE id = 'u-lan'").run();
  expect((await login(LAN, PASSWORD)).status).toBe(200);
});

test('parallel wrong passwords still lock after ten', async () => {
  await Promise.all(Array.from({ length: 10 }, (_, i) => login(LAN, `sai-${i}`)));
  expect((await login(LAN, PASSWORD)).status).toBe(401);
});

test('wrong current password on change counts toward the lock', async () => {
  const r = await login(LAN, PASSWORD);
  for (let i = 0; i < 10; i++) {
    expect((await call('/auth/change-password', { cookie: r.cookie, body: { currentPassword: `sai-${i}`, newPassword: 'MatKhauMoi2026' } })).status).toBe(422);
  }
  const locked = await call('/auth/change-password', { cookie: r.cookie, body: { currentPassword: PASSWORD, newPassword: 'MatKhauMoi2026' } });
  expect(locked.status).toBe(423);
});

test('a partial credential row behaves like no password', async () => {
  await db.prepare("UPDATE app_user SET password_iterations = NULL WHERE id = 'u-lan'").run();
  expect((await login(LAN, PASSWORD)).status).toBe(401);
});

test('an unknown auth mode turns the demo identity off', async () => {
  const res = await app.fetch(new Request(`${ORIGIN}/api/me`, { headers: { 'X-Demo-User': 'u-bgd' } }), { ...env, AUTH_MODE: 'pasword', DEMO_MODE: '1' });
  expect(res.status).toBe(401);
  const users = await app.fetch(new Request(`${ORIGIN}/api/demo-users`), { ...env, AUTH_MODE: 'pasword', DEMO_MODE: '1' });
  expect(users.status).toBe(403);
  const mode = await app.fetch(new Request(`${ORIGIN}/api/auth/mode`), { ...env, AUTH_MODE: 'pasword', DEMO_MODE: '1' });
  expect((await mode.json() as any).data.mode).toBe('unconfigured');
});

test('demo header is ignored in password mode', async () => {
  const r = await call('/me', { headers: { 'X-Demo-User': 'u-bgd' } });
  expect(r.status).toBe(401);
  expect((await call('/demo-users')).status).toBe(403);
});

test('temporary password must be changed before anything else, then old sessions die', async () => {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  await setPassword('u-lan', 'TamThoi12345', `, must_change_password = 1, temp_password_expires_at = '${future}'`);
  const first = await login(LAN, 'TamThoi12345');
  expect(first.status).toBe(200);
  expect(first.json.data.mustChangePassword).toBe(true);
  const me = await call('/me', { cookie: first.cookie });
  expect(me.json.data.mustChangePassword).toBe(true);
  const blocked = await call('/leads', { cookie: first.cookie });
  expect(blocked.status).toBe(403);
  expect(blocked.json.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

  const tooShort = await call('/auth/change-password', { cookie: first.cookie, body: { currentPassword: 'TamThoi12345', newPassword: 'ngan' } });
  expect(tooShort.status).toBe(422);
  const changed = await call('/auth/change-password', { cookie: first.cookie, body: { currentPassword: 'TamThoi12345', newPassword: 'MatKhauMoi2026' } });
  expect(changed.status).toBe(200);
  expect(changed.cookie).toBeTruthy();
  expect((await call('/leads', { cookie: changed.cookie })).status).toBe(200);
  expect((await call('/me', { cookie: first.cookie })).status).toBe(401);
  // The temporary password stops working once replaced.
  expect((await login(LAN, 'TamThoi12345')).status).toBe(401);
  expect((await login(LAN, 'MatKhauMoi2026')).status).toBe(200);
});

test('expired temporary password is refused with its own code', async () => {
  await setPassword('u-lan', 'TamThoi12345', ", must_change_password = 1, temp_password_expires_at = '2000-01-01T00:00:00.000Z'");
  const r = await login(LAN, 'TamThoi12345');
  expect(r.status).toBe(401);
  expect(r.json.error.code).toBe('TEMP_PASSWORD_EXPIRED');
});

test('logout revokes the session', async () => {
  const r = await login(LAN, PASSWORD);
  expect((await call('/auth/logout', { cookie: r.cookie, body: {} })).status).toBe(200);
  expect((await call('/me', { cookie: r.cookie })).status).toBe(401);
});

test('disabled user cannot log in and loses open sessions', async () => {
  const r = await login(LAN, PASSWORD);
  await db.prepare("UPDATE app_user SET status = 'disabled' WHERE id = 'u-lan'").run();
  expect((await call('/me', { cookie: r.cookie })).status).toBe(401);
  expect((await login(LAN, PASSWORD)).status).toBe(401);
});

test('writes need the CRM origin in password mode, including login', async () => {
  expect((await login(LAN, PASSWORD, null)).status).toBe(403);
  expect((await login(LAN, PASSWORD, 'https://evil.example')).status).toBe(403);
});

test('passwords never reach the audit log', async () => {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  await setPassword('u-lan', 'TamThoi12345', `, must_change_password = 1, temp_password_expires_at = '${future}'`);
  const first = await login(LAN, 'TamThoi12345');
  await call('/auth/change-password', { cookie: first.cookie, body: { currentPassword: 'TamThoi12345', newPassword: 'MatKhauMoi2026' } });
  const audit = await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE command = 'changePassword'").first<{ n: number }>();
  expect(audit!.n).toBe(1);
  const leaked = await db.prepare(`SELECT COUNT(*) AS n FROM audit_log
    WHERE COALESCE(before_json, '') || COALESCE(after_json, '') LIKE '%TamThoi12345%'
       OR COALESCE(before_json, '') || COALESCE(after_json, '') LIKE '%MatKhauMoi2026%'`).first<{ n: number }>();
  expect(leaked!.n).toBe(0);
});
