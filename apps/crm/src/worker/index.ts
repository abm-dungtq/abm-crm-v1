import { Hono } from 'hono';
import { COMMANDS, SEARCH_MAX_LENGTH, type ApiResult, type CommandName } from '@abm/contracts';
import { isDemoMode, requireActor } from './actor';
import { adminRoutes } from './admin-routes';
import { notifyCommitted } from './approval-notify';
import { bridgeRoutes } from './inbox/bridge-routes';
import { inboxRoutes } from './inbox/inbox-routes';
import { runScheduled } from './inbox/scheduled';
import { mcpRoutes } from './mcp-routes';
import { canSeeOverview, overviewData } from './overview';
import { publicAuth, sessionAuth } from './auth-routes';
import { originGuard } from './session';
import { runCommand } from './commands';
import { classDetail, listCourses, overdueDeferrals } from './academic-queries';
import { myClasses, sessionAttendance } from './attendance';
import { chargeGuide, contactLedger, listCharges, listUnallocatedPayments, orgBank, searchFeeContacts } from './fees';
import { canReadLearners, learnerDetail, listLearners, listPartners, partnerDetail } from './learner-queries';
import { learnerReports } from './learner-reports';
import { listPrivacyRequests } from './privacy';
import type { AppBindings, Env } from './env';
import {
  accountDetail, adminOverview, canReadAudit, dashboard, leadDetail, listAccounts, listApprovals,
  listAudit, listLeads, leadPage, accountPage, listProducts, listTasks, search, teamMembers, canReadProducts,
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
// The chat agent authenticates with its own Bearer token, so it is mounted before the browser origin and session checks.
app.route('/mcp', mcpRoutes);
// The Zalo bridge sidecar signs each request with HMAC, so it is mounted before the browser origin and session checks.
app.route('/bridge', bridgeRoutes);
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
// Mounted after the keyword length check so inbox search is bounded too.
app.route('/inbox', inboxRoutes);

app.get('/me', (c) => c.json(data({ ...c.get('actor'), mustChangePassword: c.get('mustChangePassword') })));
app.get('/dashboard', async (c) => c.json(data(await dashboard(c.env.DB, c.get('actor')))));
app.get('/leads', async (c) => c.json(data(await (c.req.query('view') === 'page' ? leadPage : listLeads)(c.env.DB, c.get('actor'), {
  status: c.req.query('status') || undefined, stage: c.req.query('stage') || undefined,
  ownerId: c.req.query('owner') || undefined, q: c.req.query('q') || undefined,
  departmentId: c.req.query('department') || undefined,
}))));
app.get('/leads/:id', async (c) => {
  const detail = await leadDetail(c.env.DB, c.get('actor'), c.req.param('id'));
  return detail ? c.json(data(detail)) : c.json(notFound, 404);
});
app.get('/tasks', async (c) => c.json(data(await listTasks(c.env.DB, c.get('actor'), c.req.query('status') === 'completed' ? 'completed' : 'open'))));
app.get('/accounts', async (c) => c.json(data(await (c.req.query('view') === 'page' ? accountPage : listAccounts)(c.env.DB, c.get('actor'), c.req.query('q') || undefined))));
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
app.get('/products', async (c) => {
  const actor = c.get('actor');
  if (!canReadProducts(actor)) return c.json(forbidden, 403);
  return c.json(data(await listProducts(c.env.DB, actor)));
});
app.get('/learners', async (c) => {
  const actor = c.get('actor');
  if (!canReadLearners(actor)) return c.json(forbidden, 403);
  return c.json(data(await listLearners(c.env.DB, actor, {
    view: c.req.query('view') || undefined, q: c.req.query('q') || undefined, ownerId: c.req.query('owner') || undefined,
    stage: c.req.query('stage') || undefined, course: c.req.query('course') || undefined,
  })));
});
app.get('/learners/:contactId', async (c) => {
  const actor = c.get('actor');
  if (!canReadLearners(actor)) return c.json(forbidden, 403);
  const detail = await learnerDetail(c.env.DB, actor, c.req.param('contactId'));
  return detail ? c.json(data(detail)) : c.json(notFound, 404);
});
app.get('/reports/learner', async (c) => {
  const report = await learnerReports(c.env.DB, c.get('actor'));
  if (report === 'forbidden') return c.json(forbidden, 403);
  return c.json(data(report));
});
app.get('/privacy', async (c) => {
  const actor = c.get('actor');
  if (actor.role !== 'admin') return c.json(forbidden, 403);
  return c.json(data(await listPrivacyRequests(c.env.DB, actor)));
});
app.get('/partners', async (c) => {
  const actor = c.get('actor');
  if (!canReadLearners(actor)) return c.json(forbidden, 403);
  return c.json(data(await listPartners(c.env.DB, actor)));
});
app.get('/partners/:id', async (c) => {
  const actor = c.get('actor');
  if (!canReadLearners(actor)) return c.json(forbidden, 403);
  const detail = await partnerDetail(c.env.DB, actor, c.req.param('id'));
  return detail ? c.json(data(detail)) : c.json(notFound, 404);
});
app.get('/courses', async (c) => {
  const courses = await listCourses(c.env.DB, c.get('actor'));
  return courses ? c.json(data(courses)) : c.json(forbidden, 403);
});
app.get('/classes/:id', async (c) => {
  const detail = await classDetail(c.env.DB, c.get('actor'), c.req.param('id'));
  if (detail === 'forbidden') return c.json(forbidden, 403);
  return detail ? c.json(data(detail)) : c.json(notFound, 404);
});
app.get('/my-classes', async (c) => {
  const classes = await myClasses(c.env.DB, c.get('actor'));
  if (classes === 'forbidden') return c.json(forbidden, 403);
  return c.json(data(classes));
});
app.get('/sessions/:id/attendance', async (c) => {
  const attendance = await sessionAttendance(c.env.DB, c.get('actor'), c.req.param('id'));
  if (attendance === 'forbidden') return c.json(forbidden, 403);
  return attendance ? c.json(data(attendance)) : c.json(notFound, 404);
});
app.get('/enrollments/overdue-deferrals', async (c) => {
  const rows = await overdueDeferrals(c.env.DB, c.get('actor'));
  return rows ? c.json(data(rows)) : c.json(forbidden, 403);
});
app.get('/team-members', async (c) => c.json(data(await teamMembers(c.env.DB, c.get('actor').teamId))));
app.get('/search', async (c) => c.json(data(await search(c.env.DB, c.get('actor'), c.req.query('q') ?? ''))));
app.get('/admin/overview', async (c) => {
  const actor = c.get('actor');
  if (actor.role !== 'admin') return c.json(forbidden, 403);
  return c.json(data(await adminOverview(c.env.DB, actor)));
});
app.get('/overview', async (c) => {
  const actor = c.get('actor');
  if (!canSeeOverview(actor)) return c.json(forbidden, 403);
  return c.json(data(await overviewData(c.env.DB, actor, { period: c.req.query('period'), departmentId: c.req.query('department') || undefined })));
});

app.get('/fees/settings', async (c) => {
  const settings = await orgBank(c.env.DB, c.get('actor'));
  if (settings === 'forbidden') return c.json(forbidden, 403);
  return settings ? c.json(data(settings)) : c.json(notFound, 404);
});
app.get('/fees/contacts', async (c) => {
  const rows = await searchFeeContacts(c.env.DB, c.get('actor'), c.req.query('q') || undefined);
  if (rows === 'forbidden') return c.json(forbidden, 403);
  return c.json(data(rows));
});
app.get('/fees/contacts/:contactId', async (c) => {
  const ledger = await contactLedger(c.env.DB, c.get('actor'), c.req.param('contactId'));
  if (ledger === 'forbidden') return c.json(forbidden, 403);
  return ledger ? c.json(data(ledger)) : c.json(notFound, 404);
});
app.get('/fees/charges', async (c) => {
  const rows = await listCharges(c.env.DB, c.get('actor'), {
    status: c.req.query('status') || undefined, q: c.req.query('q') || undefined,
  });
  if (rows === 'forbidden') return c.json(forbidden, 403);
  return c.json(data(rows));
});
app.get('/fees/charges/:id/guide', async (c) => {
  const guide = await chargeGuide(c.env.DB, c.get('actor'), c.req.param('id'));
  if (guide === 'forbidden') return c.json(forbidden, 403);
  return guide ? c.json(data(guide)) : c.json(notFound, 404);
});
app.get('/fees/payments', async (c) => {
  const rows = await listUnallocatedPayments(c.env.DB, c.get('actor'));
  if (rows === 'forbidden') return c.json(forbidden, 403);
  return c.json(data(rows));
});

app.post('/commands/:name', async (c) => {
  const name = c.req.param('name');
  if (!Object.hasOwn(COMMANDS, name)) return c.json(notFound, 404);
  const body = await c.req.json().catch(() => null);
  const result: ApiResult<unknown> = await runCommand(c.env.DB, c.get('actor'), name as CommandName, body, c.req.header('Idempotency-Key'), notifyCommitted(c));
  return c.json(result, result.ok ? 200 : STATUS[result.error.code] ?? 400);
});

app.all('*', (c) => c.json(notFound, 404));

export default {
  fetch: app.fetch,
  scheduled: (event: ScheduledController, env: Env, ctx: ExecutionContext) => ctx.waitUntil(runScheduled(env, event.cron)),
};
