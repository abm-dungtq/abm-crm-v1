import { env } from 'cloudflare:test';
import { expect, test } from 'vitest';
import b2bDemoSql from '../seed/b2b-demo.sql?raw';
import learnerDemoSql from '../seed/learner-demo.sql?raw';
import app from '../src/worker/index';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
const SLOT_USERS = {
  'slot-admin-1': ['u-admin', 'admin', null, null],
  'slot-sale-1': ['u-sale-1', 'sale', 'dep-kd', 'team-kd1'],
  'slot-sale-2': ['u-sale-2', 'sale', 'dep-kd', 'team-kd2'],
  'slot-sale-3': ['u-sale-3', 'sale', 'dep-kd', 'team-kd2'],
  'slot-leader-1': ['u-leader', 'leader', 'dep-kd', 'team-kd1'],
  'slot-leader-2': ['u-leader-2', 'leader', 'dep-kd', 'team-kd2'],
  'slot-head-1': ['u-head', 'head', 'dep-kd', null],
  'slot-academic-1': ['u-academic', 'academic', null, null],
  'slot-teacher-1': ['u-teacher-1', 'teacher', null, null],
  'slot-teacher-2': ['u-teacher-2', 'teacher', null, null],
  'slot-accountant-1': ['u-accountant', 'accountant', null, null],
} as const;

const DEMO_ID_TABLES = [
  'account', 'contact', 'account_contact', 'contact_point', 'partner_contract', 'partner_contract_step',
  'lead', 'lead_step', 'task', 'activity', 'approval', 'audit_log', 'product', 'customer_product', 'consent',
  'course', 'class_group', 'class_teacher', 'class_session', 'enrollment', 'trial_booking', 'attendance',
  'charge', 'payment', 'payment_allocation', 'privacy_request',
];

function mappedSql(sql: string) {
  let mapped = sql;
  for (const [slot, [userId]] of Object.entries(SLOT_USERS)) mapped = mapped.replaceAll(slot, userId);
  return mapped;
}

async function runSql(sql: string) {
  const lines = sql.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('INSERT') || line.startsWith('PRAGMA'));
  for (const pragma of lines.filter((line) => line.startsWith('PRAGMA'))) await db.prepare(pragma).run();
  const inserts = lines.filter((line) => line.startsWith('INSERT'));
  for (let i = 0; i < inserts.length; i += 40) await db.batch(inserts.slice(i, i + 40).map((line) => db.prepare(line)));
}

async function call(user: string, method: string, path: string, body?: unknown) {
  const response = await app.fetch(new Request(`http://crm.test/api${path}`, {
    method,
    headers: { 'X-Demo-User': user, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { ...env, DEMO_MODE: '1', AUTH_MODE: '' });
  return { status: response.status, json: await response.json() as { ok: boolean; data?: any; error?: unknown } };
}

test('loaded sample satisfies the ledger, keys, and a follow-up command', async () => {
  const stamp = '2026-01-01T00:00:00Z';
  await resetDb(db, `INSERT INTO organization (id, name, created_at, updated_at) VALUES ('org-abm', 'ABM (dữ liệu mẫu)', '${stamp}', '${stamp}');`);
  const roster = [
    `INSERT INTO department (id, organization_id, name, created_at, updated_at) VALUES ('dep-kd', 'org-abm', 'Phòng Kinh doanh mẫu', '${stamp}', '${stamp}')`,
    `INSERT INTO team (id, department_id, name, created_at, updated_at) VALUES ('team-kd1', 'dep-kd', 'Kinh doanh 1', '${stamp}', '${stamp}')`,
    `INSERT INTO team (id, department_id, name, created_at, updated_at) VALUES ('team-kd2', 'dep-kd', 'Kinh doanh 2', '${stamp}', '${stamp}')`,
    ...Object.values(SLOT_USERS).map(([id, role, departmentId, teamId]) => `INSERT INTO app_user (id, organization_id, department_id, team_id, display_name, email, role, created_at, updated_at)
      VALUES ('${id}', 'org-abm', ${departmentId ? `'${departmentId}'` : 'NULL'}, ${teamId ? `'${teamId}'` : 'NULL'}, 'User ${id}', '${id}@test.example', '${role}', '${stamp}', '${stamp}')`),
  ];
  await db.batch(roster.map((sql) => db.prepare(sql)));
  await runSql(mappedSql(b2bDemoSql));
  await runSql(mappedSql(learnerDemoSql));

  const foreignKeys = await db.prepare('PRAGMA foreign_key_check').all();
  expect(foreignKeys.results).toEqual([]);

  const phones = await db.prepare(`SELECT contact_id, normalized_value AS phone FROM contact_point WHERE type = 'phone'`).all<{ contact_id: string; phone: string }>();
  const phoneValues = phones.results.map((row) => row.phone);
  expect(new Set(phoneValues).size).toBe(phoneValues.length);
  for (const phone of phoneValues) {
    const asNumber = Number(phone);
    expect(asNumber >= 900_000_001 && asNumber <= 900_000_200, phone).toBe(false);
  }
  const learnerPhones = new Set(phones.results.filter((row) => row.contact_id.startsWith('demo-contact-')).map((row) => row.phone));
  for (const phone of learnerPhones) expect(phone).toMatch(/^090999\d{4}$/);
  for (const row of phones.results) {
    if (/^demo-ct-\d+$/.test(row.contact_id)) expect(learnerPhones.has(row.phone)).toBe(false);
  }

  const charges = await db.prepare(`SELECT c.id, c.contact_id, c.amount_vnd,
      c.amount_vnd - COALESCE((SELECT SUM(a.amount_vnd) FROM payment_allocation a WHERE a.charge_id = c.id AND a.revoked_at IS NULL), 0) AS balance
    FROM charge c`).all<{ id: string; contact_id: string; amount_vnd: number; balance: number }>();
  expect(charges.results.length).toBeGreaterThan(0);
  const byContact = new Map<string, typeof charges.results>();
  for (const charge of charges.results) byContact.set(charge.contact_id, [...(byContact.get(charge.contact_id) ?? []), charge]);
  for (const [contactId, rows] of byContact) {
    const ledger = await call('u-accountant', 'GET', `/fees/contacts/${contactId}`);
    expect(ledger.status, JSON.stringify(ledger.json)).toBe(200);
    const remaining = new Map<string, number>((ledger.json.data.charges as { id: string; remaining: number }[]).map((charge) => [charge.id, charge.remaining]));
    for (const row of rows) expect(remaining.get(row.id)).toBe(Number(row.balance));
  }

  const extraSeat = await db.prepare(`SELECT lead_id FROM enrollment WHERE status IN ('pending', 'confirmed', 'studying', 'deferred')
    GROUP BY lead_id HAVING COUNT(*) > 1 LIMIT 1`).first();
  expect(extraSeat).toBeNull();
  for (const table of DEMO_ID_TABLES) {
    const bad = await db.prepare(`SELECT id FROM ${table} WHERE id NOT LIKE 'demo-%' LIMIT 1`).first();
    expect(bad, table).toBeNull();
  }
  const duplicateCode = await db.prepare('SELECT code FROM lead GROUP BY code HAVING COUNT(*) > 1 LIMIT 1').first();
  expect(duplicateCode).toBeNull();
  const outbox = await db.prepare('SELECT COUNT(*) AS n FROM outbox').first<{ n: number }>();
  expect(outbox?.n).toBe(0);

  const mark = await db.prepare(`SELECT e.id AS enrollment_id, s.id AS session_id
    FROM enrollment e
    JOIN class_session s ON s.class_id = e.class_id AND s.kind = 'regular' AND s.status = 'scheduled'
    LEFT JOIN attendance a ON a.session_id = s.id AND a.enrollment_id = e.id
    WHERE e.status IN ('confirmed', 'studying') AND COALESCE(e.confirmed_at, e.created_at) <= s.starts_at AND a.id IS NULL
    LIMIT 1`).first<{ enrollment_id: string; session_id: string }>();
  expect(mark).toBeTruthy();
  const attendance = await call('u-academic', 'POST', '/commands/markAttendance', {
    sessionId: mark!.session_id, entries: [{ enrollmentId: mark!.enrollment_id, status: 'present', version: null }],
  });
  expect(attendance.status, JSON.stringify(attendance.json)).toBe(200);

  const payment = await call('u-accountant', 'POST', '/commands/recordPayment', {
    direction: 'in', method: 'cash', amountVnd: 100_000, receivedAt: '2026-10-07T02:30:00.000Z', memo: 'Thu them mau',
  });
  expect(payment.status, JSON.stringify(payment.json)).toBe(200);

  const fresh = await db.prepare(`SELECT id, owner_user_id, version FROM lead
    WHERE pipeline = 'learner' AND stage = 'new' AND status = 'active' LIMIT 1`).first<{ id: string; owner_user_id: string; version: number }>();
  expect(fresh).toBeTruthy();
  const step = await call(fresh!.owner_user_id, 'POST', '/commands/markJourneyStep', {
    leadId: fresh!.id, expectedVersion: fresh!.version, stepCode: 'contacted',
  });
  expect(step.status, JSON.stringify(step.json)).toBe(200);
}, 120_000);
