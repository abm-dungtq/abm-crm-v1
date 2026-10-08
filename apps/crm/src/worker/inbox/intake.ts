import { normalizeEmail, normalizePhone, type ApiResult } from '@abm/contracts';
import { z } from 'zod';
import { fail, ok } from '../command-result';
import { runCommand } from '../commands';
import type { Actor } from '../env';
import { customerScope } from '../scope';
import { completeCommand, enqueueCommand, failCommand } from './dispatcher';

/**
 * Chatbot lead intake (ADR-009). The `crm-extractor` agent reads a conversation and its answer fills one
 * pending `lead_intake` per conversation. The bot never writes `contact` or `lead`: a staff member classifies
 * the intake, and the existing `createLead` / `createLearnerLead` command creates the real lead.
 */

export const EXTRACT_AGENT_KEY = 'crm-extractor';
/** Messages sent to the extractor, newest last. */
export const EXTRACT_MESSAGE_COUNT = 60;
/** Messages copied into the lead activity when an intake is classified. */
export const ACTIVITY_MESSAGE_COUNT = 20;
/** A direct conversation idle this long is extracted by the cron. */
export const EXTRACT_IDLE_MS = 15 * 60_000;
const EXTRACT_SCAN_BATCH = 50;
/** One message longer than this is cut, so a pasted document cannot crowd out the rest of the conversation. */
const LINE_MAX_CHARS = 1000;
const MERGE_TRIES = 3;

export const INTAKE_FIELDS = ['name', 'phone', 'email', 'need', 'interest', 'note'] as const;
export type IntakeField = (typeof INTAKE_FIELDS)[number];
export type IntakeValues = Partial<Record<IntakeField, string>>;
/** Shape of `lead_intake.fields_json`: current values, plus differing values awaiting staff confirmation. */
export type IntakeFields = IntakeValues & { proposed?: IntakeValues };

const EXTRACT_INSTRUCTION = 'Trích thông tin khách hàng từ hội thoại dưới đây. Chỉ trả về một JSON object với các khoá '
  + 'name, phone, email, need, interest, note; bỏ khoá không có thông tin; không thêm chữ ngoài JSON; chỉ lấy thông tin do khách nói.';

/** A missing, null or blank value means the agent found nothing for that key. */
const optionalText = (schema: z.ZodString) => z.preprocess(
  (v) => (v === null || (typeof v === 'string' && v.trim() === '') ? undefined : v),
  schema.optional(),
);
/** The extractor's answer, with the same lengths as createLeadInput. Unknown keys are dropped. */
const extractedSchema = z.object({
  name: optionalText(z.string().trim().max(120)),
  phone: optionalText(z.string().trim().max(20).refine((v) => v.replace(/\D/g, '').length >= 9, 'Số điện thoại cần ít nhất 9 chữ số')),
  email: optionalText(z.string().trim().email().max(160)),
  need: optionalText(z.string().trim().max(1000)),
  interest: optionalText(z.string().trim().max(1000)),
  note: optionalText(z.string().trim().max(1000)),
});

/** Parses the extractor's answer, with or without a ``` fence. Null when it is not a valid object. */
export function parseExtraction(text: string): IntakeValues | null {
  const trimmed = text.trim();
  const fenced = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\s*```$/.exec(trimmed);
  let json: unknown;
  try {
    json = JSON.parse(fenced ? fenced[1]! : trimmed);
  } catch {
    return null;
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
  const parsed = extractedSchema.safeParse(json);
  if (!parsed.success) return null;
  const values: IntakeValues = {};
  for (const field of INTAKE_FIELDS) {
    const value = parsed.data[field];
    if (value) values[field] = value;
  }
  return values;
}

const sameValue = (field: IntakeField, a: string, b: string) => {
  if (field === 'phone') return normalizePhone(a) === normalizePhone(b);
  if (field === 'email') return normalizeEmail(a) === normalizeEmail(b);
  return a.trim() === b.trim();
};

/**
 * Rule for a new extraction: an empty field is filled, a different value is kept as a proposal for staff,
 * and the same value drops a stale proposal for that field.
 */
export function mergeIntakeFields(current: IntakeFields, extracted: IntakeValues): IntakeFields {
  const next: IntakeFields = { ...current, proposed: { ...current.proposed } };
  for (const field of INTAKE_FIELDS) {
    const value = extracted[field];
    if (!value) continue;
    const existing = current[field];
    if (!existing) next[field] = value;
    else if (sameValue(field, existing, value)) delete next.proposed![field];
    else next.proposed![field] = value;
  }
  if (!Object.keys(next.proposed!).length) delete next.proposed;
  return next;
}

const readFields = (json: string): IntakeFields => {
  const parsed = JSON.parse(json) as unknown;
  return typeof parsed === 'object' && parsed !== null ? parsed as IntakeFields : {};
};

interface TranscriptRow { sender_kind: string; body: string }
const SPEAKER: Record<string, string> = { customer: 'Khách', bot: 'Bot', staff_web: 'Nhân viên', staff_phone: 'Nhân viên' };

/** The latest `count` customer, bot and staff messages, oldest first, one `Speaker: text` line each. */
async function transcript(db: D1Database, conversationId: string, count: number) {
  const rows = await db.prepare(`SELECT sender_kind, body FROM message
    WHERE conversation_id = ? AND sender_kind <> 'system' ORDER BY created_at DESC, rowid DESC LIMIT ?`)
    .bind(conversationId, count).all<TranscriptRow>();
  return rows.results.reverse().map((m) => {
    const text = m.body.replace(/\s+/g, ' ').trim();
    return `${SPEAKER[m.sender_kind] ?? 'Khác'}: ${text.length > LINE_MAX_CHARS ? `${text.slice(0, LINE_MAX_CHARS)}…` : text}`;
  });
}

/** SQL condition a statement runs under; the default always holds. */
interface Guard { sql: string; binds: unknown[] }
const ALWAYS: Guard = { sql: '1 = 1', binds: [] };

/** Audit row of an intake action, written only while `guard` holds. Never holds message text. */
const auditIntake = (db: D1Database, actor: Actor, command: string, intakeId: string, before: unknown, after: unknown, now: string, guard = ALWAYS) =>
  db.prepare(`INSERT INTO audit_log (id, actor_user_id, actor_kind, command, entity, entity_id, before_json, after_json, created_at)
    SELECT ?, ?, ?, ?, 'lead_intake', ?, ?, ?, ? WHERE ${guard.sql}`).bind(crypto.randomUUID(), actor.id, actor.kind, command, intakeId,
    JSON.stringify(before), JSON.stringify(after), now, ...guard.binds);

// ---------- extraction ----------

/**
 * Queues one `crm-extractor` run over the latest 60 messages of a direct conversation and stamps
 * `last_extracted_at`. The dedupe key holds the last message id, so asking twice without a new message
 * queues one command. Null for a group, an unknown conversation or one without messages.
 */
export async function enqueueExtraction(db: D1Database, conversationId: string, now = new Date()): Promise<string | null> {
  const conv = await db.prepare("SELECT id, channel_account_id FROM conversation WHERE id = ? AND kind = 'direct'")
    .bind(conversationId).first<{ id: string; channel_account_id: string }>();
  if (!conv) return null;
  const last = await db.prepare(`SELECT id FROM message WHERE conversation_id = ? AND sender_kind <> 'system'
    ORDER BY created_at DESC, rowid DESC LIMIT 1`).bind(conv.id).first<{ id: string }>();
  if (!last) return null;
  const lines = await transcript(db, conv.id, EXTRACT_MESSAGE_COUNT);
  const commandId = await enqueueCommand(db, {
    kind: 'run_completion', target: 'bridge', channelAccountId: conv.channel_account_id, conversationId: conv.id,
    payload: {
      agentKey: EXTRACT_AGENT_KEY, userId: `crm-extract:${crypto.randomUUID()}`, conversationId: conv.id, purpose: 'extract',
      text: `${EXTRACT_INSTRUCTION}\n\n${lines.join('\n')}`,
    },
    dedupeKey: `extract:${conv.id}:${last.id}`,
  });
  const nowIso = now.toISOString();
  await db.prepare('UPDATE conversation SET last_extracted_at = ?, updated_at = ? WHERE id = ?').bind(nowIso, nowIso, conv.id).run();
  return commandId;
}

/**
 * Cron: queues an extraction for every direct conversation whose last customer message is older than
 * 15 minutes and newer than its last extraction. Returns how many were queued.
 */
export async function extractIdleConversations(db: D1Database, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - EXTRACT_IDLE_MS).toISOString();
  const idle = await db.prepare(`SELECT id FROM conversation
    WHERE kind = 'direct' AND last_inbound_at IS NOT NULL AND last_inbound_at < ?
      AND (last_extracted_at IS NULL OR last_inbound_at > last_extracted_at)
    ORDER BY last_inbound_at LIMIT ?`).bind(cutoff, EXTRACT_SCAN_BATCH).all<{ id: string }>();
  let queued = 0;
  for (const conv of idle.results) {
    try {
      if (await enqueueExtraction(db, conv.id, now)) queued += 1;
    } catch (error) {
      // One conversation failing must not hold back the others.
      console.error('extract_enqueue_error', error instanceof Error ? error.message : 'unknown');
    }
  }
  return queued;
}

export interface ExtractionCommand { id: string; attempts: number; conversationId: string | null }

/**
 * Applies the extractor's answer for a claimed command. An answer that is not a valid JSON object fails the
 * command with EXTRACT_INVALID and writes nothing. A valid answer completes the command, then fills the
 * conversation's pending intake (creating it when the answer has any value). Returns false when the claim no
 * longer owns the command, so the result was dropped.
 */
export async function applyExtractionResult(db: D1Database, command: ExtractionCommand, text: string): Promise<boolean> {
  const extracted = parseExtraction(text);
  if (!extracted) return failCommand(db, command.id, command.attempts, 'EXTRACT_INVALID');
  const conv = command.conversationId
    ? await db.prepare('SELECT id, organization_id, contact_id FROM conversation WHERE id = ?').bind(command.conversationId)
      .first<{ id: string; organization_id: string; contact_id: string | null }>()
    : null;
  if (!conv) return failCommand(db, command.id, command.attempts, 'INVALID_PAYLOAD');
  if (!(await completeCommand(db, command.id, command.attempts, { fields: extracted }))) return false;
  if (!Object.keys(extracted).length) return true;

  // Compare-and-set on the row just read: a concurrent result is merged again on top of the newer row.
  for (let attempt = 0; attempt < MERGE_TRIES; attempt += 1) {
    const now = new Date().toISOString();
    const pending = await db.prepare(`SELECT id, fields_json FROM lead_intake WHERE conversation_id = ? AND status = 'pending'
      ORDER BY created_at LIMIT 1`).bind(conv.id).first<{ id: string; fields_json: string }>();
    const res = pending
      ? await db.prepare(`UPDATE lead_intake SET fields_json = ?, updated_at = ? WHERE id = ? AND status = 'pending' AND fields_json = ?`)
        .bind(JSON.stringify(mergeIntakeFields(readFields(pending.fields_json), extracted)), now, pending.id, pending.fields_json).run()
      : await db.prepare(`INSERT INTO lead_intake (id, organization_id, conversation_id, contact_id, fields_json, status, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, 'pending', ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM lead_intake WHERE conversation_id = ? AND status = 'pending')`)
        .bind(crypto.randomUUID(), conv.organization_id, conv.id, conv.contact_id, JSON.stringify(extracted), now, now, conv.id).run();
    if (res.meta.changes === 1) return true;
  }
  console.error('extract_merge_contended', command.id);
  return true;
}

// ---------- staff actions ----------

interface IntakeRow {
  id: string;
  conversation_id: string;
  fields_json: string;
  status: 'pending' | 'classified' | 'discarded';
  channel: 'zalo' | 'facebook';
  external_thread_id: string;
}

const intakeNotFound = () => fail('NOT_FOUND', 'Không tìm thấy lead chờ phân loại');
const notPending = () => fail('STALE_VERSION', 'Lead chờ phân loại đã được xử lý. Tải lại để xem bản mới nhất.');

/** An intake of the actor's organization, with the channel and thread of its conversation. */
const loadIntake = (db: D1Database, actor: Actor, intakeId: string) => db.prepare(`SELECT i.id, i.conversation_id, i.fields_json, i.status,
    a.channel, c.external_thread_id
  FROM lead_intake i JOIN conversation c ON c.id = i.conversation_id JOIN channel_account a ON a.id = c.channel_account_id
  WHERE i.id = ? AND i.organization_id = ?`).bind(intakeId, actor.organizationId).first<IntakeRow>();

/**
 * Compare-and-set that moves a pending intake to `status`, stamped with the actor and `now`, plus a guard that
 * holds only for the request whose move succeeded. Statements batched after the move run under that guard,
 * so a request that lost the race writes nothing.
 */
function moveIntake(db: D1Database, actor: Actor, intakeId: string, status: 'classified' | 'discarded', now: string,
  set: { leadId?: string; contactId?: string } = {}) {
  const statement = db.prepare(`UPDATE lead_intake SET status = ?, lead_id = ?, contact_id = COALESCE(?, contact_id),
      classified_by_user_id = ?, classified_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'`)
    .bind(status, set.leadId ?? null, set.contactId ?? null, actor.id, now, now, intakeId);
  const guard: Guard = {
    sql: 'EXISTS (SELECT 1 FROM lead_intake WHERE id = ? AND status = ? AND classified_by_user_id = ? AND classified_at = ?)',
    binds: [intakeId, status, actor.id, now],
  };
  return { statement, guard };
}

/**
 * Statements that link the conversation to a contact and add the channel contact point (Zalo user id or
 * Facebook page-scoped id) when the contact lacks it. Both run only while `guard` holds.
 */
function linkStatements(db: D1Database, intake: IntakeRow, contactId: string, now: string, guard: Guard) {
  const type = intake.channel === 'facebook' ? 'fb_psid' : 'zalo_uid';
  const thread = intake.external_thread_id;
  return [
    db.prepare(`UPDATE conversation SET contact_id = ?, updated_at = ? WHERE id = ? AND ${guard.sql}`)
      .bind(contactId, now, intake.conversation_id, ...guard.binds),
    db.prepare(`INSERT INTO contact_point (id, contact_id, type, value, normalized_value, created_at)
      SELECT ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM contact_point WHERE contact_id = ? AND type = ? AND normalized_value = ?) AND ${guard.sql}`)
      .bind(crypto.randomUUID(), contactId, type, thread, thread, now, contactId, type, thread, ...guard.binds),
  ];
}

export type IntakePipeline = 'b2b' | 'learner';
export interface ClassifyRequest { pipeline: IntakePipeline; input: Record<string, unknown> }

/**
 * A staff member turns an intake into a real lead with the existing command: `createLead` for `b2b`,
 * `createLearnerLead` for `learner`, with `source` set to the conversation's channel. Every other field
 * comes from the staff form as sent, so `confirmNotDuplicate` is only ever the staff member's own choice,
 * and a command error (DUPLICATE_SUSPECTED, VALIDATION_FAILED, ...) is returned unchanged with the intake
 * still pending. On success the intake is classified, the conversation is linked to the lead's contact, the
 * channel contact point is added, and the last 20 messages are kept as a note on the lead.
 */
export async function classifyIntake(db: D1Database, actor: Actor, intakeId: string, request: ClassifyRequest):
  Promise<ApiResult<{ intakeId: string; leadId: string; contactId: string }>> {
  const intake = await loadIntake(db, actor, intakeId);
  if (!intake) return intakeNotFound();
  if (intake.status !== 'pending') return notPending();
  const name = request.pipeline === 'b2b' ? 'createLead' : 'createLearnerLead';
  // A retry with the same form replays the lead a failed earlier attempt already created instead of creating another.
  const result = await runCommand(db, actor, name, { ...request.input, source: intake.channel }, `intake:${intake.id}`);
  if (!result.ok) return result;
  const leadId = (result.data as { leadId?: unknown }).leadId;
  if (typeof leadId !== 'string') throw new Error(`${name} returned no lead id`);
  const lead = await db.prepare('SELECT contact_id FROM lead WHERE id = ?').bind(leadId).first<{ contact_id: string }>();
  if (!lead) throw new Error(`${name} lead not found after commit`);

  const now = new Date().toISOString();
  const lines = await transcript(db, intake.conversation_id, ACTIVITY_MESSAGE_COUNT);
  const note = `Hội thoại ${intake.channel === 'facebook' ? 'Facebook' : 'Zalo'} (${lines.length} tin gần nhất):\n${lines.join('\n')}`;
  const move = moveIntake(db, actor, intake.id, 'classified', now, { leadId, contactId: lead.contact_id });
  const [moved] = await db.batch([
    move.statement,
    ...linkStatements(db, intake, lead.contact_id, now, move.guard),
    db.prepare(`INSERT INTO activity (id, lead_id, type, summary, actor_user_id, actor_kind, occurred_at, created_at)
      SELECT ?, ?, 'note', ?, ?, ?, ?, ? WHERE ${move.guard.sql}`)
      .bind(crypto.randomUUID(), leadId, note, actor.id, actor.kind, now, now, ...move.guard.binds),
    auditIntake(db, actor, 'inbox.classifyIntake', intake.id, { status: 'pending' },
      { status: 'classified', pipeline: request.pipeline, leadId, contactId: lead.contact_id, conversationId: intake.conversation_id },
      now, move.guard),
  ]);
  // Someone else classified the intake meanwhile: the lead created here stands on its own and is not linked.
  if (moved!.meta.changes !== 1) return notPending();
  return ok({ intakeId: intake.id, leadId, contactId: lead.contact_id });
}

/**
 * Links the intake's conversation to an existing customer the actor may work on (customerScope), adds the
 * channel contact point, and classifies the intake without a lead. NOT_FOUND for a contact outside scope.
 */
export async function linkIntakeContact(db: D1Database, actor: Actor, intakeId: string, contactId: string):
  Promise<ApiResult<{ intakeId: string; contactId: string }>> {
  const intake = await loadIntake(db, actor, intakeId);
  if (!intake) return intakeNotFound();
  if (intake.status !== 'pending') return notPending();
  const scope = customerScope(actor);
  const contact = await db.prepare(`SELECT c.id FROM contact c WHERE c.id = ? AND c.organization_id = ? AND c.archived_at IS NULL AND ${scope.sql}`)
    .bind(contactId, actor.organizationId, ...scope.binds).first<{ id: string }>();
  if (!contact) return fail('NOT_FOUND', 'Không tìm thấy khách trong phạm vi của bạn');
  const now = new Date().toISOString();
  const move = moveIntake(db, actor, intake.id, 'classified', now, { contactId: contact.id });
  const [moved] = await db.batch([
    move.statement,
    ...linkStatements(db, intake, contact.id, now, move.guard),
    auditIntake(db, actor, 'inbox.linkIntakeContact', intake.id, { status: 'pending' },
      { status: 'classified', contactId: contact.id, conversationId: intake.conversation_id }, now, move.guard),
  ]);
  if (moved!.meta.changes !== 1) return notPending();
  return ok({ intakeId: intake.id, contactId: contact.id });
}

/** Marks a pending intake discarded; nothing is written to customers or leads. */
export async function discardIntake(db: D1Database, actor: Actor, intakeId: string): Promise<ApiResult<{ intakeId: string }>> {
  const intake = await loadIntake(db, actor, intakeId);
  if (!intake) return intakeNotFound();
  if (intake.status !== 'pending') return notPending();
  const now = new Date().toISOString();
  const move = moveIntake(db, actor, intake.id, 'discarded', now);
  const [moved] = await db.batch([
    move.statement,
    auditIntake(db, actor, 'inbox.discardIntake', intake.id, { status: 'pending' }, { status: 'discarded' }, now, move.guard),
  ]);
  if (moved!.meta.changes !== 1) return notPending();
  return ok({ intakeId: intake.id });
}

/** Staff accept the proposed value of one field: it replaces the current value and the proposal is removed. */
export async function confirmProposedField(db: D1Database, actor: Actor, intakeId: string, field: IntakeField):
  Promise<ApiResult<{ intakeId: string; fields: IntakeFields }>> {
  const intake = await loadIntake(db, actor, intakeId);
  if (!intake) return intakeNotFound();
  if (intake.status !== 'pending') return notPending();
  const current = readFields(intake.fields_json);
  const proposed = current.proposed?.[field];
  if (!proposed) return fail('VALIDATION_FAILED', 'Trường này không có giá trị đề xuất', { fields: { field: 'Không có đề xuất' } });
  const next: IntakeFields = { ...current, [field]: proposed, proposed: { ...current.proposed } };
  delete next.proposed![field];
  if (!Object.keys(next.proposed!).length) delete next.proposed;
  const now = new Date().toISOString();
  const nextJson = JSON.stringify(next);
  // The audit row is guarded by the exact row this request wrote, so a lost compare-and-set records nothing.
  const [updated] = await db.batch([
    db.prepare(`UPDATE lead_intake SET fields_json = ?, updated_at = ? WHERE id = ? AND status = 'pending' AND fields_json = ?`)
      .bind(nextJson, now, intake.id, intake.fields_json),
    auditIntake(db, actor, 'inbox.confirmIntakeField', intake.id, { field }, { field }, now, {
      sql: "EXISTS (SELECT 1 FROM lead_intake WHERE id = ? AND status = 'pending' AND fields_json = ? AND updated_at = ?)",
      binds: [intake.id, nextJson, now],
    }),
  ]);
  if (updated!.meta.changes !== 1) return notPending();
  return ok({ intakeId: intake.id, fields: next });
}
