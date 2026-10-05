import { stageLabel, type CreateMakeupSessionInput, type MarkAttendanceInput } from '@abm/contracts';
import { ENROLLMENT_FROM } from './academic-commands';
import { fail, isoUtc, ok, type ApiFail, type Ctx } from './command-result';
import type { Actor } from './env';
import type { GuardedTx } from './guarded-tx';
import { markStepDone } from './learner-commands';

const TEACH_ROLES = ['teacher', 'academic', 'admin'];

interface SessionRow {
  id: string;
  class_id: string;
  class_name: string;
  class_status: string;
  course_name: string;
  starts_at: string;
  duration_minutes: number;
  kind: 'regular' | 'trial' | 'makeup';
  status: string;
  note: string | null;
  makeup_for_attendance_id: string | null;
}

export interface RosterItem {
  enrollmentId?: string;
  trialBookingId?: string;
  name: string;
  status: string;
  attendanceId: string | null;
  version: number | null;
}

interface MarkRow {
  attendance_id: string | null;
  attendance_status: string | null;
  attendance_version: number | null;
}

/** Admin and academic can mark any class. A teacher can mark only an active assignment. */
export async function canTeach(db: D1Database, actor: Actor, classId: string) {
  if (actor.role === 'admin' || actor.role === 'academic') return true;
  if (actor.role !== 'teacher') return false;
  const row = await db.prepare(`SELECT 1 AS ok FROM class_teacher ct
    JOIN app_user u ON u.id = ct.user_id
    WHERE ct.class_id = ? AND ct.user_id = ? AND u.status = 'active'`).bind(classId, actor.id).first();
  return Boolean(row);
}

async function loadSession(db: D1Database, organizationId: string, sessionId: string) {
  return db.prepare(`SELECT s.id, s.class_id, cg.name AS class_name, cg.status AS class_status, co.name AS course_name,
      s.starts_at, s.duration_minutes, s.kind, s.status, s.note, s.makeup_for_attendance_id
    FROM class_session s
    JOIN class_group cg ON cg.id = s.class_id
    JOIN course co ON co.id = cg.course_id
    WHERE s.id = ? AND co.organization_id = ?`).bind(sessionId, organizationId).first<SessionRow>();
}

const blank = (value: string | undefined) => value?.trim() || null;

function marked(row: MarkRow): Pick<RosterItem, 'status' | 'attendanceId' | 'version'> {
  return {
    status: row.attendance_status ?? 'unmarked',
    attendanceId: row.attendance_id,
    version: row.attendance_version,
  };
}

/** Regular roster of session `s` against enrollment `e`. Both aliases must already be in scope. */
export function regularRosterOn(session: string, enrollment: string) {
  return `${enrollment}.class_id = ${session}.class_id
    AND COALESCE(${enrollment}.confirmed_at, ${enrollment}.created_at) <= ${session}.starts_at
    AND (
      ${enrollment}.status IN ('confirmed', 'studying')
      OR (${enrollment}.status IN ('completed', 'transferred', 'withdrawn') AND ${enrollment}.ended_at > ${session}.starts_at)
    )`;
}

/** Trial roster of session `s` against booking `booking`. */
export function trialRosterOn(session: string, booking: string) {
  return `${booking}.session_id = ${session}.id AND ${booking}.status IN ('booked', 'done')`;
}

/** Makeup roster: the one enrollment behind the absence this session replaces. */
export function makeupRosterOn(session: string, source: string) {
  return `${source}.id = ${session}.makeup_for_attendance_id AND ${source}.enrollment_id IS NOT NULL`;
}

/** True when this learner has no attendance row, or the saved row is still unmarked. */
export function unmarkedSql(session: string, match: string) {
  return `NOT EXISTS (
    SELECT 1 FROM attendance mark
    WHERE mark.session_id = ${session}.id AND ${match} AND mark.status <> 'unmarked'
  )`;
}

/**
 * Who can be marked on this session.
 * Regular: confirmed or studying seats, plus seats that ended after the session started.
 * A learner who joined later is absent from earlier sessions. Both timestamps are ISO UTC.
 * Trial: bookings that are still booked or already done.
 * Makeup: only the enrollment of the original absence.
 */
export async function sessionRoster(db: D1Database, sessionId: string): Promise<RosterItem[]> {
  const session = await db.prepare('SELECT id, kind, makeup_for_attendance_id FROM class_session WHERE id = ?')
    .bind(sessionId).first<{ id: string; kind: string; makeup_for_attendance_id: string | null }>();
  if (!session) return [];
  if (session.kind === 'trial') return trialRoster(db, session.id);
  if (session.kind === 'makeup') return session.makeup_for_attendance_id ? makeupRoster(db, session.id) : [];
  return regularRoster(db, session.id);
}

async function regularRoster(db: D1Database, sessionId: string) {
  const rows = await db.prepare(`SELECT e.id AS enrollment_id, c.display_name AS name,
      a.id AS attendance_id, a.status AS attendance_status, a.version AS attendance_version
    FROM class_session s
    JOIN enrollment e ON ${regularRosterOn('s', 'e')}
    JOIN contact c ON c.id = e.contact_id
    LEFT JOIN attendance a ON a.session_id = s.id AND a.enrollment_id = e.id
    WHERE s.id = ?
    ORDER BY c.display_name, e.id`).bind(sessionId)
    .all<MarkRow & { enrollment_id: string; name: string }>();
  return rows.results.map((row) => ({ enrollmentId: row.enrollment_id, name: row.name, ...marked(row) }));
}

async function trialRoster(db: D1Database, sessionId: string) {
  const rows = await db.prepare(`SELECT tb.id AS trial_booking_id, c.display_name AS name,
      a.id AS attendance_id, a.status AS attendance_status, a.version AS attendance_version
    FROM class_session s
    JOIN trial_booking tb ON ${trialRosterOn('s', 'tb')}
    JOIN lead l ON l.id = tb.lead_id
    JOIN contact c ON c.id = l.contact_id
    LEFT JOIN attendance a ON a.session_id = s.id AND a.trial_booking_id = tb.id
    WHERE s.id = ?
    ORDER BY c.display_name, tb.id`).bind(sessionId)
    .all<MarkRow & { trial_booking_id: string; name: string }>();
  return rows.results.map((row) => ({ trialBookingId: row.trial_booking_id, name: row.name, ...marked(row) }));
}

async function makeupRoster(db: D1Database, sessionId: string) {
  const rows = await db.prepare(`SELECT e.id AS enrollment_id, c.display_name AS name,
      a.id AS attendance_id, a.status AS attendance_status, a.version AS attendance_version
    FROM class_session s
    JOIN attendance src ON ${makeupRosterOn('s', 'src')}
    JOIN enrollment e ON e.id = src.enrollment_id
    JOIN contact c ON c.id = e.contact_id
    LEFT JOIN attendance a ON a.session_id = s.id AND a.enrollment_id = e.id
    WHERE s.id = ?
    ORDER BY c.display_name, e.id`).bind(sessionId)
    .all<MarkRow & { enrollment_id: string; name: string }>();
  return rows.results.map((row) => ({ enrollmentId: row.enrollment_id, name: row.name, ...marked(row) }));
}

function publicSession(session: SessionRow) {
  return {
    id: session.id, classId: session.class_id, className: session.class_name, courseName: session.course_name,
    startsAt: session.starts_at, durationMinutes: session.duration_minutes, kind: session.kind, status: session.status, note: session.note,
  };
}

/** Classes the actor may open, with upcoming and past sessions. `assigned` is this actor's own class_teacher row. No fees and no center-wide headcount. */
export async function myClasses(db: D1Database, actor: Actor) {
  if (!TEACH_ROLES.includes(actor.role)) return 'forbidden' as const;
  const now = new Date().toISOString();
  const teacherOnly = actor.role === 'teacher';
  const rows = await db.prepare(`SELECT cg.id AS class_id, cg.name AS class_name, cg.schedule_text, cg.status AS class_status,
      co.name AS course_name, CASE WHEN ct.user_id IS NOT NULL THEN 1 ELSE 0 END AS assigned,
      s.id AS session_id, s.starts_at, s.duration_minutes, s.kind, s.status AS session_status, s.note
    FROM class_group cg
    JOIN course co ON co.id = cg.course_id
    LEFT JOIN class_teacher ct ON ct.class_id = cg.id AND ct.user_id = ?
    LEFT JOIN class_session s ON s.class_id = cg.id
    WHERE co.organization_id = ?${teacherOnly ? ' AND ct.user_id IS NOT NULL' : ''}
    ORDER BY co.name, cg.name, s.starts_at, s.id`)
    .bind(actor.id, actor.organizationId)
    .all<{
      class_id: string; class_name: string; schedule_text: string | null; class_status: string; course_name: string; assigned: number;
      session_id: string | null; starts_at: string | null; duration_minutes: number | null; kind: string | null;
      session_status: string | null; note: string | null;
    }>();
  const classes = new Map<string, {
    id: string; name: string; courseName: string; scheduleText: string | null; status: string; assigned: boolean;
    upcoming: { id: string; startsAt: string; durationMinutes: number; kind: string; status: string; note: string | null }[];
    past: { id: string; startsAt: string; durationMinutes: number; kind: string; status: string; note: string | null }[];
  }>();
  for (const row of rows.results) {
    const bucket = classes.get(row.class_id) ?? {
      id: row.class_id, name: row.class_name, courseName: row.course_name, scheduleText: row.schedule_text, status: row.class_status,
      assigned: row.assigned === 1,
      upcoming: [], past: [],
    };
    if (row.session_id && row.starts_at && row.duration_minutes != null && row.kind && row.session_status) {
      const session = {
        id: row.session_id, startsAt: row.starts_at, durationMinutes: row.duration_minutes,
        kind: row.kind, status: row.session_status, note: row.note,
      };
      (row.starts_at >= now ? bucket.upcoming : bucket.past).push(session);
    }
    classes.set(row.class_id, bucket);
  }
  return { classes: [...classes.values()] };
}

/** Roster, session facts, and the class note used as the study link. */
export async function sessionAttendance(db: D1Database, actor: Actor, sessionId: string) {
  if (!TEACH_ROLES.includes(actor.role)) return 'forbidden' as const;
  const session = await loadSession(db, actor.organizationId, sessionId);
  if (!session) return null;
  if (!(await canTeach(db, actor, session.class_id))) return 'forbidden' as const;
  return { session: publicSession(session), roster: await sessionRoster(db, session.id) };
}

function writeAttendance(tx: GuardedTx, sessionId: string, actorId: string, item: RosterItem, status: string, enrollmentId: string | null, trialBookingId: string | null) {
  const fields = { status, marked_by_user_id: actorId, marked_at: tx.now };
  if (item.attendanceId && item.version) {
    tx.update('attendance', item.attendanceId, item.version, fields);
    tx.audit('attendance', item.attendanceId, { status: item.status }, fields);
    return { attendanceId: item.attendanceId, version: item.version + 1 };
  }
  const id = crypto.randomUUID();
  tx.insertVersioned('attendance', {
    id, session_id: sessionId, enrollment_id: enrollmentId, trial_booking_id: trialBookingId, ...fields,
  });
  tx.audit('attendance', id, null, { ...fields, sessionId });
  return { attendanceId: id, version: 1 };
}

async function startStudying(db: D1Database, tx: GuardedTx, actorId: string, enrollmentId: string, doneLeads: Set<string>): Promise<ApiFail | null> {
  const row = await db.prepare('SELECT id, lead_id, status, version FROM enrollment WHERE id = ?')
    .bind(enrollmentId).first<{ id: string; lead_id: string; status: string; version: number }>();
  if (!row) return fail('VALIDATION_FAILED', 'Không tìm thấy ghi danh');
  const allowed: readonly string[] = ENROLLMENT_FROM.markAttendance;
  if (allowed.includes(row.status)) tx.update('enrollment', row.id, row.version, { status: 'studying' });
  if (doneLeads.has(row.lead_id)) return null;
  doneLeads.add(row.lead_id);
  return markStepDone(db, tx, actorId, row.lead_id, 'started');
}

async function finishTrial(db: D1Database, tx: GuardedTx, actorId: string, trialBookingId: string, doneLeads: Set<string>): Promise<ApiFail | null> {
  const booking = await db.prepare('SELECT id, lead_id, status, version FROM trial_booking WHERE id = ?')
    .bind(trialBookingId).first<{ id: string; lead_id: string; status: string; version: number }>();
  if (!booking) return fail('VALIDATION_FAILED', 'Không tìm thấy lượt học thử');
  if (booking.status === 'booked') tx.update('trial_booking', booking.id, booking.version, { status: 'done' });
  if (doneLeads.has(booking.lead_id)) return null;
  doneLeads.add(booking.lead_id);
  const lead = await db.prepare(`SELECT id, pipeline, status, stage, version FROM lead WHERE id = ?`)
    .bind(booking.lead_id).first<{ id: string; pipeline: string; status: string; stage: string; version: number }>();
  if (!lead) return fail('VALIDATION_FAILED', 'Không tìm thấy lead của buổi học thử');
  const step = await db.prepare(`SELECT status FROM lead_step WHERE lead_id = ? AND step_code = 'trial'`)
    .bind(lead.id).first<{ status: string }>();
  if (step?.status === 'open' && lead.pipeline === 'learner' && lead.status === 'active' && lead.stage === 'trial_booked') {
    tx.update('lead', lead.id, lead.version, { stage: 'trial_done', stage_entered_at: tx.now, last_activity_at: tx.now });
    tx.activity(lead.id, 'stage_changed', `${stageLabel(lead.stage, 'learner')} → ${stageLabel('trial_done', 'learner')}`);
  }
  return markStepDone(db, tx, actorId, lead.id, 'trial');
}

async function markAttendance({ db, actor, input, tx }: Ctx<MarkAttendanceInput>) {
  const session = await loadSession(db, actor.organizationId, input.sessionId);
  if (!session) return fail('NOT_FOUND', 'Không tìm thấy buổi học');
  if (!(await canTeach(db, actor, session.class_id))) return fail('FORBIDDEN', 'Bạn không điểm danh lớp này');
  if (session.status !== 'scheduled') return fail('VALIDATION_FAILED', 'Buổi này không còn mở để điểm danh');
  const roster = await sessionRoster(db, session.id);
  const seen = new Set<string>();
  const matched: { entry: MarkAttendanceInput['entries'][number]; item: RosterItem }[] = [];
  for (const entry of input.entries) {
    const key = entry.enrollmentId ?? entry.trialBookingId ?? '';
    if (seen.has(key)) return fail('VALIDATION_FAILED', 'Mỗi học viên chỉ điểm danh một lần trong buổi');
    seen.add(key);
    const item = roster.find((row) => entry.enrollmentId ? row.enrollmentId === entry.enrollmentId : row.trialBookingId === entry.trialBookingId);
    if (!item) return fail('VALIDATION_FAILED', 'Học viên không có trong buổi này');
    if (entry.version !== item.version) return fail('STALE_VERSION', 'Điểm danh vừa được người khác cập nhật. Tải lại rồi thử lại.');
    matched.push({ entry, item });
  }
  const doneLeads = new Set<string>();
  const entries = [];
  for (const { entry, item } of matched) {
    const written = writeAttendance(tx, session.id, actor.id, item, entry.status, entry.enrollmentId ?? null, entry.trialBookingId ?? null);
    if (entry.status === 'present' || entry.status === 'late') {
      if ((session.kind === 'regular' || session.kind === 'makeup') && entry.enrollmentId) {
        const error = await startStudying(db, tx, actor.id, entry.enrollmentId, doneLeads);
        if (error) return error;
      }
      if (session.kind === 'trial' && entry.trialBookingId) {
        const error = await finishTrial(db, tx, actor.id, entry.trialBookingId, doneLeads);
        if (error) return error;
      }
    }
    entries.push({ ...written, status: entry.status, enrollmentId: entry.enrollmentId ?? null, trialBookingId: entry.trialBookingId ?? null });
  }
  return ok({ sessionId: session.id, entries });
}

async function createMakeupSession({ db, actor, input, tx }: Ctx<CreateMakeupSessionInput>) {
  const absence = await db.prepare(`SELECT a.id, a.status, a.enrollment_id, cg.id AS class_id, cg.status AS class_status
    FROM attendance a
    JOIN class_session s ON s.id = a.session_id
    JOIN class_group cg ON cg.id = s.class_id
    JOIN course co ON co.id = cg.course_id
    WHERE a.id = ? AND co.organization_id = ?`)
    .bind(input.attendanceId, actor.organizationId)
    .first<{ id: string; status: string; enrollment_id: string | null; class_id: string; class_status: string }>();
  if (!absence) return fail('NOT_FOUND', 'Không tìm thấy lần vắng');
  if ((absence.status !== 'absent' && absence.status !== 'excused') || !absence.enrollment_id) {
    return fail('VALIDATION_FAILED', 'Chỉ buổi vắng hoặc có phép của một ghi danh mới tạo được học bù');
  }
  if (absence.class_status !== 'open') return fail('VALIDATION_FAILED', 'Lớp không còn mở');
  const scheduled = await db.prepare(`SELECT id FROM class_session WHERE makeup_for_attendance_id = ? AND status = 'scheduled'`)
    .bind(absence.id).first<{ id: string }>();
  if (scheduled) return fail('VALIDATION_FAILED', 'Lần vắng này đã có buổi học bù');
  const startsAt = isoUtc(input.startsAt);
  if (!startsAt) return fail('VALIDATION_FAILED', 'Thời điểm không hợp lệ', { fields: { startsAt: 'Không hợp lệ' } });
  const id = crypto.randomUUID();
  const fields = {
    class_id: absence.class_id, starts_at: startsAt, duration_minutes: input.durationMinutes,
    kind: 'makeup', status: 'scheduled', note: blank(input.note), makeup_for_attendance_id: absence.id,
  };
  tx.assert(`SELECT COUNT(*) = 0 FROM class_session WHERE makeup_for_attendance_id = ? AND status = 'scheduled'`, [absence.id]);
  tx.insertVersioned('class_session', { id, ...fields });
  tx.audit('class_session', id, null, fields);
  return ok({ id, version: 1 });
}

export const attendanceHandlers = { markAttendance, createMakeupSession };
