import { env } from 'cloudflare:test';
import { beforeEach, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
const STAMP = '2026-10-14T03:00:00.000Z';

beforeEach(() => resetDb(db, seedSql));

const insertAccount = (id: string, channel: string) =>
  db.prepare(`INSERT INTO channel_account (id, organization_id, channel, external_id, display_name, created_at, updated_at)
    VALUES (?, 'org-abm', ?, ?, 'OA ABM', ?, ?)`).bind(id, channel, `${channel}-ext`, STAMP, STAMP).run();

test('a zalo_oa account and a send_zalo_oa command are stored', async () => {
  await insertAccount('ca-oa', 'zalo_oa');
  await db.prepare(`INSERT INTO channel_command (id, kind, target, channel_account_id, payload_json, next_run_at, created_at, updated_at)
    VALUES ('cmd-oa', 'send_zalo_oa', 'worker', 'ca-oa', '{}', ?, ?, ?)`).bind(STAMP, STAMP, STAMP).run();
  expect(await db.prepare("SELECT channel, registration_policy, registration_group_url FROM channel_account WHERE id = 'ca-oa'").first())
    .toEqual({ channel: 'zalo_oa', registration_policy: 0, registration_group_url: null });
  await db.prepare("UPDATE channel_account SET registration_group_url = ? WHERE id = 'ca-oa'")
    .bind('https://zalo.me/g/abc123').run();
  expect(await db.prepare("SELECT registration_group_url FROM channel_account WHERE id = 'ca-oa'").first())
    .toEqual({ registration_group_url: 'https://zalo.me/g/abc123' });
  expect(await db.prepare("SELECT kind, target FROM channel_command WHERE id = 'cmd-oa'").first())
    .toEqual({ kind: 'send_zalo_oa', target: 'worker' });
});

test('channel rejects a value outside zalo, facebook and zalo_oa', async () => {
  await expect(insertAccount('ca-other', 'other')).rejects.toThrow(/CHECK/);
});

test('a rebuilt account still accepts a conversation and a cascading staff row', async () => {
  await insertAccount('ca-oa', 'zalo_oa');
  await db.prepare(`INSERT INTO conversation (id, organization_id, channel_account_id, kind, external_thread_id, created_at, updated_at)
    VALUES ('cv-oa', 'org-abm', 'ca-oa', 'direct', 'thread-oa', ?, ?)`).bind(STAMP, STAMP).run();
  await db.prepare(`INSERT INTO zalo_staff_member (channel_account_id, external_user_id, display_name, created_at)
    VALUES ('ca-oa', 'staff-1', 'Nhân viên', ?)`).bind(STAMP).run();
  expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);

  // conversation and channel_command reference the account with NO ACTION, so the row stays.
  await expect(db.prepare("DELETE FROM channel_account WHERE id = 'ca-oa'").run()).rejects.toThrow(/FOREIGN KEY/);
  expect(await db.prepare("SELECT id FROM conversation WHERE id = 'cv-oa'").first()).toEqual({ id: 'cv-oa' });
  expect(await db.prepare("SELECT external_user_id FROM zalo_staff_member WHERE channel_account_id = 'ca-oa'").first())
    .toEqual({ external_user_id: 'staff-1' });

  await db.prepare("DELETE FROM conversation WHERE id = 'cv-oa'").run();
  await db.prepare("DELETE FROM channel_account WHERE id = 'ca-oa'").run();
  expect(await db.prepare("SELECT COUNT(*) AS n FROM zalo_staff_member WHERE channel_account_id = 'ca-oa'").first())
    .toEqual({ n: 0 });
  expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
});

test('contact_point accepts zalo_oa_uid and lead stores product_id and course_id', async () => {
  await db.batch([
    db.prepare(`INSERT INTO product (id, organization_id, name, price_vnd, active, created_at, updated_at)
      VALUES ('pr-1', 'org-abm', 'Khóa AI 199K', 199000, 1, ?1, ?1)`).bind(STAMP),
    db.prepare(`INSERT INTO course (id, organization_id, product_id, name, status, created_at, updated_at)
      VALUES ('co-1', 'org-abm', 'pr-1', 'AI Cơ bản K1', 'active', ?1, ?1)`).bind(STAMP),
    db.prepare(`INSERT INTO contact_point (id, contact_id, type, value, normalized_value, is_primary, created_at)
      VALUES ('cp-oa-1', 'ct-1', 'zalo_oa_uid', 'oa-user-123', 'oa-user-123', 0, ?1)`).bind(STAMP),
    db.prepare("UPDATE lead SET product_id = 'pr-1', course_id = 'co-1' WHERE id = 'ld-1'"),
  ]);
  expect(await db.prepare("SELECT type, value FROM contact_point WHERE id = 'cp-oa-1'").first())
    .toEqual({ type: 'zalo_oa_uid', value: 'oa-user-123' });
  expect(await db.prepare("SELECT product_id, course_id FROM lead WHERE id = 'ld-1'").first())
    .toEqual({ product_id: 'pr-1', course_id: 'co-1' });
  await expect(
    db.prepare(`INSERT INTO contact_point (id, contact_id, type, value, normalized_value, is_primary, created_at)
      VALUES ('cp-bad', 'ct-1', 'telegram_uid', 'tg-1', 'tg-1', 0, ?)`).bind(STAMP).run(),
  ).rejects.toThrow(/CHECK/);
  expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
});

