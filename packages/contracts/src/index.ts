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
export const stageLabel = (code: string) => STAGES.find((s) => s.code === code)?.label ?? code;

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
] as const;
export type RoleCode = (typeof ROLES)[number]['code'];

// ADR-005 stable error codes. NOT_FOUND and IDEMPOTENCY_CONFLICT are transport-level additions.
export const ERROR_CODES = [
  'FORBIDDEN', 'STALE_VERSION', 'APPROVAL_REQUIRED', 'KILL_SWITCH_ON', 'DUPLICATE_SUSPECTED',
  'VALIDATION_FAILED', 'NOT_FOUND', 'IDEMPOTENCY_CONFLICT', 'UNAUTHENTICATED', 'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  code: ErrorCode;
  message: string;
  fields?: Record<string, string>;
  details?: unknown;
}
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

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
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().email('Email không hợp lệ').max(160).optional(),
  companyName: z.string().trim().max(200).optional(),
  taxCode: z.string().trim().max(20).optional(),
  source: z.enum(LEAD_SOURCE_CODES),
  needSummary: text(1000),
  confirmNotDuplicate: z.boolean().optional(),
  nextAction: nextActionInput.optional(),
}).refine((v) => Boolean(v.phone || v.email), { message: 'Cần số điện thoại hoặc email', path: ['phone'] });
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
}).superRefine((v, ctx) => {
  if (v.toStage === 'lost' && !v.lostReason) ctx.addIssue({ code: 'custom', path: ['lostReason'], message: 'Chọn lý do Lost' });
  if (v.toStage === 'lost' && v.lostReason === 'other' && !v.lostNote) ctx.addIssue({ code: 'custom', path: ['lostNote'], message: 'Lý do "Khác" cần ghi chú' });
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

type RiskLevel = 'low' | 'medium' | 'high';
interface CommandDefinition {
  schema: z.ZodType;
  /** Roles allowed by permission-matrix-v1; record scope is still checked per target. Admin has no business write. */
  roles: readonly RoleCode[];
  riskLevel: RiskLevel;
  idempotent: true;
  expectedVersion: boolean;
  /** Agent-originated calls need human approval (action-risk matrix). */
  agentNeedsApproval: boolean;
}

export const COMMANDS = {
  createLead: { schema: createLeadInput, roles: ['sale', 'leader', 'head', 'director'], riskLevel: 'low', idempotent: true, expectedVersion: false, agentNeedsApproval: false },
  assignLead: { schema: assignLeadInput, roles: ['leader'], riskLevel: 'medium', idempotent: true, expectedVersion: true, agentNeedsApproval: true },
  releaseLead: { schema: releaseLeadInput, roles: ['leader'], riskLevel: 'medium', idempotent: true, expectedVersion: true, agentNeedsApproval: true },
  logActivity: { schema: logActivityInput, roles: ['sale', 'leader', 'head', 'director'], riskLevel: 'low', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  completeTask: { schema: completeTaskInput, roles: ['sale', 'leader', 'head', 'director'], riskLevel: 'low', idempotent: true, expectedVersion: true, agentNeedsApproval: false },
  changeStage: { schema: changeStageInput, roles: ['sale', 'leader', 'head', 'director'], riskLevel: 'high', idempotent: true, expectedVersion: true, agentNeedsApproval: true },
  requestOwnerChange: { schema: requestOwnerChangeInput, roles: ['sale'], riskLevel: 'medium', idempotent: true, expectedVersion: true, agentNeedsApproval: true },
  decideApproval: { schema: decideApprovalInput, roles: ['sale', 'leader'], riskLevel: 'high', idempotent: true, expectedVersion: true, agentNeedsApproval: true },
} as const satisfies Record<string, CommandDefinition>;
export type CommandName = keyof typeof COMMANDS;

export * from './working-time';
