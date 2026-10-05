import { z } from 'zod';

// Business vocabulary approved in docs/decisions/business-decisions-v1.md (QĐ1, QĐ6, PRD 9.1, 10.6).

export const STAGES = [
  { code: 'new', label: 'Lead mới', slaWorkingDays: null },
  { code: 'contacted', label: 'Đã liên hệ', slaWorkingDays: 3 },
  { code: 'qualified', label: 'Tiềm năng', slaWorkingDays: 7 },
  { code: 'consulting', label: 'Tư vấn', slaWorkingDays: 7 },
  { code: 'quoted', label: 'Báo giá', slaWorkingDays: 5 },
  { code: 'negotiating', label: 'Đàm phán', slaWorkingDays: 10 },
  { code: 'closing', label: 'Chờ chốt', slaWorkingDays: 7 },
  { code: 'won', label: 'Won', slaWorkingDays: null },
  { code: 'lost', label: 'Lost', slaWorkingDays: null },
] as const;
export type StageCode = (typeof STAGES)[number]['code'];
export const STAGE_CODES = STAGES.map((s) => s.code) as [StageCode, ...StageCode[]];
export const ACTIVE_STAGES: StageCode[] = ['new', 'contacted', 'qualified', 'consulting', 'quoted', 'negotiating', 'closing'];
export const TERMINAL_STAGES: StageCode[] = ['won', 'lost'];

/** Two pipelines share the lead table: the B2B pipeline above and the individual-learner pipeline. */
export const PIPELINES = ['b2b', 'learner'] as const;
export type PipelineCode = (typeof PIPELINES)[number];

/** Learner pipeline stages in PRD order. */
export const LEARNER_STAGES = [
  { code: 'new', label: 'Mới' },
  { code: 'contacted', label: 'Đang liên hệ' },
  { code: 'qualified', label: 'Đủ điều kiện' },
  { code: 'trial_booked', label: 'Đã hẹn học thử' },
  { code: 'trial_done', label: 'Đã học thử' },
  { code: 'won', label: 'Thắng' },
  { code: 'lost', label: 'Mất' },
  { code: 'not_fit', label: 'Không phù hợp' },
] as const;

export const stageLabel = (code: string, pipeline: PipelineCode = 'b2b') =>
  (pipeline === 'learner' ? LEARNER_STAGES : STAGES).find((s) => s.code === code)?.label ?? code;

/** First contact SLA and release threshold, in working hours (QĐ4/QĐ14). */
export const FIRST_CONTACT_SLA_HOURS = 4;
export const RELEASE_AFTER_HOURS = 24;
export const WORKDAY = { start: '08:00', end: '17:30', timeZone: 'Asia/Ho_Chi_Minh' } as const;

/** MVP1 allows one step forward, Lost from any active stage, Won only from Chờ chốt. */
export function allowedTransitions(from: StageCode): StageCode[] {
  const i = ACTIVE_STAGES.indexOf(from);
  if (i < 0) return [];
  const next: StageCode[] = [];
  if (from === 'closing') next.push('won');
  else next.push(ACTIVE_STAGES[i + 1]!);
  next.push('lost');
  return next;
}

export const LOST_REASONS = [
  { code: 'price', label: 'Giá' },
  { code: 'wrong_need', label: 'Không đúng nhu cầu' },
  { code: 'wrong_timing', label: 'Không đúng thời điểm' },
  { code: 'no_budget', label: 'Không đủ ngân sách' },
  { code: 'competitor', label: 'Đối thủ' },
  { code: 'no_decision_maker', label: 'Không tiếp cận đúng Decision Maker' },
  { code: 'late_follow_up', label: 'Không Follow-up kịp' },
  { code: 'no_response', label: 'Không phản hồi' },
  { code: 'other', label: 'Khác' },
] as const;
export type LostReasonCode = (typeof LOST_REASONS)[number]['code'];
export const lostReasonLabel = (code: string | null | undefined) => LOST_REASONS.find((r) => r.code === code)?.label ?? (code ?? '');
const LOST_REASON_CODES = LOST_REASONS.map((r) => r.code) as [LostReasonCode, ...LostReasonCode[]];

/** Reasons a learner lead is lost or marked not fit. `other` needs a note. */
export const LEARNER_LOST_REASONS = [
  { code: 'price', label: 'Giá' },
  { code: 'schedule', label: 'Lịch' },
  { code: 'competitor', label: 'Đối thủ' },
  { code: 'no_response', label: 'Không phản hồi' },
  { code: 'not_fit', label: 'Không hợp' },
  { code: 'other', label: 'Khác' },
] as const;
export type LearnerLostReasonCode = (typeof LEARNER_LOST_REASONS)[number]['code'];
const LEARNER_LOST_REASON_CODES = LEARNER_LOST_REASONS.map((r) => r.code) as [LearnerLostReasonCode, ...LearnerLostReasonCode[]];
export const learnerLostReasonLabel = (code: string | null | undefined) => LEARNER_LOST_REASONS.find((r) => r.code === code)?.label ?? (code ?? '');

/** Partner contract lifecycle. Only an active contract accepts new learners. */
export const PARTNER_CONTRACT_STATUSES = [
  { code: 'draft', label: 'Nháp' },
  { code: 'active', label: 'Đang hiệu lực' },
  { code: 'done', label: 'Đã xong' },
  { code: 'cancelled', label: 'Đã hủy' },
] as const;
export type PartnerContractStatus = (typeof PARTNER_CONTRACT_STATUSES)[number]['code'];

/** Enrollment lifecycle. Only confirmed and studying count toward a class size. */
export const ENROLLMENT_STATUSES = [
  { code: 'pending', label: 'Chờ' },
  { code: 'confirmed', label: 'Đã xác nhận' },
  { code: 'studying', label: 'Đang học' },
  { code: 'deferred', label: 'Bảo lưu' },
  { code: 'transferred', label: 'Đã chuyển' },
  { code: 'completed', label: 'Đã học xong' },
  { code: 'withdrawn', label: 'Đã rút' },
  { code: 'cancelled', label: 'Đã hủy' },
] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number]['code'];
export const enrollmentStatusLabel = (code: string) => ENROLLMENT_STATUSES.find((s) => s.code === code)?.label ?? code;
export const COUNTED_ENROLLMENT = ['confirmed', 'studying'] as const;

/** Attendance on one session. Unmarked is the default until a teacher saves a mark. */
export const ATTENDANCE_STATUSES = [
  { code: 'unmarked', label: 'Chưa điểm danh' },
  { code: 'present', label: 'Có mặt' },
  { code: 'absent', label: 'Vắng' },
  { code: 'excused', label: 'Có phép' },
  { code: 'late', label: 'Đi trễ' },
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number]['code'];
export const attendanceStatusLabel = (code: string) => ATTENDANCE_STATUSES.find((s) => s.code === code)?.label ?? code;
const ATTENDANCE_STATUS_CODES = ATTENDANCE_STATUSES.map((s) => s.code) as [AttendanceStatus, ...AttendanceStatus[]];

/** A receivable. A discount is a negative adjustment, never an edit of a tuition amount. */
export const CHARGE_KINDS = [
  { code: 'tuition', label: 'Học phí' },
  { code: 'deposit', label: 'Tiền cọc' },
  { code: 'material', label: 'Học liệu' },
  { code: 'adjustment', label: 'Điều chỉnh' },
] as const;
export type ChargeKind = (typeof CHARGE_KINDS)[number]['code'];
const CHARGE_KIND_CODES = CHARGE_KINDS.map((k) => k.code) as [ChargeKind, ...ChargeKind[]];
export const chargeKindLabel = (code: string) => CHARGE_KINDS.find((k) => k.code === code)?.label ?? code;

export const PAYMENT_METHODS = [
  { code: 'transfer', label: 'Chuyển khoản' },
  { code: 'cash', label: 'Tiền mặt' },
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]['code'];
const PAYMENT_METHOD_CODES = PAYMENT_METHODS.map((m) => m.code) as [PaymentMethod, ...PaymentMethod[]];
export const paymentMethodLabel = (code: string) => PAYMENT_METHODS.find((m) => m.code === code)?.label ?? code;

/** Roles that may read money. Teachers and admissions never receive an amount. */
export const MONEY_ROLES = ['accountant', 'admin', 'director'] as const;

export const LEAD_SOURCES = [
  { code: 'facebook', label: 'Facebook' },
  { code: 'zalo', label: 'Zalo' },
  { code: 'website', label: 'Website' },
  { code: 'landing', label: 'Landing page' },
  { code: 'form', label: 'Form' },
  { code: 'referral', label: 'Giới thiệu' },
  { code: 'partner', label: 'Đối tác' },
  { code: 'self', label: 'Sale tự khai thác' },
] as const;
export type LeadSourceCode = (typeof LEAD_SOURCES)[number]['code'];
export const sourceLabel = (code: string) => LEAD_SOURCES.find((s) => s.code === code)?.label ?? code;
const LEAD_SOURCE_CODES = LEAD_SOURCES.map((s) => s.code) as [LeadSourceCode, ...LeadSourceCode[]];

export const ACTIVITY_TYPES = [
  { code: 'call', label: 'Gọi điện', contact: true, manual: true },
  { code: 'meeting', label: 'Gặp mặt', contact: true, manual: true },
  { code: 'email', label: 'Email', contact: true, manual: true },
  { code: 'message', label: 'Nhắn tin', contact: true, manual: true },
  { code: 'customer_reply', label: 'Khách phản hồi', contact: true, manual: true },
  { code: 'file_sent', label: 'Gửi tài liệu', contact: true, manual: true },
  { code: 'proposal_sent', label: 'Gửi đề xuất', contact: true, manual: true },
  { code: 'note', label: 'Ghi chú', contact: false, manual: true },
  { code: 'stage_changed', label: 'Đổi stage', contact: false, manual: false },
  { code: 'owner_changed', label: 'Đổi owner', contact: false, manual: false },
  { code: 'task_completed', label: 'Hoàn thành việc', contact: false, manual: false },
] as const;
export type ActivityTypeCode = (typeof ACTIVITY_TYPES)[number]['code'];
const MANUAL_ACTIVITY_CODES = ACTIVITY_TYPES.filter((a) => a.manual).map((a) => a.code) as [ActivityTypeCode, ...ActivityTypeCode[]];
export const activityLabel = (code: string) => ACTIVITY_TYPES.find((a) => a.code === code)?.label ?? code;

export const ROLES = [
  { code: 'sale', label: 'Sale', scope: 'own' },
  { code: 'leader', label: 'Leader', scope: 'team' },
  { code: 'head', label: 'Trưởng phòng', scope: 'department' },
  { code: 'director', label: 'BGĐ', scope: 'organization' },
  { code: 'admin', label: 'Admin', scope: 'organization' },
  { code: 'academic', label: 'Tổ chức (quản lý học viên)', scope: 'organization' },
  { code: 'teacher', label: 'Giáo viên', scope: 'class' },
  { code: 'accountant', label: 'Kế toán', scope: 'organization' },
] as const;
export type RoleCode = (typeof ROLES)[number]['code'];
const ROLE_CODES = ROLES.map((r) => r.code) as [RoleCode, ...RoleCode[]];

/** Eight-step learner journey. `by` says who may tick the step; `auto` steps are set by the system only. */
export const LEARNER_JOURNEY_VERSION = 1;
export const LEARNER_JOURNEY = [
  { code: 'recorded', label: 'Ghi nhận', required: true, by: 'auto' },
  { code: 'contacted', label: 'Liên hệ', required: true, by: 'admissions' },
  { code: 'need_confirmed', label: 'Xác nhận nhu cầu', required: true, by: 'admissions' },
  { code: 'trial', label: 'Học thử', required: false, by: 'auto' },
  { code: 'enrolled', label: 'Chốt ghi danh', required: true, by: 'auto' },
  { code: 'placed', label: 'Chia lớp', required: true, by: 'auto' },
  { code: 'tuition_paid', label: 'Thu học phí khóa', required: true, by: 'auto' },
  { code: 'started', label: 'Vào học', required: false, by: 'auto' },
] as const;
export type LearnerJourneyCode = (typeof LEARNER_JOURNEY)[number]['code'];

/** Consent is recorded per purpose and is never on by default. */
export const CONSENT_PURPOSES = [
  { code: 'enrollment', label: 'Quản lý ghi danh', defaultOn: false },
  { code: 'fee', label: 'Thu học phí', defaultOn: false },
  { code: 'attendance', label: 'Điểm danh', defaultOn: false },
  { code: 'marketing', label: 'Liên hệ marketing', defaultOn: false },
  { code: 'image', label: 'Dùng hình ảnh', defaultOn: false },
] as const;
export type ConsentPurposeCode = (typeof CONSENT_PURPOSES)[number]['code'];
const CONSENT_PURPOSE_CODES = CONSENT_PURPOSES.map((p) => p.code) as [ConsentPurposeCode, ...ConsentPurposeCode[]];

/** A personal-data request. Deleting a file hides the name and phone and keeps the money records. */
export const PRIVACY_REQUEST_KINDS = [
  { code: 'access', label: 'Truy cập hồ sơ' },
  { code: 'correct', label: 'Sửa dữ liệu' },
  { code: 'withdraw_consent', label: 'Rút đồng ý' },
  { code: 'delete', label: 'Xóa hồ sơ' },
] as const;
export type PrivacyRequestKind = (typeof PRIVACY_REQUEST_KINDS)[number]['code'];
const PRIVACY_REQUEST_KIND_CODES = PRIVACY_REQUEST_KINDS.map((k) => k.code) as [PrivacyRequestKind, ...PrivacyRequestKind[]];

// ADR-005 stable error codes. NOT_FOUND and IDEMPOTENCY_CONFLICT are transport-level additions.
export const ERROR_CODES = [
  'FORBIDDEN', 'STALE_VERSION', 'APPROVAL_REQUIRED', 'KILL_SWITCH_ON', 'DUPLICATE_SUSPECTED',
  'VALIDATION_FAILED', 'NOT_FOUND', 'IDEMPOTENCY_CONFLICT', 'UNAUTHENTICATED', 'INTERNAL',
  // Password login (ADR-006).
  'PASSWORD_CHANGE_REQUIRED', 'TEMP_PASSWORD_EXPIRED', 'ACCOUNT_LOCKED',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  code: ErrorCode;
  message: string;
  fields?: Record<string, string>;
  details?: unknown;
}
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/** VN phone key for duplicate checks: digits only, `+84`/`0084`/`84` country prefix becomes a leading 0. */
export function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, '').replace(/^00/, '');
  return digits.startsWith('84') ? `0${digits.slice(2)}` : digits;
}
export const normalizeEmail = (value: string) => value.trim().toLowerCase();

/** Case- and diacritic-insensitive key for Vietnamese text (SQLite lower() only folds ASCII). */
export const foldText = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/\s+/g, ' ').trim();

export const SEARCH_MAX_LENGTH = 100;
/** Won value is whole đồng; the cap keeps it far inside SQLite INTEGER and JS safe integers. */
export const MAX_DEAL_VALUE = 1_000_000_000_000_000;
/** How far back an activity may be recorded. */
export const ACTIVITY_BACKDATE_DAYS = 7;

const id = z.string().min(1).max(64);
const version = z.number().int().positive();
const isoDate = z.string().refine((v) => Number.isFinite(Date.parse(v)), 'Thời điểm không hợp lệ');
const text = (max: number) => z.string().trim().min(1, 'Bắt buộc').max(max);

export const nextActionInput = z.object({
  title: text(200),
  dueAt: isoDate,
});
export type NextActionInput = z.infer<typeof nextActionInput>;

export const createLeadInput = z.object({
  contactName: text(120),
  phone: z.string().trim().max(20)
    .refine((v) => v === '' || v.replace(/\D/g, '').length >= 9, 'Số điện thoại cần ít nhất 9 chữ số').optional(),
  email: z.string().trim().email('Email không hợp lệ').max(160).optional(),
  companyName: z.string().trim().max(200).optional(),
  taxCode: z.string().trim().max(20).optional(),
  source: z.enum(LEAD_SOURCE_CODES),
  needSummary: text(1000),
  confirmNotDuplicate: z.boolean().optional(),
  nextAction: nextActionInput.optional(),
  /** Only used by actors without a department of their own (Admin, BGĐ). */
  departmentId: id.optional(),
}).refine((v) => Boolean(v.phone || v.email), { message: 'Cần số điện thoại hoặc email', path: ['phone'] })
  .refine((v) => !v.taxCode || Boolean(v.companyName), { message: 'MST cần đi kèm tên công ty', path: ['companyName'] });
export type CreateLeadInput = z.infer<typeof createLeadInput>;

export const assignLeadInput = z.object({
  leadId: id,
  expectedVersion: version,
  ownerUserId: id,
  nextAction: nextActionInput.optional(),
});
export type AssignLeadInput = z.infer<typeof assignLeadInput>;

export const releaseLeadInput = z.object({
  leadId: id,
  expectedVersion: version,
  reason: text(500),
});
export type ReleaseLeadInput = z.infer<typeof releaseLeadInput>;

export const logActivityInput = z.object({
  leadId: id,
  expectedVersion: version,
  type: z.enum(MANUAL_ACTIVITY_CODES),
  summary: text(2000),
  occurredAt: isoDate.optional(),
});
export type LogActivityInput = z.infer<typeof logActivityInput>;

export const completeTaskInput = z.object({
  taskId: id,
  expectedVersion: version,
  outcome: z.string().trim().max(1000).optional(),
  nextAction: nextActionInput.optional(),
});
export type CompleteTaskInput = z.infer<typeof completeTaskInput>;

export const changeStageInput = z.object({
  leadId: id,
  expectedVersion: version,
  toStage: z.enum(STAGE_CODES),
  lostReason: z.enum(LOST_REASON_CODES).optional(),
  lostNote: z.string().trim().max(1000).optional(),
  wonValue: z.number().int('Giá trị là số nguyên đồng').positive('Giá trị phải lớn hơn 0').max(MAX_DEAL_VALUE).optional(),
  wonNote: z.string().trim().max(1000).optional(),
}).superRefine((v, ctx) => {
  if (v.toStage === 'lost' && !v.lostReason) ctx.addIssue({ code: 'custom', path: ['lostReason'], message: 'Chọn lý do Lost' });
  if (v.toStage === 'lost' && v.lostReason === 'other' && !v.lostNote) ctx.addIssue({ code: 'custom', path: ['lostNote'], message: 'Lý do "Khác" cần ghi chú' });
  if (v.toStage === 'won' && !v.wonValue) ctx.addIssue({ code: 'custom', path: ['wonValue'], message: 'Nhập giá trị chốt' });
  if (v.toStage === 'won' && !v.wonNote) ctx.addIssue({ code: 'custom', path: ['wonNote'], message: 'Ghi chú bằng chứng chốt (hợp đồng, PO…)' });
});
export type ChangeStageInput = z.infer<typeof changeStageInput>;

export const requestOwnerChangeInput = z.object({
  leadId: id,
  expectedVersion: version,
  toUserId: id,
  reason: text(500),
});
export type RequestOwnerChangeInput = z.infer<typeof requestOwnerChangeInput>;

export const decideApprovalInput = z.object({
  approvalId: id,
  expectedVersion: version,
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(500).optional(),
});
export type DecideApprovalInput = z.infer<typeof decideApprovalInput>;

export const upsertProductInput = z.object({
  id: id.optional(),
  version: version.optional(),
  name: text(160),
  description: z.string().trim().max(2000).optional(),
  priceVnd: z.number().int('Giá là số nguyên đồng').min(0, 'Giá không âm').max(MAX_DEAL_VALUE),
  active: z.boolean(),
});
export type UpsertProductInput = z.infer<typeof upsertProductInput>;

export const recordConsentInput = z.object({
  contactId: id,
  purpose: z.enum(CONSENT_PURPOSE_CODES),
  granted: z.boolean(),
  note: z.string().trim().max(500).optional(),
});
export type RecordConsentInput = z.infer<typeof recordConsentInput>;

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày dạng YYYY-MM-DD');

export const createLearnerLeadInput = z.object({
  contactId: id.optional(),
  contactName: text(120).optional(),
  phone: z.string().trim().max(20)
    .refine((v) => v === '' || v.replace(/\D/g, '').length >= 9, 'Số điện thoại cần ít nhất 9 chữ số').optional(),
  email: z.string().trim().email('Email không hợp lệ').max(160).optional(),
  source: z.enum(LEAD_SOURCE_CODES),
  partnerContractId: id.optional(),
  sourceNote: z.string().trim().max(200).optional(),
  needSummary: text(1000),
  productIds: z.array(id).max(20).optional(),
  nextAction: nextActionInput,
  /** Admin only: the Sale or Leader who will hold the customer. */
  ownerUserId: id.optional(),
}).refine((v) => Boolean(v.contactId || v.contactName), { message: 'Cần chọn khách hoặc nhập tên', path: ['contactName'] })
  .refine((v) => v.source !== 'partner' || Boolean(v.partnerContractId), { message: 'Nguồn đối tác cần chọn hợp đồng', path: ['partnerContractId'] });
export type CreateLearnerLeadInput = z.infer<typeof createLearnerLeadInput>;

export const markJourneyStepInput = z.object({
  leadId: id,
  expectedVersion: version,
  stepCode: z.enum(['contacted', 'need_confirmed']),
});
export type MarkJourneyStepInput = z.infer<typeof markJourneyStepInput>;

export const skipTrialInput = z.object({ leadId: id, expectedVersion: version, reason: text(500) });
export type SkipTrialInput = z.infer<typeof skipTrialInput>;

export const winLearnerLeadInput = z.object({
  leadId: id,
  expectedVersion: version,
  note: z.string().trim().max(1000).optional(),
});
export type WinLearnerLeadInput = z.infer<typeof winLearnerLeadInput>;

export const closeLearnerLeadInput = z.object({
  leadId: id,
  expectedVersion: version,
  outcome: z.enum(['lost', 'not_fit']),
  reason: z.enum(LEARNER_LOST_REASON_CODES),
  note: z.string().trim().max(1000).optional(),
}).refine((v) => v.reason !== 'other' || Boolean(v.note), { message: 'Lý do "Khác" cần ghi chú', path: ['note'] });
export type CloseLearnerLeadInput = z.infer<typeof closeLearnerLeadInput>;

export const claimCustomerInput = z.object({ contactId: id, version });
export type ClaimCustomerInput = z.infer<typeof claimCustomerInput>;

export const changeCustomerOwnerInput = z.object({ contactId: id, version, ownerUserId: id });
export type ChangeCustomerOwnerInput = z.infer<typeof changeCustomerOwnerInput>;

export const attachProductInput = z.object({ contactId: id, productId: id });
export type AttachProductInput = z.infer<typeof attachProductInput>;

export const detachProductInput = z.object({ customerProductId: id, version });
export type DetachProductInput = z.infer<typeof detachProductInput>;

const PARTNER_STATUS_CODES = PARTNER_CONTRACT_STATUSES.map((s) => s.code) as [PartnerContractStatus, ...PartnerContractStatus[]];
export const upsertPartnerContractInput = z.object({
  id: id.optional(),
  version: version.optional(),
  accountId: id.optional(),
  accountName: z.string().trim().min(1).max(200).optional(),
  name: text(200),
  status: z.enum(PARTNER_STATUS_CODES),
  startsOn: dateOnly.optional(),
  endsOn: dateOnly.optional(),
  note: z.string().trim().max(1000).optional(),
}).refine((v) => Boolean(v.id || v.accountId || v.accountName), { message: 'Chọn hoặc nhập tên đối tác', path: ['accountName'] })
  .refine((v) => !v.startsOn || !v.endsOn || v.startsOn <= v.endsOn, { message: 'Ngày kết thúc phải sau ngày bắt đầu', path: ['endsOn'] });
export type UpsertPartnerContractInput = z.infer<typeof upsertPartnerContractInput>;

export const addContractStepInput = z.object({ contractId: id, name: text(200) });
export type AddContractStepInput = z.infer<typeof addContractStepInput>;

export const toggleContractStepInput = z.object({ stepId: id, version, done: z.boolean() });
export type ToggleContractStepInput = z.infer<typeof toggleContractStepInput>;

export const importContractLearnersInput = z.object({
  contractId: id,
  csv: z.string().max(512_000, 'File quá lớn (tối đa 500 KB)'),
  commit: z.boolean(),
  /** Admin only: the Sale or Leader who will hold the imported customers. */
  ownerUserId: id.optional(),
});
export type ImportContractLearnersInput = z.infer<typeof importContractLearnersInput>;

const COURSE_STATUS_CODES = ['active', 'closed'] as const;
const CLASS_STATUS_CODES = ['open', 'cancelled', 'finished'] as const;
const SESSION_STATUS_CODES = ['scheduled', 'cancelled'] as const;
const minutes = z.number().int('Thời lượng là số phút nguyên').positive('Thời lượng phải lớn hơn 0').max(24 * 60);
const optionalNote = z.string().trim().max(1000).optional();

export const upsertCourseInput = z.object({
  id: id.optional(),
  version: version.optional(),
  productId: id,
  name: text(160),
  status: z.enum(COURSE_STATUS_CODES),
});
export type UpsertCourseInput = z.infer<typeof upsertCourseInput>;

export const upsertClassInput = z.object({
  id: id.optional(),
  version: version.optional(),
  courseId: id,
  name: text(160),
  scheduleText: z.string().trim().max(200).optional(),
  note: optionalNote,
  status: z.enum(CLASS_STATUS_CODES),
});
export type UpsertClassInput = z.infer<typeof upsertClassInput>;

export const setClassTeachersInput = z.object({
  classId: id,
  version,
  teacherUserIds: z.array(id).max(10),
});
export type SetClassTeachersInput = z.infer<typeof setClassTeachersInput>;

export const addSessionInput = z.object({
  classId: id,
  startsAt: isoDate,
  durationMinutes: minutes,
  kind: z.enum(['regular', 'trial']),
  note: optionalNote,
});
export type AddSessionInput = z.infer<typeof addSessionInput>;

export const updateSessionInput = z.object({
  sessionId: id,
  version,
  startsAt: isoDate.optional(),
  durationMinutes: minutes.optional(),
  note: optionalNote,
  status: z.enum(SESSION_STATUS_CODES).optional(),
});
export type UpdateSessionInput = z.infer<typeof updateSessionInput>;

export const bookTrialInput = z.object({ leadId: id, expectedVersion: version, sessionId: id });
export type BookTrialInput = z.infer<typeof bookTrialInput>;

export const reserveSeatInput = z.object({ leadId: id, expectedVersion: version, classId: id });
export type ReserveSeatInput = z.infer<typeof reserveSeatInput>;

export const cancelPendingEnrollmentInput = z.object({ enrollmentId: id, version });
export type CancelPendingEnrollmentInput = z.infer<typeof cancelPendingEnrollmentInput>;

export const confirmEnrollmentInput = z.object({ enrollmentId: id, version });
export type ConfirmEnrollmentInput = z.infer<typeof confirmEnrollmentInput>;

export const deferEnrollmentInput = z.object({ enrollmentId: id, version, until: dateOnly });
export type DeferEnrollmentInput = z.infer<typeof deferEnrollmentInput>;

export const resumeEnrollmentInput = z.object({ enrollmentId: id, version });
export type ResumeEnrollmentInput = z.infer<typeof resumeEnrollmentInput>;

export const transferEnrollmentInput = z.object({ enrollmentId: id, version, toClassId: id });
export type TransferEnrollmentInput = z.infer<typeof transferEnrollmentInput>;

export const endEnrollmentInput = z.object({
  enrollmentId: id,
  version,
  outcome: z.enum(['completed', 'withdrawn']),
});
export type EndEnrollmentInput = z.infer<typeof endEnrollmentInput>;

const attendanceEntryInput = z.object({
  enrollmentId: id.optional(),
  trialBookingId: id.optional(),
  status: z.enum(ATTENDANCE_STATUS_CODES),
  version: z.number().int().nullable(),
}).refine((v) => Boolean(v.enrollmentId) !== Boolean(v.trialBookingId), { message: 'Chọn đúng một học viên' });

export const markAttendanceInput = z.object({
  sessionId: id,
  entries: z.array(attendanceEntryInput).min(1, 'Cần ít nhất một học viên').max(200),
});
export type MarkAttendanceInput = z.infer<typeof markAttendanceInput>;

export const createMakeupSessionInput = z.object({
  attendanceId: id,
  startsAt: isoDate,
  durationMinutes: minutes,
  note: optionalNote,
});
export type CreateMakeupSessionInput = z.infer<typeof createMakeupSessionInput>;

const moneyAmount = z.number().int('Số tiền là số nguyên đồng').positive('Số tiền phải lớn hơn 0').max(MAX_DEAL_VALUE);
const signedAmount = z.number().int('Số tiền là số nguyên đồng').min(-MAX_DEAL_VALUE).max(MAX_DEAL_VALUE);

export const createChargeInput = z.object({
  contactId: id,
  enrollmentId: id.optional(),
  kind: z.enum(CHARGE_KIND_CODES),
  amountVnd: signedAmount,
  sessionsCount: z.number().int().positive().max(10_000).optional(),
  note: optionalNote,
}).refine((v) => v.kind !== 'tuition' || Boolean(v.enrollmentId), { message: 'Học phí cần một ghi danh', path: ['enrollmentId'] })
  .refine((v) => (v.kind === 'adjustment' ? v.amountVnd !== 0 : v.amountVnd > 0), {
    message: 'Số tiền không hợp lệ', path: ['amountVnd'],
  });
export type CreateChargeInput = z.infer<typeof createChargeInput>;

export const voidChargeInput = z.object({ chargeId: id, version, reason: text(500) });
export type VoidChargeInput = z.infer<typeof voidChargeInput>;

export const recordPaymentInput = z.object({
  direction: z.enum(['in', 'refund']),
  method: z.enum(PAYMENT_METHOD_CODES),
  amountVnd: moneyAmount,
  receivedAt: isoDate,
  memo: z.string().trim().max(500).optional(),
  payerNote: z.string().trim().max(500).optional(),
  /** Optional learner for a refund, so the refund shows on that learner's ledger. Ignored for money coming in. */
  contactId: id.optional(),
});
export type RecordPaymentInput = z.infer<typeof recordPaymentInput>;

export const allocatePaymentInput = z.object({
  paymentId: id,
  version,
  allocations: z.array(z.object({ chargeId: id, amountVnd: moneyAmount })).min(1).max(50),
});
export type AllocatePaymentInput = z.infer<typeof allocatePaymentInput>;

export const revokeAllocationInput = z.object({ allocationId: id, version, reason: text(500) });
export type RevokeAllocationInput = z.infer<typeof revokeAllocationInput>;

export const setInvoiceRefInput = z.object({ chargeId: id, version, invoiceRef: text(60) });
export type SetInvoiceRefInput = z.infer<typeof setInvoiceRefInput>;

export const moveEnrollmentChargesInput = z.object({ fromEnrollmentId: id, toEnrollmentId: id, version });
export type MoveEnrollmentChargesInput = z.infer<typeof moveEnrollmentChargesInput>;

export const updateOrgBankInput = z.object({
  version,
  bankName: text(120),
  bankAccountNo: text(40),
  bankAccountHolder: text(120),
});
export type UpdateOrgBankInput = z.infer<typeof updateOrgBankInput>;

export const createPrivacyRequestInput = z.object({
  contactId: id,
  kind: z.enum(PRIVACY_REQUEST_KIND_CODES),
  detail: optionalNote,
});
export type CreatePrivacyRequestInput = z.infer<typeof createPrivacyRequestInput>;

export const resolvePrivacyRequestInput = z.object({
  requestId: id,
  version,
  status: z.enum(['done', 'rejected']),
  resolution: text(1000),
});
export type ResolvePrivacyRequestInput = z.infer<typeof resolvePrivacyRequestInput>;

export const anonymizeContactInput = z.object({
  contactId: id,
  version,
  requestId: id,
});
export type AnonymizeContactInput = z.infer<typeof anonymizeContactInput>;

type RiskLevel = 'low' | 'medium' | 'high';
interface CommandDefinition {
  schema: z.ZodType;
  /** Roles allowed by permission-matrix-v1; record scope is still checked per target. Admin writes organization-wide but never decides approvals. */
  roles: readonly RoleCode[];
  riskLevel: RiskLevel;
  idempotent: true;
  expectedVersion: boolean;
  /** Agent-originated calls need human approval (action-risk matrix). */
  agentNeedsApproval: boolean;
}

export const COMMANDS = {
  createLead: { schema: createLeadInput, roles: ['sale', 'leader', 'head', 'director', 'admin'], riskLevel: 'low', idempotent: true, expectedVersion: false, agentNeedsApproval: false },
  assignLead: { schema: assignLeadInput, roles: ['leader', 'admin'], riskLevel: 'medium', idempotent: true, expectedVersion: true, agentNeedsApproval: true },
  releaseLead: { schema: releaseLeadInput, roles: ['leader'], riskLevel: 'medium', idempotent: true, expectedVersion: true, agentNeedsApproval: true },
  logActivity: { schema: logActivityInput, roles: ['sale', 'leader', 'head', 'director', 'admin'], riskLevel: 'low', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  completeTask: { schema: completeTaskInput, roles: ['sale', 'leader', 'head', 'director', 'admin'], riskLevel: 'low', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  changeStage: { schema: changeStageInput, roles: ['sale', 'leader', 'head', 'director', 'admin'], riskLevel: 'high', idempotent: true, expectedVersion: true, agentNeedsApproval: true },
  requestOwnerChange: { schema: requestOwnerChangeInput, roles: ['sale'], riskLevel: 'medium', idempotent: true, expectedVersion: true, agentNeedsApproval: true },
  decideApproval: { schema: decideApprovalInput, roles: ['sale', 'leader'], riskLevel: 'high', idempotent: true, expectedVersion: true, agentNeedsApproval: true },
  upsertProduct: { schema: upsertProductInput, roles: ['academic', 'admin'], riskLevel: 'low', idempotent: true, expectedVersion: false, agentNeedsApproval: false },
  recordConsent: { schema: recordConsentInput, roles: ['sale', 'leader', 'admin'], riskLevel: 'low', idempotent: true, expectedVersion: false, agentNeedsApproval: false },
  createLearnerLead: { schema: createLearnerLeadInput, roles: ['sale', 'leader', 'admin'], riskLevel: 'low', idempotent: true, expectedVersion: false, agentNeedsApproval: false },
  markJourneyStep: { schema: markJourneyStepInput, roles: ['sale', 'leader', 'admin'], riskLevel: 'low', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  skipTrial: { schema: skipTrialInput, roles: ['sale', 'leader', 'admin'], riskLevel: 'low', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  winLearnerLead: { schema: winLearnerLeadInput, roles: ['sale', 'leader', 'admin'], riskLevel: 'high', idempotent: true, expectedVersion: true, agentNeedsApproval: true },
  closeLearnerLead: { schema: closeLearnerLeadInput, roles: ['sale', 'leader', 'admin'], riskLevel: 'high', idempotent: true, expectedVersion: true, agentNeedsApproval: true },
  claimCustomer: { schema: claimCustomerInput, roles: ['sale', 'leader'], riskLevel: 'medium', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  changeCustomerOwner: { schema: changeCustomerOwnerInput, roles: ['leader', 'admin'], riskLevel: 'medium', idempotent: true, expectedVersion: true, agentNeedsApproval: true },
  attachProduct: { schema: attachProductInput, roles: ['sale', 'leader', 'admin'], riskLevel: 'low', idempotent: true, expectedVersion: false, agentNeedsApproval: false },
  detachProduct: { schema: detachProductInput, roles: ['sale', 'leader', 'admin'], riskLevel: 'low', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  upsertPartnerContract: { schema: upsertPartnerContractInput, roles: ['sale', 'leader', 'admin'], riskLevel: 'low', idempotent: true, expectedVersion: false, agentNeedsApproval: false },
  addContractStep: { schema: addContractStepInput, roles: ['sale', 'leader', 'admin'], riskLevel: 'low', idempotent: true, expectedVersion: false, agentNeedsApproval: false },
  toggleContractStep: { schema: toggleContractStepInput, roles: ['sale', 'leader', 'admin'], riskLevel: 'low', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  importContractLearners: { schema: importContractLearnersInput, roles: ['sale', 'leader', 'admin'], riskLevel: 'low', idempotent: true, expectedVersion: false, agentNeedsApproval: false },
  upsertCourse: { schema: upsertCourseInput, roles: ['academic', 'admin'], riskLevel: 'low', idempotent: true, expectedVersion: false, agentNeedsApproval: false },
  upsertClass: { schema: upsertClassInput, roles: ['academic', 'admin'], riskLevel: 'low', idempotent: true, expectedVersion: false, agentNeedsApproval: false },
  setClassTeachers: { schema: setClassTeachersInput, roles: ['academic', 'admin'], riskLevel: 'low', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  addSession: { schema: addSessionInput, roles: ['academic', 'admin'], riskLevel: 'low', idempotent: true, expectedVersion: false, agentNeedsApproval: false },
  updateSession: { schema: updateSessionInput, roles: ['academic', 'admin'], riskLevel: 'low', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  bookTrial: { schema: bookTrialInput, roles: ['sale', 'leader', 'admin'], riskLevel: 'low', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  reserveSeat: { schema: reserveSeatInput, roles: ['sale', 'leader', 'admin'], riskLevel: 'low', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  cancelPendingEnrollment: { schema: cancelPendingEnrollmentInput, roles: ['sale', 'leader', 'admin'], riskLevel: 'low', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  confirmEnrollment: { schema: confirmEnrollmentInput, roles: ['academic', 'admin'], riskLevel: 'medium', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  deferEnrollment: { schema: deferEnrollmentInput, roles: ['academic', 'admin'], riskLevel: 'medium', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  resumeEnrollment: { schema: resumeEnrollmentInput, roles: ['academic', 'admin'], riskLevel: 'medium', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  transferEnrollment: { schema: transferEnrollmentInput, roles: ['academic', 'admin'], riskLevel: 'medium', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  endEnrollment: { schema: endEnrollmentInput, roles: ['academic', 'admin'], riskLevel: 'medium', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  markAttendance: { schema: markAttendanceInput, roles: ['teacher', 'academic', 'admin'], riskLevel: 'medium', idempotent: true, expectedVersion: false, agentNeedsApproval: false },
  createMakeupSession: { schema: createMakeupSessionInput, roles: ['academic', 'admin'], riskLevel: 'low', idempotent: true, expectedVersion: false, agentNeedsApproval: false },
  createCharge: { schema: createChargeInput, roles: ['accountant', 'admin'], riskLevel: 'medium', idempotent: true, expectedVersion: false, agentNeedsApproval: false },
  voidCharge: { schema: voidChargeInput, roles: ['accountant', 'admin'], riskLevel: 'high', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  recordPayment: { schema: recordPaymentInput, roles: ['accountant', 'admin'], riskLevel: 'high', idempotent: true, expectedVersion: false, agentNeedsApproval: false },
  allocatePayment: { schema: allocatePaymentInput, roles: ['accountant', 'admin'], riskLevel: 'high', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  revokeAllocation: { schema: revokeAllocationInput, roles: ['accountant', 'admin'], riskLevel: 'high', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  setInvoiceRef: { schema: setInvoiceRefInput, roles: ['accountant', 'admin'], riskLevel: 'low', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  moveEnrollmentCharges: { schema: moveEnrollmentChargesInput, roles: ['accountant', 'admin'], riskLevel: 'medium', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  updateOrgBank: { schema: updateOrgBankInput, roles: ['admin'], riskLevel: 'high', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  createPrivacyRequest: { schema: createPrivacyRequestInput, roles: ['sale', 'leader', 'academic', 'accountant', 'admin'], riskLevel: 'low', idempotent: true, expectedVersion: false, agentNeedsApproval: false },
  resolvePrivacyRequest: { schema: resolvePrivacyRequestInput, roles: ['admin'], riskLevel: 'medium', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  anonymizeContact: { schema: anonymizeContactInput, roles: ['admin'], riskLevel: 'high', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
} as const satisfies Record<string, CommandDefinition>;
export type CommandName = keyof typeof COMMANDS;

// Password login (ADR-006). Internal tool, so the rules are deliberately moderate.
export const PASSWORD_MIN_LENGTH = 8;
const password = z.string().min(1, 'Bắt buộc').max(200);
export const loginInput = z.object({ email: z.string().trim().min(1, 'Bắt buộc').max(160), password });
export const changePasswordInput = z.object({
  currentPassword: password,
  newPassword: z.string().min(PASSWORD_MIN_LENGTH, `Tối thiểu ${PASSWORD_MIN_LENGTH} ký tự`).max(200),
});

// Admin user management (accounts, roster, Lark link).
export const rosterImportInput = z.object({
  csv: z.string().max(512_000, 'File quá lớn (tối đa 500 KB)'),
  issueTempPasswords: z.boolean().optional(),
});
const optionalName = z.string().trim().max(120).nullable().optional();
export const updateUserInput = z.object({
  version,
  name: text(120).optional(),
  email: z.string().trim().email('Email không hợp lệ').max(160).optional(),
  role: z.enum(ROLE_CODES).optional(),
  departmentName: optionalName,
  teamName: optionalName,
});
export const userStatusInput = z.object({ version, status: z.enum(['active', 'disabled']) });
export const versionInput = z.object({ version });
export const agentKillSwitchInput = z.object({ enabled: z.boolean() });
// A retry list stays small: D1 caps bound parameters per query.
export const larkLinkInput = z.object({ userIds: z.array(id).min(1).max(50).optional() });

export * from './working-time';
