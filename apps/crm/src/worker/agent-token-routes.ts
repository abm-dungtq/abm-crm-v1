import { Hono } from 'hono';
import { z } from 'zod';
import { sha256 } from './commands';
import type { Actor, AppBindings } from './env';

/**
 * Self-service MCP tokens ("Kết nối agent"). Each person manages only their own tokens. A token value is returned
 * once, by create and rotate, and is stored only as its SHA-256 hash; it never reaches a log or an audit row.
 */
export const agentTokenRoutes = new Hono<AppBindings>();

export const MAX_ACTIVE_SELF_TOKENS = 5;
const DAY_MS = 86_400_000;

const createInput = z.object({
  label: z.string().trim().min(1).max(40),
  scope: z.enum(['read', 'read_tasks']).default('read'),
  expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(180)]).default(90),
});

const ok = <T>(data: T) => ({ ok: true as const, data });
const fail = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  ({ ok: false as const, error: { code, message, ...extra } });
const notFound = fail('NOT_FOUND', 'Không tìm thấy token');
const tooMany = fail('VALIDATION_FAILED', `Tối đa ${MAX_ACTIVE_SELF_TOKENS} token đang dùng. Thu hồi bớt rồi tạo lại.`);

/** Active = self-issued, not revoked and not expired. Expired tokens do not count toward the limit. */
const ACTIVE_SELF_COUNT = `(SELECT COUNT(*) FROM agent_token
  WHERE user_id = ? AND created_via = 'self' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?))`;

function newTokenValue() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `abmcrm_${b64}`;
}

const mcpUrl = (appUrl: string | undefined, requestUrl: string) =>
  `${(appUrl || new URL(requestUrl).origin).replace(/\/+$/, '')}/api/mcp`;

/** A person whose account is disabled or locked after failed logins may not mint new agent credentials. */
async function mayIssue(db: D1Database, actor: Actor, now: string) {
  const row = await db.prepare('SELECT status, locked_until FROM app_user WHERE id = ?').bind(actor.id)
    .first<{ status: string; locked_until: string | null }>();
  return Boolean(row && row.status === 'active' && !(row.locked_until && row.locked_until > now));
}

/**
 * Inserts a self token only while the person stays under the active limit, and audits it in the same batch.
 * Returns false when the limit (or a concurrent request) stopped the insert.
 */
async function insertSelfToken(db: D1Database, actor: Actor, input: { label: string; scope: 'read' | 'read_tasks'; ttlMs: number },
  now: string, extra: D1PreparedStatement[] = [], extraGuard?: { sql: string; binds: unknown[] }) {
  const id = crypto.randomUUID();
  const token = newTokenValue();
  const expiresAt = new Date(Date.parse(now) + input.ttlMs).toISOString();
  const guard = extraGuard ? ` AND ${extraGuard.sql}` : '';
  const results = await db.batch([
    ...extra,
    db.prepare(`INSERT INTO agent_token (id, user_id, token_hash, label, created_at, scope, expires_at, created_via)
      SELECT ?, ?, ?, ?, ?, ?, ?, 'self' WHERE ${ACTIVE_SELF_COUNT} < ?${guard}`)
      .bind(id, actor.id, await sha256(token), input.label, now, input.scope, expiresAt,
        actor.id, now, MAX_ACTIVE_SELF_TOKENS, ...(extraGuard?.binds ?? [])),
    db.prepare(`INSERT INTO audit_log (id, actor_user_id, actor_kind, command, entity, entity_id, before_json, after_json, created_at)
      SELECT ?, ?, ?, 'agentToken.create', 'agent_token', ?, NULL, ?, ? WHERE EXISTS (SELECT 1 FROM agent_token WHERE id = ?)`)
      .bind(crypto.randomUUID(), actor.id, actor.kind, id, JSON.stringify({ label: input.label, scope: input.scope, expiresAt }), now, id),
  ]);
  const inserted = (results[extra.length]?.meta?.changes ?? 0) === 1;
  return inserted ? { id, token, expiresAt } : null;
}

agentTokenRoutes.get('/', async (c) => {
  const actor = c.get('actor');
  const rows = await c.env.DB.prepare(`SELECT id, label, scope, created_at, last_used_at, expires_at FROM agent_token
    WHERE user_id = ? AND created_via = 'self' AND revoked_at IS NULL ORDER BY created_at DESC, id DESC`)
    .bind(actor.id)
    .all<{ id: string; label: string | null; scope: string; created_at: string; last_used_at: string | null; expires_at: string | null }>();
  return c.json(ok(rows.results.map((r) => ({
    id: r.id, label: r.label ?? '', scope: r.scope, createdAt: r.created_at, lastUsedAt: r.last_used_at, expiresAt: r.expires_at,
  }))));
});

agentTokenRoutes.post('/', async (c) => {
  const actor = c.get('actor');
  const db = c.env.DB;
  const parsed = createInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join('.') || '_'] ??= 'Không hợp lệ';
    return c.json(fail('VALIDATION_FAILED', 'Dữ liệu chưa hợp lệ', { fields }), 422);
  }
  const now = new Date().toISOString();
  if (!(await mayIssue(db, actor, now))) return c.json(fail('FORBIDDEN', 'Tài khoản đang bị khóa, không tạo được token'), 403);
  const created = await insertSelfToken(db, actor, { label: parsed.data.label, scope: parsed.data.scope, ttlMs: parsed.data.expiresInDays * DAY_MS }, now);
  if (!created) return c.json(tooMany, 422);
  c.header('Cache-Control', 'no-store');
  return c.json(ok({ id: created.id, token: created.token, mcpUrl: mcpUrl(c.env.APP_URL, c.req.url), expiresAt: created.expiresAt }));
});

agentTokenRoutes.post('/:id/rotate', async (c) => {
  const actor = c.get('actor');
  const db = c.env.DB;
  const oldId = c.req.param('id');
  const old = await db.prepare(`SELECT id, label, scope, created_at, expires_at FROM agent_token
    WHERE id = ? AND user_id = ? AND created_via = 'self' AND revoked_at IS NULL`)
    .bind(oldId, actor.id).first<{ id: string; label: string | null; scope: 'read' | 'read_tasks'; created_at: string; expires_at: string | null }>();
  if (!old) return c.json(notFound, 404);
  const now = new Date().toISOString();
  if (!(await mayIssue(db, actor, now))) return c.json(fail('FORBIDDEN', 'Tài khoản đang bị khóa, không tạo được token'), 403);
  const span = old.expires_at ? Date.parse(old.expires_at) - Date.parse(old.created_at) : NaN;
  const ttlMs = Number.isFinite(span) && span > 0 ? span : 90 * DAY_MS;
  // The old row is revoked first in the same batch, so it never counts toward the limit, and the new row is only
  // written when this request is the one that revoked it (a concurrent rotate of the same token writes nothing).
  const created = await insertSelfToken(db, actor, { label: old.label ?? '', scope: old.scope, ttlMs }, now, [
    db.prepare('UPDATE agent_token SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL').bind(now, old.id, actor.id),
    db.prepare(`INSERT INTO audit_log (id, actor_user_id, actor_kind, command, entity, entity_id, before_json, after_json, created_at)
      SELECT ?, ?, ?, 'agentToken.revoke', 'agent_token', ?, NULL, ?, ?
      WHERE EXISTS (SELECT 1 FROM agent_token WHERE id = ? AND revoked_at = ?)`)
      .bind(crypto.randomUUID(), actor.id, actor.kind, old.id, JSON.stringify({ reason: 'rotate' }), now, old.id, now),
  ], { sql: 'EXISTS (SELECT 1 FROM agent_token WHERE id = ? AND revoked_at = ?)', binds: [old.id, now] });
  if (!created) return c.json(fail('CONFLICT', 'Token vừa được đổi hoặc đã đủ số token. Tải lại rồi thử lại.'), 409);
  c.header('Cache-Control', 'no-store');
  return c.json(ok({ id: created.id, token: created.token, mcpUrl: mcpUrl(c.env.APP_URL, c.req.url), expiresAt: created.expiresAt }));
});

agentTokenRoutes.delete('/:id', async (c) => {
  const actor = c.get('actor');
  const db = c.env.DB;
  const id = c.req.param('id');
  const now = new Date().toISOString();
  const [revoked] = await db.batch([
    db.prepare(`UPDATE agent_token SET revoked_at = ? WHERE id = ? AND user_id = ? AND created_via = 'self' AND revoked_at IS NULL`)
      .bind(now, id, actor.id),
    db.prepare(`INSERT INTO audit_log (id, actor_user_id, actor_kind, command, entity, entity_id, before_json, after_json, created_at)
      SELECT ?, ?, ?, 'agentToken.revoke', 'agent_token', ?, NULL, NULL, ?
      WHERE EXISTS (SELECT 1 FROM agent_token WHERE id = ? AND user_id = ? AND revoked_at = ?)`)
      .bind(crypto.randomUUID(), actor.id, actor.kind, id, now, id, actor.id, now),
  ]);
  if ((revoked?.meta?.changes ?? 0) !== 1) return c.json(notFound, 404);
  return c.json(ok({ id }));
});
