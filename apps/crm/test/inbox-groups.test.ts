import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';
import { claimCommands, enqueueCommand } from '../src/worker/inbox/dispatcher';
import { computeNextRun, runDueSchedules, vnDate } from '../src/worker/inbox/group-schedules';
import { ingestEvents } from '../src/worker/inbox/ingest';
import { runScheduled } from '../src/worker/inbox/scheduled';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
const ORIGIN = 'http://crm.test';
const STAMP = '2026-10-08T03:00:00.000Z';
const SECRET = 'test-bridge-secret';
const lark = { LARK_APP_ID: 'cli_fake', LARK_APP_SECRET: 'fake-secret-value-123', LARK_INBOX_CHAT_ID: 'oc_inbox' };
const testEnv = { ...env, ...lark, DEMO_MODE: '1', BRIDGE_SECRET: SECRET };
const zero = () => 0;
/** Monday 2026-10-12, 10:00 Vietnam time. */
const MONDAY_10 = new Date('2026-10-12T03:00:00.000Z');

beforeEach(async () => {
  await resetDb(db, seedSql);
  await db.batch([
    db.prepare(`INSERT INTO channel_account (id, organization_id, channel, external_id, display_name, agent_key, status, created_at, updated_at)
      VALUES ('ca-1', 'org-abm', 'zalo', 'zalo-acc-1', 'Số tư vấn 1', 'sales-bot', 'connected', ?, ?)`).bind(STAMP, STAMP),
    db.prepare(`INSERT INTO conversation (id, organization_id, channel_account_id, kind, external_thread_id, display_name, created_at, updated_at)
      VALUES ('grp-1', 'org-abm', 'ca-1', 'group', 'g-1', 'Lớp IELTS K1', ?, ?)`).bind(STAMP, STAMP),
    db.prepare(`INSERT INTO conversation (id, organization_id, channel_account_id, kind, external_thread_id, display_name, created_at, updated_at)
      VALUES ('grp-2', 'org-abm', 'ca-1', 'group', 'g-2', 'Lớp IELTS K2', ?, ?)`).bind(STAMP, STAMP),
    db.prepare(`INSERT INTO conversation (id, organization_id, channel_account_id, kind, external_thread_id, display_name, created_at, updated_at)
      VALUES ('conv-1', 'org-abm', 'ca-1', 'direct', 'cust-1', 'Chị Hoa', ?, ?)`).bind(STAMP, STAMP),
  ]);
});
afterEach(() => vi.restoreAllMocks());

async function web(user: string, method: string, path: string, body?: unknown) {
  const res = await app.fetch(new Request(`${ORIGIN}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Demo-User': user },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), testEnv);
  return { status: res.status, json: await res.json() as any };
}

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function bridge(path: string, body: unknown) {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${raw}`)));
  const res = await app.fetch(new Request(`${ORIGIN}/api/bridge${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bridge-Timestamp': timestamp, 'X-Bridge-Signature': signature }, body: raw,
  }), testEnv);
  return { status: res.status, json: await res.json() as any };
}

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

const commands = (kind: string) => db.prepare('SELECT * FROM channel_command WHERE kind = ? ORDER BY created_at, rowid').bind(kind).all<any>()
  .then((r) => r.results.map((row) => ({ ...row, payload: JSON.parse(row.payload_json) })));
const schedule = (id: string) => db.prepare('SELECT * FROM group_schedule WHERE id = ?').bind(id).first<any>();
const enableFeature = () => db.prepare('UPDATE inbox_setting SET scheduled_sends_enabled = 1 WHERE id = 1').run();

/** An approved schedule of grp-1 (every day at 09:00 unless given), due at `nextRunAt`. */
async function activeSchedule(id: string, nextRunAt: string, mask = 127, timeOfDay = '09:00', conversationId = 'grp-1') {
  await db.prepare(`INSERT INTO group_schedule (id, conversation_id, template_text, weekdays_mask, time_of_day, status,
      approved_by_user_id, approved_at, next_run_at, created_by_user_id, created_at, updated_at)
    VALUES (?, ?, 'Nhắc lịch học tối nay 19:00', ?, ?, 'active', 'u-mai', ?, ?, 'u-hung', ?, ?)`)
    .bind(id, conversationId, mask, timeOfDay, STAMP, nextRunAt, STAMP, STAMP).run();
}

test('the next run is the first matching weekday and time in Vietnam time, plus up to 10 minutes', () => {
  const sundayMorning = new Date('2026-10-11T03:00:00.000Z'); // Sunday 10:00 in Vietnam
  expect(computeNextRun(0b0000001, '09:00', sundayMorning, zero)).toBe('2026-10-12T02:00:00.000Z');
  expect(computeNextRun(0b0000001, '09:00', sundayMorning, () => 0.9999)).toBe('2026-10-12T02:10:00.000Z');
  // Sunday is bit 6; today at 11:00 is still ahead, today at 09:00 has passed so the next one is a week later.
  expect(computeNextRun(0b1000000, '11:00', sundayMorning, zero)).toBe('2026-10-11T04:00:00.000Z');
  expect(computeNextRun(0b1000000, '09:00', sundayMorning, zero)).toBe('2026-10-18T02:00:00.000Z');
  // 06:00 in Vietnam on Monday is 23:00 UTC on Sunday.
  expect(computeNextRun(0b0000001, '06:00', sundayMorning, zero)).toBe('2026-10-11T23:00:00.000Z');
  expect(() => computeNextRun(0, '09:00', sundayMorning, zero)).toThrow();
});

test('a draft never runs; its author cannot approve it; another manager can', async () => {
  const created = await web('u-hung', 'POST', '/inbox/group-schedules', {
    conversationId: 'grp-1', templateText: 'Nhắc lịch học', weekdaysMask: 127, timeOfDay: '09:00',
  });
  expect(created.status, JSON.stringify(created.json)).toBe(200);
  const id = created.json.data.id as string;
  expect(created.json.data).toMatchObject({ status: 'draft', createdByUserId: 'u-hung', conversationName: 'Lớp IELTS K1', nextRunAt: null });

  await enableFeature();
  await db.prepare('UPDATE group_schedule SET next_run_at = ? WHERE id = ?').bind('2026-10-12T02:00:00.000Z', id).run();
  expect(await runDueSchedules(db, MONDAY_10, zero)).toEqual({ sent: 0, skipped: 0 });
  expect(await commands('send_zalo')).toHaveLength(0);

  expect((await web('u-mai', 'POST', `/inbox/group-schedules/${id}/approve`)).status).toBe(409);
  expect((await web('u-hung', 'POST', `/inbox/group-schedules/${id}/submit`)).json.data.status).toBe('pending_approval');
  expect((await web('u-hung', 'POST', `/inbox/group-schedules/${id}/approve`)).status).toBe(403);
  expect((await web('u-lan', 'POST', `/inbox/group-schedules/${id}/approve`)).status).toBe(403);
  const approved = await web('u-mai', 'POST', `/inbox/group-schedules/${id}/approve`);
  expect(approved.status, JSON.stringify(approved.json)).toBe(200);
  expect(approved.json.data).toMatchObject({ status: 'active', approvedByUserId: 'u-mai' });
  expect(Date.parse(approved.json.data.nextRunAt)).toBeGreaterThan(Date.now());

  // Only groups take schedules; another organization's id is not found.
  const direct = await web('u-lan', 'POST', '/inbox/group-schedules', { conversationId: 'conv-1', templateText: 'x', weekdaysMask: 1, timeOfDay: '09:00' });
  expect(direct.status).toBe(422);
  expect((await web('u-lan', 'POST', '/inbox/group-schedules', { conversationId: 'nope', templateText: 'x', weekdaysMask: 1, timeOfDay: '09:00' })).status).toBe(404);
  expect((await web('u-lan', 'POST', '/inbox/group-schedules', { conversationId: 'grp-1', templateText: 'x', weekdaysMask: 0, timeOfDay: '9h' })).status).toBe(422);

  // Pausing stops runs; approving again resumes.
  expect((await web('u-lan', 'POST', `/inbox/group-schedules/${id}/pause`)).status).toBe(403);
  expect((await web('u-hung', 'POST', `/inbox/group-schedules/${id}/pause`)).json.data).toMatchObject({ status: 'paused', nextRunAt: null });
  expect((await web('u-head', 'POST', `/inbox/group-schedules/${id}/approve`)).json.data.status).toBe('active');
  const audit = await db.prepare("SELECT command FROM audit_log WHERE entity = 'group_schedule' ORDER BY created_at, rowid").all<{ command: string }>();
  expect(audit.results.map((r) => r.command)).toEqual([
    'inbox.createGroupSchedule', 'inbox.submitGroupSchedule', 'inbox.approveGroupSchedule', 'inbox.pauseGroupSchedule', 'inbox.approveGroupSchedule',
  ]);
});

test('with the feature switch off nothing is queued and the run moves to the next scheduled time', async () => {
  await activeSchedule('s-1', '2026-10-12T02:00:00.000Z');
  expect(await runDueSchedules(db, MONDAY_10, zero)).toEqual({ sent: 0, skipped: 1 });
  expect(await db.prepare('SELECT COUNT(*) AS n FROM channel_command').first()).toEqual({ n: 0 });
  expect(await schedule('s-1')).toMatchObject({ last_skip_reason: 'feature_off', next_run_at: '2026-10-13T02:00:00.000Z', last_run_at: null });
});

test('the per-minute cron runs due schedules', async () => {
  await activeSchedule('s-1', new Date(Date.now() - 60_000).toISOString());
  await runScheduled(testEnv, '* * * * *');
  expect((await schedule('s-1')).last_skip_reason).toBe('feature_off');
  expect(Date.parse((await schedule('s-1')).next_run_at)).toBeGreaterThan(Date.now());
});

test('an eligible run queues one group send; running again in the same minute queues nothing more', async () => {
  await enableFeature();
  await activeSchedule('s-1', '2026-10-12T02:00:00.000Z');
  expect(await runDueSchedules(db, MONDAY_10, zero)).toEqual({ sent: 1, skipped: 0 });
  const [send] = await commands('send_zalo');
  expect(send).toMatchObject({
    target: 'bridge', channel_account_id: 'ca-1', conversation_id: 'grp-1', dedupe_key: 'schedule:s-1:2026-10-12',
    status: 'pending', next_run_at: MONDAY_10.toISOString(),
  });
  expect(send.payload).toMatchObject({ threadId: 'g-1', threadKind: 'group', text: 'Nhắc lịch học tối nay 19:00' });
  const message = await db.prepare('SELECT * FROM message WHERE id = ?').bind(send.payload.messageId).first<any>();
  expect(message).toMatchObject({ conversation_id: 'grp-1', direction: 'out', sender_kind: 'bot', status: 'pending' });
  expect(await schedule('s-1')).toMatchObject({ last_run_at: MONDAY_10.toISOString(), next_run_at: '2026-10-13T02:00:00.000Z', last_skip_reason: null });

  expect(await runDueSchedules(db, MONDAY_10, zero)).toEqual({ sent: 0, skipped: 0 });
  // Even when the run is due again the same day, the day's dedupe key holds it to one post and no stray message.
  await db.prepare("UPDATE group_schedule SET next_run_at = '2026-10-12T02:00:00.000Z' WHERE id = 's-1'").run();
  expect(await runDueSchedules(db, MONDAY_10, zero)).toEqual({ sent: 0, skipped: 0 });
  expect(await commands('send_zalo')).toHaveLength(1);
  expect(await db.prepare("SELECT COUNT(*) AS n FROM message WHERE conversation_id = 'grp-1'").first()).toEqual({ n: 1 });
});

test('a reached daily cap sends nothing and moves the run to the next day', async () => {
  await enableFeature();
  await db.prepare("UPDATE channel_account SET daily_send_cap = 1 WHERE id = 'ca-1'").run();
  // One send already queued today, still waiting for the bridge.
  await enqueueCommand(db, { kind: 'send_zalo', target: 'bridge', channelAccountId: 'ca-1', payload: { messageId: 'm-0' }, dedupeKey: 'earlier' });
  await db.prepare("UPDATE channel_command SET created_at = ? WHERE dedupe_key = 'earlier'").bind(MONDAY_10.toISOString()).run();
  await activeSchedule('s-1', '2026-10-12T02:00:00.000Z');
  expect(await runDueSchedules(db, MONDAY_10, zero)).toEqual({ sent: 0, skipped: 1 });
  expect(await commands('send_zalo')).toHaveLength(1);
  expect(await schedule('s-1')).toMatchObject({ last_skip_reason: 'daily_cap', next_run_at: '2026-10-13T02:00:00.000Z' });

  // A Monday-only schedule waits for the next Monday.
  await activeSchedule('s-2', '2026-10-12T02:00:00.000Z', 0b0000001);
  await runDueSchedules(db, MONDAY_10, zero);
  expect(await schedule('s-2')).toMatchObject({ last_skip_reason: 'daily_cap', next_run_at: '2026-10-19T02:00:00.000Z' });
});

test('quiet hours move the run to their end', async () => {
  await enableFeature();
  // 22:00 in Vietnam; no quiet hours configured means 21:00–08:00.
  const lateEvening = new Date('2026-10-12T15:00:00.000Z');
  await activeSchedule('s-1', '2026-10-12T14:30:00.000Z', 127, '21:30');
  expect(await runDueSchedules(db, lateEvening, zero)).toEqual({ sent: 0, skipped: 1 });
  expect(await schedule('s-1')).toMatchObject({ last_skip_reason: 'quiet_hours', next_run_at: '2026-10-13T01:00:00.000Z' });
  expect(await commands('send_zalo')).toHaveLength(0);

  // Configured quiet hours inside the day, 12:00–13:30, with the random offset on top.
  await db.prepare("UPDATE channel_account SET quiet_start = '12:00', quiet_end = '13:30' WHERE id = 'ca-1'").run();
  await activeSchedule('s-2', '2026-10-12T05:00:00.000Z', 127, '12:00');
  await runDueSchedules(db, new Date('2026-10-12T05:05:00.000Z'), () => 0.5);
  expect(await schedule('s-2')).toMatchObject({ last_skip_reason: 'quiet_hours', next_run_at: '2026-10-12T06:35:00.000Z' });
  // At the end of the quiet hours the post goes out.
  expect(await runDueSchedules(db, new Date('2026-10-12T06:35:00.000Z'), zero)).toEqual({ sent: 1, skipped: 0 });
});

test('a group opted out, the customer bot switch or an unavailable account blocks the run', async () => {
  await enableFeature();
  await db.prepare("UPDATE conversation SET scheduled_opt_out = 1 WHERE id = 'grp-1'").run();
  await activeSchedule('s-1', '2026-10-12T02:00:00.000Z');
  await activeSchedule('s-2', '2026-10-12T02:00:00.000Z', 127, '09:00', 'grp-2');
  await db.prepare('UPDATE customer_bot_switch SET enabled = 1 WHERE id = 1').run();
  await runDueSchedules(db, MONDAY_10, zero);
  expect((await schedule('s-2')).last_skip_reason).toBe('bot_switch_on');

  await db.prepare('UPDATE customer_bot_switch SET enabled = 0 WHERE id = 1').run();
  await db.prepare("UPDATE channel_account SET send_paused = 1 WHERE id = 'ca-1'").run();
  await db.prepare("UPDATE group_schedule SET next_run_at = '2026-10-12T02:00:00.000Z'").run();
  await runDueSchedules(db, MONDAY_10, zero);
  expect((await schedule('s-2')).last_skip_reason).toBe('account_unavailable');

  await db.prepare("UPDATE channel_account SET send_paused = 0 WHERE id = 'ca-1'").run();
  await db.prepare("UPDATE group_schedule SET next_run_at = '2026-10-12T02:00:00.000Z'").run();
  expect(await runDueSchedules(db, MONDAY_10, zero)).toEqual({ sent: 1, skipped: 1 });
  expect(await schedule('s-1')).toMatchObject({ last_skip_reason: 'group_opted_out', next_run_at: '2026-10-13T02:00:00.000Z' });
  const sends = await commands('send_zalo');
  expect(sends.map((s) => s.conversation_id)).toEqual(['grp-2']);
});

test('editing the text or timing of an active schedule sends it back for approval', async () => {
  await activeSchedule('s-1', '2026-10-13T02:00:00.000Z');
  expect((await web('u-lan', 'PATCH', '/inbox/group-schedules/s-1', { templateText: 'Khác' })).status).toBe(403);
  const unchanged = await web('u-hung', 'PATCH', '/inbox/group-schedules/s-1', { templateText: 'Nhắc lịch học tối nay 19:00' });
  expect(unchanged.json.data.status).toBe('active');
  const edited = await web('u-hung', 'PATCH', '/inbox/group-schedules/s-1', { templateText: 'Nhắc lịch học tối nay 19:30' });
  expect(edited.status, JSON.stringify(edited.json)).toBe(200);
  expect(edited.json.data).toMatchObject({ status: 'pending_approval', templateText: 'Nhắc lịch học tối nay 19:30', approvedByUserId: null, nextRunAt: null });

  await activeSchedule('s-2', '2026-10-13T02:00:00.000Z');
  expect((await web('u-mai', 'PATCH', '/inbox/group-schedules/s-2', { timeOfDay: '10:00' })).json.data.status).toBe('pending_approval');

  const list = await web('u-lan', 'GET', '/inbox/group-schedules?conversationId=grp-1');
  expect(list.json.data.map((s: any) => s.id).sort()).toEqual(['s-1', 's-2']);
  expect((await web('u-lan', 'DELETE', '/inbox/group-schedules/s-2')).status).toBe(403);
  expect((await web('u-hung', 'DELETE', '/inbox/group-schedules/s-2')).json.data).toEqual({ id: 's-2' });
  expect((await web('u-hung', 'GET', '/inbox/group-schedules/s-2')).status).toBe(404);
});

test('groups list and toggles; only an admin turns recurring posts on', async () => {
  const groups = await web('u-lan', 'GET', '/inbox/groups');
  expect(groups.json.data.map((g: any) => g.id)).toEqual(['grp-1', 'grp-2']);
  expect(groups.json.data[0]).toMatchObject({ displayName: 'Lớp IELTS K1', accountName: 'Số tư vấn 1', summaryEnabled: false, scheduledOptOut: false });

  expect((await web('u-lan', 'PATCH', '/inbox/groups/grp-1', { summaryEnabled: true, scheduledOptOut: true })).json.data)
    .toMatchObject({ summaryEnabled: true, scheduledOptOut: true });
  expect((await web('u-lan', 'PATCH', '/inbox/groups/grp-1', { scheduledOptOut: false })).status).toBe(403);
  expect((await web('u-hung', 'PATCH', '/inbox/groups/grp-1', { scheduledOptOut: false })).json.data.scheduledOptOut).toBe(false);
  expect((await web('u-lan', 'PATCH', '/inbox/groups/conv-1', { summaryEnabled: true })).status).toBe(404);
  expect((await web('u-lan', 'PATCH', '/inbox/groups/grp-1', {})).status).toBe(422);

  expect((await web('u-lan', 'GET', '/inbox/settings')).json.data).toMatchObject({ scheduledSendsEnabled: false });
  expect((await web('u-hung', 'PUT', '/inbox/settings', { scheduledSendsEnabled: true })).status).toBe(403);
  expect((await web('u-hung', 'PUT', '/inbox/settings', { slaMinutes: 20 })).json.data).toMatchObject({ slaMinutes: 20, scheduledSendsEnabled: false });
  expect((await web('u-admin', 'PUT', '/inbox/settings', { scheduledSendsEnabled: true })).json.data)
    .toMatchObject({ slaMinutes: 20, scheduledSendsEnabled: true });
});

test('the daily summary queues one run per group with member messages today and posts the answer to Lark', async () => {
  const sent = fakeLark();
  // 21:00 in Vietnam on Monday.
  const evening = new Date('2026-10-12T14:00:00.000Z');
  await db.prepare("UPDATE conversation SET summary_enabled = 1 WHERE id IN ('grp-1', 'grp-2')").run();
  const insert = (id: string, conv: string, direction: string, senderKind: string, body: string, createdAt: string) =>
    db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, sender_external_id, body, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, conv, direction, senderKind, direction === 'in' ? 'member-7' : null, body,
      direction === 'in' ? 'received' : 'sent', createdAt);
  await db.batch([
    insert('m-1', 'grp-1', 'in', 'customer', 'Tối nay có học không ạ?', '2026-10-12T05:00:00.000Z'),
    insert('m-2', 'grp-1', 'out', 'staff_phone', 'Có nhé', '2026-10-12T05:10:00.000Z'),
    // grp-2 heard from a member only yesterday (Vietnam time) and from staff today.
    insert('m-3', 'grp-2', 'in', 'customer', 'Hôm qua', '2026-10-11T16:59:00.000Z'),
    insert('m-4', 'grp-2', 'out', 'staff_phone', 'Chào cả lớp', '2026-10-12T05:00:00.000Z'),
  ]);

  await runScheduled(testEnv, '0 14 * * *', evening);
  await runScheduled(testEnv, '0 14 * * *', evening);
  const runs = await commands('run_completion');
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ target: 'bridge', conversation_id: 'grp-1', channel_account_id: 'ca-1', dedupe_key: 'summary:grp-1:2026-10-12' });
  expect(runs[0].payload).toMatchObject({ agentKey: 'group-summarizer', conversationId: 'grp-1', purpose: 'group_summary' });
  expect(runs[0].payload.userId).toMatch(/^group-summary:[0-9a-f-]{36}$/);
  expect(runs[0].payload.text).toBe('12:00 Thành viên member-7: Tối nay có học không ạ?\n12:10 Nhân viên: Có nhé');

  const [claimed] = await claimCommands(db, 'bridge', 10);
  expect(claimed!.id).toBe(runs[0].id);
  const result = await bridge(`/commands/${claimed!.id}/result`, { attempts: claimed!.attempts, ok: true, text: 'Học viên hỏi lịch tối nay; đã xác nhận.' });
  expect(result).toEqual({ status: 200, json: { ok: true, data: { ignored: false } } });

  const [day, month] = [vnDate(new Date(runs[0].created_at)).slice(8, 10), vnDate(new Date(runs[0].created_at)).slice(5, 7)];
  const expected = `Tóm tắt nhóm Lớp IELTS K1 (Số tư vấn 1) ngày ${day}/${month}:\nHọc viên hỏi lịch tối nay; đã xác nhận.`;
  const larks = await commands('send_lark');
  expect(larks.map((l) => l.payload)).toEqual([{ text: expected }]);
  expect(sent).toEqual([expected]);
  // Nothing goes into the Zalo group.
  expect(await commands('send_zalo')).toHaveLength(0);
  expect((await commands('run_completion'))[0].status).toBe('done');
});

test('an account error from the bridge pauses its sending and warns Lark once per hour', async () => {
  const event = { type: 'account_status' as const, accountId: 'ca-1', status: 'error' as const, lastError: 'ZALO_KICKED' };
  expect(await ingestEvents(db, [event])).toEqual({ accepted: 1, rejected: 0 });
  expect(await db.prepare("SELECT status, send_paused FROM channel_account WHERE id = 'ca-1'").first()).toEqual({ status: 'error', send_paused: 1 });
  const larks = await commands('send_lark');
  expect(larks).toHaveLength(1);
  expect(larks[0]).toMatchObject({ target: 'worker', channel_account_id: 'ca-1' });
  expect(larks[0].dedupe_key).toMatch(/^account-error:ca-1:\d{4}-\d{2}-\d{2}T\d{2}$/);
  expect(larks[0].payload).toEqual({ text: 'Tài khoản Số tư vấn 1 lỗi kết nối, đã tạm dừng gửi' });

  await ingestEvents(db, [event]);
  expect(await commands('send_lark')).toHaveLength(1);
  // Reconnecting does not turn sending back on; that stays an admin's call.
  await ingestEvents(db, [{ type: 'account_status', accountId: 'ca-1', accountExternalId: 'zalo-acc-1', status: 'connected' }]);
  expect(await db.prepare("SELECT status, send_paused FROM channel_account WHERE id = 'ca-1'").first()).toEqual({ status: 'connected', send_paused: 1 });
});
