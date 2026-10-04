export type CommandResult =
  | { ok: true; leadId: string; version: number; replay?: boolean }
  | { ok: false; code: 'STALE_VERSION' | 'NOT_FOUND' | 'VALIDATION_FAILED' | 'IDEMPOTENCY_CONFLICT' };

export interface ChangeStageInput {
  leadId: string;
  expectedVersion: number;
  stage: string;
  idempotencyKey: string;
  /** Direct test calls only; the HTTP handler never forwards this field. */
  injectFailureAfterUpdate?: boolean;
}

export interface CompleteNextActionInput {
  leadId: string;
  taskId: string;
  /** Version of the lead. The old task's observed version is guarded separately. */
  expectedVersion: number;
  newTask?: { id: string; dueAt: string };
}

interface Lead {
  id: string;
  stage: string;
  version: number;
  next_action_task_id: string | null;
}

const failure = (code: Extract<CommandResult, { ok: false }>['code']): CommandResult => ({ ok: false, code });
const validVersion = (version: number) => Number.isSafeInteger(version) && version > 0;
const validText = (value: string) => typeof value === 'string' && value.trim().length > 0;
const isGuardFailure = (error: unknown) => error instanceof Error && error.message.includes('CHECK constraint failed');

function leadGuard(db: D1Database, leadId: string, expectedVersion: number, txnId: string) {
  return db.prepare(`INSERT INTO _guard(ok) VALUES (
    COALESCE((SELECT 1 FROM lead WHERE id=? AND version=? AND last_txn_id=?), 0)
  )`).bind(leadId, expectedVersion + 1, txnId);
}

async function replayStage(db: D1Database, key: string, command: string): Promise<CommandResult | null> {
  const stored = await db.prepare('SELECT command, result_json FROM idempotency_key WHERE key=?')
    .bind(key).first<{ command: string; result_json: string }>();
  if (!stored) return null;
  if (stored.command !== command) return failure('IDEMPOTENCY_CONFLICT');
  return { ...JSON.parse(stored.result_json), replay: true } as CommandResult;
}

export async function changeStage(db: D1Database, input: ChangeStageInput): Promise<CommandResult> {
  const { leadId, expectedVersion, stage, idempotencyKey } = input;
  if (!validText(leadId) || !validVersion(expectedVersion) || !validText(stage) || !validText(idempotencyKey)) {
    return failure('VALIDATION_FAILED');
  }
  const command = JSON.stringify({ command: 'changeStage', leadId, expectedVersion, stage });
  const replay = await replayStage(db, idempotencyKey, command);
  if (replay) return replay;
  const lead = await db.prepare('SELECT id FROM lead WHERE id=?').bind(leadId).first();
  if (!lead) return failure('NOT_FOUND');

  const txnId = crypto.randomUUID();
  const now = new Date().toISOString();
  const result: CommandResult = { ok: true, leadId, version: expectedVersion + 1 };
  const resultJson = JSON.stringify(result);
  const statements = [db.prepare(`UPDATE lead SET stage=?, version=version+1, last_txn_id=?, updated_at=?
    WHERE id=? AND version=?`).bind(stage, txnId, now, leadId, expectedVersion)];
  if (input.injectFailureAfterUpdate) {
    statements.push(db.prepare('INSERT INTO _guard(ok) VALUES (0)'));
  }
  statements.push(
    leadGuard(db, leadId, expectedVersion, txnId),
    db.prepare(`INSERT INTO audit_log(id, entity, entity_id, action, after_json, created_at)
      SELECT ?, 'lead', id, 'changeStage', ?, ? FROM lead WHERE id=? AND version=? AND last_txn_id=?`)
      .bind(crypto.randomUUID(), JSON.stringify({ stage, version: expectedVersion + 1 }), now, leadId, expectedVersion + 1, txnId),
    db.prepare(`INSERT INTO outbox(id, idempotency_key, event_type, payload_json)
      SELECT ?, ?, 'lead.stageChanged', ? FROM lead WHERE id=? AND version=? AND last_txn_id=?`)
      .bind(crypto.randomUUID(), idempotencyKey, JSON.stringify({ leadId, stage, version: expectedVersion + 1 }), leadId, expectedVersion + 1, txnId),
    db.prepare(`INSERT INTO idempotency_key(key, command, result_json, created_at)
      SELECT ?, ?, ?, ? FROM lead WHERE id=? AND version=? AND last_txn_id=?`)
      .bind(idempotencyKey, command, resultJson, now, leadId, expectedVersion + 1, txnId),
    db.prepare('DELETE FROM _guard'),
  );
  try {
    await db.batch(statements);
    return result;
  } catch (error) {
    if (input.injectFailureAfterUpdate) throw error;
    // Another invocation of this same command may have committed after the pre-read.
    const concurrentReplay = await replayStage(db, idempotencyKey, command);
    if (concurrentReplay) return concurrentReplay;
    if (isGuardFailure(error)) return failure('STALE_VERSION');
    throw error;
  }
}

export async function completeNextAction(db: D1Database, input: CompleteNextActionInput): Promise<CommandResult> {
  const { leadId, taskId, expectedVersion, newTask } = input;
  // This minimal PoC requires a replacement on every completion; terminal-lead
  // completion without a replacement is outside its command contract.
  if (!validText(leadId) || !validText(taskId) || !validVersion(expectedVersion)
    || !newTask || !validText(newTask.id) || newTask.id === taskId
    || typeof newTask.dueAt !== 'string' || !Number.isFinite(Date.parse(newTask.dueAt))) {
    return failure('VALIDATION_FAILED');
  }
  const lead = await db.prepare('SELECT id, stage, version, next_action_task_id FROM lead WHERE id=?')
    .bind(leadId).first<Lead>();
  if (!lead) return failure('NOT_FOUND');
  const task = await db.prepare('SELECT version, status FROM task WHERE id=? AND lead_id=?')
    .bind(taskId, leadId).first<{ version: number; status: string }>();
  if (!task) return failure('NOT_FOUND');
  if (lead.next_action_task_id !== taskId || !['open', 'in_progress'].includes(task.status)) {
    return failure('STALE_VERSION');
  }
  const txnId = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db.batch([
      db.prepare(`UPDATE task SET status='completed', version=version+1, last_txn_id=?
        WHERE id=? AND lead_id=? AND version=? AND status IN ('open', 'in_progress')`)
        .bind(txnId, taskId, leadId, task.version),
      db.prepare(`INSERT INTO task(id, lead_id, status, due_at, last_txn_id) VALUES (?, ?, 'open', ?, ?)`)
        .bind(newTask.id, leadId, newTask.dueAt, txnId),
      db.prepare(`UPDATE lead SET next_action_task_id=?, version=version+1, last_txn_id=?, updated_at=?
        WHERE id=? AND version=? AND next_action_task_id=?`)
        .bind(newTask.id, txnId, now, leadId, expectedVersion, taskId),
      db.prepare(`INSERT INTO _guard(ok) VALUES (COALESCE((SELECT 1 FROM task
        WHERE id=? AND lead_id=? AND version=? AND last_txn_id=? AND status='completed'), 0))`)
        .bind(taskId, leadId, task.version + 1, txnId),
      leadGuard(db, leadId, expectedVersion, txnId),
      db.prepare(`INSERT INTO audit_log(id, entity, entity_id, action, after_json, created_at)
        SELECT ?, 'lead', id, 'completeNextAction', ?, ? FROM lead WHERE id=? AND version=? AND last_txn_id=?`)
        .bind(crypto.randomUUID(), JSON.stringify({ taskId, nextActionTaskId: newTask.id }), now, leadId, expectedVersion + 1, txnId),
      db.prepare('DELETE FROM _guard'),
    ]);
    return { ok: true, leadId, version: expectedVersion + 1 };
  } catch (error) {
    if (isGuardFailure(error)) return failure('STALE_VERSION');
    throw error;
  }
}
