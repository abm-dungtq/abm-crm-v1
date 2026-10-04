import { env, applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { beforeAll, beforeEach, expect, test } from 'vitest';
import { changeStage, completeNextAction } from '../src/guarded-write';

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

const db = env.DB;
beforeAll(async () => {
  await applyD1Migrations(db, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await db.batch([
    ...['audit_log', 'outbox', 'idempotency_key', '_guard', 'task', 'lead']
      .map((table) => db.prepare(`DELETE FROM ${table}`)),
    db.prepare(`INSERT INTO lead(id, owner_user_id, stage, next_action_task_id, updated_at)
      VALUES ('L1', 'synthetic-owner', 'Contacted', 'T1', '2026-10-03T00:00:00.000Z')`),
    db.prepare(`INSERT INTO task(id, lead_id, status, due_at)
      VALUES ('T1', 'L1', 'open', '2026-10-04T00:00:00.000Z')`),
  ]);
});

const stageInput = (key = crypto.randomUUID(), version = 1) => ({
  leadId: 'L1', expectedVersion: version, stage: 'Qualified', idempotencyKey: key,
});
const replacement = { id: 'T2', dueAt: '2026-10-05T00:00:00.000Z' };
const getLead = () => db.prepare('SELECT * FROM lead WHERE id=?').bind('L1').first();
async function counts() {
  const [audit, outbox, idempotency, guard] = await db.batch<{ count: number }>(
    ['audit_log', 'outbox', 'idempotency_key', '_guard'].map((table) =>
      db.prepare(`SELECT COUNT(*) AS count FROM ${table}`)),
  );
  return {
    audit: audit!.results[0]!.count, outbox: outbox!.results[0]!.count,
    idempotency: idempotency!.results[0]!.count, guard: guard!.results[0]!.count,
  };
}

test('stale version is rejected and leaves no audit or outbox', async () => {
  // Exactly expectedVersion+1 is the dangerous case for a version-only guard.
  await db.prepare(`UPDATE lead SET version=2, stage='OtherWriter', last_txn_id='other-writer' WHERE id='L1'`).run();
  const before = await getLead();
  for (const version of [1, 3]) {
    expect(await changeStage(db, stageInput(crypto.randomUUID(), version))).toEqual({ ok: false, code: 'STALE_VERSION' });
    expect(await getLead()).toEqual(before);
    expect(await counts()).toEqual({ audit: 0, outbox: 0, idempotency: 0, guard: 0 });
  }
});

test('successful change writes lead, audit and outbox atomically', async () => {
  expect(await changeStage(db, stageInput())).toEqual({ ok: true, leadId: 'L1', version: 2 });
  expect(await getLead()).toMatchObject({ stage: 'Qualified', version: 2 });
  expect(await counts()).toEqual({ audit: 1, outbox: 1, idempotency: 1, guard: 0 });
  const audit = await db.prepare('SELECT action, after_json FROM audit_log').first<{ action: string; after_json: string }>();
  expect(audit?.action).toBe('changeStage');
  expect(JSON.parse(audit!.after_json)).toEqual({ stage: 'Qualified', version: 2 });
});

test('sequential double submit with same expected version: second is stale', async () => {
  expect((await changeStage(db, stageInput())).ok).toBe(true);
  const before = await getLead();
  expect(await changeStage(db, { ...stageInput(), stage: 'Lost' })).toEqual({ ok: false, code: 'STALE_VERSION' });
  expect(await getLead()).toEqual(before);
  expect(await counts()).toEqual({ audit: 1, outbox: 1, idempotency: 1, guard: 0 });
});

test('same idempotency key replays without duplicate outbox', async () => {
  const input = stageInput();
  const first = await changeStage(db, input);
  const before = await getLead();
  expect(await changeStage(db, input)).toEqual({ ...first, replay: true });
  expect(await changeStage(db, { ...input, stage: 'Lost' })).toEqual({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
  expect(await getLead()).toEqual(before);
  expect(await counts()).toEqual({ audit: 1, outbox: 1, idempotency: 1, guard: 0 });
});

test('failure mid-batch rolls back everything', async () => {
  const before = await getLead();
  await expect(changeStage(db, { ...stageInput(), injectFailureAfterUpdate: true }))
    .rejects.toThrow('CHECK constraint failed');
  expect(await getLead()).toEqual(before);
  expect(await counts()).toEqual({ audit: 0, outbox: 0, idempotency: 0, guard: 0 });
});

test('completing next action without a replacement is rejected for active lead', async () => {
  const before = await getLead();
  expect(await completeNextAction(db, { leadId: 'L1', taskId: 'T1', expectedVersion: 1 }))
    .toEqual({ ok: false, code: 'VALIDATION_FAILED' });
  expect(await getLead()).toEqual(before);
  expect(await db.prepare("SELECT status, version FROM task WHERE id='T1'").first())
    .toEqual({ status: 'open', version: 1 });
  expect(await counts()).toEqual({ audit: 0, outbox: 0, idempotency: 0, guard: 0 });
});

test('completing next action with replacement swaps task atomically', async () => {
  // A stale lead must roll back both the old-task closure and replacement insert.
  await db.prepare("UPDATE lead SET version=2, last_txn_id='other-writer' WHERE id='L1'").run();
  expect(await completeNextAction(db, { leadId: 'L1', taskId: 'T1', expectedVersion: 1, newTask: replacement }))
    .toEqual({ ok: false, code: 'STALE_VERSION' });
  expect(await db.prepare("SELECT status, version FROM task WHERE id='T1'").first()).toEqual({ status: 'open', version: 1 });
  expect(await db.prepare("SELECT id FROM task WHERE id='T2'").first()).toBeNull();
  expect(await counts()).toEqual({ audit: 0, outbox: 0, idempotency: 0, guard: 0 });

  expect(await completeNextAction(db, { leadId: 'L1', taskId: 'T1', expectedVersion: 2, newTask: replacement }))
    .toEqual({ ok: true, leadId: 'L1', version: 3 });
  const lead = await getLead();
  expect(lead).toMatchObject({ next_action_task_id: 'T2', version: 3 });
  expect(await db.prepare("SELECT status, version, last_txn_id FROM task WHERE id='T1'").first())
    .toEqual({ status: 'completed', version: 2, last_txn_id: lead!.last_txn_id });
  expect(await db.prepare("SELECT status, due_at, lead_id FROM task WHERE id='T2'").first())
    .toEqual({ status: 'open', due_at: replacement.dueAt, lead_id: 'L1' });
  expect(await counts()).toEqual({ audit: 1, outbox: 0, idempotency: 0, guard: 0 });
});

test('missing lead is rejected and writes nothing', async () => {
  expect(await changeStage(db, { ...stageInput(), leadId: 'missing' })).toEqual({ ok: false, code: 'NOT_FOUND' });
  expect(await completeNextAction(db, { leadId: 'missing', taskId: 'T1', expectedVersion: 1, newTask: replacement }))
    .toEqual({ ok: false, code: 'NOT_FOUND' });
  expect(await getLead()).toMatchObject({ stage: 'Contacted', version: 1 });
  expect(await counts()).toEqual({ audit: 0, outbox: 0, idempotency: 0, guard: 0 });
});
