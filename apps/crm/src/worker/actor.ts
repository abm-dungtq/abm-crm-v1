import type { MiddlewareHandler } from 'hono';
import type { RoleCode } from '@abm/contracts';
import type { Actor, AppBindings } from './env';

export const DEMO_USER_HEADER = 'X-Demo-User';

interface UserRow {
  id: string;
  organization_id: string;
  department_id: string | null;
  team_id: string | null;
  role: RoleCode;
  display_name: string;
}

export async function loadActor(db: D1Database, userId: string): Promise<Actor | null> {
  const row = await db.prepare(`SELECT id, organization_id, department_id, team_id, role, display_name
    FROM app_user WHERE id = ? AND status = 'active'`).bind(userId).first<UserRow>();
  if (!row) return null;
  return {
    id: row.id, organizationId: row.organization_id, departmentId: row.department_id,
    teamId: row.team_id, role: row.role, displayName: row.display_name,
  };
}

/**
 * Evaluation identity: with DEMO_MODE=1 the viewer picks a synthetic user via header.
 * Without DEMO_MODE no identity source is wired yet (Cloudflare Access / Lark OAuth per
 * ADR-002), so every API call is rejected rather than falling back to a default user.
 */
export const requireActor: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (c.env.DEMO_MODE !== '1') {
    return c.json({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Chưa cấu hình đăng nhập' } }, 401);
  }
  const userId = c.req.header(DEMO_USER_HEADER);
  const actor = userId ? await loadActor(c.env.DB, userId) : null;
  if (!actor) {
    return c.json({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Chọn người dùng demo' } }, 401);
  }
  c.set('actor', actor);
  await next();
};
