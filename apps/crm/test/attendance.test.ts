import { beforeEach, describe, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import {
  addUser, command, db, get, grantConsent, leadVersion, makeClass, makeLead, reserve, walk, winLead,
} from './helpers/learner-fixtures';
import { resetDb } from './helpers/reset-db';

beforeEach(async () => {
  await resetDb(db, seedSql);
  await addUser('u-academic', 'academic');
  await addUser('u-teacher', 'teacher');
});

async function confirmSeat(name: string, phone: string, classId: string) {
  const won = await winLead(name, phone);
  const enrollmentId = await reserve(won.leadId, classId);
  expect((await grantConsent(won.contactId)).status).toBe(200);
  const confirmed = await command('u-academic', 'confirmEnrollment', { enrollmentId, version: 1 });
  expect(confirmed.status, JSON.stringify(confirmed.json)).toBe(200);
  return { ...won, enrollmentId };
}

async function addRegular(classId: string, startsAt = new Date(Date.now() + 86_400_000).toISOString()) {
  const created = await command('u-academic', 'addSession', { classId, startsAt, durationMinutes: 90, kind: 'regular' });
  expect(created.status, JSON.stringify(created.json)).toBe(200);
  return created.json.data.id as string;
}

async function assignTeacher(classId: string, version: number) {
  const assigned = await command('u-academic', 'setClassTeachers', { classId, version, teacherUserIds: ['u-teacher'] });
  expect(assigned.status, JSON.stringify(assigned.json)).toBe(200);
}

function keysOf(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, found);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      found.add(key);
      keysOf(item, found);
    }
  }
  return found;
}

describe('teacher attendance', () => {
  test('a new session roster lists a confirmed student as unmarked and omits pending and deferred', async () => {
    const { classId } = await makeClass();
    const confirmed = await confirmSeat('Nguyễn An', '0913100001', classId);
    const pending = await winLead('Trần Bình', '0913100002');
    const pendingId = await reserve(pending.leadId, classId);
    const deferred = await confirmSeat('Lê Cường', '0913100003', classId);
    const deferredMark = await command('u-academic', 'deferEnrollment', { enrollmentId: deferred.enrollmentId, version: 2, until: '2099-01-15' });
    expect(deferredMark.status, JSON.stringify(deferredMark.json)).toBe(200);
    const sessionId = await addRegular(classId);
    const body = await get('u-academic', `/sessions/${sessionId}/attendance`);
    expect(body.status, JSON.stringify(body.json)).toBe(200);
    const roster = body.json.data.roster as { enrollmentId?: string; status: string; name: string }[];
    expect(roster).toEqual([{ enrollmentId: confirmed.enrollmentId, name: 'Nguyễn An', status: 'unmarked', attendanceId: null, version: null }]);
    expect(roster.map((row) => row.enrollmentId)).not.toContain(pendingId);
    expect(roster.map((row) => row.enrollmentId)).not.toContain(deferred.enrollmentId);
  });

  test('an unassigned teacher cannot mark attendance and an assigned teacher can', async () => {
    const { classId, classVersion } = await makeClass();
    const seat = await confirmSeat('Phạm Dũng', '0913100004', classId);
    const sessionId = await addRegular(classId);
    const denied = await command('u-teacher', 'markAttendance', { sessionId, entries: [{ enrollmentId: seat.enrollmentId, status: 'present', version: null }] });
    expect(denied.status).toBe(403);
    expect(denied.json.error?.code).toBe('FORBIDDEN');
    await assignTeacher(classId, classVersion);
    const marked = await command('u-teacher', 'markAttendance', { sessionId, entries: [{ enrollmentId: seat.enrollmentId, status: 'present', version: null }] });
    expect(marked.status, JSON.stringify(marked.json)).toBe(200);
  });

  test('the first late mark moves the enrollment to studying and completes the started step', async () => {
    const { classId, classVersion } = await makeClass();
    const seat = await confirmSeat('Hoàng Em', '0913100005', classId);
    const sessionId = await addRegular(classId);
    await assignTeacher(classId, classVersion);
    const marked = await command('u-teacher', 'markAttendance', { sessionId, entries: [{ enrollmentId: seat.enrollmentId, status: 'late', version: null }] });
    expect(marked.status, JSON.stringify(marked.json)).toBe(200);
    const enrollment = await db.prepare('SELECT status FROM enrollment WHERE id = ?').bind(seat.enrollmentId).first<{ status: string }>();
    expect(enrollment!.status).toBe('studying');
    const step = await db.prepare(`SELECT status FROM lead_step WHERE lead_id = ? AND step_code = 'started'`).bind(seat.leadId).first<{ status: string }>();
    expect(step!.status).toBe('done');
  });

  test('an absence can spawn a makeup session that keeps the original absence and lists only that student', async () => {
    const { classId, classVersion } = await makeClass();
    const absentSeat = await confirmSeat('Đỗ Giang', '0913100006', classId);
    const other = await confirmSeat('Bùi Hà', '0913100007', classId);
    const sessionId = await addRegular(classId);
    await assignTeacher(classId, classVersion);
    const marked = await command('u-teacher', 'markAttendance', {
      sessionId,
      entries: [
        { enrollmentId: absentSeat.enrollmentId, status: 'absent', version: null },
        { enrollmentId: other.enrollmentId, status: 'present', version: null },
      ],
    });
    expect(marked.status, JSON.stringify(marked.json)).toBe(200);
    const attendanceId = (marked.json.data.entries as { attendanceId: string; enrollmentId: string }[])
      .find((entry) => entry.enrollmentId === absentSeat.enrollmentId)?.attendanceId;
    expect(attendanceId).toBeTruthy();
    const detail = await get('u-academic', `/classes/${classId}`);
    expect(detail.status, JSON.stringify(detail.json)).toBe(200);
    const absences = detail.json.data.absences as { attendanceId: string; enrollmentId: string; status: string }[];
    expect(absences).toEqual([expect.objectContaining({ attendanceId, enrollmentId: absentSeat.enrollmentId, status: 'absent' })]);
    const created = await command('u-academic', 'createMakeupSession', {
      attendanceId, startsAt: '2026-10-20T19:00:00+07:00', durationMinutes: 60,
    });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    const stored = await db.prepare('SELECT kind, makeup_for_attendance_id, starts_at FROM class_session WHERE id = ?')
      .bind(created.json.data.id).first<{ kind: string; makeup_for_attendance_id: string; starts_at: string }>();
    expect(stored).toEqual({ kind: 'makeup', makeup_for_attendance_id: attendanceId, starts_at: '2026-10-20T12:00:00.000Z' });
    const original = await db.prepare('SELECT status FROM attendance WHERE id = ?').bind(attendanceId).first<{ status: string }>();
    expect(original!.status).toBe('absent');
    const roster = (await get('u-teacher', `/sessions/${created.json.data.id}/attendance`)).json.data.roster as { enrollmentId?: string }[];
    expect(roster.map((row) => row.enrollmentId)).toEqual([absentSeat.enrollmentId]);
  });

  test('a present trial mark moves the lead to trial_done and completes the trial step', async () => {
    const { classId, classVersion } = await makeClass();
    const session = await command('u-academic', 'addSession', {
      classId, startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 90, kind: 'trial',
    });
    expect(session.status, JSON.stringify(session.json)).toBe(200);
    const { leadId } = await makeLead('Ngô Ích', '0913100008');
    await walk('u-lan', leadId, ['contacted', 'need_confirmed']);
    const booked = await command('u-lan', 'bookTrial', { leadId, expectedVersion: await leadVersion(leadId), sessionId: session.json.data.id });
    expect(booked.status, JSON.stringify(booked.json)).toBe(200);
    await assignTeacher(classId, classVersion);
    const marked = await command('u-teacher', 'markAttendance', {
      sessionId: session.json.data.id, entries: [{ trialBookingId: booked.json.data.id, status: 'present', version: null }],
    });
    expect(marked.status, JSON.stringify(marked.json)).toBe(200);
    const lead = await db.prepare('SELECT stage FROM lead WHERE id = ?').bind(leadId).first<{ stage: string }>();
    expect(lead!.stage).toBe('trial_done');
    const step = await db.prepare(`SELECT status FROM lead_step WHERE lead_id = ? AND step_code = 'trial'`).bind(leadId).first<{ status: string }>();
    expect(step!.status).toBe('done');
  });

  test('a teacher attendance response has no phone and no amount', async () => {
    const { classId, classVersion } = await makeClass();
    const seat = await confirmSeat('Lý Khoa', '0913100009', classId);
    const sessionId = await addRegular(classId);
    await assignTeacher(classId, classVersion);
    const body = await get('u-teacher', `/sessions/${sessionId}/attendance`);
    expect(body.status, JSON.stringify(body.json)).toBe(200);
    const keys = [...keysOf(body.json)];
    expect(keys).not.toContain('phone');
    expect(keys.some((key) => key.toLowerCase().includes('amount'))).toBe(false);
    expect((body.json.data.roster as { enrollmentId: string; name: string }[]).map((row) => row.enrollmentId)).toContain(seat.enrollmentId);
  });

  test('a teacher cannot open class detail and only sees assigned classes, and a deferred enrollment stays off the regular roster', async () => {
    const { courseId, classId, classVersion } = await makeClass('Lớp A');
    const other = await command('u-academic', 'upsertClass', { courseId, name: 'Lớp B', status: 'open' });
    expect(other.status, JSON.stringify(other.json)).toBe(200);
    await assignTeacher(classId, classVersion);
    const detail = await get('u-teacher', `/classes/${classId}`);
    expect(detail.status).toBe(403);
    expect(detail.json.error?.code).toBe('FORBIDDEN');
    const mine = await get('u-teacher', '/my-classes');
    expect(mine.status, JSON.stringify(mine.json)).toBe(200);
    expect((mine.json.data.classes as { id: string }[]).map((row) => row.id)).toEqual([classId]);
    const all = await get('u-academic', '/my-classes');
    expect(all.status, JSON.stringify(all.json)).toBe(200);
    expect((all.json.data.classes as { id: string }[]).map((row) => row.id).sort()).toEqual([classId, other.json.data.id].sort());
    const deferred = await confirmSeat('Mai Lan', '0913100010', classId);
    const deferredMark = await command('u-academic', 'deferEnrollment', { enrollmentId: deferred.enrollmentId, version: 2, until: '2099-06-01' });
    expect(deferredMark.status, JSON.stringify(deferredMark.json)).toBe(200);
    const sessionId = await addRegular(classId);
    const roster = (await get('u-teacher', `/sessions/${sessionId}/attendance`)).json.data.roster as { enrollmentId?: string }[];
    expect(roster.map((row) => row.enrollmentId)).not.toContain(deferred.enrollmentId);
  });

  test('two first marks on a new session leave one saved and one stale', async () => {
    const { classId, classVersion } = await makeClass();
    const seat = await confirmSeat('Tô Nga', '0913100011', classId);
    const sessionId = await addRegular(classId);
    await assignTeacher(classId, classVersion);
    const body = { sessionId, entries: [{ enrollmentId: seat.enrollmentId, status: 'present', version: null }] };
    const [left, right] = await Promise.all([
      command('u-teacher', 'markAttendance', body),
      command('u-academic', 'markAttendance', body),
    ]);
    const statuses = [left.status, right.status].sort((a, b) => a - b);
    expect(statuses, JSON.stringify([left.json, right.json])).toEqual([200, 409]);
    const failed = [left, right].find((result) => result.status === 409);
    expect(failed?.json.error?.code).toBe('STALE_VERSION');
    const saved = await db.prepare('SELECT COUNT(*) AS n FROM attendance WHERE session_id = ?').bind(sessionId).first<{ n: number }>();
    expect(saved!.n).toBe(1);
  });

  test('a second makeup for the same absence is rejected', async () => {
    const { classId, classVersion } = await makeClass();
    const seat = await confirmSeat('Vũ Oanh', '0913100012', classId);
    const sessionId = await addRegular(classId);
    await assignTeacher(classId, classVersion);
    const marked = await command('u-teacher', 'markAttendance', {
      sessionId, entries: [{ enrollmentId: seat.enrollmentId, status: 'absent', version: null }],
    });
    expect(marked.status, JSON.stringify(marked.json)).toBe(200);
    const attendanceId = (marked.json.data.entries as { attendanceId: string }[])[0]?.attendanceId;
    expect(attendanceId).toEqual(expect.any(String));
    if (!attendanceId) return;
    const first = await command('u-academic', 'createMakeupSession', {
      attendanceId, startsAt: '2026-10-21T19:00:00+07:00', durationMinutes: 60,
    });
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    const detail = await get('u-academic', `/classes/${classId}`);
    const absences = detail.json.data.absences as { attendanceId: string; makeupSessionId: string | null }[];
    expect(absences).toEqual([expect.objectContaining({ attendanceId, makeupSessionId: first.json.data.id })]);
    const second = await command('u-academic', 'createMakeupSession', {
      attendanceId, startsAt: '2026-10-22T19:00:00+07:00', durationMinutes: 60,
    });
    expect(second.status).toBe(422);
    expect(second.json.error?.code).toBe('VALIDATION_FAILED');
    const count = await db.prepare(`SELECT COUNT(*) AS n FROM class_session WHERE makeup_for_attendance_id = ?`).bind(attendanceId).first<{ n: number }>();
    expect(count!.n).toBe(1);
  });

  test('an admin assigned to one class sees that class as assigned', async () => {
    const { courseId, classId, classVersion } = await makeClass('Lớp được gán');
    const other = await command('u-academic', 'upsertClass', { courseId, name: 'Lớp chưa gán', status: 'open' });
    expect(other.status, JSON.stringify(other.json)).toBe(200);
    const assigned = await command('u-academic', 'setClassTeachers', { classId, version: classVersion, teacherUserIds: ['u-admin'] });
    expect(assigned.status, JSON.stringify(assigned.json)).toBe(200);
    const body = await get('u-admin', '/my-classes');
    expect(body.status, JSON.stringify(body.json)).toBe(200);
    const classes = body.json.data.classes as { id: string; assigned: boolean }[];
    expect(classes.find((row) => row.id === classId)?.assigned).toBe(true);
    expect(classes.find((row) => row.id === other.json.data.id)?.assigned).toBe(false);
  });

  test('a present mark on a skipped trial leaves the lead stage unchanged', async () => {
    const { classId, classVersion } = await makeClass();
    const session = await command('u-academic', 'addSession', {
      classId, startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 90, kind: 'trial',
    });
    expect(session.status, JSON.stringify(session.json)).toBe(200);
    const { leadId } = await makeLead('Đinh Phúc', '0913100013');
    await walk('u-lan', leadId, ['contacted', 'need_confirmed']);
    const booked = await command('u-lan', 'bookTrial', { leadId, expectedVersion: await leadVersion(leadId), sessionId: session.json.data.id });
    expect(booked.status, JSON.stringify(booked.json)).toBe(200);
    const skipped = await command('u-lan', 'skipTrial', { leadId, expectedVersion: await leadVersion(leadId), reason: 'Khách đã học thử nơi khác' });
    expect(skipped.status, JSON.stringify(skipped.json)).toBe(200);
    await assignTeacher(classId, classVersion);
    const marked = await command('u-teacher', 'markAttendance', {
      sessionId: session.json.data.id, entries: [{ trialBookingId: booked.json.data.id, status: 'present', version: null }],
    });
    expect(marked.status, JSON.stringify(marked.json)).toBe(200);
    const lead = await db.prepare('SELECT stage FROM lead WHERE id = ?').bind(leadId).first<{ stage: string }>();
    expect(lead!.stage).toBe('trial_booked');
    const step = await db.prepare(`SELECT status FROM lead_step WHERE lead_id = ? AND step_code = 'trial'`).bind(leadId).first<{ status: string }>();
    expect(step!.status).toBe('skipped');
  });

  test('marking a row that already exists updates that row', async () => {
    const { classId, classVersion } = await makeClass();
    const seat = await confirmSeat('Phan Mạnh', '0913100014', classId);
    const sessionId = await addRegular(classId);
    await assignTeacher(classId, classVersion);
    const first = await command('u-teacher', 'markAttendance', {
      sessionId, entries: [{ enrollmentId: seat.enrollmentId, status: 'present', version: null }],
    });
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    const entry = (first.json.data.entries as { attendanceId: string; version: number }[])[0];
    expect(entry).toBeTruthy();
    if (!entry) return;
    const again = await command('u-teacher', 'markAttendance', {
      sessionId, entries: [{ enrollmentId: seat.enrollmentId, status: 'absent', version: entry.version }],
    });
    expect(again.status, JSON.stringify(again.json)).toBe(200);
    const stored = await db.prepare('SELECT id, status, version FROM attendance WHERE session_id = ? AND enrollment_id = ?')
      .bind(sessionId, seat.enrollmentId).all<{ id: string; status: string; version: number }>();
    expect(stored.results).toEqual([{ id: entry.attendanceId, status: 'absent', version: entry.version + 1 }]);
  });
});
