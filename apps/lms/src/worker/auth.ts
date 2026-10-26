import { PASSWORD_ITERATIONS, hashPassword, verifyPassword, type StoredPassword } from '@abm/lms-core';
import { Hono, type MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import type { AppBindings } from './env';

export const SESSION_COOKIE = 'abm_learner';
export const SESSION_DAYS = 30;
export const MAX_FAILED_LOGINS = 10;
export const LOCK_MINUTES = 5;

const toHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function tokenHash(token: string) {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
}

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export async function newSession(db: D1Database, accountId: string, now = new Date()) {
  const token = newToken();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString();
  const insert = db
    .prepare('INSERT INTO learner_session (id_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await tokenHash(token), accountId, now.toISOString(), expires);
  return { token, insert };
}

export async function createSession(db: D1Database, accountId: string, now = new Date()) {
  const { token, insert } = await newSession(db, accountId, now);
  await insert.run();
  return token;
}

export async function readSession(db: D1Database, token: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT account_id FROM learner_session
       WHERE id_hash = ? AND revoked_at IS NULL AND expires_at > ?`,
    )
    .bind(await tokenHash(token), new Date().toISOString())
    .first<{ account_id: string }>();
  return row?.account_id ?? null;
}

export async function revokeSession(db: D1Database, token: string) {
  await db
    .prepare('UPDATE learner_session SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL')
    .bind(new Date().toISOString(), await tokenHash(token))
    .run();
}

export const sessionCookie = (token: string) =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}`;

export const clearedSessionCookie = () =>
  `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export const originGuard: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (
    c.req.method !== 'GET' &&
    c.req.method !== 'HEAD' &&
    c.req.header('Origin') !== new URL(c.req.url).origin
  ) {
    return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Yêu cầu không đến từ trang học' } }, 403);
  }
  await next();
};

interface AccountRow {
  id: string;
  organization_id: string;
  contact_id: string;
  email: string;
  password_hash: string | null;
  password_salt: string | null;
  password_iterations: number | null;
  status: string;
  failed_login_count: number;
  locked_until: string | null;
  version: number;
}

interface OrgDefaultPasswordRow {
  hash: string | null;
  salt: string | null;
  iterations: number | null;
}

const fail = (code: string, message: string, fields?: Record<string, string>) => ({
  ok: false as const,
  error: { code, message, ...(fields ? { fields } : {}) },
});

const wrongCredentials = fail('UNAUTHENTICATED', 'Email hoặc mật khẩu không đúng');
const sessionExpired = fail('UNAUTHENTICATED', 'Phiên đăng nhập đã hết, vui lòng đăng nhập lại');

const DUMMY_CREDENTIAL: StoredPassword = {
  hash: `${'A'.repeat(43)}=`,
  salt: `${'A'.repeat(22)}==`,
  iterations: PASSWORD_ITERATIONS,
};

const locked = (row: Pick<AccountRow, 'locked_until'>, now: Date) =>
  !!row.locked_until && row.locked_until > now.toISOString();

const recordFailure = (db: D1Database, accountId: string, now: Date) =>
  db
    .prepare(
      `UPDATE learner_account SET
         locked_until = CASE WHEN failed_login_count + 1 >= ?1 THEN ?2 ELSE locked_until END,
         failed_login_count = CASE WHEN failed_login_count + 1 >= ?1 THEN 0 ELSE failed_login_count + 1 END
       WHERE id = ?3`,
    )
    .bind(MAX_FAILED_LOGINS, new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString(), accountId)
    .run();

async function resolveCredential(
  db: D1Database,
  row: AccountRow,
): Promise<{ credential: StoredPassword | null; usesDefaultPassword: boolean }> {
  if (row.password_hash && row.password_salt && row.password_iterations) {
    return {
      credential: {
        hash: row.password_hash,
        salt: row.password_salt,
        iterations: row.password_iterations,
      },
      usesDefaultPassword: false,
    };
  }
  const org = await db
    .prepare(
      `SELECT learner_default_password_hash AS hash,
              learner_default_password_salt AS salt,
              learner_default_password_iterations AS iterations
       FROM org_setting WHERE organization_id = ?`,
    )
    .bind(row.organization_id)
    .first<OrgDefaultPasswordRow>();
  if (!org || !org.hash || !org.salt || !org.iterations) {
    return { credential: null, usesDefaultPassword: true };
  }
  return {
    credential: { hash: org.hash, salt: org.salt, iterations: org.iterations },
    usesDefaultPassword: true,
  };
}

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Nhập email'),
  password: z.string().min(1, 'Nhập mật khẩu').max(128),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Nhập mật khẩu hiện tại').max(128),
  newPassword: z
    .string()
    .min(8, 'Mật khẩu mới cần ít nhất 8 ký tự')
    .max(128, 'Mật khẩu mới tối đa 128 ký tự'),
});

const zodFields = (issues: { path: PropertyKey[]; message: string }[]) =>
  Object.fromEntries(issues.map((i) => [String(i.path[0] ?? 'form'), i.message]));

export const publicAuthRoutes = new Hono<AppBindings>();

publicAuthRoutes.post('/login', async (c) => {
  const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(fail('VALIDATION_FAILED', 'Nhập email và mật khẩu', zodFields(parsed.error.issues)), 422);
  }
  const db = c.env.DB;
  const now = new Date();
  const row = await db
    .prepare(
      `SELECT id, organization_id, contact_id, email, password_hash, password_salt, password_iterations,
              status, failed_login_count, locked_until, version
       FROM learner_account WHERE email = ?`,
    )
    .bind(parsed.data.email)
    .first<AccountRow>();

  if (!row || row.status !== 'active' || locked(row, now)) {
    await verifyPassword(parsed.data.password, DUMMY_CREDENTIAL);
    return c.json(wrongCredentials, 401);
  }

  const { credential, usesDefaultPassword } = await resolveCredential(db, row);
  if (!credential) {
    await verifyPassword(parsed.data.password, DUMMY_CREDENTIAL);
    return c.json(fail('UNAUTHENTICATED', 'Tài khoản chưa sẵn sàng, vui lòng liên hệ Học vụ ABM'), 401);
  }

  if (!(await verifyPassword(parsed.data.password, credential))) {
    await recordFailure(db, row.id, now);
    return c.json(wrongCredentials, 401);
  }

  const nowIso = now.toISOString();
  const { token, insert } = await newSession(db, row.id, now);
  await db.batch([
    db
      .prepare(
        `UPDATE learner_account
         SET failed_login_count = 0, locked_until = NULL, last_login_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(nowIso, nowIso, row.id),
    insert,
  ]);

  c.header('Set-Cookie', sessionCookie(token));
  return c.json({ ok: true, data: { usesDefaultPassword } });
});

export const requireLearner: MiddlewareHandler<AppBindings> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    return c.json(sessionExpired, 401);
  }
  const hash = await tokenHash(token);
  const nowIso = new Date().toISOString();
  const row = await c.env.DB.prepare(
    `SELECT a.id AS account_id, a.contact_id, a.organization_id, a.email, a.password_hash
     FROM learner_session s
     JOIN learner_account a ON a.id = s.account_id
     WHERE s.id_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND a.status = 'active'`,
  )
    .bind(hash, nowIso)
    .first<{
      account_id: string;
      contact_id: string;
      organization_id: string;
      email: string;
      password_hash: string | null;
    }>();

  if (!row) {
    return c.json(sessionExpired, 401);
  }

  c.set('learner', {
    accountId: row.account_id,
    contactId: row.contact_id,
    organizationId: row.organization_id,
    email: row.email,
    usesDefaultPassword: row.password_hash === null,
  });
  await next();
};

export const sessionAuthRoutes = new Hono<AppBindings>();

sessionAuthRoutes.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await revokeSession(c.env.DB, token);
  }
  c.header('Set-Cookie', clearedSessionCookie());
  return c.json({ ok: true, data: {} });
});

sessionAuthRoutes.post('/change-password', async (c) => {
  const parsed = changePasswordSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(fail('VALIDATION_FAILED', 'Kiểm tra lại mật khẩu', zodFields(parsed.error.issues)), 422);
  }
  const { currentPassword, newPassword } = parsed.data;
  if (newPassword === currentPassword) {
    return c.json(fail('VALIDATION_FAILED', 'Kiểm tra lại mật khẩu', { newPassword: 'Mật khẩu mới phải khác mật khẩu hiện tại' }), 422);
  }
  const learner = c.get('learner');
  const db = c.env.DB;
  const now = new Date();

  const row = await db
    .prepare(
      `SELECT id, organization_id, contact_id, email, password_hash, password_salt, password_iterations,
              status, failed_login_count, locked_until, version
       FROM learner_account WHERE id = ? AND status = 'active'`,
    )
    .bind(learner.accountId)
    .first<AccountRow>();

  if (!row || locked(row, now)) {
    await verifyPassword(currentPassword, DUMMY_CREDENTIAL);
    return c.json(wrongCredentials, 401);
  }

  const { credential } = await resolveCredential(db, row);
  if (!credential) {
    return c.json(fail('UNAUTHENTICATED', 'Tài khoản chưa sẵn sàng, vui lòng liên hệ Học vụ ABM'), 401);
  }

  if (!(await verifyPassword(currentPassword, credential))) {
    await recordFailure(db, row.id, now);
    return c.json(
      fail('VALIDATION_FAILED', 'Mật khẩu hiện tại không đúng', { currentPassword: 'Không đúng' }),
      422,
    );
  }

  const next = await hashPassword(newPassword);
  const nowIso = now.toISOString();
  const currentToken = getCookie(c, SESSION_COOKIE);
  const currentHash = currentToken ? await tokenHash(currentToken) : '';

  await db.batch([
    db
      .prepare(
        `UPDATE learner_account
         SET password_hash = ?, password_salt = ?, password_iterations = ?,
             password_changed_at = ?, failed_login_count = 0, locked_until = NULL,
             version = version + 1, updated_at = ?
         WHERE id = ?`,
      )
      .bind(next.hash, next.salt, next.iterations, nowIso, nowIso, row.id),
    db
      .prepare(
        `UPDATE learner_session
         SET revoked_at = ?
         WHERE account_id = ? AND id_hash <> ? AND revoked_at IS NULL`,
      )
      .bind(nowIso, row.id, currentHash),
  ]);

  return c.json({ ok: true, data: {} });
});
