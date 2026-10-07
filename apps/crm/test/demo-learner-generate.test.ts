import { env } from 'cloudflare:test';
import { afterEach, describe, expect, test, vi } from 'vitest';
import app from '../src/worker/index';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
const demoExport = process.env.DEMO_EXPORT === '1' || (env as { DEMO_EXPORT?: string }).DEMO_EXPORT === '1';
const ACADEMIC = 'slot-academic-1';
const ACCOUNTANT = 'slot-accountant-1';
const TEACHER_1 = 'slot-teacher-1';
const TEACHER_2 = 'slot-teacher-2';
const SALES = ['slot-sale-1', 'slot-sale-2', 'slot-sale-3'] as const;
function floorToMinute(value: Date) {
  return new Date(Math.floor(value.getTime() / 60_000) * 60_000);
}

/** Real export time. The export test assigns this once, before fake timers start. */
let exportAnchor = floorToMinute(new Date(0));
const STUB_ACCOUNTS = new Set(['demo-acc-12', 'demo-acc-16', 'demo-acc-17']);
const UUID_SRC = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/** Parent first, so a later load satisfies immediate foreign keys without deferring across batches. */
const EXPORT_TABLES = [
  'org_setting', 'account', 'contact', 'account_contact', 'contact_point',
  'partner_contract', 'partner_contract_step', 'lead', 'lead_step', 'task', 'activity', 'approval', 'audit_log',
  'product', 'customer_product', 'consent', 'course', 'class_group', 'class_teacher', 'class_session',
  'enrollment', 'trial_booking', 'attendance', 'charge', 'payment', 'payment_allocation', 'privacy_request',
];

interface Learner { n: number; leadId: string; contactId: string; owner: string; enrollmentId?: string }
interface Marked { entries: { attendanceId: string; version: number }[] }

const ownerOf = (n: number) => SALES[(n - 1) % 3]!;

function on(daysAgo: number) {
  const dt = new Date(Date.UTC(exportAnchor.getUTCFullYear(), exportAnchor.getUTCMonth(), exportAnchor.getUTCDate()));
  dt.setUTCDate(dt.getUTCDate() - daysAgo);
  return dt.toISOString().slice(0, 10);
}

/** Keep a story calendar date the same distance from the anchor day as it was from 2026-10-07. */
function shiftStoryDate(isoDate: string) {
  const base = Date.UTC(2026, 9, 7);
  const anchorDay = Date.UTC(exportAnchor.getUTCFullYear(), exportAnchor.getUTCMonth(), exportAnchor.getUTCDate());
  const dt = new Date(`${isoDate}T00:00:00.000Z`);
  dt.setUTCDate(dt.getUTCDate() + Math.round((anchorDay - base) / 86_400_000));
  return dt.toISOString().slice(0, 10);
}

const evening = (daysAgo: number) => `${on(daysAgo)}T19:00:00+07:00`;

function sqlLit(value: unknown) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'bigint') return value.toString();
  const text = String(value);
  if (/[\r\n]/.test(text)) throw new Error('export value contains a newline');
  return `'${text.replaceAll("'", "''")}'`;
}

async function command(user: string, name: string, body: unknown) {
  const response = await app.fetch(new Request(`http://crm.test/api/commands/${name}`, {
    method: 'POST',
    headers: { 'X-Demo-User': user, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(body),
  }), { ...env, DEMO_MODE: '1', AUTH_MODE: '' });
  const json = await response.json() as { ok: boolean; data?: any; error?: unknown };
  if (response.status !== 200 || !json.ok) throw new Error(`${name} failed ${response.status} ${JSON.stringify(json)}`);
  return json.data;
}

async function leadVersion(leadId: string) {
  const row = await db.prepare('SELECT version FROM lead WHERE id = ?').bind(leadId).first<{ version: number }>();
  if (!row) throw new Error(`missing lead ${leadId}`);
  return row.version;
}

async function seedRoster() {
  const stamp = '2026-01-01T00:00:00Z';
  await resetDb(db, `INSERT INTO organization (id, name, created_at, updated_at) VALUES ('org-abm', 'ABM (dữ liệu mẫu)', '${stamp}', '${stamp}');`);
  const users: [string, string, string, string | null, string | null][] = [
    ['slot-admin-1', 'Quản trị mẫu', 'admin', null, null],
    ['slot-sale-1', 'Sale mẫu 1', 'sale', 'dep-kd', 'team-kd1'],
    ['slot-sale-2', 'Sale mẫu 2', 'sale', 'dep-kd', 'team-kd2'],
    ['slot-sale-3', 'Sale mẫu 3', 'sale', 'dep-kd', 'team-kd2'],
    ['slot-leader-1', 'Leader mẫu 1', 'leader', 'dep-kd', 'team-kd1'],
    ['slot-leader-2', 'Leader mẫu 2', 'leader', 'dep-kd', 'team-kd2'],
    ['slot-head-1', 'Trưởng phòng mẫu', 'head', 'dep-kd', null],
    [ACADEMIC, 'Tổ chức mẫu', 'academic', null, null],
    [TEACHER_1, 'Giáo viên mẫu 1', 'teacher', null, null],
    [TEACHER_2, 'Giáo viên mẫu 2', 'teacher', null, null],
    [ACCOUNTANT, 'Kế toán mẫu', 'accountant', null, null],
  ];
  const statements = [
    `INSERT INTO department (id, organization_id, name, created_at, updated_at) VALUES ('dep-kd', 'org-abm', 'Phòng Kinh doanh mẫu', '${stamp}', '${stamp}')`,
    `INSERT INTO team (id, department_id, name, created_at, updated_at) VALUES ('team-kd1', 'dep-kd', 'Kinh doanh 1', '${stamp}', '${stamp}')`,
    `INSERT INTO team (id, department_id, name, created_at, updated_at) VALUES ('team-kd2', 'dep-kd', 'Kinh doanh 2', '${stamp}', '${stamp}')`,
    ...users.map(([id, name, role, departmentId, teamId]) => `INSERT INTO app_user (id, organization_id, department_id, team_id, display_name, email, role, created_at, updated_at)
      VALUES ('${id}', 'org-abm', ${departmentId ? `'${departmentId}'` : 'NULL'}, ${teamId ? `'${teamId}'` : 'NULL'}, '${name}', '${id}@demo.example', '${role}', '${stamp}', '${stamp}')`),
    `INSERT INTO lead_counter (organization_id, next_value) VALUES ('org-abm', 23)`,
    `INSERT INTO account (id, organization_id, name, created_at, updated_at) VALUES ('demo-acc-12', 'org-abm', 'Tập đoàn Giáo dục Ánh Dương Demo', '${stamp}', '${stamp}')`,
    `INSERT INTO account (id, organization_id, name, created_at, updated_at) VALUES ('demo-acc-16', 'org-abm', 'Công ty TNHH In ấn Kim Phát Demo', '${stamp}', '${stamp}')`,
    `INSERT INTO account (id, organization_id, name, created_at, updated_at) VALUES ('demo-acc-17', 'org-abm', 'Công ty CP Spa Thanh Xuân Demo', '${stamp}', '${stamp}')`,
  ];
  await db.batch(statements.map((sql) => db.prepare(sql)));
}

async function makeLearner(n: number, source: 'facebook' | 'partner' | 'zalo' | 'website' = 'facebook', extra: Record<string, unknown> = {}): Promise<Learner> {
  const owner = ownerOf(n);
  const label = String(n).padStart(3, '0');
  const data = await command(owner, 'createLearnerLead', {
    contactName: `Học viên Mẫu ${label}`, phone: `090999${label.padStart(4, '0')}`, email: `hv${label}@demo.example`, source,
    needSummary: 'Học thử khóa mẫu', nextAction: { title: 'Gọi học viên mẫu', dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString() }, ...extra,
  });
  return { n, leadId: data.leadId, contactId: data.contactId, owner };
}

async function walk(learner: Learner, steps: Array<'contacted' | 'need_confirmed'>) {
  for (const stepCode of steps) {
    await command(learner.owner, 'markJourneyStep', { leadId: learner.leadId, expectedVersion: await leadVersion(learner.leadId), stepCode });
  }
}

async function winSkip(learner: Learner) {
  await walk(learner, ['contacted', 'need_confirmed']);
  await command(learner.owner, 'skipTrial', { leadId: learner.leadId, expectedVersion: await leadVersion(learner.leadId), reason: 'Đã học thử nơi khác' });
  await command(learner.owner, 'winLearnerLead', { leadId: learner.leadId, expectedVersion: await leadVersion(learner.leadId), note: 'Chốt mẫu' });
}

async function seat(learner: Learner, classId: string) {
  await command(learner.owner, 'recordConsent', { contactId: learner.contactId, purpose: 'enrollment', granted: true });
  const reserved = await command(learner.owner, 'reserveSeat', { leadId: learner.leadId, expectedVersion: await leadVersion(learner.leadId), classId });
  await command(ACADEMIC, 'confirmEnrollment', { enrollmentId: reserved.id, version: reserved.version });
  learner.enrollmentId = reserved.id as string;
}

async function closeLead(learner: Learner, outcome: 'lost' | 'not_fit', reason: 'price' | 'not_fit') {
  await command(learner.owner, 'closeLearnerLead', {
    leadId: learner.leadId, expectedVersion: await leadVersion(learner.leadId), outcome, reason,
  });
}

async function openClass(courseId: string, name: string, scheduleText: string, teacherUserId: string) {
  const created = await command(ACADEMIC, 'upsertClass', { courseId, name, scheduleText, status: 'open' });
  await command(ACADEMIC, 'setClassTeachers', { classId: created.id, version: created.version, teacherUserIds: [teacherUserId] });
  return created.id as string;
}

async function addSession(classId: string, daysAgo: number, kind: 'regular' | 'trial') {
  const created = await command(ACADEMIC, 'addSession', { classId, startsAt: evening(daysAgo), durationMinutes: 90, kind });
  return created.id as string;
}

async function markEnrollment(sessionId: string, enrollmentId: string, status: 'present' | 'absent') {
  const row = await db.prepare('SELECT version FROM attendance WHERE session_id = ? AND enrollment_id = ?')
    .bind(sessionId, enrollmentId).first<{ version: number }>();
  return command(ACADEMIC, 'markAttendance', {
    sessionId, entries: [{ enrollmentId, status, version: row?.version ?? null }],
  }) as Promise<Marked>;
}

async function markTrial(sessionId: string, trialBookingId: string) {
  const row = await db.prepare('SELECT version FROM attendance WHERE session_id = ? AND trial_booking_id = ?')
    .bind(sessionId, trialBookingId).first<{ version: number }>();
  return command(ACADEMIC, 'markAttendance', {
    sessionId, entries: [{ trialBookingId, status: 'present', version: row?.version ?? null }],
  });
}

function findUuids(value: string) {
  return value.match(new RegExp(UUID_SRC, 'g')) ?? [];
}

async function exportLearnerSql() {
  const loaded: { table: string; columns: string[]; rows: Record<string, unknown>[] }[] = [];
  for (const table of EXPORT_TABLES) {
    const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    const columns = info.results.map((column) => column.name);
    const order = columns.includes('created_at') ? 'created_at, rowid' : columns.includes('recorded_at') ? 'recorded_at, rowid' : 'rowid';
    const selected = await db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all<Record<string, unknown>>();
    const rows = table === 'account' ? selected.results.filter((row) => !STUB_ACCOUNTS.has(String(row.id))) : selected.results;
    if (rows.length) loaded.push({ table, columns, rows });
  }

  const tokens = new Map<string, string>();
  for (const { table, rows } of loaded) {
    let n = 0;
    for (const row of rows) {
      if (typeof row.id === 'string' && new RegExp(`^${UUID_SRC}$`, 'i').test(row.id)) {
        n += 1;
        tokens.set(row.id.toLowerCase(), `demo-${table}-${String(n).padStart(3, '0')}`);
      }
    }
  }
  let txn = 0;
  for (const { columns, rows } of loaded) {
    for (const row of rows) {
      for (const column of columns) {
        if (typeof row[column] !== 'string') continue;
        for (const found of findUuids(row[column])) {
          const key = found.toLowerCase();
          if (!tokens.has(key)) {
            txn += 1;
            tokens.set(key, `demo-txn-${String(txn).padStart(3, '0')}`);
          }
        }
      }
    }
  }

  const lines = loaded.flatMap(({ table, columns, rows }) => rows.map((row) => {
    const values = columns.map((column) => sqlLit(row[column])).join(', ');
    return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values});`;
  }));
  const leadCounter = await db.prepare('SELECT next_value FROM lead_counter WHERE organization_id = ?').bind('org-abm').first<{ next_value: number }>();
  const feeCounter = await db.prepare('SELECT next_value FROM fee_counter WHERE organization_id = ?').bind('org-abm').first<{ next_value: number }>();
  if (!leadCounter || !feeCounter) throw new Error('counter row missing');
  lines.push(
    `INSERT INTO lead_counter (organization_id, next_value) VALUES ('org-abm', ${leadCounter.next_value}) ON CONFLICT(organization_id) DO UPDATE SET next_value=excluded.next_value;`,
    `INSERT INTO fee_counter (organization_id, next_value) VALUES ('org-abm', ${feeCounter.next_value}) ON CONFLICT(organization_id) DO UPDATE SET next_value=excluded.next_value;`,
  );
  const sql = [`-- generated-at: ${exportAnchor.toISOString()}`, 'PRAGMA defer_foreign_keys = ON;', ...lines].join('\n').replace(new RegExp(UUID_SRC, 'gi'), (found) => {
    const token = tokens.get(found.toLowerCase());
    if (!token) throw new Error(`unmapped uuid ${found}`);
    return token;
  }) + '\n';
  const leftover = sql.match(new RegExp(UUID_SRC, 'i'));
  if (leftover) throw new Error(`uuid remains ${leftover[0]}`);
  if (/INSERT INTO outbox/i.test(sql)) throw new Error('export contains outbox rows');
  return sql;
}

describe.skipIf(!demoExport)('learner sample export', () => {
  afterEach(() => vi.useRealTimers());

  test('system clock reaches stored lead timestamps', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-01T03:04:05.000Z'));
    await seedRoster();
    const created = await command('slot-sale-1', 'createLearnerLead', {
      contactName: 'Học viên Mẫu 000', phone: '0909990000', source: 'facebook', needSummary: 'Học thử',
      nextAction: { title: 'Gọi học viên mẫu', dueAt: '2026-08-03T03:00:00.000Z' },
    });
    const row = await db.prepare('SELECT created_at FROM lead WHERE id = ?').bind(created.leadId).first<{ created_at: string }>();
    expect(row?.created_at).toBe('2026-08-01T03:04:05.000Z');
  });

  test('writes the learner sample from app commands', async () => {
    exportAnchor = floorToMinute(new Date());
    vi.useFakeTimers({ toFake: ['Date'] });
    let last = 0;
    const go = (daysAgo: number, hour: number, minute = 0) => {
      const when = new Date(`${on(daysAgo)}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+07:00`);
      if (when.getTime() < last) throw new Error(`clock moved backward to ${when.toISOString()}`);
      last = when.getTime();
      vi.setSystemTime(when);
    };

    go(58, 10);
    await seedRoster();
    const ielts = await command(ACADEMIC, 'upsertProduct', { name: 'Khóa IELTS mẫu', priceVnd: 8_000_000, active: true });
    const speaking = await command(ACADEMIC, 'upsertProduct', { name: 'Khóa Giao tiếp mẫu', priceVnd: 5_000_000, active: true });
    const kids = await command(ACADEMIC, 'upsertProduct', { name: 'Khóa Thiếu nhi mẫu', priceVnd: 6_000_000, active: true });
    const ieltsCourse = await command(ACADEMIC, 'upsertCourse', { productId: ielts.id, name: 'IELTS 6.5 mẫu', status: 'active' });
    const speakingCourse = await command(ACADEMIC, 'upsertCourse', { productId: speaking.id, name: 'Giao tiếp B1 mẫu', status: 'active' });
    const kidsCourse = await command(ACADEMIC, 'upsertCourse', { productId: kids.id, name: 'Thiếu nhi A mẫu', status: 'active' });
    const classA = await openClass(ieltsCourse.id, 'Lớp Tối 3-5', 'Tối 3-5', TEACHER_1);
    const classB = await openClass(ieltsCourse.id, 'Lớp Tối 2-4', 'Tối 2-4', TEACHER_2);
    const classC = await openClass(speakingCourse.id, 'Lớp Sáng', 'Sáng 2-4', TEACHER_1);
    const classD = await openClass(kidsCourse.id, 'Lớp Cuối tuần', 'Cuối tuần', TEACHER_2);
    const sessionA40 = await addSession(classA, 40, 'regular');
    const sessionA20 = await addSession(classA, 20, 'regular');
    await addSession(classA, -6, 'regular');
    const trial36 = await addSession(classA, 36, 'trial');
    const trial30 = await addSession(classA, 30, 'trial');
    const trialFuture = await addSession(classA, -4, 'trial');
    await addSession(classB, -5, 'regular');
    const sessionC28 = await addSession(classC, 28, 'regular');
    await addSession(classC, -8, 'regular');
    await addSession(classD, -2, 'regular');
    const contracts = [];
    for (const [accountId, name] of [
      ['demo-acc-12', 'Hợp đồng Ánh Dương mẫu'],
      ['demo-acc-16', 'Hợp đồng Kim Phát mẫu'],
      ['demo-acc-17', 'Hợp đồng Thanh Xuân mẫu'],
    ] as const) {
      contracts.push(await command('slot-sale-1', 'upsertPartnerContract', {
        accountId, name, status: 'active', startsOn: shiftStoryDate('2026-08-01'), endsOn: shiftStoryDate('2027-08-01'),
      }));
    }

    const enrolled = async (n: number, classId: string, productId: string) => {
      const learner = await makeLearner(n, 'facebook', { productIds: [productId] });
      await winSkip(learner);
      await seat(learner, classId);
      return learner;
    };

    go(56, 9);
    const student13 = await enrolled(13, classA, ielts.id);
    for (const purpose of ['fee', 'attendance', 'marketing', 'image'] as const) {
      await command(student13.owner, 'recordConsent', { contactId: student13.contactId, purpose, granted: true });
    }
    const student14 = await enrolled(14, classA, ielts.id);
    const student16 = await enrolled(16, classA, ielts.id);
    const student17 = await enrolled(17, classA, ielts.id);
    const student18 = await enrolled(18, classC, speaking.id);
    const student19 = await enrolled(19, classD, kids.id);

    go(52, 9);
    const student15 = await makeLearner(15, 'facebook', { productIds: [ielts.id] });
    await walk(student15, ['contacted', 'need_confirmed']);

    go(40, 19, 40);
    await markEnrollment(sessionA40, student13.enrollmentId!, 'present');

    go(36, 10);
    const booked15 = await command(student15.owner, 'bookTrial', {
      leadId: student15.leadId, expectedVersion: await leadVersion(student15.leadId), sessionId: trial36,
    });
    go(36, 19, 40);
    await markTrial(trial36, booked15.id);
    go(35, 11);
    await command(student15.owner, 'winLearnerLead', { leadId: student15.leadId, expectedVersion: await leadVersion(student15.leadId), note: 'Chốt sau học thử' });
    await seat(student15, classB);

    go(32, 9);
    const student10 = await makeLearner(10, 'zalo');
    await walk(student10, ['contacted', 'need_confirmed']);
    const booked10 = await command(student10.owner, 'bookTrial', {
      leadId: student10.leadId, expectedVersion: await leadVersion(student10.leadId), sessionId: trial30,
    });
    go(30, 19, 40);
    await markTrial(trial30, booked10.id);

    go(28, 19, 40);
    const absence = await markEnrollment(sessionC28, student18.enrollmentId!, 'absent');
    go(27, 10);
    const makeup = await command(ACADEMIC, 'createMakeupSession', {
      attendanceId: absence.entries[0]!.attendanceId, startsAt: evening(21), durationMinutes: 90, note: 'Học bù mẫu',
    });

    go(24, 9);
    await closeLead(await makeLearner(11), 'lost', 'price');
    go(23, 9);
    await closeLead(await makeLearner(12), 'not_fit', 'not_fit');

    go(22, 9);
    await makeLearner(1, 'partner', { partnerContractId: contracts[0].id });
    await makeLearner(2);
    const contacted = await makeLearner(3, 'website');
    await walk(contacted, ['contacted']);
    const qualified = await makeLearner(4);
    await walk(qualified, ['contacted', 'need_confirmed']);
    const trialBooked = await makeLearner(9, 'facebook');
    await walk(trialBooked, ['contacted', 'need_confirmed']);
    await command(trialBooked.owner, 'bookTrial', {
      leadId: trialBooked.leadId, expectedVersion: await leadVersion(trialBooked.leadId), sessionId: trialFuture,
    });

    go(21, 19, 40);
    await markEnrollment(makeup.id, student18.enrollmentId!, 'present');

    go(20, 9);
    await makeLearner(5);
    go(20, 19, 40);
    await markEnrollment(sessionA20, student13.enrollmentId!, 'present');

    go(18, 10);
    await command(ACADEMIC, 'deferEnrollment', {
      enrollmentId: student16.enrollmentId, version: await (async () => {
        const row = await db.prepare('SELECT version FROM enrollment WHERE id = ?').bind(student16.enrollmentId).first<{ version: number }>();
        if (!row) throw new Error('missing deferred enrollment');
        return row.version;
      })(), until: shiftStoryDate('2026-12-01'),
    });

    go(15, 9);
    await makeLearner(6);
    go(12, 10);
    await command(ACADEMIC, 'transferEnrollment', {
      enrollmentId: student17.enrollmentId, version: await (async () => {
        const row = await db.prepare('SELECT version FROM enrollment WHERE id = ?').bind(student17.enrollmentId).first<{ version: number }>();
        if (!row) throw new Error('missing transferred enrollment');
        return row.version;
      })(), toClassId: classB,
    });

    go(11, 9);
    await makeLearner(7);
    go(9, 10);
    const tuition = await command(ACCOUNTANT, 'createCharge', {
      contactId: student13.contactId, enrollmentId: student13.enrollmentId, kind: 'tuition', amountVnd: 8_000_000,
    });
    const firstCode = await db.prepare('SELECT code FROM charge WHERE id = ?').bind(tuition.id).first<{ code: string }>();
    expect(firstCode?.code).toBe('HP000001');
    await command(ACCOUNTANT, 'recordPayment', {
      direction: 'in', method: 'transfer', amountVnd: 8_000_000, receivedAt: new Date().toISOString(), memo: 'ABM HP000001',
    });
    const partial = await command(ACCOUNTANT, 'createCharge', {
      contactId: student14.contactId, enrollmentId: student14.enrollmentId, kind: 'tuition', amountVnd: 5_000_000,
    });
    const partialCode = await db.prepare('SELECT code FROM charge WHERE id = ?').bind(partial.id).first<{ code: string }>();
    expect(partialCode?.code).toBe('HP000002');
    await command(ACCOUNTANT, 'recordPayment', {
      direction: 'in', method: 'cash', amountVnd: 2_000_000, receivedAt: new Date().toISOString(), memo: 'ABM HP000002',
    });
    await command(ACCOUNTANT, 'recordPayment', {
      direction: 'in', method: 'transfer', amountVnd: 1_500_000, receivedAt: new Date().toISOString(), memo: 'Nop tien khong ma',
    });
    await command(ACCOUNTANT, 'recordPayment', {
      direction: 'refund', method: 'transfer', amountVnd: 100_000, receivedAt: new Date().toISOString(),
      memo: 'Hoan tien mau', contactId: student13.contactId,
    });
    const voided = await command(ACCOUNTANT, 'createCharge', {
      contactId: student19.contactId, enrollmentId: student19.enrollmentId, kind: 'material', amountVnd: 100_000,
    });
    await command(ACCOUNTANT, 'voidCharge', { chargeId: voided.id, version: voided.version, reason: 'Hủy khoản mẫu' });
    await command(ACCOUNTANT, 'createCharge', {
      contactId: student13.contactId, kind: 'adjustment', amountVnd: -500_000, note: 'Giảm học phí mẫu',
    });

    go(8, 9);
    await makeLearner(8);
    await makeLearner(20);
    go(7, 9);
    await makeLearner(21);
    go(7, 10);
    await command(student13.owner, 'recordConsent', { contactId: student13.contactId, purpose: 'marketing', granted: false });
    go(6, 9);
    const privacyLead = await makeLearner(22);
    go(6, 10);
    await command(privacyLead.owner, 'createPrivacyRequest', {
      contactId: privacyLead.contactId, kind: 'access', detail: 'Yêu cầu xem hồ sơ mẫu',
    });
    go(5, 9);
    await makeLearner(23);
    go(5, 9, 20);
    await makeLearner(24);
    if (exportAnchor.getTime() < last) throw new Error('anchor is behind the timeline');
    vi.setSystemTime(exportAnchor);

    const stages = await db.prepare(`SELECT DISTINCT stage FROM lead WHERE pipeline = 'learner'`).all<{ stage: string }>();
    const stageCodes = new Set(stages.results.map((row) => row.stage));
    for (const stage of ['new', 'contacted', 'qualified', 'trial_booked', 'trial_done', 'won', 'lost', 'not_fit']) {
      expect(stageCodes.has(stage), stage).toBe(true);
    }
    const learnerCount = await db.prepare(`SELECT COUNT(*) AS n FROM lead WHERE pipeline = 'learner'`).first<{ n: number }>();
    expect(learnerCount?.n).toBe(24);
    const eveningCount = await db.prepare(`SELECT COUNT(*) AS n FROM class_session WHERE starts_at LIKE '%T12:00:00.000Z'`).first<{ n: number }>();
    expect(eveningCount?.n).toBeGreaterThan(0);
    const deferred = await db.prepare(`SELECT COUNT(*) AS n FROM enrollment WHERE status = 'deferred'`).first<{ n: number }>();
    const transferred = await db.prepare(`SELECT COUNT(*) AS n FROM enrollment WHERE status = 'transferred'`).first<{ n: number }>();
    const makeupCount = await db.prepare(`SELECT COUNT(*) AS n FROM class_session WHERE kind = 'makeup'`).first<{ n: number }>();
    expect(deferred?.n).toBe(1);
    expect(transferred?.n).toBe(1);
    expect(makeupCount?.n).toBe(1);
    const missingReason = await db.prepare(`SELECT COUNT(*) AS n FROM lead WHERE stage IN ('lost', 'not_fit') AND lost_reason IS NULL`).first<{ n: number }>();
    expect(missingReason?.n).toBe(0);
    const methods = await db.prepare(`SELECT DISTINCT method FROM payment`).all<{ method: string }>();
    expect(new Set(methods.results.map((row) => row.method))).toEqual(new Set(['transfer', 'cash']));
    const refunds = await db.prepare(`SELECT COUNT(*) AS n FROM payment WHERE direction = 'refund'`).first<{ n: number }>();
    const voids = await db.prepare(`SELECT COUNT(*) AS n FROM charge WHERE status = 'void'`).first<{ n: number }>();
    const discounts = await db.prepare(`SELECT COUNT(*) AS n FROM charge WHERE kind = 'adjustment' AND amount_vnd < 0`).first<{ n: number }>();
    expect(refunds?.n).toBe(1);
    expect(voids?.n).toBe(1);
    expect(discounts?.n).toBe(1);
    const openPrivacy = await db.prepare(`SELECT COUNT(*) AS n FROM privacy_request WHERE status = 'open'`).first<{ n: number }>();
    expect(openPrivacy?.n).toBe(1);

    const sql = await exportLearnerSql();
    expect(sql.startsWith(`-- generated-at: ${exportAnchor.toISOString()}\nPRAGMA defer_foreign_keys = ON;\n`)).toBe(true);
    await expect(sql).toMatchFileSnapshot('../seed/learner-demo.sql');
  }, 180_000);
});
