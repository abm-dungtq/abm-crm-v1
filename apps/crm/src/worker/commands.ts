import {
  ACTIVITY_BACKDATE_DAYS, COMMANDS, FIRST_CONTACT_SLA_HOURS, RELEASE_AFTER_HOURS, ACTIVITY_TYPES, addWorkingHours, allowedTransitions,
  foldText, lostReasonLabel, normalizeEmail, normalizePhone, stageLabel, workingMinutesBetween,
  type ApiError, type ApiResult, type AssignLeadInput, type ChangeStageInput, type CommandName,
  type CompleteTaskInput, type CreateLeadInput, type DecideApprovalInput, type LogActivityInput,
  type NextActionInput, type ReleaseLeadInput, type RequestOwnerChangeInput, type StageCode,
} from '@abm/contracts';
import type { z } from 'zod';
import type { Actor } from './env';
import { GuardedTx, isGuardFailure } from './guarded-tx';
import { canSeeLead, leaderOnly, leadScope, mayDecideApproval } from './scope';

export interface LeadRow {
  id: string;
  code: string;
  organization_id: string;
  department_id: string;
  team_id: string | null;
  account_id: string | null;
  contact_id: string;
  owner_user_id: string | null;
  stage: StageCode;
  status: 'queue' | 'active' | 'won' | 'lost';
  next_action_task_id: string | null;
  first_contact_at: string | null;
  assigned_at: string | null;
  created_at: string;
  version: number;
}

interface TaskRow {
  id: string;
  lead_id: string;
  title: string;
  assignee_user_id: string;
  status: 'open' | 'completed' | 'cancelled';
  version: number;
}

interface ApprovalRow {
  id: string;
  kind: 'owner_change' | 'agent_stage_change';
  lead_id: string;
  target_version: number;
  payload_json: string;
  status: string;
  version: number;
}

const fail = (code: ApiError['code'], message: string, extra?: Partial<ApiError>): ApiResult<never> =>
  ({ ok: false, error: { code, message, ...extra } });
const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data });

type Ctx<I> = { db: D1Database; actor: Actor; input: I; tx: GuardedTx };
type Handler<I> = (ctx: Ctx<I>) => Promise<ApiResult<unknown>>;

const handlers: { [K in CommandName]: Handler<z.infer<(typeof COMMANDS)[K]['schema']>> } = {
  createLead, assignLead, releaseLead, logActivity, completeTask, changeStage, requestOwnerChange, decideApproval,
};

async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function replay(db: D1Database, actor: Actor, key: string, command: string, hash: string) {
  const stored = await db.prepare(`SELECT command, request_hash, result_json FROM idempotency_key
    WHERE actor_user_id = ? AND key = ?`).bind(actor.id, key).first<{ command: string; request_hash: string; result_json: string }>();
  if (!stored) return null;
  if (stored.command !== command || stored.request_hash !== hash) {
    return fail('IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã dùng cho yêu cầu khác');
  }
  return JSON.parse(stored.result_json) as ApiResult<unknown>;
}

// A missing switch row counts as off, so an emptied table never blocks every agent write.
const AGENT_WRITES_OPEN = 'SELECT COALESCE(MAX(enabled), 0) = 0 FROM agent_kill_switch WHERE id = 1';

async function agentWritesBlocked(db: D1Database) {
  const row = await db.prepare(`SELECT (${AGENT_WRITES_OPEN}) AS open`).first<{ open: number }>();
  return row?.open !== 1;
}

const killSwitchOn = () => fail('KILL_SWITCH_ON', 'Bot đang bị tạm khóa ghi dữ liệu');

/** ADR-005 command pipeline: role → schema → idempotency → handler → one guarded batch. */
export async function runCommand(db: D1Database, actor: Actor, name: CommandName, raw: unknown, idempotencyKey: string | undefined): Promise<ApiResult<unknown>> {
  const definition = COMMANDS[name];
  if (!(definition.roles as readonly string[]).includes(actor.role)) {
    return fail('FORBIDDEN', 'Vai trò hiện tại không được thực hiện thao tác này');
  }
  if (actor.kind === 'agent' && await agentWritesBlocked(db)) return killSwitchOn();
  if (!idempotencyKey || idempotencyKey.length > 100) {
    return fail('VALIDATION_FAILED', 'Thiếu Idempotency-Key');
  }
  const parsed = definition.schema.safeParse(raw);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join('.') || '_'] ??= issue.message;
    return fail('VALIDATION_FAILED', 'Dữ liệu chưa hợp lệ', { fields });
  }
  const hash = await sha256(JSON.stringify(parsed.data));
  const previous = await replay(db, actor, idempotencyKey, name, hash);
  if (previous) return replayInScope(db, actor, name, parsed.data, previous);

  const tx = new GuardedTx(db, actor, name);
  const handler = handlers[name] as Handler<unknown>;
  const result = await handler({ db, actor, input: parsed.data, tx });
  if (!result.ok) return result;
  tx.idempotency(idempotencyKey, hash, result);
  // Re-checked inside the batch so a switch flipped after the pre-check still stops the write.
  if (actor.kind === 'agent') tx.assert(AGENT_WRITES_OPEN, []);
  try {
    await tx.commit();
    return result;
  } catch (error) {
    const concurrent = await replay(db, actor, idempotencyKey, name, hash);
    if (concurrent) return replayInScope(db, actor, name, parsed.data, concurrent);
    if (actor.kind === 'agent' && isGuardFailure(error) && await agentWritesBlocked(db)) return killSwitchOn();
    if (isGuardFailure(error)) return fail('STALE_VERSION', 'Dữ liệu vừa được người khác cập nhật. Tải lại rồi thử lại.');
    throw error;
  }
}

/**
 * A stored result is only returned while the actor can still see the lead it touched, so a
 * replay never discloses a target the actor has since lost access to. A createLead replay is
 * exempt: it only returns the id the creator already received, and refusing it would push a
 * retrying client into creating a duplicate.
 */
async function replayInScope(db: D1Database, actor: Actor, name: CommandName, input: unknown, stored: ApiResult<unknown>): Promise<ApiResult<unknown>> {
  if (name === 'createLead') return stored;
  const fields = input as { leadId?: string; taskId?: string; approvalId?: string };
  const leadId = fields.leadId
    ?? (fields.taskId ? (await db.prepare('SELECT lead_id FROM task WHERE id = ?').bind(fields.taskId).first<{ lead_id: string }>())?.lead_id : undefined)
    ?? (fields.approvalId ? (await db.prepare('SELECT lead_id FROM approval WHERE id = ?').bind(fields.approvalId).first<{ lead_id: string }>())?.lead_id : undefined);
  if (leadId && !(await canSeeLead(db, actor, leadId))) return notFound();
  return stored;
}

// ---------- helpers ----------

async function loadLead(db: D1Database, actor: Actor, leadId: string) {
  if (!(await canSeeLead(db, actor, leadId))) return null;
  return db.prepare('SELECT * FROM lead WHERE id = ?').bind(leadId).first<LeadRow>();
}

const notFound = () => fail('NOT_FOUND', 'Không tìm thấy lead trong phạm vi của bạn');
const stale = () => fail('STALE_VERSION', 'Lead đã thay đổi. Tải lại để xem bản mới nhất.');

function defaultFirstContact(now: Date): NextActionInput {
  return { title: 'Liên hệ lần đầu', dueAt: addWorkingHours(now, FIRST_CONTACT_SLA_HOURS).toISOString() };
}

async function loadTeamMember(db: D1Database, userId: string, teamId: string | null) {
  return db.prepare(`SELECT id, display_name, team_id, department_id FROM app_user
    WHERE id = ? AND team_id = ? AND status = 'active' AND role IN ('sale', 'leader')`)
    .bind(userId, teamId).first<{ id: string; display_name: string; team_id: string; department_id: string }>();
}

/**
 * Moves an active lead to a new owner. The open next action follows the owner so the
 * Forced Next Action invariant keeps pointing at a task the new owner can act on.
 */
async function applyOwnerChange(db: D1Database, tx: GuardedTx, lead: LeadRow, expectedVersion: number, toUser: { id: string; display_name: string; team_id: string }, reason: string) {
  const fromName = lead.owner_user_id
    ? (await db.prepare('SELECT display_name FROM app_user WHERE id = ?').bind(lead.owner_user_id).first<{ display_name: string }>())?.display_name
    : null;
  tx.update('lead', lead.id, expectedVersion, { owner_user_id: toUser.id, team_id: toUser.team_id, assigned_at: tx.now });
  if (lead.next_action_task_id) {
    const task = await db.prepare('SELECT * FROM task WHERE id = ?').bind(lead.next_action_task_id).first<TaskRow>();
    if (task?.status === 'open') tx.update('task', task.id, task.version, { assignee_user_id: toUser.id });
  }
  tx.activity(lead.id, 'owner_changed', `Chuyển owner ${fromName ?? '—'} → ${toUser.display_name}. ${reason}`.trim());
  tx.audit('lead', lead.id, { owner_user_id: lead.owner_user_id }, { owner_user_id: toUser.id, reason });
  tx.event('lead.ownerChanged', { leadId: lead.id, from: lead.owner_user_id, to: toUser.id });
}

/** Validates and stages a stage transition (QĐ1/QĐ6 state machine, MVP1: forward one step only). */
type StageChange = Pick<ChangeStageInput, 'toStage' | 'lostReason' | 'lostNote' | 'wonValue' | 'wonNote'>;

async function applyStageChange(db: D1Database, tx: GuardedTx, lead: LeadRow, expectedVersion: number, input: StageChange, via?: string): Promise<ApiResult<unknown> | null> {
  if (lead.status !== 'active') return fail('VALIDATION_FAILED', 'Chỉ lead đang mở mới đổi được stage');
  if (!allowedTransitions(lead.stage).includes(input.toStage)) {
    return fail('VALIDATION_FAILED', `Không chuyển được từ "${stageLabel(lead.stage)}" sang "${stageLabel(input.toStage)}". MVP1 chỉ tiến một bước, Won chỉ từ Chờ chốt.`, { fields: { toStage: 'Chuyển stage không hợp lệ' } });
  }
  if (lead.stage === 'new' && input.toStage !== 'lost' && !lead.first_contact_at) {
    return fail('VALIDATION_FAILED', 'Cần ghi nhận liên hệ lần đầu (cuộc gọi, tin nhắn, email, gặp mặt) trước khi sang Đã liên hệ.', { fields: { toStage: 'Chưa có liên hệ lần đầu' } });
  }
  const won = input.toStage === 'won';
  if (won && (!input.wonValue || !input.wonNote)) {
    return fail('VALIDATION_FAILED', 'Won cần giá trị chốt và ghi chú bằng chứng', { fields: { wonValue: 'Bắt buộc', wonNote: 'Bắt buộc' } });
  }
  const terminal = won || input.toStage === 'lost';
  const set: Record<string, unknown> = { stage: input.toStage, stage_entered_at: tx.now };
  if (terminal) {
    Object.assign(set, {
      status: input.toStage, closed_at: tx.now, next_action_task_id: null,
      lost_reason: input.toStage === 'lost' ? input.lostReason : null,
      lost_note: input.toStage === 'lost' ? input.lostNote ?? null : null,
    });
  }
  if (won) Object.assign(set, { expected_value: input.wonValue, won_note: input.wonNote });
  tx.update('lead', lead.id, expectedVersion, set);
  if (terminal) {
    const open = await db.prepare(`SELECT id, version FROM task WHERE lead_id = ? AND status = 'open'`).bind(lead.id).all<{ id: string; version: number }>();
    for (const task of open.results) tx.update('task', task.id, task.version, { status: 'cancelled' });
  }
  const closeText = input.toStage === 'lost' ? ` — ${lostReasonLabel(input.lostReason)}${input.lostNote ? `: ${input.lostNote}` : ''}`
    : won ? ` — ${input.wonValue!.toLocaleString('vi-VN')} đ: ${input.wonNote}` : '';
  tx.activity(lead.id, 'stage_changed', `${stageLabel(lead.stage)} → ${stageLabel(input.toStage)}${closeText}${via ? ` (${via})` : ''}`);
  tx.audit('lead', lead.id, { stage: lead.stage, status: lead.status }, { ...set });
  tx.event('lead.stageChanged', { leadId: lead.id, from: lead.stage, to: input.toStage });
  return null;
}

// ---------- handlers ----------

async function createLead({ db, actor, input, tx }: Ctx<CreateLeadInput>) {
  const phone = input.phone ? normalizePhone(input.phone) : null;
  const email = input.email ? normalizeEmail(input.email) : null;
  const taxCode = input.taxCode?.trim() || null;
  const companyName = input.companyName?.trim() || null;

  // Company names are compared folded (case, diacritics, spacing) in JS because SQLite lower() is ASCII-only.
  const companyKey = companyName ? foldText(companyName) : null;
  const sameName = companyKey
    ? (await db.prepare('SELECT id, name FROM account WHERE organization_id = ?').bind(actor.organizationId).all<{ id: string; name: string }>())
      .results.filter((a) => foldText(a.name) === companyKey).map((a) => a.id)
    : [];
  const matches = (await db.prepare(`
    SELECT 'phone' AS field, l.id, l.code, l.stage, u.display_name AS owner FROM contact_point cp
      JOIN lead l ON l.contact_id = cp.contact_id LEFT JOIN app_user u ON u.id = l.owner_user_id
      WHERE cp.type = 'phone' AND cp.normalized_value = ?1 AND l.organization_id = ?5
    UNION SELECT 'email', l.id, l.code, l.stage, u.display_name FROM contact_point cp
      JOIN lead l ON l.contact_id = cp.contact_id LEFT JOIN app_user u ON u.id = l.owner_user_id
      WHERE cp.type = 'email' AND cp.normalized_value = ?2 AND l.organization_id = ?5
    UNION SELECT 'tax_code', l.id, l.code, l.stage, u.display_name FROM account a
      JOIN lead l ON l.account_id = a.id LEFT JOIN app_user u ON u.id = l.owner_user_id
      WHERE a.tax_code = ?3 AND l.organization_id = ?5
    UNION SELECT 'company', l.id, l.code, l.stage, u.display_name FROM lead l LEFT JOIN app_user u ON u.id = l.owner_user_id
      WHERE l.account_id IN (SELECT value FROM json_each(?4)) AND l.organization_id = ?5
    LIMIT 10`).bind(phone, email, taxCode, JSON.stringify(sameName), actor.organizationId)
    .all<{ field: string; id: string; code: string; stage: string; owner: string | null }>()).results;

  // Only leads inside the actor's scope are described (here and in the audit); others are acknowledged without detail.
  const scope = leadScope(actor);
  const visible = matches.length
    ? new Set((await db.prepare(`SELECT l.id FROM lead l WHERE l.id IN (SELECT value FROM json_each(?)) AND ${scope.sql}`)
      .bind(JSON.stringify(matches.map((m) => m.id)), ...scope.binds).all<{ id: string }>()).results.map((r) => r.id))
    : new Set<string>();
  if (matches.length && !input.confirmNotDuplicate) {
    return fail('DUPLICATE_SUSPECTED', 'Có thể trùng với lead đã có. Kiểm tra trước khi tạo.', {
      details: matches.map((m) => visible.has(m.id)
        ? { field: m.field, code: m.code, stage: stageLabel(m.stage), owner: m.owner ?? 'Hàng chờ' }
        : { field: m.field, code: null, stage: null, owner: null, note: 'Đã có trong hệ thống, ngoài phạm vi của bạn' }),
    });
  }

  const isSale = actor.role === 'sale';
  if (isSale && !input.nextAction) {
    return fail('VALIDATION_FAILED', 'Lead tự khai thác phải có Next Action và hạn (QĐ13)', { fields: { 'nextAction.title': 'Bắt buộc' } });
  }
  const departmentId = actor.departmentId
    ?? (await db.prepare('SELECT id FROM department WHERE organization_id = ? ORDER BY created_at LIMIT 1').bind(actor.organizationId).first<{ id: string }>())?.id;
  if (!departmentId) return fail('VALIDATION_FAILED', 'Chưa cấu hình phòng ban');

  let accountId: string | null = null;
  if (taxCode) {
    accountId = (await db.prepare('SELECT id FROM account WHERE organization_id = ? AND tax_code = ?').bind(actor.organizationId, taxCode).first<{ id: string }>())?.id ?? null;
  }
  if (!accountId && companyName) {
    accountId = crypto.randomUUID();
    tx.raw(db.prepare(`INSERT INTO account (id, organization_id, name, tax_code, created_at, updated_at, last_txn_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(accountId, actor.organizationId, companyName, taxCode, tx.now, tx.now, tx.txnId));
  }
  const contactId = crypto.randomUUID();
  tx.raw(db.prepare(`INSERT INTO contact (id, organization_id, display_name, created_at, updated_at, last_txn_id)
    VALUES (?, ?, ?, ?, ?, ?)`).bind(contactId, actor.organizationId, input.contactName, tx.now, tx.now, tx.txnId));
  if (accountId) {
    tx.raw(db.prepare(`INSERT INTO account_contact (id, account_id, contact_id, is_primary, created_at) VALUES (?, ?, ?, 1, ?)`)
      .bind(crypto.randomUUID(), accountId, contactId, tx.now));
  }
  if (phone) tx.raw(db.prepare(`INSERT INTO contact_point (id, contact_id, type, value, normalized_value, created_at) VALUES (?, ?, 'phone', ?, ?, ?)`)
    .bind(crypto.randomUUID(), contactId, input.phone, phone, tx.now));
  if (email) tx.raw(db.prepare(`INSERT INTO contact_point (id, contact_id, type, value, normalized_value, created_at) VALUES (?, ?, 'email', ?, ?, ?)`)
    .bind(crypto.randomUUID(), contactId, input.email, email, tx.now));

  const leadId = crypto.randomUUID();
  const taskId = isSale ? crypto.randomUUID() : null;
  tx.raw(db.prepare('INSERT INTO lead_counter (organization_id, next_value) VALUES (?, 1) ON CONFLICT DO NOTHING').bind(actor.organizationId));
  tx.insertVersioned('lead', {
    id: leadId, organization_id: actor.organizationId, department_id: departmentId,
    team_id: isSale ? actor.teamId : null, account_id: accountId, contact_id: contactId,
    source: input.source, need_summary: input.needSummary,
    owner_user_id: isSale ? actor.id : null, stage: 'new', status: isSale ? 'active' : 'queue',
    next_action_task_id: taskId, assigned_at: isSale ? tx.now : null, stage_entered_at: tx.now,
    created_by_user_id: actor.id,
  }, {
    cols: ['code'],
    exprs: [`(SELECT printf('L-%04d', next_value) FROM lead_counter WHERE organization_id = ?)`],
    binds: [actor.organizationId],
  });
  tx.raw(db.prepare('UPDATE lead_counter SET next_value = next_value + 1 WHERE organization_id = ?').bind(actor.organizationId));
  if (taskId && input.nextAction) {
    tx.insertVersioned('task', {
      id: taskId, lead_id: leadId, title: input.nextAction.title, due_at: new Date(input.nextAction.dueAt).toISOString(),
      assignee_user_id: actor.id, status: 'open', created_by_user_id: actor.id,
    });
  }
  tx.audit('lead', leadId, null, {
    source: input.source, status: isSale ? 'active' : 'queue',
    duplicateOverride: matches.length ? matches.map((m) => `${m.field}:${visible.has(m.id) ? m.code : 'ngoài phạm vi'}`) : undefined,
  });
  tx.event('lead.created', { leadId, source: input.source });
  return ok({ leadId });
}

/**
 * Recipient of an assignment. A Leader assigns within its own team; Admin assigns within the lead's
 * team, or for a queue lead to any team of the lead's department. Recipients are always Sale/Leader.
 */
async function loadAssignee(db: D1Database, actor: Actor, lead: LeadRow, userId: string) {
  if (actor.role === 'leader') return loadTeamMember(db, userId, actor.teamId);
  if (lead.team_id) return loadTeamMember(db, userId, lead.team_id);
  return db.prepare(`SELECT id, display_name, team_id, department_id FROM app_user
    WHERE id = ? AND department_id = ? AND team_id IS NOT NULL AND status = 'active' AND role IN ('sale', 'leader')`)
    .bind(userId, lead.department_id).first<{ id: string; display_name: string; team_id: string; department_id: string }>();
}

async function assignLead({ db, actor, input, tx }: Ctx<AssignLeadInput>) {
  const lead = await loadLead(db, actor, input.leadId);
  if (!lead) return notFound();
  if (lead.version !== input.expectedVersion) return stale();
  const ownTeam = actor.role === 'admin' || lead.team_id === actor.teamId;
  if (lead.status !== 'queue' && !(lead.status === 'active' && ownTeam)) {
    return fail('VALIDATION_FAILED', 'Chỉ giao lead trong hàng chờ hoặc lead đang mở của team');
  }
  const member = await loadAssignee(db, actor, lead, input.ownerUserId);
  if (!member) return fail('VALIDATION_FAILED', 'Người nhận phải là thành viên đang hoạt động của team', { fields: { ownerUserId: 'Không hợp lệ' } });
  const by = actor.role === 'admin' ? 'Admin' : 'Leader';

  if (lead.status === 'active') {
    if (lead.owner_user_id === member.id) return fail('VALIDATION_FAILED', 'Lead đã thuộc người này');
    await applyOwnerChange(db, tx, lead, input.expectedVersion, member, `${by} phân lại`);
    return ok({ leadId: lead.id });
  }
  const action = input.nextAction ?? defaultFirstContact(new Date(tx.now));
  const taskId = crypto.randomUUID();
  tx.update('lead', lead.id, input.expectedVersion, {
    owner_user_id: member.id, team_id: member.team_id, status: 'active', assigned_at: tx.now, next_action_task_id: taskId,
  });
  tx.insertVersioned('task', {
    id: taskId, lead_id: lead.id, title: action.title, due_at: new Date(action.dueAt).toISOString(),
    assignee_user_id: member.id, status: 'open', created_by_user_id: actor.id,
  });
  tx.activity(lead.id, 'owner_changed', `${by} giao cho ${member.display_name}. Next Action: ${action.title}`);
  tx.audit('lead', lead.id, { status: 'queue', owner_user_id: null }, { status: 'active', owner_user_id: member.id, next_action: action });
  tx.event('lead.assigned', { leadId: lead.id, ownerUserId: member.id });
  return ok({ leadId: lead.id });
}

async function releaseLead({ db, actor, input, tx }: Ctx<ReleaseLeadInput>) {
  const lead = await loadLead(db, actor, input.leadId);
  if (!lead || lead.team_id !== actor.teamId) return notFound();
  if (lead.version !== input.expectedVersion) return stale();
  if (lead.status !== 'active' || lead.first_contact_at || !lead.assigned_at) {
    return fail('VALIDATION_FAILED', 'Chỉ nhả lead đã giao mà chưa có liên hệ lần đầu');
  }
  const elapsed = workingMinutesBetween(new Date(lead.assigned_at), new Date(tx.now));
  if (elapsed < RELEASE_AFTER_HOURS * 60) {
    return fail('VALIDATION_FAILED', `Chưa quá ${RELEASE_AFTER_HOURS} giờ làm việc kể từ khi giao (mới ${Math.floor(elapsed / 60)} giờ).`);
  }
  tx.update('lead', lead.id, input.expectedVersion, {
    owner_user_id: null, team_id: null, status: 'queue', next_action_task_id: null, assigned_at: null,
  });
  const open = await db.prepare(`SELECT id, version FROM task WHERE lead_id = ? AND status = 'open'`).bind(lead.id).all<{ id: string; version: number }>();
  for (const task of open.results) tx.update('task', task.id, task.version, { status: 'cancelled' });
  tx.activity(lead.id, 'owner_changed', `Leader nhả lead về hàng chờ: ${input.reason}`);
  tx.audit('lead', lead.id, { status: 'active', owner_user_id: lead.owner_user_id }, { status: 'queue', reason: input.reason });
  tx.event('lead.released', { leadId: lead.id });
  return ok({ leadId: lead.id });
}

async function logActivity({ db, actor, input, tx }: Ctx<LogActivityInput>) {
  const lead = await loadLead(db, actor, input.leadId);
  if (!lead) return notFound();
  if (lead.version !== input.expectedVersion) return stale();
  if (lead.status === 'queue') return fail('VALIDATION_FAILED', 'Lead chưa có owner. Leader cần giao trước.');
  const occurredAt = input.occurredAt ? new Date(input.occurredAt).toISOString() : tx.now;
  if (occurredAt > tx.now) return fail('VALIDATION_FAILED', 'Thời điểm hoạt động không được ở tương lai', { fields: { occurredAt: 'Ở tương lai' } });
  // Backdating is bounded so a late first contact cannot be recorded as on time.
  const backdateLimit = new Date(Date.parse(tx.now) - ACTIVITY_BACKDATE_DAYS * 86_400_000).toISOString();
  const earliest = [lead.assigned_at ?? lead.created_at, backdateLimit].sort().at(-1)!;
  if (occurredAt < earliest) {
    return fail('VALIDATION_FAILED', `Thời điểm hoạt động không được trước lúc lead được giao/tạo và không quá ${ACTIVITY_BACKDATE_DAYS} ngày trước`, { fields: { occurredAt: 'Quá sớm' } });
  }
  const isContact = ACTIVITY_TYPES.find((a) => a.code === input.type)?.contact ?? false;
  const set: Record<string, unknown> = { last_activity_at: occurredAt };
  if (isContact && !lead.first_contact_at) set.first_contact_at = occurredAt;
  tx.update('lead', lead.id, input.expectedVersion, set);
  tx.activity(lead.id, input.type, input.summary, occurredAt);
  tx.audit('lead', lead.id, { first_contact_at: lead.first_contact_at }, { activity: input.type, ...set });
  tx.event('activity.logged', { leadId: lead.id, type: input.type });
  return ok({ leadId: lead.id, firstContact: Boolean(set.first_contact_at) });
}

async function completeTask({ db, actor, input, tx }: Ctx<CompleteTaskInput>) {
  const task = await db.prepare('SELECT * FROM task WHERE id = ?').bind(input.taskId).first<TaskRow>();
  if (!task) return fail('NOT_FOUND', 'Không tìm thấy việc');
  const lead = await loadLead(db, actor, task.lead_id);
  if (!lead) return fail('NOT_FOUND', 'Không tìm thấy việc trong phạm vi của bạn');
  if (task.version !== input.expectedVersion || task.status !== 'open') return stale();
  const isNextAction = lead.next_action_task_id === task.id && lead.status === 'active';
  if (isNextAction && !input.nextAction) {
    return fail('VALIDATION_FAILED', 'Lead đang mở phải có Next Action mới trước khi hoàn thành việc này (QĐ13).', { fields: { 'nextAction.title': 'Bắt buộc' } });
  }
  tx.update('task', task.id, task.version, { status: 'completed', completed_at: tx.now, outcome: input.outcome ?? null });
  let nextTaskId: string | null = null;
  if (input.nextAction && lead.status === 'active' && lead.owner_user_id) {
    nextTaskId = crypto.randomUUID();
    tx.insertVersioned('task', {
      id: nextTaskId, lead_id: lead.id, title: input.nextAction.title, due_at: new Date(input.nextAction.dueAt).toISOString(),
      assignee_user_id: lead.owner_user_id, status: 'open', created_by_user_id: actor.id,
    });
  }
  // Guard the lead even when only the task changes, so the Next Action pointer cannot race.
  // The pointer only moves when the current Next Action is completed; a follow-up from another
  // task stays an extra open task so the existing Next Action is never orphaned.
  const movePointer = nextTaskId && (isNextAction || !lead.next_action_task_id);
  tx.update('lead', lead.id, lead.version, movePointer ? { next_action_task_id: nextTaskId, last_activity_at: tx.now } : { last_activity_at: tx.now });
  tx.activity(lead.id, 'task_completed', `${task.title}${input.outcome ? ` — ${input.outcome}` : ''}${input.nextAction ? `. Tiếp theo: ${input.nextAction.title}` : ''}`);
  tx.audit('task', task.id, { status: 'open' }, { status: 'completed', outcome: input.outcome, next_action_task_id: nextTaskId });
  tx.event('task.completed', { taskId: task.id, leadId: lead.id, nextTaskId });
  return ok({ leadId: lead.id, nextTaskId });
}

async function changeStage({ db, actor, input, tx }: Ctx<ChangeStageInput>) {
  const lead = await loadLead(db, actor, input.leadId);
  if (!lead) return notFound();
  if (lead.version !== input.expectedVersion) return stale();
  const invalid = await applyStageChange(db, tx, lead, input.expectedVersion, input);
  return invalid ?? ok({ leadId: lead.id, stage: input.toStage });
}

async function requestOwnerChange({ db, actor, input, tx }: Ctx<RequestOwnerChangeInput>) {
  const lead = await loadLead(db, actor, input.leadId);
  if (!lead) return notFound();
  if (lead.version !== input.expectedVersion) return stale();
  if (lead.status !== 'active') return fail('VALIDATION_FAILED', 'Chỉ chuyển owner lead đang mở');
  if (input.toUserId === lead.owner_user_id) return fail('VALIDATION_FAILED', 'Người nhận đang là owner');
  const member = await loadTeamMember(db, input.toUserId, lead.team_id);
  if (!member) return fail('VALIDATION_FAILED', 'Người nhận phải cùng team', { fields: { toUserId: 'Không hợp lệ' } });
  const pending = await db.prepare(`SELECT 1 FROM approval WHERE lead_id = ? AND kind = 'owner_change' AND status = 'pending'`).bind(lead.id).first();
  if (pending) return fail('VALIDATION_FAILED', 'Lead đã có yêu cầu chuyển owner đang chờ duyệt');
  const approvalId = crypto.randomUUID();
  tx.insertVersioned('approval', {
    id: approvalId, kind: 'owner_change', lead_id: lead.id, target_version: lead.version,
    payload_json: JSON.stringify({ fromUserId: lead.owner_user_id, toUserId: member.id }),
    reason: input.reason, status: 'pending', requested_by_user_id: actor.id, requested_by_kind: actor.kind,
  });
  // The pre-read above cannot lock; this keeps two concurrent requests from both landing.
  tx.assert(`SELECT COUNT(*) = 1 FROM approval WHERE lead_id = ? AND kind = 'owner_change' AND status = 'pending'`, [lead.id]);
  tx.audit('approval', approvalId, null, { kind: 'owner_change', leadId: lead.id, toUserId: member.id, reason: input.reason });
  tx.event('approval.requested', { approvalId, leadId: lead.id, kind: 'owner_change' });
  return ok({ approvalId });
}

async function decideApproval({ db, actor, input, tx }: Ctx<DecideApprovalInput>) {
  const approval = await db.prepare('SELECT * FROM approval WHERE id = ?').bind(input.approvalId).first<ApprovalRow>();
  if (!approval) return fail('NOT_FOUND', 'Không tìm thấy yêu cầu duyệt');
  const lead = await loadLead(db, actor, approval.lead_id);
  if (!lead) return fail('NOT_FOUND', 'Không tìm thấy yêu cầu duyệt trong phạm vi của bạn');
  if (approval.version !== input.expectedVersion || approval.status !== 'pending') return stale();

  const payload = JSON.parse(approval.payload_json) as {
    toUserId?: string; toStage?: StageCode; lostReason?: ChangeStageInput['lostReason']; lostNote?: string;
    wonValue?: number; wonNote?: string; agentName?: string;
  };
  if (!mayDecideApproval(actor, approval.kind, payload.toStage, lead)) {
    return fail('FORBIDDEN', leaderOnly(approval.kind, payload.toStage) ? 'Chỉ Leader của team duyệt chuyển owner hoặc Won/Lost (QĐ14, action-risk matrix)' : 'Chỉ owner hoặc Leader của team duyệt đề xuất này');
  }

  const decision = { decided_by_user_id: actor.id, decided_at: tx.now, decision_note: input.note ?? null };
  if (input.decision === 'reject') {
    tx.update('approval', approval.id, approval.version, { status: 'rejected', ...decision });
    tx.audit('approval', approval.id, { status: 'pending' }, { status: 'rejected', note: input.note });
    tx.event('approval.decided', { approvalId: approval.id, status: 'rejected' });
    return ok({ status: 'rejected' });
  }
  if (lead.version !== approval.target_version) {
    // The lead moved on after the request: never apply an approval to a version it did not see.
    tx.update('approval', approval.id, approval.version, { status: 'stale', ...decision });
    tx.audit('approval', approval.id, { status: 'pending' }, { status: 'stale', leadVersion: lead.version, targetVersion: approval.target_version });
    tx.event('approval.decided', { approvalId: approval.id, status: 'stale' });
    return ok({ status: 'stale' });
  }
  tx.update('approval', approval.id, approval.version, { status: 'approved', ...decision });
  if (approval.kind === 'owner_change') {
    const member = payload.toUserId ? await loadTeamMember(db, payload.toUserId, lead.team_id) : null;
    if (!member) return fail('VALIDATION_FAILED', 'Người nhận không còn thuộc team');
    await applyOwnerChange(db, tx, lead, approval.target_version, member, 'Leader duyệt yêu cầu chuyển owner');
  } else {
    if (!payload.toStage) return fail('VALIDATION_FAILED', 'Đề xuất thiếu stage đích');
    const invalid = await applyStageChange(db, tx, lead, approval.target_version, {
      toStage: payload.toStage, lostReason: payload.lostReason, lostNote: payload.lostNote, wonValue: payload.wonValue, wonNote: payload.wonNote,
    }, `đề xuất của ${payload.agentName ?? 'agent'}, ${actor.displayName} duyệt`);
    if (invalid) return invalid;
  }
  tx.audit('approval', approval.id, { status: 'pending' }, { status: 'approved', note: input.note });
  tx.event('approval.decided', { approvalId: approval.id, status: 'approved' });
  return ok({ status: 'approved' });
}

