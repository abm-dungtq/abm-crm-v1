import { Hono } from 'hono';
import type { AppBindings } from './env';
import type { NotificationKind } from './notify';

export const notificationRoutes = new Hono<AppBindings>();
export const pushRoutes = new Hono<AppBindings>();

const ok = <T>(data: T) => ({ ok: true as const, data });
const fail = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  ({ ok: false as const, error: { code, message, ...extra } });

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

notificationRoutes.get('/', async (c) => {
  const actor = c.get('actor');
  const before = c.req.query('before') || undefined;
  const rows = await c.env.DB.prepare(`
    SELECT id, kind, title, body, link, created_at, read_at
    FROM notification
    WHERE user_id = ?${before ? ' AND created_at < ?' : ''}
    ORDER BY created_at DESC, id DESC
    LIMIT 30`)
    .bind(actor.id, ...(before ? [before] : []))
    .all<{
      id: string;
      kind: NotificationKind;
      title: string;
      body: string | null;
      link: string | null;
      created_at: string;
      read_at: string | null;
    }>();

  const items: NotificationItem[] = rows.results.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    link: r.link,
    createdAt: r.created_at,
    readAt: r.read_at,
  }));

  return c.json(ok(items));
});

notificationRoutes.get('/unread', async (c) => {
  const actor = c.get('actor');
  const row = await c.env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM notification
    WHERE user_id = ? AND read_at IS NULL`)
    .bind(actor.id)
    .first<{ total: number }>();

  return c.json(ok({ total: row?.total ?? 0 }));
});

notificationRoutes.post('/read', async (c) => {
  const actor = c.get('actor');
  const body = await c.req.json<{ ids?: unknown }>().catch(() => null);
  const now = new Date().toISOString();

  if (body && body.ids !== undefined) {
    if (!Array.isArray(body.ids) || !body.ids.every((id) => typeof id === 'string')) {
      return c.json(fail('VALIDATION_FAILED', 'Danh sách thông báo không hợp lệ', { fields: { ids: 'Không hợp lệ' } }), 422);
    }
    const ids = [...new Set(body.ids.map((id) => id.trim()).filter(Boolean))];
    if (ids.length > 0) {
      await c.env.DB.prepare(`
        UPDATE notification
        SET read_at = COALESCE(read_at, ?)
        WHERE user_id = ? AND read_at IS NULL AND id IN (SELECT value FROM json_each(?))`)
        .bind(now, actor.id, JSON.stringify(ids))
        .run();
    }
  } else {
    await c.env.DB.prepare(`
      UPDATE notification
      SET read_at = COALESCE(read_at, ?)
      WHERE user_id = ? AND read_at IS NULL`)
      .bind(now, actor.id)
      .run();
  }

  return c.json(ok({ readAt: now }));
});

function isHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

pushRoutes.get('/key', (c) => {
  const raw = c.env.VAPID_PUBLIC_KEY?.trim();
  return c.json(ok({ publicKey: raw ? raw : null }));
});

pushRoutes.post('/subscriptions', async (c) => {
  const actor = c.get('actor');
  const body = await c.req.json<{
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown } | null;
    userAgent?: unknown;
  }>().catch(() => null);

  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : '';
  const p256dh = typeof body?.keys?.p256dh === 'string' ? body.keys.p256dh.trim() : '';
  const auth = typeof body?.keys?.auth === 'string' ? body.keys.auth.trim() : '';

  if (!endpoint || !isHttpsUrl(endpoint) || !p256dh || !auth) {
    return c.json(fail('VALIDATION_FAILED', 'Thông tin đăng ký thông báo đẩy không hợp lệ'), 422);
  }

  const userAgent = typeof body?.userAgent === 'string'
    ? body.userAgent.trim().slice(0, 500) || null
    : (c.req.header('user-agent')?.slice(0, 500) ?? null);
  const now = new Date().toISOString();

  await c.env.DB.prepare(`
    INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth, user_agent, created_at, failure_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent,
      failure_count = 0`)
    .bind(crypto.randomUUID(), actor.id, endpoint, p256dh, auth, userAgent, now)
    .run();

  return c.json(ok({ endpoint }));
});

pushRoutes.delete('/subscriptions', async (c) => {
  const actor = c.get('actor');
  const body = await c.req.json<{ endpoint?: unknown }>().catch(() => null);
  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : '';
  if (!endpoint) {
    return c.json(fail('VALIDATION_FAILED', 'Thiếu endpoint đăng ký'), 422);
  }

  await c.env.DB.prepare('DELETE FROM push_subscription WHERE endpoint = ? AND user_id = ?')
    .bind(endpoint, actor.id)
    .run();

  return c.json(ok({ endpoint }));
});
