import type { Actor } from './env';

type GuardedTable = 'lead' | 'task' | 'approval' | 'app_user' | 'department' | 'team';

interface RowRef {
  table: GuardedTable;
  id: string;
  /** Version the row must have after this transaction. */
  version: number;
}

/**
 * Builds one D1 batch following ADR-003: each versioned UPDATE is followed by a `_guard`
 * insert that only succeeds when this transaction's nonce landed on the expected version,
 * and side-effect rows (audit, outbox, idempotency) are inserted through INSERT…SELECT
 * from the first guarded row so they can never commit without it.
 */
export class GuardedTx {
  readonly txnId = crypto.randomUUID();
  readonly now = new Date().toISOString();
  private readonly statements: D1PreparedStatement[] = [];
  private anchor: RowRef | null = null;

  constructor(private readonly db: D1Database, private readonly actor: Actor, readonly command: string) {}

  /** UPDATE a versioned row with optimistic concurrency, then guard it. */
  update(table: GuardedTable, id: string, expectedVersion: number, set: Record<string, unknown>) {
    const cols = Object.keys(set);
    const assignments = cols.map((c) => `${c} = ?`).join(', ');
    this.statements.push(this.db.prepare(
      `UPDATE ${table} SET ${assignments}${cols.length ? ', ' : ''}version = version + 1, last_txn_id = ?, updated_at = ?
       WHERE id = ? AND version = ?`,
    ).bind(...cols.map((c) => set[c]), this.txnId, this.now, id, expectedVersion));
    this.guard({ table, id, version: expectedVersion + 1 });
  }

  /** INSERT a new versioned row stamped with this transaction, then guard it. */
  insertVersioned(table: GuardedTable, row: Record<string, unknown>, extraSql?: { cols: string[]; exprs: string[]; binds: unknown[] }) {
    const full: Record<string, unknown> = { ...row, version: 1, last_txn_id: this.txnId, created_at: this.now, updated_at: this.now };
    const cols = Object.keys(full);
    const allCols = [...cols, ...(extraSql?.cols ?? [])];
    const values = [...cols.map(() => '?'), ...(extraSql?.exprs ?? [])];
    this.statements.push(this.db.prepare(`INSERT INTO ${table} (${allCols.join(', ')}) VALUES (${values.join(', ')})`)
      .bind(...cols.map((c) => full[c]), ...(extraSql?.binds ?? [])));
    this.guard({ table, id: String(row.id), version: 1 });
  }

  /** Raw statement placed in the batch as-is (counters, append-only rows already conditioned). */
  raw(statement: D1PreparedStatement) {
    this.statements.push(statement);
  }

  /**
   * Fails the whole batch unless `condition` (a SQL boolean expression) holds at that point of the
   * batch. Used for invariants a pre-read cannot lock, such as "one pending request per lead".
   */
  assert(condition: string, binds: unknown[]) {
    this.statements.push(this.db.prepare(`INSERT INTO _guard (ok) VALUES (COALESCE((${condition}), 0))`).bind(...binds));
  }

  /** Append-only insert that commits only together with the anchor row. */
  insertDependent(table: 'activity' | 'audit_log' | 'outbox' | 'idempotency_key', row: Record<string, unknown>) {
    const anchor = this.anchor;
    if (!anchor) throw new Error('Dependent insert needs a guarded row first');
    const cols = Object.keys(row);
    this.statements.push(this.db.prepare(
      `INSERT INTO ${table} (${cols.join(', ')}) SELECT ${cols.map(() => '?').join(', ')}
       FROM ${anchor.table} WHERE id = ? AND version = ? AND last_txn_id = ?`,
    ).bind(...cols.map((c) => row[c]), anchor.id, anchor.version, this.txnId));
  }

  activity(leadId: string, type: string, summary: string, occurredAt = this.now) {
    this.insertDependent('activity', {
      id: crypto.randomUUID(), lead_id: leadId, type, summary, actor_user_id: this.actor.id,
      actor_kind: this.actor.kind, occurred_at: occurredAt, created_at: this.now,
    });
  }

  audit(entity: string, entityId: string, before: unknown, after: unknown) {
    this.insertDependent('audit_log', {
      id: crypto.randomUUID(), actor_user_id: this.actor.id, actor_kind: this.actor.kind, command: this.command,
      entity, entity_id: entityId, before_json: before == null ? null : JSON.stringify(before),
      after_json: after == null ? null : JSON.stringify(after), created_at: this.now,
    });
  }

  event(eventType: string, payload: unknown) {
    this.insertDependent('outbox', {
      id: crypto.randomUUID(), event_type: eventType, payload_json: JSON.stringify(payload), created_at: this.now,
    });
  }

  idempotency(key: string, requestHash: string, result: unknown) {
    this.insertDependent('idempotency_key', {
      actor_user_id: this.actor.id, key, command: this.command, request_hash: requestHash,
      result_json: JSON.stringify(result), created_at: this.now,
    });
  }

  async commit() {
    this.statements.push(this.db.prepare('DELETE FROM _guard'));
    await this.db.batch(this.statements);
  }

  private guard(ref: RowRef) {
    this.statements.push(this.db.prepare(
      `INSERT INTO _guard (ok) VALUES (COALESCE((SELECT 1 FROM ${ref.table} WHERE id = ? AND version = ? AND last_txn_id = ?), 0))`,
    ).bind(ref.id, ref.version, this.txnId));
    this.anchor ??= ref;
  }
}

export const isGuardFailure = (error: unknown) =>
  error instanceof Error && /CHECK constraint failed: ok = 1|CHECK constraint failed: _guard/.test(error.message);
export const isConstraintFailure = (error: unknown) =>
  error instanceof Error && /constraint failed/i.test(error.message);
