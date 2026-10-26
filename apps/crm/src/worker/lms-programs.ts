import {
  foldText,
  type AddLessonVideoInput,
  type ApiResult,
  type CloneLmsProgramInput,
  type DeleteLessonVideoInput,
  type ImportLessonVideosInput,
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
  explicitPosition?: number,
) {
  let position = explicitPosition;
  if (position === undefined) {
    const posRow = await db.prepare(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM lms_lesson_video WHERE lesson_id = ? AND deleted_at IS NULL',
    )
      .bind(lessonId)
      .first<{ next_pos: number }>();
    position = posRow?.next_pos ?? 0;
  }
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

const SEP_TRIM_RE = /^[\s|,;\t\-–]+|[\s|,;\t\-–]+$/g;
const URL_TOKEN_RE = /https?:\/\/[^\s|,;]+/gi;
const BARE_UID_RE = /(?:^|(?<=[\s|,;\t\-–]))([0-9a-f]{32})(?=$|[\s|,;\t\-–])/i;

function extractStreamUidFromUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  const validHost =
    host === 'watch.cloudflarestream.com' ||
    host === 'iframe.videodelivery.net' ||
    host === 'videodelivery.net' ||
    /^customer-[a-z0-9-]+\.cloudflarestream\.com$/.test(host);
  if (!validHost) return null;

  const pathMatch = /^\/([0-9a-f]{32})(?:\/.*)?$/i.exec(parsed.pathname);
  if (!pathMatch) return null;
  return pathMatch[1]!.toLowerCase();
}

function removeSpanAndCleanTitle(line: string, start: number, length: number): string {
  const left = line.slice(0, start).replace(SEP_TRIM_RE, '').trim();
  const right = line.slice(start + length).replace(SEP_TRIM_RE, '').trim();
  return [left, right].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function parseVideoLine(rawLine: string): { streamUid: string | null; title: string } {
  const urlMatches = [...rawLine.matchAll(URL_TOKEN_RE)];
  if (urlMatches.length > 0) {
    for (const m of urlMatches) {
      const uid = extractStreamUidFromUrl(m[0]);
      if (uid) {
        const title = removeSpanAndCleanTitle(rawLine, m.index!, m[0].length);
        return { streamUid: uid, title };
      }
    }
    const first = urlMatches[0]!;
    const title = removeSpanAndCleanTitle(rawLine, first.index!, first[0].length);
    return { streamUid: null, title };
  }

  const bareMatch = BARE_UID_RE.exec(rawLine);
  if (bareMatch && bareMatch.index !== undefined) {
    const uid = bareMatch[1]!.toLowerCase();
    const title = removeSpanAndCleanTitle(rawLine, bareMatch.index, bareMatch[0].length);
    return { streamUid: uid, title };
  }

  return { streamUid: null, title: rawLine.replace(SEP_TRIM_RE, '').replace(/\s+/g, ' ').trim() };
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const wholeWord = (word: string, extra = '') =>
  new RegExp(`(?<![\\p{L}\\p{N}_${extra}])${escapeRegex(word)}(?![\\p{L}\\p{N}_${extra}])`, 'iu');
// Class codes such as BSR-AI-K1 contain hyphens, so for class names a hyphen also counts as part of the word.
const wholeClassName = (name: string) => wholeWord(name, '\\-');

function hasWholeWord(haystack: string, word: string): boolean {
  return wholeWord(word).test(haystack);
}

/** Drops the class name and section code used for matching, so learners see only the lesson wording. */
function learnerTitle(title: string, className: string, sectionId: string): string {
  const stripped = title
    .replace(wholeClassName(className), ' ')
    .replace(wholeWord(sectionId), ' ')
    .replace(SEP_TRIM_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || title;
}

/** Same rule as canTeach: admins and academic staff see every program, teachers only their classes. */
function teacherProgramScope(actor: Actor) {
  return actor.role === 'teacher'
    ? { filter: ' AND p.class_id IN (SELECT ct.class_id FROM class_teacher ct WHERE ct.user_id = ?)', binds: [actor.organizationId, actor.id] }
    : { filter: '', binds: [actor.organizationId] };
}

export type ImportLessonVideoStatus =
  | 'ready'
  | 'duplicate'
  | 'no_program'
  | 'no_lesson'
  | 'bad_link'
  | 'error';

export interface ImportLessonVideoRow {
  line: number;
  title: string;
  streamUid: string;
  status: ImportLessonVideoStatus;
  message?: string;
  programId?: string;
  programTitle?: string;
  className?: string;
  lessonId?: string;
  lessonTitle?: string;
  sectionId?: string;
}

async function importLessonVideos({ db, actor, input, tx }: Ctx<ImportLessonVideosInput>) {
  const rawLines = input.text.split(/\r?\n/);
  const nonEmptyLines: { line: number; raw: string }[] = [];
  rawLines.forEach((raw, idx) => {
    if (raw.trim().length > 0) {
      nonEmptyLines.push({ line: idx + 1, raw });
    }
  });

  if (nonEmptyLines.length > 100) {
    return fail('VALIDATION_FAILED', 'Tối đa 100 dòng mỗi lần');
  }

  // Teachers only match and see the programs of classes they teach, so other classes stay invisible.
  const { filter: teacherFilter, binds } = teacherProgramScope(actor);
  const [programRows, lessonRows] = await Promise.all([
    db.prepare(`SELECT p.id AS program_id, p.title AS program_title, p.class_id, cg.name AS class_name
      FROM lms_program p
      JOIN class_group cg ON cg.id = p.class_id
      WHERE p.organization_id = ?${teacherFilter}
      ORDER BY p.id`)
      .bind(...binds)
      .all<{
        program_id: string;
        program_title: string;
        class_id: string;
        class_name: string;
      }>(),
    db.prepare(`SELECT l.id AS lesson_id, l.program_id, l.section_id, l.title AS lesson_title, l.position
      FROM lms_lesson l
      JOIN lms_program p ON p.id = l.program_id
      WHERE p.organization_id = ? AND p.class_id IS NOT NULL AND l.hidden_at IS NULL${teacherFilter}
      ORDER BY l.position, l.id`)
      .bind(...binds)
      .all<{
        lesson_id: string;
        program_id: string;
        section_id: string;
        lesson_title: string;
        position: number;
      }>(),
  ]);

  interface ProgramEntry {
    program_id: string;
    program_title: string;
    class_id: string;
    class_name: string;
    foldedClassName: string;
  }
  interface LessonEntry {
    lesson_id: string;
    program_id: string;
    section_id: string;
    lesson_title: string;
    position: number;
  }

  const programById = new Map<string, ProgramEntry>();
  for (const p of programRows.results) {
    programById.set(p.program_id, {
      ...p,
      foldedClassName: foldText(p.class_name),
    });
  }
  const programsByClassLen = [...programById.values()]
    .filter((p) => p.foldedClassName.length > 0)
    .sort((a, b) => b.foldedClassName.length - a.foldedClassName.length);

  const lessonById = new Map<string, LessonEntry>();
  const lessonsByProgram = new Map<string, LessonEntry[]>();
  for (const l of lessonRows.results) {
    lessonById.set(l.lesson_id, l);
    const list = lessonsByProgram.get(l.program_id) ?? [];
    list.push(l);
    lessonsByProgram.set(l.program_id, list);
  }
  for (const list of lessonsByProgram.values()) {
    list.sort((a, b) => b.section_id.length - a.section_id.length || a.position - b.position);
  }

  const overrideByLine = new Map<number, string>();
  for (const ov of input.overrides ?? []) {
    overrideByLine.set(ov.line, ov.lessonId);
  }

  const rows: ImportLessonVideoRow[] = [];
  const matchedCandidates: {
    row: ImportLessonVideoRow;
    program: ProgramEntry;
    lesson: LessonEntry;
  }[] = [];

  for (const { line, raw } of nonEmptyLines) {
    const parsed = parseVideoLine(raw);
    if (!parsed.streamUid) {
      rows.push({
        line,
        title: parsed.title.slice(0, 200),
        streamUid: '',
        status: 'bad_link',
        message: 'Không thấy mã video Cloudflare Stream',
      });
      continue;
    }

    if (!parsed.title) {
      rows.push({
        line,
        title: '',
        streamUid: parsed.streamUid,
        status: 'error',
        message: 'Thiếu tiêu đề',
      });
      continue;
    }

    if (parsed.title.length > 200) {
      rows.push({
        line,
        title: parsed.title.slice(0, 200),
        streamUid: parsed.streamUid,
        status: 'error',
        message: 'Tiêu đề tối đa 200 ký tự',
      });
      continue;
    }

    const title = parsed.title;
    const streamUid = parsed.streamUid;
    const overrideLessonId = overrideByLine.get(line);

    if (overrideLessonId !== undefined) {
      const lesson = lessonById.get(overrideLessonId);
      const program = lesson ? programById.get(lesson.program_id) : undefined;
      if (!lesson || !program) {
        rows.push({
          line,
          title,
          streamUid,
          status: 'error',
          message: 'Phần bài học không hợp lệ',
        });
        continue;
      }
      const row: ImportLessonVideoRow = { line, title, streamUid, status: 'ready' };
      rows.push(row);
      matchedCandidates.push({ row, program, lesson });
      continue;
    }

    const foldedTitle = foldText(title);
    let program = programsByClassLen.find((p) => wholeClassName(p.foldedClassName).test(foldedTitle));
    if (!program && input.programId) {
      program = programById.get(input.programId);
    }
    if (!program) {
      rows.push({
        line,
        title,
        streamUid,
        status: 'no_program',
        message: 'Không nhận ra lớp',
      });
      continue;
    }

    const progLessons = lessonsByProgram.get(program.program_id) ?? [];
    const lesson = progLessons.find((l) => hasWholeWord(title, l.section_id));
    if (!lesson) {
      rows.push({
        line,
        title,
        streamUid,
        status: 'no_lesson',
        message: 'Không nhận ra phần bài học',
        programId: program.program_id,
        programTitle: program.program_title,
        className: program.class_name,
      });
      continue;
    }

    const row: ImportLessonVideoRow = { line, title, streamUid, status: 'ready' };
    rows.push(row);
    matchedCandidates.push({ row, program, lesson });
  }

  const distinctLessonIds = [...new Set(matchedCandidates.map((c) => c.lesson.lesson_id))];
  const existingUidSet = new Set<string>();
  const nextPosByLesson = new Map<string, number>();
  if (distinctLessonIds.length > 0) {
    const existingVideos = await db.prepare(
      `SELECT lesson_id, lower(stream_uid) AS stream_uid, position
       FROM lms_lesson_video
       WHERE lesson_id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL`,
    )
      .bind(JSON.stringify(distinctLessonIds))
      .all<{ lesson_id: string; stream_uid: string; position: number }>();
    for (const v of existingVideos.results) {
      existingUidSet.add(`${v.lesson_id}:${v.stream_uid}`);
      const curNext = nextPosByLesson.get(v.lesson_id) ?? 0;
      if (v.position + 1 > curNext) {
        nextPosByLesson.set(v.lesson_id, v.position + 1);
      }
    }
  }

  const seenInPaste = new Set<string>();
  for (const cand of matchedCandidates) {
    const { row, program, lesson } = cand;
    row.programId = program.program_id;
    row.programTitle = program.program_title;
    row.className = program.class_name;
    row.lessonId = lesson.lesson_id;
    row.lessonTitle = lesson.lesson_title;
    row.sectionId = lesson.section_id;

    const key = `${lesson.lesson_id}:${row.streamUid}`;
    if (existingUidSet.has(key) || seenInPaste.has(key)) {
      row.status = 'duplicate';
      row.message = 'Video đã có ở phần này';
      continue;
    }

    seenInPaste.add(key);
    row.status = 'ready';
    row.title = learnerTitle(row.title, program.class_name, lesson.section_id);
  }

  const summary = {
    ready: rows.filter((r) => r.status === 'ready').length,
    duplicate: rows.filter((r) => r.status === 'duplicate').length,
    unmatched: rows.filter((r) => r.status === 'no_program' || r.status === 'no_lesson').length,
    errors: rows.filter((r) => r.status === 'bad_link' || r.status === 'error').length,
  };

  const readyRows = rows.filter((r) => r.status === 'ready');
  if (!input.commit || readyRows.length === 0) {
    return ok({ committed: false, rows, summary });
  }

  for (const r of readyRows) {
    const lessonId = r.lessonId!;
    const pos = nextPosByLesson.get(lessonId) ?? 0;
    nextPosByLesson.set(lessonId, pos + 1);
    await attachVideo(db, tx, actor, lessonId, r.title, r.streamUid, pos);
  }

  return ok({ committed: true, rows, summary });
}

export const lmsProgramHandlers = {
  addLessonVideo,
  updateLessonVideo,
  deleteLessonVideo,
  updateLmsProgram,
  cloneLmsProgram,
  importLessonVideos,
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
  // Teachers only see the programs of classes they teach.
  const { filter: teacherFilter, binds } = teacherProgramScope(actor);
  const [rows, lessonRows] = await Promise.all([
    db.prepare(`SELECT p.id AS program_id, p.class_id, cg.name AS class_name, co.name AS course_name, p.title,
        (SELECT COUNT(*) FROM lms_lesson l WHERE l.program_id = p.id AND l.hidden_at IS NULL) AS lesson_count
      FROM lms_program p
      LEFT JOIN class_group cg ON cg.id = p.class_id
      LEFT JOIN course co ON co.id = cg.course_id
      WHERE p.organization_id = ?${teacherFilter}
      ORDER BY co.name, cg.name, p.title`)
      .bind(...binds)
      .all<{
        program_id: string;
        class_id: string | null;
        class_name: string | null;
        course_name: string | null;
        title: string;
        lesson_count: number;
      }>(),
    db.prepare(`SELECT l.id, l.program_id, l.section_id, l.title, l.group_title, l.position
      FROM lms_lesson l
      JOIN lms_program p ON p.id = l.program_id
      WHERE p.organization_id = ? AND l.hidden_at IS NULL${teacherFilter}
      ORDER BY l.position, l.id`)
      .bind(...binds)
      .all<{
        id: string;
        program_id: string;
        section_id: string;
        title: string;
        group_title: string | null;
        position: number;
      }>(),
  ]);

  const lessonsByProgram = new Map<string, { id: string; sectionId: string; title: string; groupTitle: string | null; position: number }[]>();
  for (const l of lessonRows.results) {
    const list = lessonsByProgram.get(l.program_id) ?? [];
    list.push({
      id: l.id,
      sectionId: l.section_id,
      title: l.title,
      groupTitle: l.group_title,
      position: l.position,
    });
    lessonsByProgram.set(l.program_id, list);
  }

  return rows.results.map((r) => ({
    programId: r.program_id,
    classId: r.class_id,
    className: r.class_name,
    courseName: r.course_name,
    title: r.title,
    lessonCount: r.lesson_count,
    lessons: lessonsByProgram.get(r.program_id) ?? [],
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

