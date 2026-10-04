import { Hono } from 'hono';
import { COMMANDS, SEARCH_MAX_LENGTH, type ApiResult, type CommandName } from '@abm/contracts';
import { isDemoMode, requireActor } from './actor';
import { adminRoutes } from './admin-routes';
import { publicAuth, sessionAuth } from './auth-routes';
import { originGuard } from './session';
import { runCommand } from './commands';
import type { AppBindings } from './env';
import {
  accountDetail, adminOverview, canReadAudit, dashboard, leadDetail, listAccounts, listApprovals,
  listAudit, listLeads, listTasks, search, teamMembers,
} from './queries';

const STATUS: Record<string, 200 | 400 | 401 | 403 | 404 | 409 | 422> = {
  FORBIDDEN: 403, NOT_FOUND: 404, STALE_VERSION: 409, IDEMPOTENCY_CONFLICT: 409, DUPLICATE_SUSPECTED: 409,
  VALIDATION_FAILED: 422, APPROVAL_REQUIRED: 409, KILL_SWITCH_ON: 409, UNAUTHENTICATED: 401,
};

const app = new Hono<AppBindings>().basePath('/api');

app.onError((error, c) => {
  console.error('api_error', error instanceof Error ? error.message : error);
  return c.json({ ok: false, error: { code: 'INTERNAL', message: 'Lỗi hệ thống, thử lại sau' } }, 500);
});

app.get('/health', (c) => c.json({ ok: true }));
app.use('*', originGuard);
app.route('/auth', publicAuth);

// The demo user picker needs the synthetic roster before any identity exists.
app.get('/demo-users', async (c) => {
  if (!isDemoMode(c.env)) return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Không ở chế độ demo' } }, 403);
  const rows = await c.env.DB.prepare(`SELECT u.id, u.display_name AS name, u.role, t.name AS teamName
    FROM app_user u LEFT JOIN team t ON t.id = u.team_id WHERE u.status = 'active'
    ORDER BY CASE u.role WHEN 'sale' THEN 1 WHEN 'leader' THEN 2 WHEN 'head' THEN 3 WHEN 'director' THEN 4 ELSE 5 END, u.display_name`).all();
  return c.json({ ok: true, data: rows.results });
});

app.use('*', requireActor);
app.route('/auth', sessionAuth);
app.route('/admin', adminRoutes);

const data = <T>(value: T) => ({ ok: true as const, data: value });
const notFound = { ok: false as const, error: { code: 'NOT_FOUND' as const, message: 'Không tìm thấy trong phạm vi của bạn' } };
const forbidden = { ok: false as const, error: { code: 'FORBIDDEN' as const, message: 'Vai trò hiện tại không xem được mục này' } };

const tooLong = { ok: false as const, error: { code: 'VALIDATION_FAILED' as const, message: `Từ khoá tối đa ${SEARCH_MAX_LENGTH} ký tự`, fields: { q: 'Quá dài' } } };
// Search text is matched in the Worker; an unbounded keyword only costs CPU.
app.use('*', async (c, next) => {
  if ((c.req.query('q')?.length ?? 0) > SEARCH_MAX_LENGTH) return c.json(tooLong, 422);
  await next();
});

app.get('/me', (c) => c.json(data({ ...c.get('actor'), mustChangePassword: c.get('mustChangePassword') })));
app.get('/dashboard', async (c) => c.json(data(await dashboard(c.env.DB, c.get('actor')))));
app.get('/leads', async (c) => c.json(data(await listLeads(c.env.DB, c.get('actor'), {
  status: c.req.query('status') || undefined, stage: c.req.query('stage') || undefined,
  ownerId: c.req.query('owner') || undefined, q: c.req.query('q') || undefined,
}))));
app.get('/leads/:id', async (c) => {
  const detail = await leadDetail(c.env.DB, c.get('actor'), c.req.param('id'));
  return detail ? c.json(data(detail)) : c.json(notFound, 404);
});
app.get('/tasks', async (c) => c.json(data(await listTasks(c.env.DB, c.get('actor'), c.req.query('status') === 'completed' ? 'completed' : 'open'))));
app.get('/accounts', async (c) => c.json(data(await listAccounts(c.env.DB, c.get('actor'), c.req.query('q') || undefined))));
app.get('/accounts/:id', async (c) => {
  const detail = await accountDetail(c.env.DB, c.get('actor'), c.req.param('id'));
  return detail ? c.json(data(detail)) : c.json(notFound, 404);
});
app.get('/approvals', async (c) => c.json(data(await listApprovals(c.env.DB, c.get('actor'), c.req.query('status') || undefined))));
app.get('/audit', async (c) => {
  const actor = c.get('actor');
  if (!canReadAudit(actor)) return c.json(forbidden, 403);
  return c.json(data(await listAudit(c.env.DB, actor)));
});
app.get('/team-members', async (c) => c.json(data(await teamMembers(c.env.DB, c.get('actor').teamId))));
app.get('/search', async (c) => c.json(data(await search(c.env.DB, c.get('actor'), c.req.query('q') ?? ''))));
app.get('/admin/overview', async (c) => {
  const actor = c.get('actor');
  if (actor.role !== 'admin') return c.json(forbidden, 403);
  return c.json(data(await adminOverview(c.env.DB, actor)));
});

app.post('/commands/:name', async (c) => {
  const name = c.req.param('name');
  if (!Object.hasOwn(COMMANDS, name)) return c.json(notFound, 404);
  const body = await c.req.json().catch(() => null);
  const result: ApiResult<unknown> = await runCommand(c.env.DB, c.get('actor'), name as CommandName, body, c.req.header('Idempotency-Key'));
  return c.json(result, result.ok ? 200 : STATUS[result.error.code] ?? 400);
});

app.all('*', (c) => c.json(notFound, 404));

export default app;
