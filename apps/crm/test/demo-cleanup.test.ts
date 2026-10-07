import { env } from 'cloudflare:test';
import { expect, test } from 'vitest';
import b2bDemoSql from '../seed/b2b-demo.sql?raw';
import cleanupSql from '../seed/cleanup-demo.sql?raw';
import learnerDemoSql from '../seed/learner-demo.sql?raw';
import { BUSINESS_EMPTY_TABLES, DEMO_AUDIT_WHERE, sampleTargetProblems } from '../seed/eval-demo-pure';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
const STAMP = '2026-10-07T02:30:00.000Z';
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

const BUSINESS = [
  'privacy_request', 'payment_allocation', 'payment', 'charge', 'attendance', 'trial_booking',
  'enrollment', 'class_session', 'class_teacher', 'class_group', 'course', 'consent', 'customer_product',
  'product', 'idempotency_key', 'outbox', 'audit_log', 'approval', 'activity', 'task', 'lead_step', 'lead',
  'partner_contract_step', 'partner_contract', 'contact_point', 'account_contact', 'contact', 'account',
];

function sqlStatements(script: string) {
  return script.split(';').flatMap((part) => {
    const body = part.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim();
    return body ? [body] : [];
  });
}

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

async function loadSample() {
  await resetDb(db, `INSERT INTO organization (id, name, created_at, updated_at) VALUES ('org-abm', 'ABM (dữ liệu mẫu)', '${STAMP}', '${STAMP}');`);
  const roster = [
    `INSERT INTO department (id, organization_id, name, created_at, updated_at) VALUES ('dep-kd', 'org-abm', 'Phòng Kinh doanh mẫu', '${STAMP}', '${STAMP}')`,
    `INSERT INTO team (id, department_id, name, created_at, updated_at) VALUES ('team-kd1', 'dep-kd', 'Kinh doanh 1', '${STAMP}', '${STAMP}')`,
    `INSERT INTO team (id, department_id, name, created_at, updated_at) VALUES ('team-kd2', 'dep-kd', 'Kinh doanh 2', '${STAMP}', '${STAMP}')`,
    ...Object.values(SLOT_USERS).map(([id, role, departmentId, teamId]) => `INSERT INTO app_user (id, organization_id, department_id, team_id, display_name, email, role, created_at, updated_at)
      VALUES ('${id}', 'org-abm', ${departmentId ? `'${departmentId}'` : 'NULL'}, ${teamId ? `'${teamId}'` : 'NULL'}, 'User ${id}', '${id}@test.example', '${role}', '${STAMP}', '${STAMP}')`),
  ];
  await db.batch(roster.map((sql) => db.prepare(sql)));
  await runSql(mappedSql(b2bDemoSql));
  await runSql(mappedSql(learnerDemoSql));
}

async function runCleanup() {
  const statements = sqlStatements(cleanupSql);
  for (let index = 0; index < statements.length; index += 1) {
    try {
      await db.prepare(statements[index]!).run();
    } catch (error) {
      const preview = statements[index]!.replace(/\s+/g, ' ').slice(0, 160);
      throw new Error(`cleanup statement ${index} failed (${preview}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function countOf(table: string) {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function assertOnlyOrgStructure() {
  const foreignKeys = await db.prepare('PRAGMA foreign_key_check').all();
  expect(foreignKeys.results).toEqual([]);
  for (const table of BUSINESS) expect(await countOf(table), table).toBe(0);
  const counter = await db.prepare('SELECT next_value FROM lead_counter').all<{ next_value: number }>();
  expect(counter.results).toEqual([{ next_value: 1 }]);
  expect(await countOf('fee_counter')).toBe(0);
  expect(await countOf('organization')).toBe(1);
  expect(await countOf('department')).toBe(1);
  expect(await countOf('team')).toBe(2);
  expect(await countOf('app_user')).toBe(Object.keys(SLOT_USERS).length);
}

test('clean demo load cleans back to org structure', async () => {
  await loadSample();
  expect(await countOf('lead')).toBeGreaterThan(0);
  expect(await countOf('charge')).toBeGreaterThan(0);
  await runCleanup();
  await assertOnlyOrgStructure();
}, 120_000);

test('staff charge, payment, and allocation on a demo contact are removed', async () => {
  await loadSample();
  const contact = await db.prepare(`SELECT id FROM contact WHERE id LIKE 'demo-%' LIMIT 1`).first<{ id: string }>();
  expect(contact).toBeTruthy();
  const chargeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  const paymentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  const allocationId = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
  const refundId = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
  await db.batch([
    db.prepare(`INSERT INTO charge (id, organization_id, code, contact_id, kind, amount_vnd, created_at, updated_at)
      VALUES (?, 'org-abm', 'HP000099', ?, 'tuition', 100000, ?, ?)`).bind(chargeId, contact!.id, STAMP, STAMP),
    db.prepare(`INSERT INTO payment (id, organization_id, direction, method, amount_vnd, received_at, recorded_by_user_id, created_at, updated_at)
      VALUES (?, 'org-abm', 'in', 'cash', 100000, ?, 'u-accountant', ?, ?)`).bind(paymentId, STAMP, STAMP, STAMP),
    db.prepare(`INSERT INTO payment_allocation (id, payment_id, charge_id, amount_vnd, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, 100000, 'u-accountant', ?, ?)`).bind(allocationId, paymentId, chargeId, STAMP, STAMP),
    db.prepare(`INSERT INTO payment (id, organization_id, direction, method, amount_vnd, received_at, contact_id, recorded_by_user_id, created_at, updated_at)
      VALUES (?, 'org-abm', 'refund', 'transfer', 1000, ?, ?, 'u-accountant', ?, ?)`).bind(refundId, STAMP, contact!.id, STAMP, STAMP),
  ]);
  await runCleanup();
  await assertOnlyOrgStructure();
}, 120_000);

test('staff class under a demo course with enrollment and session is removed', async () => {
  await loadSample();
  const course = await db.prepare(`SELECT id FROM course WHERE id LIKE 'demo-%' LIMIT 1`).first<{ id: string }>();
  const lead = await db.prepare(`SELECT id, contact_id FROM lead WHERE contact_id LIKE 'demo-%' LIMIT 1`).first<{ id: string; contact_id: string }>();
  expect(course && lead).toBeTruthy();
  const classId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
  const sessionId = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
  const trialSessionId = 'ffffffff-ffff-4fff-8fff-fffffffffff2';
  const enrollmentId = '11111111-1111-4111-8111-111111111111';
  const teacherRowId = '22222222-2222-4222-8222-222222222222';
  const attendanceId = '33333333-3333-4333-8333-333333333331';
  const trialId = '33333333-3333-4333-8333-333333333332';
  const trialAttendanceId = '33333333-3333-4333-8333-333333333333';
  await db.batch([
    db.prepare(`INSERT INTO class_group (id, course_id, name, created_at, updated_at) VALUES (?, ?, 'Lớp nhân viên', ?, ?)`).bind(classId, course!.id, STAMP, STAMP),
    db.prepare(`INSERT INTO class_teacher (id, class_id, user_id, created_at) VALUES (?, ?, 'u-teacher-1', ?)`).bind(teacherRowId, classId, STAMP),
    db.prepare(`INSERT INTO class_session (id, class_id, starts_at, duration_minutes, kind, created_at, updated_at) VALUES (?, ?, ?, 90, 'regular', ?, ?)`).bind(sessionId, classId, STAMP, STAMP, STAMP),
    db.prepare(`INSERT INTO class_session (id, class_id, starts_at, duration_minutes, kind, created_at, updated_at) VALUES (?, ?, ?, 90, 'trial', ?, ?)`).bind(trialSessionId, classId, STAMP, STAMP, STAMP),
    db.prepare(`INSERT INTO enrollment (id, organization_id, lead_id, contact_id, class_id, status, created_at, updated_at) VALUES (?, 'org-abm', ?, ?, ?, 'confirmed', ?, ?)`).bind(enrollmentId, lead!.id, lead!.contact_id, classId, STAMP, STAMP),
    db.prepare(`INSERT INTO trial_booking (id, lead_id, session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).bind(trialId, lead!.id, trialSessionId, STAMP, STAMP),
    db.prepare(`INSERT INTO attendance (id, session_id, enrollment_id, status, marked_by_user_id, marked_at, created_at, updated_at) VALUES (?, ?, ?, 'present', 'u-academic', ?, ?, ?)`).bind(attendanceId, sessionId, enrollmentId, STAMP, STAMP, STAMP),
    db.prepare(`INSERT INTO attendance (id, session_id, trial_booking_id, status, marked_by_user_id, marked_at, created_at, updated_at) VALUES (?, ?, ?, 'present', 'u-academic', ?, ?, ?)`).bind(trialAttendanceId, trialSessionId, trialId, STAMP, STAMP, STAMP),
  ]);
  await runCleanup();
  await assertOnlyOrgStructure();
}, 120_000);

test('rows outside the demo chain stay, and free text is not a delete key', async () => {
  await loadSample();
  const demoCharge = await db.prepare(`SELECT id FROM charge WHERE id LIKE 'demo-%' LIMIT 1`).first<{ id: string }>();
  const demoAccount = await db.prepare(`SELECT id FROM account WHERE id LIKE 'demo-%' LIMIT 1`).first<{ id: string }>();
  const demoContact = await db.prepare(`SELECT id FROM contact WHERE id LIKE 'demo-%' LIMIT 1`).first<{ id: string }>();
  const demoProduct = await db.prepare(`SELECT id FROM product WHERE id LIKE 'demo-%' LIMIT 1`).first<{ id: string }>();
  const freeProduct = await db.prepare(`SELECT id FROM product WHERE id LIKE 'demo-%' AND id NOT IN (
    SELECT product_id FROM customer_product WHERE contact_id = ? AND detached_at IS NULL
  ) LIMIT 1`).bind(demoContact?.id ?? '').first<{ id: string }>();
  const demoContract = await db.prepare(`SELECT id FROM partner_contract WHERE id LIKE 'demo-%' LIMIT 1`).first<{ id: string }>();
  const demoLead = await db.prepare(`SELECT id FROM lead WHERE id LIKE 'demo-%' LIMIT 1`).first<{ id: string }>();
  expect(demoCharge && demoAccount && demoContact && demoProduct && freeProduct && demoContract && demoLead).toBeTruthy();

  const keeperContact = 'keeper-contact';
  const keeperLead = 'keeper-lead';
  const keeperCharge = 'keeper-charge';
  const sharedPayment = '66666666-6666-4666-8666-666666666661';
  const keeperAllocation = '66666666-6666-4666-8666-666666666662';
  const demoAllocation = '66666666-6666-4666-8666-666666666663';
  const staffLead = '77777777-7777-4777-8777-777777777771';
  const staffCourse = '77777777-7777-4777-8777-777777777772';
  await db.batch([
    db.prepare(`INSERT INTO contact (id, organization_id, display_name, created_at, updated_at) VALUES (?, 'org-abm', 'Khách giữ lại', ?, ?)`).bind(keeperContact, STAMP, STAMP),
    db.prepare(`INSERT INTO lead (id, code, organization_id, department_id, contact_id, source, need_summary, owner_user_id, stage, status, stage_entered_at, created_at, updated_at, pipeline)
      VALUES (?, 'L-9001', 'org-abm', 'dep-kd', ?, 'website', 'Giữ lại', 'u-sale-1', 'won', 'won', ?, ?, ?, 'learner')`).bind(keeperLead, keeperContact, STAMP, STAMP, STAMP),
    db.prepare(`INSERT INTO charge (id, organization_id, code, contact_id, kind, amount_vnd, created_at, updated_at) VALUES (?, 'org-abm', 'HP000050', ?, 'tuition', 1000, ?, ?)`).bind(keeperCharge, keeperContact, STAMP, STAMP),
    db.prepare(`INSERT INTO payment (id, organization_id, direction, method, amount_vnd, received_at, recorded_by_user_id, created_at, updated_at) VALUES (?, 'org-abm', 'in', 'cash', 2000, ?, 'u-accountant', ?, ?)`).bind(sharedPayment, STAMP, STAMP, STAMP),
    db.prepare(`INSERT INTO payment_allocation (id, payment_id, charge_id, amount_vnd, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, 1000, 'u-accountant', ?, ?)`).bind(keeperAllocation, sharedPayment, keeperCharge, STAMP, STAMP),
    db.prepare(`INSERT INTO payment_allocation (id, payment_id, charge_id, amount_vnd, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, 1000, 'u-accountant', ?, ?)`).bind(demoAllocation, sharedPayment, demoCharge!.id, STAMP, STAMP),
    db.prepare(`INSERT INTO account_contact (id, account_id, contact_id, is_primary, created_at) VALUES ('55555555-5555-4555-8555-555555555555', ?, ?, 0, ?)`).bind(demoAccount!.id, keeperContact, STAMP),
    db.prepare(`INSERT INTO lead (id, code, organization_id, department_id, contact_id, source, need_summary, owner_user_id, stage, status, stage_entered_at, created_at, updated_at, pipeline)
      VALUES (?, 'L-9002', 'org-abm', 'dep-kd', ?, 'website', 'Lead nhân viên', 'u-sale-1', 'won', 'won', ?, ?, ?, 'learner')`).bind(staffLead, demoContact!.id, STAMP, STAMP, STAMP),
    db.prepare(`INSERT INTO task (id, lead_id, title, due_at, assignee_user_id, status, created_at, updated_at) VALUES ('77777777-7777-4777-8777-777777777773', ?, 'Việc nhân viên', ?, 'u-sale-1', 'open', ?, ?)`).bind(staffLead, STAMP, STAMP, STAMP),
    db.prepare(`INSERT INTO activity (id, lead_id, type, summary, occurred_at, created_at) VALUES ('77777777-7777-4777-8777-777777777774', ?, 'note', 'Ghi chú nhân viên', ?, ?)`).bind(demoLead!.id, STAMP, STAMP),
    db.prepare(`INSERT INTO lead_step (id, lead_id, step_code, label, required, position, template_version, created_at, updated_at) VALUES ('77777777-7777-4777-8777-777777777775', ?, 'staff_extra', 'Bước nhân viên', 0, 99, 1, ?, ?)`).bind(demoLead!.id, STAMP, STAMP),
    db.prepare(`INSERT INTO approval (id, kind, lead_id, target_version, payload_json, status, requested_by_kind, created_at, updated_at) VALUES ('77777777-7777-4777-8777-777777777776', 'owner_change', ?, 1, '{}', 'pending', 'human', ?, ?)`).bind(demoLead!.id, STAMP, STAMP),
    db.prepare(`INSERT INTO consent (id, contact_id, purpose, granted, recorded_at) VALUES ('77777777-7777-4777-8777-777777777777', ?, 'marketing', 1, ?)`).bind(demoContact!.id, STAMP),
    db.prepare(`INSERT INTO privacy_request (id, organization_id, contact_id, kind, created_at, updated_at) VALUES ('77777777-7777-4777-8777-777777777778', 'org-abm', ?, 'access', ?, ?)`).bind(demoContact!.id, STAMP, STAMP),
    db.prepare(`INSERT INTO contact_point (id, contact_id, type, value, normalized_value, created_at) VALUES ('77777777-7777-4777-8777-777777777779', ?, 'email', 'staff@demo.example', 'staff@demo.example', ?)`).bind(demoContact!.id, STAMP),
    db.prepare(`INSERT INTO customer_product (id, contact_id, product_id, attached_at, created_at, updated_at) VALUES ('77777777-7777-4777-8777-77777777777a', ?, ?, ?, ?, ?)`).bind(demoContact!.id, freeProduct!.id, STAMP, STAMP, STAMP),
    db.prepare(`INSERT INTO partner_contract_step (id, contract_id, name, position, created_at, updated_at) VALUES ('77777777-7777-4777-8777-77777777777b', ?, 'Bước nhân viên', 9, ?, ?)`).bind(demoContract!.id, STAMP, STAMP),
    db.prepare(`INSERT INTO course (id, organization_id, product_id, name, created_at, updated_at) VALUES (?, 'org-abm', ?, 'Khóa nhân viên', ?, ?)`).bind(staffCourse, demoProduct!.id, STAMP, STAMP),
    db.prepare(`INSERT INTO audit_log (id, actor_kind, command, entity, entity_id, before_json, created_at) VALUES ('audit-keeper', 'human', 'note', 'lead', ?, '{"text":"mentions demo-lead-01"}', ?)`).bind(keeperLead, STAMP),
    db.prepare(`INSERT INTO outbox (id, event_type, payload_json, created_at) VALUES ('keeper-outbox', 'note', '{"id":"demo-lead-01"}', ?)`).bind(STAMP),
    db.prepare(`INSERT INTO idempotency_key (actor_user_id, key, command, request_hash, result_json, created_at) VALUES ('u-sale-1', 'keeper-key', 'note', 'hash', '{"id":"demo-lead-01"}', ?)`).bind(STAMP),
  ]);

  await runCleanup();
  const foreignKeys = await db.prepare('PRAGMA foreign_key_check').all();
  expect(foreignKeys.results).toEqual([]);
  expect(await db.prepare('SELECT id FROM contact WHERE id = ?').bind(keeperContact).first()).toBeTruthy();
  expect(await db.prepare('SELECT code FROM lead WHERE id = ?').bind(keeperLead).first()).toMatchObject({ code: 'L-9001' });
  expect(await db.prepare('SELECT id FROM lead WHERE id = ?').bind(staffLead).first()).toBeNull();
  expect(await db.prepare('SELECT id FROM charge WHERE id = ?').bind(keeperCharge).first()).toBeTruthy();
  expect(await db.prepare('SELECT id FROM payment WHERE id = ?').bind(sharedPayment).first()).toBeTruthy();
  expect(await db.prepare('SELECT id FROM payment_allocation WHERE id = ?').bind(keeperAllocation).first()).toBeTruthy();
  expect(await db.prepare('SELECT id FROM payment_allocation WHERE id = ?').bind(demoAllocation).first()).toBeNull();
  expect(await db.prepare('SELECT id FROM course WHERE id = ?').bind(staffCourse).first()).toBeNull();
  expect(await db.prepare('SELECT id FROM account_contact WHERE contact_id = ?').bind(keeperContact).first()).toBeNull();
  expect(await countOf('outbox')).toBe(1);
  expect(await countOf('idempotency_key')).toBe(1);
  const audits = await db.prepare('SELECT id, entity_id FROM audit_log').all<{ id: string; entity_id: string }>();
  expect(audits.results).toEqual([{ id: 'audit-keeper', entity_id: keeperLead }]);
  for (const table of BUSINESS) {
    if (table === 'idempotency_key') continue;
    const demo = await db.prepare(`SELECT id FROM ${table} WHERE id LIKE 'demo-%' LIMIT 1`).first();
    expect(demo, table).toBeNull();
  }
  expect(await db.prepare('SELECT next_value FROM lead_counter').first()).toMatchObject({ next_value: 9002 });
  expect(await db.prepare('SELECT next_value FROM fee_counter').first()).toMatchObject({ next_value: 51 });
}, 120_000);

async function sampleTargetCounts() {
  const tables: Record<string, number> = {};
  for (const table of BUSINESS_EMPTY_TABLES) tables[table] = await countOf(table);
  const lead = await db.prepare('SELECT next_value FROM lead_counter').first<{ next_value: number }>();
  const demoAudit = await db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE ${DEMO_AUDIT_WHERE}`).first<{ n: number }>();
  return {
    tables,
    leadCounterRows: await countOf('lead_counter'),
    leadNext: lead?.next_value ?? null,
    feeCounterRows: await countOf('fee_counter'),
    demoAuditRows: Number(demoAudit?.n ?? 0),
  };
}

test('cleanup leaves a loadable target when staff outbox, idempotency, and non-demo audit remain', async () => {
  await loadSample();
  await db.batch([
    db.prepare(`INSERT INTO audit_log (id, actor_kind, command, entity, entity_id, created_at) VALUES ('audit-staff', 'human', 'note', 'app_user', 'u-sale-1', ?)`).bind(STAMP),
    db.prepare(`INSERT INTO outbox (id, event_type, payload_json, created_at) VALUES ('staff-outbox', 'approval.requested', '{"approvalId":"staff-approval","leadId":"demo-lead-01"}', ?)`).bind(STAMP),
    db.prepare(`INSERT INTO idempotency_key (actor_user_id, key, command, request_hash, result_json, created_at) VALUES ('u-sale-1', 'staff-key', 'note', 'hash', '{"leadId":"demo-lead-01"}', ?)`).bind(STAMP),
  ]);
  await runCleanup();
  const counts = await sampleTargetCounts();
  expect(sampleTargetProblems(counts)).toEqual([]);
  expect(await countOf('outbox')).toBe(1);
  expect(await countOf('idempotency_key')).toBe(1);
  expect(await countOf('audit_log')).toBe(1);
  expect(sampleTargetProblems({ ...counts, demoAuditRows: 1 }).some((problem) => problem.includes('audit_log'))).toBe(true);
  expect(sampleTargetProblems({ ...counts, tables: { ...counts.tables, lead: 1 } }).some((problem) => problem.startsWith('lead '))).toBe(true);
}, 120_000);
