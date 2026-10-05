import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
beforeEach(() => resetDb(db, seedSql));

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
const get = (user: string, path: string) => call(user, 'GET', path);
const lead = (id: string) => db.prepare('SELECT * FROM lead WHERE id = ?').bind(id).first<Record<string, any>>();
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const inTwoDays = () => new Date(Date.now() + 48 * HOUR).toISOString();
const intake = { contactName: 'Khách Thử', source: 'website', needSummary: 'Cần tư vấn' };

describe('audit access', () => {
  test('Leader, Trưởng phòng, BGĐ and Admin read audit within their lead scope; Sale cannot', async () => {
    expect((await get('u-lan', '/audit')).status).toBe(403);
    const visible = async (user: string) => new Set(((await get(user, '/leads')).json.data as any[]).map((l) => l.code));
    for (const user of ['u-hung', 'u-head', 'u-bgd', 'u-admin']) {
      const r = await get(user, '/audit');
      expect(r.status, user).toBe(200);
      const scope = await visible(user);
      expect((r.json.data as any[]).every((a) => scope.has(a.lead.code)), user).toBe(true);
    }
  });
});

describe('duplicate check disclosure', () => {
  test('a match outside the actor scope is acknowledged without code, stage or owner', async () => {
    const phoneOf = async (leadId: string) => (await db.prepare(`SELECT cp.value FROM contact_point cp JOIN lead l ON l.contact_id = cp.contact_id
      WHERE l.id = ? AND cp.type = 'phone'`).bind(leadId).first<{ value: string }>())!.value;
    const outside = await command('u-lan', 'createLead', { ...intake, phone: await phoneOf('lead-10'), nextAction: { title: 'Gọi', dueAt: inTwoDays() } });
    expect(outside.status).toBe(409);
    expect(outside.json.error!.details).toEqual([expect.objectContaining({ field: 'phone', code: null, stage: null, owner: null })]);
    expect(JSON.stringify(outside.json.error!.details)).not.toMatch(/L-0010|Huy|Mai/);

    const inside = await command('u-lan', 'createLead', { ...intake, phone: await phoneOf('lead-04'), nextAction: { title: 'Gọi', dueAt: inTwoDays() } });
    expect(inside.json.error!.details).toContainEqual(expect.objectContaining({ field: 'phone', code: 'L-0004' }));

    // A confirmed override records out-of-scope matches without their code, since Leaders read this audit.
    const confirmed = await command('u-lan', 'createLead', { ...intake, phone: await phoneOf('lead-10'), confirmNotDuplicate: true, nextAction: { title: 'Gọi', dueAt: inTwoDays() } });
    const audit = await db.prepare(`SELECT after_json FROM audit_log WHERE entity = 'lead' AND entity_id = ?`).bind(confirmed.json.data.leadId).first<{ after_json: string }>();
    expect(JSON.parse(audit!.after_json).duplicateOverride).toEqual(['phone:ngoài phạm vi']);
  });

  test('0084 and 84 country prefixes match the local number', async () => {
    for (const phone of ['0084 900 100 004', '0084900100004']) {
      const r = await command('u-hung', 'createLead', { ...intake, phone });
      expect(r.json.error?.details, phone).toContainEqual(expect.objectContaining({ field: 'phone', code: 'L-0004' }));
    }
  });
});

describe('idempotent replay', () => {
  test('a replay is refused once the actor no longer sees the target lead', async () => {
    const body = { leadId: 'lead-04', expectedVersion: 1, type: 'note', summary: 'Ghi chú' };
    expect((await command('u-lan', 'logActivity', body, 'replay-key')).json.ok).toBe(true);
    expect((await command('u-lan', 'logActivity', body, 'replay-key')).json.ok).toBe(true);
    expect((await command('u-hung', 'assignLead', { leadId: 'lead-04', expectedVersion: 2, ownerUserId: 'u-long' })).json.ok).toBe(true);
    const replay = await command('u-lan', 'logActivity', body, 'replay-key');
    expect(replay.status).toBe(404);
    expect(await db.prepare(`SELECT COUNT(*) AS n FROM activity WHERE lead_id = 'lead-04' AND summary = 'Ghi chú'`).first()).toEqual({ n: 1 });
  });

  test('a createLead retry still gets its lead id after the lead moved out of scope', async () => {
    const body = { ...intake, phone: '0977000777' };
    const created = await command('u-hung', 'createLead', body, 'create-key');
    expect(created.json.ok).toBe(true);
    await db.prepare(`UPDATE lead SET status = 'active', team_id = 'team-kd2', owner_user_id = 'u-huy', next_action_task_id = 'task-3' WHERE id = ?`)
      .bind(created.json.data.leadId).run();
    const retry = await command('u-hung', 'createLead', body, 'create-key');
    expect(retry.json).toEqual(created.json);
    expect(await db.prepare(`SELECT COUNT(*) AS n FROM contact_point WHERE normalized_value = '0977000777'`).first()).toEqual({ n: 1 });
  });
});

describe('account list scope', () => {
  test('owner names only come from leads the viewer can see', async () => {
    const created = await command('u-long', 'createLead', {
      ...intake, phone: '0977000555', taxCode: '0310000004', companyName: 'Dược phẩm Lộc Thọ', confirmNotDuplicate: true,
      nextAction: { title: 'Gọi', dueAt: inTwoDays() },
    });
    expect(created.json.ok).toBe(true);
    const owners = async (user: string) => ((await get(user, '/accounts')).json.data as any[]).find((a) => a.id === 'acc-4').owners as string;
    expect(await owners('u-lan')).toBe('Đỗ Ngọc Lan');
    expect((await owners('u-hung')).split(',').sort()).toEqual(['Vũ Đức Long', 'Đỗ Ngọc Lan']);
  });
});

describe('owner change requests', () => {
  test('two concurrent requests leave exactly one pending approval', async () => {
    const body = { leadId: 'lead-08', expectedVersion: 1, toUserId: 'u-long', reason: 'Nghỉ phép' };
    const results = await Promise.all([command('u-lan', 'requestOwnerChange', body), command('u-lan', 'requestOwnerChange', body)]);
    expect(results.filter((r) => r.json.ok)).toHaveLength(1);
    expect(await db.prepare(`SELECT COUNT(*) AS n FROM approval WHERE lead_id = 'lead-08' AND status = 'pending'`).first()).toEqual({ n: 1 });
    expect(await db.prepare('SELECT COUNT(*) AS n FROM _guard').first()).toEqual({ n: 0 });
  });

  test('a request racing past the pending check is rolled back by the in-batch guard', async () => {
    // Simulates another request committing between this request's pre-read and its batch.
    await db.prepare(`CREATE TRIGGER race_owner_change AFTER INSERT ON approval WHEN NEW.id <> 'apv-race' BEGIN
      INSERT INTO approval (id, kind, lead_id, target_version, payload_json, reason, status, requested_by_user_id, requested_by_kind, created_at, updated_at)
      VALUES ('apv-race', 'owner_change', NEW.lead_id, 1, '{}', 'race', 'pending', 'u-lan', 'human', NEW.created_at, NEW.created_at); END`).run();
    try {
      const r = await command('u-lan', 'requestOwnerChange', { leadId: 'lead-08', expectedVersion: 1, toUserId: 'u-long', reason: 'Nghỉ phép' });
      expect(r.status).toBe(409);
      expect(r.json.error?.code).toBe('STALE_VERSION');
      expect(await db.prepare(`SELECT COUNT(*) AS n FROM approval WHERE lead_id = 'lead-08'`).first()).toEqual({ n: 0 });
      expect(await db.prepare('SELECT COUNT(*) AS n FROM _guard').first()).toEqual({ n: 0 });
    } finally {
      await db.prepare('DROP TRIGGER race_owner_change').run();
    }
  });
});

describe('agent Won/Lost proposals', () => {
  test('only the team Leader decides an agent Lost proposal, not the lead owner', async () => {
    await db.prepare(`UPDATE approval SET payload_json = ? WHERE id = 'apv-2'`)
      .bind(JSON.stringify({ toStage: 'lost', lostReason: 'price', agentName: 'Trợ lý' })).run();
    const asOwner = await command('u-lan', 'decideApproval', { approvalId: 'apv-2', expectedVersion: 1, decision: 'approve' });
    expect(asOwner.json.error?.code).toBe('FORBIDDEN');
    expect(((await get('u-lan', '/approvals')).json.data as any[]).find((a) => a.id === 'apv-2').canDecide).toBe(false);
    expect(((await get('u-hung', '/approvals')).json.data as any[]).find((a) => a.id === 'apv-2').canDecide).toBe(true);
    const asLeader = await command('u-hung', 'decideApproval', { approvalId: 'apv-2', expectedVersion: 1, decision: 'approve' });
    expect(asLeader.json.data).toEqual({ status: 'approved' });
    expect(await lead('lead-06')).toMatchObject({ stage: 'lost', lost_reason: 'price' });
  });

  test('an agent Won proposal without a deal value cannot be applied', async () => {
    await db.batch([
      db.prepare(`UPDATE lead SET stage = 'closing' WHERE id = 'lead-06'`),
      db.prepare(`UPDATE approval SET payload_json = ? WHERE id = 'apv-2'`).bind(JSON.stringify({ toStage: 'won', agentName: 'Trợ lý' })),
    ]);
    const r = await command('u-hung', 'decideApproval', { approvalId: 'apv-2', expectedVersion: 1, decision: 'approve' });
    expect(r.json.error?.code).toBe('VALIDATION_FAILED');
    expect(await lead('lead-06')).toMatchObject({ stage: 'closing', status: 'active' });
  });
});

describe('Won closing data', () => {
  test('Won needs a positive whole-đồng value and an evidence note', async () => {
    await db.prepare(`UPDATE lead SET stage = 'closing' WHERE id = 'lead-04'`).run();
    const base = { leadId: 'lead-04', expectedVersion: 1, toStage: 'won' };
    for (const extra of [{}, { wonValue: 100 }, { wonNote: 'HĐ' }, { wonValue: 0, wonNote: 'HĐ' }, { wonValue: 10.5, wonNote: 'HĐ' }, { wonValue: -5, wonNote: 'HĐ' }]) {
      const r = await command('u-lan', 'changeStage', { ...base, ...extra });
      expect(r.status, JSON.stringify(extra)).toBe(422);
    }
    const won = await command('u-lan', 'changeStage', { ...base, wonValue: 480_000_000, wonNote: 'PO 77 đã ký' });
    expect(won.json.ok).toBe(true);
    expect(await lead('lead-04')).toMatchObject({ status: 'won', expected_value: 480_000_000, won_note: 'PO 77 đã ký' });
    expect((await get('u-lan', '/leads/lead-04')).json.data.lead).toMatchObject({ expectedValue: 480_000_000, wonNote: 'PO 77 đã ký' });
  });
});

describe('activity time bounds', () => {
  test('an activity cannot be dated before the lead was assigned', async () => {
    await db.prepare('UPDATE lead SET assigned_at = ? WHERE id = ?').bind(ago(HOUR), 'lead-01').run();
    const early = await command('u-lan', 'logActivity', { leadId: 'lead-01', expectedVersion: 1, type: 'call', summary: 'x', occurredAt: ago(2 * HOUR) });
    expect(early.json.error?.fields).toHaveProperty('occurredAt');
    expect((await lead('lead-01'))!.first_contact_at).toBeNull();
    const ok = await command('u-lan', 'logActivity', { leadId: 'lead-01', expectedVersion: 1, type: 'call', summary: 'x', occurredAt: ago(HOUR / 2) });
    expect(ok.json.ok).toBe(true);
  });

  test('an activity cannot be backdated more than 7 days', async () => {
    await db.prepare('UPDATE lead SET assigned_at = ? WHERE id = ?').bind(ago(30 * 24 * HOUR), 'lead-01').run();
    const old = await command('u-lan', 'logActivity', { leadId: 'lead-01', expectedVersion: 1, type: 'call', summary: 'x', occurredAt: ago(8 * 24 * HOUR) });
    expect(old.json.error?.fields).toHaveProperty('occurredAt');
    const recent = await command('u-lan', 'logActivity', { leadId: 'lead-01', expectedVersion: 1, type: 'call', summary: 'x', occurredAt: ago(6 * 24 * HOUR) });
    expect(recent.json.ok).toBe(true);
  });
});

describe('completing a task that is not the Next Action', () => {
  test('a follow-up from another task keeps the current Next Action open and pointed to', async () => {
    const now = new Date().toISOString();
    await db.prepare(`INSERT INTO task (id, lead_id, title, due_at, assignee_user_id, status, created_at, updated_at)
      VALUES ('task-x', 'lead-04', 'Nhắc phụ', ?, 'u-lan', 'open', ?, ?)`).bind(now, now, now).run();
    const r = await command('u-lan', 'completeTask', { taskId: 'task-x', expectedVersion: 1, nextAction: { title: 'Mới', dueAt: inTwoDays() } });
    expect(r.json.ok).toBe(true);
    expect((await lead('lead-04'))!.next_action_task_id).toBe('task-4');
    expect(await db.prepare(`SELECT status FROM task WHERE id = 'task-4'`).first()).toEqual({ status: 'open' });
  });
});

describe('intake validation', () => {
  test('a phone needs at least 9 digits and a tax code needs a company name', async () => {
    for (const phone of ['abc', '---', '12345678']) {
      const r = await command('u-hung', 'createLead', { ...intake, phone });
      expect(r.json.error?.fields, phone).toHaveProperty('phone');
    }
    const tax = await command('u-hung', 'createLead', { ...intake, phone: '0977000111', taxCode: '0319999999' });
    expect(tax.json.error?.fields).toHaveProperty('companyName');
  });
});

describe('search', () => {
  test('matches Vietnamese text regardless of case and diacritics, and phone numbers only for phone-like queries', async () => {
    const codes = async (path: string, q: string, user = 'u-lan') => {
      const data = (await get(user, `${path}?q=${encodeURIComponent(q)}`)).json.data;
      return ((path === '/search' ? data.leads : data) as any[]).map((l) => l.code);
    };
    for (const q of ['DƯỢC PHẨM LỘC THỌ', 'duoc pham loc tho', 'Dược  Phẩm']) {
      expect(await codes('/search', q), q).toEqual(['L-0004']);
      expect(await codes('/leads', q), q).toEqual(['L-0004']);
    }
    expect(await codes('/search', '+84 900 100 004')).toEqual(['L-0004']);
    expect(await codes('/leads', 'zz 9')).toEqual([]);
    expect(await codes('/leads', '84 900 100 004')).toEqual(['L-0004']);
    expect(await codes('/leads', '100 004')).toEqual(['L-0004']);
    const accounts = ((await get('u-lan', `/accounts?q=${encodeURIComponent('DƯỢC PHẨM')}`)).json.data as any[]).map((a) => a.id);
    expect(accounts).toEqual(['acc-4']);
  });

  test('an overlong keyword is rejected instead of failing the request', async () => {
    const q = 'a'.repeat(101);
    for (const path of ['/leads', '/search', '/accounts']) {
      const r = await get('u-lan', `${path}?q=${q}`);
      expect(r.status, path).toBe(422);
      expect(r.json.error?.fields, path).toHaveProperty('q');
    }
  });
});
