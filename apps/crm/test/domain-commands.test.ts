import { env, applyD1Migrations } from 'cloudflare:test';
import { addWorkingHours, workingMinutesBetween } from '@abm/contracts';
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

type Json = { ok: boolean; data?: any; error?: { code: string; message: string; fields?: Record<string, string>; details?: any } };

async function call(user: string, method: string, path: string, body?: unknown) {
  const response = await app.fetch(new Request(`http://crm.test/api${path}`, {
    method,
    headers: { 'X-Demo-User': user, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { ...env, DEMO_MODE: '1' });
  return { status: response.status, json: (await response.json()) as Json };
}
const command = (user: string, name: string, body: unknown) => call(user, 'POST', `/commands/${name}`, body);
const lead = (id: string) => db.prepare('SELECT * FROM lead WHERE id = ?').bind(id).first<Record<string, any>>();
const task = (id: string) => db.prepare('SELECT * FROM task WHERE id = ?').bind(id).first<Record<string, any>>();
const approval = (id: string) => db.prepare('SELECT * FROM approval WHERE id = ?').bind(id).first<Record<string, any>>();
const WON = { wonValue: 350_000_000, wonNote: 'HĐ số 12/2026 đã ký' };
const inTwoDays = () => new Date(Date.now() + 2 * 86_400_000).toISOString();

/** QĐ13: every active lead points at exactly one open task owned by its owner; closed and queued leads have none. */
async function expectForcedNextAction() {
  const broken = await db.prepare(`
    SELECT l.id FROM lead l LEFT JOIN task t ON t.id = l.next_action_task_id
    WHERE l.status = 'active' AND (t.id IS NULL OR t.status <> 'open' OR t.assignee_user_id <> l.owner_user_id
      OR (SELECT COUNT(*) FROM task o WHERE o.lead_id = l.id AND o.status = 'open') <> 1)
    UNION SELECT l.id FROM lead l WHERE l.status IN ('queue', 'won', 'lost')
      AND (l.next_action_task_id IS NOT NULL OR EXISTS (SELECT 1 FROM task o WHERE o.lead_id = l.id AND o.status = 'open'))`).all();
  expect(broken.results).toEqual([]);
}

describe('stage state machine', () => {
  test('walks forward one step at a time; skips, moves back and early Won are rejected without writing', async () => {
    const order = ['contacted', 'qualified', 'consulting', 'quoted', 'negotiating', 'closing'];
    let version = 1;
    for (let i = 0; i < order.length - 1; i++) {
      const [from, to] = [order[i], order[i + 1]];
      const invalid = [order[i + 2], order[i - 1] ?? 'new', 'won'].filter(Boolean);
      for (const toStage of invalid) {
        const r = await command('u-lan', 'changeStage', { leadId: 'lead-04', expectedVersion: version, toStage, ...WON });
        expect(r.status, `${from} → ${toStage}`).toBe(422);
        expect(r.json.error?.fields).toHaveProperty('toStage');
      }
      expect((await lead('lead-04'))!.version).toBe(version);
      const moved = await command('u-lan', 'changeStage', { leadId: 'lead-04', expectedVersion: version, toStage: to });
      expect(moved.json.ok, `${from} → ${to}`).toBe(true);
      version += 1;
    }
    const won = await command('u-lan', 'changeStage', { leadId: 'lead-04', expectedVersion: version, toStage: 'won', ...WON });
    expect(won.json.ok).toBe(true);
    const row = await lead('lead-04');
    expect(row).toMatchObject({ stage: 'won', status: 'won', next_action_task_id: null, lost_reason: null, version: version + 1, expected_value: WON.wonValue, won_note: WON.wonNote });
    expect(row!.closed_at).not.toBeNull();
    expect((await task('task-4'))!.status).toBe('cancelled');
    await expectForcedNextAction();
  });

  test('Won and Lost leads accept no further stage, owner or assignment change', async () => {
    for (const [user, leadId, toStage] of [['u-long', 'lead-16', 'lost'], ['u-lan', 'lead-18', 'qualified'], ['u-lan', 'lead-18', 'won']] as const) {
      const r = await command(user, 'changeStage', { leadId, expectedVersion: 1, toStage, lostReason: 'price' });
      expect(r.json.error?.code, `${leadId} → ${toStage}`).toBe('VALIDATION_FAILED');
    }
    expect((await command('u-lan', 'requestOwnerChange', { leadId: 'lead-18', expectedVersion: 1, toUserId: 'u-long', reason: 'x' })).json.error?.code).toBe('VALIDATION_FAILED');
    expect((await command('u-hung', 'assignLead', { leadId: 'lead-16', expectedVersion: 1, ownerUserId: 'u-lan' })).json.error?.code).toBe('VALIDATION_FAILED');
    expect((await command('u-hung', 'releaseLead', { leadId: 'lead-18', expectedVersion: 1, reason: 'x' })).json.error?.code).toBe('VALIDATION_FAILED');
    expect(await lead('lead-16')).toMatchObject({ stage: 'won', status: 'won', owner_user_id: 'u-long', version: 1 });
    expect(await lead('lead-18')).toMatchObject({ stage: 'lost', status: 'lost', owner_user_id: 'u-lan', version: 1 });
  });

  test('a queued lead has no stage transitions until assigned', async () => {
    const r = await command('u-hung', 'changeStage', { leadId: 'lead-20', expectedVersion: 1, toStage: 'contacted' });
    expect(r.json.error?.code).toBe('VALIDATION_FAILED');
    expect((await call('u-hung', 'GET', '/leads/lead-20')).json.data.permissions.transitions).toEqual([]);
  });

  test('Lost reason must be a known code; "Khác" needs a non-blank note which is stored', async () => {
    const unknown = await command('u-lan', 'changeStage', { leadId: 'lead-01', expectedVersion: 1, toStage: 'lost', lostReason: 'bogus' });
    expect(unknown.json.error?.fields).toHaveProperty('lostReason');
    const blank = await command('u-lan', 'changeStage', { leadId: 'lead-01', expectedVersion: 1, toStage: 'lost', lostReason: 'other', lostNote: '   ' });
    expect(blank.json.error?.fields).toHaveProperty('lostNote');
    // Lost is reachable from Lead mới even before a first contact.
    const ok = await command('u-lan', 'changeStage', { leadId: 'lead-01', expectedVersion: 1, toStage: 'lost', lostReason: 'other', lostNote: 'Khách giải thể' });
    expect(ok.json.ok).toBe(true);
    expect(await lead('lead-01')).toMatchObject({ status: 'lost', lost_reason: 'other', lost_note: 'Khách giải thể' });
    const activity = await db.prepare(`SELECT summary FROM activity WHERE lead_id = 'lead-01' AND type = 'stage_changed'`).first<{ summary: string }>();
    expect(activity!.summary).toContain('Khác: Khách giải thể');
  });

  test('a Lost reason sent with a forward move is ignored', async () => {
    const r = await command('u-lan', 'changeStage', { leadId: 'lead-04', expectedVersion: 1, toStage: 'qualified', lostReason: 'price', lostNote: 'x' });
    expect(r.json.ok).toBe(true);
    expect(await lead('lead-04')).toMatchObject({ stage: 'qualified', status: 'active', lost_reason: null, lost_note: null });
  });
});

describe('first contact', () => {
  test('every contact activity type sets first_contact_at; a note does not', async () => {
    const note = await command('u-lan', 'logActivity', { leadId: 'lead-01', expectedVersion: 1, type: 'note', summary: 'Ghi chú nội bộ' });
    expect(note.json.data.firstContact).toBe(false);
    expect((await lead('lead-01'))!.first_contact_at).toBeNull();
    let version = 2;
    for (const type of ['call', 'meeting', 'email', 'message', 'customer_reply', 'file_sent', 'proposal_sent']) {
      await db.prepare(`UPDATE lead SET first_contact_at = NULL WHERE id = 'lead-01'`).run();
      const r = await command('u-lan', 'logActivity', { leadId: 'lead-01', expectedVersion: version, type, summary: 'Liên hệ' });
      expect(r.json.data?.firstContact, type).toBe(true);
      expect((await lead('lead-01'))!.first_contact_at, type).not.toBeNull();
      version += 1;
    }
  });

  test('the first contact time is kept when later contacts are logged', async () => {
    const at = new Date(Date.now() - 60_000).toISOString();
    await command('u-lan', 'logActivity', { leadId: 'lead-01', expectedVersion: 1, type: 'call', summary: 'Gọi lần 1', occurredAt: at });
    const second = await command('u-lan', 'logActivity', { leadId: 'lead-01', expectedVersion: 2, type: 'email', summary: 'Gửi email' });
    expect(second.json.data.firstContact).toBe(false);
    expect((await lead('lead-01'))!.first_contact_at).toBe(at);
  });

  test('activities in the future or on a queued lead are rejected', async () => {
    const future = await command('u-lan', 'logActivity', { leadId: 'lead-01', expectedVersion: 1, type: 'call', summary: 'x', occurredAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect(future.json.error?.fields).toHaveProperty('occurredAt');
    const queued = await command('u-hung', 'logActivity', { leadId: 'lead-20', expectedVersion: 1, type: 'call', summary: 'x' });
    expect(queued.json.error?.code).toBe('VALIDATION_FAILED');
    const system = await command('u-lan', 'logActivity', { leadId: 'lead-01', expectedVersion: 1, type: 'stage_changed', summary: 'x' });
    expect(system.json.error?.fields).toHaveProperty('type');
  });

  test('assignment from the queue creates a first-contact task due 4 working hours later', async () => {
    const before = new Date();
    const r = await command('u-hung', 'assignLead', { leadId: 'lead-20', expectedVersion: 1, ownerUserId: 'u-lan' });
    const after = new Date();
    expect(r.json.ok).toBe(true);
    const row = await lead('lead-20');
    const due = new Date((await task(row!.next_action_task_id))!.due_at).getTime();
    expect(due).toBeGreaterThanOrEqual(addWorkingHours(before, 4).getTime());
    expect(due).toBeLessThanOrEqual(addWorkingHours(after, 4).getTime());
    expect((await call('u-lan', 'GET', '/leads/lead-20')).json.data.lead.health.firstContact.state).toBe('ok');
  });

  describe('release after 24 working hours', () => {
    /** Latest instant whose working-time distance to now is at least `minutes`. */
    function assignedWorkingMinutesAgo(minutes: number) {
      const now = Date.now();
      let lo = now - 30 * 86_400_000;
      let hi = now;
      while (hi - lo > 1000) {
        const mid = Math.floor((lo + hi) / 2);
        if (workingMinutesBetween(new Date(mid), new Date(now)) >= minutes) lo = mid;
        else hi = mid;
      }
      return new Date(lo).toISOString();
    }

    test('is refused just before the threshold and allowed just after it, cancelling open tasks', async () => {
      await db.prepare(`UPDATE lead SET assigned_at = ? WHERE id = 'lead-02'`).bind(assignedWorkingMinutesAgo(24 * 60 - 5)).run();
      const early = await command('u-hung', 'releaseLead', { leadId: 'lead-02', expectedVersion: 1, reason: 'Chưa gọi' });
      expect(early.json.error?.code).toBe('VALIDATION_FAILED');
      expect((await call('u-hung', 'GET', '/leads/lead-02')).json.data.permissions.release).toBe(false);

      await db.prepare(`UPDATE lead SET assigned_at = ? WHERE id = 'lead-02'`).bind(assignedWorkingMinutesAgo(24 * 60 + 5)).run();
      expect((await call('u-hung', 'GET', '/leads/lead-02')).json.data.permissions.release).toBe(true);
      const r = await command('u-hung', 'releaseLead', { leadId: 'lead-02', expectedVersion: 1, reason: 'Quá 24 giờ chưa liên hệ' });
      expect(r.json.ok).toBe(true);
      expect(await lead('lead-02')).toMatchObject({ status: 'queue', owner_user_id: null, team_id: null, assigned_at: null, next_action_task_id: null });
      expect((await task('task-2'))!.status).toBe('cancelled');
      await expectForcedNextAction();
    });

    test('is refused once the lead was contacted, for another team, and for a Sale', async () => {
      await db.prepare(`UPDATE lead SET assigned_at = ? WHERE id IN ('lead-02', 'lead-04')`).bind(assignedWorkingMinutesAgo(24 * 60 + 5)).run();
      expect((await command('u-hung', 'releaseLead', { leadId: 'lead-04', expectedVersion: 1, reason: 'x' })).json.error?.code).toBe('VALIDATION_FAILED');
      expect((await command('u-mai', 'releaseLead', { leadId: 'lead-02', expectedVersion: 1, reason: 'x' })).json.error?.code).toBe('NOT_FOUND');
      expect((await command('u-long', 'releaseLead', { leadId: 'lead-02', expectedVersion: 1, reason: 'x' })).json.error?.code).toBe('FORBIDDEN');
      expect((await lead('lead-02'))!.status).toBe('active');
    });
  });
});

describe('forced next action', () => {
  test('holds through a full lead journey across owners', async () => {
    const created = await command('u-hung', 'createLead', { contactName: 'Khách Hành Trình', phone: '0977000111', source: 'referral', needSummary: 'Cần CRM' });
    const id = created.json.data.leadId as string;
    expect(await lead(id)).toMatchObject({ status: 'queue', owner_user_id: null, next_action_task_id: null });
    await expectForcedNextAction();

    expect((await command('u-hung', 'assignLead', { leadId: id, expectedVersion: 1, ownerUserId: 'u-long', nextAction: { title: 'Gọi giới thiệu', dueAt: inTwoDays() } })).json.ok).toBe(true);
    await expectForcedNextAction();
    expect((await command('u-long', 'logActivity', { leadId: id, expectedVersion: 2, type: 'call', summary: 'Đã gọi' })).json.ok).toBe(true);
    expect((await command('u-long', 'changeStage', { leadId: id, expectedVersion: 3, toStage: 'contacted' })).json.ok).toBe(true);
    await expectForcedNextAction();

    const first = (await lead(id))!.next_action_task_id;
    const done = await command('u-long', 'completeTask', { taskId: first, expectedVersion: 1, outcome: 'Hẹn demo', nextAction: { title: 'Demo', dueAt: inTwoDays() } });
    expect(done.json.ok).toBe(true);
    expect((await task(first))!.status).toBe('completed');
    await expectForcedNextAction();

    const req = await command('u-long', 'requestOwnerChange', { leadId: id, expectedVersion: 5, toUserId: 'u-lan', reason: 'Nghỉ phép' });
    const decided = await command('u-hung', 'decideApproval', { approvalId: req.json.data.approvalId, expectedVersion: 1, decision: 'approve' });
    expect(decided.json.data).toEqual({ status: 'approved' });
    expect((await lead(id))!.owner_user_id).toBe('u-lan');
    await expectForcedNextAction();

    const current = await lead(id);
    const demo = await task(current!.next_action_task_id);
    expect((await command('u-lan', 'completeTask', { taskId: demo!.id, expectedVersion: demo!.version, nextAction: { title: 'Gửi báo giá', dueAt: inTwoDays() } })).json.ok).toBe(true);
    const latest = await lead(id);
    expect((await task(latest!.next_action_task_id))!.assignee_user_id).toBe('u-lan');
    expect((await command('u-lan', 'changeStage', { leadId: id, expectedVersion: latest!.version, toStage: 'lost', lostReason: 'competitor' })).json.ok).toBe(true);
    await expectForcedNextAction();
  });

  test('a leader reassigning an active lead moves the open next action to the new owner', async () => {
    const r = await command('u-hung', 'assignLead', { leadId: 'lead-04', expectedVersion: 1, ownerUserId: 'u-long' });
    expect(r.json.ok).toBe(true);
    expect(await lead('lead-04')).toMatchObject({ owner_user_id: 'u-long', next_action_task_id: 'task-4', version: 2 });
    expect(await task('task-4')).toMatchObject({ status: 'open', assignee_user_id: 'u-long', version: 2 });
    expect((await command('u-hung', 'assignLead', { leadId: 'lead-04', expectedVersion: 2, ownerUserId: 'u-long' })).json.error?.code).toBe('VALIDATION_FAILED');
    await expectForcedNextAction();
  });

  test('a completed task cannot be completed again', async () => {
    const first = await command('u-lan', 'completeTask', { taskId: 'task-4', expectedVersion: 1, nextAction: { title: 'Tiếp', dueAt: inTwoDays() } });
    expect(first.json.ok).toBe(true);
    const again = await command('u-lan', 'completeTask', { taskId: 'task-4', expectedVersion: 2, nextAction: { title: 'Tiếp', dueAt: inTwoDays() } });
    expect(again.json.error?.code).toBe('STALE_VERSION');
    expect(await db.prepare(`SELECT COUNT(*) AS n FROM task WHERE lead_id = 'lead-04' AND status = 'open'`).first()).toEqual({ n: 1 });
  });

  test('the replacement next action needs a non-blank title and a valid due time', async () => {
    const blank = await command('u-lan', 'completeTask', { taskId: 'task-4', expectedVersion: 1, nextAction: { title: '   ', dueAt: inTwoDays() } });
    expect(blank.json.error?.fields).toHaveProperty('nextAction.title');
    const badDue = await command('u-lan', 'completeTask', { taskId: 'task-4', expectedVersion: 1, nextAction: { title: 'Gọi', dueAt: 'ngày mai' } });
    expect(badDue.json.error?.fields).toHaveProperty('nextAction.dueAt');
    expect((await task('task-4'))!.status).toBe('open');
  });

  test('completing a task that is not the next action needs no replacement', async () => {
    const now = new Date().toISOString();
    await db.prepare(`INSERT INTO task (id, lead_id, title, due_at, assignee_user_id, status, created_at, updated_at)
      VALUES ('task-extra', 'lead-04', 'Nhắc phụ', ?, 'u-lan', 'open', ?, ?)`).bind(now, now, now).run();
    const r = await command('u-lan', 'completeTask', { taskId: 'task-extra', expectedVersion: 1, outcome: 'Xong' });
    expect(r.json).toMatchObject({ ok: true, data: { nextTaskId: null } });
    expect(await lead('lead-04')).toMatchObject({ next_action_task_id: 'task-4', version: 2 });
    await expectForcedNextAction();
  });
});

describe('approvals', () => {
  test('only the leader of the lead team may decide an owner change', async () => {
    expect((await command('u-long', 'decideApproval', { approvalId: 'apv-1', expectedVersion: 1, decision: 'approve' })).json.error?.code).toBe('FORBIDDEN');
    expect((await command('u-mai', 'decideApproval', { approvalId: 'apv-1', expectedVersion: 1, decision: 'approve' })).json.error?.code).toBe('NOT_FOUND');
    expect((await command('u-head', 'decideApproval', { approvalId: 'apv-1', expectedVersion: 1, decision: 'approve' })).json.error?.code).toBe('FORBIDDEN');
    expect((await command('u-bgd', 'decideApproval', { approvalId: 'apv-1', expectedVersion: 1, decision: 'approve' })).json.error?.code).toBe('FORBIDDEN');
    expect(await approval('apv-1')).toMatchObject({ status: 'pending', version: 1 });
    expect(await lead('lead-09')).toMatchObject({ owner_user_id: 'u-long', version: 1 });
  });

  test('rejecting leaves the lead untouched and a decided approval cannot be decided again', async () => {
    const r = await command('u-hung', 'decideApproval', { approvalId: 'apv-1', expectedVersion: 1, decision: 'reject', note: 'Chưa hợp lý' });
    expect(r.json.data).toEqual({ status: 'rejected' });
    expect(await approval('apv-1')).toMatchObject({ status: 'rejected', decided_by_user_id: 'u-hung', decision_note: 'Chưa hợp lý', version: 2 });
    expect(await lead('lead-09')).toMatchObject({ owner_user_id: 'u-long', version: 1 });
    for (const expectedVersion of [1, 2]) {
      const again = await command('u-hung', 'decideApproval', { approvalId: 'apv-1', expectedVersion, decision: 'approve' });
      expect(again.json.error?.code).toBe('STALE_VERSION');
    }
    expect((await lead('lead-09'))!.owner_user_id).toBe('u-long');
  });

  test('an owner change approved after the lead was reassigned becomes stale and changes nothing', async () => {
    await command('u-hung', 'assignLead', { leadId: 'lead-09', expectedVersion: 1, ownerUserId: 'u-hung' });
    const listed = (await call('u-hung', 'GET', '/approvals?status=pending')).json.data.find((a: any) => a.id === 'apv-1');
    expect(listed).toMatchObject({ isStale: true, canDecide: true });
    const r = await command('u-hung', 'decideApproval', { approvalId: 'apv-1', expectedVersion: 1, decision: 'approve' });
    expect(r.json.data).toEqual({ status: 'stale' });
    expect(await lead('lead-09')).toMatchObject({ owner_user_id: 'u-hung', version: 2 });
    expect((await approval('apv-1'))!.status).toBe('stale');
  });

  test('an agent stage proposal is decided by the lead owner or its team leader only', async () => {
    expect((await command('u-hung', 'decideApproval', { approvalId: 'apv-3', expectedVersion: 1, decision: 'approve' })).json.error?.code).toBe('NOT_FOUND');
    expect((await command('u-lan', 'decideApproval', { approvalId: 'apv-3', expectedVersion: 1, decision: 'approve' })).json.error?.code).toBe('NOT_FOUND');
    const r = await command('u-mai', 'decideApproval', { approvalId: 'apv-3', expectedVersion: 1, decision: 'approve' });
    expect(r.json.data).toEqual({ status: 'approved' });
    expect(await lead('lead-13')).toMatchObject({ stage: 'closing', version: 2 });
    const activity = await db.prepare(`SELECT summary FROM activity WHERE lead_id = 'lead-13' AND type = 'stage_changed' ORDER BY created_at DESC LIMIT 1`).first<{ summary: string }>();
    expect(activity!.summary).toContain('Hoàng Mai duyệt');
  });

  test('an owner-change request records the current version without changing the lead, once per lead', async () => {
    const self = await command('u-lan', 'requestOwnerChange', { leadId: 'lead-08', expectedVersion: 1, toUserId: 'u-lan', reason: 'x' });
    expect(self.json.error?.code).toBe('VALIDATION_FAILED');
    const r = await command('u-lan', 'requestOwnerChange', { leadId: 'lead-08', expectedVersion: 1, toUserId: 'u-long', reason: 'Nghỉ phép' });
    expect(await approval(r.json.data.approvalId)).toMatchObject({ kind: 'owner_change', status: 'pending', target_version: 1, requested_by_user_id: 'u-lan' });
    expect((await lead('lead-08'))!.version).toBe(1);
    const twice = await command('u-lan', 'requestOwnerChange', { leadId: 'lead-08', expectedVersion: 1, toUserId: 'u-long', reason: 'Lần 2' });
    expect(twice.json.error?.code).toBe('VALIDATION_FAILED');
  });
});

describe('duplicate check on intake', () => {
  const base = { contactName: 'Khách Thử', source: 'website', needSummary: 'Cần tư vấn' };
  const suspected = async (body: Record<string, unknown>) => {
    const r = await command('u-hung', 'createLead', { ...base, ...body });
    expect(r.status, JSON.stringify(body)).toBe(409);
    return r.json.error!.details as { field: string; code: string }[];
  };

  test('phone numbers match after removing formatting and the 84 country code', async () => {
    for (const phone of ['0900100004', '0900 100 004', '0900.100.004', '+84 900 100 004', '(+84) 900-100-004', '84900100004']) {
      expect(await suspected({ phone }), phone).toContainEqual(expect.objectContaining({ field: 'phone', code: 'L-0004' }));
    }
  });

  test('email matches regardless of case and surrounding spaces', async () => {
    expect(await suspected({ email: '  LienHe4@KhachHang-Demo.EXAMPLE ' })).toContainEqual(expect.objectContaining({ field: 'email', code: 'L-0004' }));
  });

  test('tax code matches after trimming; company name matches ignoring case, diacritics and spacing', async () => {
    expect(await suspected({ phone: '0977000001', taxCode: ' 0310000004 ', companyName: 'Tên khác' })).toContainEqual(expect.objectContaining({ field: 'tax_code', code: 'L-0004' }));
    for (const companyName of ['công ty tnhh dược phẩm lộc thọ demo', 'CÔNG TY TNHH DƯỢC PHẨM LỘC THỌ DEMO', '  Công ty  TNHH Dược phẩm Lộc Thọ Demo ', 'cong ty tnhh duoc pham loc tho demo']) {
      expect(await suspected({ phone: '0977000002', companyName }), companyName).toContainEqual(expect.objectContaining({ field: 'company', code: 'L-0004' }));
    }
  });

  test('a confirmed duplicate reuses the account found by tax code and records the override', async () => {
    const r = await command('u-hung', 'createLead', { ...base, phone: '0977000003', taxCode: '0310000004', companyName: 'Tên khác', confirmNotDuplicate: true });
    expect(r.json.ok).toBe(true);
    expect((await lead(r.json.data.leadId))!.account_id).toBe('acc-4');
    expect(await db.prepare(`SELECT COUNT(*) AS n FROM account WHERE tax_code = '0310000004'`).first()).toEqual({ n: 1 });
    const audit = await db.prepare(`SELECT after_json FROM audit_log WHERE entity = 'lead' AND entity_id = ?`).bind(r.json.data.leadId).first<{ after_json: string }>();
    expect(JSON.parse(audit!.after_json).duplicateOverride).toEqual(['tax_code:L-0004']);
  });

  test('a new customer is created without confirmation and an empty tax code is stored as NULL', async () => {
    const r = await command('u-hung', 'createLead', { ...base, phone: '0977000004', email: 'moi@khach.example', companyName: 'Công ty Mới Hoàn Toàn', taxCode: '  ' });
    expect(r.json.ok).toBe(true);
    const account = await db.prepare('SELECT a.name, a.tax_code FROM account a JOIN lead l ON l.account_id = a.id WHERE l.id = ?').bind(r.json.data.leadId).first();
    expect(account).toEqual({ name: 'Công ty Mới Hoàn Toàn', tax_code: null });
    const points = await db.prepare(`SELECT type, normalized_value FROM contact_point cp JOIN lead l ON l.contact_id = cp.contact_id WHERE l.id = ? ORDER BY type`).bind(r.json.data.leadId).all();
    expect(points.results).toEqual([{ type: 'email', normalized_value: 'moi@khach.example' }, { type: 'phone', normalized_value: '0977000004' }]);
  });

  test('intake needs a phone or an email', async () => {
    const r = await command('u-hung', 'createLead', base);
    expect(r.json.error?.fields).toHaveProperty('phone');
  });
});
