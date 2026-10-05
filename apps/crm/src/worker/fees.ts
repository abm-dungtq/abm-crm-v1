import { MONEY_ROLES, type AllocatePaymentInput, type CreateChargeInput, type MoveEnrollmentChargesInput, type RecordPaymentInput, type RevokeAllocationInput, type SetInvoiceRefInput, type UpdateOrgBankInput, type VoidChargeInput } from '@abm/contracts';
import { fail, isoUtc, ok, type ApiFail, type Ctx } from './command-result';
import type { Actor } from './env';
import type { GuardedTx } from './guarded-tx';
import { markStepDone, reopenStep } from './learner-commands';

const LIVE_ENROLLMENT = ['pending', 'confirmed', 'studying', 'deferred'] as const;
const LIVE_SQL = LIVE_ENROLLMENT.map(() => '?').join(', ');

/**
 * Remaining of charge `c`: nominal amount minus allocations still in force.
 * The balance is computed wherever it is read and is never stored.
 */
export const chargeBalanceSql = `c.amount_vnd - COALESCE((SELECT SUM(a.amount_vnd) FROM payment_allocation a WHERE a.charge_id = c.id AND a.revoked_at IS NULL), 0)`;

const paymentWithinSql = `(SELECT COALESCE(SUM(amount_vnd),0) FROM payment_allocation WHERE payment_id = ? AND revoked_at IS NULL) <= (SELECT amount_vnd FROM payment WHERE id = ?)`;
const chargeWithinSql = `(SELECT COALESCE(SUM(amount_vnd),0) FROM payment_allocation WHERE charge_id = ? AND revoked_at IS NULL) <= (SELECT amount_vnd FROM charge WHERE id = ?)`;
const chargeOpenSql = `SELECT status = 'open' FROM charge WHERE id = ?`;
/** Remaining of every open charge on one enrollment, read again inside the batch. */
const openEnrollmentRemainingSql = `COALESCE((SELECT SUM(c.amount_vnd - COALESCE((SELECT SUM(a.amount_vnd) FROM payment_allocation a WHERE a.charge_id = c.id AND a.revoked_at IS NULL), 0)) FROM charge c WHERE c.enrollment_id = ? AND c.status = 'open'), 0)`;

const stale = () => fail('STALE_VERSION', 'Dữ liệu vừa được người khác cập nhật. Tải lại rồi thử lại.');
const CHARGE_CODE = /(?:^|[^A-Z0-9])(HP\d{6})(?!\d)/g;

interface ChargeRow {
  id: string;
  code: string;
  contact_id: string;
  enrollment_id: string | null;
  kind: string;
  amount_vnd: number;
  status: string;
  version: number;
  remaining: number;
  invoice_ref: string | null;
  note: string | null;
  product_name: string | null;
  sessions_count: number | null;
}

interface PaymentRow {
  id: string;
  direction: string;
  amount_vnd: number;
  version: number;
  allocated: number;
}

interface EnrollmentFeeRow {
  id: string;
  contact_id: string;
  status: string;
  version: number;
  transferred_from_enrollment_id: string | null;
  product_name: string | null;
  lead_id: string;
}

export const canReadMoney = (actor: Actor) => (MONEY_ROLES as readonly string[]).includes(actor.role);

async function loadEnrollment(db: D1Database, organizationId: string, enrollmentId: string) {
  return db.prepare(`SELECT e.id, e.contact_id, e.status, e.version, e.transferred_from_enrollment_id, e.lead_id, p.name AS product_name
    FROM enrollment e JOIN class_group cg ON cg.id = e.class_id JOIN course co ON co.id = cg.course_id JOIN product p ON p.id = co.product_id
    WHERE e.id = ? AND e.organization_id = ?`).bind(enrollmentId, organizationId).first<EnrollmentFeeRow>();
}

async function loadCharge(db: D1Database, organizationId: string, chargeId: string) {
  return db.prepare(`SELECT c.id, c.code, c.contact_id, c.enrollment_id, c.kind, c.amount_vnd, c.status, c.version, c.invoice_ref, c.note,
      c.product_name, c.sessions_count, ${chargeBalanceSql} AS remaining
    FROM charge c WHERE c.id = ? AND c.organization_id = ?`).bind(chargeId, organizationId).first<ChargeRow>();
}

async function loadPayment(db: D1Database, organizationId: string, paymentId: string) {
  return db.prepare(`SELECT p.id, p.direction, p.amount_vnd, p.version,
      COALESCE((SELECT SUM(a.amount_vnd) FROM payment_allocation a WHERE a.payment_id = p.id AND a.revoked_at IS NULL), 0) AS allocated
    FROM payment p WHERE p.id = ? AND p.organization_id = ?`).bind(paymentId, organizationId).first<PaymentRow>();
}

interface ChargeEffect {
  id: string;
  enrollmentId: string | null;
  kind: string;
  amountVnd: number;
  paid: number;
  status: string;
}

/**
 * Rows this command has staged but not committed. Handler reads run before the batch,
 * so they cannot see those rows. The step decision uses the committed charges plus this effect.
 * The step write is in the same batch and rolls back if a money assert fails.
 */
interface TuitionEffect {
  add?: ChargeEffect[];
  paidDelta?: Record<string, number>;
  voidIds?: string[];
  moveTo?: { chargeIds: string[]; enrollmentId: string };
}

/**
 * Marks "Thu học phí khóa" done when the lead's one live enrollment has an open tuition
 * and the remaining of every open charge on that enrollment (including a negative adjustment) is at most zero.
 * Reopens the step when that remaining becomes positive again.
 */
async function syncTuitionStep(db: D1Database, tx: GuardedTx, actorId: string, contactId: string, effect: TuitionEffect = {}): Promise<ApiFail | null> {
  const leads = await db.prepare(`SELECT id FROM lead WHERE contact_id = ? AND pipeline = 'learner'`).bind(contactId).all<{ id: string }>();
  const stored = await db.prepare(`SELECT c.id, c.enrollment_id, c.kind, c.amount_vnd, c.status,
      COALESCE((SELECT SUM(a.amount_vnd) FROM payment_allocation a WHERE a.charge_id = c.id AND a.revoked_at IS NULL), 0) AS paid
    FROM charge c WHERE c.contact_id = ?`).bind(contactId).all<{
    id: string; enrollment_id: string | null; kind: string; amount_vnd: number; status: string; paid: number;
  }>();
  const charges: ChargeEffect[] = stored.results.map((row) => ({
    id: row.id, enrollmentId: row.enrollment_id, kind: row.kind, amountVnd: Number(row.amount_vnd), paid: Number(row.paid), status: row.status,
  }));
  for (const extra of effect.add ?? []) charges.push(extra);
  for (const [chargeId, delta] of Object.entries(effect.paidDelta ?? {})) {
    const charge = charges.find((row) => row.id === chargeId);
    if (charge) charge.paid += delta;
  }
  for (const chargeId of effect.voidIds ?? []) {
    const charge = charges.find((row) => row.id === chargeId);
    if (charge) charge.status = 'void';
  }
  if (effect.moveTo) {
    const moving = new Set(effect.moveTo.chargeIds);
    for (const charge of charges) if (moving.has(charge.id)) charge.enrollmentId = effect.moveTo.enrollmentId;
  }
  for (const lead of leads.results) {
    const enrollments = await db.prepare(`SELECT id FROM enrollment WHERE lead_id = ? AND status IN (${LIVE_SQL})`)
      .bind(lead.id, ...LIVE_ENROLLMENT).all<{ id: string }>();
    for (const enrollment of enrollments.results) {
      const open = charges.filter((charge) => charge.enrollmentId === enrollment.id && charge.status === 'open');
      const remaining = open.reduce((sum, charge) => sum + charge.amountVnd - charge.paid, 0);
      const tuitions = open.filter((charge) => charge.kind === 'tuition').length;
      // A second writer can change this remaining after the read. The batch re-reads it and aborts
      // when the decision no longer matches, so the caller reloads and decides again.
      if (tuitions >= 1 && remaining <= 0) {
        tx.assert(`SELECT (${openEnrollmentRemainingSql}) <= 0`, [enrollment.id]);
        const marked = await markStepDone(db, tx, actorId, lead.id, 'tuition_paid');
        if (marked) return marked;
      } else if (remaining > 0) {
        if (tuitions >= 1) tx.assert(`SELECT (${openEnrollmentRemainingSql}) > 0`, [enrollment.id]);
        const reopened = await reopenStep(db, tx, lead.id, 'tuition_paid');
        if (reopened) return reopened;
      }
    }
  }
  return null;
}

function assertChargeTotals(tx: GuardedTx, chargeIds: string[]) {
  for (const chargeId of new Set(chargeIds)) {
    tx.assert(chargeWithinSql, [chargeId, chargeId]);
    tx.assert(chargeOpenSql, [chargeId]);
  }
}

/** A discount is its own negative adjustment. Tuition amount_vnd is the figure the accountant typed and is never rewritten. */
async function createCharge({ db, actor, input, tx }: Ctx<CreateChargeInput>) {
  const contact = await db.prepare('SELECT id FROM contact WHERE id = ? AND organization_id = ? AND archived_at IS NULL')
    .bind(input.contactId, actor.organizationId).first();
  if (!contact) return fail('VALIDATION_FAILED', 'Không tìm thấy học viên', { fields: { contactId: 'Không hợp lệ' } });
  let productName: string | null = null;
  if (input.enrollmentId) {
    const enrollment = await loadEnrollment(db, actor.organizationId, input.enrollmentId);
    const live = enrollment && (LIVE_ENROLLMENT as readonly string[]).includes(enrollment.status) && enrollment.contact_id === input.contactId;
    if (!enrollment || !live) return fail('VALIDATION_FAILED', 'Ghi danh không thuộc học viên này hoặc không còn hiệu lực', { fields: { enrollmentId: 'Không hợp lệ' } });
    productName = enrollment.product_name;
  }
  const id = crypto.randomUUID();
  tx.raw(db.prepare('INSERT INTO fee_counter (organization_id, next_value) VALUES (?, 1) ON CONFLICT DO NOTHING').bind(actor.organizationId));
  tx.insertVersioned('charge', {
    id, organization_id: actor.organizationId, contact_id: input.contactId, enrollment_id: input.enrollmentId ?? null,
    kind: input.kind, amount_vnd: input.amountVnd, product_name: productName, sessions_count: input.sessionsCount ?? null,
    note: input.note ?? null, invoice_ref: null, status: 'open',
  }, {
    cols: ['code'],
    exprs: [`(SELECT printf('HP%06d', next_value) FROM fee_counter WHERE organization_id = ?)`],
    binds: [actor.organizationId],
  });
  tx.raw(db.prepare('UPDATE fee_counter SET next_value = next_value + 1 WHERE organization_id = ?').bind(actor.organizationId));
  const synced = await syncTuitionStep(db, tx, actor.id, input.contactId, {
    add: [{ id, enrollmentId: input.enrollmentId ?? null, kind: input.kind, amountVnd: input.amountVnd, paid: 0, status: 'open' }],
  });
  if (synced) return synced;
  tx.audit('charge', id, null, { kind: input.kind, amountVnd: input.amountVnd, contactId: input.contactId, enrollmentId: input.enrollmentId ?? null });
  return ok({ id, version: 1 });
}

async function voidCharge({ db, actor, input, tx }: Ctx<VoidChargeInput>) {
  const charge = await loadCharge(db, actor.organizationId, input.chargeId);
  if (!charge) return fail('NOT_FOUND', 'Không tìm thấy khoản phải thu');
  if (charge.version !== input.version) return stale();
  if (charge.status !== 'open') return fail('VALIDATION_FAILED', 'Khoản phải thu đã hủy');
  const active = await db.prepare('SELECT COUNT(*) AS n FROM payment_allocation WHERE charge_id = ? AND revoked_at IS NULL')
    .bind(charge.id).first<{ n: number }>();
  if ((active?.n ?? 0) > 0) return fail('VALIDATION_FAILED', 'Khoản còn phân bổ đang hiệu lực. Thu hồi phân bổ trước khi hủy');
  tx.update('charge', charge.id, input.version, { status: 'void' });
  tx.assert('SELECT COUNT(*) = 0 FROM payment_allocation WHERE charge_id = ? AND revoked_at IS NULL', [charge.id]);
  const synced = await syncTuitionStep(db, tx, actor.id, charge.contact_id, { voidIds: [charge.id] });
  if (synced) return synced;
  tx.audit('charge', charge.id, { status: charge.status }, { status: 'void', reason: input.reason });
  return ok({ id: charge.id, status: 'void' });
}

/**
 * Records money in or a refund.
 * A refund is only a record. It is never allocated to a charge, so it cannot reduce what a learner still owes.
 */
async function recordPayment({ db, actor, input, tx }: Ctx<RecordPaymentInput>) {
  const receivedAt = isoUtc(input.receivedAt);
  if (!receivedAt) return fail('VALIDATION_FAILED', 'Thời điểm không hợp lệ', { fields: { receivedAt: 'Không hợp lệ' } });
  let refundContactId: string | null = null;
  if (input.direction === 'refund' && input.contactId) {
    const contact = await db.prepare('SELECT id FROM contact WHERE id = ? AND organization_id = ?')
      .bind(input.contactId, actor.organizationId).first<{ id: string }>();
    if (!contact) return fail('VALIDATION_FAILED', 'Không tìm thấy học viên', { fields: { contactId: 'Không hợp lệ' } });
    refundContactId = contact.id;
  }
  // Banks and payers sometimes send the reference in lower case. The stored memo stays as typed.
  CHARGE_CODE.lastIndex = 0;
  const codes = [...(input.memo ?? '').toUpperCase().matchAll(CHARGE_CODE)].map((match) => match[1]!);
  let auto: ChargeRow | null = null;
  if (input.direction === 'in' && codes.length === 1) {
    const charge = await db.prepare(`SELECT c.id, c.code, c.contact_id, c.enrollment_id, c.kind, c.amount_vnd, c.status, c.version,
        c.invoice_ref, c.note, c.product_name, c.sessions_count, ${chargeBalanceSql} AS remaining
      FROM charge c WHERE c.code = ? AND c.organization_id = ?`).bind(codes[0], actor.organizationId).first<ChargeRow>();
    if (charge && charge.status === 'open' && Number(charge.remaining) >= input.amountVnd) auto = charge;
  }
  const id = crypto.randomUUID();
  tx.insertVersioned('payment', {
    id, organization_id: actor.organizationId, direction: input.direction, method: input.method, amount_vnd: input.amountVnd,
    received_at: receivedAt, memo: input.memo ?? null, payer_note: input.payerNote ?? null, contact_id: refundContactId,
    recorded_by_user_id: actor.id,
  });
  if (auto) {
    tx.insertVersioned('payment_allocation', {
      id: crypto.randomUUID(), payment_id: id, charge_id: auto.id, amount_vnd: input.amountVnd,
      created_by_user_id: actor.id, revoked_at: null,
    });
    // Checked again inside the batch, after the insert, so a concurrent allocation cannot overshoot or land on a voided charge.
    tx.assert(chargeWithinSql, [auto.id, auto.id]);
    tx.assert(chargeOpenSql, [auto.id]);
    const synced = await syncTuitionStep(db, tx, actor.id, auto.contact_id, { paidDelta: { [auto.id]: input.amountVnd } });
    if (synced) return synced;
  }
  tx.audit('payment', id, null, { direction: input.direction, method: input.method, amountVnd: input.amountVnd, allocatedChargeId: auto?.id ?? null, contactId: refundContactId });
  return ok({ id, version: 1, allocatedChargeId: auto?.id ?? null });
}

async function allocatePayment({ db, actor, input, tx }: Ctx<AllocatePaymentInput>) {
  const payment = await loadPayment(db, actor.organizationId, input.paymentId);
  if (!payment) return fail('NOT_FOUND', 'Không tìm thấy khoản tiền');
  if (payment.version !== input.version) return stale();
  // A refund is never allocated. Only money that came in can be matched to a receivable.
  if (payment.direction !== 'in') return fail('VALIDATION_FAILED', 'Hoàn tiền không được phân bổ');
  const seen = new Set<string>();
  let added = 0;
  const charges: ChargeRow[] = [];
  for (const line of input.allocations) {
    if (seen.has(line.chargeId)) return fail('VALIDATION_FAILED', 'Mỗi khoản phải thu chỉ có một dòng phân bổ', { fields: { allocations: 'Trùng khoản' } });
    seen.add(line.chargeId);
    added += line.amountVnd;
    const charge = await loadCharge(db, actor.organizationId, line.chargeId);
    if (!charge || charge.status !== 'open') return fail('VALIDATION_FAILED', 'Khoản phải thu không còn mở', { fields: { allocations: 'Không hợp lệ' } });
    if (line.amountVnd > Number(charge.remaining)) return fail('VALIDATION_FAILED', 'Phân bổ vượt số còn lại của khoản phải thu');
    charges.push(charge);
  }
  if (Number(payment.allocated) + added > payment.amount_vnd) return fail('VALIDATION_FAILED', 'Phân bổ vượt số tiền của khoản thu');
  tx.update('payment', payment.id, input.version, {});
  for (let i = 0; i < input.allocations.length; i++) {
    const line = input.allocations[i]!;
    tx.insertVersioned('payment_allocation', {
      id: crypto.randomUUID(), payment_id: payment.id, charge_id: line.chargeId, amount_vnd: line.amountVnd,
      created_by_user_id: actor.id, revoked_at: null,
    });
  }
  // Inserts are already in the batch. The sums are re-checked here so two accountants cannot both pass the pre-check.
  tx.assert(paymentWithinSql, [payment.id, payment.id]);
  assertChargeTotals(tx, charges.map((charge) => charge.id));
  const paidDelta: Record<string, number> = {};
  for (const line of input.allocations) paidDelta[line.chargeId] = line.amountVnd;
  for (const contactId of new Set(charges.map((charge) => charge.contact_id))) {
    const synced = await syncTuitionStep(db, tx, actor.id, contactId, { paidDelta });
    if (synced) return synced;
  }
  tx.audit('payment', payment.id, { allocated: payment.allocated }, { added, allocations: input.allocations });
  return ok({ id: payment.id, version: input.version + 1 });
}

async function revokeAllocation({ db, actor, input, tx }: Ctx<RevokeAllocationInput>) {
  const row = await db.prepare(`SELECT a.id, a.version, a.revoked_at, a.amount_vnd, a.charge_id, a.payment_id, c.contact_id
    FROM payment_allocation a JOIN charge c ON c.id = a.charge_id
    WHERE a.id = ? AND c.organization_id = ?`).bind(input.allocationId, actor.organizationId)
    .first<{ id: string; version: number; revoked_at: string | null; amount_vnd: number; charge_id: string; payment_id: string; contact_id: string }>();
  if (!row) return fail('NOT_FOUND', 'Không tìm thấy phân bổ');
  if (row.revoked_at) return fail('VALIDATION_FAILED', 'Phân bổ đã được thu hồi');
  if (row.version !== input.version) return stale();
  tx.update('payment_allocation', row.id, input.version, { revoked_at: tx.now });
  const synced = await syncTuitionStep(db, tx, actor.id, row.contact_id, { paidDelta: { [row.charge_id]: -Number(row.amount_vnd) } });
  if (synced) return synced;
  tx.audit('payment_allocation', row.id, { revokedAt: null, amountVnd: row.amount_vnd }, { revokedAt: tx.now, reason: input.reason });
  return ok({ id: row.id, revoked: true });
}

async function setInvoiceRef({ db, actor, input, tx }: Ctx<SetInvoiceRefInput>) {
  const charge = await loadCharge(db, actor.organizationId, input.chargeId);
  if (!charge) return fail('NOT_FOUND', 'Không tìm thấy khoản phải thu');
  if (charge.version !== input.version) return stale();
  tx.update('charge', charge.id, input.version, { invoice_ref: input.invoiceRef });
  tx.audit('charge', charge.id, { invoiceRef: charge.invoice_ref }, { invoiceRef: input.invoiceRef });
  return ok({ id: charge.id, invoiceRef: input.invoiceRef });
}

async function moveEnrollmentCharges({ db, actor, input, tx }: Ctx<MoveEnrollmentChargesInput>) {
  const source = await loadEnrollment(db, actor.organizationId, input.fromEnrollmentId);
  const target = await loadEnrollment(db, actor.organizationId, input.toEnrollmentId);
  if (!source || !target) return fail('NOT_FOUND', 'Không tìm thấy ghi danh');
  if (source.status !== 'transferred') return fail('VALIDATION_FAILED', 'Chỉ chuyển khoản phải thu từ ghi danh đã chuyển lớp');
  if (target.transferred_from_enrollment_id !== source.id) return fail('VALIDATION_FAILED', 'Ghi danh đích không nối với ghi danh nguồn');
  if (target.version !== input.version) return stale();
  const charges = await db.prepare(`SELECT id, version FROM charge WHERE enrollment_id = ? AND status = 'open' AND organization_id = ?`)
    .bind(source.id, actor.organizationId).all<{ id: string; version: number }>();
  // The destination enrollment is the anchor. Its version comes from the client.
  // Each charge keeps the version read for this command, so a concurrent edit aborts the move.
  tx.update('enrollment', target.id, input.version, {});
  for (const charge of charges.results) tx.update('charge', charge.id, charge.version, { enrollment_id: target.id });
  tx.assert(`SELECT COUNT(*) = 1 FROM enrollment WHERE id = ? AND status = 'transferred'`, [source.id]);
  tx.assert(`SELECT COUNT(*) = 1 FROM enrollment WHERE id = ? AND transferred_from_enrollment_id = ?`, [target.id, source.id]);
  const synced = await syncTuitionStep(db, tx, actor.id, target.contact_id, {
    moveTo: { chargeIds: charges.results.map((charge) => charge.id), enrollmentId: target.id },
  });
  if (synced) return synced;
  tx.audit('enrollment', target.id, { fromEnrollmentId: source.id }, { toEnrollmentId: target.id, moved: charges.results.length });
  return ok({ moved: charges.results.length });
}

async function updateOrgBank({ db, actor, input, tx }: Ctx<UpdateOrgBankInput>) {
  const row = await db.prepare('SELECT id, version, bank_name, bank_account_no, bank_account_holder FROM org_setting WHERE id = ?')
    .bind(actor.organizationId).first<{ id: string; version: number; bank_name: string | null; bank_account_no: string | null; bank_account_holder: string | null }>();
  if (!row) return fail('NOT_FOUND', 'Chưa có cấu hình đơn vị');
  if (row.version !== input.version) return stale();
  const next = { bank_name: input.bankName, bank_account_no: input.bankAccountNo, bank_account_holder: input.bankAccountHolder };
  tx.update('org_setting', row.id, input.version, next);
  tx.audit('org_setting', row.id, { bankName: row.bank_name, bankAccountNo: row.bank_account_no, bankAccountHolder: row.bank_account_holder }, {
    bankName: input.bankName, bankAccountNo: input.bankAccountNo, bankAccountHolder: input.bankAccountHolder,
  });
  return ok({ version: input.version + 1 });
}

// ---------- queries ----------

const denied = 'forbidden' as const;

function likeTerm(q: string | undefined) {
  const term = q?.trim().replace(/[%_]/g, '') ?? '';
  return term ? `%${term}%` : null;
}

export async function listCharges(db: D1Database, actor: Actor, filters: { status?: string; q?: string; contactId?: string }) {
  if (!canReadMoney(actor)) return denied;
  const where = ['c.organization_id = ?'];
  const binds: unknown[] = [actor.organizationId];
  if (filters.contactId) {
    where.push('c.contact_id = ?');
    binds.push(filters.contactId);
  }
  if (filters.status === 'open' || filters.status === 'void') {
    where.push('c.status = ?');
    binds.push(filters.status);
  }
  const term = likeTerm(filters.q);
  if (term) {
    where.push('(c.code LIKE ? OR ct.display_name LIKE ?)');
    binds.push(term, term);
  }
  const rows = await db.prepare(`SELECT c.id, c.code, c.contact_id, ct.display_name AS contact_name, c.enrollment_id, c.kind, c.amount_vnd,
      COALESCE((SELECT SUM(a.amount_vnd) FROM payment_allocation a WHERE a.charge_id = c.id AND a.revoked_at IS NULL), 0) AS paid,
      ${chargeBalanceSql} AS remaining, c.product_name, c.sessions_count, c.note, c.invoice_ref, c.status, c.version, c.created_at
    FROM charge c JOIN contact ct ON ct.id = c.contact_id
    WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC, c.code DESC LIMIT 300`).bind(...binds).all<{
    id: string; code: string; contact_id: string; contact_name: string; enrollment_id: string | null; kind: string; amount_vnd: number;
    paid: number; remaining: number; product_name: string | null; sessions_count: number | null; note: string | null; invoice_ref: string | null;
    status: string; version: number; created_at: string;
  }>();
  return rows.results.map((row) => ({
    id: row.id, code: row.code, contactId: row.contact_id, contactName: row.contact_name, enrollmentId: row.enrollment_id,
    kind: row.kind, amountVnd: Number(row.amount_vnd), paid: Number(row.paid), remaining: Number(row.remaining), productName: row.product_name,
    sessionsCount: row.sessions_count, note: row.note, invoiceRef: row.invoice_ref, status: row.status, version: row.version, createdAt: row.created_at,
  }));
}

/** Incoming payments that still have money unmatched. Refunds are excluded: they are never allocated. Oldest first. */
export async function listUnallocatedPayments(db: D1Database, actor: Actor) {
  if (!canReadMoney(actor)) return denied;
  const rows = await db.prepare(`SELECT p.id, p.direction, p.method, p.amount_vnd, p.received_at, p.memo, p.payer_note, p.version,
      COALESCE((SELECT SUM(a.amount_vnd) FROM payment_allocation a WHERE a.payment_id = p.id AND a.revoked_at IS NULL), 0) AS allocated
    FROM payment p
    WHERE p.organization_id = ? AND p.direction = 'in'
      AND p.amount_vnd - COALESCE((SELECT SUM(a.amount_vnd) FROM payment_allocation a WHERE a.payment_id = p.id AND a.revoked_at IS NULL), 0) > 0
    ORDER BY p.received_at ASC, p.id LIMIT 200`).bind(actor.organizationId).all<{
    id: string; direction: string; method: string; amount_vnd: number; received_at: string; memo: string | null; payer_note: string | null;
    version: number; allocated: number;
  }>();
  return rows.results.map((row) => ({
    id: row.id, direction: row.direction, method: row.method, amountVnd: Number(row.amount_vnd), allocated: Number(row.allocated),
    remaining: Number(row.amount_vnd) - Number(row.allocated), receivedAt: row.received_at, memo: row.memo, payerNote: row.payer_note, version: row.version,
  }));
}

export async function contactLedger(db: D1Database, actor: Actor, contactId: string) {
  if (!canReadMoney(actor)) return denied;
  const contact = await db.prepare('SELECT id, display_name FROM contact WHERE id = ? AND organization_id = ?')
    .bind(contactId, actor.organizationId).first<{ id: string; display_name: string }>();
  if (!contact) return null;
  const charges = await listCharges(db, actor, { contactId });
  if (charges === denied) return denied;
  const payments = await db.prepare(`SELECT p.id, p.direction, p.method, p.amount_vnd, p.received_at, p.memo, p.version,
      COALESCE((SELECT SUM(a.amount_vnd) FROM payment_allocation a JOIN charge c ON c.id = a.charge_id
        WHERE a.payment_id = p.id AND c.contact_id = ? AND a.revoked_at IS NULL), 0) AS allocated_here
    FROM payment p
    WHERE p.organization_id = ?
      AND (
        p.contact_id = ?
        OR EXISTS (SELECT 1 FROM payment_allocation a JOIN charge c ON c.id = a.charge_id
          WHERE a.payment_id = p.id AND c.contact_id = ? AND a.revoked_at IS NULL)
      )
    ORDER BY p.received_at ASC, p.id`).bind(contactId, actor.organizationId, contactId, contactId).all<{
    id: string; direction: string; method: string; amount_vnd: number; received_at: string; memo: string | null; version: number; allocated_here: number;
  }>();
  const allocations = await db.prepare(`SELECT a.id, a.version, a.payment_id, a.charge_id, c.code AS charge_code, a.amount_vnd, a.created_at
    FROM payment_allocation a JOIN charge c ON c.id = a.charge_id
    WHERE c.contact_id = ? AND c.organization_id = ? AND a.revoked_at IS NULL
    ORDER BY a.created_at, a.id`).bind(contactId, actor.organizationId).all<{
    id: string; version: number; payment_id: string; charge_id: string; charge_code: string; amount_vnd: number; created_at: string;
  }>();
  const transfers = await db.prepare(`SELECT src.id AS from_id, dst.id AS to_id, dst.version AS to_version,
      src_class.name AS from_class, dst_class.name AS to_class,
      (SELECT COUNT(*) FROM charge ch WHERE ch.enrollment_id = src.id AND ch.status = 'open' AND ch.organization_id = ?) AS open_count
    FROM enrollment src
    JOIN enrollment dst ON dst.transferred_from_enrollment_id = src.id AND dst.organization_id = src.organization_id
    JOIN class_group src_class ON src_class.id = src.class_id
    JOIN class_group dst_class ON dst_class.id = dst.class_id
    WHERE src.contact_id = ? AND src.organization_id = ? AND src.status = 'transferred'
    ORDER BY src_class.name, src.id`).bind(actor.organizationId, contactId, actor.organizationId).all<{
    from_id: string; to_id: string; to_version: number; from_class: string; to_class: string; open_count: number;
  }>();
  return {
    contact: { id: contact.id, name: contact.display_name },
    charges,
    payments: payments.results.map((row) => ({
      id: row.id, direction: row.direction, method: row.method, amountVnd: Number(row.amount_vnd), receivedAt: row.received_at,
      memo: row.memo, version: row.version, allocatedToContact: Number(row.allocated_here),
    })),
    allocations: allocations.results.map((row) => ({
      id: row.id, version: row.version, paymentId: row.payment_id, chargeId: row.charge_id, chargeCode: row.charge_code,
      amountVnd: Number(row.amount_vnd), createdAt: row.created_at,
    })),
    transfers: transfers.results.map((row) => ({
      fromEnrollmentId: row.from_id, toEnrollmentId: row.to_id, version: row.to_version,
      fromClassName: row.from_class, toClassName: row.to_class, openChargeCount: Number(row.open_count),
    })),
  };
}

export async function chargeGuide(db: D1Database, actor: Actor, chargeId: string) {
  if (!canReadMoney(actor)) return denied;
  const charge = await db.prepare(`SELECT c.id, c.code, ct.display_name AS contact_name, ${chargeBalanceSql} AS remaining
    FROM charge c JOIN contact ct ON ct.id = c.contact_id WHERE c.id = ? AND c.organization_id = ?`)
    .bind(chargeId, actor.organizationId).first<{ id: string; code: string; contact_name: string; remaining: number }>();
  if (!charge) return null;
  const bank = await db.prepare('SELECT bank_name, bank_account_no, bank_account_holder FROM org_setting WHERE organization_id = ?')
    .bind(actor.organizationId).first<{ bank_name: string | null; bank_account_no: string | null; bank_account_holder: string | null }>();
  return {
    chargeId: charge.id, code: charge.code, contactName: charge.contact_name, remaining: Number(charge.remaining),
    bankName: bank?.bank_name ?? null, bankAccountNo: bank?.bank_account_no ?? null, bankAccountHolder: bank?.bank_account_holder ?? null,
    transferContent: `ABM ${charge.code}`,
  };
}

/** Names, lead codes and the live enrollment, for the charge form. */
export async function searchFeeContacts(db: D1Database, actor: Actor, q: string | undefined) {
  if (!canReadMoney(actor)) return denied;
  const term = likeTerm(q);
  const where = ['c.organization_id = ?', 'c.archived_at IS NULL', `l.pipeline = 'learner'`];
  const binds: unknown[] = [actor.organizationId];
  if (term) {
    where.push('(c.display_name LIKE ? OR l.code LIKE ?)');
    binds.push(term, term);
  }
  const rows = await db.prepare(`SELECT c.id AS contact_id, c.display_name AS name, l.id AS lead_id, l.code AS lead_code,
      e.id AS enrollment_id, cg.name AS class_name, co.name AS course_name, p.name AS product_name
    FROM contact c JOIN lead l ON l.contact_id = c.id
    LEFT JOIN enrollment e ON e.lead_id = l.id AND e.status IN (${LIVE_SQL})
    LEFT JOIN class_group cg ON cg.id = e.class_id
    LEFT JOIN course co ON co.id = cg.course_id
    LEFT JOIN product p ON p.id = co.product_id
    WHERE ${where.join(' AND ')}
    ORDER BY c.display_name, l.code LIMIT 30`).bind(...LIVE_ENROLLMENT, ...binds).all<{
    contact_id: string; name: string; lead_id: string; lead_code: string; enrollment_id: string | null;
    class_name: string | null; course_name: string | null; product_name: string | null;
  }>();
  return rows.results.map((row) => ({
    contactId: row.contact_id, name: row.name, leadId: row.lead_id, leadCode: row.lead_code, enrollmentId: row.enrollment_id,
    className: row.class_name, courseName: row.course_name, productName: row.product_name,
  }));
}

export async function orgBank(db: D1Database, actor: Actor) {
  if (!canReadMoney(actor)) return denied;
  const row = await db.prepare('SELECT version, bank_name, bank_account_no, bank_account_holder FROM org_setting WHERE organization_id = ?')
    .bind(actor.organizationId).first<{ version: number; bank_name: string | null; bank_account_no: string | null; bank_account_holder: string | null }>();
  if (!row) return null;
  return { version: row.version, bankName: row.bank_name, bankAccountNo: row.bank_account_no, bankAccountHolder: row.bank_account_holder };
}

export const feeHandlers = {
  createCharge, voidCharge, recordPayment, allocatePayment, revokeAllocation, setInvoiceRef, moveEnrollmentCharges, updateOrgBank,
};
