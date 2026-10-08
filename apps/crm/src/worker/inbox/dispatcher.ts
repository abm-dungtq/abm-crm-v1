import type { CommandKind } from '@abm/contracts';

/**
 * Leased command queue in D1 (ADR-010). Commands are claimed with a lease; a result is applied only
 * by the claim that still owns it (same `attempts`), so a late result from an expired lease is ignored.
 * Executors must be idempotent because a command can run again after its lease expires.
 */

export type CommandTarget = 'bridge' | 'worker';

export const MAX_COMMAND_ATTEMPTS = 5;
export const DEFAULT_LEASE_SECONDS = 300;
const MAX_CLAIM_BATCH = 100;

export interface EnqueueCommandInput {
  kind: CommandKind;
  target: CommandTarget;
  channelAccountId?: string | null;
  conversationId?: string | null;
  payload: unknown;
  /** Same key twice creates one command; null never deduplicates. */
  dedupeKey?: string | null;
  /** Earliest run time; defaults to now. */
  runAt?: Date;
}

export interface ClaimedCommand {
  id: string;
  kind: CommandKind;
  target: CommandTarget;
  channelAccountId: string | null;
  conversationId: string | null;
  payload: unknown;
  /** Attempt number of this claim; the executor must echo it back with the result. */
  attempts: number;
  claimedAt: string;
  leaseExpiresAt: string;
}

interface CommandRow {
  id: string;
  kind: CommandKind;
  target: CommandTarget;
  channel_account_id: string | null;
  conversation_id: string | null;
  payload_json: string;
  attempts: number;
  claimed_at: string;
  lease_expires_at: string;
}

/**
 * The INSERT of a new command, for callers that must place it in their own batch. A row with the same
 * dedupe key already present makes it change nothing.
 */
export function commandInsertStatement(db: D1Database, input: EnqueueCommandInput): { id: string; statement: D1PreparedStatement } {
  const now = new Date().toISOString();
  const runAt = (input.runAt ?? new Date()).toISOString();
  const id = crypto.randomUUID();
  const statement = db.prepare(`INSERT INTO channel_command
      (id, kind, target, channel_account_id, conversation_id, payload_json, next_run_at, dedupe_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(dedupe_key) DO NOTHING`)
    .bind(id, input.kind, input.target, input.channelAccountId ?? null, input.conversationId ?? null,
      JSON.stringify(input.payload ?? null), runAt, input.dedupeKey ?? null, now, now);
  return { id, statement };
}

/** Inserts a command, or returns the id of the existing command with the same dedupe key. */
export async function enqueueCommand(db: D1Database, input: EnqueueCommandInput): Promise<string> {
  const dedupeKey = input.dedupeKey ?? null;
  const { id, statement } = commandInsertStatement(db, input);
  const inserted = await statement.run();
  if (inserted.meta.changes === 1) return id;
  if (dedupeKey === null) throw new Error('channel_command insert changed no row');
  const existing = await db.prepare('SELECT id FROM channel_command WHERE dedupe_key = ?').bind(dedupeKey).first<{ id: string }>();
  if (!existing) throw new Error('channel_command dedupe conflict without an existing row');
  return existing.id;
}

const CLAIMABLE = `((status = 'pending' AND next_run_at <= ?) OR (status = 'claimed' AND lease_expires_at < ?))`;

/**
 * Claims up to `limit` due commands for `target`: pending ones whose run time has come and claimed ones
 * whose lease expired. Each row is taken with a compare-and-set UPDATE, so two concurrent claimers
 * never both get the same command.
 */
export async function claimCommands(
  db: D1Database, target: CommandTarget, limit: number, leaseSeconds = DEFAULT_LEASE_SECONDS, now = new Date(),
): Promise<ClaimedCommand[]> {
  if (!Number.isInteger(limit) || limit < 1) return [];
  if (!Number.isFinite(leaseSeconds) || leaseSeconds <= 0) throw new Error('leaseSeconds must be positive');
  const nowIso = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
  const candidates = await db.prepare(`SELECT id, attempts FROM channel_command
    WHERE target = ? AND ${CLAIMABLE}
    ORDER BY next_run_at, created_at LIMIT ?`)
    .bind(target, nowIso, nowIso, Math.min(limit, MAX_CLAIM_BATCH))
    .all<{ id: string; attempts: number }>();
  if (candidates.results.length === 0) return [];

  const updates = candidates.results.map((c) => db.prepare(`UPDATE channel_command
      SET status = 'claimed', attempts = attempts + 1, claimed_at = ?, lease_expires_at = ?, updated_at = ?
    WHERE id = ? AND target = ? AND attempts = ? AND ${CLAIMABLE}
    RETURNING id, kind, target, channel_account_id, conversation_id, payload_json, attempts, claimed_at, lease_expires_at`)
    .bind(nowIso, leaseExpiresAt, nowIso, c.id, target, c.attempts, nowIso, nowIso));
  const results = await db.batch<CommandRow>(updates);
  return results.flatMap((r) => r.results).map((row) => ({
    id: row.id,
    kind: row.kind,
    target: row.target,
    channelAccountId: row.channel_account_id,
    conversationId: row.conversation_id,
    payload: JSON.parse(row.payload_json) as unknown,
    attempts: row.attempts,
    claimedAt: row.claimed_at,
    leaseExpiresAt: row.lease_expires_at,
  }));
}

/** Marks a claimed command done. False means the claim no longer owns it; the caller must drop the result. */
export async function completeCommand(db: D1Database, id: string, attempts: number, result: unknown): Promise<boolean> {
  const res = await db.prepare(`UPDATE channel_command
      SET status = 'done', result_json = ?, lease_expires_at = NULL, updated_at = ?
    WHERE id = ? AND status = 'claimed' AND attempts = ?`)
    .bind(JSON.stringify(result ?? null), new Date().toISOString(), id, attempts)
    .run();
  return res.meta.changes === 1;
}

/**
 * Records a failed attempt of a claimed command: after the last allowed attempt it becomes `failed`,
 * otherwise it returns to `pending` and runs again after 2^attempts minutes.
 * False means the claim no longer owns the command and nothing changed.
 */
export async function failCommand(db: D1Database, id: string, attempts: number, error: string, now = new Date()): Promise<boolean> {
  const exhausted = attempts >= MAX_COMMAND_ATTEMPTS;
  const nextRunAt = new Date(now.getTime() + 2 ** attempts * 60_000).toISOString();
  const nowIso = now.toISOString();
  const res = await db.prepare(`UPDATE channel_command
      SET status = ?, next_run_at = CASE WHEN ? = 1 THEN next_run_at ELSE ? END,
        lease_expires_at = NULL, result_json = ?, updated_at = ?
    WHERE id = ? AND status = 'claimed' AND attempts = ?`)
    .bind(exhausted ? 'failed' : 'pending', exhausted ? 1 : 0, nextRunAt, JSON.stringify({ error }), nowIso, id, attempts)
    .run();
  return res.meta.changes === 1;
}

/** The Worker gives up on a command nobody has claimed yet. False when it is no longer pending. */
export async function cancelCommand(db: D1Database, id: string, error: string): Promise<boolean> {
  const res = await db.prepare(`UPDATE channel_command SET status = 'failed', result_json = ?, updated_at = ?
    WHERE id = ? AND status = 'pending'`)
    .bind(JSON.stringify({ error }), new Date().toISOString(), id)
    .run();
  return res.meta.changes === 1;
}

/**
 * Outgoing customer messages one channel account has sent, is sending or has waiting to send since
 * `dayStartIso` (start of the current day in Vietnam time, as an ISO instant). A claimed or done send counts
 * by claim time, a waiting one by creation time, so sends queued while the bridge is offline still use up the cap.
 */
export async function accountSendsToday(db: D1Database, channelAccountId: string, dayStartIso: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM channel_command
    WHERE channel_account_id = ? AND kind IN ('send_zalo', 'send_messenger')
      AND status IN ('pending', 'claimed', 'done') AND COALESCE(claimed_at, created_at) >= ?`)
    .bind(channelAccountId, dayStartIso)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}
