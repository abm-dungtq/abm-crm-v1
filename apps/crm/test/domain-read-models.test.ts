import { env, applyD1Migrations } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';

const db = env.DB;
const TABLES = ['_guard', 'idempotency_key', 'outbox', 'audit_log', 'approval', 'activity', 'task', 'lead', 'lead_counter',
  'contact_point', 'account_contact', 'contact', 'account', 'app_user', 'team', 'department', 'organization'];

beforeEach(async () => {
  await applyD1Migrations(db, env.TEST_MIGRATIONS);
  await db.batch(TABLES.map((t) => db.prepare(`DELETE FROM ${t}`)));
  await db.batch(seedSql.split('\n').filter((line) => line.startsWith('INSERT')).map((line) => db.prepare(line)));
});

async function get(user: string, path: string) {
  const response = await app.fetch(new Request(`http://crm.test/api${path}`, { headers: { 'X-Demo-User': user } }), { ...env, DEMO_MODE: '1' });
  return { status: response.status, data: ((await response.json()) as { data?: any }).data };
}
async function post(user: string, name: string, body: unknown) {
  const response = await app.fetch(new Request(`http://crm.test/api/commands/${name}`, {
    method: 'POST',
    headers: { 'X-Demo-User': user, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(body),
  }), { ...env, DEMO_MODE: '1' });
  return (await response.json()) as { ok: boolean; data?: any };
}

const HOUR = 3_600_000;
/** Current calendar date in Vietnam (YYYY-MM-DD). */
const vnToday = () => new Date(Date.now() + 7 * HOUR).toISOString().slice(0, 10);
const addTask = (id: string, leadId: string, assignee: string, dueAt: Date) => {
  const now = new Date().toISOString();
  return db.prepare(`INSERT INTO task (id, lead_id, title, due_at, assignee_user_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`).bind(id, leadId, `Việc ${id}`, dueAt.toISOString(), assignee, now, now).run();
};

describe('task buckets', () => {
  test('overdue, today and upcoming follow the Vietnam calendar day', async () => {
    const today = vnToday();
    await addTask('t-overdue', 'lead-04', 'u-lan', new Date(Date.now() - 60_000));
    await addTask('t-today', 'lead-04', 'u-lan', new Date(`${today}T23:59:59+07:00`));
    // 00:30 tomorrow in Vietnam is still "today" in UTC; it must not count as today.
    await addTask('t-tomorrow', 'lead-04', 'u-lan', new Date(new Date(`${today}T00:30:00+07:00`).getTime() + 24 * HOUR));
    const tasks = (await get('u-lan', '/tasks')).data as any[];
    const bucket = (id: string) => tasks.find((t) => t.id === id)?.bucket;
    expect([bucket('t-overdue'), bucket('t-today'), bucket('t-tomorrow')]).toEqual(['overdue', 'today', 'upcoming']);

    const dashboard = (await get('u-lan', '/dashboard')).data;
    expect(dashboard.kpi.tasksToday).toBe(tasks.filter((t) => t.bucket === 'today').length);
    expect(dashboard.kpi.overdueTasks).toBe(tasks.filter((t) => t.bucket === 'overdue').length);
  });

  test('a Sale sees only tasks assigned to them; a leader sees the team; completed tasks are listed as done', async () => {
    const sale = (await get('u-lan', '/tasks')).data as any[];
    expect(sale.length).toBeGreaterThan(0);
    expect(sale.every((t) => t.assignee.id === 'u-lan')).toBe(true);
    const leader = (await get('u-hung', '/tasks')).data as any[];
    expect(new Set(leader.map((t) => t.assignee.id))).toEqual(new Set(['u-lan', 'u-long']));

    await post('u-lan', 'completeTask', { taskId: 'task-4', expectedVersion: 1, nextAction: { title: 'Tiếp', dueAt: new Date(Date.now() + 48 * HOUR).toISOString() } });
    const done = (await get('u-lan', '/tasks?status=completed')).data as any[];
    expect(done.find((t) => t.id === 'task-4')).toMatchObject({ bucket: 'done', status: 'completed' });
    expect(((await get('u-lan', '/tasks')).data as any[]).some((t) => t.id === 'task-4')).toBe(false);
  });
});

describe('dashboard', () => {
  test('counts and money match the leads each role can see', async () => {
    const expected = { 'u-lan': { active: 6, queue: 0 }, 'u-hung': { active: 10, queue: 3 }, 'u-head': { active: 15, queue: 3 }, 'u-bgd': { active: 15, queue: 3 } };
    for (const [user, counts] of Object.entries(expected)) {
      const { kpi, pipeline, bySale } = (await get(user, '/dashboard')).data;
      const active = ((await get(user, '/leads?status=active')).data as any[]);
      expect(kpi.activeLeads, user).toBe(counts.active);
      expect(active.length, user).toBe(counts.active);
      expect(kpi.queueLeads, user).toBe(counts.queue);
      expect(pipeline.reduce((s: number, p: any) => s + p.count, 0), user).toBe(counts.active);
      const value = active.reduce((s, l) => s + (l.expectedValue ?? 0), 0);
      expect(kpi.pipelineValue, user).toBe(value);
      expect(pipeline.reduce((s: number, p: any) => s + p.value, 0), user).toBe(value);
      expect(bySale.length === 0, user).toBe(user === 'u-lan');
    }
    expect((await get('u-lan', '/dashboard')).data.kpi.pipelineValue).toBe(1_065_000_000);
  });

  test('Won and Lost of the month use the Vietnam month boundary', async () => {
    const monthStart = `${vnToday().slice(0, 7)}-01`;
    const firstMinute = new Date(`${monthStart}T00:30:00+07:00`).toISOString();
    const lastMonth = new Date(new Date(`${monthStart}T00:00:00+07:00`).getTime() - 60_000).toISOString();
    await db.batch([
      db.prepare(`UPDATE lead SET closed_at = ? WHERE id = 'lead-16'`).bind(firstMinute),
      db.prepare(`UPDATE lead SET closed_at = ? WHERE id = 'lead-18'`).bind(lastMonth),
      db.prepare(`UPDATE lead SET closed_at = ? WHERE id = 'lead-19'`).bind(new Date().toISOString()),
    ]);
    const { kpi, lostReasons } = (await get('u-hung', '/dashboard')).data;
    expect(kpi).toMatchObject({ wonCount: 1, wonValue: 260_000_000, lostCount: 1 });
    expect(lostReasons).toEqual([{ code: 'competitor', count: 1 }]);
  });

  test('large VND amounts add up exactly in the dashboard and account list', async () => {
    await db.batch([
      db.prepare(`UPDATE lead SET expected_value = 9000000000000 WHERE id = 'lead-04'`),
      db.prepare(`UPDATE lead SET expected_value = 1 WHERE id = 'lead-06'`),
    ]);
    expect((await get('u-lan', '/dashboard')).data.kpi.pipelineValue).toBe(9_000_760_000_001);
    const account = ((await get('u-lan', '/accounts')).data as any[]).find((a) => a.id === 'acc-4');
    expect(account.pipelineValue).toBe(9_000_000_000_000);
  });
});

describe('search', () => {
  test('needs at least two characters', async () => {
    expect((await get('u-lan', '/search?q=L')).data).toEqual({ leads: [], accounts: [] });
  });

  test('finds leads by code, formatted phone, email and company within scope', async () => {
    const codes = async (q: string, user = 'u-lan') => ((await get(user, `/search?q=${encodeURIComponent(q)}`)).data.leads as any[]).map((l) => l.code);
    expect(await codes('L-0004')).toEqual(['L-0004']);
    expect(await codes('0900 100 004')).toEqual(['L-0004']);
    const created = await post('u-lan', 'createLead', {
      contactName: 'Chị Mai', email: 'chi.mai@khach.example', source: 'self', needSummary: 'Hỏi giá',
      nextAction: { title: 'Gọi', dueAt: new Date(Date.now() + 48 * HOUR).toISOString() },
    });
    expect(created.ok).toBe(true);
    expect(await codes('CHI.MAI@khach')).toEqual(['L-0023']);
    expect(await codes('dược phẩm lộc thọ')).toEqual(['L-0004']);
    expect(await codes('Thời trang Mộc')).toEqual([]);
    expect(await codes('Thời trang Mộc', 'u-mai')).toEqual(['L-0010']);
    expect((await get('u-lan', `/search?q=${encodeURIComponent('Thời trang Mộc')}`)).data.accounts).toEqual([]);
  });
});

describe('account detail scope', () => {
  test('shows only the leads, contacts and activities the viewer can see', async () => {
    const created = await post('u-long', 'createLead', {
      contactName: 'Người liên hệ mới', phone: '0977000555', taxCode: '0310000004', confirmNotDuplicate: true,
      source: 'self', needSummary: 'Mua thêm', nextAction: { title: 'Gọi', dueAt: new Date(Date.now() + 48 * HOUR).toISOString() },
    });
    expect(created.ok).toBe(true);
    await post('u-long', 'logActivity', { leadId: created.data.leadId, expectedVersion: 1, type: 'call', summary: 'Đã gọi' });

    const views = {
      'u-lan': ['L-0004'],
      'u-long': ['L-0023'],
      'u-bgd': ['L-0004', 'L-0023'],
    };
    for (const [user, codes] of Object.entries(views)) {
      const detail = (await get(user, '/accounts/acc-4')).data;
      const visible = new Set((detail.leads as any[]).map((l) => l.id));
      expect((detail.leads as any[]).map((l) => l.code).sort(), user).toEqual(codes);
      expect((detail.activities as any[]).every((a) => visible.has(a.leadId)), user).toBe(true);
      expect((detail.contacts as any[]).length, user).toBe(codes.length);
    }
    expect((await get('u-long', '/accounts/acc-4')).data.contacts[0].name).toBe('Người liên hệ mới');
    expect((await get('u-lan', '/accounts/acc-10')).status).toBe(404);
    expect((await get('u-admin', '/accounts/acc-4')).status).toBe(404);
  });
});
