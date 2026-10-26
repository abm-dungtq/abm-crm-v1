import { ACCESS_ENROLLMENT_STATUSES, resolveAccess, signContentPath, type AccessState } from '@abm/lms-core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings } from './env';
import { signStreamToken } from './stream-token';

interface FactRow {
  program_id: string;
  title: string;
  content_version: number;
  review_days: number | null;
  class_name: string | null;
  enrolled: number;
  last_session_at: string | null;
  manual_json: string;
}

export interface ProgramAccessInfo {
  programId: string;
  title: string;
  className: string | null;
  contentVersion: number;
  access: AccessState;
}

const ENROLLMENT_STATUS_LIST = ACCESS_ENROLLMENT_STATUSES.map((s) => `'${s}'`).join(', ');

export async function loadFacts(
  db: D1Database,
  organizationId: string,
  contactId: string,
  programId?: string,
  nowIso = new Date().toISOString(),
): Promise<ProgramAccessInfo[]> {
  const rows = (
    await db
      .prepare(
        `WITH reachable AS (
           SELECT p.id AS program_id
           FROM lms_program p
           JOIN enrollment e ON e.class_id = p.class_id
           WHERE p.published_at IS NOT NULL AND p.organization_id = ?3 AND e.contact_id = ?1
           UNION
           SELECT a.program_id
           FROM lms_access a
           JOIN lms_program p ON p.id = a.program_id
           WHERE p.published_at IS NOT NULL AND p.organization_id = ?3 AND a.contact_id = ?1 AND a.revoked_at IS NULL
         )
         SELECT
           p.id AS program_id,
           p.title,
           p.content_version,
           p.review_days,
           c.name AS class_name,
           EXISTS (
             SELECT 1 FROM enrollment e
             WHERE e.class_id = p.class_id
               AND e.contact_id = ?1
               AND e.status IN (${ENROLLMENT_STATUS_LIST})
           ) AS enrolled,
           (
             SELECT MAX(cs.starts_at)
             FROM class_session cs
             WHERE cs.class_id = p.class_id AND cs.status <> 'cancelled'
           ) AS last_session_at,
           COALESCE(
             (
               SELECT json_group_array(json_object('mode', a.mode, 'expiresAt', a.expires_at))
               FROM lms_access a
               WHERE a.program_id = p.id AND a.contact_id = ?1 AND a.revoked_at IS NULL
             ),
             '[]'
           ) AS manual_json
         FROM reachable r
         JOIN lms_program p ON p.id = r.program_id
         LEFT JOIN class_group c ON c.id = p.class_id
         WHERE (?2 IS NULL OR p.id = ?2)
         ORDER BY p.created_at DESC, p.id ASC`,
      )
      .bind(contactId, programId ?? null, organizationId)
      .all<FactRow>()
  ).results;

  return rows.map((r) => {
    const manual = JSON.parse(r.manual_json) as { mode: 'grant' | 'block'; expiresAt: string | null }[];
    const access = resolveAccess(
      {
        programId: r.program_id,
        enrolled: Boolean(r.enrolled),
        lastSessionAt: r.last_session_at,
        reviewDays: r.review_days,
        manual,
      },
      nowIso,
    );
    return {
      programId: r.program_id,
      title: r.title,
      className: r.class_name,
      contentVersion: r.content_version,
      access,
    };
  });
}

const notFound = { ok: false as const, error: { code: 'NOT_FOUND', message: 'Không tìm thấy chương trình' } };
const expiredError = {
  ok: false as const,
  error: { code: 'FORBIDDEN', message: 'Đã hết hạn xem lại chương trình này' },
};

export const learningRoutes = new Hono<AppBindings>();

learningRoutes.get('/programs', async (c) => {
  const learner = c.get('learner');
  const db = c.env.DB;
  const facts = await loadFacts(db, learner.organizationId, learner.contactId);
  const visible = facts.filter((f) => f.access.state !== 'none');
  if (visible.length === 0) {
    return c.json({ ok: true, data: [] });
  }

  const lessons = (
    await db
      .prepare(
        `SELECT l.id, l.program_id, l.section_id, l.title, l.position,
                CASE WHEN pr.lesson_id IS NOT NULL THEN 1 ELSE 0 END AS done
         FROM lms_lesson l
         LEFT JOIN lms_progress pr ON pr.lesson_id = l.id AND pr.account_id = ?
         WHERE l.hidden_at IS NULL AND l.program_id IN (SELECT value FROM json_each(?))
         ORDER BY l.position ASC, l.id ASC`,
      )
      .bind(learner.accountId, JSON.stringify(visible.map((f) => f.programId)))
      .all<{ id: string; program_id: string; section_id: string; title: string; position: number; done: number }>()
  ).results;

  const byProgram = new Map<string, { id: string; section_id: string; title: string; done: boolean }[]>();
  for (const l of lessons) {
    const list = byProgram.get(l.program_id) ?? [];
    list.push({ id: l.id, section_id: l.section_id, title: l.title, done: Boolean(l.done) });
    byProgram.set(l.program_id, list);
  }

  const out = visible.map((f) => {
    const progLessons = byProgram.get(f.programId) ?? [];
    const lessonCount = progLessons.length;
    const completedCount = progLessons.filter((l) => l.done).length;
    const next = progLessons.find((l) => !l.done);
    return {
      id: f.programId,
      title: f.title,
      className: f.className,
      state: f.access.state,
      until: f.access.state === 'open' ? f.access.until : null,
      endedAt: f.access.state === 'expired' ? f.access.endedAt : null,
      lessonCount,
      completedCount,
      nextSectionId: next?.section_id ?? null,
      nextLessonTitle: next?.title ?? null,
    };
  });

  return c.json({ ok: true, data: out });
});

learningRoutes.get('/programs/:id', async (c) => {
  const learner = c.get('learner');
  const db = c.env.DB;
  const programId = c.req.param('id');
  const [info] = await loadFacts(db, learner.organizationId, learner.contactId, programId);
  if (!info || info.access.state === 'none') {
    return c.json(notFound, 404);
  }
  if (info.access.state === 'expired') {
    return c.json(expiredError, 403);
  }

  const lessonRows = (
    await db
      .prepare(
        `SELECT l.id, l.section_id, l.title, l.group_title, l.position,
                CASE WHEN pr.lesson_id IS NOT NULL THEN 1 ELSE 0 END AS done
         FROM lms_lesson l
         LEFT JOIN lms_progress pr ON pr.lesson_id = l.id AND pr.account_id = ?1
         WHERE l.program_id = ?2 AND l.hidden_at IS NULL
         ORDER BY l.position ASC, l.id ASC`,
      )
      .bind(learner.accountId, programId)
      .all<{
        id: string;
        section_id: string;
        title: string;
        group_title: string | null;
        position: number;
        done: number;
      }>()
  ).results;

  const videoRows = (
    await db
      .prepare(
        `SELECT v.id, v.lesson_id, v.title
         FROM lms_lesson_video v
         JOIN lms_lesson l ON l.id = v.lesson_id
         WHERE l.program_id = ? AND l.hidden_at IS NULL AND v.deleted_at IS NULL
         ORDER BY v.position ASC, v.id ASC`,
      )
      .bind(programId)
      .all<{ id: string; lesson_id: string; title: string }>()
  ).results;

  const videosByLesson = new Map<string, { id: string; title: string }[]>();
  for (const v of videoRows) {
    const list = videosByLesson.get(v.lesson_id) ?? [];
    list.push({ id: v.id, title: v.title });
    videosByLesson.set(v.lesson_id, list);
  }

  const signedPath = await signContentPath(
    programId,
    info.contentVersion,
    c.env.CONTENT_SIGNING_SECRET ?? '',
    7200,
    Date.now(),
  );

  return c.json({
    ok: true,
    data: {
      program: {
        id: info.programId,
        title: info.title,
        className: info.className,
        until: info.access.until,
      },
      lessons: lessonRows.map((l) => ({
        id: l.id,
        sectionId: l.section_id,
        title: l.title,
        groupTitle: l.group_title,
        position: l.position,
        done: Boolean(l.done),
        videos: videosByLesson.get(l.id) ?? [],
      })),
      contentUrl: `${c.env.LMS_CONTENT_ORIGIN}${signedPath}`,
    },
  });
});

learningRoutes.get('/videos/:id/token', async (c) => {
  const learner = c.get('learner');
  const db = c.env.DB;
  const videoId = c.req.param('id');

  const video = await db
    .prepare(
      `SELECT v.id, v.stream_uid, l.program_id
       FROM lms_lesson_video v
       JOIN lms_lesson l ON l.id = v.lesson_id
       WHERE v.id = ? AND v.deleted_at IS NULL AND l.hidden_at IS NULL`,
    )
    .bind(videoId)
    .first<{ id: string; stream_uid: string; program_id: string }>();

  if (!video) {
    return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy video' } }, 404);
  }

  const [info] = await loadFacts(db, learner.organizationId, learner.contactId, video.program_id);
  if (!info || info.access.state === 'none') {
    return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy video' } }, 404);
  }
  if (info.access.state === 'expired') {
    return c.json(expiredError, 403);
  }

  try {
    const token = await signStreamToken(video.stream_uid, c.env, 7200);
    return c.json({
      ok: true,
      data: {
        iframeUrl: `https://customer-${c.env.STREAM_CUSTOMER_CODE}.cloudflarestream.com/${token}/iframe`,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'STREAM_NOT_CONFIGURED') {
      return c.json({ ok: false, error: { code: 'STREAM_NOT_CONFIGURED', message: 'Video chưa sẵn sàng' } }, 503);
    }
    throw err;
  }
});

const progressSchema = z.object({
  done: z.boolean(),
});

learningRoutes.put('/lessons/:id/progress', async (c) => {
  const parsed = progressSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'Dữ liệu không hợp lệ' } }, 422);
  }
  const learner = c.get('learner');
  const db = c.env.DB;
  const lessonId = c.req.param('id');

  const lesson = await db
    .prepare('SELECT id, program_id FROM lms_lesson WHERE id = ? AND hidden_at IS NULL')
    .bind(lessonId)
    .first<{ id: string; program_id: string }>();

  if (!lesson) {
    return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy phần bài học' } }, 404);
  }

  const [info] = await loadFacts(db, learner.organizationId, learner.contactId, lesson.program_id);
  if (!info || info.access.state === 'none') {
    return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy phần bài học' } }, 404);
  }
  if (info.access.state === 'expired') {
    return c.json(expiredError, 403);
  }

  if (parsed.data.done) {
    await db
      .prepare(
        `INSERT INTO lms_progress (account_id, lesson_id, completed_at)
         VALUES (?, ?, ?)
         ON CONFLICT (account_id, lesson_id) DO NOTHING`,
      )
      .bind(learner.accountId, lessonId, new Date().toISOString())
      .run();
  } else {
    await db
      .prepare('DELETE FROM lms_progress WHERE account_id = ? AND lesson_id = ?')
      .bind(learner.accountId, lessonId)
      .run();
  }

  return c.json({ ok: true, data: { done: parsed.data.done } });
});
