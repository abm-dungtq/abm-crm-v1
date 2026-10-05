import { beforeEach, describe, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import { addUser, command, db, get, makeLead } from './helpers/learner-fixtures';
import { resetDb } from './helpers/reset-db';

beforeEach(async () => {
  await resetDb(db, seedSql);
  await addUser('u-accountant', 'accountant');
});

async function moneyTotals() {
  const one = async (table: 'charge' | 'payment' | 'payment_allocation') => {
    const row = await db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_vnd), 0) AS total FROM ${table}`).first<{ n: number; total: number }>();
    return { n: Number(row?.n ?? 0), total: Number(row?.total ?? 0) };
  };
  return { charge: await one('charge'), payment: await one('payment'), allocation: await one('payment_allocation') };
}

const contactVersion = async (contactId: string) =>
  (await db.prepare('SELECT version FROM contact WHERE id = ?').bind(contactId).first<{ version: number }>())!.version;

describe('privacy requests', () => {
  test('anonymizing hides the name and phone and keeps the money', async () => {
    const phone = '0913300101';
    const { contactId } = await makeLead('Nguyễn Giấu', phone);
    const created = await command('u-accountant', 'createCharge', { contactId, kind: 'deposit', amountVnd: 1_000_000 });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    const code = (await db.prepare('SELECT code FROM charge WHERE id = ?').bind(created.json.data.id).first<{ code: string }>())!.code;
    const paid = await command('u-accountant', 'recordPayment', {
      direction: 'in', method: 'transfer', amountVnd: 1_000_000, receivedAt: new Date().toISOString(), memo: `ABM ${code}`,
    });
    expect(paid.status, JSON.stringify(paid.json)).toBe(200);
    expect(paid.json.data.allocatedChargeId).toBe(created.json.data.id);
    const before = await moneyTotals();
    const requested = await command('u-admin', 'createPrivacyRequest', { contactId, kind: 'delete', detail: 'Khách xin xóa' });
    expect(requested.status, JSON.stringify(requested.json)).toBe(200);
    const hidden = await command('u-admin', 'anonymizeContact', {
      contactId, version: await contactVersion(contactId), requestId: requested.json.data.id,
    });
    expect(hidden.status, JSON.stringify(hidden.json)).toBe(200);
    const detail = await get('u-admin', `/learners/${contactId}`);
    expect(detail.status, JSON.stringify(detail.json)).toBe(200);
    expect(detail.json.data.contact.name).toBe('Đã ẩn danh');
    expect(JSON.stringify(detail.json)).not.toContain(phone);
    expect(await moneyTotals()).toEqual(before);
    const audit = await db.prepare(`SELECT before_json FROM audit_log WHERE command = 'anonymizeContact' AND entity_id = ?`)
      .bind(contactId).first<{ before_json: string }>();
    expect(JSON.parse(audit!.before_json)).toEqual({ anonymized: true });
    expect(audit!.before_json).not.toContain(phone);
    const points = await db.prepare('SELECT value FROM contact_point WHERE contact_id = ?').bind(contactId).all<{ value: string }>();
    expect(points.results.every((row) => row.value === '***')).toBe(true);
  });

  test('anonymizing without an open delete request is refused', async () => {
    const { contactId } = await makeLead('Lê Xin', '0913300102');
    const access = await command('u-admin', 'createPrivacyRequest', { contactId, kind: 'access' });
    expect(access.status, JSON.stringify(access.json)).toBe(200);
    const refused = await command('u-admin', 'anonymizeContact', {
      contactId, version: await contactVersion(contactId), requestId: access.json.data.id,
    });
    expect(refused.status).toBe(422);
    expect(refused.json.error?.code).toBe('VALIDATION_FAILED');
    const missing = await command('u-admin', 'anonymizeContact', {
      contactId, version: await contactVersion(contactId), requestId: crypto.randomUUID(),
    });
    expect(missing.status).toBe(422);
    expect(missing.json.error?.code).toBe('VALIDATION_FAILED');
  });

  test('a sale cannot anonymize a contact', async () => {
    const { contactId } = await makeLead('Phạm Giữ', '0913300103');
    const denied = await command('u-lan', 'anonymizeContact', {
      contactId, version: await contactVersion(contactId), requestId: crypto.randomUUID(),
    });
    expect(denied.status).toBe(403);
    expect(denied.json.error?.code).toBe('FORBIDDEN');
  });
});
