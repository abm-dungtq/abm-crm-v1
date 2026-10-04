import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { RoleCode } from '@abm/contracts';
import type { Actor, AppBindings, Env } from './env';
import { SESSION_COOKIE, readSession } from './session';

export const DEMO_USER_HEADER = 'X-Demo-User';

/**
 * The two identity modes are exclusive: any AUTH_MODE value switches every demo path off,
 * so a mistyped value fails closed instead of opening header impersonation.
 */
export const isDemoMode = (env: Env) => !env.AUTH_MODE && env.DEMO_MODE === '1';

interface UserRow {
  id: string;
  organization_id: string;
  department_id: string | null;
  team_id: string | null;
  role: RoleCode;
  display_name: string;
  must_change_password: number;
}

async function loadUser(db: D1Database, userId: string, kind: Actor['kind'] = 'human') {
  const row = await db.prepare(`SELECT id, organization_id, department_id, team_id, role, display_name, must_change_password
    FROM app_user WHERE id = ? AND status = 'active'`).bind(userId).first<UserRow>();
  if (!row) return null;
  const actor: Actor = {
    id: row.id, organizationId: row.organization_id, departmentId: row.department_id,
    teamId: row.team_id, role: row.role, displayName: row.display_name, kind,
  };
  return { actor, mustChangePassword: row.must_change_password === 1 };
}

export async function loadActor(db: D1Database, userId: string): Promise<Actor | null> {
  return (await loadUser(db, userId))?.actor ?? null;
}

/** Actor for a chat agent acting with this user's token; a disabled user resolves to null. */
export async function loadAgentActor(db: D1Database, userId: string): Promise<Actor | null> {
  return (await loadUser(db, userId, 'agent'))?.actor ?? null;
}

// While a temporary password is in force only these routes stay open.
const CHANGE_PASSWORD_ROUTES = new Set(['GET /api/me', 'POST /api/auth/change-password', 'POST /api/auth/logout']);

const unauthenticated = (message: string) => ({ ok: false as const, error: { code: 'UNAUTHENTICATED' as const, message } });

/**
 * AUTH_MODE=password: identity comes only from the session cookie (ADR-006); the demo header is ignored.
 * Otherwise DEMO_MODE=1 lets an evaluation viewer pick a synthetic user via header, and anything
 * else is rejected rather than falling back to a default user.
 */
export const requireActor: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (c.env.AUTH_MODE === 'password') {
    const token = getCookie(c, SESSION_COOKIE);
    const userId = token ? await readSession(c.env.DB, token) : null;
    const user = userId ? await loadUser(c.env.DB, userId) : null;
    if (!user) return c.json(unauthenticated('Phiên đăng nhập đã hết, đăng nhập lại'), 401);
    if (user.mustChangePassword && !CHANGE_PASSWORD_ROUTES.has(`${c.req.method} ${c.req.path}`)) {
      return c.json({ ok: false, error: { code: 'PASSWORD_CHANGE_REQUIRED', message: 'Đổi mật khẩu tạm trước khi tiếp tục' } }, 403);
    }
    c.set('actor', user.actor);
    c.set('mustChangePassword', user.mustChangePassword);
    return next();
  }
  if (!isDemoMode(c.env)) return c.json(unauthenticated('Chưa cấu hình đăng nhập'), 401);
  const userId = c.req.header(DEMO_USER_HEADER);
  const user = userId ? await loadUser(c.env.DB, userId) : null;
  if (!user) return c.json(unauthenticated('Chọn người dùng demo'), 401);
  c.set('actor', user.actor);
  c.set('mustChangePassword', false);
  await next();
};
