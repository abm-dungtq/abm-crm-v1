import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import { sha256 } from '../src/worker/commands';
import app from '../src/worker/index';
import { addUser, command, db, get, makeClass, type Json } from './helpers/learner-fixtures';
import { resetDb } from './helpers/reset-db';

declare global {
  namespace Cloudflare {
    interface Env {
      LMS_CONTENT: R2Bucket;
      LMS_CONTENT_ORIGIN: string;
      STREAM_ACCOUNT_ID: string;
      STREAM_API_TOKEN?: string;
      CONTENT_SIGNING_SECRET?: string;
    }
  }
}

beforeEach(async () => {
  await resetDb(db, seedSql);
  await addUser('u-academic', 'academic');
  await addUser('u-teacher', 'teacher');
});

async function issueAgentToken(userId: string, raw = `tok-${userId}-${crypto.randomUUID()}`) {
  const tokenHash = await sha256(raw);
  await db.prepare(
    `INSERT INTO agent_token (id, user_id, token_hash, created_at)
     VALUES (?, ?, ?, '2026-01-01T00:00:00.000Z')`,
  )
    .bind(crypto.randomUUID(), userId, tokenHash)
    .run();
  return raw;
}

async function publishCall(
  token: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
) {
  const response = await app.fetch(
    new Request('http://crm.test/api/lms-publish/programs', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    }),
    env,
  );
  return { status: response.status, json: (await response.json()) as Json };
}

describe('LMS programs, videos, clone, and publish API', () => {
  it('1. publish 3 lessons -> 200, contentVersion 1, R2 object exists', async () => {
    const { classId } = await makeClass('Lớp BSR K1');
    const token = await issueAgentToken('u-academic');

    const res = await publishCall(token, {
      classId,
      title: 'Cẩm nang BSR K1',
      html: '<!doctype html><html><body><section id="s1">Bài 1</section></body></html>',
      lessons: [
        { sectionId: 's1', title: 'Phần 1', groupTitle: 'Buổi 1', position: 0 },
        { sectionId: 's2', title: 'Phần 2', groupTitle: 'Buổi 1', position: 1 },
        { sectionId: 's3', title: 'Phần 3', groupTitle: 'Buổi 2', position: 2 },
      ],
    });

    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data).toMatchObject({
      contentVersion: 1,
      lessons: 3,
      hidden: 0,
    });

    const programId = res.json.data.programId as string;
    const key = `programs/${programId}/v1.html`;
    const r2Obj = await env.LMS_CONTENT.get(key);
    expect(r2Obj).not.toBeNull();
    expect(await r2Obj!.text()).toContain('Bài 1');
  });

  it('2. republish with 2 of those sections + 1 new -> contentVersion 2, hidden 1, lesson rows = 4 with one hidden_at not null', async () => {
    const { classId } = await makeClass('Lớp BSR K2');
    const token = await issueAgentToken('u-academic');

    const first = await publishCall(token, {
      classId,
      title: 'Cẩm nang v1',
      html: '<html><body>v1</body></html>',
      lessons: [
        { sectionId: 's1', title: 'Phần 1', position: 0 },
        { sectionId: 's2', title: 'Phần 2', position: 1 },
        { sectionId: 's3', title: 'Phần 3', position: 2 },
      ],
    });
    expect(first.status).toBe(200);
    const programId = first.json.data.programId as string;

    const second = await publishCall(token, {
      classId,
      title: 'Cẩm nang v2',
      html: '<html><body>v2</body></html>',
      lessons: [
        { sectionId: 's1', title: 'Phần 1 mới', position: 0 },
        { sectionId: 's2', title: 'Phần 2 mới', position: 1 },
        { sectionId: 's4', title: 'Phần 4 mới', position: 2 },
      ],
    });

    expect(second.status, JSON.stringify(second.json)).toBe(200);
    expect(second.json.data).toEqual({
      programId,
      contentVersion: 2,
      lessons: 3,
      hidden: 1,
    });

    const rows = (
      await db.prepare('SELECT section_id, title, hidden_at FROM lms_lesson WHERE program_id = ? ORDER BY section_id')
        .bind(programId)
        .all<{ section_id: string; title: string; hidden_at: string | null }>()
    ).results;
    expect(rows).toHaveLength(4);
    const hiddenRows = rows.filter((r) => r.hidden_at !== null);
    expect(hiddenRows).toHaveLength(1);
    expect(hiddenRows[0]!.section_id).toBe('s3');
  });

  it('3. publish with browser Origin header -> 403; wrong token -> 401; sale-role token -> 403', async () => {
    const { classId } = await makeClass('Lớp Bảo Mật');
    const academicToken = await issueAgentToken('u-academic');
    const saleToken = await issueAgentToken('u-lan');

    const payload = {
      classId,
      title: 'Cẩm nang',
      html: '<html></html>',
      lessons: [{ sectionId: 's1', title: 'Phần 1', position: 0 }],
    };

    const withOrigin = await publishCall(academicToken, payload, { Origin: 'https://evil.example' });
    expect(withOrigin.status).toBe(403);

    const wrongToken = await publishCall('wrong-token-value', payload);
    expect(wrongToken.status).toBe(401);

    const saleAttempt = await publishCall(saleToken, payload);
    expect(saleAttempt.status).toBe(403);
  });

  it('3b. a self-service read token or an expired script token cannot publish -> 401', async () => {
    const { classId } = await makeClass('Lớp Token Tự Tạo');
    const payload = {
      classId,
      title: 'Cẩm nang',
      html: '<html></html>',
      lessons: [{ sectionId: 's1', title: 'Phần 1', position: 0 }],
    };

    const selfToken = await issueAgentToken('u-academic');
    await db.prepare(`UPDATE agent_token SET scope = 'read', created_via = 'self' WHERE token_hash = ?`)
      .bind(await sha256(selfToken)).run();
    expect((await publishCall(selfToken, payload)).status).toBe(401);

    const expiredToken = await issueAgentToken('u-academic');
    await db.prepare(`UPDATE agent_token SET expires_at = '2000-01-01T00:00:00.000Z' WHERE token_hash = ?`)
      .bind(await sha256(expiredToken)).run();
    expect((await publishCall(expiredToken, payload)).status).toBe(401);
  });

  it('4. addLessonVideo with streamUid as academic -> 200; unassigned teacher -> 403; assigned teacher -> 200', async () => {
    const { classId, classVersion } = await makeClass('Lớp Video');
    const token = await issueAgentToken('u-academic');
    const published = await publishCall(token, {
      classId,
      title: 'Chương trình Video',
      html: '<html></html>',
      lessons: [{ sectionId: 's1', title: 'Phần 1', position: 0 }],
    });
    expect(published.status).toBe(200);

    const lesson = await db.prepare('SELECT id FROM lms_lesson WHERE program_id = ? AND section_id = ?')
      .bind(published.json.data.programId, 's1')
      .first<{ id: string }>();
    const lessonId = lesson!.id;

    const uid1 = '0123456789abcdef0123456789abcdef';
    const uid2 = 'fedcba9876543210fedcba9876543210';

    const byAcademic = await command('u-academic', 'addLessonVideo', {
      lessonId,
      title: 'Video 1',
      streamUid: uid1,
    });
    expect(byAcademic.status, JSON.stringify(byAcademic.json)).toBe(200);

    const byUnassignedTeacher = await command('u-teacher', 'addLessonVideo', {
      lessonId,
      title: 'Video 2',
      streamUid: uid2,
    });
    expect(byUnassignedTeacher.status).toBe(403);
    expect(byUnassignedTeacher.json.error?.code).toBe('FORBIDDEN');

    const assign = await command('u-academic', 'setClassTeachers', {
      classId,
      version: classVersion,
      teacherUserIds: ['u-teacher'],
    });
    expect(assign.status, JSON.stringify(assign.json)).toBe(200);

    const byAssignedTeacher = await command('u-teacher', 'addLessonVideo', {
      lessonId,
      title: 'Video 2',
      streamUid: uid2,
    });
    expect(byAssignedTeacher.status, JSON.stringify(byAssignedTeacher.json)).toBe(200);
  });

  it('5. addLessonVideo with sourceUrl when STREAM_API_TOKEN is unset -> error with message Chưa cấu hình Cloudflare Stream', async () => {
    const { classId } = await makeClass('Lớp Stream URL');
    const token = await issueAgentToken('u-academic');
    const published = await publishCall(token, {
      classId,
      title: 'Chương trình Stream',
      html: '<html></html>',
      lessons: [{ sectionId: 's1', title: 'Phần 1', position: 0 }],
    });
    expect(published.status).toBe(200);

    const lesson = await db.prepare('SELECT id FROM lms_lesson WHERE program_id = ? AND section_id = ?')
      .bind(published.json.data.programId, 's1')
      .first<{ id: string }>();

    const res = await command('u-academic', 'addLessonVideo', {
      lessonId: lesson!.id,
      title: 'Video từ URL',
      sourceUrl: 'https://example.com/recording.mp4',
    });
    expect(res.status).toBe(422);
    expect(res.json.error?.code).toBe('VALIDATION_FAILED');
    expect(res.json.error?.message).toBe('Chưa cấu hình Cloudflare Stream');
  });

  it('6. deleteLessonVideo hides it from GET /classes/:id/lms', async () => {
    const { classId } = await makeClass('Lớp Xoá Video');
    const token = await issueAgentToken('u-academic');
    const published = await publishCall(token, {
      classId,
      title: 'Chương trình Xoá Video',
      html: '<html></html>',
      lessons: [{ sectionId: 's1', title: 'Phần 1', position: 0 }],
    });
    expect(published.status).toBe(200);

    const lesson = await db.prepare('SELECT id FROM lms_lesson WHERE program_id = ? AND section_id = ?')
      .bind(published.json.data.programId, 's1')
      .first<{ id: string }>();

    const added = await command('u-academic', 'addLessonVideo', {
      lessonId: lesson!.id,
      title: 'Video Sắp Xoá',
      streamUid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    expect(added.status).toBe(200);
    const videoId = added.json.data.id as string;

    const beforeDelete = await get('u-academic', `/classes/${classId}/lms`);
    expect(beforeDelete.status).toBe(200);
    expect(beforeDelete.json.data.lessons[0].videos).toHaveLength(1);

    const deleted = await command('u-academic', 'deleteLessonVideo', { videoId, version: 1 });
    expect(deleted.status, JSON.stringify(deleted.json)).toBe(200);

    const afterDelete = await get('u-academic', `/classes/${classId}/lms`);
    expect(afterDelete.status).toBe(200);
    expect(afterDelete.json.data.lessons[0].videos).toHaveLength(0);
  });

  it('7. updateLmsProgram sets reviewDays: 90 then null', async () => {
    const { classId } = await makeClass('Lớp Review Days');
    const token = await issueAgentToken('u-academic');
    const published = await publishCall(token, {
      classId,
      title: 'Chương trình Review',
      html: '<html></html>',
      lessons: [{ sectionId: 's1', title: 'Phần 1', position: 0 }],
    });
    expect(published.status).toBe(200);
    const programId = published.json.data.programId as string;

    const set90 = await command('u-academic', 'updateLmsProgram', {
      programId,
      version: 1,
      title: 'Chương trình Review (90 ngày)',
      reviewDays: 90,
    });
    expect(set90.status, JSON.stringify(set90.json)).toBe(200);

    const detail90 = await get('u-academic', `/classes/${classId}/lms`);
    expect(detail90.json.data.program).toMatchObject({
      title: 'Chương trình Review (90 ngày)',
      reviewDays: 90,
      version: 2,
    });

    const setNull = await command('u-academic', 'updateLmsProgram', {
      programId,
      version: 2,
      reviewDays: null,
    });
    expect(setNull.status, JSON.stringify(setNull.json)).toBe(200);

    const detailNull = await get('u-academic', `/classes/${classId}/lms`);
    expect(detailNull.json.data.program).toMatchObject({
      title: 'Chương trình Review (90 ngày)',
      reviewDays: null,
      version: 3,
    });
  });

  it('8. cloneLmsProgram copies non-hidden lessons, zero videos, and R2 content object; cloning again into the same target -> 409', async () => {
    const { courseId, classId: fromClassId } = await makeClass('Lớp Nguồn');
    const toClassRes = await command('u-academic', 'upsertClass', {
      courseId,
      name: 'Lớp Đích',
      status: 'open',
    });
    expect(toClassRes.status).toBe(200);
    const toClassId = toClassRes.json.data.id as string;

    const token = await issueAgentToken('u-academic');
    const first = await publishCall(token, {
      classId: fromClassId,
      title: 'Cẩm nang Gốc',
      html: '<html><body>v1</body></html>',
      lessons: [
        { sectionId: 's1', title: 'Phần 1', position: 0 },
        { sectionId: 's2', title: 'Phần 2 (sẽ ẩn)', position: 1 },
      ],
    });
    expect(first.status).toBe(200);

    const second = await publishCall(token, {
      classId: fromClassId,
      title: 'Cẩm nang Gốc v2',
      html: '<html><body>Nội dung chuẩn v2</body></html>',
      lessons: [
        { sectionId: 's1', title: 'Phần 1', groupTitle: 'Buổi 1', position: 0 },
        { sectionId: 's3', title: 'Phần 3', groupTitle: 'Buổi 2', position: 1 },
      ],
    });
    expect(second.status).toBe(200);
    const sourceProgramId = second.json.data.programId as string;

    const lessonS1 = await db.prepare('SELECT id FROM lms_lesson WHERE program_id = ? AND section_id = ?')
      .bind(sourceProgramId, 's1')
      .first<{ id: string }>();
    const addVideoRes = await command('u-academic', 'addLessonVideo', {
      lessonId: lessonS1!.id,
      title: 'Video lớp nguồn',
      streamUid: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });
    expect(addVideoRes.status).toBe(200);

    const cloned = await command('u-academic', 'cloneLmsProgram', {
      fromClassId,
      toClassId,
    });
    expect(cloned.status, JSON.stringify(cloned.json)).toBe(200);
    const clonedProgramId = cloned.json.data.id as string;

    const clonedDetail = await get('u-academic', `/classes/${toClassId}/lms`);
    expect(clonedDetail.status).toBe(200);
    expect(clonedDetail.json.data.program).toMatchObject({
      id: clonedProgramId,
      title: 'Cẩm nang Gốc v2',
      contentVersion: 2,
      clonedFromProgramId: sourceProgramId,
    });
    expect(clonedDetail.json.data.lessons).toHaveLength(2);
    expect(clonedDetail.json.data.lessons.map((l: any) => l.sectionId)).toEqual(['s1', 's3']);
    expect(clonedDetail.json.data.lessons.every((l: any) => l.videos.length === 0)).toBe(true);

    const newKey = `programs/${clonedProgramId}/v2.html`;
    const clonedObj = await env.LMS_CONTENT.get(newKey);
    expect(clonedObj).not.toBeNull();
    expect(await clonedObj!.text()).toBe('<html><body>Nội dung chuẩn v2</body></html>');

    const cloneAgain = await command('u-academic', 'cloneLmsProgram', {
      fromClassId,
      toClassId,
    });
    expect(cloneAgain.status).toBe(409);
    expect(cloneAgain.json.error?.code).toBe('DUPLICATE_SUSPECTED');
  });

  it('9. GET /classes/:id/lms as sale -> 403', async () => {
    const { classId } = await makeClass('Lớp Sale Không Xem Được');
    const res = await get('u-lan', `/classes/${classId}/lms`);
    expect(res.status).toBe(403);
    expect(res.json.error?.code).toBe('FORBIDDEN');
  });
});
