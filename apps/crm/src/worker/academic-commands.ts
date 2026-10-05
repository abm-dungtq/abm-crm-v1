import {
  enrollmentStatusLabel, stageLabel,
  type AddSessionInput, type BookTrialInput, type CancelPendingEnrollmentInput, type ConfirmEnrollmentInput,
  type DeferEnrollmentInput, type EndEnrollmentInput, type ReserveSeatInput, type ResumeEnrollmentInput,
  type SetClassTeachersInput, type TransferEnrollmentInput, type UpdateSessionInput, type UpsertClassInput,
  type UpsertCourseInput,
} from '@abm/contracts';
import { fail, isoUtc, ok, type Ctx } from './command-result';
import type { Actor } from './env';
import { loadLearnerLead, markStepDone } from './learner-commands';

/** Legal source statuses for each enrollment command. Every enrollment write checks this table. */
export const ENROLLMENT_FROM = {
  cancelPendingEnrollment: ['pending'],
  confirmEnrollment: ['pending'],
  deferEnrollment: ['confirmed', 'studying'],
  resumeEnrollment: ['deferred'],
  transferEnrollment: ['confirmed', 'studying', 'deferred'],
  endEnrollment: ['confirmed', 'studying', 'deferred'],
  markAttendance: ['confirmed'],
} as const;

interface ClassRow {
  id: string; course_id: string; name: string; status: string; version: number;
}
interface SessionRow {
  id: string; class_id: string; starts_at: string; duration_minutes: number; kind: string; status: string; note: string | null; version: number;
}
interface EnrollmentRow {
  id: string; lead_id: string; contact_id: string; class_id: string; status: string;
  deferred_until: string | null; status_before_defer: string | null; version: number;
  owner_user_id: string | null; team_id: string | null;
}

const blank = (value: string | undefined) => value?.trim() || null;
const learnerStage = (code: string) => stageLabel(code, 'learner');

function rejectStatus(status: string, allowed: readonly string[]) {
  if (allowed.includes(status)) return null;
  return fail('VALIDATION_FAILED', `Không áp dụng cho ghi danh đang "${enrollmentStatusLabel(status)}"`);
}

async function loadCourse(db: D1Database, organizationId: string, courseId: string) {
  return db.prepare('SELECT id, product_id, name, status, version FROM course WHERE id = ? AND organization_id = ?')
    .bind(courseId, organizationId).first<{ id: string; product_id: string; name: string; status: string; version: number }>();
}

async function loadClass(db: D1Database, organizationId: string, classId: string) {
  return db.prepare(`SELECT cg.id, cg.course_id, cg.name, cg.status, cg.version
    FROM class_group cg JOIN course co ON co.id = cg.course_id
    WHERE cg.id = ? AND co.organization_id = ?`).bind(classId, organizationId).first<ClassRow>();
}

async function loadSession(db: D1Database, organizationId: string, sessionId: string) {
  return db.prepare(`SELECT s.id, s.class_id, s.starts_at, s.duration_minutes, s.kind, s.status, s.note, s.version
    FROM class_session s JOIN class_group cg ON cg.id = s.class_id JOIN course co ON co.id = cg.course_id
    WHERE s.id = ? AND co.organization_id = ?`).bind(sessionId, organizationId).first<SessionRow>();
}

async function loadEnrollment(db: D1Database, organizationId: string, enrollmentId: string) {
  return db.prepare(`SELECT e.id, e.lead_id, e.contact_id, e.class_id, e.status, e.deferred_until, e.status_before_defer, e.version,
      l.owner_user_id, l.team_id
    FROM enrollment e JOIN lead l ON l.id = e.lead_id
    WHERE e.id = ? AND e.organization_id = ?`).bind(enrollmentId, organizationId).first<EnrollmentRow>();
}

function mayCancel(actor: Actor, row: EnrollmentRow) {
  return actor.role === 'admin' || row.owner_user_id === actor.id || (actor.role === 'leader' && actor.teamId !== null && row.team_id === actor.teamId);
}

async function upsertCourse({ db, actor, input, tx }: Ctx<UpsertCourseInput>) {
  const product = await db.prepare('SELECT id FROM product WHERE id = ? AND organization_id = ?')
    .bind(input.productId, actor.organizationId).first();
  if (!product) return fail('VALIDATION_FAILED', 'Không tìm thấy sản phẩm', { fields: { productId: 'Không hợp lệ' } });
  const fields = { product_id: input.productId, name: input.name, status: input.status };
  if (!input.id) {
    const id = crypto.randomUUID();
    tx.insertVersioned('course', { id, organization_id: actor.organizationId, ...fields });
    tx.audit('course', id, null, fields);
    return ok({ id, version: 1 });
  }
  if (!input.version) return fail('VALIDATION_FAILED', 'Thiếu version của khóa', { fields: { version: 'Bắt buộc' } });
  const before = await loadCourse(db, actor.organizationId, input.id);
  if (!before) return fail('NOT_FOUND', 'Không tìm thấy khóa');
  if (before.version !== input.version) return fail('STALE_VERSION', 'Khóa vừa được người khác cập nhật. Tải lại rồi thử lại.');
  tx.update('course', input.id, input.version, fields);
  tx.audit('course', input.id, { name: before.name, status: before.status, product_id: before.product_id }, fields);
  return ok({ id: input.id, version: input.version + 1 });
}

async function upsertClass({ db, actor, input, tx }: Ctx<UpsertClassInput>) {
  const course = await loadCourse(db, actor.organizationId, input.courseId);
  if (!course) return fail('VALIDATION_FAILED', 'Không tìm thấy khóa', { fields: { courseId: 'Không hợp lệ' } });
  const fields = { course_id: input.courseId, name: input.name, schedule_text: blank(input.scheduleText), note: blank(input.note), status: input.status };
  if (!input.id) {
    const id = crypto.randomUUID();
    tx.insertVersioned('class_group', { id, ...fields });
    tx.audit('class_group', id, null, fields);
    return ok({ id, version: 1 });
  }
  if (!input.version) return fail('VALIDATION_FAILED', 'Thiếu version của lớp', { fields: { version: 'Bắt buộc' } });
  const before = await loadClass(db, actor.organizationId, input.id);
  if (!before) return fail('NOT_FOUND', 'Không tìm thấy lớp');
  if (before.version !== input.version) return fail('STALE_VERSION', 'Lớp vừa được người khác cập nhật. Tải lại rồi thử lại.');
  tx.update('class_group', input.id, input.version, fields);
  tx.audit('class_group', input.id, { name: before.name, status: before.status }, fields);
  return ok({ id: input.id, version: input.version + 1 });
}

async function setClassTeachers({ db, actor, input, tx }: Ctx<SetClassTeachersInput>) {
  const klass = await loadClass(db, actor.organizationId, input.classId);
  if (!klass) return fail('NOT_FOUND', 'Không tìm thấy lớp');
  if (klass.version !== input.version) return fail('STALE_VERSION', 'Lớp vừa được người khác cập nhật. Tải lại rồi thử lại.');
  const teacherIds = [...new Set(input.teacherUserIds)];
  if (teacherIds.length) {
    const found = await db.prepare(`SELECT id FROM app_user
      WHERE organization_id = ? AND status = 'active' AND role IN ('teacher', 'admin') AND id IN (SELECT value FROM json_each(?))`)
      .bind(actor.organizationId, JSON.stringify(teacherIds)).all<{ id: string }>();
    if (found.results.length !== teacherIds.length) {
      return fail('VALIDATION_FAILED', 'Giáo viên phải là tài khoản giáo viên hoặc admin đang hoạt động', { fields: { teacherUserIds: 'Không hợp lệ' } });
    }
  }
  tx.update('class_group', klass.id, input.version, {});
  tx.raw(db.prepare('DELETE FROM class_teacher WHERE class_id = ?').bind(klass.id));
  for (const userId of teacherIds) {
    tx.raw(db.prepare('INSERT INTO class_teacher (id, class_id, user_id, created_at) VALUES (?, ?, ?, ?)')
      .bind(crypto.randomUUID(), klass.id, userId, tx.now));
  }
  tx.audit('class_group', klass.id, null, { teachers: teacherIds });
  return ok({ classId: klass.id, version: input.version + 1 });
}

async function addSession({ db, actor, input, tx }: Ctx<AddSessionInput>) {
  const klass = await loadClass(db, actor.organizationId, input.classId);
  if (!klass) return fail('NOT_FOUND', 'Không tìm thấy lớp');
  const startsAt = isoUtc(input.startsAt);
  if (!startsAt) return fail('VALIDATION_FAILED', 'Thời điểm không hợp lệ', { fields: { startsAt: 'Không hợp lệ' } });
  const id = crypto.randomUUID();
  const fields = {
    class_id: input.classId, starts_at: startsAt, duration_minutes: input.durationMinutes,
    kind: input.kind, status: 'scheduled', note: blank(input.note), makeup_for_attendance_id: null,
  };
  tx.insertVersioned('class_session', { id, ...fields });
  tx.audit('class_session', id, null, fields);
  return ok({ id, version: 1 });
}

async function updateSession({ db, actor, input, tx }: Ctx<UpdateSessionInput>) {
  const session = await loadSession(db, actor.organizationId, input.sessionId);
  if (!session) return fail('NOT_FOUND', 'Không tìm thấy buổi học');
  if (session.version !== input.version) return fail('STALE_VERSION', 'Buổi học vừa được người khác cập nhật. Tải lại rồi thử lại.');
  const set: Record<string, unknown> = {};
  if (input.startsAt !== undefined) {
    const startsAt = isoUtc(input.startsAt);
    if (!startsAt) return fail('VALIDATION_FAILED', 'Thời điểm không hợp lệ', { fields: { startsAt: 'Không hợp lệ' } });
    set.starts_at = startsAt;
  }
  if (input.durationMinutes !== undefined) set.duration_minutes = input.durationMinutes;
  if (input.note !== undefined) set.note = blank(input.note);
  if (input.status !== undefined) set.status = input.status;
  if (!Object.keys(set).length) return fail('VALIDATION_FAILED', 'Không có gì để sửa');
  tx.update('class_session', session.id, input.version, set);
  tx.audit('class_session', session.id, { status: session.status, starts_at: session.starts_at, note: session.note }, set);
  return ok({ id: session.id, version: input.version + 1 });
}

async function bookTrial({ db, actor, input, tx }: Ctx<BookTrialInput>) {
  const loaded = await loadLearnerLead(db, actor, input.leadId, input.expectedVersion);
  if ('error' in loaded) return loaded.error;
  const { lead } = loaded;
  if (lead.stage !== 'qualified') return fail('VALIDATION_FAILED', 'Chỉ lead đủ điều kiện mới đặt được học thử');
  const session = await loadSession(db, actor.organizationId, input.sessionId);
  if (!session || session.kind !== 'trial' || session.status !== 'scheduled') {
    return fail('VALIDATION_FAILED', 'Buổi học thử không còn mở', { fields: { sessionId: 'Không hợp lệ' } });
  }
  const id = crypto.randomUUID();
  tx.update('lead', lead.id, input.expectedVersion, { stage: 'trial_booked', stage_entered_at: tx.now, last_activity_at: tx.now });
  tx.insertVersioned('trial_booking', { id, lead_id: lead.id, session_id: session.id, status: 'booked' });
  tx.activity(lead.id, 'stage_changed', `${learnerStage(lead.stage)} → ${learnerStage('trial_booked')}`);
  tx.audit('lead', lead.id, { stage: lead.stage }, { stage: 'trial_booked', sessionId: session.id });
  return ok({ id, leadId: lead.id, stage: 'trial_booked' });
}

async function reserveSeat({ db, actor, input, tx }: Ctx<ReserveSeatInput>) {
  const loaded = await loadLearnerLead(db, actor, input.leadId, input.expectedVersion, ['won']);
  if ('error' in loaded) return loaded.error;
  const { lead } = loaded;
  if (lead.stage !== 'won') return fail('VALIDATION_FAILED', 'Chỉ lead đã thắng mới giữ chỗ');
  const klass = await loadClass(db, actor.organizationId, input.classId);
  if (!klass || klass.status !== 'open') return fail('VALIDATION_FAILED', 'Lớp không còn mở', { fields: { classId: 'Không hợp lệ' } });
  const id = crypto.randomUUID();
  tx.update('lead', lead.id, input.expectedVersion, { last_activity_at: tx.now });
  tx.assert(`SELECT COUNT(*) = 0 FROM enrollment WHERE lead_id = ? AND status IN ('pending','confirmed','studying','deferred')`, [lead.id]);
  tx.insertVersioned('enrollment', {
    id, organization_id: actor.organizationId, lead_id: lead.id, contact_id: lead.contact_id, class_id: klass.id,
    status: 'pending', deferred_until: null, status_before_defer: null, transferred_from_enrollment_id: null,
    confirmed_at: null, ended_at: null,
  });
  tx.activity(lead.id, 'note', `Giữ chỗ lớp ${klass.name}`);
  tx.audit('enrollment', id, null, { status: 'pending', classId: klass.id, leadId: lead.id });
  return ok({ id, version: 1 });
}

async function cancelPendingEnrollment({ db, actor, input, tx }: Ctx<CancelPendingEnrollmentInput>) {
  const row = await loadEnrollment(db, actor.organizationId, input.enrollmentId);
  if (!row) return fail('NOT_FOUND', 'Không tìm thấy ghi danh');
  if (!mayCancel(actor, row)) return fail('FORBIDDEN', 'Ghi danh này không thuộc lead bạn phụ trách');
  if (row.version !== input.version) return fail('STALE_VERSION', 'Ghi danh vừa được người khác cập nhật. Tải lại rồi thử lại.');
  const illegal = rejectStatus(row.status, ENROLLMENT_FROM.cancelPendingEnrollment);
  if (illegal) return illegal;
  tx.update('enrollment', row.id, input.version, { status: 'cancelled', ended_at: tx.now });
  tx.audit('enrollment', row.id, { status: row.status }, { status: 'cancelled' });
  return ok({ id: row.id, status: 'cancelled' });
}

async function confirmEnrollment({ db, actor, input, tx }: Ctx<ConfirmEnrollmentInput>) {
  const row = await loadEnrollment(db, actor.organizationId, input.enrollmentId);
  if (!row) return fail('NOT_FOUND', 'Không tìm thấy ghi danh');
  if (row.version !== input.version) return fail('STALE_VERSION', 'Ghi danh vừa được người khác cập nhật. Tải lại rồi thử lại.');
  const illegal = rejectStatus(row.status, ENROLLMENT_FROM.confirmEnrollment);
  if (illegal) return illegal;
  const consent = await db.prepare(`SELECT granted FROM consent WHERE contact_id = ? AND purpose = 'enrollment'
    ORDER BY recorded_at DESC, rowid DESC LIMIT 1`).bind(row.contact_id).first<{ granted: number }>();
  if (consent?.granted !== 1) return fail('VALIDATION_FAILED', 'Khách chưa đồng ý mục Quản lý ghi danh');
  const placed = await markStepDone(db, tx, actor.id, row.lead_id, 'placed');
  if (placed) return placed;
  tx.update('enrollment', row.id, input.version, { status: 'confirmed', confirmed_at: tx.now });
  tx.assert(`SELECT COALESCE((SELECT granted FROM consent WHERE contact_id = ? AND purpose = 'enrollment' ORDER BY recorded_at DESC, rowid DESC LIMIT 1), 0) = 1`, [row.contact_id]);
  tx.activity(row.lead_id, 'note', 'Xác nhận chỗ');
  tx.audit('enrollment', row.id, { status: row.status }, { status: 'confirmed' });
  return ok({ id: row.id, status: 'confirmed' });
}

async function deferEnrollment({ db, actor, input, tx }: Ctx<DeferEnrollmentInput>) {
  const row = await loadEnrollment(db, actor.organizationId, input.enrollmentId);
  if (!row) return fail('NOT_FOUND', 'Không tìm thấy ghi danh');
  if (row.version !== input.version) return fail('STALE_VERSION', 'Ghi danh vừa được người khác cập nhật. Tải lại rồi thử lại.');
  const illegal = rejectStatus(row.status, ENROLLMENT_FROM.deferEnrollment);
  if (illegal) return illegal;
  const set = { status: 'deferred', deferred_until: input.until, status_before_defer: row.status };
  tx.update('enrollment', row.id, input.version, set);
  tx.audit('enrollment', row.id, { status: row.status }, set);
  return ok({ id: row.id, status: 'deferred' });
}

async function resumeEnrollment({ db, actor, input, tx }: Ctx<ResumeEnrollmentInput>) {
  const row = await loadEnrollment(db, actor.organizationId, input.enrollmentId);
  if (!row) return fail('NOT_FOUND', 'Không tìm thấy ghi danh');
  if (row.version !== input.version) return fail('STALE_VERSION', 'Ghi danh vừa được người khác cập nhật. Tải lại rồi thử lại.');
  const illegal = rejectStatus(row.status, ENROLLMENT_FROM.resumeEnrollment);
  if (illegal) return illegal;
  const back = row.status_before_defer;
  if (back !== 'confirmed' && back !== 'studying') return fail('VALIDATION_FAILED', 'Không còn trạng thái trước khi bảo lưu');
  tx.update('enrollment', row.id, input.version, { status: back, deferred_until: null, status_before_defer: null });
  tx.audit('enrollment', row.id, { status: row.status, status_before_defer: back }, { status: back });
  return ok({ id: row.id, status: back });
}

async function transferEnrollment({ db, actor, input, tx }: Ctx<TransferEnrollmentInput>) {
  const row = await loadEnrollment(db, actor.organizationId, input.enrollmentId);
  if (!row) return fail('NOT_FOUND', 'Không tìm thấy ghi danh');
  if (row.version !== input.version) return fail('STALE_VERSION', 'Ghi danh vừa được người khác cập nhật. Tải lại rồi thử lại.');
  const illegal = rejectStatus(row.status, ENROLLMENT_FROM.transferEnrollment);
  if (illegal) return illegal;
  if (input.toClassId === row.class_id) return fail('VALIDATION_FAILED', 'Lớp đích phải khác lớp hiện tại', { fields: { toClassId: 'Không hợp lệ' } });
  const target = await loadClass(db, actor.organizationId, input.toClassId);
  if (!target || target.status !== 'open') return fail('VALIDATION_FAILED', 'Lớp đích không còn mở', { fields: { toClassId: 'Không hợp lệ' } });
  tx.assert(`SELECT COUNT(*) = 0 FROM enrollment WHERE lead_id = ? AND id <> ? AND status IN ('pending','confirmed','studying','deferred')`, [row.lead_id, row.id]);
  const id = crypto.randomUUID();
  tx.update('enrollment', row.id, input.version, { status: 'transferred', ended_at: tx.now });
  tx.insertVersioned('enrollment', {
    id, organization_id: actor.organizationId, lead_id: row.lead_id, contact_id: row.contact_id, class_id: target.id,
    status: 'confirmed', deferred_until: null, status_before_defer: null, transferred_from_enrollment_id: row.id,
    confirmed_at: tx.now, ended_at: null,
  });
  tx.activity(row.lead_id, 'note', `Chuyển lớp sang ${target.name}`);
  tx.audit('enrollment', row.id, { status: row.status, class_id: row.class_id }, { status: 'transferred', to: id });
  return ok({ id, fromId: row.id, status: 'confirmed' });
}

async function endEnrollment({ db, actor, input, tx }: Ctx<EndEnrollmentInput>) {
  const row = await loadEnrollment(db, actor.organizationId, input.enrollmentId);
  if (!row) return fail('NOT_FOUND', 'Không tìm thấy ghi danh');
  if (row.version !== input.version) return fail('STALE_VERSION', 'Ghi danh vừa được người khác cập nhật. Tải lại rồi thử lại.');
  const illegal = rejectStatus(row.status, ENROLLMENT_FROM.endEnrollment);
  if (illegal) return illegal;
  tx.update('enrollment', row.id, input.version, { status: input.outcome, ended_at: tx.now });
  tx.audit('enrollment', row.id, { status: row.status }, { status: input.outcome });
  return ok({ id: row.id, status: input.outcome });
}

export const academicHandlers = {
  upsertCourse, upsertClass, setClassTeachers, addSession, updateSession, bookTrial, reserveSeat,
  cancelPendingEnrollment, confirmEnrollment, deferEnrollment, resumeEnrollment, transferEnrollment, endEnrollment,
};
