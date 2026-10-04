import type { MiddlewareHandler } from 'hono';
import type { AppBindings } from './env';

export const SESSION_COOKIE = 'abm_session';
export const SESSION_DAYS = 7;

const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function tokenHash(token: string) {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
}

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** Returns the cookie token and the INSERT statement, so callers can place it inside a batch. */
export async function newSession(db: D1Database, userId: string, now = new Date()) {
  const token = newToken();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString();
  const insert = db.prepare('INSERT INTO user_session (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await tokenHash(token), userId, now.toISOString(), expires);
  return { token, insert };
}

export async function createSession(db: D1Database, userId: string) {
  const { token, insert } = await newSession(db, userId);
  await insert.run();
  return token;
}

export async function readSession(db: D1Database, token: string): Promise<string | null> {
  const row = await db.prepare(`SELECT user_id FROM user_session
    WHERE id_hash = ? AND revoked_at IS NULL AND expires_at > ?`).bind(await tokenHash(token), new Date().toISOString())
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}

export async function revokeSession(db: D1Database, token: string) {
  await db.prepare('UPDATE user_session SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL')
    .bind(new Date().toISOString(), await tokenHash(token)).run();
}

export function revokeUserSessions(db: D1Database, userId: string, now = new Date().toISOString()) {
  return db.prepare('UPDATE user_session SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').bind(now, userId);
}

export const sessionCookie = (token: string) =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}`;
export const clearedSessionCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/** Cookie sessions ride along on cross-site form posts; writes must come from this origin. */
export const originGuard: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (c.env.AUTH_MODE === 'password' && c.req.method !== 'GET' && c.req.method !== 'HEAD'
    && c.req.header('Origin') !== new URL(c.req.url).origin) {
    return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Yêu cầu không đến từ trang CRM' } }, 403);
  }
  await next();
};
