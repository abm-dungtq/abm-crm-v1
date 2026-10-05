import { env } from 'cloudflare:test';
import { beforeEach, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';
import { listAccounts, listLeads } from '../src/worker/queries';
import { runCommand } from '../src/worker/commands';
import type { Actor } from '../src/worker/env';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
const admin: Actor = { id: 'u-admin', role: 'admin', organizationId: 'org-abm', departmentId: null, teamId: null, displayName: 'Admin', kind: 'human' };
beforeEach(() => resetDb(db, seedSql));
async function get(path: string, user = 'u-admin') {
  const response = await app.fetch(new Request(`http://crm.test/api${path}`, { headers: { 'X-Demo-User': user } }), { ...env, DEMO_MODE: '1' });
  expect(response.status).toBe(200);
  return (await response.json() as { data: any }).data;
}
async function addLeads(n: number) {
  await db.prepare(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < ?)
    INSERT INTO lead (id, code, organization_id, department_id, contact_id, source, need_summary, stage, status, stage_entered_at, created_at, updated_at)
    SELECT 'bulk-' || n, 'B-' || n, 'org-abm', 'dep-kd', 'ct-4', 'self', 'Bulk search marker', 'new', 'queue',
      '2099-01-01T00:00:00Z', '2099-01-01T00:00:00Z', '2099-01-01T00:00:00Z' FROM numbers`).bind(n).run();
}

test('dashboard KPI and pipeline include leads older than the 500 row preview', async () => {
  const before = await get('/dashboard');
  await addLeads(520);
  const data = await get('/dashboard');
  expect(data.kpi.activeLeads).toBe(before.kpi.activeLeads);
  expect(data.kpi.pipelineValue).toBe(before.kpi.pipelineValue);
  expect(data.kpi.queueLeads).toBe(before.kpi.queueLeads + 520);
  expect([data.kpi.wonCount, data.kpi.wonValue, data.kpi.lostCount]).toEqual([before.kpi.wonCount, before.kpi.wonValue, before.kpi.lostCount]);
  expect(data.pipeline).toEqual(before.pipeline);
  expect(data.bySale.map((s: any) => [s.id, s.active, s.value])).toEqual(before.bySale.map((s: any) => [s.id, s.active, s.value]));
  expect(data.truncated.leads).toMatchObject({ shown: 500, total: 542 });
  expect((await get('/dashboard', 'u-lan')).kpi.activeLeads).toBe(6);
});

test('page view preserves legacy arrays and counts all scoped statuses before the page limit', async () => {
  await addLeads(520);
  expect(await get('/leads')).toHaveLength(500);
  const page = await get('/leads?view=page&status=active');
  expect(page.items).toHaveLength(15);
  expect(page.counts).toMatchObject({ active: 15, queue: 523, all: 542 });
  expect(page.truncated).toBe(false);
  const queue = await get('/leads?view=page&status=queue');
  expect(queue.items).toHaveLength(500);
  expect(queue.truncated).toBe(true);
  const sale = await get('/leads?view=page', 'u-lan');
  expect(sale.counts).toMatchObject({ active: 6, queue: 0 });
});

test('page filters find old leads using folded names, owner and phone within scope', async () => {
  await addLeads(520);
  for (const q of ['duoc pham loc tho', '0900 100 004', 'do ngoc lan']) {
    const page = await get(`/leads?view=page&status=active&q=${encodeURIComponent(q)}&stage=contacted&department=dep-kd`);
    expect(page.items.some((l: any) => l.id === 'lead-04')).toBe(true);
  }
  expect((await get('/leads?view=page&status=active&department=outside')).items).toEqual([]);
});

// Observe real D1 result sizes without replacing SQL execution with a test double.
function observedDb() {
  const reads: { sql: string; count: number; rows: any[] }[] = [];
  const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => new Proxy(statement, {
    get(target, key) {
      if (key === 'bind') return (...args: unknown[]) => wrap(target.bind(...args), sql);
      if (key === 'all') return async () => {
        const result = await target.all();
        reads.push({ sql, count: result.results.length, rows: result.results });
        return result;
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const observed = new Proxy(db, { get(target, key) {
    if (key === 'prepare') return (sql: string) => wrap(target.prepare(sql), sql);
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  return { observed, reads };
}

test('lead keyword reads are bounded before Worker filtering and do not pull contact point values', async () => {
  await addLeads(2100);
  const { observed, reads } = observedDb();
  expect(await listLeads(observed, admin, { q: 'Bulk search marker' })).toHaveLength(500);
  expect(Math.max(...reads.map((r) => r.count))).toBeLessThanOrEqual(2000);
  expect(reads.flatMap((r) => r.rows).some((r) => 'points' in r || 'normalized_value' in r)).toBe(false);
  const page = await get('/leads?view=page&q=Bulk');
  expect(page.truncated).toBe(true);
  expect(page.counts).toBeNull();
});

test('account search can find a customer beyond the default 300 rows and still caps candidate reads', async () => {
  await db.prepare(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 320)
    INSERT INTO account (id, organization_id, name, created_at, updated_at)
    SELECT 'account-' || n, 'org-abm', 'AAA ' || n, '2099-01-01T00:00:00Z', '2099-01-01T00:00:00Z' FROM numbers`).run();
  await addLeads(320);
  await db.prepare("UPDATE lead SET account_id = 'account-' || substr(id, 6), last_activity_at = '2099-01-01T00:00:00Z' WHERE id LIKE 'bulk-%'").run();
  expect((await get('/accounts')).some((a: any) => a.id === 'acc-4')).toBe(false);
  expect(await get('/accounts')).toHaveLength(300);
  const page = await get('/accounts?view=page&q=duoc pham loc tho');
  expect(page.items.some((a: any) => a.id === 'acc-4')).toBe(true);
  expect(page.truncated).toBe(false);
  expect((await get('/accounts?view=page')).truncated).toBe(true);
});

test('account keyword queries never transfer more than 2000 candidate rows to Worker', async () => {
  await db.prepare(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 2100)
    INSERT INTO account (id, organization_id, name, created_at, updated_at)
    SELECT 'account-' || n, 'org-abm', 'Company ' || n, '2099-01-01T00:00:00Z', '2099-01-01T00:00:00Z' FROM numbers`).run();
  await addLeads(2100);
  await db.prepare("UPDATE lead SET account_id = 'account-' || substr(id, 6) WHERE id LIKE 'bulk-%'").run();
  const { observed, reads } = observedDb();
  expect(await listAccounts(observed, admin, 'Company')).toHaveLength(300);
  expect(Math.max(...reads.map((r) => r.count))).toBeLessThanOrEqual(2000);
  expect((await get('/accounts?view=page&q=Company')).truncated).toBe(true);
});

test('dashboard counts tasks beyond the 300 item list within each actor scope', async () => {
  await db.prepare(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 320)
    INSERT INTO task (id, lead_id, title, due_at, assignee_user_id, status, created_at, updated_at)
    SELECT 'task-bulk-' || n, 'lead-04', 'Past due', '2000-01-01T00:00:00Z', 'u-lan', 'open',
      '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z' FROM numbers`).run();
  const overdue = (await db.prepare("SELECT COUNT(*) AS n FROM task WHERE status = 'open' AND assignee_user_id = 'u-lan' AND due_at < ?")
    .bind(new Date().toISOString()).first<{ n: number }>())!.n;
  const data = await get('/dashboard', 'u-lan');
  expect(data.kpi.overdueTasks).toBe(overdue);
  expect(data.truncated.tasks.shown).toBe(300);
  expect(data.truncated.upcoming.shown).toBe(10);
  expect((await get('/dashboard', 'u-long')).kpi.overdueTasks).toBeLessThan(320);
});

test('creating a lead caps the company name scan without losing duplicate detection inside the window', async () => {
  await db.prepare(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 2100)
    INSERT INTO account (id, organization_id, name, created_at, updated_at)
    SELECT 'company-' || n, 'org-abm', 'Company ' || n, '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z' FROM numbers`).run();
  const { observed, reads } = observedDb();
  const company = (await db.prepare("SELECT name FROM account WHERE id = 'acc-4'").first<{ name: string }>())!.name;
  const result = await runCommand(observed, admin, 'createLead', {
    contactName: 'Test Customer', phone: '0912345678', companyName: company, departmentId: 'dep-kd', source: 'self', needSummary: 'Check duplicates',
  }, crypto.randomUUID());
  expect(result).toMatchObject({ ok: false, error: { code: 'DUPLICATE_SUSPECTED' } });
  const companyRead = reads.find((r) => r.sql.includes('SELECT id, name FROM account'))!;
  expect(companyRead.count).toBeLessThanOrEqual(2000);
});
