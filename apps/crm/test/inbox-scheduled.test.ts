import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import worker from '../src/worker/index';
import { enqueueCommand } from '../src/worker/inbox/dispatcher';
import { runScheduled } from '../src/worker/inbox/scheduled';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
const STAMP = '2026-10-08T03:00:00.000Z';
const APP_URL = 'https://crm.example';
const lark = { LARK_APP_ID: 'cli_fake', LARK_APP_SECRET: 'fake-secret-value-123', LARK_INBOX_CHAT_ID: 'oc_inbox' };

beforeEach(async () => {
  await resetDb(db, seedSql);
  await db.batch([
    db.prepare(`INSERT INTO channel_account (id, organization_id, channel, external_id, display_name, agent_key, status, created_at, updated_at)
      VALUES ('ca-1', 'org-abm', 'zalo', 'zalo-acc-1', 'Số tư vấn 1', 'sales-bot', 'connected', ?, ?)`).bind(STAMP, STAMP),
    db.prepare(`INSERT INTO conversation (id, organization_id, channel_account_id, kind, external_thread_id, display_name, mode,
        assignee_user_id, created_at, updated_at)
      VALUES ('conv-1', 'org-abm', 'ca-1', 'direct', 'cust-1', 'Chị Hoa', 'human', 'u-lan', ?, ?)`).bind(STAMP, STAMP),
  ]);
});
afterEach(() => vi.restoreAllMocks());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
/** Fakes Lark: the token call succeeds and every message text is recorded. */
function fakeLark() {
  const sent: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/auth/v3/tenant_access_token/internal')) return json({ code: 0, tenant_access_token: 't-fake', expire: 7200 });
    if (url.includes('/im/v1/messages')) {
      sent.push(JSON.parse((JSON.parse(String(init!.body)) as { content: string }).content).text);
      return json({ code: 0, data: {} });
    }
    return json({ code: 404 }, 404);
  });
  return sent;
}

const scheduledEnv = { ...env, ...lark, APP_URL };
const reminders = () => db.prepare("SELECT * FROM channel_command WHERE kind = 'send_lark' AND dedupe_key LIKE 'sla:%'").all<any>().then((r) => r.results);
const slaDueAt = () => db.prepare("SELECT sla_due_at FROM conversation WHERE id = 'conv-1'").first<{ sla_due_at: string | null }>().then((r) => r?.sla_due_at);

test('an overdue human conversation gets one Lark reminder and a new deadline', async () => {
  const sent = fakeLark();
  const due = new Date(Date.now() - 60_000).toISOString();
  await db.prepare("UPDATE conversation SET sla_due_at = ? WHERE id = 'conv-1'").bind(due).run();

  const before = Date.now();
  await runScheduled(scheduledEnv, '* * * * *');
  const [reminder] = await reminders();
  expect(await reminders()).toHaveLength(1);
  expect(reminder).toMatchObject({ target: 'worker', conversation_id: 'conv-1', dedupe_key: `sla:conv-1:${due}` });
  expect(JSON.parse(reminder.payload_json)).toEqual({ text: `Quá hạn trả lời: Chị Hoa (Số tư vấn 1) – Đỗ Ngọc Lan – ${APP_URL}/inbox/conv-1` });
  expect(Date.parse((await slaDueAt())!)).toBeGreaterThanOrEqual(before + 15 * 60_000);

  // Run again right away: the deadline is in the future, so nothing new is queued; the reminder itself is sent.
  await runScheduled(scheduledEnv, '* * * * *');
  expect(await reminders()).toHaveLength(1);
  expect(sent).toEqual([`Quá hạn trả lời: Chị Hoa (Số tư vấn 1) – Đỗ Ngọc Lan – ${APP_URL}/inbox/conv-1`]);
  expect((await reminders())[0].status).toBe('done');
});

test('conversations not in human mode or without a deadline are not reminded', async () => {
  fakeLark();
  const past = new Date(Date.now() - 60_000).toISOString();
  await db.prepare("UPDATE conversation SET mode = 'ai', sla_due_at = ? WHERE id = 'conv-1'").bind(past).run();
  await runScheduled(scheduledEnv, '* * * * *');
  await db.prepare("UPDATE conversation SET mode = 'human', sla_due_at = NULL WHERE id = 'conv-1'").run();
  await runScheduled(scheduledEnv, '* * * * *');
  expect(await reminders()).toHaveLength(0);
});

test('the daily cron does none of the per-minute work', async () => {
  const sent = fakeLark();
  await db.prepare("UPDATE conversation SET sla_due_at = ? WHERE id = 'conv-1'").bind(new Date(Date.now() - 60_000).toISOString()).run();
  await enqueueCommand(db, { kind: 'send_lark', target: 'worker', payload: { text: 'Chờ gửi' } });
  await runScheduled(scheduledEnv, '0 14 * * *');
  expect(await reminders()).toHaveLength(0);
  expect(sent).toEqual([]);
});

test('outgoing messages stuck in pending without a live send command are marked failed', async () => {
  const old = new Date(Date.now() - 16 * 60_000).toISOString();
  const recent = new Date(Date.now() - 5 * 60_000).toISOString();
  const insert = (id: string, createdAt: string, direction = 'out', status = 'pending') =>
    db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, body, status, created_at)
      VALUES (?, 'conv-1', ?, ?, 'Nội dung', ?, ?)`).bind(id, direction, direction === 'out' ? 'staff_web' : 'customer', status, createdAt);
  await db.batch([
    insert('m-orphan', old), insert('m-gave-up', old), insert('m-queued', old), insert('m-recent', recent),
    insert('m-sent', old, 'out', 'sent'), insert('m-in', old, 'in', 'received'),
  ]);
  const gaveUp = await enqueueCommand(db, { kind: 'send_zalo', target: 'bridge', channelAccountId: 'ca-1', payload: { messageId: 'm-gave-up' } });
  await db.prepare("UPDATE channel_command SET status = 'failed' WHERE id = ?").bind(gaveUp).run();
  await enqueueCommand(db, { kind: 'send_zalo', target: 'bridge', channelAccountId: 'ca-1', payload: { messageId: 'm-queued' } });

  await runScheduled(scheduledEnv, '* * * * *');
  const rows = await db.prepare("SELECT id, status FROM message WHERE conversation_id = 'conv-1' ORDER BY id").all<{ id: string; status: string }>();
  expect(Object.fromEntries(rows.results.map((r) => [r.id, r.status]))).toEqual({
    'm-orphan': 'failed', 'm-gave-up': 'failed', 'm-queued': 'pending', 'm-recent': 'pending', 'm-sent': 'sent', 'm-in': 'received',
  });
});

test('the scheduled handler hands its work to waitUntil and never rejects when the database fails', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const broken = { ...scheduledEnv, DB: { prepare: () => { throw new Error('d1 down'); } } as unknown as D1Database };
  await expect(runScheduled(broken, '* * * * *')).resolves.toBeUndefined();
  expect(errors).toHaveBeenCalled();

  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException: () => undefined } as unknown as ExecutionContext;
  const event = { cron: '* * * * *', scheduledTime: Date.now(), noRetry: () => undefined } as unknown as ScheduledController;
  fakeLark();
  await db.prepare("UPDATE conversation SET sla_due_at = ? WHERE id = 'conv-1'").bind(new Date(Date.now() - 60_000).toISOString()).run();
  worker.scheduled(event, { ...env, ...lark } as never, ctx);
  expect(pending).toHaveLength(1);
  await pending[0];
  expect(await reminders()).toHaveLength(1);
});
