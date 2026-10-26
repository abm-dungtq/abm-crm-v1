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
  await addUser('u-teacher-1', 'teacher');
  await addUser('u-teacher-2', 'teacher');
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
) {
  const response = await app.fetch(
    new Request('http://crm.test/api/lms-publish/programs', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
    env,
  );
  return { status: response.status, json: (await response.json()) as Json };
}

async function setupClassProgram(
  className: string,
  programTitle: string,
  lessons: { sectionId: string; title: string; position: number }[],
) {
  const { courseId, classId, classVersion } = await makeClass(className);
  const token = await issueAgentToken('u-academic');
  const pub = await publishCall(token, {
    classId,
    title: programTitle,
    html: '<html><body>program</body></html>',
    lessons,
  });
  expect(pub.status, JSON.stringify(pub.json)).toBe(200);
  const programId = pub.json.data.programId as string;
  const lessonRows = (
    await db.prepare('SELECT id, section_id, title FROM lms_lesson WHERE program_id = ? ORDER BY position')
      .bind(programId)
      .all<{ id: string; section_id: string; title: string }>()
  ).results;
  return { courseId, classId, classVersion, programId, lessons: lessonRows };
}

describe('importLessonVideos command', () => {
  it('1. accepts every Cloudflare Stream link form and bare UID (normalized to lowercase), and rejects a bad host or missing title', async () => {
    const { programId } = await setupClassProgram('BSR-AI-K1', 'Chương trình K1', [
      { sectionId: 'b1m1', title: 'Buổi 1 Phần 1', position: 0 },
    ]);

    const uid1 = '0123456789ABCDEF0123456789ABCDEF';
    const uid2 = '11111111111111111111111111111111';
    const uid3 = '22222222222222222222222222222222';
    const uid4 = '33333333333333333333333333333333';
    const uid5 = '44444444444444444444444444444444';
    const uid6 = '55555555555555555555555555555555';
    const uid7 = '66666666666666666666666666666666';

    const text = [
      `BSR-AI-K1 b1m1 Buổi 1 – Bare UID | ${uid1}`,
      `BSR-AI-K1 b1m1 Buổi 1, Customer watch ; https://customer-abc123xyz.cloudflarestream.com/${uid2}/watch`,
      `BSR-AI-K1 b1m1 Buổi 1 - Customer iframe - https://customer-abc123xyz.cloudflarestream.com/${uid3}/iframe`,
      `BSR-AI-K1 b1m1 Buổi 1 – Customer manifest\thttps://customer-abc123xyz.cloudflarestream.com/${uid4}/manifest/video.m3u8`,
      `BSR-AI-K1 b1m1 Buổi 1 | Watch host | https://watch.cloudflarestream.com/${uid5}`,
      `BSR-AI-K1 b1m1 Buổi 1, Iframe videodelivery, https://iframe.videodelivery.net/${uid6}`,
      `BSR-AI-K1 b1m1 Buổi 1 ; Videodelivery path ; https://videodelivery.net/${uid7}/manifest/video.m3u8`,
      `BSR-AI-K1 b1m1 Bad host | https://evil.example.com/${uid1.toLowerCase()}/watch`,
      ` | https://watch.cloudflarestream.com/77777777777777777777777777777777`,
    ].join('\n');

    const res = await command('u-academic', 'importLessonVideos', {
      text,
      commit: false,
    });

    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data.committed).toBe(false);
    const rows = res.json.data.rows as any[];
    expect(rows).toHaveLength(9);

    expect(rows[0]).toMatchObject({
      line: 1,
      title: 'Buổi 1 – Bare UID',
      streamUid: uid1.toLowerCase(),
      status: 'ready',
      programId,
      sectionId: 'b1m1',
    });
    expect(rows[1]).toMatchObject({
      line: 2,
      title: 'Buổi 1, Customer watch',
      streamUid: uid2,
      status: 'ready',
    });
    expect(rows[2]).toMatchObject({
      line: 3,
      title: 'Buổi 1 - Customer iframe',
      streamUid: uid3,
      status: 'ready',
    });
    expect(rows[3]).toMatchObject({
      line: 4,
      title: 'Buổi 1 – Customer manifest',
      streamUid: uid4,
      status: 'ready',
    });
    expect(rows[4]).toMatchObject({
      line: 5,
      title: 'Buổi 1 | Watch host',
      streamUid: uid5,
      status: 'ready',
    });
    expect(rows[5]).toMatchObject({
      line: 6,
      title: 'Buổi 1, Iframe videodelivery',
      streamUid: uid6,
      status: 'ready',
    });
    expect(rows[6]).toMatchObject({
      line: 7,
      title: 'Buổi 1 ; Videodelivery path',
      streamUid: uid7,
      status: 'ready',
    });
    expect(rows[7]).toMatchObject({
      line: 8,
      status: 'bad_link',
      message: 'Không thấy mã video Cloudflare Stream',
    });
    expect(rows[8]).toMatchObject({
      line: 9,
      status: 'error',
      message: 'Thiếu tiêu đề',
    });

    expect(res.json.data.summary).toEqual({
      ready: 7,
      duplicate: 0,
      unmatched: 0,
      errors: 2,
    });
  });

  it('2. matches class name (longest wins, accent- and case-insensitive) vs default programId, and matches whole-word section_id', async () => {
    const k1 = await setupClassProgram('Lớp AI K1', 'Chương trình K1', [
      { sectionId: 'b1m1', title: 'K1 B1M1', position: 0 },
      { sectionId: 'b2m1', title: 'K1 B2M1', position: 1 },
    ]);
    const k10 = await setupClassProgram('Lớp AI K10', 'Chương trình K10', [
      { sectionId: 'b1m1', title: 'K10 B1M1', position: 0 },
    ]);

    const uidA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const uidB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const uidC = 'cccccccccccccccccccccccccccccccc';
    const uidD = 'dddddddddddddddddddddddddddddddd';

    const text = [
      // Longest class name "Lớp AI K10" beats "Lớp AI K1" even when default programId is k1; accent-insensitive "lop ai k10"
      `lop  ai  k10 B1M1 Bài mở đầu | ${uidA}`,
      // No class name in title -> falls back to default programId (k1)
      `b2m1 Bài 2 mặc định | ${uidB}`,
      // Whole-word section check: "b1m10" must NOT match "b1m1"
      `Lớp AI K1 b1m10 Bài không khớp phần | ${uidC}`,
      // Neither class name nor default program (checked in a second call without programId)
      `Không có tên lớp b1m1 | ${uidD}`,
    ].join('\n');

    const withDefault = await command('u-academic', 'importLessonVideos', {
      text: text.split('\n').slice(0, 3).join('\n'),
      programId: k1.programId,
      commit: false,
    });
    expect(withDefault.status).toBe(200);
    const rows = withDefault.json.data.rows as any[];
    expect(rows[0]).toMatchObject({
      status: 'ready',
      programId: k10.programId,
      className: 'Lớp AI K10',
      sectionId: 'b1m1',
    });
    expect(rows[1]).toMatchObject({
      status: 'ready',
      programId: k1.programId,
      className: 'Lớp AI K1',
      sectionId: 'b2m1',
    });
    expect(rows[2]).toMatchObject({
      status: 'no_lesson',
      message: 'Không nhận ra phần bài học',
      programId: k1.programId,
    });

    const withoutDefault = await command('u-academic', 'importLessonVideos', {
      text: `Không có tên lớp b1m1 | ${uidD}`,
      commit: false,
    });
    expect(withoutDefault.status).toBe(200);
    expect(withoutDefault.json.data.rows[0]).toMatchObject({
      status: 'no_program',
      message: 'Không nhận ra lớp',
    });
    expect(withoutDefault.json.data.summary).toEqual({
      ready: 0,
      duplicate: 0,
      unmatched: 1,
      errors: 0,
    });
  });

  it('3. applies an override to replace the match, and rejects an invalid or hidden lesson override', async () => {
    const k1 = await setupClassProgram('BSR-K1', 'Chương trình K1', [
      { sectionId: 's1', title: 'Phần 1', position: 0 },
      { sectionId: 's2', title: 'Phần 2 (sẽ ẩn)', position: 1 },
    ]);
    // Republish without s2 so s2 becomes hidden
    const token = await issueAgentToken('u-academic');
    const repub = await publishCall(token, {
      classId: k1.classId,
      title: 'Chương trình K1 v2',
      html: '<html><body>v2</body></html>',
      lessons: [{ sectionId: 's1', title: 'Phần 1', position: 0 }],
    });
    expect(repub.status).toBe(200);

    const s1Id = k1.lessons.find((l) => l.section_id === 's1')!.id;
    const s2HiddenId = k1.lessons.find((l) => l.section_id === 's2')!.id;
    const uid1 = '10101010101010101010101010101010';
    const uid2 = '20202020202020202020202020202020';

    const res = await command('u-academic', 'importLessonVideos', {
      text: [
        `Video chưa rõ lớp và phần | ${uid1}`,
        `Video gắn vào phần đã ẩn | ${uid2}`,
      ].join('\n'),
      overrides: [
        { line: 1, lessonId: s1Id },
        { line: 2, lessonId: s2HiddenId },
      ],
      commit: false,
    });

    expect(res.status).toBe(200);
    const rows = res.json.data.rows as any[];
    expect(rows[0]).toMatchObject({
      line: 1,
      status: 'ready',
      programId: k1.programId,
      lessonId: s1Id,
      sectionId: 's1',
    });
    expect(rows[1]).toMatchObject({
      line: 2,
      status: 'error',
      message: 'Phần bài học không hợp lệ',
    });
  });

  it('4. detects a duplicate already in the DB and a duplicate within the same paste', async () => {
    const k1 = await setupClassProgram('BSR-DUP', 'Chương trình Dup', [
      { sectionId: 's1', title: 'Phần 1', position: 0 },
    ]);
    const lessonId = k1.lessons[0]!.id;
    const existingUid = 'aaaa1111aaaa1111aaaa1111aaaa1111';
    const pasteDupUid = 'bbbb2222bbbb2222bbbb2222bbbb2222';

    const added = await command('u-academic', 'addLessonVideo', {
      lessonId,
      title: 'Video đã có sẵn',
      streamUid: existingUid,
    });
    expect(added.status).toBe(200);

    const res = await command('u-academic', 'importLessonVideos', {
      text: [
        `BSR-DUP s1 Video trùng DB | ${existingUid}`,
        `BSR-DUP s1 Video mới lần 1 | ${pasteDupUid}`,
        `BSR-DUP s1 Video mới lần 2 trùng trong paste | ${pasteDupUid.toUpperCase()}`,
      ].join('\n'),
      commit: false,
    });

    expect(res.status).toBe(200);
    const rows = res.json.data.rows as any[];
    expect(rows[0]).toMatchObject({
      line: 1,
      status: 'duplicate',
      message: 'Video đã có ở phần này',
    });
    expect(rows[1]).toMatchObject({
      line: 2,
      status: 'ready',
    });
    expect(rows[2]).toMatchObject({
      line: 3,
      status: 'duplicate',
      message: 'Video đã có ở phần này',
    });
    expect(res.json.data.summary).toEqual({
      ready: 1,
      duplicate: 2,
      unmatched: 0,
      errors: 0,
    });
  });

  it('5. a teacher only matches classes they teach; other classes stay unrecognised and reveal nothing', async () => {
    const c1 = await setupClassProgram('Lớp GV1', 'Chương trình GV1', [
      { sectionId: 's1', title: 'Phần 1', position: 0 },
    ]);
    await setupClassProgram('Lớp GV2', 'Chương trình GV2', [
      { sectionId: 's1', title: 'Phần 1', position: 0 },
    ]);

    const assign = await command('u-academic', 'setClassTeachers', {
      classId: c1.classId,
      version: c1.classVersion,
      teacherUserIds: ['u-teacher-1'],
    });
    expect(assign.status).toBe(200);

    const uid1 = '12121212121212121212121212121212';
    const uid2 = '34343434343434343434343434343434';

    const res = await command('u-teacher-1', 'importLessonVideos', {
      text: [
        `Lớp GV1 s1 Video lớp mình dạy | ${uid1}`,
        `Lớp GV2 s1 Video lớp người khác | ${uid2}`,
      ].join('\n'),
      commit: false,
    });

    expect(res.status).toBe(200);
    const rows = res.json.data.rows as any[];
    expect(rows[0]).toMatchObject({
      line: 1,
      status: 'ready',
    });
    expect(rows[1]).toMatchObject({ line: 2, status: 'no_program', message: 'Không nhận ra lớp' });
    expect(rows[1].programTitle).toBeUndefined();
    expect(rows[1].lessonTitle).toBeUndefined();
    expect(res.json.data.summary).toEqual({
      ready: 1,
      duplicate: 0,
      unmatched: 1,
      errors: 0,
    });
  });

  it('6. preview writes nothing; commit inserts only ready rows with consecutive positions', async () => {
    const k1 = await setupClassProgram('BSR-COMMIT', 'Chương trình Commit', [
      { sectionId: 's1', title: 'Phần 1', position: 0 },
      { sectionId: 's2', title: 'Phần 2', position: 1 },
    ]);
    const s1Id = k1.lessons.find((l) => l.section_id === 's1')!.id;
    const s2Id = k1.lessons.find((l) => l.section_id === 's2')!.id;

    // Seed one existing video in s1 at position 0
    const seedVideo = await command('u-academic', 'addLessonVideo', {
      lessonId: s1Id,
      title: 'Video 0 sẵn có',
      streamUid: '00000000000000000000000000000001',
    });
    expect(seedVideo.status).toBe(200);

    const text = [
      `BSR-COMMIT s1 Video mới 1 cho s1 | 00000000000000000000000000000002`,
      `BSR-COMMIT s1 Video mới 2 cho s1 | 00000000000000000000000000000003`,
      `BSR-COMMIT s2 Video mới 1 cho s2 | 00000000000000000000000000000004`,
      `BSR-COMMIT s99 Không khớp phần | 00000000000000000000000000000005`,
    ].join('\n');

    const previewRes = await command('u-academic', 'importLessonVideos', {
      text,
      commit: false,
    });
    expect(previewRes.status).toBe(200);
    expect(previewRes.json.data.committed).toBe(false);
    expect(previewRes.json.data.summary.ready).toBe(3);

    const countAfterPreview = await db.prepare('SELECT COUNT(*) AS cnt FROM lms_lesson_video').first<{ cnt: number }>();
    expect(countAfterPreview?.cnt).toBe(1);

    const commitRes = await command('u-academic', 'importLessonVideos', {
      text,
      commit: true,
    });
    expect(commitRes.status, JSON.stringify(commitRes.json)).toBe(200);
    expect(commitRes.json.data.committed).toBe(true);
    expect(commitRes.json.data.summary).toEqual({
      ready: 3,
      duplicate: 0,
      unmatched: 1,
      errors: 0,
    });

    const s1Videos = (
      await db.prepare('SELECT title, stream_uid, position FROM lms_lesson_video WHERE lesson_id = ? ORDER BY position')
        .bind(s1Id)
        .all<{ title: string; stream_uid: string; position: number }>()
    ).results;
    expect(s1Videos).toEqual([
      { title: 'Video 0 sẵn có', stream_uid: '00000000000000000000000000000001', position: 0 },
      { title: 'Video mới 1 cho s1', stream_uid: '00000000000000000000000000000002', position: 1 },
      { title: 'Video mới 2 cho s1', stream_uid: '00000000000000000000000000000003', position: 2 },
    ]);

    const s2Videos = (
      await db.prepare('SELECT title, stream_uid, position FROM lms_lesson_video WHERE lesson_id = ? ORDER BY position')
        .bind(s2Id)
        .all<{ title: string; stream_uid: string; position: number }>()
    ).results;
    expect(s2Videos).toEqual([
      { title: 'Video mới 1 cho s2', stream_uid: '00000000000000000000000000000004', position: 0 },
    ]);
  });

  it('7b. matches a class name only as a whole word', async () => {
    await setupClassProgram('BSR-AI-K1', 'Chương trình K1', [{ sectionId: 's1', title: 'Phần 1', position: 0 }]);
    await setupClassProgram('AI', 'Chương trình AI', [{ sectionId: 's1', title: 'Phần 1', position: 0 }]);
    const res = await command('u-academic', 'importLessonVideos', {
      text: [
        'BSR-AI-K10 s1 Lớp chưa có chương trình | 55555555555555555555555555555555',
        'Bài mở đầu s1 không có tên lớp | 66666666666666666666666666666666',
        'BSR-AI-K1 s1 Lớp K1 | 77777777777777777777777777777777',
      ].join('\n'),
      commit: false,
    });
    expect(res.status).toBe(200);
    const rows = res.json.data.rows as any[];
    expect(rows[0]).toMatchObject({ status: 'no_program' });
    expect(rows[1]).toMatchObject({ status: 'no_program' });
    expect(rows[2]).toMatchObject({ status: 'ready', className: 'BSR-AI-K1', title: 'Lớp K1' });
  });

  it('7. enforces the 100 non-empty line limit', async () => {
    const lines = Array.from({ length: 101 }, (_, i) => {
      const hex = (i + 1).toString(16).padStart(32, '0');
      return `BSR-AI-K1 s1 Video ${i + 1} | ${hex}`;
    }).join('\n');

    const res = await command('u-academic', 'importLessonVideos', {
      text: lines,
      commit: false,
    });
    expect(res.status).toBe(422);
    expect(res.json.error?.code).toBe('VALIDATION_FAILED');
    expect(res.json.error?.message).toBe('Tối đa 100 dòng mỗi lần');
  });

  it('8. GET /lms/programs shows a teacher only the programs of classes they teach, with non-hidden lessons', async () => {
    const k = await setupClassProgram('BSR-PROG-LIST', 'Chương trình List', [
      { sectionId: 's1', title: 'Bài 1', position: 0 },
    ]);
    await setupClassProgram('BSR-PROG-OTHER', 'Chương trình khác', [
      { sectionId: 's1', title: 'Bài 1', position: 0 },
    ]);
    const before = await get('u-teacher-1', '/lms/programs');
    expect(before.status).toBe(200);
    expect(before.json.data).toHaveLength(0);
    const assign = await command('u-academic', 'setClassTeachers', {
      classId: k.classId,
      version: k.classVersion,
      teacherUserIds: ['u-teacher-1'],
    });
    expect(assign.status).toBe(200);
    const res = await get('u-teacher-1', '/lms/programs');
    expect(res.status).toBe(200);
    expect(res.json.data).toHaveLength(1);
    expect(res.json.data[0].lessons).toHaveLength(1);
    expect(res.json.data[0].lessons[0].sectionId).toBe('s1');
  });
});
