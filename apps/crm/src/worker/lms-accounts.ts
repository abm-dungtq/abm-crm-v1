import {
  type CreateClassLearnerAccountsInput,
  type CreateLearnerAccountInput,
  type GrantProgramAccessInput,
  type ResetLearnerPasswordInput,
  type RevokeProgramAccessInput,
  type SetLearnerAccountStatusInput,
  type SetLearnerDefaultPasswordInput,
} from '@abm/contracts';
import { ACCESS_ENROLLMENT_STATUSES } from '@abm/lms-core';
import { fail, ok, type Ctx } from './command-result';
import type { Actor } from './env';
import type { GuardedTx } from './guarded-tx';
import { hashPassword } from './password';

export const LMS_STAFF = ['academic', 'admin', 'director'];

const ACCESS_STATUS_SQL = ACCESS_ENROLLMENT_STATUSES.map((s) => `'${s}'`).join(', ');

async function loadAccount(db: D1Database, organizationId: string, accountId: string) {
  return db.prepare('SELECT id, version, status FROM learner_account WHERE id = ? AND organization_id = ?')
    .bind(accountId, organizationId)
    .first<{ id: string; version: number; status: string }>();
}

function revokeAccountSessions(db: D1Database, tx: GuardedTx, accountId: string) {
  tx.raw(db.prepare('UPDATE learner_session SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL').bind(tx.now, accountId));
}

async function setLearnerDefaultPassword({ db, actor, input, tx }: Ctx<SetLearnerDefaultPasswordInput>) {
  const row = await db.prepare('SELECT id, version FROM org_setting WHERE organization_id = ?')
    .bind(actor.organizationId)
    .first<{ id: string; version: number }>();
  if (!row) return fail('NOT_FOUND', 'Chưa có cài đặt tổ chức');
  const stored = await hashPassword(input.password);
  tx.update('org_setting', row.id, row.version, {
    learner_default_password_hash: stored.hash,
    learner_default_password_salt: stored.salt,
    learner_default_password_iterations: stored.iterations,
  });
  tx.audit('org_setting', row.id, { learnerDefaultPassword: 'set' }, { learnerDefaultPassword: 'changed' });
  return ok({ id: row.id });
}

async function createLearnerAccount({ db, actor, input, tx }: Ctx<CreateLearnerAccountInput>) {
  const contact = await db.prepare('SELECT id, display_name FROM contact WHERE id = ? AND organization_id = ? AND archived_at IS NULL')
    .bind(input.contactId, actor.organizationId)
    .first<{ id: string; display_name: string }>();
  if (!contact) return fail('NOT_FOUND', 'Không tìm thấy học viên');

  const existingAccount = await db.prepare('SELECT id FROM learner_account WHERE contact_id = ?')
    .bind(contact.id)
    .first<{ id: string }>();
  if (existingAccount) return fail('DUPLICATE_SUSPECTED', 'Học viên đã có tài khoản học');

  const contactEmail = await db.prepare("SELECT value, normalized_value FROM contact_point WHERE contact_id = ? AND type = 'email' ORDER BY created_at LIMIT 1")
    .bind(contact.id)
    .first<{ value: string; normalized_value: string }>();

  const email = input.email
    ? input.email.trim().toLowerCase()
    : (contactEmail?.normalized_value ? contactEmail.normalized_value.trim().toLowerCase() : '');
  if (!email) {
    return fail('VALIDATION_FAILED', 'Học viên chưa có email', { fields: { email: 'Bắt buộc' } });
  }

  const emailOwner = await db.prepare('SELECT id FROM learner_account WHERE email = ?')
    .bind(email)
    .first<{ id: string }>();
  if (emailOwner) return fail('DUPLICATE_SUSPECTED', 'Email đã được dùng cho tài khoản học khác');

  if (input.email && !contactEmail) {
    tx.raw(db.prepare(`INSERT INTO contact_point (id, contact_id, type, value, normalized_value, created_at)
      SELECT ?1, ?2, 'email', ?3, ?4, ?5
      WHERE NOT EXISTS (
        SELECT 1 FROM contact_point cp JOIN contact c ON c.id = cp.contact_id
        WHERE cp.type = 'email' AND cp.normalized_value = ?4 AND c.organization_id = ?6 AND c.archived_at IS NULL
      )`).bind(crypto.randomUUID(), contact.id, input.email.trim(), email, tx.now, actor.organizationId));
  }

  const id = crypto.randomUUID();
  tx.insertVersioned('learner_account', {
    id,
    organization_id: actor.organizationId,
    contact_id: contact.id,
    email,
    status: 'active',
    created_by_user_id: actor.id,
  });
  tx.audit('learner_account', id, null, { email });
  return ok({ id, email });
}

async function createClassLearnerAccounts({ db, actor, input, tx }: Ctx<CreateClassLearnerAccountsInput>) {
  const klass = await db.prepare(`SELECT cg.id FROM class_group cg JOIN course co ON co.id = cg.course_id
    WHERE cg.id = ? AND co.organization_id = ?`)
    .bind(input.classId, actor.organizationId)
    .first<{ id: string }>();
  if (!klass) return fail('NOT_FOUND', 'Không tìm thấy lớp');

  const enrolled = await db.prepare(`SELECT c.id AS contact_id, c.display_name, la.id AS account_id,
      (SELECT cp.normalized_value FROM contact_point cp WHERE cp.contact_id = c.id AND cp.type = 'email' ORDER BY cp.created_at LIMIT 1) AS email
    FROM enrollment e
    JOIN contact c ON c.id = e.contact_id
    LEFT JOIN learner_account la ON la.contact_id = c.id
    WHERE e.class_id = ? AND e.organization_id = ? AND e.status IN (${ACCESS_STATUS_SQL}) AND c.archived_at IS NULL
    ORDER BY e.created_at, e.id
    LIMIT 500`)
    .bind(input.classId, actor.organizationId)
    .all<{ contact_id: string; display_name: string; account_id: string | null; email: string | null }>();

  const candidateEmails = [...new Set(
    enrolled.results
      .filter((r) => !r.account_id && r.email)
      .map((r) => r.email!.trim().toLowerCase())
      .filter(Boolean),
  )];

  const takenEmails = new Set<string>();
  if (candidateEmails.length > 0) {
    const existing = await db.prepare('SELECT email FROM learner_account WHERE email IN (SELECT value FROM json_each(?))')
      .bind(JSON.stringify(candidateEmails))
      .all<{ email: string }>();
    for (const r of existing.results) takenEmails.add(r.email.trim().toLowerCase());
  }

  let created = 0;
  const skippedNoEmail: string[] = [];
  const skippedEmailTaken: string[] = [];
  const seenContacts = new Set<string>();

  for (const row of enrolled.results) {
    if (seenContacts.has(row.contact_id)) continue;
    seenContacts.add(row.contact_id);
    if (row.account_id) continue;

    const email = row.email ? row.email.trim().toLowerCase() : '';
    if (!email) {
      skippedNoEmail.push(row.display_name);
      continue;
    }
    if (takenEmails.has(email)) {
      skippedEmailTaken.push(row.display_name);
      continue;
    }
    takenEmails.add(email);
    const id = crypto.randomUUID();
    tx.insertVersioned('learner_account', {
      id,
      organization_id: actor.organizationId,
      contact_id: row.contact_id,
      email,
      status: 'active',
      created_by_user_id: actor.id,
    });
    tx.audit('learner_account', id, null, { email });
    created++;
  }

  return ok({ created, skippedNoEmail, skippedEmailTaken });
}

async function resetLearnerPassword({ db, actor, input, tx }: Ctx<ResetLearnerPasswordInput>) {
  const row = await loadAccount(db, actor.organizationId, input.accountId);
  if (!row) return fail('NOT_FOUND', 'Không tìm thấy tài khoản học viên');
  if (row.version !== input.version) return fail('STALE_VERSION', 'Tài khoản vừa được người khác cập nhật. Tải lại rồi thử lại.');
  tx.update('learner_account', row.id, input.version, {
    password_hash: null,
    password_salt: null,
    password_iterations: null,
    password_changed_at: null,
    failed_login_count: 0,
    locked_until: null,
  });
  revokeAccountSessions(db, tx, row.id);
  tx.audit('learner_account', row.id, null, { password: 'reset_to_default' });
  return ok({ id: row.id, version: input.version + 1 });
}

async function setLearnerAccountStatus({ db, actor, input, tx }: Ctx<SetLearnerAccountStatusInput>) {
  const row = await loadAccount(db, actor.organizationId, input.accountId);
  if (!row) return fail('NOT_FOUND', 'Không tìm thấy tài khoản học viên');
  if (row.version !== input.version) return fail('STALE_VERSION', 'Tài khoản vừa được người khác cập nhật. Tải lại rồi thử lại.');
  tx.update('learner_account', row.id, input.version, { status: input.status });
  if (input.status === 'disabled') revokeAccountSessions(db, tx, row.id);
  tx.audit('learner_account', row.id, { status: row.status }, { status: input.status });
  return ok({ id: row.id, version: input.version + 1 });
}

async function grantProgramAccess({ db, actor, input, tx }: Ctx<GrantProgramAccessInput>) {
  const contact = await db.prepare('SELECT id FROM contact WHERE id = ? AND organization_id = ? AND archived_at IS NULL')
    .bind(input.contactId, actor.organizationId)
    .first<{ id: string }>();
  if (!contact) return fail('NOT_FOUND', 'Không tìm thấy học viên');

  const program = await db.prepare('SELECT id FROM lms_program WHERE id = ? AND organization_id = ?')
    .bind(input.programId, actor.organizationId)
    .first<{ id: string }>();
  if (!program) return fail('NOT_FOUND', 'Không tìm thấy chương trình học');

  let expiresAt: string | null = null;
  if (input.expiresAt !== undefined) {
    expiresAt = new Date(input.expiresAt).toISOString();
    if (expiresAt <= tx.now) {
      return fail('VALIDATION_FAILED', 'Thời điểm hết hạn phải ở tương lai', { fields: { expiresAt: 'Không hợp lệ' } });
    }
  }

  const id = crypto.randomUUID();
  const note = input.note ?? null;
  tx.insertVersioned('lms_access', {
    id,
    organization_id: actor.organizationId,
    contact_id: input.contactId,
    program_id: input.programId,
    mode: input.mode,
    expires_at: expiresAt,
    note,
    created_by_user_id: actor.id,
  });
  tx.audit('lms_access', id, null, {
    contactId: input.contactId,
    programId: input.programId,
    mode: input.mode,
    expiresAt,
    note,
  });
  return ok({ id, version: 1 });
}

async function revokeProgramAccess({ db, actor, input, tx }: Ctx<RevokeProgramAccessInput>) {
  const row = await db.prepare('SELECT id, version, revoked_at FROM lms_access WHERE id = ? AND organization_id = ?')
    .bind(input.accessId, actor.organizationId)
    .first<{ id: string; version: number; revoked_at: string | null }>();
  if (!row) return fail('NOT_FOUND', 'Không tìm thấy quyền truy cập');
  if (row.revoked_at) return fail('DUPLICATE_SUSPECTED', 'Quyền truy cập này đã được thu hồi');
  if (row.version !== input.version) return fail('STALE_VERSION', 'Quyền truy cập vừa được người khác cập nhật. Tải lại rồi thử lại.');
  tx.update('lms_access', row.id, input.version, { revoked_at: tx.now });
  tx.audit('lms_access', row.id, { revoked_at: row.revoked_at }, { revoked_at: tx.now });
  return ok({ id: row.id, version: input.version + 1 });
}

export const lmsAccountHandlers = {
  setLearnerDefaultPassword,
  createLearnerAccount,
  createClassLearnerAccounts,
  resetLearnerPassword,
  setLearnerAccountStatus,
  grantProgramAccess,
  revokeProgramAccess,
};

export interface LearnerAccountProgramItem {
  programId: string;
  title: string;
  className: string | null;
  via: 'enrollment' | 'grant';
  accessId?: string;
  accessVersion?: number;
  mode?: 'grant' | 'block';
}

export async function listLearnerAccounts(
  db: D1Database,
  actor: Actor,
  filters: { q?: string; classId?: string; passwordState?: string; limit?: number } = {},
) {
  const where = ['la.organization_id = ?'];
  const binds: unknown[] = [actor.organizationId];

  const term = filters.q?.trim().replace(/[%_]/g, '') ?? '';
  if (term) {
    where.push('(c.display_name LIKE ? OR la.email LIKE ?)');
    binds.push(`%${term}%`, `%${term}%`);
  }

  if (filters.classId) {
    where.push(`(EXISTS (
      SELECT 1 FROM enrollment e
      WHERE e.contact_id = la.contact_id AND e.class_id = ? AND e.status IN (${ACCESS_STATUS_SQL})
    ) OR EXISTS (
      SELECT 1 FROM lms_access a JOIN lms_program p ON p.id = a.program_id
      WHERE a.contact_id = la.contact_id AND p.class_id = ? AND a.revoked_at IS NULL
    ))`);
    binds.push(filters.classId, filters.classId);
  }

  if (filters.passwordState === 'default') {
    where.push('la.password_hash IS NULL');
  } else if (filters.passwordState === 'changed') {
    where.push('la.password_hash IS NOT NULL');
  }

  const rawLimit = filters.limit && Number.isFinite(filters.limit) ? Math.floor(filters.limit) : 100;
  const limit = Math.min(Math.max(rawLimit, 1), 200);
  binds.push(limit);

  const accounts = await db.prepare(`SELECT la.id, la.version, la.contact_id, c.display_name, la.email, la.status,
      la.password_hash IS NULL AS uses_default_password, la.last_login_at, la.locked_until
    FROM learner_account la
    JOIN contact c ON c.id = la.contact_id
    WHERE ${where.join(' AND ')}
    ORDER BY c.display_name, la.email
    LIMIT ?`)
    .bind(...binds)
    .all<{
      id: string;
      version: number;
      contact_id: string;
      display_name: string;
      email: string;
      status: 'active' | 'disabled';
      uses_default_password: number;
      last_login_at: string | null;
      locked_until: string | null;
    }>();

  if (accounts.results.length === 0) return [];

  const contactIdsJson = JSON.stringify(accounts.results.map((a) => a.contact_id));
  const nowIso = new Date().toISOString();

  const [enrolledRows, accessRows] = await Promise.all([
    db.prepare(`SELECT e.contact_id, p.id AS program_id, p.title, cg.name AS class_name
      FROM enrollment e
      JOIN class_group cg ON cg.id = e.class_id
      JOIN lms_program p ON p.class_id = cg.id
      WHERE e.organization_id = ?
        AND e.contact_id IN (SELECT value FROM json_each(?))
        AND e.status IN (${ACCESS_STATUS_SQL})
      ORDER BY cg.name, p.title`)
      .bind(actor.organizationId, contactIdsJson)
      .all<{ contact_id: string; program_id: string; title: string; class_name: string }>(),
    db.prepare(`SELECT a.id AS access_id, a.version AS access_version, a.contact_id, a.program_id, a.mode,
        p.title, cg.name AS class_name
      FROM lms_access a
      JOIN lms_program p ON p.id = a.program_id
      LEFT JOIN class_group cg ON cg.id = p.class_id
      WHERE a.organization_id = ?
        AND a.contact_id IN (SELECT value FROM json_each(?))
        AND a.revoked_at IS NULL
        AND (a.expires_at IS NULL OR a.expires_at > ?)
      ORDER BY a.created_at, a.id`)
      .bind(actor.organizationId, contactIdsJson, nowIso)
      .all<{
        access_id: string;
        access_version: number;
        contact_id: string;
        program_id: string;
        mode: 'grant' | 'block';
        title: string;
        class_name: string | null;
      }>(),
  ]);

  const programsByContact = new Map<string, LearnerAccountProgramItem[]>();
  const seenEnrollmentProgram = new Set<string>();

  for (const row of enrolledRows.results) {
    const key = `${row.contact_id}:${row.program_id}`;
    if (seenEnrollmentProgram.has(key)) continue;
    seenEnrollmentProgram.add(key);
    const list = programsByContact.get(row.contact_id) ?? [];
    list.push({
      programId: row.program_id,
      title: row.title,
      className: row.class_name,
      via: 'enrollment',
    });
    programsByContact.set(row.contact_id, list);
  }

  for (const row of accessRows.results) {
    const list = programsByContact.get(row.contact_id) ?? [];
    list.push({
      programId: row.program_id,
      title: row.title,
      className: row.class_name,
      via: 'grant',
      accessId: row.access_id,
      accessVersion: row.access_version,
      mode: row.mode,
    });
    programsByContact.set(row.contact_id, list);
  }

  return accounts.results.map((row) => ({
    id: row.id,
    version: row.version,
    contactId: row.contact_id,
    displayName: row.display_name,
    email: row.email,
    status: row.status,
    usesDefaultPassword: Boolean(row.uses_default_password),
    lastLoginAt: row.last_login_at,
    lockedUntil: row.locked_until,
    programs: programsByContact.get(row.contact_id) ?? [],
  }));
}

export async function learnerAccountSettings(db: D1Database, actor: Actor) {
  const row = await db.prepare('SELECT learner_default_password_hash FROM org_setting WHERE organization_id = ?')
    .bind(actor.organizationId)
    .first<{ learner_default_password_hash: string | null }>();
  return { hasDefaultPassword: Boolean(row?.learner_default_password_hash) };
}
