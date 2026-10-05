import { beforeEach, describe, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import { addUser, command, db, get, grantConsent, leadVersion, makeClass, makeLead, reserve, walk, winLead } from './helpers/learner-fixtures';
import { resetDb } from './helpers/reset-db';

const count = async (sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).first<{ n: number }>())!.n;
const enrollmentVersion = async (id: string) => (await db.prepare('SELECT version FROM enrollment WHERE id = ?').bind(id).first<{ version: number }>())!.version;

async function moneyRows() {
  const tables = (await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND (
    name LIKE '%fee%' OR name LIKE '%payment%' OR name LIKE '%invoice%' OR name LIKE '%tuition%' OR name LIKE '%charge%')`).all<{ name: string }>()).results;
  let n = 0;
  for (const table of tables) n += await count(`SELECT COUNT(*) AS n FROM "${table.name.replaceAll('"', '""')}"`);
  return n;
}

async function studentCount(classId: string) {
  const body = (await get('u-academic', '/courses')).json.data as { courses: { classes: { id: string; studentCount: number }[] }[] };
  return body.courses.flatMap((c) => c.classes).find((c) => c.id === classId)?.studentCount;
}

beforeEach(async () => {
  await resetDb(db, seedSql);
  await addUser('u-academic', 'academic');
  await addUser('u-teacher', 'teacher');
});

async function makeTrial(classId: string) {
  const r = await command('u-academic', 'addSession', {
    classId, startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 90, kind: 'trial',
  });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json.data.id as string;
}

describe('academic classes and enrollment', () => {
  test('reserveSeat rejects a lead that is not won, and a pending seat does not count', async () => {
    const { classId } = await makeClass();
    const { leadId } = await makeLead('Nguyễn Văn An', '0912000001');
    const early = await command('u-lan', 'reserveSeat', { leadId, expectedVersion: await leadVersion(leadId), classId });
    expect(early.status).toBe(422);
    expect(early.json.error?.code).toBe('VALIDATION_FAILED');
    const won = await winLead('Trần Thị Bình', '0912000002');
    const enrollmentId = await reserve(won.leadId, classId);
    const row = await db.prepare('SELECT status FROM enrollment WHERE id = ?').bind(enrollmentId).first<{ status: string }>();
    expect(row!.status).toBe('pending');
    expect(await studentCount(classId)).toBe(0);
  });

  test('confirmEnrollment needs enrollment consent, then counts the student and marks placed', async () => {
    const { classId } = await makeClass();
    const won = await winLead('Lê Văn Cường', '0912000003');
    const enrollmentId = await reserve(won.leadId, classId);
    const denied = await command('u-academic', 'confirmEnrollment', { enrollmentId, version: 1 });
    expect(denied.status).toBe(422);
    expect(denied.json.error?.message).toBe('Khách chưa đồng ý mục Quản lý ghi danh');
    expect((await grantConsent(won.contactId)).status).toBe(200);
    const confirmed = await command('u-academic', 'confirmEnrollment', { enrollmentId, version: 1 });
    expect(confirmed.status, JSON.stringify(confirmed.json)).toBe(200);
    expect(await studentCount(classId)).toBe(1);
    const placed = await db.prepare(`SELECT status FROM lead_step WHERE lead_id = ? AND step_code = 'placed'`).bind(won.leadId).first<{ status: string }>();
    expect(placed!.status).toBe('done');
    const listed = (await get('u-lan', '/learners')).json.data.items as { contactId: string; course: string }[];
    expect(listed.find((i) => i.contactId === won.contactId)?.course).toBe('IELTS 6.5');
  });

  test('two different students can both be confirmed in one class', async () => {
    const { classId } = await makeClass();
    for (const [name, phone] of [['Phạm D', '0912000004'], ['Hoàng E', '0912000005']] as const) {
      const won = await winLead(name, phone);
      const enrollmentId = await reserve(won.leadId, classId);
      expect((await grantConsent(won.contactId)).status).toBe(200);
      expect((await command('u-academic', 'confirmEnrollment', { enrollmentId, version: 1 })).status).toBe(200);
    }
    expect(await studentCount(classId)).toBe(2);
  });

  test('deferral needs a date, drops the student count, and resume restores both confirmed and studying', async () => {
    const { classId } = await makeClass();
    const won = await winLead('Vũ F', '0912000006');
    const enrollmentId = await reserve(won.leadId, classId);
    expect((await grantConsent(won.contactId)).status).toBe(200);
    expect((await command('u-academic', 'confirmEnrollment', { enrollmentId, version: 1 })).status).toBe(200);
    const missing = await command('u-academic', 'deferEnrollment', { enrollmentId, version: await enrollmentVersion(enrollmentId) });
    expect(missing.status).toBe(422);
    expect(missing.json.error?.code).toBe('VALIDATION_FAILED');
    const deferred = await command('u-academic', 'deferEnrollment', { enrollmentId, version: await enrollmentVersion(enrollmentId), until: '2099-01-15' });
    expect(deferred.status, JSON.stringify(deferred.json)).toBe(200);
    expect(await studentCount(classId)).toBe(0);
    const resumed = await command('u-academic', 'resumeEnrollment', { enrollmentId, version: await enrollmentVersion(enrollmentId) });
    expect(resumed.json.data.status).toBe('confirmed');
    expect(await studentCount(classId)).toBe(1);

    await db.prepare(`UPDATE enrollment SET status = 'studying' WHERE id = ?`).bind(enrollmentId).run();
    const again = await command('u-academic', 'deferEnrollment', { enrollmentId, version: await enrollmentVersion(enrollmentId), until: '2099-02-01' });
    expect(again.status, JSON.stringify(again.json)).toBe(200);
    const back = await command('u-academic', 'resumeEnrollment', { enrollmentId, version: await enrollmentVersion(enrollmentId) });
    expect(back.json.data.status).toBe('studying');
    const stored = await db.prepare('SELECT status, deferred_until, status_before_defer FROM enrollment WHERE id = ?').bind(enrollmentId)
      .first<{ status: string; deferred_until: string | null; status_before_defer: string | null }>();
    expect(stored).toEqual({ status: 'studying', deferred_until: null, status_before_defer: null });
  });

  test('transfer moves the seat and does not change money rows', async () => {
    const { courseId, classId } = await makeClass('Lớp A');
    const other = await command('u-academic', 'upsertClass', { courseId, name: 'Lớp B', status: 'open' });
    const toClassId = other.json.data.id as string;
    const won = await winLead('Đỗ G', '0912000007');
    const enrollmentId = await reserve(won.leadId, classId);
    expect((await grantConsent(won.contactId)).status).toBe(200);
    expect((await command('u-academic', 'confirmEnrollment', { enrollmentId, version: 1 })).status).toBe(200);
    const before = await moneyRows();
    const moved = await command('u-academic', 'transferEnrollment', { enrollmentId, version: await enrollmentVersion(enrollmentId), toClassId });
    expect(moved.status, JSON.stringify(moved.json)).toBe(200);
    const old = await db.prepare('SELECT status FROM enrollment WHERE id = ?').bind(enrollmentId).first<{ status: string }>();
    const created = await db.prepare('SELECT status, class_id FROM enrollment WHERE id = ?').bind(moved.json.data.id).first<{ status: string; class_id: string }>();
    expect(old!.status).toBe('transferred');
    expect(created).toEqual({ status: 'confirmed', class_id: toClassId });
    expect(await moneyRows()).toBe(before);
    expect(await studentCount(classId)).toBe(0);
    expect(await studentCount(toClassId)).toBe(1);
  });

  test('another sale cannot cancel a pending enrollment', async () => {
    const { classId } = await makeClass();
    const won = await winLead('Bùi H', '0912000008');
    const enrollmentId = await reserve(won.leadId, classId);
    const denied = await command('u-long', 'cancelPendingEnrollment', { enrollmentId, version: 1 });
    expect(denied.status).toBe(403);
    expect(denied.json.error?.code).toBe('FORBIDDEN');
    expect((await command('u-lan', 'cancelPendingEnrollment', { enrollmentId, version: 1 })).status).toBe(200);
  });

  test('bookTrial moves the lead to trial_booked', async () => {
    const { classId } = await makeClass();
    const sessionId = await makeTrial(classId);
    const { leadId } = await makeLead('Ngô I', '0912000009');
    await walk('u-lan', leadId, ['contacted', 'need_confirmed']);
    const booked = await command('u-lan', 'bookTrial', { leadId, expectedVersion: await leadVersion(leadId), sessionId });
    expect(booked.status, JSON.stringify(booked.json)).toBe(200);
    expect((await db.prepare('SELECT stage FROM lead WHERE id = ?').bind(leadId).first<{ stage: string }>())!.stage).toBe('trial_booked');
    expect(await count(`SELECT COUNT(*) AS n FROM trial_booking WHERE lead_id = ? AND status = 'booked'`, leadId)).toBe(1);
  });

  test('a teacher cannot open a class and a sale cannot confirm a seat', async () => {
    const { classId } = await makeClass();
    const teacher = await get('u-teacher', `/classes/${classId}`);
    expect(teacher.status).toBe(403);
    expect(teacher.json.error?.code).toBe('FORBIDDEN');
    const sale = await command('u-lan', 'confirmEnrollment', { enrollmentId: 'missing', version: 1 });
    expect(sale.status).toBe(403);
    expect(sale.json.error?.code).toBe('FORBIDDEN');
  });

  test('an overdue deferral is listed and a future one is not', async () => {
    const { classId } = await makeClass();
    const won = await winLead('Lý K', '0912000010');
    const enrollmentId = await reserve(won.leadId, classId);
    expect((await grantConsent(won.contactId)).status).toBe(200);
    expect((await command('u-academic', 'confirmEnrollment', { enrollmentId, version: 1 })).status).toBe(200);
    expect((await command('u-academic', 'deferEnrollment', { enrollmentId, version: 2, until: '2020-01-01' })).status).toBe(200);
    const overdue = (await get('u-academic', '/enrollments/overdue-deferrals')).json.data as { id: string }[];
    expect(overdue.map((r) => r.id)).toContain(enrollmentId);
    const later = await winLead('Mai L', '0912000011');
    const futureId = await reserve(later.leadId, classId);
    expect((await grantConsent(later.contactId)).status).toBe(200);
    expect((await command('u-academic', 'confirmEnrollment', { enrollmentId: futureId, version: 1 })).status).toBe(200);
    expect((await command('u-academic', 'deferEnrollment', { enrollmentId: futureId, version: 2, until: '2099-12-31' })).status).toBe(200);
    const again = (await get('u-academic', '/enrollments/overdue-deferrals')).json.data as { id: string }[];
    expect(again.map((r) => r.id)).toContain(enrollmentId);
    expect(again.map((r) => r.id)).not.toContain(futureId);
    expect((await get('u-lan', '/enrollments/overdue-deferrals')).status).toBe(403);
  });

  test('class teachers accept an admin and a teacher, and reject a sale', async () => {
    const { classId, classVersion } = await makeClass();
    const ok = await command('u-academic', 'setClassTeachers', { classId, version: classVersion, teacherUserIds: ['u-admin', 'u-teacher'] });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    const names = (await db.prepare('SELECT user_id FROM class_teacher WHERE class_id = ? ORDER BY user_id').bind(classId).all<{ user_id: string }>()).results.map((r) => r.user_id);
    expect(names).toEqual(['u-admin', 'u-teacher']);
    const denied = await command('u-academic', 'setClassTeachers', { classId, version: ok.json.data.version, teacherUserIds: ['u-lan'] });
    expect(denied.status).toBe(422);
    expect(denied.json.error?.code).toBe('VALIDATION_FAILED');
    expect(await count('SELECT COUNT(*) AS n FROM class_teacher WHERE class_id = ?', classId)).toBe(2);
  });

  test('a session start with a Vietnam offset is stored as UTC', async () => {
    const { classId } = await makeClass();
    const created = await command('u-academic', 'addSession', {
      classId, startsAt: '2026-10-10T19:00:00+07:00', durationMinutes: 90, kind: 'regular',
    });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    const id = created.json.data.id as string;
    const stored = async () => (await db.prepare('SELECT starts_at FROM class_session WHERE id = ?').bind(id).first<{ starts_at: string }>())!.starts_at;
    expect(await stored()).toBe('2026-10-10T12:00:00.000Z');
    const updated = await command('u-academic', 'updateSession', {
      sessionId: id, version: created.json.data.version as number, startsAt: '2026-10-11T19:30:00+07:00',
    });
    expect(updated.status, JSON.stringify(updated.json)).toBe(200);
    expect(await stored()).toBe('2026-10-11T12:30:00.000Z');
  });

  test('a lead keeps at most one live enrollment', async () => {
    const { courseId, classId } = await makeClass('Lớp A');
    const other = await command('u-academic', 'upsertClass', { courseId, name: 'Lớp B', status: 'open' });
    expect(other.status, JSON.stringify(other.json)).toBe(200);
    const won = await winLead('Đinh Minh', '0912000012');
    const enrollmentId = await reserve(won.leadId, classId);
    const again = await command('u-lan', 'reserveSeat', {
      leadId: won.leadId, expectedVersion: await leadVersion(won.leadId), classId: other.json.data.id,
    });
    expect(again.status).toBe(409);
    expect(again.json.error?.code).toBe('STALE_VERSION');
    expect(await count(`SELECT COUNT(*) AS n FROM enrollment WHERE lead_id = ? AND status IN ('pending','confirmed','studying','deferred')`, won.leadId)).toBe(1);
    expect((await command('u-lan', 'cancelPendingEnrollment', { enrollmentId, version: 1 })).status).toBe(200);
    const retried = await command('u-lan', 'reserveSeat', {
      leadId: won.leadId, expectedVersion: await leadVersion(won.leadId), classId: other.json.data.id,
    });
    expect(retried.status, JSON.stringify(retried.json)).toBe(200);
  });
});
