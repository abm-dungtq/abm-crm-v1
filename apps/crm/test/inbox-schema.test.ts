import { env } from 'cloudflare:test';
import { beforeEach, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
const STAMP = '2026-10-08T03:00:00.000Z';

beforeEach(async () => {
  await resetDb(db, seedSql);
  await db.batch([
    db.prepare(`INSERT INTO channel_account (id, organization_id, channel, external_id, display_name, created_at, updated_at)
      VALUES ('ca-1', 'org-abm', 'zalo', 'zalo-uid-1', 'Số chung 1', ?, ?)`).bind(STAMP, STAMP),
    db.prepare(`INSERT INTO conversation (id, organization_id, channel_account_id, kind, external_thread_id, created_at, updated_at)
      VALUES ('cv-1', 'org-abm', 'ca-1', 'direct', 'thread-1', ?, ?)`).bind(STAMP, STAMP),
  ]);
});

const insertMessage = (id: string, externalMsgId: string | null) =>
  db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, external_msg_id, body, status, created_at)
    VALUES (?, 'cv-1', 'in', 'customer', ?, 'xin chào', 'received', ?)`).bind(id, externalMsgId, STAMP).run();

const insertContactPoint = (id: string, type: string) =>
  db.prepare(`INSERT INTO contact_point (id, contact_id, type, value, normalized_value, created_at)
    VALUES (?, 'ct-1', ?, 'uid-123', 'uid-123', ?)`).bind(id, type, STAMP).run();

test('a channel message id is stored once per conversation', async () => {
  await insertMessage('m-1', 'ext-1');
  await expect(insertMessage('m-2', 'ext-1')).rejects.toThrow(/UNIQUE/);
  await insertMessage('m-3', null);
  await insertMessage('m-4', null);
  const n = await db.prepare("SELECT COUNT(*) AS n FROM message WHERE conversation_id = 'cv-1'").first<{ n: number }>();
  expect(n!.n).toBe(3);
});

test('conversation mode only accepts ai, human or paused', async () => {
  const mode = await db.prepare("SELECT mode FROM conversation WHERE id = 'cv-1'").first<{ mode: string }>();
  expect(mode!.mode).toBe('ai');
  await expect(db.prepare(`INSERT INTO conversation (id, organization_id, channel_account_id, kind, external_thread_id, mode, created_at, updated_at)
    VALUES ('cv-2', 'org-abm', 'ca-1', 'direct', 'thread-2', 'other', ?, ?)`).bind(STAMP, STAMP).run()).rejects.toThrow(/CHECK/);
  await expect(db.prepare("UPDATE conversation SET mode = 'other' WHERE id = 'cv-1'").run()).rejects.toThrow(/CHECK/);
});

test('contact points accept Zalo and Facebook ids but no other new type', async () => {
  await insertContactPoint('cp-zalo', 'zalo_uid');
  await insertContactPoint('cp-fb', 'fb_psid');
  await expect(insertContactPoint('cp-fax', 'fax')).rejects.toThrow(/CHECK/);
  const types = await db.prepare("SELECT type FROM contact_point WHERE id IN ('cp-zalo', 'cp-fb', 'cp-fax') ORDER BY type").all<{ type: string }>();
  expect(types.results.map((r) => r.type)).toEqual(['fb_psid', 'zalo_uid']);
  const index = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'contact_point_lookup'").first();
  expect(index).not.toBeNull();
});

test('the customer bot switch has exactly one row and starts off', async () => {
  const rows = await db.prepare('SELECT id, enabled FROM customer_bot_switch').all<{ id: number; enabled: number }>();
  expect(rows.results).toEqual([{ id: 1, enabled: 0 }]);
  await expect(db.prepare('INSERT INTO customer_bot_switch (id, enabled) VALUES (2, 0)').run()).rejects.toThrow(/CHECK/);
});
