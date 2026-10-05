import { beforeEach, describe, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import {
  addUser, command, db, get, grantConsent, makeClass, makeLead, reserve, winLead,
} from './helpers/learner-fixtures';
import { resetDb } from './helpers/reset-db';

beforeEach(async () => {
  await resetDb(db, seedSql);
  await addUser('u-academic', 'academic');
  await addUser('u-teacher', 'teacher');
  await addUser('u-accountant', 'accountant');
});

async function confirmSeat(name: string, phone: string, classId: string) {
  const won = await winLead(name, phone);
  const enrollmentId = await reserve(won.leadId, classId);
  expect((await grantConsent(won.contactId)).status).toBe(200);
  const confirmed = await command('u-academic', 'confirmEnrollment', { enrollmentId, version: 1 });
  expect(confirmed.status, JSON.stringify(confirmed.json)).toBe(200);
  return { ...won, enrollmentId };
}

async function addRegular(classId: string, startsAt: string) {
  const created = await command('u-academic', 'addSession', { classId, startsAt, durationMinutes: 90, kind: 'regular' });
  expect(created.status, JSON.stringify(created.json)).toBe(200);
  return created.json.data.id as string;
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

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

describe('learner reports', () => {
  test('admin receives every report block', async () => {
    const report = await get('u-admin', '/reports/learner');
    expect(report.status, JSON.stringify(report.json)).toBe(200);
    for (const key of ['pipeline', 'classCounts', 'unmarkedToday', 'absenceStreaks', 'debtAging', 'cashByDay', 'teachingHours']) {
      expect(report.json.data[key], key).toBeDefined();
    }
    expect(report.json.data.debtAging).toHaveLength(4);
  });

  test('a teacher sees only their own attendance and hours', async () => {
    const report = await get('u-teacher', '/reports/learner');
    expect(report.status, JSON.stringify(report.json)).toBe(200);
    expect(report.json.data.classCounts).toBeUndefined();
    const keys = [...keysOf(report.json.data)];
    expect(keys.some((key) => key.includes('amount') || key.includes('cash'))).toBe(false);
  });

  test('academic counts do not name a company', async () => {
    const report = await get('u-academic', '/reports/learner');
    expect(report.status, JSON.stringify(report.json)).toBe(200);
    expect(report.json.data.byContract).toBeUndefined();
    expect(JSON.stringify(report.json)).not.toContain('Công ty TNHH Gốm Sứ Thanh Lam Demo');
  });

  test('a sale report has no debt', async () => {
    const report = await get('u-lan', '/reports/learner');
    expect(report.status, JSON.stringify(report.json)).toBe(200);
    expect(report.json.data.debtAging).toBeUndefined();
  });

  test('a head cannot open the learner report', async () => {
    expect((await get('u-head', '/reports/learner')).status).toBe(403);
  });

  test('two absences in a row are listed and a present mark breaks the streak', async () => {
    const { classId } = await makeClass();
    const absent = await confirmSeat('Nguyễn Vắng', '0913400001', classId);
    const present = await confirmSeat('Trần Có Mặt', '0913400002', classId);
    await db.prepare('UPDATE enrollment SET confirmed_at = ? WHERE id IN (?, ?)')
      .bind(daysAgo(4), absent.enrollmentId, present.enrollmentId).run();
    const session1 = await addRegular(classId, daysAgo(3));
    const session2 = await addRegular(classId, daysAgo(2));
    const first = await command('u-academic', 'markAttendance', {
      sessionId: session1,
      entries: [
        { enrollmentId: absent.enrollmentId, status: 'absent', version: null },
        { enrollmentId: present.enrollmentId, status: 'absent', version: null },
      ],
    });
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    const second = await command('u-academic', 'markAttendance', {
      sessionId: session2,
      entries: [
        { enrollmentId: absent.enrollmentId, status: 'absent', version: null },
        { enrollmentId: present.enrollmentId, status: 'present', version: null },
      ],
    });
    expect(second.status, JSON.stringify(second.json)).toBe(200);
    const report = await get('u-admin', '/reports/learner');
    expect(report.status, JSON.stringify(report.json)).toBe(200);
    const names = (report.json.data.absenceStreaks as { name: string }[]).map((row) => row.name);
    expect(names).toContain('Nguyễn Vắng');
    expect(names).not.toContain('Trần Có Mặt');
  });

  test('absence streaks keep a studying enrollment and drop a finished or withdrawn one', async () => {
    const { classId } = await makeClass();
    const studying = await confirmSeat('Hoàng Đang Học', '0913400005', classId);
    const finished = await confirmSeat('Lê Học Xong', '0913400006', classId);
    const left = await confirmSeat('Phạm Đã Nghỉ', '0913400007', classId);
    await db.prepare('UPDATE enrollment SET confirmed_at = ? WHERE id IN (?, ?, ?)')
      .bind(daysAgo(4), studying.enrollmentId, finished.enrollmentId, left.enrollmentId).run();
    const session1 = await addRegular(classId, daysAgo(3));
    const session2 = await addRegular(classId, daysAgo(2));
    for (const sessionId of [session1, session2]) {
      const marked = await command('u-academic', 'markAttendance', {
        sessionId,
        entries: [
          { enrollmentId: studying.enrollmentId, status: 'absent', version: null },
          { enrollmentId: finished.enrollmentId, status: 'absent', version: null },
          { enrollmentId: left.enrollmentId, status: 'absent', version: null },
        ],
      });
      expect(marked.status, JSON.stringify(marked.json)).toBe(200);
    }
    await db.prepare("UPDATE enrollment SET status = 'studying' WHERE id = ?").bind(studying.enrollmentId).run();
    await db.prepare("UPDATE enrollment SET status = 'completed' WHERE id = ?").bind(finished.enrollmentId).run();
    await db.prepare("UPDATE enrollment SET status = 'withdrawn' WHERE id = ?").bind(left.enrollmentId).run();
    const report = await get('u-admin', '/reports/learner');
    expect(report.status, JSON.stringify(report.json)).toBe(200);
    const names = (report.json.data.absenceStreaks as { name: string }[]).map((row) => row.name);
    expect(names).toContain('Hoàng Đang Học');
    expect(names).not.toContain('Lê Học Xong');
    expect(names).not.toContain('Phạm Đã Nghỉ');
  });

  test('a session today stays on the unmarked list until the roster is marked', async () => {
    const { classId } = await makeClass();
    const seat = await confirmSeat('Lê Hôm Nay', '0913400003', classId);
    const vnDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const startsAt = new Date(`${vnDay}T10:00:00+07:00`).toISOString();
    await db.prepare('UPDATE enrollment SET confirmed_at = ? WHERE id = ?')
      .bind(new Date(Date.parse(startsAt) - 3_600_000).toISOString(), seat.enrollmentId).run();
    const sessionId = await addRegular(classId, startsAt);
    const before = await get('u-admin', '/reports/learner');
    expect(before.status, JSON.stringify(before.json)).toBe(200);
    expect((before.json.data.unmarkedToday as { sessionId: string }[]).map((row) => row.sessionId)).toContain(sessionId);
    const marked = await command('u-academic', 'markAttendance', {
      sessionId, entries: [{ enrollmentId: seat.enrollmentId, status: 'present', version: null }],
    });
    expect(marked.status, JSON.stringify(marked.json)).toBe(200);
    const after = await get('u-admin', '/reports/learner');
    expect((after.json.data.unmarkedToday as { sessionId: string }[]).map((row) => row.sessionId)).not.toContain(sessionId);
  });

  test('a charge created 45 days ago sits in the 31-60 bucket', async () => {
    const { contactId } = await makeLead('Phạm Nợ', '0913400004');
    const created = await command('u-accountant', 'createCharge', { contactId, kind: 'deposit', amountVnd: 1_000_000 });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    await db.prepare('UPDATE charge SET created_at = ? WHERE id = ?')
      .bind(new Date(Date.now() - 45 * 86_400_000).toISOString(), created.json.data.id).run();
    const report = await get('u-admin', '/reports/learner');
    expect(report.status, JSON.stringify(report.json)).toBe(200);
    const bucket = (report.json.data.debtAging as { bucket: string; amountVnd: number }[]).find((row) => row.bucket === '31-60');
    expect(bucket?.amountVnd).toBe(1_000_000);
  });
});
