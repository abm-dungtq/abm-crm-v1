import { COUNTED_ENROLLMENT } from '@abm/contracts';
import { vietnamToday } from './academic-queries';
import { makeupRosterOn, regularRosterOn, trialRosterOn, unmarkedSql } from './attendance';
import type { Actor } from './env';
import { chargeBalanceSql } from './fees';
import { leadScope } from './scope';

const DAY_MS = 86_400_000;
const COUNTED_SQL = COUNTED_ENROLLMENT.map((status) => `'${status}'`).join(', ');
const HOURS_NOTE = 'Mỗi giáo viên được gán nhận đủ giờ của buổi. Đây không phải lương.';

const num = (value: unknown) => Number(value ?? 0);

/** Start of a Vietnam calendar day, as UTC ISO. Vietnam has no daylight saving. */
function vnDayStartUtc(day: string) {
  return new Date(`${day}T00:00:00+07:00`).toISOString();
}

function shiftVnDay(day: string, days: number) {
  return vietnamToday(new Date(Date.parse(`${day}T00:00:00+07:00`) + days * DAY_MS));
}

function vnMonthWindow(now: Date) {
  const today = vietnamToday(now);
  const [yearText, monthText] = today.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  return { from: vnDayStartUtc(`${today.slice(0, 8)}01`), until: vnDayStartUtc(next), now: now.toISOString() };
}

/** Vietnam calendar date of an ISO timestamp column. */
const vnDate = (column: string) => `substr(datetime(replace(substr(${column}, 1, 19), 'T', ' '), '+7 hours'), 1, 10)`;

async function pipeline(db: D1Database, actor: Actor) {
  const rows = await db.prepare(`SELECT stage, COUNT(*) AS count FROM lead
    WHERE organization_id = ? AND pipeline = 'learner' GROUP BY stage ORDER BY stage`)
    .bind(actor.organizationId).all<{ stage: string; count: number }>();
  return rows.results.map((row) => ({ stage: row.stage, count: num(row.count) }));
}

async function classCounts(db: D1Database, actor: Actor) {
  const rows = await db.prepare(`SELECT cg.id AS class_id, cg.name AS class_name, co.name AS course_name, COUNT(e.id) AS learners
    FROM class_group cg
    JOIN course co ON co.id = cg.course_id
    LEFT JOIN enrollment e ON e.class_id = cg.id AND e.status IN (${COUNTED_SQL})
    WHERE co.organization_id = ? AND cg.status = 'open'
    GROUP BY cg.id, cg.name, co.name
    ORDER BY co.name, cg.name, cg.id`).bind(actor.organizationId)
    .all<{ class_id: string; class_name: string; course_name: string; learners: number }>();
  return rows.results.map((row) => ({
    classId: row.class_id, className: row.class_name, courseName: row.course_name, learners: num(row.learners),
  }));
}

async function unmarkedToday(db: D1Database, actor: Actor, now: Date) {
  const today = vietnamToday(now);
  const rows = await db.prepare(`SELECT s.id AS session_id, s.starts_at, s.kind, cg.name AS class_name, co.name AS course_name
    FROM class_session s
    JOIN class_group cg ON cg.id = s.class_id
    JOIN course co ON co.id = cg.course_id
    WHERE co.organization_id = ?
      AND s.status = 'scheduled'
      AND s.starts_at >= ? AND s.starts_at < ?
      AND (
        (s.kind = 'regular' AND EXISTS (
          SELECT 1 FROM enrollment e
          WHERE ${regularRosterOn('s', 'e')} AND ${unmarkedSql('s', 'mark.enrollment_id = e.id')}
        ))
        OR (s.kind = 'trial' AND EXISTS (
          SELECT 1 FROM trial_booking tb
          WHERE ${trialRosterOn('s', 'tb')} AND ${unmarkedSql('s', 'mark.trial_booking_id = tb.id')}
        ))
        OR (s.kind = 'makeup' AND EXISTS (
          SELECT 1 FROM attendance src
          JOIN enrollment e ON e.id = src.enrollment_id
          WHERE ${makeupRosterOn('s', 'src')} AND ${unmarkedSql('s', 'mark.enrollment_id = e.id')}
        ))
      )
    ORDER BY s.starts_at, s.id`).bind(actor.organizationId, vnDayStartUtc(today), vnDayStartUtc(shiftVnDay(today, 1)))
    .all<{ session_id: string; starts_at: string; kind: string; class_name: string; course_name: string }>();
  return rows.results.map((row) => ({
    sessionId: row.session_id, startsAt: row.starts_at, kind: row.kind, className: row.class_name, courseName: row.course_name,
  }));
}

async function absenceStreaks(db: D1Database, actor: Actor) {
  const rows = await db.prepare(`WITH marked AS (
      SELECT a.enrollment_id, a.status,
        ROW_NUMBER() OVER (PARTITION BY a.enrollment_id ORDER BY s.starts_at DESC, s.id DESC) AS rn
      FROM attendance a
      JOIN class_session s ON s.id = a.session_id
      JOIN enrollment e ON e.id = a.enrollment_id
      JOIN class_group cg ON cg.id = e.class_id
      JOIN course co ON co.id = cg.course_id
      WHERE co.organization_id = ? AND s.kind = 'regular' AND a.status <> 'unmarked' AND a.enrollment_id IS NOT NULL
        AND e.status IN ('confirmed', 'studying')
    )
    SELECT e.id AS enrollment_id, c.display_name AS name, cg.name AS class_name
    FROM marked m1
    JOIN marked m2 ON m2.enrollment_id = m1.enrollment_id AND m2.rn = 2
    JOIN enrollment e ON e.id = m1.enrollment_id
    JOIN contact c ON c.id = e.contact_id
    JOIN class_group cg ON cg.id = e.class_id
    WHERE m1.rn = 1 AND m1.status = 'absent' AND m2.status = 'absent'
    ORDER BY c.display_name, e.id`).bind(actor.organizationId)
    .all<{ enrollment_id: string; name: string; class_name: string }>();
  return rows.results.map((row) => ({ enrollmentId: row.enrollment_id, name: row.name, className: row.class_name }));
}

async function debtAging(db: D1Database, actor: Actor) {
  const row = await db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN age <= 30 THEN remaining ELSE 0 END), 0) AS b0,
      COALESCE(SUM(CASE WHEN age BETWEEN 31 AND 60 THEN remaining ELSE 0 END), 0) AS b31,
      COALESCE(SUM(CASE WHEN age BETWEEN 61 AND 90 THEN remaining ELSE 0 END), 0) AS b61,
      COALESCE(SUM(CASE WHEN age >= 91 THEN remaining ELSE 0 END), 0) AS b91
    FROM (
      SELECT ${chargeBalanceSql} AS remaining,
        CAST((julianday('now') - julianday(replace(substr(c.created_at, 1, 19), 'T', ' '))) AS INTEGER) AS age
      FROM charge c
      WHERE c.organization_id = ? AND c.status = 'open'
    )`).bind(actor.organizationId).first<{ b0: number; b31: number; b61: number; b91: number }>();
  return [
    { bucket: '0-30', amountVnd: num(row?.b0) },
    { bucket: '31-60', amountVnd: num(row?.b31) },
    { bucket: '61-90', amountVnd: num(row?.b61) },
    { bucket: '90+', amountVnd: num(row?.b91) },
  ];
}

async function cashByDay(db: D1Database, actor: Actor, now: Date) {
  const today = vietnamToday(now);
  const rows = await db.prepare(`SELECT ${vnDate('p.received_at')} AS day,
      COALESCE(SUM(CASE WHEN p.direction = 'in' THEN p.amount_vnd WHEN p.direction = 'refund' THEN -p.amount_vnd ELSE 0 END), 0) AS amount_vnd
    FROM payment p
    WHERE p.organization_id = ? AND p.received_at >= ? AND p.received_at < ?
    GROUP BY day
    ORDER BY day`).bind(actor.organizationId, vnDayStartUtc(shiftVnDay(today, -29)), vnDayStartUtc(shiftVnDay(today, 1)))
    .all<{ day: string; amount_vnd: number }>();
  return rows.results.map((row) => ({ day: row.day, amountVnd: num(row.amount_vnd) }));
}

function hoursSql(teacherOnly: boolean) {
  return `SELECT ${teacherOnly ? '' : 'u.id AS teacher_id, u.display_name AS teacher_name,'}
      COALESCE(SUM(s.duration_minutes) * 1.0 / 60, 0) AS hours
    FROM class_session s
    JOIN class_group cg ON cg.id = s.class_id
    JOIN course co ON co.id = cg.course_id
    JOIN class_teacher ct ON ct.class_id = cg.id
    JOIN app_user u ON u.id = ct.user_id
    WHERE co.organization_id = ?
      AND s.status = 'scheduled'
      AND s.starts_at < ?
      AND s.starts_at >= ? AND s.starts_at < ?
      AND s.kind IN ('regular', 'makeup', 'trial')
      ${teacherOnly ? 'AND ct.user_id = ?' : ''}
    ${teacherOnly ? '' : 'GROUP BY u.id, u.display_name ORDER BY u.display_name, u.id'}`;
}

async function teachingHours(db: D1Database, actor: Actor, now: Date) {
  const window = vnMonthWindow(now);
  const rows = await db.prepare(hoursSql(false)).bind(actor.organizationId, window.now, window.from, window.until)
    .all<{ teacher_id: string; teacher_name: string; hours: number }>();
  return {
    note: HOURS_NOTE,
    rows: rows.results.map((row) => ({ teacherId: row.teacher_id, teacherName: row.teacher_name, hours: num(row.hours) })),
  };
}

async function myHours(db: D1Database, actor: Actor, now: Date) {
  const window = vnMonthWindow(now);
  const row = await db.prepare(hoursSql(true)).bind(actor.organizationId, window.now, window.from, window.until, actor.id)
    .first<{ hours: number }>();
  return { note: HOURS_NOTE, hours: num(row?.hours) };
}

async function myAttendance(db: D1Database, actor: Actor) {
  const rows = await db.prepare(`SELECT a.status, COUNT(*) AS count
    FROM attendance a
    JOIN class_session s ON s.id = a.session_id
    JOIN class_teacher ct ON ct.class_id = s.class_id AND ct.user_id = ?
    JOIN class_group cg ON cg.id = s.class_id
    JOIN course co ON co.id = cg.course_id
    WHERE co.organization_id = ?
    GROUP BY a.status
    ORDER BY a.status`).bind(actor.id, actor.organizationId).all<{ status: string; count: number }>();
  return rows.results.map((row) => ({ status: row.status, count: num(row.count) }));
}

/** Counts use the owner stored on the lead. A won learner lead keeps that owner when the person leaves. */
async function bySource(db: D1Database, actor: Actor, scoped: boolean) {
  const scope = scoped ? leadScope(actor) : { sql: '1 = 1', binds: [] as unknown[] };
  const rows = await db.prepare(`SELECT l.source AS source, COUNT(*) AS count
    FROM lead l
    WHERE l.organization_id = ? AND l.pipeline = 'learner' AND ${scope.sql}
    GROUP BY l.source
    ORDER BY l.source`).bind(actor.organizationId, ...scope.binds).all<{ source: string; count: number }>();
  return rows.results.map((row) => ({ source: row.source, count: num(row.count) }));
}

async function byContract(db: D1Database, actor: Actor) {
  const scope = leadScope(actor);
  const rows = await db.prepare(`SELECT pc.name AS contract_name, ac.name AS company_name, COUNT(*) AS count
    FROM lead l
    LEFT JOIN partner_contract pc ON pc.id = l.partner_contract_id
    LEFT JOIN account ac ON ac.id = pc.account_id
    WHERE l.organization_id = ? AND l.pipeline = 'learner' AND ${scope.sql}
    GROUP BY pc.id, pc.name, ac.id, ac.name
    ORDER BY count DESC, pc.name`).bind(actor.organizationId, ...scope.binds)
    .all<{ contract_name: string | null; company_name: string | null; count: number }>();
  return rows.results.map((row) => ({ contractName: row.contract_name, companyName: row.company_name, count: num(row.count) }));
}

/** Role-shaped learner report. Missing keys are blocks that role does not receive. */
export async function learnerReports(db: D1Database, actor: Actor) {
  const now = new Date();
  switch (actor.role) {
    case 'admin':
    case 'director': {
      const [pipelineRows, classes, unmarked, streaks, debt, cash, hours] = await Promise.all([
        pipeline(db, actor), classCounts(db, actor), unmarkedToday(db, actor, now), absenceStreaks(db, actor),
        debtAging(db, actor), cashByDay(db, actor, now), teachingHours(db, actor, now),
      ]);
      return { pipeline: pipelineRows, classCounts: classes, unmarkedToday: unmarked, absenceStreaks: streaks, debtAging: debt, cashByDay: cash, teachingHours: hours };
    }
    case 'sale':
    case 'leader': {
      const [sources, contracts] = await Promise.all([bySource(db, actor, true), byContract(db, actor)]);
      return { bySource: sources, byContract: contracts };
    }
    case 'academic': {
      const [classes, unmarked, streaks, sources] = await Promise.all([
        classCounts(db, actor), unmarkedToday(db, actor, now), absenceStreaks(db, actor), bySource(db, actor, false),
      ]);
      return { classCounts: classes, unmarkedToday: unmarked, absenceStreaks: streaks, bySource: sources };
    }
    case 'teacher': {
      const [attendance, hours] = await Promise.all([myAttendance(db, actor), myHours(db, actor, now)]);
      return { myAttendance: attendance, myHours: hours };
    }
    case 'accountant': {
      const [debt, cash] = await Promise.all([debtAging(db, actor), cashByDay(db, actor, now)]);
      return { debtAging: debt, cashByDay: cash };
    }
    default:
      return 'forbidden' as const;
  }
}
