import { env, applyD1Migrations } from 'cloudflare:test';
import { beforeEach, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';

const db = env.DB;
const tables = ['_guard', 'idempotency_key', 'outbox', 'audit_log', 'approval', 'activity', 'task', 'lead', 'lead_counter',
  'contact_point', 'account_contact', 'contact', 'account', 'app_user', 'team', 'department', 'organization'];
beforeEach(async () => {
  await applyD1Migrations(db, env.TEST_MIGRATIONS);
  await db.batch(tables.map(t => db.prepare(`DELETE FROM ${t}`)));
  await db.batch(seedSql.split('\n').filter(l => l.startsWith('INSERT')).map(l => db.prepare(l)));
});
async function call(user: string | undefined, path: string, body?: unknown, mode = '1', key = crypto.randomUUID()) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Idempotency-Key': key };
  if (user !== undefined) headers['X-Demo-User'] = user;
  const res = await app.fetch(new Request(`http://crm.test/api${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), { ...env, DEMO_MODE: mode });
  return { status: res.status, json: await res.json() as any };
}
const cmd = (user: string, name: string, body: unknown, key?: string) => call(user, `/commands/${name}`, body, '1', key);
const count = async (table: string) => (await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first<{ n: number }>())!.n;
const roles = ['u-lan', 'u-hung', 'u-head', 'u-bgd', 'u-admin'];

test('identity rejects absent, unknown, disabled actors and every non-demo mode', async () => {
  for (const user of [undefined, '', 'missing', "' OR 1=1 --"]) expect((await call(user, '/me')).status).toBe(401);
  await db.prepare("UPDATE app_user SET status='disabled' WHERE id='u-lan'").run();
  expect((await call('u-lan', '/me')).json.error.code).toBe('UNAUTHENTICATED');
  expect((await call(undefined, '/demo-users')).json.data.some((u: any) => u.id === 'u-lan')).toBe(false);
  for (const mode of ['0', '', 'true', '01']) {
    expect((await call('u-hung', '/me', undefined, mode)).status).toBe(401);
    expect((await call(undefined, '/demo-users', undefined, mode)).status).toBe(403);
  }
  expect((await call(undefined, '/health')).status).toBe(200);
});

test.each(roles)('read routes retain own/team/department/org scope for %s', async user => {
  const ids = (await call(user, '/leads')).json.data.map((l: any) => l.id);
  const allowed = new Set(ids);
  expect(ids.length).toBeGreaterThan(0);
  const tasks = (await call(user, '/tasks')).json.data;
  expect(tasks.every((t: any) => allowed.has(t.lead.id))).toBe(true);
  const approvals = (await call(user, '/approvals')).json.data;
  expect(approvals.every((a: any) => allowed.has(a.lead.id))).toBe(true);
  const accounts = (await call(user, '/accounts')).json.data;
  const visibleAccounts = new Set((await call(user, '/leads')).json.data.map((l: any) => l.account?.id));
  expect(accounts.every((a: any) => visibleAccounts.has(a.id))).toBe(true);
  const detail = (await call(user, `/leads/${ids[0]}`)).json.data;
  expect(detail.lead.id).toBe(ids[0]);
  expect(detail.contactPoints.length).toBeGreaterThan(0);
  const account = (await call(user, `/accounts/${accounts[0].id}`)).json.data;
  expect(account.leads.length).toBeGreaterThan(0);
  expect(account.leads.every((l: any) => allowed.has(l.id))).toBe(true);
  expect(account.activities.every((a: any) => allowed.has(a.leadId))).toBe(true);
  const search = (await call(user, '/search?q=Demo')).json.data;
  expect(search.leads.every((l: any) => allowed.has(l.id))).toBe(true);
  expect(search.accounts.every((a: any) => visibleAccounts.has(a.id))).toBe(true);
  const dashboard = (await call(user, '/dashboard')).json.data;
  expect(dashboard.attention.every((l: any) => allowed.has(l.id))).toBe(true);
  expect(dashboard.upcoming.every((t: any) => allowed.has(t.lead.id))).toBe(true);
  expect((await call(user, '/me')).json.data.id).toBe(user);
  expect((await call(user, '/team-members')).json.data.every((u: any) => ['u-lan', 'u-long', 'u-hung'].includes(u.id))).toBe(true);
  expect((await call(user, '/admin/overview')).status).toBe(user === 'u-admin' ? 200 : 403);
  if (user === 'u-lan') expect(ids).not.toContain('lead-09');
  if (user === 'u-hung') expect(ids).not.toContain('lead-10');
  if (user === 'u-admin') {
    // Admin oversees the whole organization read-only, the same lead set as BGĐ.
    const director = (await call('u-bgd', '/leads')).json.data.map((l: any) => l.id);
    expect([...ids].sort()).toEqual([...director].sort());
    expect(detail.permissions).toMatchObject({ logActivity: false, changeStage: false, completeTask: false, assign: false });
  }
});

test.each(roles)('command role restrictions run before input parsing for %s', async user => {
  const allowed: Record<string, string[]> = {
    createLead: roles.slice(0, 4), assignLead: ['u-hung'], releaseLead: ['u-hung'],
    logActivity: roles.slice(0, 4), completeTask: roles.slice(0, 4), changeStage: roles.slice(0, 4),
    requestOwnerChange: ['u-lan'], decideApproval: ['u-lan', 'u-hung'],
  };
  for (const [name, users] of Object.entries(allowed)) {
    const res = await cmd(user, name, {});
    expect(res.status).toBe(users.includes(user) ? 422 : 403);
    expect(res.json.error.code).toBe(users.includes(user) ? 'VALIDATION_FAILED' : 'FORBIDDEN');
  }
});

test.each(['u-lan', 'u-hung'])('detail IDOR is denied for %s', async user => {
  for (const path of ['/leads/lead-10', '/accounts/acc-10', '/leads/missing', '/accounts/missing']) {
    const res = await call(user, path);
    expect(res.status).toBe(404);
    expect(res.json).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy trong phạm vi của bạn' } });
  }
  if (user === 'u-lan') expect((await call(user, '/audit')).status).toBe(403);
});

const foreignCommands: Array<[string, Record<string, unknown>]> = [
  ['assignLead', { leadId: 'lead-10', expectedVersion: 1, ownerUserId: 'u-lan' }],
  ['releaseLead', { leadId: 'lead-10', expectedVersion: 1, reason: 'test' }],
  ['logActivity', { leadId: 'lead-10', expectedVersion: 1, type: 'note', summary: 'test' }],
  ['completeTask', { taskId: 'task-10', expectedVersion: 1 }],
  ['changeStage', { leadId: 'lead-10', expectedVersion: 1, toStage: 'lost', lostReason: 'price' }],
  ['requestOwnerChange', { leadId: 'lead-10', expectedVersion: 1, toUserId: 'u-long', reason: 'test' }],
  ['decideApproval', { approvalId: 'apv-3', expectedVersion: 1, decision: 'approve' }],
];
test.each(['u-lan', 'u-hung', 'u-admin'])('every targeted command denies foreign records without effects for %s', async user => {
  const before = await Promise.all(['audit_log', 'outbox', 'idempotency_key'].map(count));
  for (const [name, body] of foreignCommands) {
    const res = await cmd(user, name, body);
    expect([403, 404]).toContain(res.status);
    expect(['FORBIDDEN', 'NOT_FOUND']).toContain(res.json.error.code);
  }
  expect(await Promise.all(['audit_log', 'outbox', 'idempotency_key'].map(count))).toEqual(before);
  expect((await cmd('u-admin', 'createLead', { contactName: 'Test', phone: '0911222333', source: 'self', needSummary: 'test' })).status).toBe(403);
});

test('invalid command input and long idempotency keys write nothing', async () => {
  const before = await count('audit_log');
  for (const body of [null, {}, { leadId: 'lead-04', expectedVersion: -1, toStage: 'qualified' },
    { leadId: 'x'.repeat(65), expectedVersion: 1, toStage: 'qualified' }]) {
    expect((await cmd('u-lan', 'changeStage', body)).status).toBe(422);
  }
  for (const body of [
    { leadId: 'lead-04', expectedVersion: 1, type: 'note', summary: 'x'.repeat(2001) },
    { leadId: 'lead-04', expectedVersion: 1, type: 'note', summary: 'test', occurredAt: 'invalid' },
  ]) expect((await cmd('u-lan', 'logActivity', body)).status).toBe(422);
  expect((await cmd('u-lan', 'changeStage', { leadId: 'lead-04', expectedVersion: 1, toStage: 'qualified' }, 'x'.repeat(101))).status).toBe(422);
  expect((await cmd('u-lan', 'unknown', {})).status).toBe(404);
  expect(await count('audit_log')).toBe(before);
});

test('malformed JSON and absent idempotency key return validation errors without effects', async () => {
  const before = await count('audit_log');
  for (const [body, key] of [['{', 'key'], [JSON.stringify({ leadId: 'lead-04', expectedVersion: 1, toStage: 'qualified' }), '']]) {
    const res = await app.fetch(new Request('http://crm.test/api/commands/changeStage', {
      method: 'POST', headers: { 'X-Demo-User': 'u-lan', 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body,
    }), { ...env, DEMO_MODE: '1' });
    expect(res.status).toBe(422);
    expect((await res.json() as any).error.code).toBe('VALIDATION_FAILED');
  }
  expect(await count('audit_log')).toBe(before);
});

test('hostile query values cannot broaden scope or cause SQL errors', async () => {
  for (const q of ["' OR 1=1 --", '%', '_']) {
    for (const path of [`/leads?stage=${encodeURIComponent(q)}`, `/leads?q=${encodeURIComponent(q)}&page=-1&limit=-10&tab=${encodeURIComponent(q)}`,
      `/accounts?q=${encodeURIComponent(q)}`, `/search?q=${encodeURIComponent(q)}`, `/approvals?status=${encodeURIComponent(q)}`]) {
      const res = await call('u-admin', path);
      expect(res.status).toBe(200);
      expect(res.json.data).toEqual(path.startsWith('/search') ? { leads: [], accounts: [] } : []);
      const sale = await call('u-lan', path);
      expect(sale.status).toBe(200);
      const leads = path.startsWith('/search') ? sale.json.data.leads : path.startsWith('/leads') ? sale.json.data : [];
      expect(leads.every((l: any) => l.owner.id === 'u-lan')).toBe(true);
    }
  }
});

test('head and director cannot read or write records outside department and organization', async () => {
  await db.prepare("INSERT INTO department(id,organization_id,name,created_at,updated_at) VALUES('dep-other','org-abm','Other','2026-01-01','2026-01-01')").run();
  await db.prepare("UPDATE lead SET department_id='dep-other' WHERE id='lead-10'").run();
  expect((await call('u-head', '/leads/lead-10')).status).toBe(404);
  expect((await call('u-head', '/accounts/acc-10')).status).toBe(404);
  expect((await cmd('u-head', 'logActivity', { leadId: 'lead-10', expectedVersion: 1, type: 'note', summary: 'test' })).status).toBe(404);
  await db.prepare("INSERT INTO organization(id,name,created_at,updated_at) VALUES('org-other','Other','2026-01-01','2026-01-01')").run();
  await db.prepare("UPDATE department SET organization_id='org-other' WHERE id='dep-other'").run();
  await db.prepare("UPDATE lead SET organization_id='org-other' WHERE id='lead-10'").run();
  for (const user of roles) {
    expect((await call(user, '/leads/lead-10')).status).toBe(404);
    expect((await call(user, '/leads')).json.data.some((l: any) => l.id === 'lead-10')).toBe(false);
    expect((await call(user, '/tasks')).json.data.some((t: any) => t.lead.id === 'lead-10')).toBe(false);
    const res = await cmd(user, 'logActivity', { leadId: 'lead-10', expectedVersion: 1, type: 'note', summary: 'test' });
    expect([403, 404]).toContain(res.status);
  }
});
