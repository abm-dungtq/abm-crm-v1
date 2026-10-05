import { env } from 'cloudflare:test';
import { beforeEach, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';
import { loadActor } from '../src/worker/actor';
import { GuardedTx } from '../src/worker/guarded-tx';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
beforeEach(() => resetDb(db, seedSql));
async function cmd(user: string, name: string, body: unknown, key = crypto.randomUUID()) {
  const res = await app.fetch(new Request(`http://crm.test/api/commands/${name}`, {
    method: 'POST', headers: { 'X-Demo-User': user, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body),
  }), { ...env, DEMO_MODE: '1' });
  return { status: res.status, json: await res.json() as any };
}
const row = (table: string, id: string) => db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(id).first<Record<string, any>>();
const count = async (table: string) => (await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first<{ n: number }>())!.n;
const counts = () => Promise.all(['audit_log', 'outbox', 'activity', 'idempotency_key', '_guard'].map(count));
const stage = { leadId: 'lead-04', expectedVersion: 1, toStage: 'qualified' };
const nextAction = { title: 'Follow up', dueAt: '2030-01-01T00:00:00.000Z' };

test('HTTP database failures expose a generic error and roll back every side effect', async () => {
  const before = await row('lead', 'lead-04');
  const totals = await counts();
  await db.prepare("CREATE TRIGGER reject_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'security integrity test fault'); END").run();
  try {
    const res = await cmd('u-lan', 'changeStage', stage);
    expect(res.status).toBe(500);
    expect(res.json).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'Lỗi hệ thống, thử lại sau' } });
    expect(await row('lead', 'lead-04')).toEqual(before);
    expect(await counts()).toEqual(totals);
  } finally {
    await db.prepare('DROP TRIGGER reject_outbox').run();
  }
});

test.each(['missing', 'stale', 'middle failure'])('guarded batch rolls back mutation and all dependent rows on %s', async failure => {
  const before = await row('lead', 'lead-04');
  const totals = await counts();
  const tx = new GuardedTx(db, (await loadActor(db, 'u-lan'))!, 'changeStage');
  tx.update('lead', failure === 'missing' ? 'missing' : 'lead-04', failure === 'stale' ? 99 : 1, { stage: 'qualified' });
  tx.activity('lead-04', 'note', 'test');
  tx.audit('lead', 'lead-04', { stage: 'contacted' }, { stage: 'qualified' });
  tx.event('lead.stageChanged', { leadId: 'lead-04' });
  tx.idempotency('rollback-key', 'hash', { ok: true });
  if (failure === 'middle failure') tx.raw(db.prepare('INSERT INTO _guard(ok) VALUES(0)'));
  await expect(tx.commit()).rejects.toThrow(/CHECK constraint failed/);
  expect(await row('lead', 'lead-04')).toEqual(before);
  expect(await counts()).toEqual(totals);
});

test('two batches built at one version have exactly one winner and no loser effects', async () => {
  const totals = await counts();
  const actor = (await loadActor(db, 'u-lan'))!;
  const make = () => {
    const tx = new GuardedTx(db, actor, 'changeStage');
    tx.update('lead', 'lead-04', 1, { stage: 'qualified' });
    tx.activity('lead-04', 'stage_changed', 'test');
    tx.audit('lead', 'lead-04', { stage: 'contacted' }, { stage: 'qualified' });
    tx.event('lead.stageChanged', { leadId: 'lead-04' });
    tx.idempotency(tx.txnId, 'hash', { ok: true });
    return tx;
  };
  const first = make(); const second = make();
  const result = await Promise.allSettled([first.commit(), second.commit()]);
  expect(result.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(result.filter(r => r.status === 'rejected')).toHaveLength(1);
  expect(await row('lead', 'lead-04')).toMatchObject({ version: 2, stage: 'qualified' });
  expect(await counts()).toEqual(totals.map((n, i) => i === 4 ? 0 : n + 1));
});

test('replay returns the same result, conflicts on a changed command/body, and failed keys can retry', async () => {
  const key = 'stable-key';
  const failed = await cmd('u-lan', 'changeStage', { ...stage, expectedVersion: 9 }, key);
  expect(failed.json.error.code).toBe('STALE_VERSION');
  expect(await count('idempotency_key')).toBe(0);
  const first = await cmd('u-lan', 'changeStage', stage, key);
  const totals = await counts();
  expect(first.json.ok).toBe(true);
  expect((await cmd('u-lan', 'changeStage', stage, key)).json).toEqual(first.json);
  expect((await cmd('u-lan', 'changeStage', { ...stage, toStage: 'lost', lostReason: 'price' }, key)).json.error.code).toBe('IDEMPOTENCY_CONFLICT');
  expect((await cmd('u-lan', 'logActivity', { leadId: 'lead-04', expectedVersion: 2, type: 'note', summary: 'test' }, key)).json.error.code).toBe('IDEMPOTENCY_CONFLICT');
  expect(await counts()).toEqual(totals);
});

test.each([
  "UPDATE lead SET next_action_task_id=NULL WHERE id='lead-04'",
  "UPDATE lead SET status='queue' WHERE id='lead-04'",
  "UPDATE lead SET stage='lost', lost_reason=NULL WHERE id='lead-04'",
  "UPDATE lead SET owner_user_id='missing' WHERE id='lead-04'",
  "UPDATE lead SET code='L-0001' WHERE id='lead-04'",
  "UPDATE account SET tax_code='0310000001' WHERE id='acc-4'",
])('schema rejects invalid writes atomically: %s', async sql => {
  const before = await row('lead', 'lead-04');
  await expect(db.prepare(sql).run()).rejects.toThrow(/constraint failed/i);
  expect(await row('lead', 'lead-04')).toEqual(before);
});

test.each(['createLead', 'assignLead', 'releaseLead', 'logActivity', 'completeTask', 'changeStage', 'requestOwnerChange', 'decideApproval'])
('successful %s writes audit, event and idempotency in the same transaction', async name => {
  if (name === 'releaseLead') await db.prepare("UPDATE lead SET assigned_at='2020-01-01T00:00:00.000Z' WHERE id='lead-01'").run();
  const task = (await row('lead', 'lead-04'))!.next_action_task_id;
  const inputs: Record<string, { user: string; body: unknown; entity: string; target?: string; event: string }> = {
    createLead: { user: 'u-lan', body: { contactName: 'Test', phone: '0911222333', source: 'self', needSummary: 'Test', nextAction }, entity: 'lead', event: 'lead.created' },
    assignLead: { user: 'u-hung', body: { leadId: 'lead-20', expectedVersion: 1, ownerUserId: 'u-lan' }, entity: 'lead', target: 'lead-20', event: 'lead.assigned' },
    releaseLead: { user: 'u-hung', body: { leadId: 'lead-01', expectedVersion: 1, reason: 'test' }, entity: 'lead', target: 'lead-01', event: 'lead.released' },
    logActivity: { user: 'u-lan', body: { leadId: 'lead-04', expectedVersion: 1, type: 'note', summary: 'test' }, entity: 'lead', target: 'lead-04', event: 'activity.logged' },
    completeTask: { user: 'u-lan', body: { taskId: task, expectedVersion: 1, outcome: 'test', nextAction }, entity: 'task', target: task, event: 'task.completed' },
    changeStage: { user: 'u-lan', body: stage, entity: 'lead', target: 'lead-04', event: 'lead.stageChanged' },
    requestOwnerChange: { user: 'u-lan', body: { leadId: 'lead-08', expectedVersion: 1, toUserId: 'u-long', reason: 'test' }, entity: 'approval', event: 'approval.requested' },
    decideApproval: { user: 'u-hung', body: { approvalId: 'apv-1', expectedVersion: 1, decision: 'reject', note: 'test' }, entity: 'approval', target: 'apv-1', event: 'approval.decided' },
  };
  const input = inputs[name]!;
  const total = await counts(); const key = `audit-${name}`;
  const res = await cmd(input.user, name, input.body, key);
  expect(res.json.ok).toBe(true);
  const target = input.target ?? res.json.data.leadId ?? res.json.data.approvalId;
  const audit = await db.prepare('SELECT * FROM audit_log WHERE command=? AND entity_id=? ORDER BY created_at DESC LIMIT 1').bind(name, target).first<Record<string, any>>();
  expect(audit).toMatchObject({ actor_user_id: input.user, actor_kind: 'human', command: name, entity: input.entity, entity_id: target });
  expect(JSON.parse(audit!.after_json)).toBeTypeOf('object');
  const projections: Record<string, { before: unknown; after: Record<string, unknown> }> = {
    createLead: { before: null, after: { source: 'self', status: 'active' } },
    assignLead: { before: { status: 'queue', owner_user_id: null }, after: { status: 'active', owner_user_id: 'u-lan' } },
    releaseLead: { before: { status: 'active', owner_user_id: 'u-lan' }, after: { status: 'queue', reason: 'test' } },
    completeTask: { before: { status: 'open' }, after: { status: 'completed', outcome: 'test' } },
    requestOwnerChange: { before: null, after: { leadId: 'lead-08', toUserId: 'u-long', reason: 'test' } },
    decideApproval: { before: { status: 'pending' }, after: { status: 'rejected', note: 'test' } },
  };
  if (projections[name]) {
    const projection = projections[name]!;
    expect(audit!.before_json ? JSON.parse(audit!.before_json) : null).toEqual(projection.before);
    expect(JSON.parse(audit!.after_json)).toMatchObject(projection.after);
  }
  if (['createLead', 'requestOwnerChange'].includes(name)) expect(audit!.before_json).toBeNull();
  else expect(JSON.parse(audit!.before_json)).toBeTypeOf('object');
  if (name === 'changeStage') {
    expect(JSON.parse(audit!.before_json)).toEqual({ stage: 'contacted', status: 'active' });
    expect(JSON.parse(audit!.after_json)).toMatchObject({ stage: 'qualified' });
  }
  const event = await db.prepare('SELECT * FROM outbox WHERE event_type=?').bind(input.event).first<Record<string, any>>();
  // The Leader DM runs after the commit; no Leader is linked to Lark in this seed.
  expect(event!.status).toBe(name === 'requestOwnerChange' ? 'no_recipient' : 'pending');
  expect(JSON.stringify(JSON.parse(event!.payload_json))).toContain(target);
  const stored = await db.prepare('SELECT * FROM idempotency_key WHERE actor_user_id=? AND key=?').bind(input.user, key).first<Record<string, any>>();
  expect(JSON.parse(stored!.result_json)).toEqual(res.json);
  expect(stored!.command).toBe(name);
  expect(stored!.request_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(await count('audit_log')).toBe(total[0]! + 1);
  expect(await count('outbox')).toBe(total[1]! + 1);
  expect(await count('_guard')).toBe(0);
});
