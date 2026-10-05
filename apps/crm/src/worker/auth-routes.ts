import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { changePasswordInput, loginInput, normalizeEmail } from '@abm/contracts';
import { isDemoMode } from './actor';
import type { AppBindings } from './env';
import { GuardedTx, isGuardFailure } from './guarded-tx';
import { PASSWORD_ITERATIONS, hashPassword, verifyPassword } from './password';
import { SESSION_COOKIE, clearedSessionCookie, createSession, newSession, revokeSession, revokeUserSessions, sessionCookie } from './session';

const MAX_FAILED_LOGINS = 10;
const LOCK_MINUTES = 5;

interface CredentialRow {
  id: string;
  version: number;
  password_hash: string | null;
  password_salt: string | null;
  password_iterations: number | null;
  must_change_password: number;
  temp_password_expires_at: string | null;
  failed_login_count: number;
  locked_until: string | null;
}

const fail = (code: string, message: string, fields?: Record<string, string>) => ({ ok: false as const, error: { code, message, ...(fields ? { fields } : {}) } });
const wrongCredentials = fail('UNAUTHENTICATED', 'Email hoặc mật khẩu không đúng');
const zodFields = (issues: { path: PropertyKey[]; message: string }[]) =>
  Object.fromEntries(issues.map((i) => [String(i.path[0] ?? 'form'), i.message]));

// A row edited by hand may lack part of the credential; treat that as having no password.
const stored = (row: CredentialRow | null) => row?.password_hash && row.password_salt && row.password_iterations
  ? { hash: row.password_hash, salt: row.password_salt, iterations: row.password_iterations } : null;

const locked = (row: CredentialRow, now: Date) => !!row.locked_until && row.locked_until > now.toISOString();
/**
 * Login answers an unknown email or a locked account exactly like a wrong password, and still pays
 * for one full hash, so neither the reply nor its timing reveals which emails exist or are locked.
 */
const DUMMY_CREDENTIAL = { hash: `${'A'.repeat(43)}=`, salt: `${'A'.repeat(22)}==`, iterations: PASSWORD_ITERATIONS };
const lockedResponse = fail('ACCOUNT_LOCKED', `Nhập sai mật khẩu quá nhiều lần, thử lại sau ${LOCK_MINUTES} phút`);

/** Counts a wrong password in one statement, so concurrent attempts cannot slip past the limit. */
const recordFailure = (db: D1Database, userId: string, now: Date) => db.prepare(`UPDATE app_user SET
    locked_until = CASE WHEN failed_login_count + 1 >= ?1 THEN ?2 ELSE locked_until END,
    failed_login_count = CASE WHEN failed_login_count + 1 >= ?1 THEN 0 ELSE failed_login_count + 1 END
  WHERE id = ?3`).bind(MAX_FAILED_LOGINS, new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString(), userId).run();

/** Routes reachable without a session: mounted before requireActor. */
export const publicAuth = new Hono<AppBindings>();

// Mirrors requireActor: a mistyped AUTH_MODE is neither mode, so the web shows a setup error instead of a dead picker.
publicAuth.get('/mode', (c) => c.json({ ok: true, data: {
  mode: c.env.AUTH_MODE === 'password' ? 'password' : isDemoMode(c.env) ? 'demo' : 'unconfigured',
} }));

publicAuth.post('/login', async (c) => {
  if (c.env.AUTH_MODE !== 'password') return c.json(fail('NOT_FOUND', 'Không dùng đăng nhập mật khẩu'), 404);
  const parsed = loginInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(fail('VALIDATION_FAILED', 'Nhập email và mật khẩu', zodFields(parsed.error.issues)), 422);
  const db = c.env.DB;
  const row = await db.prepare(`SELECT id, version, password_hash, password_salt, password_iterations, must_change_password,
      temp_password_expires_at, failed_login_count, locked_until
    FROM app_user WHERE email = ? AND status = 'active'`).bind(normalizeEmail(parsed.data.email)).first<CredentialRow>();
  const credential = stored(row);
  if (!row || !credential) {
    await verifyPassword(parsed.data.password, DUMMY_CREDENTIAL);
    return c.json(wrongCredentials, 401);
  }
  const now = new Date();
  if (locked(row, now)) {
    await verifyPassword(parsed.data.password, credential);
    return c.json(wrongCredentials, 401);
  }
  if (!(await verifyPassword(parsed.data.password, credential))) {
    await recordFailure(db, row.id, now);
    return c.json(wrongCredentials, 401);
  }
  const mustChange = row.must_change_password === 1;
  if (mustChange && (!row.temp_password_expires_at || row.temp_password_expires_at < now.toISOString())) {
    return c.json(fail('TEMP_PASSWORD_EXPIRED', 'Mật khẩu tạm đã hết hạn, liên hệ Admin để cấp lại'), 401);
  }
  if (row.failed_login_count || row.locked_until) {
    await db.prepare('UPDATE app_user SET failed_login_count = 0, locked_until = NULL WHERE id = ?').bind(row.id).run();
  }
  const token = await createSession(db, row.id);
  c.header('Set-Cookie', sessionCookie(token));
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, data: { mustChangePassword: mustChange } });
});

/** Routes that need a session: mounted after requireActor. */
export const sessionAuth = new Hono<AppBindings>();

sessionAuth.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await revokeSession(c.env.DB, token);
  c.header('Set-Cookie', clearedSessionCookie());
  return c.json({ ok: true, data: null });
});

sessionAuth.post('/change-password', async (c) => {
  if (c.env.AUTH_MODE !== 'password') return c.json(fail('NOT_FOUND', 'Không dùng đăng nhập mật khẩu'), 404);
  const parsed = changePasswordInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json(fail('VALIDATION_FAILED', 'Kiểm tra lại mật khẩu', zodFields(parsed.error.issues)), 422);
  const { currentPassword, newPassword } = parsed.data;
  const actor = c.get('actor');
  const db = c.env.DB;
  const row = await db.prepare(`SELECT id, version, password_hash, password_salt, password_iterations, must_change_password,
      temp_password_expires_at, failed_login_count, locked_until FROM app_user WHERE id = ?`).bind(actor.id).first<CredentialRow>();
  const credential = stored(row);
  if (!row || !credential) return c.json(fail('VALIDATION_FAILED', 'Tài khoản chưa có mật khẩu'), 422);
  // The same failure limit as login, so a borrowed session cannot guess the current password.
  const now = new Date();
  if (locked(row, now)) return c.json(lockedResponse, 423);
  if (!(await verifyPassword(currentPassword, credential))) {
    await recordFailure(db, row.id, now);
    return c.json(fail('VALIDATION_FAILED', 'Mật khẩu hiện tại không đúng', { currentPassword: 'Không đúng' }), 422);
  }
  if (newPassword === currentPassword) {
    return c.json(fail('VALIDATION_FAILED', 'Mật khẩu mới phải khác mật khẩu hiện tại', { newPassword: 'Trùng mật khẩu cũ' }), 422);
  }
  const next = await hashPassword(newPassword);
  const tx = new GuardedTx(db, actor, 'changePassword');
  tx.update('app_user', row.id, row.version, {
    password_hash: next.hash, password_salt: next.salt, password_iterations: next.iterations,
    must_change_password: 0, temp_password_expires_at: null, failed_login_count: 0, locked_until: null,
  });
  // Every other device is signed out; this one continues on a fresh session.
  tx.raw(revokeUserSessions(db, row.id, tx.now));
  const session = await newSession(db, row.id, new Date(tx.now));
  tx.raw(session.insert);
  tx.audit('app_user', row.id, null, null);
  try {
    await tx.commit();
  } catch (error) {
    if (isGuardFailure(error)) return c.json(fail('STALE_VERSION', 'Tài khoản vừa thay đổi, thử lại'), 409);
    throw error;
  }
  c.header('Set-Cookie', sessionCookie(session.token));
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, data: null });
});
