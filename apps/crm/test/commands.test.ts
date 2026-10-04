import { env, applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
      DEMO_MODE: string;
    }
  }
}

const db = env.DB;
const TABLES = ['_guard', 'idempotency_key', 'outbox', 'audit_log', 'approval', 'activity', 'task', 'lead', 'lead_counter',
  'contact_point', 'account_contact', 'contact', 'account', 'app_user', 'team', 'department', 'organization'];

beforeEach(async () => {
  await applyD1Migrations(db, env.TEST_MIGRATIONS);
  await db.batch(TABLES.map((t) => db.prepare(`DELETE FROM ${t}`)));
  await db.batch(seedSql.split('\n').filter((line) => line.startsWith('INSERT')).map((line) => db.prepare(line)));
});

type Json = { ok: boolean; data?: any; error?: { code: string; message: string; fields?: Record<string, string>; details?: any } };

async function call(user: string, method: string, path: string, body?: unknown, key: string = crypto.randomUUID()) {
  const response = await app.fetch(new Request(`http://crm.test/api${path}`, {
    method,
    headers: { 'X-Demo-User': user, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { ...env, DEMO_MODE: '1' });
  return { status: response.status, json: (await response.json()) as Json };
}
const command = (user: string, name: string, body: unknown, key?: string) => call(user, 'POST', `/commands/${name}`, body, key);
const lead = (id: string) => db.prepare('SELECT * FROM lead WHERE id = ?').bind(id).first<Record<string, any>>();
const count = async (table: string) => (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

describe('scope', () => {
  test('sale sees only own leads; leader sees team plus department queue; admin sees none', async () => {
    const sale = await call('u-lan', 'GET', '/leads');
    expect(sale.json.data.length).toBeGreaterThan(0);
    expect(sale.json.data.every((l: any) => l.owner?.id === 'u-lan')).toBe(true);

    const leader = await call('u-hung', 'GET', '/leads');
    const owners = new Set(leader.json.data.map((l: any) => l.owner?.id ?? 'queue'));
    expect([...owners].sort()).toEqual(['queue', 'u-lan', 'u-long']);

    const admin = await call('u-admin', 'GET', '/leads');
    expect(admin.json.data).toEqual([]);
    expect((await call('u-lan', 'GET', '/leads/lead-10')).status).toBe(404);
  });

  test('requests without a demo identity are rejected', async () => {
    const response = await app.fetch(new Request('http://crm.test/api/leads'), { ...env, DEMO_MODE: '1' });
    expect(response.status).toBe(401);
    const locked = await app.fetch(new Request('http://crm.test/api/leads', { headers: { 'X-Demo-User': 'u-lan' } }), { ...env, DEMO_MODE: '0' });
    expect(locked.status).toBe(401);
  });

  test('sale cannot assign leads', async () => {
    const r = await command('u-lan', 'assignLead', { leadId: 'lead-20', expectedVersion: 1, ownerUserId: 'u-lan' });
    expect(r.json.error?.code).toBe('FORBIDDEN');
  });
});

describe('stage changes', () => {
  test('stale expected version is rejected and writes nothing', async () => {
    const auditBefore = await count('audit_log');
    const r = await command('u-lan', 'changeStage', { leadId: 'lead-04', expectedVersion: 7, toStage: 'qualified' });
    expect(r.status).toBe(409);
    expect(r.json.error?.code).toBe('STALE_VERSION');
    expect(await count('audit_log')).toBe(auditBefore);
  });

  test('one step forward writes lead, activity, audit and outbox together', async () => {
    const before = { audit: await count('audit_log'), outbox: await count('outbox'), activity: await count('activity') };
    const r = await command('u-lan', 'changeStage', { leadId: 'lead-04', expectedVersion: 1, toStage: 'qualified' });
    expect(r.json.ok).toBe(true);
    const row = await lead('lead-04');
    expect(row).toMatchObject({ stage: 'qualified', version: 2 });
    expect(await count('audit_log')).toBe(before.audit + 1);
    expect(await count('outbox')).toBe(before.outbox + 1);
    expect(await count('activity')).toBe(before.activity + 1);
    expect(await count('_guard')).toBe(0);
  });

  test('skipping a stage and Won before Chờ chốt are rejected', async () => {
    expect((await command('u-lan', 'changeStage', { leadId: 'lead-04', expectedVersion: 1, toStage: 'consulting' })).json.error?.code).toBe('VALIDATION_FAILED');
    expect((await command('u-lan', 'changeStage', { leadId: 'lead-04', expectedVersion: 1, toStage: 'won' })).json.error?.code).toBe('VALIDATION_FAILED');
  });

  test('Lost requires a reason, and "Khác" requires a note; open tasks are cancelled', async () => {
    const missing = await command('u-lan', 'changeStage', { leadId: 'lead-04', expectedVersion: 1, toStage: 'lost' });
    expect(missing.json.error?.fields).toHaveProperty('lostReason');
    const other = await command('u-lan', 'changeStage', { leadId: 'lead-04', expectedVersion: 1, toStage: 'lost', lostReason: 'other' });
    expect(other.json.error?.fields).toHaveProperty('lostNote');
    const ok = await command('u-lan', 'changeStage', { leadId: 'lead-04', expectedVersion: 1, toStage: 'lost', lostReason: 'price' });
    expect(ok.json.ok).toBe(true);
    expect(await lead('lead-04')).toMatchObject({ status: 'lost', lost_reason: 'price', next_action_task_id: null });
    const open = await db.prepare(`SELECT COUNT(*) AS n FROM task WHERE lead_id = 'lead-04' AND status = 'open'`).first<{ n: number }>();
    expect(open!.n).toBe(0);
  });

  test('Lead mới needs a first contact before Đã liên hệ', async () => {
    const blocked = await command('u-lan', 'changeStage', { leadId: 'lead-01', expectedVersion: 1, toStage: 'contacted' });
    expect(blocked.json.error?.code).toBe('VALIDATION_FAILED');
    const logged = await command('u-lan', 'logActivity', { leadId: 'lead-01', expectedVersion: 1, type: 'call', summary: 'Gọi được, khách hẹn demo' });
    expect(logged.json.data.firstContact).toBe(true);
    const moved = await command('u-lan', 'changeStage', { leadId: 'lead-01', expectedVersion: 2, toStage: 'contacted' });
    expect(moved.json.ok).toBe(true);
  });

  test('concurrent changes on the same version: exactly one wins', async () => {
    const results = await Promise.all([
      command('u-lan', 'changeStage', { leadId: 'lead-04', expectedVersion: 1, toStage: 'qualified' }),
      command('u-hung', 'changeStage', { leadId: 'lead-04', expectedVersion: 1, toStage: 'lost', lostReason: 'no_response' }),
    ]);
    expect(results.filter((r) => r.json.ok)).toHaveLength(1);
    expect(results.filter((r) => r.json.error?.code === 'STALE_VERSION')).toHaveLength(1);
    expect((await lead('lead-04'))!.version).toBe(2);
  });

  test('replaying an Idempotency-Key returns the stored result without writing twice', async () => {
    const key = crypto.randomUUID();
    const body = { leadId: 'lead-04', expectedVersion: 1, toStage: 'qualified' };
    const first = await command('u-lan', 'changeStage', body, key);
    const audit = await count('audit_log');
    const second = await command('u-lan', 'changeStage', body, key);
    expect(second.json).toEqual(first.json);
    expect(await count('audit_log')).toBe(audit);
    const conflict = await command('u-lan', 'changeStage', { ...body, toStage: 'lost', lostReason: 'price' }, key);
    expect(conflict.json.error?.code).toBe('IDEMPOTENCY_CONFLICT');
  });
});

describe('forced next action', () => {
  test('completing the next action requires a replacement', async () => {
    const task = (await lead('lead-04'))!.next_action_task_id;
    const blocked = await command('u-lan', 'completeTask', { taskId: task, expectedVersion: 1, outcome: 'Đã gửi' });
    expect(blocked.json.error?.code).toBe('VALIDATION_FAILED');
    const due = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const done = await command('u-lan', 'completeTask', { taskId: task, expectedVersion: 1, outcome: 'Đã gửi', nextAction: { title: 'Gọi lại chốt lịch demo', dueAt: due } });
    expect(done.json.ok).toBe(true);
    const row = await lead('lead-04');
    expect(row!.next_action_task_id).toBe(done.json.data.nextTaskId);
    const next = await db.prepare('SELECT status, assignee_user_id FROM task WHERE id = ?').bind(row!.next_action_task_id).first();
    expect(next).toEqual({ status: 'open', assignee_user_id: 'u-lan' });
  });
});

describe('lead intake', () => {
  const base = { contactName: 'Khách Thử', source: 'website', needSummary: 'Cần tư vấn' };

  test('duplicate phone is flagged until confirmed', async () => {
    const dup = await command('u-hung', 'createLead', { ...base, phone: '+84 900 100 004' });
    expect(dup.status).toBe(409);
    expect(dup.json.error?.code).toBe('DUPLICATE_SUSPECTED');
    expect(dup.json.error?.details[0]).toMatchObject({ field: 'phone', code: 'L-0004' });
    const created = await command('u-hung', 'createLead', { ...base, phone: '+84 900 100 004', confirmNotDuplicate: true });
    expect(created.json.ok).toBe(true);
    const row = await lead(created.json.data.leadId);
    expect(row).toMatchObject({ status: 'queue', owner_user_id: null, code: 'L-0023' });
  });

  test('sale self-sourced lead needs a next action and becomes active', async () => {
    const missing = await command('u-lan', 'createLead', { ...base, phone: '0911222333', source: 'self' });
    expect(missing.json.error?.code).toBe('VALIDATION_FAILED');
    const ok = await command('u-lan', 'createLead', { ...base, phone: '0911222333', source: 'self', nextAction: { title: 'Gọi giới thiệu', dueAt: new Date().toISOString() } });
    expect(await lead(ok.json.data.leadId)).toMatchObject({ status: 'active', owner_user_id: 'u-lan' });
  });

  test('leader assigns from the queue with a default first-contact task', async () => {
    const r = await command('u-hung', 'assignLead', { leadId: 'lead-20', expectedVersion: 1, ownerUserId: 'u-long' });
    expect(r.json.ok).toBe(true);
    const row = await lead('lead-20');
    expect(row).toMatchObject({ status: 'active', owner_user_id: 'u-long', team_id: 'team-kd1' });
    const task = await db.prepare('SELECT title, assignee_user_id FROM task WHERE id = ?').bind(row!.next_action_task_id).first();
    expect(task).toEqual({ title: 'Liên hệ lần đầu', assignee_user_id: 'u-long' });
    const other = await command('u-hung', 'assignLead', { leadId: 'lead-21', expectedVersion: 1, ownerUserId: 'u-huy' });
    expect(other.json.error?.code).toBe('VALIDATION_FAILED');
  });

  test('leader releases a lead not contacted after 24 working hours', async () => {
    // The seed stores absolute timestamps; pin "just assigned" to now so the early case never ages out.
    await db.prepare('UPDATE lead SET assigned_at = ? WHERE id = ?').bind(new Date().toISOString(), 'lead-02').run();
    const early =await command('u-hung', 'releaseLead', { leadId: 'lead-02', expectedVersion: 1, reason: 'Chưa gọi' });
    expect(early.json.error?.code).toBe('VALIDATION_FAILED');
    const r = await command('u-mai', 'releaseLead', { leadId: 'lead-03', expectedVersion: 1, reason: 'Quá 24 giờ chưa liên hệ' });
    expect(r.json.ok).toBe(true);
    expect(await lead('lead-03')).toMatchObject({ status: 'queue', owner_user_id: null, next_action_task_id: null });
  });
});

describe('approvals', () => {
  test('owner change: sale requests, only the team leader approves, next action follows the owner', async () => {
    const asSale = await command('u-lan', 'decideApproval', { approvalId: 'apv-1', expectedVersion: 1, decision: 'approve' });
    expect(asSale.json.error?.code).toBe('NOT_FOUND');
    const r = await command('u-hung', 'decideApproval', { approvalId: 'apv-1', expectedVersion: 1, decision: 'approve' });
    expect(r.json.data).toEqual({ status: 'approved' });
    const row = await lead('lead-09');
    expect(row).toMatchObject({ owner_user_id: 'u-lan', version: 2 });
    const task = await db.prepare('SELECT assignee_user_id FROM task WHERE id = ?').bind(row!.next_action_task_id).first();
    expect(task).toEqual({ assignee_user_id: 'u-lan' });
  });

  test('approval becomes stale when the lead changed after the request', async () => {
    await command('u-lan', 'logActivity', { leadId: 'lead-06', expectedVersion: 1, type: 'note', summary: 'Cập nhật' });
    const r = await command('u-lan', 'decideApproval', { approvalId: 'apv-2', expectedVersion: 1, decision: 'approve' });
    expect(r.json.data).toEqual({ status: 'stale' });
    expect(await lead('lead-06')).toMatchObject({ stage: 'qualified' });
  });

  test('owner approves an agent stage proposal on own lead', async () => {
    const r = await command('u-lan', 'decideApproval', { approvalId: 'apv-2', expectedVersion: 1, decision: 'approve' });
    expect(r.json.data).toEqual({ status: 'approved' });
    expect(await lead('lead-06')).toMatchObject({ stage: 'consulting' });
  });

  test('sale requests an owner change to a teammate', async () => {
    const r = await command('u-lan', 'requestOwnerChange', { leadId: 'lead-08', expectedVersion: 1, toUserId: 'u-long', reason: 'Nghỉ phép 2 tuần' });
    expect(r.json.ok).toBe(true);
    const cross = await command('u-lan', 'requestOwnerChange', { leadId: 'lead-11', expectedVersion: 1, toUserId: 'u-huy', reason: 'x' });
    expect(cross.json.error?.code).toBe('VALIDATION_FAILED');
  });
});

describe('read models', () => {
  test('dashboard and lead detail respond for each role', async () => {
    for (const user of ['u-lan', 'u-hung', 'u-head', 'u-bgd']) {
      const r = await call(user, 'GET', '/dashboard');
      expect(r.json.ok).toBe(true);
    }
    const detail = await call('u-hung', 'GET', '/leads/lead-04');
    expect(detail.json.data.permissions.transitions).toEqual(['qualified', 'lost']);
    expect(detail.json.data.audit).not.toBeNull();
    expect((await call('u-lan', 'GET', '/leads/lead-04')).json.data.audit).toBeNull();
    expect((await call('u-lan', 'GET', '/audit')).status).toBe(403);
    expect((await call('u-admin', 'GET', '/admin/overview')).json.ok).toBe(true);
  });
});
