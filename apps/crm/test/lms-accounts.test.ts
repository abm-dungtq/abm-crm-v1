import { beforeEach, describe, expect, it } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import { addUser, command, db, get, grantConsent, makeClass, makeLead, reserve, winLead } from './helpers/learner-fixtures';
import { resetDb } from './helpers/reset-db';

beforeEach(async () => {
  await resetDb(db, seedSql);
  await addUser('u-academic', 'academic');
});

async function enrollAndConfirm(name: string, phone: string, classId: string, email?: string) {
  const won = await winLead(name, phone);
  if (email) {
    await db.prepare(`INSERT INTO contact_point (id, contact_id, type, value, normalized_value, created_at)
      VALUES (?, ?, 'email', ?, ?, '2026-01-01T00:00:00.000Z')`)
      .bind(crypto.randomUUID(), won.contactId, email, email.trim().toLowerCase())
      .run();
  }
  const enrollmentId = await reserve(won.leadId, classId);
  expect((await grantConsent(won.contactId)).status).toBe(200);
  const confirmed = await command('u-academic', 'confirmEnrollment', { enrollmentId, version: 1 });
  expect(confirmed.status, JSON.stringify(confirmed.json)).toBe(200);
  return won.contactId;
}

describe('LMS learner accounts and access', () => {
  it('admin sets default password -> 200 and hash not null; academic -> 403', async () => {
    const beforeSettings = await get('u-academic', '/lms/settings');
    expect(beforeSettings.status).toBe(200);
    expect(beforeSettings.json.data).toEqual({ hasDefaultPassword: false });

    const forbidden = await command('u-academic', 'setLearnerDefaultPassword', { password: 'password123' });
    expect(forbidden.status).toBe(403);
    expect(forbidden.json.error?.code).toBe('FORBIDDEN');

    const res = await command('u-admin', 'setLearnerDefaultPassword', { password: 'password123' });
    expect(res.status, JSON.stringify(res.json)).toBe(200);

    const row = await db.prepare('SELECT learner_default_password_hash FROM org_setting WHERE organization_id = ?')
      .bind('org-abm')
      .first<{ learner_default_password_hash: string | null }>();
    expect(row?.learner_default_password_hash).not.toBeNull();

    const afterSettings = await get('u-academic', '/lms/settings');
    expect(afterSettings.status).toBe(200);
    expect(afterSettings.json.data).toEqual({ hasDefaultPassword: true });
  });

  it('createLearnerAccount for a contact with email given -> 200; duplicate contact or email -> 409 DUPLICATE_SUSPECTED', async () => {
    const first = await makeLead('Nguyễn Văn An', '0912000101');
    const second = await makeLead('Trần Thị Bình', '0912000102');

    const created = await command('u-academic', 'createLearnerAccount', {
      contactId: first.contactId,
      email: '  An.Nguyen@Example.com ',
    });
    expect(created.status, JSON.stringify(created.json)).toBe(200);
    expect(created.json.data.email).toBe('an.nguyen@example.com');

    const cp = await db.prepare("SELECT value, normalized_value FROM contact_point WHERE contact_id = ? AND type = 'email'")
      .bind(first.contactId)
      .first<{ value: string; normalized_value: string }>();
    expect(cp?.normalized_value).toBe('an.nguyen@example.com');

    const dupContact = await command('u-academic', 'createLearnerAccount', {
      contactId: first.contactId,
      email: 'other@example.com',
    });
    expect(dupContact.status).toBe(409);
    expect(dupContact.json.error?.code).toBe('DUPLICATE_SUSPECTED');

    const dupEmail = await command('u-academic', 'createLearnerAccount', {
      contactId: second.contactId,
      email: 'an.nguyen@example.com',
    });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.json.error?.code).toBe('DUPLICATE_SUSPECTED');
  });

  it('contact without email and no input email -> 422 VALIDATION_FAILED', async () => {
    const lead = await makeLead('Lê Văn Cường', '0912000103');
    const res = await command('u-academic', 'createLearnerAccount', {
      contactId: lead.contactId,
    });
    expect(res.status).toBe(422);
    expect(res.json.error?.code).toBe('VALIDATION_FAILED');
    expect(res.json.error?.fields?.email).toBe('Bắt buộc');
  });

  it('createClassLearnerAccounts on a class with 2 confirmed enrollments (one with email, one without) -> created: 1, skippedNoEmail length 1', async () => {
    const { classId } = await makeClass('Lớp LMS 1');
    await enrollAndConfirm('Phạm Văn Dũng', '0912000104', classId, 'dung@example.com');
    await enrollAndConfirm('Hoàng Thị Em', '0912000105', classId);

    const res = await command('u-academic', 'createClassLearnerAccounts', { classId });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data).toEqual({
      created: 1,
      skippedNoEmail: ['Hoàng Thị Em'],
      skippedEmailTaken: [],
    });
  });

  it('createClassLearnerAccounts dedupes duplicate emails inside the same batch without failing', async () => {
    const { classId } = await makeClass('Lớp LMS Trùng Email');
    await enrollAndConfirm('Học Viên 1', '0912000106', classId, 'shared@example.com');
    await enrollAndConfirm('Học Viên 2', '0912000107', classId, 'SHARED@example.com');

    const res = await command('u-academic', 'createClassLearnerAccounts', { classId });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.data).toEqual({
      created: 1,
      skippedNoEmail: [],
      skippedEmailTaken: ['Học Viên 2'],
    });
  });

  it('resetLearnerPassword sets hash NULL and revokes a manually inserted learner_session row', async () => {
    const lead = await makeLead('Vũ Thị Phương', '0912000108');
    const created = await command('u-academic', 'createLearnerAccount', {
      contactId: lead.contactId,
      email: 'phuong@example.com',
    });
    expect(created.status).toBe(200);
    const accountId = created.json.data.id as string;

    await db.prepare(`UPDATE learner_account
      SET password_hash = 'hash-1', password_salt = 'salt-1', password_iterations = 50000,
          password_changed_at = '2026-02-01T00:00:00.000Z', failed_login_count = 3
      WHERE id = ?`).bind(accountId).run();
    await db.prepare(`INSERT INTO learner_session (id_hash, account_id, created_at, expires_at, revoked_at)
      VALUES ('sess-hash-1', ?, '2026-02-01T00:00:00.000Z', '2099-02-01T00:00:00.000Z', NULL)`).bind(accountId).run();

    const reset = await command('u-academic', 'resetLearnerPassword', { accountId, version: 1 });
    expect(reset.status, JSON.stringify(reset.json)).toBe(200);
    expect(reset.json.data.version).toBe(2);

    const acc = await db.prepare('SELECT password_hash, password_salt, password_iterations, failed_login_count FROM learner_account WHERE id = ?')
      .bind(accountId)
      .first<{ password_hash: string | null; password_salt: string | null; password_iterations: number | null; failed_login_count: number }>();
    expect(acc).toEqual({
      password_hash: null,
      password_salt: null,
      password_iterations: null,
      failed_login_count: 0,
    });

    const session = await db.prepare('SELECT revoked_at FROM learner_session WHERE id_hash = ?')
      .bind('sess-hash-1')
      .first<{ revoked_at: string | null }>();
    expect(session?.revoked_at).not.toBeNull();
  });

  it('grant then revoke access; GET /lms/accounts shows the grant only while live and normalises expiresAt', async () => {
    const { classId } = await makeClass('Lớp Chương Trình');
    const lead = await makeLead('Đỗ Quang Huy', '0912000109');
    const created = await command('u-academic', 'createLearnerAccount', {
      contactId: lead.contactId,
      email: 'huy@example.com',
    });
    expect(created.status).toBe(200);

    const programId = 'prog-test-1';
    await db.prepare(`INSERT INTO lms_program (id, organization_id, class_id, title, content_version, created_at, updated_at, version)
      VALUES (?, 'org-abm', ?, 'Chương trình BSR', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 1)`)
      .bind(programId, classId)
      .run();

    const granted = await command('u-academic', 'grantProgramAccess', {
      contactId: lead.contactId,
      programId,
      mode: 'grant',
      expiresAt: '2099-05-01T19:00:00+07:00',
      note: 'Học bù',
    });
    expect(granted.status, JSON.stringify(granted.json)).toBe(200);
    const accessId = granted.json.data.id as string;

    const accessRow = await db.prepare('SELECT expires_at FROM lms_access WHERE id = ?')
      .bind(accessId)
      .first<{ expires_at: string | null }>();
    expect(accessRow?.expires_at).toBe('2099-05-01T12:00:00.000Z');

    const listedWhileLive = await get('u-academic', '/lms/accounts');
    expect(listedWhileLive.status).toBe(200);
    const itemLive = (listedWhileLive.json.data as any[]).find((a) => a.contactId === lead.contactId);
    expect(itemLive?.programs).toEqual([
      {
        programId,
        title: 'Chương trình BSR',
        className: 'Lớp Chương Trình',
        via: 'grant',
        accessId,
        accessVersion: 1,
        mode: 'grant',
      },
    ]);

    const revoked = await command('u-academic', 'revokeProgramAccess', { accessId, version: 1 });
    expect(revoked.status, JSON.stringify(revoked.json)).toBe(200);

    const listedAfterRevoke = await get('u-academic', '/lms/accounts');
    expect(listedAfterRevoke.status).toBe(200);
    const itemAfter = (listedAfterRevoke.json.data as any[]).find((a) => a.contactId === lead.contactId);
    expect(itemAfter?.programs).toEqual([]);
  });

  it('sale user calling GET /lms/accounts -> 403', async () => {
    const res = await get('u-lan', '/lms/accounts');
    expect(res.status).toBe(403);
    expect(res.json.error?.code).toBe('FORBIDDEN');
  });
});
