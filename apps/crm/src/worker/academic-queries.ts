import { COUNTED_ENROLLMENT } from '@abm/contracts';
import type { Actor } from './env';

const MANAGE_ROLES = ['academic', 'admin', 'director'];
const OPEN_ROLES = ['sale', 'leader'];
const COUNTED_SQL = COUNTED_ENROLLMENT.map((s) => `'${s}'`).join(', ');

/** Calendar date in Vietnam, YYYY-MM-DD. A deferral is overdue only after this date. */
export function vietnamToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

interface CourseRow {
  id: string; name: string; status: string; version: number; product_id: string; product_name: string;
}
interface ClassListRow {
  id: string; course_id: string; name: string; schedule_text: string | null; note: string | null; status: string; version: number;
  student_count: number; session_count: number;
}
interface OpenClassRow {
  id: string; name: string; schedule_text: string | null; course_id: string; course_name: string;
  session_id: string | null; starts_at: string | null; duration_minutes: number | null;
}

/** Academic, Admin and BGĐ see every course. Sale and Leader see open classes they can reserve. */
export async function listCourses(db: D1Database, actor: Actor) {
  if (MANAGE_ROLES.includes(actor.role)) return { scope: 'manage' as const, courses: await manageCourses(db, actor) };
  if (OPEN_ROLES.includes(actor.role)) return { scope: 'open' as const, classes: await openClasses(db, actor) };
  return null;
}

async function manageCourses(db: D1Database, actor: Actor) {
  const courses = await db.prepare(`SELECT co.id, co.name, co.status, co.version, co.product_id, p.name AS product_name
    FROM course co JOIN product p ON p.id = co.product_id WHERE co.organization_id = ?
    ORDER BY co.status = 'active' DESC, co.name`).bind(actor.organizationId).all<CourseRow>();
  const classes = await db.prepare(`SELECT cg.id, cg.course_id, cg.name, cg.schedule_text, cg.note, cg.status, cg.version,
      (SELECT COUNT(*) FROM enrollment e WHERE e.class_id = cg.id AND e.status IN (${COUNTED_SQL})) AS student_count,
      (SELECT COUNT(*) FROM class_session s WHERE s.class_id = cg.id) AS session_count
    FROM class_group cg JOIN course co ON co.id = cg.course_id WHERE co.organization_id = ?
    ORDER BY cg.name`).bind(actor.organizationId).all<ClassListRow>();
  const trials = await db.prepare(`SELECT s.id, s.class_id, s.starts_at, s.duration_minutes
    FROM class_session s JOIN class_group cg ON cg.id = s.class_id JOIN course co ON co.id = cg.course_id
    WHERE co.organization_id = ? AND s.kind = 'trial' AND s.status = 'scheduled'
    ORDER BY s.starts_at`).bind(actor.organizationId)
    .all<{ id: string; class_id: string; starts_at: string; duration_minutes: number }>();
  return courses.results.map((co) => ({
    id: co.id, name: co.name, status: co.status, version: co.version, productId: co.product_id, productName: co.product_name,
    classes: classes.results.filter((cg) => cg.course_id === co.id).map((cg) => ({
      id: cg.id, name: cg.name, scheduleText: cg.schedule_text, note: cg.note, status: cg.status, version: cg.version,
      studentCount: cg.student_count, sessionCount: cg.session_count,
      trialSessions: trials.results.filter((s) => s.class_id === cg.id).map((s) => ({ id: s.id, startsAt: s.starts_at, durationMinutes: s.duration_minutes })),
    })),
  }));
}

async function openClasses(db: D1Database, actor: Actor) {
  const rows = await db.prepare(`SELECT cg.id, cg.name, cg.schedule_text, co.id AS course_id, co.name AS course_name,
      s.id AS session_id, s.starts_at, s.duration_minutes
    FROM class_group cg JOIN course co ON co.id = cg.course_id
    LEFT JOIN class_session s ON s.class_id = cg.id AND s.kind = 'trial' AND s.status = 'scheduled'
    WHERE co.organization_id = ? AND cg.status = 'open'
    ORDER BY co.name, cg.name, s.starts_at`).bind(actor.organizationId).all<OpenClassRow>();
  const classes = new Map<string, { id: string; name: string; scheduleText: string | null; courseId: string; courseName: string; trialSessions: { id: string; startsAt: string; durationMinutes: number }[] }>();
  for (const row of rows.results) {
    const item = classes.get(row.id) ?? { id: row.id, name: row.name, scheduleText: row.schedule_text, courseId: row.course_id, courseName: row.course_name, trialSessions: [] };
    if (row.session_id && row.starts_at && row.duration_minutes) item.trialSessions.push({ id: row.session_id, startsAt: row.starts_at, durationMinutes: row.duration_minutes });
    classes.set(row.id, item);
  }
  return [...classes.values()];
}

/** Class screen for academic, admin and director, matching the course list. Teachers get their own screen in a later phase. */
export async function classDetail(db: D1Database, actor: Actor, classId: string) {
  if (!MANAGE_ROLES.includes(actor.role)) return 'forbidden' as const;
  const klass = await db.prepare(`SELECT cg.id, cg.name, cg.schedule_text, cg.note, cg.status, cg.version, co.id AS course_id, co.name AS course_name, p.name AS product_name
    FROM class_group cg JOIN course co ON co.id = cg.course_id JOIN product p ON p.id = co.product_id
    WHERE cg.id = ? AND co.organization_id = ?`).bind(classId, actor.organizationId)
    .first<{ id: string; name: string; schedule_text: string | null; note: string | null; status: string; version: number; course_id: string; course_name: string; product_name: string }>();
  if (!klass) return null;
  const [teachers, candidates, sessions, enrollments, trials, targets, absences] = await Promise.all([
    db.prepare(`SELECT u.id, u.display_name AS name, u.role FROM class_teacher ct JOIN app_user u ON u.id = ct.user_id
      WHERE ct.class_id = ? ORDER BY u.display_name`).bind(classId).all<{ id: string; name: string; role: string }>(),
    db.prepare(`SELECT id, display_name AS name, role FROM app_user
      WHERE organization_id = ? AND status = 'active' AND role IN ('teacher', 'admin') ORDER BY role, display_name`)
      .bind(actor.organizationId).all<{ id: string; name: string; role: string }>(),
    db.prepare(`SELECT id, starts_at, duration_minutes, kind, status, note, version FROM class_session WHERE class_id = ? ORDER BY starts_at, id`)
      .bind(classId).all<{ id: string; starts_at: string; duration_minutes: number; kind: string; status: string; note: string | null; version: number }>(),
    db.prepare(`SELECT e.id, e.status, e.version, e.deferred_until, e.status_before_defer, e.lead_id, c.display_name AS contact_name, l.code AS lead_code
      FROM enrollment e JOIN contact c ON c.id = e.contact_id JOIN lead l ON l.id = e.lead_id
      WHERE e.class_id = ? ORDER BY e.created_at, e.id`).bind(classId)
      .all<{ id: string; status: string; version: number; deferred_until: string | null; status_before_defer: string | null; lead_id: string; contact_name: string; lead_code: string }>(),
    db.prepare(`SELECT tb.id, tb.status, tb.session_id, l.code AS lead_code, c.display_name AS contact_name
      FROM trial_booking tb JOIN lead l ON l.id = tb.lead_id JOIN contact c ON c.id = l.contact_id JOIN class_session s ON s.id = tb.session_id
      WHERE s.class_id = ? ORDER BY tb.created_at`).bind(classId)
      .all<{ id: string; status: string; session_id: string; lead_code: string; contact_name: string }>(),
    db.prepare(`SELECT cg.id, cg.name, co.name AS course_name FROM class_group cg JOIN course co ON co.id = cg.course_id
      WHERE co.organization_id = ? AND cg.status = 'open' AND cg.id <> ? ORDER BY co.name, cg.name`)
      .bind(actor.organizationId, classId).all<{ id: string; name: string; course_name: string }>(),
    db.prepare(`SELECT a.id AS attendance_id, a.enrollment_id, a.session_id, a.status, s.starts_at,
        (SELECT ms.id FROM class_session ms WHERE ms.makeup_for_attendance_id = a.id AND ms.status = 'scheduled'
          ORDER BY ms.starts_at, ms.id LIMIT 1) AS makeup_session_id
      FROM attendance a JOIN class_session s ON s.id = a.session_id
      WHERE s.class_id = ? AND a.enrollment_id IS NOT NULL AND a.status IN ('absent', 'excused')
      ORDER BY s.starts_at, a.id`).bind(classId)
      .all<{ attendance_id: string; enrollment_id: string; session_id: string; status: string; starts_at: string; makeup_session_id: string | null }>(),
  ]);
  return {
    class: {
      id: klass.id, name: klass.name, scheduleText: klass.schedule_text, note: klass.note, status: klass.status, version: klass.version,
      courseId: klass.course_id, courseName: klass.course_name, productName: klass.product_name,
    },
    teachers: teachers.results,
    teacherCandidates: candidates.results,
    sessions: sessions.results.map((s) => ({
      id: s.id, startsAt: s.starts_at, durationMinutes: s.duration_minutes, kind: s.kind, status: s.status, note: s.note, version: s.version,
    })),
    enrollments: enrollments.results.map((e) => ({
      id: e.id, status: e.status, version: e.version, deferredUntil: e.deferred_until, statusBeforeDefer: e.status_before_defer,
      leadId: e.lead_id, contactName: e.contact_name, leadCode: e.lead_code,
    })),
    trials: trials.results.map((t) => ({ id: t.id, status: t.status, sessionId: t.session_id, leadCode: t.lead_code, contactName: t.contact_name })),
    transferTargets: targets.results.map((t) => ({ id: t.id, name: t.name, courseName: t.course_name })),
    absences: absences.results.map((a) => ({
      attendanceId: a.attendance_id, enrollmentId: a.enrollment_id, sessionId: a.session_id, status: a.status, startsAt: a.starts_at,
      makeupSessionId: a.makeup_session_id,
    })),
  };
}

export async function overdueDeferrals(db: D1Database, actor: Actor, today = vietnamToday()) {
  if (actor.role !== 'academic' && actor.role !== 'admin') return null;
  const rows = await db.prepare(`SELECT e.id, e.deferred_until, e.contact_id, c.display_name AS contact_name, cg.id AS class_id, cg.name AS class_name, co.name AS course_name
    FROM enrollment e JOIN contact c ON c.id = e.contact_id JOIN class_group cg ON cg.id = e.class_id JOIN course co ON co.id = cg.course_id
    WHERE e.status = 'deferred' AND e.deferred_until < ? AND co.organization_id = ?
    ORDER BY e.deferred_until, c.display_name`).bind(today, actor.organizationId)
    .all<{ id: string; deferred_until: string; contact_id: string; contact_name: string; class_id: string; class_name: string; course_name: string }>();
  return rows.results.map((r) => ({
    id: r.id, deferredUntil: r.deferred_until, contactId: r.contact_id, contactName: r.contact_name,
    classId: r.class_id, className: r.class_name, courseName: r.course_name,
  }));
}
