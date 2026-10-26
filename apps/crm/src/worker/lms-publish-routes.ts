import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { loadAgentActor } from './actor';
import { AGENT_WRITES_OPEN, sha256 } from './commands';
import { background, type AppBindings } from './env';
import { GuardedTx, isConstraintFailure, isGuardFailure } from './guarded-tx';
import { attachVideo, publishProgram, publishProgramInput } from './lms-programs';

type Ctx = Context<AppBindings>;

const STATUS: Record<string, 200 | 400 | 401 | 403 | 404 | 409 | 422> = {
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  STALE_VERSION: 409,
  IDEMPOTENCY_CONFLICT: 409,
  DUPLICATE_SUSPECTED: 409,
  VALIDATION_FAILED: 422,
  APPROVAL_REQUIRED: 409,
  KILL_SWITCH_ON: 409,
  UNAUTHENTICATED: 401,
};

const fail = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  ({ ok: false as const, error: { code, message, ...extra } });
const forbidden = fail('FORBIDDEN', 'Chỉ Học vụ hoặc Admin được đăng chương trình');
const stale = fail('STALE_VERSION', 'Dữ liệu vừa thay đổi, tải lại rồi thử lại');
const ok = <T>(data: T) => ({ ok: true as const, data });

async function body<S extends z.ZodType>(c: Ctx, schema: S): Promise<{ data: z.infer<S> } | { error: Response }> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (parsed.success) return { data: parsed.data };
  const fields = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0] ?? 'form'), i.message]));
  return { error: c.json(fail('VALIDATION_FAILED', 'Dữ liệu không hợp lệ', { fields }), 422) };
}

/** Commits and maps the expected failures: a lost race (guard), agent kill switch, and constraint errors. */
async function commit(c: Ctx, tx: GuardedTx, onGuard = stale) {
  try {
    await tx.commit();
    return null;
  } catch (error) {
    if (isGuardFailure(error)) {
      const open = await c.env.DB.prepare(`SELECT (${AGENT_WRITES_OPEN}) AS open`).first<{ open: number }>();
      if (open?.open !== 1) return c.json(fail('KILL_SWITCH_ON', 'Bot đang bị tạm khóa ghi dữ liệu'), 409);
      return c.json(onGuard, 409);
    }
    if (isConstraintFailure(error)) {
      return c.json(fail('DUPLICATE_SUSPECTED', 'Dữ liệu bị trùng'), 409);
    }
    throw error;
  }
}

const publishVideoInput = z.object({
  classId: z.string().min(1).max(64),
  sectionId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, 'sectionId không hợp lệ'),
  title: z.string().trim().min(1, 'Bắt buộc').max(200),
  streamUid: z.string().trim().regex(/^[a-f0-9]{32}$/, 'Stream UID gồm 32 ký tự hex'),
});

export const lmsPublishRoutes = new Hono<AppBindings>();

lmsPublishRoutes.use('*', bodyLimit({ maxSize: 4 * 1024 * 1024 }));
lmsPublishRoutes.use('*', async (c, next) => {
  // The agent is a server client; a browser Origin means someone is trying to reach this from a page.
  if (c.req.header('Origin')) return c.json({ error: 'browser requests are not allowed' }, 403);
  const token = c.req.header('Authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!token) return c.json({ error: 'unauthorized' }, 401);
  const db = c.env.DB;
  // Only script-issued tokens may publish; self-service MCP tokens (read / read_tasks) never reach this API.
  const row = await db.prepare(`SELECT id, user_id FROM agent_token WHERE token_hash = ? AND revoked_at IS NULL
      AND scope = 'legacy' AND (expires_at IS NULL OR expires_at > ?)`)
    .bind(await sha256(token), new Date().toISOString()).first<{ id: string; user_id: string }>();
  const actor = row ? await loadAgentActor(db, row.user_id) : null;
  if (!row || !actor) return c.json({ error: 'unauthorized' }, 401);
  await background(c, db.prepare('UPDATE agent_token SET last_used_at = ? WHERE id = ?').bind(new Date().toISOString(), row.id).run());
  if (actor.role !== 'academic' && actor.role !== 'admin') {
    return c.json(forbidden, 403);
  }
  c.set('actor', actor);
  await next();
});

lmsPublishRoutes.get('/classes', async (c) => {
  const actor = c.get('actor');
  const rows = await c.env.DB.prepare(`SELECT cg.id, cg.name, cg.status, co.name AS course_name, p.id AS program_id, p.content_version
    FROM class_group cg
    JOIN course co ON co.id = cg.course_id
    LEFT JOIN lms_program p ON p.class_id = cg.id
    WHERE co.organization_id = ?
    ORDER BY CASE WHEN cg.status = 'open' THEN 0 ELSE 1 END, co.name, cg.name
    LIMIT 200`)
    .bind(actor.organizationId)
    .all<{
      id: string;
      name: string;
      status: string;
      course_name: string;
      program_id: string | null;
      content_version: number | null;
    }>();

  return c.json(ok(rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    courseName: r.course_name,
    programId: r.program_id,
    contentVersion: r.content_version,
  }))));
});

lmsPublishRoutes.post('/programs', async (c) => {
  const input = await body(c, publishProgramInput);
  if ('error' in input) return input.error;
  const result = await publishProgram(c.env, c.get('actor'), input.data);
  if (!result.ok) {
    return c.json(result, STATUS[result.error.code] ?? 400);
  }
  return c.json(ok(result.data));
});

lmsPublishRoutes.post('/videos', async (c) => {
  const input = await body(c, publishVideoInput);
  if ('error' in input) return input.error;
  const actor = c.get('actor');
  const db = c.env.DB;
  const { classId, sectionId, title, streamUid } = input.data;

  const lesson = await db.prepare(`SELECT l.id
    FROM lms_lesson l
    JOIN lms_program p ON p.id = l.program_id
    WHERE p.class_id = ? AND p.organization_id = ? AND l.section_id = ?`)
    .bind(classId, actor.organizationId, sectionId)
    .first<{ id: string }>();
  if (!lesson) {
    return c.json(fail('NOT_FOUND', 'Không tìm thấy phần bài học'), 404);
  }

  const tx = new GuardedTx(db, actor, 'publishLessonVideo');
  const video = await attachVideo(db, tx, actor, lesson.id, title, streamUid);
  tx.assert(AGENT_WRITES_OPEN, []);
  const failed = await commit(c, tx);
  if (failed) return failed;
  return c.json(ok(video));
});
