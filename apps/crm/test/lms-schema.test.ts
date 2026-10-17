import { beforeEach, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import { addUser, db, makeClass } from './helpers/learner-fixtures';
import { resetDb } from './helpers/reset-db';

const STAMP = '2026-10-16T03:00:00.000Z';

beforeEach(async () => {
  await resetDb(db, seedSql);
  await addUser('u-academic', 'academic');
});

const insertLearnerAccount = (
  id: string,
  contactId: string,
  email: string,
  passwordHash: string | null,
  passwordSalt: string | null,
) =>
  db.prepare(`INSERT INTO learner_account (id, organization_id, contact_id, email, password_hash, password_salt, created_at, updated_at)
    VALUES (?, 'org-abm', ?, ?, ?, ?, ?, ?)`).bind(id, contactId, email, passwordHash, passwordSalt, STAMP, STAMP).run();

const insertProgram = (id: string, classId: string | null, title = 'Chương trình IELTS') =>
  db.prepare(`INSERT INTO lms_program (id, organization_id, class_id, title, created_at, updated_at)
    VALUES (?, 'org-abm', ?, ?, ?, ?)`).bind(id, classId, title, STAMP, STAMP).run();

const insertLesson = (id: string, programId: string, sectionId: string, position: number) =>
  db.prepare(`INSERT INTO lms_lesson (id, program_id, section_id, title, position, created_at, updated_at)
    VALUES (?, ?, ?, 'Bài học', ?, ?, ?)`).bind(id, programId, sectionId, position, STAMP, STAMP).run();

test('learner_account allows both password_hash and password_salt NULL', async () => {
  await insertLearnerAccount('la-1', 'ct-1', 'ct1@example.com', null, null);
  const row = await db.prepare("SELECT id, password_hash, password_salt FROM learner_account WHERE id = 'la-1'")
    .first<{ id: string; password_hash: string | null; password_salt: string | null }>();
  expect(row).toEqual({ id: 'la-1', password_hash: null, password_salt: null });
});

test('learner_account rejects password_hash set with password_salt NULL', async () => {
  await expect(insertLearnerAccount('la-2', 'ct-2', 'ct2@example.com', 'hash-only', null)).rejects.toThrow(/CHECK/);
});

test('lms_program enforces unique non-null class_id while allowing multiple NULL class_id rows', async () => {
  const { classId } = await makeClass();
  await insertProgram('lp-1', classId);
  await expect(insertProgram('lp-2', classId)).rejects.toThrow(/UNIQUE/);
  await insertProgram('lp-3', null);
  await insertProgram('lp-4', null);
  const count = await db.prepare('SELECT COUNT(*) AS n FROM lms_program').first<{ n: number }>();
  expect(count!.n).toBe(3);
});

test('lms_lesson enforces unique (program_id, section_id)', async () => {
  await insertProgram('lp-1', null);
  await insertLesson('ll-1', 'lp-1', 'b1p1', 0);
  await expect(insertLesson('ll-2', 'lp-1', 'b1p1', 1)).rejects.toThrow(/UNIQUE/);
});

test('org_setting exposes learner_default_password_hash column', async () => {
  const row = await db.prepare('SELECT learner_default_password_hash FROM org_setting LIMIT 1')
    .first<{ learner_default_password_hash: string | null }>();
  expect(row).toEqual({ learner_default_password_hash: null });
});
