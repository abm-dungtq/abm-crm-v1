import { env, applyD1Migrations } from 'cloudflare:test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';

const db = env.DB;
const tables = ['user_session', '_guard', 'idempotency_key', 'outbox', 'audit_log', 'approval', 'activity', 'task', 'lead', 'lead_counter',
  'contact_point', 'account_contact', 'contact', 'account', 'app_user', 'team', 'department', 'organization'];
const FAKE_SECRET = 'fake-secret-value-123';
const lark = { LARK_APP_ID: 'cli_fake', LARK_APP_SECRET: FAKE_SECRET };

beforeEach(async () => {
  await applyD1Migrations(db, env.TEST_MIGRATIONS);
  await db.batch(tables.map(t => db.prepare(`DELETE FROM ${t}`)));
  await db.batch(seedSql.split('\n').filter(l => l.startsWith('INSERT')).map(l => db.prepare(l)));
});
afterEach(() => vi.restoreAllMocks());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Fakes the two Lark endpoints; `openIds` maps email to open_id. */
function fakeLark(openIds: Record<string, string>, tokenReply: unknown = { code: 0, tenant_access_token: 't-fake', expire: 7200 }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/auth/v3/tenant_access_token/internal')) return json(tokenReply);
    if (url.includes('/contact/v3/users/batch_get_id')) {
      const { emails } = JSON.parse(String(init!.body)) as { emails: string[] };
      return json({ code: 0, data: { user_list: emails.map((email) => ({ email, user_id: openIds[email] ?? '' })) } });
    }
    return json({ code: 404 }, 404);
  });
}

async function call(user: string, path: string, body: unknown, extraEnv: Record<string, string> = lark, method = 'POST') {
  const res = await app.fetch(new Request(`http://crm.test/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Demo-User': user }, body: JSON.stringify(body),
  }), { ...env, DEMO_MODE: '1', ...extraEnv });
  return { status: res.status, json: await res.json() as any };
}
const link = (body: unknown = {}, extraEnv?: Record<string, string>) => call('u-admin', '/admin/lark/link', body, extraEnv);
const larkState = (id: string) => db.prepare('SELECT lark_open_id AS openId, lark_link_status AS status, lark_checked_at AS checkedAt FROM app_user WHERE id = ?').bind(id).first<any>();

test('found emails are linked and the rest are marked unmatched', async () => {
  const spy = fakeLark({ 'lan@demo.abm.example': 'ou_test_lan' });
  const active = (await db.prepare("SELECT COUNT(*) AS n FROM app_user WHERE status = 'active'").first<{ n: number }>())!.n;
  const r = await link();
  expect(r.status).toBe(200);
  expect(r.json.data).toEqual({ linked: 1, unmatched: active - 1, error: 0 });
  expect(await larkState('u-lan')).toMatchObject({ openId: 'ou_test_lan', status: 'linked' });
  expect(await larkState('u-hung')).toMatchObject({ openId: null, status: 'unmatched' });
  expect((await larkState('u-hung')).checkedAt).toBeTruthy();
  const tokenCall = spy.mock.calls.find(([u]) => String(u).includes('tenant_access_token'))!;
  expect(String(tokenCall[1]!.body)).toContain(FAKE_SECRET);

  // Already linked people are skipped on the next run.
  const again = await link();
  expect(again.json.data.linked).toBe(0);
  expect(again.json.data.unmatched).toBe(active - 1);
});

test('a Lark error marks everyone error without leaking the secret', async () => {
  fakeLark({}, { code: 99991663, msg: 'app access token invalid' });
  const r = await link({ userIds: ['u-lan', 'u-hung'] });
  expect(r.status).toBe(200);
  expect(r.json.data).toMatchObject({ linked: 0, unmatched: 0, error: 2 });
  expect(r.json.data.message).toContain('99991663');
  expect(JSON.stringify(r.json)).not.toContain(FAKE_SECRET);
  expect(await larkState('u-lan')).toMatchObject({ status: 'error', openId: null });
  const audit = await db.prepare("SELECT COALESCE(after_json,'') || COALESCE(before_json,'') AS j FROM audit_log WHERE command = 'linkLark'").all<{ j: string }>();
  expect(audit.results).toHaveLength(2);
  for (const a of audit.results) expect(a.j).not.toContain(FAKE_SECRET);
});

test('a Lark outage keeps an existing link', async () => {
  await db.prepare("UPDATE app_user SET lark_open_id = 'ou_lan', lark_link_status = 'linked' WHERE id = 'u-lan'").run();
  fakeLark({}, { code: 99991663, msg: 'app access token invalid' });
  const r = await link({ userIds: ['u-lan', 'u-hung'] });
  expect(r.json.data).toMatchObject({ error: 2 });
  expect(await larkState('u-lan')).toMatchObject({ status: 'linked', openId: 'ou_lan' });
  expect(await larkState('u-hung')).toMatchObject({ status: 'error' });
});

test('missing Lark app settings are reported as error', async () => {
  const spy = fakeLark({});
  const r = await link({ userIds: ['u-lan'] }, { LARK_APP_ID: '', LARK_APP_SECRET: '' });
  expect(r.json.data).toMatchObject({ error: 1, message: 'Chưa cấu hình app Lark' });
  expect(spy).not.toHaveBeenCalled();
});

test('an open_id already held by someone else is not linked twice', async () => {
  await db.prepare("UPDATE app_user SET lark_open_id = 'ou_shared', lark_link_status = 'linked' WHERE id = 'u-long'").run();
  fakeLark({ 'lan@demo.abm.example': 'ou_shared' });
  const r = await link({ userIds: ['u-lan'] });
  expect(r.json.data).toMatchObject({ linked: 0, error: 1, message: 'open_id đã gắn cho người khác' });
  expect(await larkState('u-lan')).toMatchObject({ status: 'error', openId: null });
});

test('only admin can link Lark accounts', async () => {
  fakeLark({});
  expect((await call('u-lan', '/admin/lark/link', {})).status).toBe(403);
});

test('changing the email clears the Lark link', async () => {
  fakeLark({ 'lan@demo.abm.example': 'ou_test_lan' });
  await link({ userIds: ['u-lan'] });
  const { version } = (await db.prepare("SELECT version FROM app_user WHERE id = 'u-lan'").first<{ version: number }>())!;
  const r = await call('u-admin', '/admin/users/u-lan', { version, email: 'lan.moi@demo.abm.example' }, lark, 'PATCH');
  expect(r.status).toBe(200);
  expect(await larkState('u-lan')).toMatchObject({ status: 'unlinked', openId: null, checkedAt: null });
});
