import { env, applyD1Migrations } from 'cloudflare:test';
import { ACTIVE_STAGES } from '@abm/contracts';
import { beforeEach, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';

const db = env.DB;
const TABLES = ['agent_token', 'user_session', '_guard', 'idempotency_key', 'outbox', 'audit_log', 'approval', 'activity', 'task', 'lead',
  'lead_counter', 'contact_point', 'account_contact', 'contact', 'account', 'app_user', 'team', 'department', 'organization'];

beforeEach(async () => {
  await applyD1Migrations(db, env.TEST_MIGRATIONS);
  await db.batch(TABLES.map((t) => db.prepare(`DELETE FROM ${t}`)));
  await db.batch(seedSql.split('\n').filter((line) => line.startsWith('INSERT')).map((line) => db.prepare(line)));
});

async function get(user: string, path: string) {
  const response = await app.fetch(new Request(`http://crm.test/api${path}`, { headers: { 'X-Demo-User': user } }), { ...env, DEMO_MODE: '1' });
  return { status: response.status, body: (await response.json()) as { data?: any; error?: { code: string } } };
}
const overview = async (user = 'u-admin', query = '') => (await get(user, `/overview${query}`)).body.data;
const count = async (sql: string) => (await db.prepare(sql).first<{ n: number }>())!.n;
const addDepartment = (id: string) => db.prepare(`INSERT INTO department (id, organization_id, name, created_at, updated_at)
  VALUES (?, 'org-abm', 'Phòng thử', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`).bind(id).run();

test('only admin and director can open the overview', async () => {
  for (const user of ['u-admin', 'u-bgd']) expect((await get(user, '/overview')).status).toBe(200);
  for (const user of ['u-head', 'u-hung', 'u-lan']) {
    const res = await get(user, '/overview');
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FORBIDDEN');
  }
});

test('overview counts match the database', async () => {
  const data = await overview();
  expect(data.kpi.openLeads).toBe(await count("SELECT COUNT(*) AS n FROM lead WHERE status = 'active'"));
  expect(data.kpi.queueLeads).toBe(await count("SELECT COUNT(*) AS n FROM lead WHERE status = 'queue'"));
  const columns = data.columns as { key: string; count: number }[];
  expect(columns.map((c) => c.key)).toEqual(['queue', ...ACTIVE_STAGES, 'won', 'lost']);
  const activeSum = columns.filter((c) => (ACTIVE_STAGES as readonly string[]).includes(c.key)).reduce((s, c) => s + c.count, 0);
  expect(activeSum).toBe(data.kpi.openLeads);
  expect(columns.find((c) => c.key === 'queue')!.count).toBe(data.kpi.queueLeads);
  expect(data.truncated).toBeNull();
});

test('a director placed in a department still sees the whole organization', async () => {
  await db.prepare("UPDATE app_user SET department_id = 'dep-kd' WHERE id = 'u-bgd'").run();
  expect((await overview('u-bgd')).kpi).toEqual((await overview('u-admin')).kpi);
});

test('the department filter narrows every count', async () => {
  await addDepartment('dep-x');
  const all = await overview();
  const empty = await overview('u-admin', '?department=dep-x');
  expect(empty.departmentId).toBe('dep-x');
  expect([empty.kpi.openLeads, empty.kpi.queueLeads, empty.kpi.pendingApprovals]).toEqual([0, 0, 0]);
  expect((await overview('u-admin', '?department=dep-kd')).kpi.openLeads).toBe(all.kpi.openLeads);
  expect((await overview('u-admin', '?department=khong-ton-tai')).departmentId).toBeNull();
});

test('win rate counts only leads closed in the period', async () => {
  const now = new Date().toISOString();
  await db.prepare("UPDATE lead SET closed_at = '2000-01-01T00:00:00Z' WHERE status IN ('won', 'lost')").run();
  await db.prepare("UPDATE lead SET status = 'won', stage = 'won', closed_at = ? WHERE id IN ('lead-14', 'lead-15')").bind(now).run();
  await db.prepare("UPDATE lead SET status = 'lost', stage = 'lost', lost_reason = 'price', closed_at = ? WHERE id = 'lead-13'").bind(now).run();
  const { kpi } = await overview();
  expect([kpi.wonCount, kpi.lostCount]).toEqual([2, 1]);
  expect(kpi.winRate).toBeCloseTo(2 / 3);
});

test('overview never carries customer contact details', async () => {
  const text = JSON.stringify(await overview());
  const points = (await db.prepare('SELECT value FROM contact_point').all<{ value: string }>()).results;
  expect(points.length).toBeGreaterThan(0);
  for (const p of points) expect(text).not.toContain(p.value);
  for (const key of ['"before"', '"after"', '"phone"', '"email"']) expect(text).not.toContain(key);
});

test('unknown period falls back to month', async () => {
  const data = await overview('u-admin', '?period=abc');
  expect(data.period.key).toBe('month');
  expect(data.period.start).toMatch(/^\d{4}-\d{2}-01$/);
  expect((await overview('u-admin', '?period=year')).period.start).toMatch(/^\d{4}-01-01$/);
});

test('matrix rows add up to the open leads', async () => {
  const data = await overview();
  const total = (rows: { cells: { count: number }[] }[]) => rows.reduce((s, r) => s + r.cells.reduce((t, c) => t + c.count, 0), 0);
  expect(total(data.matrix.departments)).toBe(data.kpi.openLeads);
  expect(total(data.matrix.teams)).toBeLessThanOrEqual(data.kpi.openLeads);
  expect(data.matrix.teams.map((t: { id: string }) => t.id).sort()).toEqual(['team-kd1', 'team-kd2']);
});

test('recent audit shows who did what without the change details', async () => {
  const res = await app.fetch(new Request('http://crm.test/api/commands/logActivity', {
    method: 'POST',
    headers: { 'X-Demo-User': 'u-lan', 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ leadId: 'lead-04', expectedVersion: 1, type: 'note', summary: 'ghi chú' }),
  }), { ...env, DEMO_MODE: '1' });
  expect(res.status).toBe(200);
  const audit = (await overview()).recentAudit;
  expect(audit.length).toBeGreaterThan(0);
  expect(audit[0]).toMatchObject({ command: 'logActivity', leadCode: 'L-0004', actorKind: 'human' });
  expect(Object.keys(audit[0]).sort()).toEqual(['actorKind', 'actorName', 'command', 'createdAt', 'entity', 'id', 'leadCode', 'leadId']);
});

test('leads can be filtered by department', async () => {
  await addDepartment('dep-x');
  const all = (await get('u-admin', '/leads?status=active')).body.data as unknown[];
  expect((await get('u-admin', '/leads?status=active&department=dep-x')).body.data).toEqual([]);
  expect(((await get('u-admin', '/leads?status=active&department=dep-kd')).body.data as unknown[]).length).toBe(all.length);
});
