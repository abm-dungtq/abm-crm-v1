import {
  type AddLessonVideoInput,
  type ApiResult,
  type CloneLmsProgramInput,
  type DeleteLessonVideoInput,
  type UpdateLessonVideoInput,
  type UpdateLmsProgramInput,
} from '@abm/contracts';
import { ACCESS_ENROLLMENT_STATUSES, signContentPath } from '@abm/lms-core';
import { z } from 'zod';
import { canTeach } from './attendance';
import { fail, ok, type Ctx } from './command-result';
import { AGENT_WRITES_OPEN } from './commands';
import type { Actor, Env } from './env';
import { GuardedTx, isConstraintFailure, isGuardFailure } from './guarded-tx';
import { LMS_STAFF } from './lms-accounts';
import { streamCopyFromUrl } from './stream';

const ACCESS_STATUS_SQL = ACCESS_ENROLLMENT_STATUSES.map((s) => `'${s}'`).join(', ');

const id = z.string().min(1).max(64);
const text = (max: number) => z.string().trim().min(1, 'Bắt buộc').max(max);

export const publishProgramInput = z.object({
  classId: id,
  title: text(200),
  html: z.string().min(1, 'Bắt buộc').max(3_000_000),
  lessons: z.array(z.object({
    sectionId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, 'sectionId không hợp lệ'),
    title: text(200),
    groupTitle: z.string().trim().max(200).nullish(),
    position: z.number().int().min(0).max(999),
  })).min(1).max(300).refine(
    (items) => new Set(items.map((i) => i.sectionId)).size === items.length,
    { message: 'Trùng sectionId trong danh sách bài học' },
  ),
});
export type PublishProgramInput = z.infer<typeof publishProgramInput>;

export interface PublishProgramResult {
  programId: string;
  contentVersion: number;
  lessons: number;
  hidden: number;
}

export async function publishProgram(
  env: Env,
  actor: Actor,
  input: PublishProgramInput,
): Promise<ApiResult<PublishProgramResult>> {
  if (actor.role !== 'academic' && actor.role !== 'admin') {
    return fail('FORBIDDEN', 'Chỉ Học vụ hoặc Admin được đăng chương trình');
  }
  if (!env?.LMS_CONTENT) {
    return fail('VALIDATION_FAILED', 'Chưa cấu hình kho nội dung LMS');
  }

  const db = env.DB;
  const klass = await db.prepare(`SELECT cg.id FROM class_group cg JOIN course co ON co.id = cg.course_id
    WHERE cg.id = ? AND co.organization_id = ?`)
    .bind(input.classId, actor.organizationId)
    .first<{ id: string }>();
  if (!klass) return fail('NOT_FOUND', 'Không tìm thấy lớp');

  const existing = await db.prepare(`SELECT id, organization_id, class_id, title, content_key, content_version, version
    FROM lms_program WHERE class_id = ?`)
    .bind(input.classId)
    .first<{
      id: string;
      organization_id: string;
      class_id: string;
      title: string;
      content_key: string | null;
      content_version: number;
      version: number;
    }>();

  const programId = existing?.id ?? crypto.randomUUID();
  const nextVersion = (existing?.content_version ?? 0) + 1;
  const key = `programs/${programId}/v${nextVersion}.html`;

  await env.LMS_CONTENT.put(key, input.html, {
    httpMetadata: { contentType: 'text/html; charset=utf-8' },
  });

  const existingLessons = existing
    ? (await db.prepare('SELECT id, section_id, hidden_at, version FROM lms_lesson WHERE program_id = ?')
      .bind(programId)
      .all<{ id: string; section_id: string; hidden_at: string | null; version: number }>()).results
    : [];
  const lessonBySection = new Map(existingLessons.map((l) => [l.section_id, l]));

  const tx = new GuardedTx(db, actor, 'publishProgram');
  if (!existing) {
    tx.insertVersioned('lms_program', {
      id: programId,
      organization_id: actor.organizationId,
      class_id: input.classId,
      title: input.title,
      content_key: key,
      content_version: 1,
      published_at: tx.now,
    });
  } else {
    tx.update('lms_program', existing.id, existing.version, {
      title: input.title,
      content_key: key,
      content_version: nextVersion,
      published_at: tx.now,
    });
  }

  const inputSectionIds = new Set<string>();
  for (const lesson of input.lessons) {
    inputSectionIds.add(lesson.sectionId);
    const groupTitle = lesson.groupTitle?.trim() || null;
    const prev = lessonBySection.get(lesson.sectionId);
    if (prev) {
      tx.update('lms_lesson', prev.id, prev.version, {
        title: lesson.title,
        group_title: groupTitle,
        position: lesson.position,
        hidden_at: null,
      });
    } else {
      tx.insertVersioned('lms_lesson', {
        id: crypto.randomUUID(),
        program_id: programId,
        section_id: lesson.sectionId,
        title: lesson.title,
        group_title: groupTitle,
        position: lesson.position,
      });
    }
  }

  let hiddenCount = 0;
  for (const prev of existingLessons) {
    if (!inputSectionIds.has(prev.section_id) && prev.hidden_at === null) {
      tx.update('lms_lesson', prev.id, prev.version, { hidden_at: tx.now });
      hiddenCount++;
    }
  }

  tx.audit(
    'lms_program',
    programId,
    existing ? { title: existing.title, contentVersion: existing.content_version } : null,
    { contentVersion: nextVersion, lessons: input.lessons.length },
  );
  tx.assert(AGENT_WRITES_OPEN, []);

  try {
    await tx.commit();
  } catch (error) {
    if (isGuardFailure(error)) {
      const open = await db.prepare(`SELECT (${AGENT_WRITES_OPEN}) AS open`).first<{ open: number }>();
      if (open?.open !== 1) return fail('KILL_SWITCH_ON', 'Bot đang bị tạm khóa ghi dữ liệu');
      return fail('STALE_VERSION', 'Dữ liệu vừa thay đổi, tải lại rồi thử lại');
    }
    if (isConstraintFailure(error)) {
      return fail('DUPLICATE_SUSPECTED', 'Chương trình hoặc phần bài học bị trùng');
    }
    throw error;
  }

  return ok({
    programId,
    contentVersion: nextVersion,
    lessons: input.lessons.length,
    hidden: hiddenCount,
  });
}

export async function attachVideo(
  db: D1Database,
  tx: GuardedTx,
  actor: Actor,
  lessonId: string,
  title: string,
  streamUid: string,
) {
  const posRow = await db.prepare(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM lms_lesson_video WHERE lesson_id = ? AND deleted_at IS NULL',
  )
    .bind(lessonId)
    .first<{ next_pos: number }>();
  const position = posRow?.next_pos ?? 0;
  const id = crypto.randomUUID();
  tx.insertVersioned('lms_lesson_video', {
    id,
    lesson_id: lessonId,
    title,
    stream_uid: streamUid,
    position,
    created_by_user_id: actor.id,
  });
  tx.audit('lms_lesson_video', id, null, {
    lessonId,
    title,
    streamUid,
    position,
  });
  return { id, version: 1, position, streamUid };
}

async function addLessonVideo({ db, actor, input, tx, env }: Ctx<AddLessonVideoInput>) {
  const row = await db.prepare(`SELECT l.id AS lesson_id, p.class_id
    FROM lms_lesson l
    JOIN lms_program p ON p.id = l.program_id
    WHERE l.id = ? AND p.organization_id = ?`)
    .bind(input.lessonId, actor.organizationId)
    .first<{ lesson_id: string; class_id: string | null }>();
  if (!row || !row.class_id) return fail('NOT_FOUND', 'Không tìm thấy phần bài học');

  if (!(await canTeach(db, actor, row.class_id))) {
    return fail('FORBIDDEN', 'Chỉ giáo viên của lớp được sửa video');
  }

  let streamUid = input.streamUid;
  if (input.sourceUrl) {
    if (!env) return fail('VALIDATION_FAILED', 'Chưa cấu hình Cloudflare Stream');
    try {
      const copied = await streamCopyFromUrl(env, input.sourceUrl, input.title);
      streamUid = copied.uid;
    } catch (error) {
      if (error instanceof Error && error.message === 'STREAM_NOT_CONFIGURED') {
        return fail('VALIDATION_FAILED', 'Chưa cấu hình Cloudflare Stream');
      }
      if (error instanceof Error && error.message === 'STREAM_COPY_FAILED') {
        return fail('VALIDATION_FAILED', 'Stream không tải được video từ link này');
      }
      throw error;
    }
  }

  const video = await attachVideo(db, tx, actor, row.lesson_id, input.title, streamUid!);
  return ok(video);
}

async function updateLessonVideo({ db, actor, input, tx }: Ctx<UpdateLessonVideoInput>) {
  const row = await db.prepare(`SELECT v.id, v.version, v.title, v.position, p.class_id
    FROM lms_lesson_video v
    JOIN lms_lesson l ON l.id = v.lesson_id
    JOIN lms_program p ON p.id = l.program_id
    WHERE v.id = ? AND p.organization_id = ? AND v.deleted_at IS NULL`)
    .bind(input.videoId, actor.organizationId)
    .first<{ id: string; version: number; title: string; position: number; class_id: string | null }>();
  if (!row || !row.class_id) return fail('NOT_FOUND', 'Không tìm thấy video');

  if (!(await canTeach(db, actor, row.class_id))) {
    return fail('FORBIDDEN', 'Chỉ giáo viên của lớp được sửa video');
  }
  if (row.version !== input.version) {
    return fail('STALE_VERSION', 'Video vừa được người khác cập nhật. Tải lại rồi thử lại.');
  }

  const nextTitle = input.title ?? row.title;
  const nextPosition = input.position ?? row.position;
  tx.update('lms_lesson_video', row.id, input.version, {
    title: nextTitle,
    position: nextPosition,
  });
  tx.audit(
    'lms_lesson_video',
    row.id,
    { title: row.title, position: row.position },
    { title: nextTitle, position: nextPosition },
  );
  return ok({ id: row.id, version: input.version + 1 });
}

async function deleteLessonVideo({ db, actor, input, tx }: Ctx<DeleteLessonVideoInput>) {
  const row = await db.prepare(`SELECT v.id, v.version, p.class_id
    FROM lms_lesson_video v
    JOIN lms_lesson l ON l.id = v.lesson_id
    JOIN lms_program p ON p.id = l.program_id
    WHERE v.id = ? AND p.organization_id = ? AND v.deleted_at IS NULL`)
    .bind(input.videoId, actor.organizationId)
    .first<{ id: string; version: number; class_id: string | null }>();
  if (!row || !row.class_id) return fail('NOT_FOUND', 'Không tìm thấy video');

  if (!(await canTeach(db, actor, row.class_id))) {
    return fail('FORBIDDEN', 'Chỉ giáo viên của lớp được sửa video');
  }
  if (row.version !== input.version) {
    return fail('STALE_VERSION', 'Video vừa được người khác cập nhật. Tải lại rồi thử lại.');
  }

  tx.update('lms_lesson_video', row.id, input.version, { deleted_at: tx.now });
  tx.audit('lms_lesson_video', row.id, { deleted_at: null }, { deleted_at: tx.now });
  return ok({ id: row.id, version: input.version + 1 });
}

async function updateLmsProgram({ db, actor, input, tx }: Ctx<UpdateLmsProgramInput>) {
  const row = await db.prepare('SELECT id, version, title, review_days FROM lms_program WHERE id = ? AND organization_id = ?')
    .bind(input.programId, actor.organizationId)
    .first<{ id: string; version: number; title: string; review_days: number | null }>();
  if (!row) return fail('NOT_FOUND', 'Không tìm thấy chương trình học');
  if (row.version !== input.version) {
    return fail('STALE_VERSION', 'Chương trình vừa được người khác cập nhật. Tải lại rồi thử lại.');
  }

  const nextTitle = input.title ?? row.title;
  const nextReviewDays = input.reviewDays;
  tx.update('lms_program', row.id, input.version, {
    title: nextTitle,
    review_days: nextReviewDays,
  });
  tx.audit(
    'lms_program',
    row.id,
    { title: row.title, reviewDays: row.review_days },
    { title: nextTitle, reviewDays: nextReviewDays },
  );
  return ok({ id: row.id, version: input.version + 1 });
}

async function cloneLmsProgram({ db, actor, input, tx, env }: Ctx<CloneLmsProgramInput>) {
  const [fromClass, toClass] = await Promise.all([
    db.prepare('SELECT cg.id FROM class_group cg JOIN course co ON co.id = cg.course_id WHERE cg.id = ? AND co.organization_id = ?')
      .bind(input.fromClassId, actor.organizationId)
      .first<{ id: string }>(),
    db.prepare('SELECT cg.id FROM class_group cg JOIN course co ON co.id = cg.course_id WHERE cg.id = ? AND co.organization_id = ?')
      .bind(input.toClassId, actor.organizationId)
      .first<{ id: string }>(),
  ]);
  if (!fromClass || !toClass) return fail('NOT_FOUND', 'Không tìm thấy lớp');

  const [source, targetExisting] = await Promise.all([
    db.prepare('SELECT id, title, content_key, content_version, review_days FROM lms_program WHERE class_id = ? AND organization_id = ?')
      .bind(input.fromClassId, actor.organizationId)
      .first<{
        id: string;
        title: string;
        content_key: string | null;
        content_version: number;
        review_days: number | null;
      }>(),
    db.prepare('SELECT id FROM lms_program WHERE class_id = ?')
      .bind(input.toClassId)
      .first<{ id: string }>(),
  ]);

  if (!source || !source.content_key) {
    return fail('VALIDATION_FAILED', 'Lớp nguồn chưa có chương trình');
  }
  if (targetExisting) {
    return fail('DUPLICATE_SUSPECTED', 'Lớp đích đã có chương trình');
  }
  if (!env?.LMS_CONTENT) {
    return fail('VALIDATION_FAILED', 'Chưa cấu hình kho nội dung LMS');
  }

  const obj = await env.LMS_CONTENT.get(source.content_key);
  if (!obj) {
    return fail('NOT_FOUND', 'Không tìm thấy nội dung chương trình gốc');
  }

  const newId = crypto.randomUUID();
  const newKey = `programs/${newId}/v${source.content_version}.html`;
  await env.LMS_CONTENT.put(newKey, obj.body, { httpMetadata: obj.httpMetadata });

  const lessons = await db.prepare(`SELECT section_id, title, group_title, position
    FROM lms_lesson
    WHERE program_id = ? AND hidden_at IS NULL
    ORDER BY position, id`)
    .bind(source.id)
    .all<{ section_id: string; title: string; group_title: string | null; position: number }>();

  tx.insertVersioned('lms_program', {
    id: newId,
    organization_id: actor.organizationId,
    class_id: input.toClassId,
    title: source.title,
    content_key: newKey,
    content_version: source.content_version,
    review_days: source.review_days,
    cloned_from_program_id: source.id,
    published_at: tx.now,
  });

  for (const lesson of lessons.results) {
    tx.insertVersioned('lms_lesson', {
      id: crypto.randomUUID(),
      program_id: newId,
      section_id: lesson.section_id,
      title: lesson.title,
      group_title: lesson.group_title,
      position: lesson.position,
    });
  }

  tx.audit('lms_program', newId, null, {
    fromProgramId: source.id,
    fromClassId: input.fromClassId,
    toClassId: input.toClassId,
    lessons: lessons.results.length,
  });

  return ok({
    id: newId,
    version: 1,
    contentKey: newKey,
    lessons: lessons.results.length,
  });
}

export const lmsProgramHandlers = {
  addLessonVideo,
  updateLessonVideo,
  deleteLessonVideo,
  updateLmsProgram,
  cloneLmsProgram,
};

export async function classProgram(db: D1Database, _env: Env, actor: Actor, classId: string) {
  if (!LMS_STAFF.includes(actor.role) && !(await canTeach(db, actor, classId))) {
    return 'forbidden' as const;
  }

  const klass = await db.prepare(`SELECT cg.id FROM class_group cg JOIN course co ON co.id = cg.course_id
    WHERE cg.id = ? AND co.organization_id = ?`)
    .bind(classId, actor.organizationId)
    .first<{ id: string }>();
  if (!klass) return null;

  const program = await db.prepare(`SELECT id, version, title, content_version, published_at, review_days, cloned_from_program_id
    FROM lms_program
    WHERE class_id = ? AND organization_id = ?`)
    .bind(classId, actor.organizationId)
    .first<{
      id: string;
      version: number;
      title: string;
      content_version: number;
      published_at: string | null;
      review_days: number | null;
      cloned_from_program_id: string | null;
    }>();

  if (!program) return { program: null };

  const [lessonRows, videoRows, enrolledRows, orgRow] = await Promise.all([
    db.prepare(`SELECT id, version, section_id, title, group_title, position, hidden_at
      FROM lms_lesson
      WHERE program_id = ?
      ORDER BY CASE WHEN hidden_at IS NULL THEN 0 ELSE 1 END, position, id`)
      .bind(program.id)
      .all<{
        id: string;
        version: number;
        section_id: string;
        title: string;
        group_title: string | null;
        position: number;
        hidden_at: string | null;
      }>(),
    db.prepare(`SELECT v.id, v.lesson_id, v.version, v.title, v.stream_uid, v.position
      FROM lms_lesson_video v
      JOIN lms_lesson l ON l.id = v.lesson_id
      WHERE l.program_id = ? AND v.deleted_at IS NULL
      ORDER BY v.position, v.created_at, v.id`)
      .bind(program.id)
      .all<{
        id: string;
        lesson_id: string;
        version: number;
        title: string;
        stream_uid: string;
        position: number;
      }>(),
    db.prepare(`SELECT c.id AS contact_id, c.display_name, la.id AS account_id,
        (SELECT cp.normalized_value FROM contact_point cp WHERE cp.contact_id = c.id AND cp.type = 'email' ORDER BY cp.created_at LIMIT 1) AS email
      FROM enrollment e
      JOIN contact c ON c.id = e.contact_id
      LEFT JOIN learner_account la ON la.contact_id = c.id
      WHERE e.class_id = ? AND e.organization_id = ? AND e.status IN (${ACCESS_STATUS_SQL}) AND c.archived_at IS NULL
      ORDER BY c.display_name, e.created_at, e.id`)
      .bind(classId, actor.organizationId)
      .all<{
        contact_id: string;
        display_name: string;
        account_id: string | null;
        email: string | null;
      }>(),
    db.prepare('SELECT learner_default_password_hash FROM org_setting WHERE organization_id = ?')
      .bind(actor.organizationId)
      .first<{ learner_default_password_hash: string | null }>(),
  ]);

  const videosByLesson = new Map<string, { id: string; version: number; title: string; streamUid: string; position: number }[]>();
  for (const v of videoRows.results) {
    const list = videosByLesson.get(v.lesson_id) ?? [];
    list.push({
      id: v.id,
      version: v.version,
      title: v.title,
      streamUid: v.stream_uid,
      position: v.position,
    });
    videosByLesson.set(v.lesson_id, list);
  }

  let enrolled = 0;
  let withAccount = 0;
  let withoutEmail = 0;
  const learnersWithoutAccount: { contactId: string; displayName: string; email: string | null }[] = [];
  const seenContacts = new Set<string>();

  for (const r of enrolledRows.results) {
    if (seenContacts.has(r.contact_id)) continue;
    seenContacts.add(r.contact_id);
    enrolled++;
    if (r.account_id) {
      withAccount++;
    } else {
      if (!r.email) withoutEmail++;
      if (learnersWithoutAccount.length < 200) {
        learnersWithoutAccount.push({
          contactId: r.contact_id,
          displayName: r.display_name,
          email: r.email ?? null,
        });
      }
    }
  }

  return {
    program: {
      id: program.id,
      version: program.version,
      title: program.title,
      contentVersion: program.content_version,
      publishedAt: program.published_at,
      reviewDays: program.review_days,
      clonedFromProgramId: program.cloned_from_program_id,
    },
    lessons: lessonRows.results.map((l) => ({
      id: l.id,
      version: l.version,
      sectionId: l.section_id,
      title: l.title,
      groupTitle: l.group_title,
      position: l.position,
      hidden: l.hidden_at !== null,
      videos: videosByLesson.get(l.id) ?? [],
    })),
    counts: {
      enrolled,
      withAccount,
      withoutEmail,
    },
    learnersWithoutAccount,
    hasDefaultPassword: Boolean(orgRow?.learner_default_password_hash),
  };
}

export async function listPrograms(db: D1Database, actor: Actor) {
  const rows = await db.prepare(`SELECT p.id AS program_id, p.class_id, cg.name AS class_name, co.name AS course_name, p.title,
      (SELECT COUNT(*) FROM lms_lesson l WHERE l.program_id = p.id AND l.hidden_at IS NULL) AS lesson_count
    FROM lms_program p
    LEFT JOIN class_group cg ON cg.id = p.class_id
    LEFT JOIN course co ON co.id = cg.course_id
    WHERE p.organization_id = ?
    ORDER BY co.name, cg.name, p.title`)
    .bind(actor.organizationId)
    .all<{
      program_id: string;
      class_id: string | null;
      class_name: string | null;
      course_name: string | null;
      title: string;
      lesson_count: number;
    }>();

  return rows.results.map((r) => ({
    programId: r.program_id,
    classId: r.class_id,
    className: r.class_name,
    courseName: r.course_name,
    title: r.title,
    lessonCount: r.lesson_count,
  }));
}

export async function previewUrl(env: Env, actor: Actor, classId: string) {
  if (!LMS_STAFF.includes(actor.role) && !(await canTeach(env.DB, actor, classId))) {
    return 'forbidden' as const;
  }

  const row = await env.DB.prepare(`SELECT p.id, p.content_version, p.content_key
    FROM class_group cg
    JOIN course co ON co.id = cg.course_id
    LEFT JOIN lms_program p ON p.class_id = cg.id
    WHERE cg.id = ? AND co.organization_id = ?`)
    .bind(classId, actor.organizationId)
    .first<{ id: string | null; content_version: number | null; content_key: string | null }>();

  if (!row || !row.id || !row.content_key || !row.content_version) {
    return 'not_found' as const;
  }

  if (!env.CONTENT_SIGNING_SECRET || !env.LMS_CONTENT_ORIGIN) {
    return 'not_configured' as const;
  }

  const path = await signContentPath(row.id, row.content_version, env.CONTENT_SIGNING_SECRET, 1800, Date.now());
  return { url: `${env.LMS_CONTENT_ORIGIN.replace(/\/$/, '')}${path}` };
}

export async function openClasses(db: D1Database, actor: Actor) {
  const rows = await db.prepare(`SELECT cg.id, cg.name, cg.schedule_text, co.name AS course_name, p.id AS program_id
    FROM class_group cg
    JOIN course co ON co.id = cg.course_id
    LEFT JOIN lms_program p ON p.class_id = cg.id
    WHERE co.organization_id = ? AND cg.status = 'open'
    ORDER BY co.name, cg.name
    LIMIT 200`)
    .bind(actor.organizationId)
    .all<{
      id: string;
      name: string;
      schedule_text: string | null;
      course_name: string;
      program_id: string | null;
    }>();

  return rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    courseName: r.course_name,
    scheduleText: r.schedule_text,
    hasProgram: r.program_id !== null,
  }));
}

