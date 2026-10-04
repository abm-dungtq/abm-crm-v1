import { Hono, type Context } from 'hono';
import { foldText, larkLinkInput, normalizeEmail, rosterImportInput, updateUserInput, userStatusInput, versionInput, type RoleCode } from '@abm/contracts';
import type { z } from 'zod';
import type { Actor, AppBindings } from './env';
import { GuardedTx, isConstraintFailure, isGuardFailure } from './guarded-tx';
import { LarkError, lookupOpenIds } from './lark';
import { TEMP_PASSWORD_HOURS, TEMP_PASSWORD_ITERATIONS, generateTempPassword, hashPassword } from './password';
import { parseRosterCsv, placementError, planRoster } from './roster';
import { revokeUserSessions } from './session';

type Ctx = Context<AppBindings>;

const fail = (code: string, message: string, extra: Record<string, unknown> = {}) => ({ ok: false as const, error: { code, message, ...extra } });
const forbidden = fail('FORBIDDEN', 'Chỉ Admin quản lý người dùng');
const notFound = fail('NOT_FOUND', 'Không tìm thấy người dùng');
const stale = fail('STALE_VERSION', 'Dữ liệu vừa thay đổi, tải lại rồi thử lại');
const lastAdmin = fail('STALE_VERSION', 'Phải còn ít nhất một Admin hoạt động');
const ok = <T>(data: T) => ({ ok: true as const, data });

async function body<S extends z.ZodType>(c: Ctx, schema: S): Promise<{ data: z.infer<S> } | { error: Response }> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (parsed.success) return { data: parsed.data };
  const fields = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? 'form'), i.message]));
  return { error: c.json(fail('VALIDATION_FAILED', 'Dữ liệu không hợp lệ', { fields }), 422) };
}

/** Commits and maps the expected failures: a lost race (guard) and a duplicate email (UNIQUE). */
async function commit(c: Ctx, tx: GuardedTx, onGuard = stale) {
  try {
    await tx.commit();
    return null;
  } catch (error) {
    if (isGuardFailure(error)) return c.json(onGuard, 409);
    if (isConstraintFailure(error)) return c.json(fail('VALIDATION_FAILED', 'Email đã dùng cho người khác', { fields: { email: 'Đã dùng' } }), 422);
    throw error;
  }
}

/** Race guard for "at least one active admin"; callers pre-check in JS to give the clear message. */
function assertAdminRemains(tx: GuardedTx, actor: Actor) {
  tx.assert("SELECT COUNT(*) >= 1 FROM app_user WHERE organization_id = ? AND role = 'admin' AND status = 'active'", [actor.organizationId]);
}

async function otherActiveAdmins(db: D1Database, actor: Actor, userId: string) {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM app_user
    WHERE organization_id = ? AND role = 'admin' AND status = 'active' AND id <> ?`).bind(actor.organizationId, userId).first<{ n: number }>();
  return row!.n;
}

/** A fresh temporary password and the columns that put it in force. The plaintext leaves only in the response. */
async function tempPassword(now: string) {
  const password = generateTempPassword();
  const stored = await hashPassword(password, TEMP_PASSWORD_ITERATIONS);
  const expiresAt = new Date(Date.parse(now) + TEMP_PASSWORD_HOURS * 3_600_000).toISOString();
  return {
    password, expiresAt,
    columns: {
      password_hash: stored.hash, password_salt: stored.salt, password_iterations: stored.iterations,
      must_change_password: 1, temp_password_expires_at: expiresAt, failed_login_count: 0, locked_until: null,
    },
  };
}

interface UserRow {
  id: string; email: string; display_name: string; role: RoleCode; status: 'active' | 'disabled';
  department_id: string | null; team_id: string | null; version: number;
  department_name: string | null; team_name: string | null;
}
const loadUser = (db: D1Database, actor: Actor, id: string) => db.prepare(`SELECT u.id, u.email, u.display_name, u.role, u.status,
    u.department_id, u.team_id, u.version, d.name AS department_name, t.name AS team_name
  FROM app_user u LEFT JOIN department d ON d.id = u.department_id LEFT JOIN team t ON t.id = u.team_id
  WHERE u.id = ? AND u.organization_id = ?`).bind(id, actor.organizationId).first<UserRow>();

const snapshot = (u: { display_name: string; email: string; role: RoleCode; department_id: string | null; team_id: string | null }) =>
  ({ name: u.display_name, email: u.email, role: u.role, departmentId: u.department_id, teamId: u.team_id });

export const adminRoutes = new Hono<AppBindings>();

adminRoutes.use('*', async (c, next) => {
  if (c.get('actor').role !== 'admin') return c.json(forbidden, 403);
  await next();
});

adminRoutes.post('/roster/preview', async (c) => {
  const input = await body(c, rosterImportInput);
  if ('error' in input) return input.error;
  const { rows, errors } = parseRosterCsv(input.data.csv);
  const plan = await planRoster(c.env.DB, c.get('actor'), rows, errors);
  return c.json(ok({
    users: plan.users.map(({ previous: _p, version: _v, departmentKey: _d, teamKey: _t, ...u }) => u),
    errors: plan.errors, counts: plan.counts,
    newDepartments: plan.newDepartments.map((d) => d.name),
    newTeams: plan.newTeams.map((t) => ({ departmentName: t.departmentName, name: t.name })),
  }));
});

adminRoutes.post('/roster/commit', async (c) => {
  const input = await body(c, rosterImportInput);
  if ('error' in input) return input.error;
  const actor = c.get('actor');
  const db = c.env.DB;
  const { rows, errors } = parseRosterCsv(input.data.csv);
  const plan = await planRoster(db, actor, rows, errors);
  if (plan.errors.length) return c.json(fail('VALIDATION_FAILED', 'File còn lỗi, sửa rồi nhập lại', { details: { errors: plan.errors } }), 422);
  const changed = plan.users.filter((u) => u.action !== 'unchanged');
  if (!changed.length && !plan.newDepartments.length && !plan.newTeams.length) {
    return c.json(ok({ counts: plan.counts, tempPasswords: [] }));
  }
  // The importing admin cannot change their own role (planRoster), so an active admin always remains;
  // assertAdminRemains still guards the batch against concurrent changes.
  const tx = new GuardedTx(db, actor, 'importRoster');
  const departmentIds = { ...plan.departmentIds };
  const teamIds = { ...plan.teamIds };
  for (const d of plan.newDepartments) {
    const id = `dep-${crypto.randomUUID()}`;
    tx.insertVersioned('department', { id, organization_id: actor.organizationId, name: d.name });
    departmentIds[d.key] = id;
  }
  for (const t of plan.newTeams) {
    const id = `team-${crypto.randomUUID()}`;
    tx.insertVersioned('team', { id, department_id: departmentIds[t.departmentKey], name: t.name });
    teamIds[t.key] = id;
  }
  const tempPasswords: { userId: string; name: string; email: string; password: string; expiresAt: string }[] = [];
  const issue = input.data.issueTempPasswords ?? true;
  const userIds = new Map<string, string>();
  for (const u of changed) {
    const placement = {
      display_name: u.name, role: u.role,
      department_id: u.departmentKey ? departmentIds[u.departmentKey]! : null,
      team_id: u.teamKey ? teamIds[u.teamKey]! : null,
    };
    if (u.action === 'create') {
      const id = `u-${crypto.randomUUID()}`;
      userIds.set(u.email, id);
      const temp = issue ? await tempPassword(tx.now) : null;
      tx.insertVersioned('app_user', { id, organization_id: actor.organizationId, email: u.email, status: 'active', ...placement, ...temp?.columns });
      if (temp) tempPasswords.push({ userId: id, name: u.name, email: u.email, password: temp.password, expiresAt: temp.expiresAt });
    } else {
      tx.update('app_user', u.userId!, u.version!, placement);
    }
  }
  for (const d of plan.newDepartments) tx.audit('department', departmentIds[d.key]!, null, { name: d.name });
  for (const t of plan.newTeams) tx.audit('team', teamIds[t.key]!, null, { name: t.name, departmentId: departmentIds[t.departmentKey] });
  for (const u of changed) {
    const after = { name: u.name, email: u.email, role: u.role, departmentId: u.departmentKey ? departmentIds[u.departmentKey] : null, teamId: u.teamKey ? teamIds[u.teamKey] : null };
    tx.audit('app_user', u.userId ?? userIds.get(u.email)!, u.previous ? { ...u.previous, email: u.email } : null, after);
  }
  assertAdminRemains(tx, actor);
  const failed = await commit(c, tx);
  if (failed) return failed;
  c.header('Cache-Control', 'no-store');
  return c.json(ok({ counts: plan.counts, tempPasswords }));
});

adminRoutes.patch('/users/:id', async (c) => {
  const input = await body(c, updateUserInput);
  if ('error' in input) return input.error;
  const actor = c.get('actor');
  const db = c.env.DB;
  const user = await loadUser(db, actor, c.req.param('id'));
  if (!user) return c.json(notFound, 404);
  const v = input.data;
  const role = v.role ?? user.role;
  if (user.id === actor.id && role !== user.role) return c.json(fail('VALIDATION_FAILED', 'Không tự đổi vai trò của mình'), 422);
  const departmentName = v.departmentName === undefined ? user.department_name : v.departmentName || null;
  const teamName = v.teamName === undefined ? user.team_name : v.teamName || null;
  const placement = placementError(role, departmentName, teamName);
  if (placement) return c.json(fail('VALIDATION_FAILED', placement), 422);

  let departmentId: string | null = null;
  let teamId: string | null = null;
  if (departmentName) {
    const d = (await db.prepare('SELECT id, name FROM department WHERE organization_id = ?').bind(actor.organizationId).all<{ id: string; name: string }>())
      .results.find((r) => foldText(r.name) === foldText(departmentName));
    if (!d) return c.json(fail('VALIDATION_FAILED', `Chưa có phòng ban "${departmentName}". Thêm bằng file danh sách.`), 422);
    departmentId = d.id;
    if (teamName) {
      const t = (await db.prepare('SELECT id, name FROM team WHERE department_id = ?').bind(d.id).all<{ id: string; name: string }>())
        .results.find((r) => foldText(r.name) === foldText(teamName));
      if (!t) return c.json(fail('VALIDATION_FAILED', `Chưa có nhóm "${teamName}" trong ${d.name}. Thêm bằng file danh sách.`), 422);
      teamId = t.id;
    }
  }
  if (user.role === 'admin' && role !== 'admin' && user.status === 'active' && (await otherActiveAdmins(db, actor, user.id)) === 0) {
    return c.json(lastAdmin, 409);
  }
  const email = v.email ? normalizeEmail(v.email) : user.email;
  const set: Record<string, unknown> = { display_name: v.name ?? user.display_name, email, role, department_id: departmentId, team_id: teamId };
  // A new email may belong to a different Lark account; the old link must not carry over.
  if (email !== user.email) Object.assign(set, { lark_open_id: null, lark_link_status: 'unlinked', lark_checked_at: null });
  const tx = new GuardedTx(db, actor, 'updateUser');
  tx.update('app_user', user.id, v.version, set);
  tx.audit('app_user', user.id, snapshot(user), snapshot({ display_name: set.display_name as string, email, role, department_id: departmentId, team_id: teamId }));
  assertAdminRemains(tx, actor);
  const failed = await commit(c, tx);
  return failed ?? c.json(ok(null));
});

adminRoutes.post('/users/:id/status', async (c) => {
  const input = await body(c, userStatusInput);
  if ('error' in input) return input.error;
  const actor = c.get('actor');
  const db = c.env.DB;
  const user = await loadUser(db, actor, c.req.param('id'));
  if (!user) return c.json(notFound, 404);
  const { status, version } = input.data;
  if (user.id === actor.id && status === 'disabled') return c.json(fail('VALIDATION_FAILED', 'Không tự khóa tài khoản của mình'), 422);
  if (status === 'disabled' && user.role === 'admin' && user.status === 'active' && (await otherActiveAdmins(db, actor, user.id)) === 0) {
    return c.json(lastAdmin, 409);
  }
  const tx = new GuardedTx(db, actor, status === 'disabled' ? 'disableUser' : 'enableUser');
  tx.update('app_user', user.id, version, { status });
  if (status === 'disabled') tx.raw(revokeUserSessions(db, user.id, tx.now));
  tx.audit('app_user', user.id, { status: user.status }, { status });
  assertAdminRemains(tx, actor);
  const failed = await commit(c, tx, status === 'disabled' && user.role === 'admin' ? lastAdmin : stale);
  return failed ?? c.json(ok(null));
});

adminRoutes.post('/lark/link', async (c) => {
  const input = await body(c, larkLinkInput);
  if ('error' in input) return input.error;
  const actor = c.get('actor');
  const db = c.env.DB;
  const ids = input.data.userIds;
  const candidates = (await db.prepare(`SELECT id, email, version, lark_open_id, lark_link_status FROM app_user
    WHERE organization_id = ? AND status = 'active'
      AND ${ids?.length ? `id IN (${ids.map(() => '?').join(',')})` : "lark_link_status IN ('unlinked','unmatched','error')"}`)
    .bind(actor.organizationId, ...(ids ?? [])).all<{ id: string; email: string; version: number; lark_open_id: string | null; lark_link_status: string }>()).results;
  if (!candidates.length) return c.json(ok({ linked: 0, unmatched: 0, error: 0 }));

  let found: Map<string, string | null> | null = null;
  let message: string | undefined;
  try {
    found = await lookupOpenIds(c.env, candidates.map((u) => u.email));
  } catch (error) {
    if (!(error instanceof LarkError)) throw error;
    message = error.message;
  }
  const taken = new Map((await db.prepare(`SELECT id, lark_open_id FROM app_user WHERE organization_id = ? AND lark_open_id IS NOT NULL`)
    .bind(actor.organizationId).all<{ id: string; lark_open_id: string }>()).results.map((r) => [r.lark_open_id, r.id]));

  const counts = { linked: 0, unmatched: 0, error: 0 };
  const tx = new GuardedTx(db, actor, 'linkLark');
  for (const u of candidates) {
    let openId: string | null = null;
    let status: 'linked' | 'unmatched' | 'error' = 'error';
    if (!found) {
      // A failed lookup keeps an earlier link, so a Lark outage cannot undo a working one.
      counts.error++;
      if (u.lark_open_id) continue;
    } else {
      const id = found.get(u.email.toLowerCase()) ?? null;
      const owner = id ? taken.get(id) : undefined;
      if (!id) status = 'unmatched';
      else if (owner && owner !== u.id) message ??= 'open_id đã gắn cho người khác';
      else { status = 'linked'; openId = id; taken.set(id, u.id); }
      counts[status]++;
    }
    tx.update('app_user', u.id, u.version, { lark_open_id: openId, lark_link_status: status, lark_checked_at: tx.now });
    tx.audit('app_user', u.id, { larkStatus: u.lark_link_status, larkOpenId: u.lark_open_id }, { larkStatus: status, larkOpenId: openId });
  }
  const failed = await commit(c, tx);
  return failed ?? c.json(ok({ ...counts, ...(message ? { message } : {}) }));
});

adminRoutes.post('/users/:id/temp-password', async (c) => {
  const input = await body(c, versionInput);
  if ('error' in input) return input.error;
  const actor = c.get('actor');
  const db = c.env.DB;
  const user = await loadUser(db, actor, c.req.param('id'));
  if (!user) return c.json(notFound, 404);
  const tx = new GuardedTx(db, actor, 'issueTempPassword');
  const temp = await tempPassword(tx.now);
  tx.update('app_user', user.id, input.data.version, temp.columns);
  tx.raw(revokeUserSessions(db, user.id, tx.now));
  tx.audit('app_user', user.id, null, { expiresAt: temp.expiresAt });
  const failed = await commit(c, tx);
  if (failed) return failed;
  c.header('Cache-Control', 'no-store');
  return c.json(ok({ password: temp.password, expiresAt: temp.expiresAt }));
});
