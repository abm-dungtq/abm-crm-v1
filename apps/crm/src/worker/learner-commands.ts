import {
  LEARNER_JOURNEY, LEARNER_JOURNEY_VERSION, foldText, learnerLostReasonLabel, normalizeEmail, normalizePhone, stageLabel,
  type AddContractStepInput, type AttachProductInput, type ChangeCustomerOwnerInput, type ClaimCustomerInput,
  type CloseLearnerLeadInput, type CreateLearnerLeadInput, type DetachProductInput, type ImportContractLearnersInput,
  type MarkJourneyStepInput, type SkipTrialInput, type ToggleContractStepInput, type UpsertPartnerContractInput,
  type WinLearnerLeadInput,
} from '@abm/contracts';
import { z } from 'zod';
import { fail, ok, type ApiFail, type Ctx } from './command-result';
import type { Actor } from './env';
import type { GuardedTx } from './guarded-tx';
import { CONTACT_STATE_COLUMNS, holdExpiry, heldNow, type ContactState } from './learner-hold';
import { ROSTER_MAX_CHARS, ROSTER_MAX_ROWS, detectDelimiter, readRecords } from './roster';
import { customerScope } from './scope';

interface Owner { id: string; display_name: string; team_id: string; department_id: string }

interface LearnerLeadRow {
  id: string; contact_id: string; owner_user_id: string | null; team_id: string | null; department_id: string;
  stage: string; status: string; version: number; next_action_task_id: string | null;
}
interface StepRow { id: string; step_code: string; label: string; status: 'open' | 'done' | 'skipped'; version: number }

const MAX_PHONE_LOOKUP = ROSTER_MAX_ROWS;
const stepLabel = (code: string) => LEARNER_JOURNEY.find((s) => s.code === code)?.label ?? code;
const learnerStage = (code: string) => stageLabel(code, 'learner');

// ---------- shared reads ----------

/** An active Sale or Leader with a team: the only people who can hold a learner customer. */
async function loadOwnerCandidate(db: D1Database, organizationId: string, userId: string) {
  return db.prepare(`SELECT id, display_name, team_id, department_id FROM app_user
    WHERE id = ? AND organization_id = ? AND status = 'active' AND role IN ('sale', 'leader')
      AND team_id IS NOT NULL AND department_id IS NOT NULL`).bind(userId, organizationId).first<Owner>();
}

/** The Sale or Leader who will hold the customer: the actor, or for Admin the chosen person. */
async function resolveOwner(db: D1Database, actor: Actor, ownerUserId: string | undefined): Promise<{ error: ApiFail } | { owner: Owner }> {
  if (actor.role === 'admin') {
    if (!ownerUserId) return { error: fail('VALIDATION_FAILED', 'Admin cần chọn sale phụ trách', { fields: { ownerUserId: 'Bắt buộc' } }) };
    const owner = await loadOwnerCandidate(db, actor.organizationId, ownerUserId);
    return owner ? { owner } : { error: fail('VALIDATION_FAILED', 'Người phụ trách phải là Sale hoặc Leader đang hoạt động', { fields: { ownerUserId: 'Không hợp lệ' } }) };
  }
  if (ownerUserId && ownerUserId !== actor.id) {
    return { error: fail('VALIDATION_FAILED', 'Chỉ Admin được chọn người phụ trách', { fields: { ownerUserId: 'Không được phép' } }) };
  }
  if (!actor.teamId || !actor.departmentId) return { error: fail('VALIDATION_FAILED', 'Tài khoản chưa được xếp nhóm') };
  return { owner: { id: actor.id, display_name: actor.displayName, team_id: actor.teamId, department_id: actor.departmentId } };
}

async function loadContactState(db: D1Database, organizationId: string, contactId: string) {
  return db.prepare(`SELECT ${CONTACT_STATE_COLUMNS} FROM contact c WHERE c.id = ? AND c.organization_id = ? AND c.archived_at IS NULL`)
    .bind(contactId, organizationId).first<ContactState>();
}

/** Learner customers that already use one of these phone numbers, found with a single query. */
async function loadPhoneIndex(db: D1Database, organizationId: string, phones: string[]) {
  const index = new Map<string, ContactState[]>();
  if (!phones.length) return index;
  const rows = await db.prepare(`SELECT cp.normalized_value AS phone, ${CONTACT_STATE_COLUMNS}
    FROM contact_point cp JOIN contact c ON c.id = cp.contact_id
    WHERE cp.type = 'phone' AND cp.normalized_value IN (SELECT value FROM json_each(?)) AND c.organization_id = ?
      AND c.archived_at IS NULL AND EXISTS (SELECT 1 FROM lead l WHERE l.contact_id = c.id AND l.pipeline = 'learner')
    ORDER BY c.updated_at DESC`).bind(JSON.stringify(phones), organizationId).all<ContactState & { phone: string }>();
  for (const { phone, ...state } of rows.results) index.set(phone, [...(index.get(phone) ?? []), state]);
  return index;
}

async function loadOpenTasks(db: D1Database, leadId: string) {
  return (await db.prepare(`SELECT id, version FROM task WHERE lead_id = ? AND status = 'open'`).bind(leadId).all<{ id: string; version: number }>()).results;
}

const poolMessage = 'Khách đang ở hồ chung, hãy bấm Nhận trước';
const heldByOtherMessage = 'Khách đang do sale khác giữ';

// ---------- creating a learner lead ----------

interface LeadDraft {
  contactId?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  source: string;
  partnerContractId?: string;
  sourceNote?: string;
  needSummary: string;
  nextAction: { title: string; dueAt: string };
}

type ContactPlan = { kind: 'new' } | { kind: 'own'; state: ContactState } | { kind: 'adopt'; state: ContactState };

/**
 * Decides which customer a new lead attaches to. `candidates` are the learner customers found by the
 * phone number (or the one chosen by id). A customer held by someone else blocks the lead without
 * naming that person; one in the pool must be claimed first; one the owner already holds is reused.
 */
function decideContact(candidates: ContactState[], owner: Owner, now: Date, byId: boolean): { error: ApiFail } | { contact: ContactPlan } {
  if (candidates.some((c) => heldNow(c, now) && c.owner_user_id !== owner.id)) return { error: fail('FORBIDDEN', heldByOtherMessage) };
  const own = candidates.find((c) => heldNow(c, now));
  if (own) return { contact: { kind: 'own', state: own } };
  if (candidates.some((c) => c.has_learner_lead)) return { error: fail('VALIDATION_FAILED', poolMessage) };
  // A chosen customer without any learner lead (for example a B2B contact) is taken over by the owner.
  const chosen = byId ? candidates[0] : undefined;
  return { contact: chosen ? { kind: 'adopt', state: chosen } : { kind: 'new' } };
}

interface LeadPlan {
  draft: LeadDraft;
  owner: Owner;
  contact: ContactPlan;
  phone: string | null;
  email: string | null;
  attachProductIds: string[];
}

/** Stages one learner lead: customer (new, reused or taken over), lead, Next Action, journey steps and products. */
function writeLearnerLead(db: D1Database, tx: GuardedTx, actor: Actor, plan: LeadPlan, touched: Set<string>): { leadId: string; contactId: string } {
  const { draft, owner, contact, phone, email } = plan;
  const now = tx.now;
  const expiry = holdExpiry(now);
  let contactId: string;
  if (contact.kind === 'new') {
    contactId = crypto.randomUUID();
    // Two concurrent creations of the same number must not both land as new customers.
    if (phone) {
      tx.assert(`SELECT COUNT(*) = 0 FROM contact_point cp JOIN lead l ON l.contact_id = cp.contact_id AND l.pipeline = 'learner'
        WHERE cp.type = 'phone' AND cp.normalized_value = ?`, [phone]);
    }
    tx.insertVersioned('contact', {
      id: contactId, organization_id: actor.organizationId, display_name: draft.contactName,
      owner_user_id: owner.id, hold_started_at: now, hold_expires_at: expiry,
    });
    if (phone) tx.raw(db.prepare(`INSERT INTO contact_point (id, contact_id, type, value, normalized_value, created_at) VALUES (?, ?, 'phone', ?, ?, ?)`)
      .bind(crypto.randomUUID(), contactId, draft.phone, phone, now));
    if (email) tx.raw(db.prepare(`INSERT INTO contact_point (id, contact_id, type, value, normalized_value, created_at) VALUES (?, ?, 'email', ?, ?, ?)`)
      .bind(crypto.randomUUID(), contactId, draft.email, email, now));
  } else {
    contactId = contact.state.id;
    // The existing hold of the owner is left untouched; a taken-over customer starts a fresh hold.
    if (contact.kind === 'adopt') {
      tx.update('contact', contactId, contact.state.version, { owner_user_id: owner.id, hold_started_at: now, hold_expires_at: expiry });
    } else if (!touched.has(contactId)) {
      tx.update('contact', contactId, contact.state.version, {});
    }
    touched.add(contactId);
  }

  const leadId = crypto.randomUUID();
  const taskId = crypto.randomUUID();
  const needSummary = draft.sourceNote ? `${draft.needSummary} — Nguồn: ${draft.sourceNote}` : draft.needSummary;
  tx.raw(db.prepare('INSERT INTO lead_counter (organization_id, next_value) VALUES (?, 1) ON CONFLICT DO NOTHING').bind(actor.organizationId));
  tx.insertVersioned('lead', {
    id: leadId, organization_id: actor.organizationId, department_id: owner.department_id, team_id: owner.team_id,
    contact_id: contactId, source: draft.source, need_summary: needSummary, owner_user_id: owner.id,
    stage: 'new', status: 'active', next_action_task_id: taskId, assigned_at: now, stage_entered_at: now,
    created_by_user_id: actor.id, pipeline: 'learner',
    partner_contract_id: draft.source === 'partner' ? draft.partnerContractId ?? null : null,
  }, {
    cols: ['code'],
    exprs: [`(SELECT printf('L-%04d', next_value) FROM lead_counter WHERE organization_id = ?)`],
    binds: [actor.organizationId],
  });
  tx.raw(db.prepare('UPDATE lead_counter SET next_value = next_value + 1 WHERE organization_id = ?').bind(actor.organizationId));
  tx.insertVersioned('task', {
    id: taskId, lead_id: leadId, title: draft.nextAction.title, due_at: new Date(draft.nextAction.dueAt).toISOString(),
    assignee_user_id: owner.id, status: 'open', created_by_user_id: actor.id,
  });
  insertJourneySteps(db, tx, leadId, actor.id);
  for (const productId of plan.attachProductIds) {
    tx.insertVersioned('customer_product', {
      id: crypto.randomUUID(), contact_id: contactId, product_id: productId, attached_by_user_id: actor.id, attached_at: now,
    });
  }
  tx.activity(leadId, 'note', `Tạo lead học viên, nguồn ${draft.source}${draft.sourceNote ? ` (${draft.sourceNote})` : ''}`);
  tx.audit('lead', leadId, null, { pipeline: 'learner', source: draft.source, contactId, owner: owner.id, contact: contact.kind });
  return { leadId, contactId };
}

/** Copies the journey template into one row per step. The first step is recorded by the system. */
function insertJourneySteps(db: D1Database, tx: GuardedTx, leadId: string, actorId: string) {
  const rows = LEARNER_JOURNEY.map((s, i) => ({
    id: crypto.randomUUID(), code: s.code, label: s.label, required: s.required ? 1 : 0, position: i + 1,
    status: s.code === 'recorded' ? 'done' : 'open',
  }));
  tx.raw(db.prepare(`INSERT INTO lead_step (id, lead_id, step_code, label, required, position, template_version, status, done_at,
      done_by_user_id, created_at, updated_at, version, last_txn_id)
    SELECT json_extract(j.value, '$.id'), ?1, json_extract(j.value, '$.code'), json_extract(j.value, '$.label'),
      json_extract(j.value, '$.required'), json_extract(j.value, '$.position'), ?2, json_extract(j.value, '$.status'),
      CASE WHEN json_extract(j.value, '$.status') = 'done' THEN ?3 END,
      CASE WHEN json_extract(j.value, '$.status') = 'done' THEN ?4 END, ?3, ?3, 1, ?5
    FROM json_each(?6) j`).bind(leadId, LEARNER_JOURNEY_VERSION, tx.now, actorId, tx.txnId, JSON.stringify(rows)));
}

async function loadActiveContract(db: D1Database, organizationId: string, contractId: string): Promise<{ error: ApiFail } | { contract: { id: string; name: string; status: string } }> {
  const contract = await db.prepare('SELECT id, name, status FROM partner_contract WHERE id = ? AND organization_id = ?')
    .bind(contractId, organizationId).first<{ id: string; name: string; status: string }>();
  if (!contract) return { error: fail('VALIDATION_FAILED', 'Không tìm thấy hợp đồng đối tác', { fields: { partnerContractId: 'Không hợp lệ' } }) };
  if (contract.status !== 'active') return { error: fail('VALIDATION_FAILED', 'Hợp đồng đối tác chưa hiệu lực', { fields: { partnerContractId: 'Hợp đồng không ở trạng thái hiệu lực' } }) };
  return { contract };
}
const assertContractActive = (tx: GuardedTx, contractId: string) => tx.assert(`SELECT status = 'active' FROM partner_contract WHERE id = ?`, [contractId]);

async function createLearnerLead({ db, actor, input, tx }: Ctx<CreateLearnerLeadInput>) {
  const resolved = await resolveOwner(db, actor, input.ownerUserId);
  if ('error' in resolved) return resolved.error;
  const { owner } = resolved;
  const now = new Date(tx.now);

  if (input.source === 'partner') {
    const contract = await loadActiveContract(db, actor.organizationId, input.partnerContractId!);
    if ('error' in contract) return contract.error;
    assertContractActive(tx, input.partnerContractId!);
  }
  const productIds = [...new Set(input.productIds ?? [])];
  if (productIds.length) {
    const sellable = await db.prepare('SELECT COUNT(*) AS n FROM product WHERE organization_id = ? AND active = 1 AND id IN (SELECT value FROM json_each(?))')
      .bind(actor.organizationId, JSON.stringify(productIds)).first<{ n: number }>();
    if (sellable?.n !== productIds.length) return fail('VALIDATION_FAILED', 'Có sản phẩm không còn bán', { fields: { productIds: 'Không hợp lệ' } });
  }

  const phone = input.phone ? normalizePhone(input.phone) : null;
  const email = input.email ? normalizeEmail(input.email) : null;
  let candidates: ContactState[];
  if (input.contactId) {
    const state = await loadContactState(db, actor.organizationId, input.contactId);
    if (!state) return fail('NOT_FOUND', 'Không tìm thấy khách');
    candidates = [state];
  } else {
    candidates = phone ? (await loadPhoneIndex(db, actor.organizationId, [phone])).get(phone) ?? [] : [];
  }
  const decided = decideContact(candidates, owner, now, Boolean(input.contactId));
  if ('error' in decided) return decided.error;

  let attachProductIds = productIds;
  if (decided.contact.kind !== 'new' && productIds.length) {
    const attached = await db.prepare(`SELECT product_id FROM customer_product WHERE contact_id = ? AND detached_at IS NULL`)
      .bind(decided.contact.state.id).all<{ product_id: string }>();
    const already = new Set(attached.results.map((r) => r.product_id));
    attachProductIds = productIds.filter((p) => !already.has(p));
  }
  const created = writeLearnerLead(db, tx, actor, { draft: input, owner, contact: decided.contact, phone, email, attachProductIds }, new Set());
  return ok(created);
}

// ---------- journey ----------

export async function loadLearnerLead(
  db: D1Database, actor: Actor, leadId: string, expectedVersion: number, statuses: readonly string[] = ['active'],
): Promise<{ error: ApiFail } | { lead: LearnerLeadRow }> {
  const lead = await db.prepare(`SELECT id, contact_id, owner_user_id, team_id, department_id, stage, status, version, next_action_task_id
    FROM lead WHERE id = ? AND organization_id = ? AND pipeline = 'learner'`).bind(leadId, actor.organizationId).first<LearnerLeadRow>();
  const mayEdit = lead && (actor.role === 'admin' || lead.owner_user_id === actor.id || (actor.role === 'leader' && lead.team_id === actor.teamId));
  if (!lead || !mayEdit) return { error: fail('NOT_FOUND', 'Không tìm thấy lead học viên trong phạm vi của bạn') };
  if (lead.version !== expectedVersion) return { error: fail('STALE_VERSION', 'Lead đã thay đổi. Tải lại để xem bản mới nhất.') };
  if (!statuses.includes(lead.status)) return { error: fail('VALIDATION_FAILED', lead.status === 'active' ? 'Lead chưa thắng' : 'Lead đã đóng') };
  return { lead };
}

/** Marks one journey step done. A step already done or skipped stays as it is. */
export async function markStepDone(db: D1Database, tx: GuardedTx, actorId: string, leadId: string, stepCode: string): Promise<ApiFail | null> {
  const step = await db.prepare('SELECT id, status, version FROM lead_step WHERE lead_id = ? AND step_code = ?')
    .bind(leadId, stepCode).first<{ id: string; status: string; version: number }>();
  if (!step) return fail('VALIDATION_FAILED', 'Lead thiếu bước hành trình');
  if (step.status === 'done' || step.status === 'skipped') return null;
  tx.update('lead_step', step.id, step.version, { status: 'done', done_at: tx.now, done_by_user_id: actorId });
  return null;
}

/** Reopens one journey step that is done. Any other status stays as it is. */
export async function reopenStep(db: D1Database, tx: GuardedTx, leadId: string, stepCode: string): Promise<ApiFail | null> {
  const step = await db.prepare('SELECT id, status, version FROM lead_step WHERE lead_id = ? AND step_code = ?')
    .bind(leadId, stepCode).first<{ id: string; status: string; version: number }>();
  if (!step) return fail('VALIDATION_FAILED', 'Lead thiếu bước hành trình');
  if (step.status !== 'done') return null;
  tx.update('lead_step', step.id, step.version, { status: 'open', done_at: null, done_by_user_id: null });
  return null;
}

async function loadSteps(db: D1Database, leadId: string) {
  const rows = await db.prepare('SELECT id, step_code, label, status, version FROM lead_step WHERE lead_id = ?').bind(leadId).all<StepRow>();
  return new Map(rows.results.map((s) => [s.step_code, s]));
}

const JOURNEY_STEP_STAGE = { contacted: { requires: 'recorded', stage: 'contacted' }, need_confirmed: { requires: 'contacted', stage: 'qualified' } } as const;

async function markJourneyStep({ db, actor, input, tx }: Ctx<MarkJourneyStepInput>) {
  const loaded = await loadLearnerLead(db, actor, input.leadId, input.expectedVersion);
  if ('error' in loaded) return loaded.error;
  const { lead } = loaded;
  const steps = await loadSteps(db, lead.id);
  const step = steps.get(input.stepCode);
  const rule = JOURNEY_STEP_STAGE[input.stepCode];
  if (!step) return fail('VALIDATION_FAILED', 'Lead thiếu bước hành trình');
  if (step.status === 'done') return fail('VALIDATION_FAILED', `Bước "${step.label}" đã xong`);
  if (steps.get(rule.requires)?.status !== 'done') return fail('VALIDATION_FAILED', `Cần xong bước "${stepLabel(rule.requires)}" trước`);
  tx.update('lead', lead.id, input.expectedVersion, { stage: rule.stage, stage_entered_at: tx.now, last_activity_at: tx.now });
  tx.update('lead_step', step.id, step.version, { status: 'done', done_at: tx.now, done_by_user_id: actor.id });
  tx.activity(lead.id, 'stage_changed', `${learnerStage(lead.stage)} → ${learnerStage(rule.stage)} (${step.label})`);
  tx.audit('lead', lead.id, { stage: lead.stage }, { stage: rule.stage, step: step.step_code });
  return ok({ leadId: lead.id, stage: rule.stage });
}

async function skipTrial({ db, actor, input, tx }: Ctx<SkipTrialInput>) {
  const loaded = await loadLearnerLead(db, actor, input.leadId, input.expectedVersion);
  if ('error' in loaded) return loaded.error;
  const { lead } = loaded;
  const steps = await loadSteps(db, lead.id);
  const trial = steps.get('trial');
  if (!trial) return fail('VALIDATION_FAILED', 'Lead thiếu bước hành trình');
  if (steps.get('need_confirmed')?.status !== 'done') return fail('VALIDATION_FAILED', `Cần xong bước "${stepLabel('need_confirmed')}" trước`);
  if (trial.status !== 'open') return fail('VALIDATION_FAILED', 'Bước học thử đã được xử lý');
  tx.update('lead', lead.id, input.expectedVersion, { last_activity_at: tx.now });
  tx.update('lead_step', trial.id, trial.version, { status: 'skipped', skip_reason: input.reason, done_by_user_id: actor.id });
  tx.activity(lead.id, 'note', `Bỏ qua học thử: ${input.reason}`);
  tx.audit('lead', lead.id, { trial: 'open' }, { trial: 'skipped', reason: input.reason });
  return ok({ leadId: lead.id });
}

/** Closes the lead and cancels its open tasks; shared by win and lose. */
async function closeLead(db: D1Database, tx: GuardedTx, lead: LearnerLeadRow, expectedVersion: number, set: Record<string, unknown>) {
  tx.update('lead', lead.id, expectedVersion, { ...set, stage_entered_at: tx.now, closed_at: tx.now, next_action_task_id: null });
  for (const task of await loadOpenTasks(db, lead.id)) tx.update('task', task.id, task.version, { status: 'cancelled' });
}

async function winLearnerLead({ db, actor, input, tx }: Ctx<WinLearnerLeadInput>) {
  const loaded = await loadLearnerLead(db, actor, input.leadId, input.expectedVersion);
  if ('error' in loaded) return loaded.error;
  const { lead } = loaded;
  const steps = await loadSteps(db, lead.id);
  const missing: string[] = [];
  if (steps.get('need_confirmed')?.status !== 'done') missing.push(stepLabel('need_confirmed'));
  const trial = steps.get('trial')?.status;
  if (trial !== 'done' && trial !== 'skipped') missing.push(`${stepLabel('trial')} (hoặc bỏ qua kèm lý do)`);
  if (!lead.owner_user_id) missing.push('người phụ trách');
  if (missing.length) return fail('VALIDATION_FAILED', `Chưa thể chốt thắng. Còn thiếu: ${missing.join(', ')}`);
  await closeLead(db, tx, lead, input.expectedVersion, { stage: 'won', status: 'won', won_note: input.note ?? null });
  const enrolled = await markStepDone(db, tx, actor.id, lead.id, 'enrolled');
  if (enrolled) return enrolled;
  tx.activity(lead.id, 'stage_changed', `${learnerStage(lead.stage)} → ${learnerStage('won')}${input.note ? ` — ${input.note}` : ''}`);
  tx.audit('lead', lead.id, { stage: lead.stage, status: lead.status }, { stage: 'won', status: 'won' });
  return ok({ leadId: lead.id, stage: 'won' });
}

async function closeLearnerLead({ db, actor, input, tx }: Ctx<CloseLearnerLeadInput>) {
  const loaded = await loadLearnerLead(db, actor, input.leadId, input.expectedVersion);
  if ('error' in loaded) return loaded.error;
  const { lead } = loaded;
  await closeLead(db, tx, lead, input.expectedVersion, { stage: input.outcome, status: 'lost', lost_reason: input.reason, lost_note: input.note ?? null });
  tx.activity(lead.id, 'stage_changed',
    `${learnerStage(lead.stage)} → ${learnerStage(input.outcome)} — ${learnerLostReasonLabel(input.reason)}${input.note ? `: ${input.note}` : ''}`);
  tx.audit('lead', lead.id, { stage: lead.stage, status: lead.status }, { stage: input.outcome, status: 'lost', reason: input.reason });
  return ok({ leadId: lead.id, stage: input.outcome });
}

// ---------- customer ownership ----------

/** Moves the customer, its active learner leads and their open tasks to a new owner and restarts the 3-month hold. */
async function reassignCustomer(db: D1Database, tx: GuardedTx, state: ContactState, version: number, to: Owner, why: string) {
  const fromName = state.owner_user_id
    ? (await db.prepare('SELECT display_name FROM app_user WHERE id = ?').bind(state.owner_user_id).first<{ display_name: string }>())?.display_name
    : null;
  const expiry = holdExpiry(tx.now);
  tx.update('contact', state.id, version, { owner_user_id: to.id, hold_started_at: tx.now, hold_expires_at: expiry });
  const leads = await db.prepare(`SELECT id, version FROM lead WHERE contact_id = ? AND pipeline = 'learner' AND status = 'active'`)
    .bind(state.id).all<{ id: string; version: number }>();
  for (const lead of leads.results) {
    tx.update('lead', lead.id, lead.version, { owner_user_id: to.id, team_id: to.team_id, department_id: to.department_id, assigned_at: tx.now });
    for (const task of await loadOpenTasks(db, lead.id)) tx.update('task', task.id, task.version, { assignee_user_id: to.id });
    tx.activity(lead.id, 'owner_changed', `${why}: ${fromName ?? 'Hồ chung'} → ${to.display_name}`);
  }
  tx.audit('contact', state.id, { owner_user_id: state.owner_user_id, hold_expires_at: state.hold_expires_at },
    { owner_user_id: to.id, hold_expires_at: expiry, reason: why });
}

async function loadLearnerCustomer(db: D1Database, actor: Actor, contactId: string, version: number): Promise<{ error: ApiFail } | { state: ContactState }> {
  const state = await loadContactState(db, actor.organizationId, contactId);
  if (!state?.has_learner_lead) return { error: fail('NOT_FOUND', 'Không tìm thấy khách') };
  if (state.version !== version) return { error: fail('STALE_VERSION', 'Khách vừa được người khác cập nhật. Tải lại rồi thử lại.') };
  return { state };
}

async function claimCustomer({ db, actor, input, tx }: Ctx<ClaimCustomerInput>) {
  const loaded = await loadLearnerCustomer(db, actor, input.contactId, input.version);
  if ('error' in loaded) return loaded.error;
  const { state } = loaded;
  if (heldNow(state, new Date(tx.now))) {
    return state.owner_user_id === actor.id ? fail('VALIDATION_FAILED', 'Khách đang do bạn giữ') : fail('FORBIDDEN', heldByOtherMessage);
  }
  const resolved = await resolveOwner(db, actor, undefined);
  if ('error' in resolved) return resolved.error;
  await reassignCustomer(db, tx, state, input.version, resolved.owner, 'Nhận khách từ hồ chung');
  return ok({ contactId: state.id });
}

async function changeCustomerOwner({ db, actor, input, tx }: Ctx<ChangeCustomerOwnerInput>) {
  const loaded = await loadLearnerCustomer(db, actor, input.contactId, input.version);
  if ('error' in loaded) return loaded.error;
  const { state } = loaded;
  const to = await loadOwnerCandidate(db, actor.organizationId, input.ownerUserId);
  if (!to) return fail('VALIDATION_FAILED', 'Người nhận phải là Sale hoặc Leader đang hoạt động', { fields: { ownerUserId: 'Không hợp lệ' } });
  // A Leader moves customers only inside the own team; Admin moves any.
  if (actor.role === 'leader' && (!actor.teamId || state.owner_team_id !== actor.teamId || to.team_id !== actor.teamId)) {
    return fail('FORBIDDEN', 'Chỉ đổi sale cho khách trong nhóm của bạn');
  }
  if (state.owner_user_id === to.id) return fail('VALIDATION_FAILED', 'Khách đang thuộc người này');
  await reassignCustomer(db, tx, state, input.version, to, 'Đổi sale');
  return ok({ contactId: state.id });
}

/** A customer the actor may work on: Sale own, Leader the team's, Admin all. */
async function checkCustomerAccess(db: D1Database, actor: Actor, contactId: string): Promise<ApiFail | null> {
  const exists = await db.prepare('SELECT 1 AS ok FROM contact WHERE id = ? AND organization_id = ?').bind(contactId, actor.organizationId).first();
  if (!exists) return fail('NOT_FOUND', 'Không tìm thấy khách');
  const scope = customerScope(actor);
  const allowed = await db.prepare(`SELECT 1 AS ok FROM contact c WHERE c.id = ? AND ${scope.sql}`).bind(contactId, ...scope.binds).first();
  return allowed ? null : fail('FORBIDDEN', 'Khách này không thuộc phạm vi của bạn');
}

async function attachProduct({ db, actor, input, tx }: Ctx<AttachProductInput>) {
  const denied = await checkCustomerAccess(db, actor, input.contactId);
  if (denied) return denied;
  const product = await db.prepare('SELECT 1 AS ok FROM product WHERE id = ? AND organization_id = ? AND active = 1').bind(input.productId, actor.organizationId).first();
  if (!product) return fail('VALIDATION_FAILED', 'Sản phẩm không còn bán', { fields: { productId: 'Không hợp lệ' } });
  const attached = await db.prepare('SELECT 1 AS ok FROM customer_product WHERE contact_id = ? AND product_id = ? AND detached_at IS NULL').bind(input.contactId, input.productId).first();
  if (attached) return fail('VALIDATION_FAILED', 'Sản phẩm đã được gắn cho khách');
  const id = crypto.randomUUID();
  tx.insertVersioned('customer_product', { id, contact_id: input.contactId, product_id: input.productId, attached_by_user_id: actor.id, attached_at: tx.now });
  tx.audit('customer_product', id, null, { contactId: input.contactId, productId: input.productId });
  return ok({ id });
}

async function detachProduct({ db, actor, input, tx }: Ctx<DetachProductInput>) {
  const row = await db.prepare(`SELECT cp.id, cp.contact_id, cp.version, cp.detached_at FROM customer_product cp
    JOIN contact c ON c.id = cp.contact_id WHERE cp.id = ? AND c.organization_id = ?`).bind(input.customerProductId, actor.organizationId)
    .first<{ id: string; contact_id: string; version: number; detached_at: string | null }>();
  if (!row) return fail('NOT_FOUND', 'Không tìm thấy sản phẩm của khách');
  const denied = await checkCustomerAccess(db, actor, row.contact_id);
  if (denied) return denied;
  if (row.version !== input.version) return fail('STALE_VERSION', 'Dữ liệu vừa được người khác cập nhật. Tải lại rồi thử lại.');
  if (row.detached_at) return fail('VALIDATION_FAILED', 'Sản phẩm đã được gỡ');
  tx.update('customer_product', row.id, row.version, { detached_at: tx.now });
  tx.audit('customer_product', row.id, { detached_at: null }, { detached_at: tx.now });
  return ok({ id: row.id });
}

// ---------- partner contracts ----------

async function upsertPartnerContract({ db, actor, input, tx }: Ctx<UpsertPartnerContractInput>) {
  let accountId = input.accountId ?? null;
  if (accountId) {
    const account = await db.prepare('SELECT 1 AS ok FROM account WHERE id = ? AND organization_id = ?').bind(accountId, actor.organizationId).first();
    if (!account) return fail('VALIDATION_FAILED', 'Không tìm thấy đối tác', { fields: { accountId: 'Không hợp lệ' } });
  } else if (input.accountName) {
    accountId = crypto.randomUUID();
    tx.raw(db.prepare('INSERT INTO account (id, organization_id, name, created_at, updated_at, last_txn_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(accountId, actor.organizationId, input.accountName, tx.now, tx.now, tx.txnId));
  }
  const fields = { name: input.name, status: input.status, starts_on: input.startsOn ?? null, ends_on: input.endsOn ?? null, note: input.note ?? null };
  if (!input.id) {
    const id = crypto.randomUUID();
    tx.insertVersioned('partner_contract', { id, organization_id: actor.organizationId, account_id: accountId, created_by_user_id: actor.id, ...fields });
    tx.audit('partner_contract', id, null, { account_id: accountId, ...fields });
    return ok({ id, version: 1 });
  }
  if (!input.version) return fail('VALIDATION_FAILED', 'Thiếu version của hợp đồng', { fields: { version: 'Bắt buộc' } });
  const before = await db.prepare('SELECT account_id, name, status, starts_on, ends_on, note, version FROM partner_contract WHERE id = ? AND organization_id = ?')
    .bind(input.id, actor.organizationId).first<{ account_id: string; name: string; status: string; starts_on: string | null; ends_on: string | null; note: string | null; version: number }>();
  if (!before) return fail('NOT_FOUND', 'Không tìm thấy hợp đồng');
  if (before.version !== input.version) return fail('STALE_VERSION', 'Hợp đồng vừa được người khác cập nhật. Tải lại rồi thử lại.');
  const set = { ...fields, account_id: accountId ?? before.account_id };
  tx.update('partner_contract', input.id, input.version, set);
  const { version: _v, ...previous } = before;
  tx.audit('partner_contract', input.id, previous, set);
  return ok({ id: input.id, version: input.version + 1 });
}

async function addContractStep({ db, actor, input, tx }: Ctx<AddContractStepInput>) {
  const contract = await db.prepare('SELECT 1 AS ok FROM partner_contract WHERE id = ? AND organization_id = ?').bind(input.contractId, actor.organizationId).first();
  if (!contract) return fail('NOT_FOUND', 'Không tìm thấy hợp đồng');
  const id = crypto.randomUUID();
  tx.insertVersioned('partner_contract_step', { id, contract_id: input.contractId, name: input.name }, {
    cols: ['position'],
    exprs: ['(SELECT COALESCE(MAX(position), 0) + 1 FROM partner_contract_step WHERE contract_id = ?)'],
    binds: [input.contractId],
  });
  tx.audit('partner_contract_step', id, null, { contractId: input.contractId, name: input.name });
  return ok({ id });
}

async function toggleContractStep({ db, actor, input, tx }: Ctx<ToggleContractStepInput>) {
  const step = await db.prepare(`SELECT s.id, s.version, s.done_at FROM partner_contract_step s
    JOIN partner_contract pc ON pc.id = s.contract_id WHERE s.id = ? AND pc.organization_id = ?`)
    .bind(input.stepId, actor.organizationId).first<{ id: string; version: number; done_at: string | null }>();
  if (!step) return fail('NOT_FOUND', 'Không tìm thấy bước của hợp đồng');
  if (step.version !== input.version) return fail('STALE_VERSION', 'Dữ liệu vừa được người khác cập nhật. Tải lại rồi thử lại.');
  const set = input.done ? { done_at: tx.now, done_by_user_id: actor.id } : { done_at: null, done_by_user_id: null };
  tx.update('partner_contract_step', step.id, step.version, set);
  tx.audit('partner_contract_step', step.id, { done_at: step.done_at }, set);
  return ok({ id: step.id, version: step.version + 1 });
}

// ---------- partner CSV import ----------

const COLUMNS = { name: 'ho ten', phone: 'so dien thoai', email: 'email', need: 'nhu cau' } as const;
const COLUMN_LABEL = { name: 'Họ tên', phone: 'Số điện thoại', email: 'Email', need: 'Nhu cầu' } as const;
const emailSchema = z.email();

interface ImportRow { line: number; name: string; phone: string | null; phoneRaw: string; email: string | null; emailRaw: string; need: string }
interface RowIssue { line: number | null; message: string }

function parseLearnerCsv(input: string): { rows: ImportRow[]; errors: RowIssue[] } {
  const text = input.replace(/^﻿/, '');
  if (text.length > ROSTER_MAX_CHARS) return { rows: [], errors: [{ line: null, message: 'File quá lớn (tối đa 500 KB)' }] };
  const records = readRecords(text, detectDelimiter(text.split(/\r?\n/, 1)[0] ?? ''));
  if (!records.length) return { rows: [], errors: [{ line: null, message: 'File không có dữ liệu' }] };
  const header = records[0]!.map(foldText);
  const index = Object.fromEntries(Object.entries(COLUMNS).map(([key, label]) => [key, header.indexOf(label)])) as Record<keyof typeof COLUMNS, number>;
  const missing = (Object.keys(COLUMNS) as (keyof typeof COLUMNS)[]).filter((k) => index[k] < 0).map((k) => COLUMN_LABEL[k]);
  if (missing.length) return { rows: [], errors: [{ line: null, message: `Thiếu cột: ${missing.join(', ')}` }] };
  if (records.length - 1 > ROSTER_MAX_ROWS) return { rows: [], errors: [{ line: null, message: `Tối đa ${ROSTER_MAX_ROWS} học viên mỗi lần nhập; chia thành nhiều file` }] };

  const rows: ImportRow[] = [];
  const errors: RowIssue[] = [];
  const firstLineOfPhone = new Map<string, number>();
  records.slice(1).forEach((record, i) => {
    const line = i + 2;
    const cell = (k: keyof typeof COLUMNS) => (record[index[k]] ?? '').trim().replace(/\s+/g, ' ');
    const name = cell('name');
    const phoneRaw = cell('phone');
    const emailRaw = cell('email');
    const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
    const email = emailRaw ? normalizeEmail(emailRaw) : null;
    const problems: string[] = [];
    if (!name) problems.push('Thiếu Họ tên');
    else if (name.length > 120) problems.push('Họ tên quá dài');
    if (!phone && !email) problems.push('Cần số điện thoại hoặc email');
    if (phoneRaw && (phone!.length < 9 || phoneRaw.length > 20)) problems.push('Số điện thoại cần ít nhất 9 chữ số');
    else if (phone && firstLineOfPhone.has(phone)) problems.push(`Số điện thoại trùng với dòng ${firstLineOfPhone.get(phone)}`);
    else if (phone) firstLineOfPhone.set(phone, line);
    if (email && (!emailSchema.safeParse(email).success || email.length > 160)) problems.push('Email không hợp lệ');
    const need = cell('need');
    if (need.length > 1000) problems.push('Nhu cầu quá dài');
    if (problems.length) errors.push(...problems.map((message) => ({ line, message })));
    else rows.push({ line, name, phone, phoneRaw, email, emailRaw, need });
  });
  return { rows, errors };
}

async function importContractLearners({ db, actor, input, tx }: Ctx<ImportContractLearnersInput>) {
  const contract = await loadActiveContract(db, actor.organizationId, input.contractId);
  if ('error' in contract) return contract.error;
  const resolved = await resolveOwner(db, actor, input.ownerUserId);
  if ('error' in resolved) return resolved.error;
  const { owner } = resolved;

  const parsed = parseLearnerCsv(input.csv);
  const errors = [...parsed.errors];
  const now = new Date(tx.now);
  const phones = parsed.rows.flatMap((r) => (r.phone ? [r.phone] : []));
  // One lookup for the whole file keeps a large import inside the per-request query allowance.
  const index = await loadPhoneIndex(db, actor.organizationId, phones.slice(0, MAX_PHONE_LOOKUP));
  const nextAction = { title: 'Liên hệ học viên đối tác', dueAt: new Date(now.getTime() + 86_400_000).toISOString() };

  const accepted: { row: ImportRow; plan: LeadPlan }[] = [];
  for (const row of parsed.rows) {
    const decided = decideContact(row.phone ? index.get(row.phone) ?? [] : [], owner, now, false);
    if ('error' in decided) {
      errors.push({ line: row.line, message: decided.error.error.message });
      continue;
    }
    accepted.push({
      row,
      plan: {
        draft: {
          contactName: row.name, phone: row.phoneRaw || undefined, email: row.emailRaw || undefined, source: 'partner',
          partnerContractId: contract.contract.id, needSummary: row.need || `Học viên từ hợp đồng ${contract.contract.name}`, nextAction,
        },
        owner, contact: decided.contact, phone: row.phone, email: row.email, attachProductIds: [],
      },
    });
  }
  errors.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  const create = accepted.map(({ row }) => ({ line: row.line, name: row.name, phone: row.phoneRaw || null, email: row.emailRaw || null }));
  if (!input.commit || !accepted.length) return ok({ committed: false, create, errors });

  assertContractActive(tx, contract.contract.id);
  const touched = new Set<string>();
  for (const { plan } of accepted) writeLearnerLead(db, tx, actor, plan, touched);
  return ok({ committed: true, create, errors });
}

export const learnerHandlers = {
  createLearnerLead, markJourneyStep, skipTrial, winLearnerLead, closeLearnerLead, claimCustomer, changeCustomerOwner,
  attachProduct, detachProduct, upsertPartnerContract, addContractStep, toggleContractStep, importContractLearners,
};
