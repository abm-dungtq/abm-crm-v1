import { beforeEach, describe, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import {
  addUser, command, db, get, grantConsent, makeClass, reserve, winLead,
} from './helpers/learner-fixtures';
import { resetDb } from './helpers/reset-db';

beforeEach(async () => {
  await resetDb(db, seedSql);
  await addUser('u-academic', 'academic');
  await addUser('u-teacher', 'teacher');
  await addUser('u-accountant', 'accountant');
});

async function confirmSeat(name: string, phone: string, classId: string) {
  const won = await winLead(name, phone);
  const enrollmentId = await reserve(won.leadId, classId);
  expect((await grantConsent(won.contactId)).status).toBe(200);
  const confirmed = await command('u-academic', 'confirmEnrollment', { enrollmentId, version: 1 });
  expect(confirmed.status, JSON.stringify(confirmed.json)).toBe(200);
  return { ...won, enrollmentId };
}

const at = () => new Date().toISOString();

async function moneyTotals() {
  const one = async (table: 'charge' | 'payment' | 'payment_allocation') => {
    const row = await db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_vnd), 0) AS total FROM ${table}`).first<{ n: number; total: number }>();
    return { n: Number(row?.n ?? 0), total: Number(row?.total ?? 0) };
  };
  return { charge: await one('charge'), payment: await one('payment'), allocation: await one('payment_allocation') };
}

const stepStatus = async (leadId: string) =>
  (await db.prepare(`SELECT status FROM lead_step WHERE lead_id = ? AND step_code = 'tuition_paid'`).bind(leadId).first<{ status: string }>())?.status;

const auditCount = async () => Number((await db.prepare('SELECT COUNT(*) AS n FROM audit_log').first<{ n: number }>())?.n ?? 0);

function keysOf(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, found);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      found.add(key);
      keysOf(item, found);
    }
  }
  return found;
}

describe('fee ledger', () => {
  test('a tuition charge is coded HP000001 and a matching memo pays it and closes the step', async () => {
    const { classId } = await makeClass();
    const seat = await confirmSeat('Nguyễn An', '0913200001', classId);
    const created = await command('u-accountant', 'createCharge', {
      contactId: seat.contactId, enrollmentId: seat.enrollmentId, kind: 'tuition', amountVnd: 5_000_000,
    });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    const stored = await db.prepare('SELECT code, amount_vnd FROM charge WHERE id = ?').bind(created.json.data.id).first<{ code: string; amount_vnd: number }>();
    expect(stored).toEqual({ code: 'HP000001', amount_vnd: 5_000_000 });
    const paid = await command('u-accountant', 'recordPayment', {
      direction: 'in', method: 'transfer', amountVnd: 5_000_000, receivedAt: at(), memo: 'ABM HP000001',
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(paid.json.data.allocatedChargeId).toBe(created.json.data.id);
    const listed = await get('u-accountant', '/fees/charges');
    expect(listed.status, JSON.stringify(listed.json)).toBe(200);
    const row = (listed.json.data as { code: string; remaining: number; paid: number }[]).find((item) => item.code === 'HP000001');
    expect(row).toMatchObject({ paid: 5_000_000, remaining: 0 });
    expect(await stepStatus(seat.leadId)).toBe('done');
    const guide = await get('u-accountant', `/fees/charges/${created.json.data.id}/guide`);
    expect(guide.status, JSON.stringify(guide.json)).toBe(200);
    expect(guide.json.data.transferContent).toBe('ABM HP000001');
    expect(guide.json.data.remaining).toBe(0);
    const found = await get('u-accountant', `/fees/contacts?q=${encodeURIComponent('Nguyễn An')}`);
    expect(found.status, JSON.stringify(found.json)).toBe(200);
    expect(found.json.data).toEqual(expect.arrayContaining([expect.objectContaining({ contactId: seat.contactId, enrollmentId: seat.enrollmentId })]));
  });

  test('unmatched money waits in the queue until it is split across two learners', async () => {
    const { classId } = await makeClass();
    const first = await confirmSeat('Trần Bình', '0913200002', classId);
    const second = await confirmSeat('Lê Cường', '0913200003', classId);
    const chargeA = await command('u-accountant', 'createCharge', {
      contactId: first.contactId, enrollmentId: first.enrollmentId, kind: 'tuition', amountVnd: 2_000_000,
    });
    const chargeB = await command('u-accountant', 'createCharge', {
      contactId: second.contactId, enrollmentId: second.enrollmentId, kind: 'tuition', amountVnd: 1_000_000,
    });
    expect(chargeA.status, JSON.stringify(chargeA.json)).toBe(200);
    expect(chargeB.status, JSON.stringify(chargeB.json)).toBe(200);
    const payment = await command('u-accountant', 'recordPayment', {
      direction: 'in', method: 'cash', amountVnd: 3_000_000, receivedAt: at(), memo: 'Nop tien mat',
    });
    expect(payment.status, JSON.stringify(payment.json)).toBe(200);
    expect(payment.json.data.allocatedChargeId).toBeNull();
    const waiting = await get('u-accountant', '/fees/payments?unallocated=1');
    expect(waiting.status).toBe(200);
    expect(waiting.json.data).toEqual([expect.objectContaining({ id: payment.json.data.id, remaining: 3_000_000 })]);
    const allocated = await command('u-accountant', 'allocatePayment', {
      paymentId: payment.json.data.id, version: 1,
      allocations: [
        { chargeId: chargeA.json.data.id, amountVnd: 2_000_000 },
        { chargeId: chargeB.json.data.id, amountVnd: 1_000_000 },
      ],
    });
    expect(allocated.status, JSON.stringify(allocated.json)).toBe(200);
    const queue = await get('u-accountant', '/fees/payments?unallocated=1');
    expect(queue.json.data).toEqual([]);
  });

  test('an allocation past a charge or a payment writes no rows', async () => {
    const { classId } = await makeClass();
    const seat = await confirmSeat('Phạm Dũng', '0913200004', classId);
    const other = await confirmSeat('Hoàng Em', '0913200005', classId);
    const charge = await command('u-accountant', 'createCharge', {
      contactId: seat.contactId, enrollmentId: seat.enrollmentId, kind: 'tuition', amountVnd: 1_000_000,
    });
    const wide = await command('u-accountant', 'createCharge', {
      contactId: other.contactId, enrollmentId: other.enrollmentId, kind: 'tuition', amountVnd: 2_000_000,
    });
    const payment = await command('u-accountant', 'recordPayment', {
      direction: 'in', method: 'transfer', amountVnd: 2_000_000, receivedAt: at(), memo: 'Tien mat',
    });
    expect(charge.status).toBe(200);
    expect(wide.status).toBe(200);
    expect(payment.status, JSON.stringify(payment.json)).toBe(200);
    const before = await moneyTotals();
    const overCharge = await command('u-accountant', 'allocatePayment', {
      paymentId: payment.json.data.id, version: 1, allocations: [{ chargeId: charge.json.data.id, amountVnd: 1_000_001 }],
    });
    expect(overCharge.status).toBe(422);
    expect(overCharge.json.error?.code).toBe('VALIDATION_FAILED');
    expect(await moneyTotals()).toEqual(before);
    const overPayment = await command('u-accountant', 'allocatePayment', {
      paymentId: payment.json.data.id, version: 1,
      allocations: [
        { chargeId: charge.json.data.id, amountVnd: 1_000_000 },
        { chargeId: wide.json.data.id, amountVnd: 1_500_000 },
      ],
    });
    expect(overPayment.status).toBe(422);
    expect(overPayment.json.error?.code).toBe('VALIDATION_FAILED');
    expect(await moneyTotals()).toEqual(before);
    const version = await db.prepare('SELECT version FROM payment WHERE id = ?').bind(payment.json.data.id).first<{ version: number }>();
    expect(version!.version).toBe(1);
  });

  test('revoking an allocation restores the remaining and reopens tuition_paid', async () => {
    const { classId } = await makeClass();
    const seat = await confirmSeat('Đỗ Giang', '0913200006', classId);
    const created = await command('u-accountant', 'createCharge', {
      contactId: seat.contactId, enrollmentId: seat.enrollmentId, kind: 'tuition', amountVnd: 5_000_000,
    });
    expect(created.status).toBe(200);
    const paid = await command('u-accountant', 'recordPayment', {
      direction: 'in', method: 'transfer', amountVnd: 5_000_000, receivedAt: at(), memo: 'ABM HP000001',
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(await stepStatus(seat.leadId)).toBe('done');
    const allocation = await db.prepare('SELECT id, version FROM payment_allocation WHERE charge_id = ? AND revoked_at IS NULL')
      .bind(created.json.data.id).first<{ id: string; version: number }>();
    const revoked = await command('u-accountant', 'revokeAllocation', { allocationId: allocation!.id, version: allocation!.version, reason: 'Ghi nhầm' });
    expect(revoked.status, JSON.stringify(revoked.json)).toBe(200);
    const charge = await db.prepare(`SELECT amount_vnd - COALESCE((SELECT SUM(amount_vnd) FROM payment_allocation WHERE charge_id = charge.id AND revoked_at IS NULL), 0) AS remaining FROM charge WHERE id = ?`)
      .bind(created.json.data.id).first<{ remaining: number }>();
    expect(Number(charge!.remaining)).toBe(5_000_000);
    expect(await stepStatus(seat.leadId)).toBe('open');
  });

  test('changing a product price leaves an existing charge amount alone', async () => {
    const { classId, productId } = await makeClass();
    const seat = await confirmSeat('Bùi Hà', '0913200007', classId);
    const created = await command('u-accountant', 'createCharge', {
      contactId: seat.contactId, enrollmentId: seat.enrollmentId, kind: 'tuition', amountVnd: 4_000_000,
    });
    expect(created.status).toBe(200);
    const updated = await command('u-academic', 'upsertProduct', { id: productId, version: 1, name: 'Khóa IELTS', priceVnd: 9_000_000, active: true });
    expect(updated.status, JSON.stringify(updated.json)).toBe(200);
    const charge = await db.prepare('SELECT amount_vnd FROM charge WHERE id = ?').bind(created.json.data.id).first<{ amount_vnd: number }>();
    const product = await db.prepare('SELECT price_vnd FROM product WHERE id = ?').bind(productId).first<{ price_vnd: number }>();
    expect(charge!.amount_vnd).toBe(4_000_000);
    expect(product!.price_vnd).toBe(9_000_000);
  });

  test('charges follow a class transfer and an empty move only writes its own audit', async () => {
    const { classId, courseId } = await makeClass('Lớp A');
    const other = await command('u-academic', 'upsertClass', { courseId, name: 'Lớp B', status: 'open' });
    expect(other.status, JSON.stringify(other.json)).toBe(200);
    const seat = await confirmSeat('Ngô Ích', '0913200008', classId);
    const created = await command('u-accountant', 'createCharge', {
      contactId: seat.contactId, enrollmentId: seat.enrollmentId, kind: 'tuition', amountVnd: 5_000_000,
    });
    expect(created.status).toBe(200);
    const source = await db.prepare('SELECT version FROM enrollment WHERE id = ?').bind(seat.enrollmentId).first<{ version: number }>();
    const transferred = await command('u-academic', 'transferEnrollment', {
      enrollmentId: seat.enrollmentId, version: source!.version, toClassId: other.json.data.id,
    });
    expect(transferred.status, JSON.stringify(transferred.json)).toBe(200);
    const destination = await db.prepare('SELECT version FROM enrollment WHERE id = ?').bind(transferred.json.data.id).first<{ version: number }>();
    const moved = await command('u-accountant', 'moveEnrollmentCharges', {
      fromEnrollmentId: seat.enrollmentId, toEnrollmentId: transferred.json.data.id, version: destination!.version,
    });
    expect(moved.status, JSON.stringify(moved.json)).toBe(200);
    expect(moved.json.data.moved).toBe(1);
    const charge = await db.prepare('SELECT enrollment_id FROM charge WHERE id = ?').bind(created.json.data.id).first<{ enrollment_id: string }>();
    expect(charge!.enrollment_id).toBe(transferred.json.data.id);

    const emptySeat = await confirmSeat('Lý Khoa', '0913200009', classId);
    const emptySource = await db.prepare('SELECT version FROM enrollment WHERE id = ?').bind(emptySeat.enrollmentId).first<{ version: number }>();
    const emptyTransfer = await command('u-academic', 'transferEnrollment', {
      enrollmentId: emptySeat.enrollmentId, version: emptySource!.version, toClassId: other.json.data.id,
    });
    expect(emptyTransfer.status, JSON.stringify(emptyTransfer.json)).toBe(200);
    const emptyDest = await db.prepare('SELECT version FROM enrollment WHERE id = ?').bind(emptyTransfer.json.data.id).first<{ version: number }>();
    const before = await auditCount();
    const emptyMove = await command('u-accountant', 'moveEnrollmentCharges', {
      fromEnrollmentId: emptySeat.enrollmentId, toEnrollmentId: emptyTransfer.json.data.id, version: emptyDest!.version,
    });
    expect(emptyMove.status, JSON.stringify(emptyMove.json)).toBe(200);
    expect(emptyMove.json.data.moved).toBe(0);
    expect(await auditCount()).toBe(before + 1);
  });

  test('sale and teacher cannot read or write fees', async () => {
    for (const user of ['u-lan', 'u-teacher']) {
      expect((await get(user, '/fees/charges')).status).toBe(403);
      expect((await get(user, '/fees/payments?unallocated=1')).status).toBe(403);
      expect((await get(user, '/fees/contacts')).status).toBe(403);
      expect((await get(user, '/fees/settings')).status).toBe(403);
    }
    const denied = await command('u-lan', 'createCharge', { contactId: 'c-missing', kind: 'deposit', amountVnd: 100_000 });
    expect(denied.status).toBe(403);
    expect(denied.json.error?.code).toBe('FORBIDDEN');
  });

  test('a sale owner learner detail has no amount field', async () => {
    const won = await winLead('Mai Lan', '0913200010');
    const body = await get('u-lan', `/learners/${won.contactId}`);
    expect(body.status, JSON.stringify(body.json)).toBe(200);
    expect([...keysOf(body.json)].some((key) => key.toLowerCase().includes('amount'))).toBe(false);
  });

  test('an invoice reference changes only that business field', async () => {
    const { classId } = await makeClass();
    const seat = await confirmSeat('Tô Nga', '0913200011', classId);
    const created = await command('u-accountant', 'createCharge', {
      contactId: seat.contactId, enrollmentId: seat.enrollmentId, kind: 'deposit', amountVnd: 500_000,
    });
    expect(created.status).toBe(200);
    const columns = 'organization_id, code, contact_id, enrollment_id, kind, amount_vnd, product_name, sessions_count, note, status';
    const before = await db.prepare(`SELECT ${columns}, invoice_ref, version FROM charge WHERE id = ?`).bind(created.json.data.id).first<Record<string, unknown>>();
    const saved = await command('u-accountant', 'setInvoiceRef', { chargeId: created.json.data.id, version: 1, invoiceRef: 'HD-2026-01' });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    const after = await db.prepare(`SELECT ${columns}, invoice_ref, version FROM charge WHERE id = ?`).bind(created.json.data.id).first<Record<string, unknown>>();
    expect(after!.invoice_ref).toBe('HD-2026-01');
    expect(after!.version).toBe(Number(before!.version) + 1);
    for (const key of columns.split(', ')) expect(after![key]).toEqual(before![key]);
  });

  test('a charge with a live allocation cannot be voided until that allocation is revoked', async () => {
    const { classId } = await makeClass();
    const seat = await confirmSeat('Vũ Oanh', '0913200012', classId);
    const created = await command('u-accountant', 'createCharge', {
      contactId: seat.contactId, enrollmentId: seat.enrollmentId, kind: 'tuition', amountVnd: 5_000_000,
    });
    expect(created.status).toBe(200);
    const paid = await command('u-accountant', 'recordPayment', {
      direction: 'in', method: 'cash', amountVnd: 1_000_000, receivedAt: at(), memo: 'ABM HP000001',
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const blocked = await command('u-accountant', 'voidCharge', { chargeId: created.json.data.id, version: 1, reason: 'Hủy khi còn tiền' });
    expect(blocked.status).toBe(422);
    expect(blocked.json.error?.code).toBe('VALIDATION_FAILED');
    const allocation = await db.prepare('SELECT id, version FROM payment_allocation WHERE charge_id = ? AND revoked_at IS NULL')
      .bind(created.json.data.id).first<{ id: string; version: number }>();
    const revoked = await command('u-accountant', 'revokeAllocation', { allocationId: allocation!.id, version: allocation!.version, reason: 'Thu hồi để hủy' });
    expect(revoked.status, JSON.stringify(revoked.json)).toBe(200);
    const voided = await command('u-accountant', 'voidCharge', { chargeId: created.json.data.id, version: 1, reason: 'Hủy sau khi thu hồi' });
    expect(voided.status, JSON.stringify(voided.json)).toBe(200);
    expect(voided.json.data.status).toBe('void');
  });

  test('a refund is stored and cannot be allocated', async () => {
    const { classId } = await makeClass();
    const seat = await confirmSeat('Đinh Phúc', '0913200013', classId);
    const created = await command('u-accountant', 'createCharge', {
      contactId: seat.contactId, enrollmentId: seat.enrollmentId, kind: 'material', amountVnd: 200_000,
    });
    expect(created.status).toBe(200);
    const refund = await command('u-accountant', 'recordPayment', {
      direction: 'refund', method: 'transfer', amountVnd: 200_000, receivedAt: at(), memo: 'Hoan tien',
    });
    expect(refund.status, JSON.stringify(refund.json)).toBe(200);
    expect(refund.json.data.allocatedChargeId).toBeNull();
    const queue = await get('u-accountant', '/fees/payments?unallocated=1');
    expect(queue.json.data).toEqual([]);
    const allocated = await command('u-accountant', 'allocatePayment', {
      paymentId: refund.json.data.id, version: 1, allocations: [{ chargeId: created.json.data.id, amountVnd: 200_000 }],
    });
    expect(allocated.status).toBe(422);
    expect(allocated.json.error?.code).toBe('VALIDATION_FAILED');
    expect((await moneyTotals()).allocation.n).toBe(0);
  });

  test('marking attendance does not change fee rows and class responses carry no amount', async () => {
    const { classId } = await makeClass();
    const seat = await confirmSeat('Cao Quỳnh', '0913200014', classId);
    const created = await command('u-accountant', 'createCharge', {
      contactId: seat.contactId, enrollmentId: seat.enrollmentId, kind: 'tuition', amountVnd: 5_000_000,
    });
    const payment = await command('u-accountant', 'recordPayment', {
      direction: 'in', method: 'cash', amountVnd: 1_000_000, receivedAt: at(), memo: 'Nop tien',
    });
    expect(created.status).toBe(200);
    expect(payment.status).toBe(200);
    const session = await command('u-academic', 'addSession', {
      classId, startsAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 90, kind: 'regular',
    });
    expect(session.status, JSON.stringify(session.json)).toBe(200);
    const before = await moneyTotals();
    const marked = await command('u-academic', 'markAttendance', {
      sessionId: session.json.data.id, entries: [{ enrollmentId: seat.enrollmentId, status: 'present', version: null }],
    });
    expect(marked.status, JSON.stringify(marked.json)).toBe(200);
    expect(await moneyTotals()).toEqual(before);
    const bodies = await Promise.all([
      get('u-academic', '/courses'),
      get('u-academic', `/classes/${classId}`),
      get('u-academic', '/my-classes'),
      get('u-academic', `/sessions/${session.json.data.id}/attendance`),
    ]);
    for (const body of bodies) {
      expect(body.status, JSON.stringify(body.json)).toBe(200);
      expect([...keysOf(body.json)].some((key) => key.toLowerCase().includes('amount'))).toBe(false);
    }
  });

  test('two allocations that together exceed the payment let exactly one succeed', async () => {
    const { classId } = await makeClass();
    const seat = await confirmSeat('Lâm Sơn', '0913200015', classId);
    const created = await command('u-accountant', 'createCharge', {
      contactId: seat.contactId, enrollmentId: seat.enrollmentId, kind: 'tuition', amountVnd: 5_000_000,
    });
    const payment = await command('u-accountant', 'recordPayment', {
      direction: 'in', method: 'transfer', amountVnd: 1_000_000, receivedAt: at(), memo: 'Tien mat khong ma',
    });
    expect(created.status).toBe(200);
    expect(payment.status, JSON.stringify(payment.json)).toBe(200);
    const body = { paymentId: payment.json.data.id, version: 1, allocations: [{ chargeId: created.json.data.id, amountVnd: 1_000_000 }] };
    const [left, right] = await Promise.all([
      command('u-accountant', 'allocatePayment', body),
      command('u-admin', 'allocatePayment', body),
    ]);
    const statuses = [left.status, right.status].sort((a, b) => a - b);
    expect(statuses, JSON.stringify([left.json, right.json])).toEqual([200, 409]);
    expect([left, right].find((result) => result.status === 409)?.json.error?.code).toBe('STALE_VERSION');
    const saved = await db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amount_vnd), 0) AS total FROM payment_allocation WHERE payment_id = ?')
      .bind(payment.json.data.id).first<{ n: number; total: number }>();
    expect(Number(saved!.n)).toBe(1);
    expect(Number(saved!.total)).toBe(1_000_000);
  });

  test('two automatic allocations of the same charge cannot both land', async () => {
    const { classId } = await makeClass();
    const seat = await confirmSeat('Hồ Tâm', '0913200016', classId);
    const created = await command('u-accountant', 'createCharge', {
      contactId: seat.contactId, enrollmentId: seat.enrollmentId, kind: 'tuition', amountVnd: 5_000_000,
    });
    expect(created.status).toBe(200);
    const code = (await db.prepare('SELECT code FROM charge WHERE id = ?').bind(created.json.data.id).first<{ code: string }>())!.code;
    const pay = (user: string) => command(user, 'recordPayment', {
      direction: 'in', method: 'transfer', amountVnd: 5_000_000, receivedAt: at(), memo: `ABM ${code}`,
    });
    const [left, right] = await Promise.all([pay('u-accountant'), pay('u-admin')]);
    const allocated = [left, right].filter((result) => result.json.ok && result.json.data.allocatedChargeId);
    expect(allocated, JSON.stringify([left.json, right.json])).toHaveLength(1);
    const failed = [left, right].find((result) => !result.json.ok);
    if (failed) expect(failed.json.error?.code).toBe('STALE_VERSION');
    const saved = await db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amount_vnd), 0) AS total FROM payment_allocation WHERE charge_id = ?')
      .bind(created.json.data.id).first<{ n: number; total: number }>();
    expect(Number(saved!.n)).toBe(1);
    expect(Number(saved!.total)).toBe(5_000_000);
    const charge = await db.prepare('SELECT amount_vnd FROM charge WHERE id = ?').bind(created.json.data.id).first<{ amount_vnd: number }>();
    expect(Number(saved!.total)).toBeLessThanOrEqual(charge!.amount_vnd);
  });

  test('two different payments allocating one deposit let exactly one succeed', async () => {
    const { classId } = await makeClass();
    const seat = await confirmSeat('Lý Uyên', '0913200017', classId);
    const created = await command('u-accountant', 'createCharge', {
      contactId: seat.contactId, kind: 'deposit', amountVnd: 1_000_000,
    });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    const first = await command('u-accountant', 'recordPayment', {
      direction: 'in', method: 'transfer', amountVnd: 1_000_000, receivedAt: at(), memo: 'Tien A',
    });
    const second = await command('u-accountant', 'recordPayment', {
      direction: 'in', method: 'cash', amountVnd: 1_000_000, receivedAt: at(), memo: 'Tien B',
    });
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    expect(second.status, JSON.stringify(second.json)).toBe(200);
    const [left, right] = await Promise.all([
      command('u-accountant', 'allocatePayment', {
        paymentId: first.json.data.id, version: 1, allocations: [{ chargeId: created.json.data.id, amountVnd: 1_000_000 }],
      }),
      command('u-admin', 'allocatePayment', {
        paymentId: second.json.data.id, version: 1, allocations: [{ chargeId: created.json.data.id, amountVnd: 1_000_000 }],
      }),
    ]);
    const statuses = [left.status, right.status].sort((a, b) => a - b);
    expect(statuses, JSON.stringify([left.json, right.json])).toEqual([200, 409]);
    expect([left, right].find((result) => result.status === 409)?.json.error?.code).toBe('STALE_VERSION');
    const saved = await db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amount_vnd), 0) AS total FROM payment_allocation WHERE charge_id = ? AND revoked_at IS NULL')
      .bind(created.json.data.id).first<{ n: number; total: number }>();
    expect(Number(saved!.n)).toBe(1);
    expect(Number(saved!.total)).toBe(1_000_000);
  });

  test('two automatic allocations of one deposit let exactly one succeed', async () => {
    const { classId } = await makeClass();
    const seat = await confirmSeat('Hà Vân', '0913200018', classId);
    const created = await command('u-accountant', 'createCharge', {
      contactId: seat.contactId, kind: 'deposit', amountVnd: 1_000_000,
    });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    const code = (await db.prepare('SELECT code FROM charge WHERE id = ?').bind(created.json.data.id).first<{ code: string }>())!.code;
    const pay = (user: string) => command(user, 'recordPayment', {
      direction: 'in', method: 'transfer', amountVnd: 1_000_000, receivedAt: at(), memo: `ABM ${code}`,
    });
    const [left, right] = await Promise.all([pay('u-accountant'), pay('u-admin')]);
    const allocated = [left, right].filter((result) => result.json.ok && result.json.data.allocatedChargeId);
    expect(allocated, JSON.stringify([left.json, right.json])).toHaveLength(1);
    const failed = [left, right].find((result) => !result.json.ok);
    expect(failed?.status).toBe(409);
    expect(failed?.json.error?.code).toBe('STALE_VERSION');
    const saved = await db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amount_vnd), 0) AS total FROM payment_allocation WHERE charge_id = ? AND revoked_at IS NULL')
      .bind(created.json.data.id).first<{ n: number; total: number }>();
    expect(Number(saved!.n)).toBe(1);
    expect(Number(saved!.total)).toBe(1_000_000);
    const charge = await db.prepare('SELECT amount_vnd FROM charge WHERE id = ?').bind(created.json.data.id).first<{ amount_vnd: number }>();
    expect(Number(saved!.total)).toBeLessThanOrEqual(Number(charge!.amount_vnd));
  });

  test('a lower-case memo still allocates when it names one charge code', async () => {
    const { classId } = await makeClass();
    const seat = await confirmSeat('Tạ Xuân', '0913200019', classId);
    const created = await command('u-accountant', 'createCharge', {
      contactId: seat.contactId, kind: 'deposit', amountVnd: 100_000,
    });
    expect(created.status).toBe(200);
    const paid = await command('u-accountant', 'recordPayment', {
      direction: 'in', method: 'transfer', amountVnd: 100_000, receivedAt: at(), memo: 'abm hp000001',
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(paid.json.data.allocatedChargeId).toBe(created.json.data.id);
    const stored = await db.prepare('SELECT memo FROM payment WHERE id = ?').bind(paid.json.data.id).first<{ memo: string }>();
    expect(stored!.memo).toBe('abm hp000001');
  });

  test('a learner ledger keeps an older charge, returns live allocations, and lists a linked refund', async () => {
    const { classId } = await makeClass();
    const seat = await confirmSeat('Đặng Yến', '0913200020', classId);
    const other = await confirmSeat('Ngô Za', '0913200021', classId);
    const created = await command('u-accountant', 'createCharge', {
      contactId: seat.contactId, enrollmentId: seat.enrollmentId, kind: 'tuition', amountVnd: 1_000_000,
    });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    await db.prepare(`UPDATE charge SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?`).bind(created.json.data.id).run();
    const org = (await db.prepare('SELECT organization_id FROM contact WHERE id = ?').bind(other.contactId).first<{ organization_id: string }>())!.organization_id;
    const filler = Array.from({ length: 300 }, (_, index) => db.prepare(
      `INSERT INTO charge (id, organization_id, code, contact_id, kind, amount_vnd, status, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, 'deposit', 1000, 'open', '2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z', 1)`,
    ).bind(crypto.randomUUID(), org, `ZZ${String(index).padStart(6, '0')}`, other.contactId));
    await db.batch(filler);
    const paid = await command('u-accountant', 'recordPayment', {
      direction: 'in', method: 'transfer', amountVnd: 400_000, receivedAt: at(), memo: 'ABM HP000001',
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    const refund = await command('u-accountant', 'recordPayment', {
      direction: 'refund', method: 'cash', amountVnd: 50_000, receivedAt: at(), memo: 'Hoan', contactId: seat.contactId,
    });
    expect(refund.status, JSON.stringify(refund.json)).toBe(200);
    const loose = await command('u-accountant', 'recordPayment', {
      direction: 'refund', method: 'cash', amountVnd: 10_000, receivedAt: at(), memo: 'Hoan khong gan',
    });
    expect(loose.status).toBe(200);
    const ledger = await get('u-accountant', `/fees/contacts/${seat.contactId}`);
    expect(ledger.status, JSON.stringify(ledger.json)).toBe(200);
    const charges = ledger.json.data.charges as { id: string; contactId: string }[];
    expect(charges.some((row) => row.id === created.json.data.id)).toBe(true);
    expect(charges.every((row) => row.contactId === seat.contactId)).toBe(true);
    const allocation = (ledger.json.data.allocations as { id: string; version: number; chargeCode: string; amountVnd: number }[])[0];
    expect(allocation).toMatchObject({ chargeCode: 'HP000001', amountVnd: 400_000, version: 1 });
    expect(allocation?.id).toEqual(expect.any(String));
    const payments = ledger.json.data.payments as { id: string; direction: string }[];
    expect(payments).toEqual(expect.arrayContaining([expect.objectContaining({ id: refund.json.data.id, direction: 'refund' })]));
    expect(payments.map((row) => row.id)).not.toContain(loose.json.data.id);
    const revoked = await command('u-accountant', 'revokeAllocation', { allocationId: allocation!.id, version: allocation!.version, reason: 'Sai sổ' });
    expect(revoked.status, JSON.stringify(revoked.json)).toBe(200);
  });
});
