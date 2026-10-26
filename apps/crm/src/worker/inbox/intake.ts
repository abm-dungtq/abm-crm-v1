import { foldText, normalizeEmail, normalizePhone, type ApiResult } from '@abm/contracts';
import { z } from 'zod';
import { fail, ok } from '../command-result';
import { runCommand } from '../commands';
import type { Actor, Sink } from '../env';
import { notifyInboxUser } from '../inbox-notices';
import { customerScope } from '../scope';
import { assignConversationToLeadOwner } from './assignment';
import { completeCommand, enqueueCommand, failCommand } from './dispatcher';

/**
 * Chatbot lead intake (ADR-009). The `crm-extractor` agent reads a conversation and its answer fills one
 * pending `lead_intake` per conversation. The bot never writes `contact` or `lead`: a staff member classifies
 * the intake, and the existing `createLead` / `createLearnerLead` command creates the real lead.
 */

export const EXTRACT_AGENT_KEY = 'crm-extractor';
/** Messages sent to the extractor, newest last. */
export const EXTRACT_MESSAGE_COUNT = 60;
/** A direct conversation idle this long is extracted by the cron. */
export const EXTRACT_IDLE_MS = 15 * 60_000;
const EXTRACT_SCAN_BATCH = 50;
/** One message longer than this is cut, so a pasted document cannot crowd out the rest of the conversation. */
const LINE_MAX_CHARS = 1000;
const MERGE_TRIES = 3;

export const INTAKE_FIELDS = ['name', 'phone', 'email', 'program', 'need', 'interest', 'note', 'summary'] as const;
export type IntakeField = (typeof INTAKE_FIELDS)[number];
export type IntakeValues = Partial<Record<IntakeField, string>>;
/** Shape of `lead_intake.fields_json`: current values, suggested productId, plus differing values awaiting staff confirmation. */
export type IntakeFields = IntakeValues & { productId?: string; proposed?: IntakeValues };

const EXTRACT_INSTRUCTION = 'Trích thông tin khách hàng từ hội thoại dưới đây. Chỉ trả về một JSON object với các khoá '
  + 'name, phone, email, program, need, interest, note, summary; bỏ khoá không có thông tin; không thêm chữ ngoài JSON. '
  + 'Các khoá name, phone, email, program, need, interest, note chỉ lấy thông tin do khách nói. '
  + 'Chỉ lấy họ tên thật khách tự giới thiệu; không lấy đại từ xưng hô (anh, chị, em, cô, chú, bác, sếp, bạn…) hay biệt danh; '
  + 'khoá program ghi tên chương trình/khóa học hoặc mức phí khách nói đã đóng (ví dụ "199k"). '
  + 'Khoá summary là tóm tắt tiếng Việt từ 3 đến 6 dòng ngắn, mỗi dòng bắt đầu bằng "- ". '
  + 'Nêu khách hỏi hoặc cần gì; bên mình đã báo hoặc đã gửi gì (giá, lịch, tài liệu); phần đã thống nhất hoặc đã hứa và bước tiếp theo. '
  + 'Không chép nguyên tin nhắn, không bịa thêm thông tin, không ghi số điện thoại, email hay số tài khoản ngân hàng.';

const HONORIFIC_PREFIXES = new Set(['anh', 'chị', 'em', 'cô', 'chú', 'bác', 'sếp', 'bạn', 'thầy']);
const SINGLE_PRONOUNS = new Set(['mình', 'tôi', 'tớ', 'dạ', 'vâng', 'ad', 'admin', 'shop', 'khách']);

/** Rejects bare pronouns or an honorific followed by at most one word (e.g. "Chị", "Sếp Tú", "anh Long"). */
export function isValidCustomerName(name: string): boolean {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const first = words[0]!.normalize('NFC').toLowerCase();
  if (words.length === 1 && (HONORIFIC_PREFIXES.has(first) || SINGLE_PRONOUNS.has(first))) return false;
  if (words.length === 2 && HONORIFIC_PREFIXES.has(first)) return false;
  return true;
}

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
  program: optionalText(z.string().trim().max(200)),
  need: optionalText(z.string().trim().max(1000)),
  interest: optionalText(z.string().trim().max(1000)),
  note: optionalText(z.string().trim().max(1000)),
  summary: optionalText(z.string().trim().max(1500)),
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
    if (!value) continue;
    if (field === 'name' && !isValidCustomerName(value)) continue;
    values[field] = value;
  }
  return values;
}

/** Extracts a VND price from a short phrase such as "199k", "199.000", or "1.5tr". */
export function parsePriceVnd(text: string): number | null {
  const normalized = foldText(text);
  const kMatch = /(\d+(?:[.,]\d+)?)\s*(?:k|nghin|ngan)\b/.exec(normalized);
  if (kMatch) {
    const num = Number(kMatch[1]!.replace(',', '.'));
    if (Number.isFinite(num) && num > 0) return Math.round(num * 1000);
  }
  const trMatch = /(\d+(?:[.,]\d+)?)\s*(?:tr|trieu)\b/.exec(normalized);
  if (trMatch) {
    const num = Number(trMatch[1]!.replace(',', '.'));
    if (Number.isFinite(num) && num > 0) return Math.round(num * 1_000_000);
  }
  const digitsMatch = /\b(\d{1,3}(?:[.,]\d{3})+|\d{4,9})\s*(?:d|vnd)?\b/.exec(normalized);
  if (digitsMatch) {
    const num = Number(digitsMatch[1]!.replace(/[.,]/g, ''));
    if (Number.isFinite(num) && num >= 1000) return num;
  }
  return null;
}

const phraseWords = (text: string) => foldText(text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export async function matchProgramProduct(db: D1Database, organizationId: string, programText: string): Promise<{ id: string; name: string } | null> {
  const products = (await db.prepare('SELECT id, name, price_vnd FROM product WHERE organization_id = ? AND active = 1 ORDER BY created_at, id')
    .bind(organizationId).all<{ id: string; name: string; price_vnd: number }>()).results;
  if (!products.length) return null;
  const price = parsePriceVnd(programText);
  if (price !== null && price > 0) {
    const byPrice = products.filter((p) => p.price_vnd > 0 && p.price_vnd === price);
    if (byPrice.length === 1) return { id: byPrice[0]!.id, name: byPrice[0]!.name };
    if (byPrice.length > 1) return null;
  }
  const q = phraseWords(programText);
  if (q.length < 4) return null;
  const paddedQ = ` ${q} `;
  const byName = products.filter((p) => {
    const pf = phraseWords(p.name);
    if (pf.length < 4) return false;
    const paddedP = ` ${pf} `;
    return paddedP.includes(paddedQ) || paddedQ.includes(paddedP);
  });
  return byName.length === 1 ? { id: byName[0]!.id, name: byName[0]!.name } : null;
}

const sameValue = (field: IntakeField, a: string, b: string) => {
  if (field === 'phone') return normalizePhone(a) === normalizePhone(b);
  if (field === 'email') return normalizeEmail(a) === normalizeEmail(b);
  return a.trim() === b.trim();
};

/**
 * Rule for a new extraction: an empty field is filled, a different value is kept as a proposal for staff,
 * and the same value drops a stale proposal for that field. A newer `summary` replaces the stored one
 * instead of waiting for confirmation.
 */
export function mergeIntakeFields(current: IntakeFields, extracted: IntakeValues & { productId?: string }): IntakeFields {
  const next: IntakeFields = { ...current, proposed: { ...current.proposed } };
  for (const field of INTAKE_FIELDS) {
    const value = extracted[field];
    if (!value) continue;
    if (field === 'summary') {
      next.summary = value;
      delete next.proposed!.summary;
      continue;
    }
    const existing = current[field];
    if (!existing) next[field] = value;
    else if (sameValue(field, existing, value)) delete next.proposed![field];
    else next.proposed![field] = value;
  }
  if (next.program === extracted.program) {
    if (extracted.productId) next.productId = extracted.productId;
    else delete next.productId;
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

const FIELD_LABELS: Record<IntakeField, string> = {
  name: 'Tên',
  phone: 'SĐT',
  email: 'Email',
  program: 'Chương trình',
  need: 'Nhu cầu',
  interest: 'Quan tâm',
  note: 'Ghi chú',
  summary: 'Tóm tắt',
};

const AUTO_EXTRACT_NOTE_PREFIX = 'Trích xuất tự động từ hội thoại: ';
const LABEL_TO_FIELD = new Map<string, IntakeField>(
  INTAKE_FIELDS.map((f) => [FIELD_LABELS[f], f]),
);

/** Parses `FieldLabel: value` segments from a system extraction note summary. */
function parseExtractionNote(summary: string): IntakeValues {
  if (!summary.startsWith(AUTO_EXTRACT_NOTE_PREFIX)) return {};
  const body = summary.slice(AUTO_EXTRACT_NOTE_PREFIX.length);
  const values: IntakeValues = {};
  for (const part of body.split(/;\s*(?=(?:Tên|SĐT|Email|Chương trình|Nhu cầu|Quan tâm|Ghi chú):\s)/)) {
    const sep = part.indexOf(': ');
    if (sep < 0) continue;
    const field = LABEL_TO_FIELD.get(part.slice(0, sep));
    const val = part.slice(sep + 2).trim();
    if (field && val) values[field] = val;
  }
  return values;
}

const channelPointType = (channel: 'zalo' | 'facebook' | 'zalo_oa') =>
  channel === 'facebook' ? 'fb_psid' : channel === 'zalo_oa' ? 'zalo_oa_uid' : 'zalo_uid';

/**
 * Applies the extractor's answer for a claimed command. An answer that is not a valid JSON object fails the
 * command with EXTRACT_INVALID and writes nothing. A valid answer completes the command, then fills the
 * conversation's pending intake (or logs an activity note on an existing open lead when the customer already
 * has one). Returns false when the claim no longer owns the command, so the result was dropped.
 */
export async function applyExtractionResult(db: D1Database, command: ExtractionCommand, text: string): Promise<boolean> {
  const extracted = parseExtraction(text);
  if (!extracted) return failCommand(db, command.id, command.attempts, 'EXTRACT_INVALID');
  const conv = command.conversationId
    ? await db.prepare(`SELECT c.id, c.organization_id, c.contact_id, c.external_thread_id, a.channel
        FROM conversation c JOIN channel_account a ON a.id = c.channel_account_id
        WHERE c.id = ?`).bind(command.conversationId)
      .first<{ id: string; organization_id: string; contact_id: string | null; external_thread_id: string; channel: 'zalo' | 'facebook' | 'zalo_oa' }>()
    : null;
  if (!conv) return failCommand(db, command.id, command.attempts, 'INVALID_PAYLOAD');
  if (!(await completeCommand(db, command.id, command.attempts, { fields: extracted }))) return false;
  if (!Object.keys(extracted).length) return true;

  let contactId = conv.contact_id;
  if (!contactId) {
    const pointType = channelPointType(conv.channel);
    const matchedContact = await db.prepare(`
      SELECT c.id FROM contact_point cp JOIN contact c ON c.id = cp.contact_id
      WHERE cp.type = ? AND cp.normalized_value = ? AND c.organization_id = ? AND c.archived_at IS NULL
      ORDER BY c.updated_at DESC, cp.created_at DESC LIMIT 1
    `).bind(pointType, conv.external_thread_id, conv.organization_id).first<{ id: string }>();
    if (matchedContact) {
      const nowIso = new Date().toISOString();
      const updated = await db.prepare('UPDATE conversation SET contact_id = ?, updated_at = ? WHERE id = ? AND contact_id IS NULL')
        .bind(matchedContact.id, nowIso, conv.id).run();
      if (updated.meta.changes === 1) {
        contactId = matchedContact.id;
      } else {
        contactId = (await db.prepare('SELECT contact_id FROM conversation WHERE id = ?')
          .bind(conv.id).first<{ contact_id: string | null }>())?.contact_id ?? null;
      }
    }
  }

  if (contactId) {
    const openLead = await db.prepare(`
      SELECT id FROM lead
      WHERE contact_id = ? AND organization_id = ? AND status IN ('queue', 'active')
      ORDER BY created_at DESC, rowid DESC LIMIT 1
    `).bind(contactId, conv.organization_id).first<{ id: string }>();
    if (openLead) {
      const prevNotes = await db.prepare(`
        SELECT summary FROM activity
        WHERE lead_id = ? AND type = 'note' AND actor_kind = 'system' AND summary LIKE 'Trích xuất tự động từ hội thoại: %'
        ORDER BY created_at ASC, rowid ASC
      `).bind(openLead.id).all<{ summary: string }>();
      const previous: IntakeValues = {};
      for (const row of prevNotes.results) {
        Object.assign(previous, parseExtractionNote(row.summary));
      }
      const parts = INTAKE_FIELDS.flatMap((f) => {
        // The summary stays on the pending intake for staff to edit. This note only lists short fields.
        if (f === 'summary') return [];
        const val = extracted[f];
        if (!val) return [];
        if (previous[f] && sameValue(f, previous[f]!, val)) return [];
        return [`${FIELD_LABELS[f]}: ${val}`];
      });
      if (parts.length) {
        const nowIso = new Date().toISOString();
        await db.batch([
          db.prepare(`INSERT INTO activity (id, lead_id, type, summary, actor_user_id, actor_kind, occurred_at, created_at)
            VALUES (?, ?, 'note', ?, NULL, 'system', ?, ?)`).bind(
            crypto.randomUUID(), openLead.id, `${AUTO_EXTRACT_NOTE_PREFIX}${parts.join('; ')}`, nowIso, nowIso,
          ),
          db.prepare('UPDATE conversation SET last_extracted_at = ?, updated_at = ? WHERE id = ?').bind(nowIso, nowIso, conv.id),
        ]);
      }
      return true;
    }
  }

  const matchedProduct = extracted.program ? await matchProgramProduct(db, conv.organization_id, extracted.program) : null;
  const extractedWithProduct: IntakeFields = matchedProduct ? { ...extracted, productId: matchedProduct.id } : extracted;

  // Compare-and-set on the row just read: a concurrent result is merged again on top of the newer row.
  for (let attempt = 0; attempt < MERGE_TRIES; attempt += 1) {
    const now = new Date().toISOString();
    const pending = await db.prepare(`SELECT id, fields_json FROM lead_intake WHERE conversation_id = ? AND status = 'pending'
      ORDER BY created_at LIMIT 1`).bind(conv.id).first<{ id: string; fields_json: string }>();
    const res = pending
      ? await db.prepare(`UPDATE lead_intake SET fields_json = ?, contact_id = COALESCE(contact_id, ?), updated_at = ?
          WHERE id = ? AND status = 'pending' AND fields_json = ?`)
        .bind(JSON.stringify(mergeIntakeFields(readFields(pending.fields_json), extractedWithProduct)), contactId, now, pending.id, pending.fields_json).run()
      : await db.prepare(`INSERT INTO lead_intake (id, organization_id, conversation_id, contact_id, fields_json, status, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, 'pending', ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM lead_intake WHERE conversation_id = ? AND status = 'pending')`)
        .bind(crypto.randomUUID(), conv.organization_id, conv.id, contactId, JSON.stringify(extractedWithProduct), now, now, conv.id).run();
    if (res.meta.changes === 1) return true;
  }
  console.error('extract_merge_contended', command.id);
  return true;
}

// ---------- staff actions ----------

interface IntakeRow {
  id: string;
  conversation_id: string;
  intake_contact_id: string | null;
  conversation_contact_id: string | null;
  fields_json: string;
  status: 'pending' | 'classified' | 'discarded';
  channel: 'zalo' | 'facebook' | 'zalo_oa';
  external_thread_id: string;
}

const intakeNotFound = () => fail('NOT_FOUND', 'Không tìm thấy lead chờ phân loại');
const notPending = () => fail('STALE_VERSION', 'Lead chờ phân loại đã được xử lý. Tải lại để xem bản mới nhất.');

/** An intake of the actor's organization, with the channel and thread of its conversation. */
const loadIntake = (db: D1Database, actor: Actor, intakeId: string) => db.prepare(`SELECT i.id, i.conversation_id,
    i.contact_id AS intake_contact_id, c.contact_id AS conversation_contact_id, i.fields_json, i.status,
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
 * Statements that link the conversation to a contact and add the channel contact point (Zalo user id,
 * Zalo OA user id, or Facebook page-scoped id) when the contact lacks it. Both run only while `guard` holds.
 */
function linkStatements(db: D1Database, intake: IntakeRow, contactId: string, now: string, guard: Guard, keepExistingConvContact = false) {
  const type = channelPointType(intake.channel);
  const thread = intake.external_thread_id;
  const setConvSql = keepExistingConvContact ? 'contact_id = COALESCE(contact_id, ?)' : 'contact_id = ?';
  return [
    db.prepare(`UPDATE conversation SET ${setConvSql}, updated_at = ? WHERE id = ? AND ${guard.sql}`)
      .bind(contactId, now, intake.conversation_id, ...guard.binds),
    db.prepare(`INSERT INTO contact_point (id, contact_id, type, value, normalized_value, created_at)
      SELECT ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM contact_point WHERE contact_id = ? AND type = ? AND normalized_value = ?) AND ${guard.sql}`)
      .bind(crypto.randomUUID(), contactId, type, thread, thread, now, contactId, type, thread, ...guard.binds),
  ];
}

export type IntakePipeline = 'b2b' | 'learner';
export interface ClassifyRequest {
  pipeline: IntakePipeline;
  input: Record<string, unknown>;
  /** Staff-edited conversation summary. Blank or absent keeps the one-line note. */
  summary?: string;
}

/**
 * A staff member turns an intake into a real lead with the existing command: `createLead` for `b2b`,
 * `createLearnerLead` for `learner`. `source` is the conversation's channel, except `zalo_oa`, which is
 * stored as `zalo` because that is a lead source and `zalo_oa` is not. Every other field
 * comes from the staff form as sent, so `confirmNotDuplicate` is only ever the staff member's own choice,
 * and a command error (DUPLICATE_SUSPECTED, VALIDATION_FAILED, ...) is returned unchanged with the intake
 * still pending. On success the intake is classified, the conversation is linked to the lead's contact, the
 * channel contact point is added, and the lead gets one short note: "Tóm tắt hội thoại <kênh>:" plus
 * `summary` when that summary is non-empty, otherwise "Tạo từ hội thoại <kênh>." The conversation is then
 * assigned to the lead's owner with an inbox notice.
 */
export async function classifyIntake(
  db: D1Database, actor: Actor, intakeId: string, request: ClassifyRequest, appBase: string, sink: Sink,
): Promise<ApiResult<{ intakeId: string; leadId: string; contactId: string }>> {
  const intake = await loadIntake(db, actor, intakeId);
  if (!intake) return intakeNotFound();
  if (intake.status !== 'pending') return notPending();
  const name = request.pipeline === 'b2b' ? 'createLead' : 'createLearnerLead';
  // A retry with the same form replays the lead a failed earlier attempt already created instead of creating another.
  const source = intake.channel === 'zalo_oa' ? 'zalo' : intake.channel;
  const existingContactId = intake.conversation_contact_id ?? intake.intake_contact_id ?? undefined;
  const explicitContactId = typeof request.input.contactId === 'string' && request.input.contactId.trim() !== '';
  const cmdInput = {
    ...(existingContactId && !explicitContactId ? { contactId: existingContactId } : {}),
    ...request.input,
    source,
  };
  const result = await runCommand(db, actor, name, cmdInput, `intake:${intake.id}`);
  if (!result.ok) return result;
  const leadId = (result.data as { leadId?: unknown }).leadId;
  if (typeof leadId !== 'string') throw new Error(`${name} returned no lead id`);
  const lead = await db.prepare(`
    SELECT l.contact_id, l.code, l.owner_user_id, c.display_name AS contact_name, p.name AS product_name
    FROM lead l
    JOIN contact c ON c.id = l.contact_id
    LEFT JOIN product p ON p.id = l.product_id
    WHERE l.id = ?
  `).bind(leadId).first<{ contact_id: string; code: string; owner_user_id: string | null; contact_name: string; product_name: string | null }>();
  if (!lead) throw new Error(`${name} lead not found after commit`);

  const now = new Date().toISOString();
  const channelLabel = intake.channel === 'facebook' ? 'Facebook' : intake.channel === 'zalo_oa' ? 'Zalo OA' : 'Zalo';
  const summary = request.summary?.trim() ?? '';
  const note = summary
    ? `Tóm tắt hội thoại ${channelLabel}:\n${summary}`
    : `Tạo từ hội thoại ${channelLabel}.`;
  const move = moveIntake(db, actor, intake.id, 'classified', now, { leadId, contactId: lead.contact_id });
  const [moved] = await db.batch([
    move.statement,
    ...linkStatements(db, intake, lead.contact_id, now, move.guard, !explicitContactId),
    db.prepare(`INSERT INTO activity (id, lead_id, type, summary, actor_user_id, actor_kind, occurred_at, created_at)
      SELECT ?, ?, 'note', ?, ?, ?, ?, ? WHERE ${move.guard.sql}`)
      .bind(crypto.randomUUID(), leadId, note, actor.id, actor.kind, now, now, ...move.guard.binds),
    auditIntake(db, actor, 'inbox.classifyIntake', intake.id, { status: 'pending' },
      { status: 'classified', pipeline: request.pipeline, leadId, contactId: lead.contact_id, conversationId: intake.conversation_id },
      now, move.guard),
  ]);
  // Someone else classified the intake meanwhile: the lead created here stands on its own and is not linked.
  if (moved!.meta.changes !== 1) return notPending();

  if (lead.owner_user_id) {
    try {
      const assignee = await assignConversationToLeadOwner(db, actor, intake.conversation_id, lead.owner_user_id, appBase, sink);
      if (assignee) {
        const link = request.pipeline === 'b2b'
          ? `/leads/${leadId}`
          : `/learners/${lead.contact_id}`;
        const detailUrl = `${appBase}${link}`;
        const parts = [
          `Bạn có lead mới ${lead.code}`,
          lead.contact_name,
          ...(lead.product_name ? [lead.product_name] : []),
          detailUrl,
        ];
        await notifyInboxUser(sink, {
          organizationId: actor.organizationId,
          userId: assignee.id,
          text: parts.join(' – '),
          link,
        });
      }
    } catch (error) {
      console.error('classify_post_assign_error', error instanceof Error ? error.message : 'unknown');
    }
  }

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
  if (field === 'program') {
    const matched = await matchProgramProduct(db, actor.organizationId, proposed);
    if (matched) next.productId = matched.id;
    else delete next.productId;
  }
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
