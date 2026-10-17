import { beforeEach, describe, expect, it } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import { addUser, command, db, get, makeClass, winLead } from './helpers/learner-fixtures';
import { resetDb } from './helpers/reset-db';

const header = 'Họ tên,Số điện thoại,Email,Nhu cầu';
const count = async (sql: string, ...binds: unknown[]) =>
  (await db.prepare(sql).bind(...binds).first<{ n: number }>())!.n;

async function makeContract(status = 'active') {
  const r = await command('u-lan', 'upsertPartnerContract', {
    accountName: 'Doanh Nghiệp Đối Tác',
    name: 'HĐ Đào Tạo 2026',
    status,
  });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json.data as { id: string; version: number };
}

beforeEach(async () => {
  await resetDb(db, seedSql);
  await addUser('u-academic', 'academic');
  await addUser('u-accountant', 'accountant');
});

describe('LMS partner import into class and Sale report filter', () => {
  it('previews and commits 4 rows (2 with email, 1 without email, 1 invalid email) into a class', async () => {
    const contract = await makeContract('active');
    const { classId } = await makeClass('Lớp B2B K1');

    const csv = [
      header,
      'Nguyễn Văn A,0911000001,a@corp.example,Học AI',
      'Trần Thị B,0911000002,B@Corp.Example,Học AI',
      'Lê Văn C,0911000003,,Học AI',
      'Phạm Thị D,0911000004,not-an-email,Học AI',
    ].join('\n');

    const enrollmentsBefore = await count('SELECT COUNT(*) AS n FROM enrollment');
    const preview = await command('u-lan', 'importContractLearners', {
      contractId: contract.id,
      classId,
      csv,
      commit: false,
    });
    expect(preview.status, JSON.stringify(preview.json)).toBe(200);
    expect(preview.json.data.committed).toBe(false);
    expect(preview.json.data.create).toHaveLength(3);
    expect(preview.json.data.errors).toHaveLength(1);
    expect(preview.json.data.summary).toEqual({
      newAccounts: 2,
      existingAccounts: 0,
      noEmail: 1,
      emailTaken: 0,
    });
    expect(await count('SELECT COUNT(*) AS n FROM enrollment')).toBe(enrollmentsBefore);

    const commit = await command('u-lan', 'importContractLearners', {
      contractId: contract.id,
      classId,
      csv,
      commit: true,
    });
    expect(commit.status, JSON.stringify(commit.json)).toBe(200);
    expect(commit.json.data.committed).toBe(true);
    expect(commit.json.data.summary).toEqual({
      newAccounts: 2,
      existingAccounts: 0,
      noEmail: 1,
      emailTaken: 0,
    });

    expect(
      await count(
        "SELECT COUNT(*) AS n FROM lead WHERE partner_contract_id = ? AND status = 'won' AND stage = 'won' AND source = 'partner'",
        contract.id,
      ),
    ).toBe(3);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM enrollment WHERE class_id = ? AND status = 'confirmed'",
        classId,
      ),
    ).toBe(3);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM consent WHERE purpose = 'enrollment' AND granted = 1 AND note = 'Theo hợp đồng doanh nghiệp'",
      ),
    ).toBe(3);
    expect(
      await count(
        'SELECT COUNT(*) AS n FROM learner_account WHERE password_hash IS NULL',
      ),
    ).toBe(2);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM task tk JOIN lead l ON l.id = tk.lead_id WHERE l.partner_contract_id = ? AND tk.status = 'open'",
        contract.id,
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM lead_step s JOIN lead l ON l.id = s.lead_id WHERE l.partner_contract_id = ? AND s.status <> 'done'",
        contract.id,
      ),
    ).toBe(0);
  });

  it('second import of a row whose email already has an account reuses it and adds enrollment in a different class', async () => {
    const contract = await makeContract('active');
    const class1 = await makeClass('Lớp B2B K1');
    const class2 = await makeClass('Lớp B2B K2');

    const csv1 = `${header}\nNguyễn Văn A,0911000011,a@corp.example,Học khóa 1`;
    const first = await command('u-lan', 'importContractLearners', {
      contractId: contract.id,
      classId: class1.classId,
      csv: csv1,
      commit: true,
    });
    expect(first.status, JSON.stringify(first.json)).toBe(200);
    expect(await count('SELECT COUNT(*) AS n FROM learner_account')).toBe(1);

    const csv2 = `${header}\nNguyễn Văn A,0911000011,A@CORP.EXAMPLE,Học khóa 2`;
    const preview2 = await command('u-lan', 'importContractLearners', {
      contractId: contract.id,
      classId: class2.classId,
      csv: csv2,
      commit: false,
    });
    expect(preview2.status, JSON.stringify(preview2.json)).toBe(200);
    expect(preview2.json.data.create[0].account).toBe('existing');
    expect(preview2.json.data.summary).toEqual({
      newAccounts: 0,
      existingAccounts: 1,
      noEmail: 0,
      emailTaken: 0,
    });

    const commit2 = await command('u-lan', 'importContractLearners', {
      contractId: contract.id,
      classId: class2.classId,
      csv: csv2,
      commit: true,
    });
    expect(commit2.status, JSON.stringify(commit2.json)).toBe(200);
    expect(await count('SELECT COUNT(*) AS n FROM learner_account')).toBe(1);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM enrollment WHERE class_id = ? AND status = 'confirmed'",
        class2.classId,
      ),
    ).toBe(1);
  });

  it('reuses existing account when contact already has an account with email A and file row matches by phone with email B', async () => {
    const contract = await makeContract('active');
    const { classId } = await makeClass('Lớp B2B K3');

    const won = await winLead('Hoàng Văn E', '0911000021');
    const acct = await command('u-academic', 'createLearnerAccount', {
      contactId: won.contactId,
      email: 'email-a@corp.example',
    });
    expect(acct.status, JSON.stringify(acct.json)).toBe(200);

    const csv = `${header}\nHoàng Văn E,0911000021,email-b@corp.example,Học nâng cao`;
    const preview = await command('u-lan', 'importContractLearners', {
      contractId: contract.id,
      classId,
      csv,
      commit: false,
    });
    expect(preview.status, JSON.stringify(preview.json)).toBe(200);
    expect(preview.json.data.create[0].account).toBe('existing');
    expect(preview.json.data.summary).toEqual({
      newAccounts: 0,
      existingAccounts: 1,
      noEmail: 0,
      emailTaken: 0,
    });

    const commit = await command('u-lan', 'importContractLearners', {
      contractId: contract.id,
      classId,
      csv,
      commit: true,
    });
    expect(commit.status, JSON.stringify(commit.json)).toBe(200);
    expect(await count('SELECT COUNT(*) AS n FROM learner_account WHERE contact_id = ?', won.contactId)).toBe(1);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM enrollment WHERE contact_id = ? AND class_id = ? AND status = 'confirmed'",
        won.contactId,
        classId,
      ),
    ).toBe(1);
  });

  it('sale user imports with classId and owns the leads; GET /lms/open-classes is allowed for sale and forbidden for accountant', async () => {
    const contract = await makeContract('active');
    const { classId } = await makeClass('Lớp Mở Cho Sale');

    await db.prepare(`INSERT INTO lms_program (id, organization_id, class_id, title, content_version, created_at, updated_at, version)
      VALUES ('prog-1', 'org-abm', ?, 'Chương trình K1', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 1)`)
      .bind(classId)
      .run();

    const openRes = await get('u-lan', '/lms/open-classes');
    expect(openRes.status, JSON.stringify(openRes.json)).toBe(200);
    expect(openRes.json.data).toEqual([
      expect.objectContaining({
        id: classId,
        name: 'Lớp Mở Cho Sale',
        courseName: 'IELTS 6.5',
        scheduleText: 'Tối 3-5',
        hasProgram: true,
      }),
    ]);

    const denied = await get('u-accountant', '/lms/open-classes');
    expect(denied.status).toBe(403);

    const csv = `${header}\nĐặng Thị F,0911000031,f@corp.example,Học`;
    const commit = await command('u-lan', 'importContractLearners', {
      contractId: contract.id,
      classId,
      csv,
      commit: true,
    });
    expect(commit.status, JSON.stringify(commit.json)).toBe(200);
    const leadOwner = await db.prepare('SELECT owner_user_id FROM lead WHERE partner_contract_id = ?')
      .bind(contract.id)
      .first<{ owner_user_id: string }>();
    expect(leadOwner?.owner_user_id).toBe('u-lan');
  });

  it('dashboard wonCount for learner pipeline is unchanged after partner class import', async () => {
    const contract = await makeContract('active');
    const { classId } = await makeClass('Lớp B2B Dashboard');

    await winLead('Khách Lẻ Thắng', '0911000040');
    const beforeDash = await get('u-lan', '/dashboard');
    expect(beforeDash.status).toBe(200);
    const learnerWonBefore = beforeDash.json.data.byPipeline.learner.wonCount as number;
    const totalWonBefore = beforeDash.json.data.kpi.wonCount as number;
    expect(learnerWonBefore).toBeGreaterThanOrEqual(1);

    const csv = [
      header,
      'Nhân Viên 1,0911000041,nv1@corp.example,Học',
      'Nhân Viên 2,0911000042,nv2@corp.example,Học',
    ].join('\n');
    const commit = await command('u-lan', 'importContractLearners', {
      contractId: contract.id,
      classId,
      csv,
      commit: true,
    });
    expect(commit.status, JSON.stringify(commit.json)).toBe(200);

    const afterDash = await get('u-lan', '/dashboard');
    expect(afterDash.status).toBe(200);
    expect(afterDash.json.data.byPipeline.learner.wonCount).toBe(learnerWonBefore);
    expect(afterDash.json.data.kpi.wonCount).toBe(totalWonBefore);
  });

  it('import without classId still creates active leads with an open task (regression)', async () => {
    const contract = await makeContract('active');
    const csv = `${header}\nLý Văn G,0911000051,g@corp.example,Học giao tiếp`;
    const commit = await command('u-lan', 'importContractLearners', {
      contractId: contract.id,
      csv,
      commit: true,
    });
    expect(commit.status, JSON.stringify(commit.json)).toBe(200);
    expect(commit.json.data.summary).toBeUndefined();
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM lead WHERE partner_contract_id = ? AND status = 'active' AND stage = 'new'",
        contract.id,
      ),
    ).toBe(1);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM task tk JOIN lead l ON l.id = tk.lead_id WHERE l.partner_contract_id = ? AND tk.status = 'open'",
        contract.id,
      ),
    ).toBe(1);
  });

  it('commits 200 generated rows with classId within limits', async () => {
    const contract = await makeContract('active');
    const { classId } = await makeClass('Lớp B2B 200');
    const rows = Array.from({ length: 200 }, (_, i) => {
      const idx = String(i + 1).padStart(3, '0');
      return `Nhân Viên ${idx},0922000${idx},nv${idx}@corp.example,Đào tạo doanh nghiệp`;
    });
    const csv = [header, ...rows].join('\n');

    const t0 = Date.now();
    const commit = await command('u-lan', 'importContractLearners', {
      contractId: contract.id,
      classId,
      csv,
      commit: true,
    });
    const elapsedMs = Date.now() - t0;
    expect(commit.status, JSON.stringify(commit.json)).toBe(200);
    expect(commit.json.data.summary).toEqual({
      newAccounts: 200,
      existingAccounts: 0,
      noEmail: 0,
      emailTaken: 0,
    });
    expect(elapsedMs).toBeLessThan(25_000);
    expect(await count("SELECT COUNT(*) AS n FROM enrollment WHERE class_id = ? AND status = 'confirmed'", classId)).toBe(200);
    expect(await count('SELECT COUNT(*) AS n FROM learner_account')).toBe(200);
  });

  it('flags duplicate email in file as email_taken, rejects phone/email mismatch across contacts, and bypasses another sale hold when lead is closed', async () => {
    const contract = await makeContract('active');
    const { classId } = await makeClass('Lớp B2B Edge');

    // u-huy holds a customer whose learner lead is won (closed)
    const huyLead = await command('u-huy', 'createLearnerLead', {
      contactName: 'Khách Của Huy',
      phone: '0911000061',
      source: 'facebook',
      needSummary: 'Học',
      nextAction: { title: 'Gọi', dueAt: new Date(Date.now() + 86_400_000).toISOString() },
    });
    expect(huyLead.status).toBe(200);
    await command('u-huy', 'closeLearnerLead', {
      leadId: huyLead.json.data.leadId,
      expectedVersion: 1,
      outcome: 'lost',
      reason: 'price',
    });

    // Contact 2 has an account with taken@corp.example
    const otherWon = await winLead('Khách Khác', '0911000062');
    await command('u-academic', 'createLearnerAccount', {
      contactId: otherWon.contactId,
      email: 'taken@corp.example',
    });

    // Contact 3 has an active learner lead (blocks import)
    await command('u-lan', 'createLearnerLead', {
      contactName: 'Khách Đang Mở',
      phone: '0911000063',
      source: 'facebook',
      needSummary: 'Học',
      nextAction: { title: 'Gọi', dueAt: new Date(Date.now() + 86_400_000).toISOString() },
    });

    const csv = [
      header,
      'Khách Của Huy,0911000061,dup@corp.example,Học', // reused despite u-huy hold, gets 'new' account
      'Nhân Viên Dup,0911000064,DUP@corp.example,Học', // second row with same email -> 'email_taken'
      'Lệch SĐT Email,0911000061,taken@corp.example,Học', // duplicate phone in file or mismatch
    ].join('\n');

    const csvClean = [
      header,
      'Khách Của Huy,0911000061,dup@corp.example,Học',
      'Nhân Viên Dup,0911000064,DUP@corp.example,Học',
      'Khách Đang Mở,0911000063,open@corp.example,Học',
    ].join('\n');
    const preview = await command('u-lan', 'importContractLearners', {
      contractId: contract.id,
      classId,
      csv: csvClean,
      commit: false,
    });
    expect(preview.status).toBe(200);
    expect(preview.json.data.summary).toEqual({
      newAccounts: 1,
      existingAccounts: 0,
      noEmail: 0,
      emailTaken: 1,
    });
    expect(preview.json.data.errors).toEqual([
      { line: 4, message: 'Khách đã có lead học viên đang mở' },
    ]);

    // Phone of u-huy's closed contact + email of otherWon's account -> mismatch error
    const mismatchCsv = `${header}\nKhách Của Huy,0911000061,taken@corp.example,Học`;
    const mismatch = await command('u-lan', 'importContractLearners', {
      contractId: contract.id,
      classId,
      csv: mismatchCsv,
      commit: false,
    });
    expect(mismatch.status).toBe(200);
    expect(mismatch.json.data.errors).toEqual([
      { line: 2, message: 'SĐT và email thuộc hai học viên khác nhau' },
    ]);
    void csv;
  });

  it('reports people already in the class or repeated in the file as row errors instead of failing the batch', async () => {
    const contract = await makeContract('active');
    const { classId } = await makeClass('Lớp B2B K3');
    const first = [header, 'Nguyễn Văn A,0911000001,a@corp.example,Học AI'].join('\n');
    const done = await command('u-lan', 'importContractLearners', { contractId: contract.id, classId, csv: first, commit: true });
    expect(done.status, JSON.stringify(done.json)).toBe(200);

    const again = [header, 'Nguyễn Văn A,0911000001,a@corp.example,Học AI', 'Trần Thị B,0911000002,,Học AI', 'Trần Thị B,0911000002,,Học AI'].join('\n');
    const r = await command('u-lan', 'importContractLearners', { contractId: contract.id, classId, csv: again, commit: true });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.data.errors.map((e: { message: string }) => e.message)).toContain('Học viên đã có trong lớp');
    expect(await count("SELECT COUNT(*) AS n FROM enrollment WHERE class_id = ? AND status = 'confirmed'", classId)).toBe(2);
  });
});

