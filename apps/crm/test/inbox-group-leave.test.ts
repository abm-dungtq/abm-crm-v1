import { env } from 'cloudflare:test';
import type { BridgeEvent } from '@abm/contracts';
import { beforeEach, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';
import { claimCommands } from '../src/worker/inbox/dispatcher';
import { scheduleGroupReply } from '../src/worker/inbox/conversation-flow';
import { runDueSchedules } from '../src/worker/inbox/group-schedules';
import { enqueueDailyGroupSummaries } from '../src/worker/inbox/group-summaries';
import { ingestEvents } from '../src/worker/inbox/ingest';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
const ORIGIN = 'http://crm.test';
const STAMP = '2026-10-08T03:00:00.000Z';
const SECRET = 'test-bridge-secret';
const LATER = '2099-01-01T00:00:00.000Z';
/** Monday 2026-10-12, 10:00 Vietnam time. */
const MONDAY_10 = new Date('2026-10-12T03:00:00.000Z');
const testEnv = { ...env, DEMO_MODE: '1', BRIDGE_SECRET: SECRET };

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

async function bridgeGet(path: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.`)));
  const res = await app.fetch(new Request(`${ORIGIN}/api/bridge${path}`, {
    method: 'GET', headers: { 'X-Bridge-Timestamp': timestamp, 'X-Bridge-Signature': signature },
  }), testEnv);
  return { status: res.status, json: await res.json() as any };
}

const commands = (kind: string) => db.prepare('SELECT * FROM channel_command WHERE kind = ? ORDER BY created_at, rowid').bind(kind).all<any>()
  .then((r) => r.results.map((row) => ({ ...row, payload: JSON.parse(row.payload_json) })));
const group = (id = 'grp-1') => db.prepare('SELECT * FROM conversation WHERE id = ?').bind(id).first<any>();
const audits = () => db.prepare("SELECT * FROM audit_log WHERE command = 'inbox.leaveGroup' ORDER BY created_at, rowid").all<any>()
  .then((r) => r.results);

let msgSeq = 0;
const groupMessage = (overrides: Record<string, unknown> = {}): BridgeEvent => ({
  type: 'message', accountExternalId: 'zalo-acc-1', threadId: 'g-1', threadKind: 'group',
  msgId: `gm-${++msgSeq}`, fromSelf: false, senderExternalId: 'hv-lan', senderName: 'Lan', text: 'Mai học bài gì ạ',
  sentAt: new Date().toISOString(), mentionsSelf: false, quotesSelf: false, ...overrides,
});

async function otherOrg() {
  await db.batch([
    db.prepare(`INSERT INTO organization (id, name, created_at, updated_at) VALUES ('org-other', 'Tổ chức khác', ?, ?)`).bind(STAMP, STAMP),
    db.prepare(`INSERT INTO channel_account (id, organization_id, channel, external_id, display_name, agent_key, status, created_at, updated_at)
      VALUES ('ca-other', 'org-other', 'zalo', 'zalo-other', 'Số khác', 'sales-bot', 'connected', ?, ?)`).bind(STAMP, STAMP),
    db.prepare(`INSERT INTO conversation (id, organization_id, channel_account_id, kind, external_thread_id, display_name, created_at, updated_at)
      VALUES ('grp-other', 'org-other', 'ca-other', 'group', 'g-other', 'Nhóm khác', ?, ?)`).bind(STAMP, STAMP),
  ]);
}

async function insertCommand(row: {
  id: string; kind: string; payload: unknown; target?: string; status?: string; nextRunAt?: string;
  attempts?: number; conversationId?: string;
}) {
  const status = row.status ?? 'pending';
  await db.prepare(`INSERT INTO channel_command
      (id, kind, target, channel_account_id, conversation_id, payload_json, status, attempts,
       claimed_at, lease_expires_at, next_run_at, created_at, updated_at)
    VALUES (?, ?, ?, 'ca-1', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(row.id, row.kind, row.target ?? 'bridge', row.conversationId ?? 'grp-1', JSON.stringify(row.payload), status,
      row.attempts ?? (status === 'claimed' ? 1 : 0), status === 'claimed' ? STAMP : null, status === 'claimed' ? LATER : null,
      row.nextRunAt ?? LATER, STAMP, STAMP).run();
}

async function pendingMessage(id: string, conversationId = 'grp-1') {
  await db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, body, status, created_at)
    VALUES (?, ?, 'out', 'bot', 'sắp gửi', 'pending', ?)`).bind(id, conversationId, STAMP).run();
}

async function activeSchedule(id: string, nextRunAt: string, conversationId = 'grp-1') {
  await db.prepare(`INSERT INTO group_schedule (id, conversation_id, template_text, weekdays_mask, time_of_day, status,
      approved_by_user_id, approved_at, next_run_at, created_by_user_id, created_at, updated_at)
    VALUES (?, ?, 'Nhắc lịch học tối nay 19:00', 127, '09:00', 'active', 'u-mai', ?, ?, 'u-hung', ?, ?)`)
    .bind(id, conversationId, STAMP, nextRunAt, STAMP, STAMP).run();
}

test('only a manager can ask the company number to leave, and a repeat does not queue twice', async () => {
  await otherOrg();
  const denied = await web('u-lan', 'POST', '/inbox/groups/grp-1/leave');
  expect(denied.status).toBe(403);
  expect(denied.json.error).toMatchObject({
    code: 'FORBIDDEN', message: 'Chỉ trưởng nhóm, trưởng phòng, giám đốc hoặc quản trị được rời nhóm',
  });
  expect((await group()).leave_requested_at).toBeNull();
  expect(await commands('leave_zalo_group')).toHaveLength(0);
  expect((await web('u-lan', 'POST', '/inbox/groups/grp-other/leave')).status).toBe(403);

  expect((await web('u-hung', 'POST', '/inbox/groups/grp-other/leave')).status).toBe(404);
  expect((await web('u-hung', 'POST', '/inbox/groups/conv-1/leave')).status).toBe(404);
  expect((await web('u-hung', 'POST', '/inbox/groups/missing/leave')).status).toBe(404);

  await db.prepare("UPDATE conversation SET left_at = ? WHERE id = 'grp-1'").bind(STAMP).run();
  const already = await web('u-hung', 'POST', '/inbox/groups/grp-1/leave');
  expect(already.status).toBe(409);
  expect(already.json.error).toMatchObject({ code: 'CONFLICT', message: 'Nhóm đã rời' });
  expect(await commands('leave_zalo_group')).toHaveLength(0);
  await db.prepare("UPDATE conversation SET left_at = NULL WHERE id = 'grp-1'").run();

  const first = await web('u-hung', 'POST', '/inbox/groups/grp-1/leave');
  expect(first.status, JSON.stringify(first.json)).toBe(200);
  const again = await web('u-hung', 'POST', '/inbox/groups/grp-1/leave');
  expect(again.json.data).toEqual(first.json.data);
  expect(first.json.data.id).toBe('grp-1');
  expect(typeof first.json.data.leaveRequestedAt).toBe('string');

  const queued = await commands('leave_zalo_group');
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({
    target: 'bridge', channel_account_id: 'ca-1', conversation_id: 'grp-1', status: 'pending',
  });
  expect(queued[0].payload).toEqual({ threadId: 'g-1' });
  expect(queued[0].dedupe_key).toBe(`leave:grp-1:${first.json.data.leaveRequestedAt}`);
  expect((await group()).leave_requested_at).toBe(first.json.data.leaveRequestedAt);

  const rows = await audits();
  expect(rows).toHaveLength(1);
  expect(rows[0].actor_user_id).toBe('u-hung');
  expect(JSON.parse(rows[0].after_json)).toMatchObject({
    leaveRequestedAt: first.json.data.leaveRequestedAt, requestedByName: 'Phạm Văn Hùng',
  });

  const head = await web('u-head', 'POST', '/inbox/groups/grp-2/leave');
  expect(head.status).toBe(200);
  expect((await web('u-bgd', 'POST', '/inbox/groups/grp-2/leave')).json.data.leaveRequestedAt).toBe(head.json.data.leaveRequestedAt);
  expect((await web('u-admin', 'POST', '/inbox/groups/grp-2/leave')).json.data.leaveRequestedAt).toBe(head.json.data.leaveRequestedAt);
  expect((await commands('leave_zalo_group')).filter((row) => row.conversation_id === 'grp-2')).toHaveLength(1);
});

test('a successful leave marks the group, stops sends into it, and keeps the history', async () => {
  await db.prepare(`UPDATE conversation SET bot_reply_enabled = 1, summary_enabled = 1, group_agent_key = 'care-bot',
      bot_paused_until = ? WHERE id = 'grp-1'`).bind(LATER).run();
  await activeSchedule('s-1', LATER, 'grp-1');
  await activeSchedule('s-2', LATER, 'grp-2');
  await pendingMessage('msg-pending');
  await pendingMessage('msg-claimed');
  await insertCommand({
    id: 'cmd-pending', kind: 'send_zalo', payload: { threadId: 'g-1', threadKind: 'group', text: 'chờ', messageId: 'msg-pending' },
  });
  await insertCommand({
    id: 'cmd-claimed', kind: 'send_zalo', status: 'claimed', attempts: 1,
    payload: { threadId: 'g-1', threadKind: 'group', text: 'đã nhận', messageId: 'msg-claimed' },
  });
  await insertCommand({
    id: 'cmd-reply', kind: 'run_completion',
    payload: { purpose: 'reply', agentKey: 'care-bot', userId: 'u', text: 'trả lời', conversationId: 'grp-1' },
  });
  await insertCommand({
    id: 'cmd-summary', kind: 'run_completion',
    payload: { purpose: 'group_summary', agentKey: 'group-summarizer', userId: 'u', text: 'tóm tắt', conversationId: 'grp-1' },
  });
  await insertCommand({ id: 'cmd-lark', kind: 'send_lark', target: 'worker', payload: { text: 'báo Lark' } });
  await insertCommand({
    id: 'cmd-msgr', kind: 'send_messenger', target: 'worker', payload: { threadId: 'g-1', text: 'fb' },
  });

  const asked = await web('u-hung', 'POST', '/inbox/groups/grp-1/leave');
  expect(asked.status).toBe(200);
  const [claimed] = await claimCommands(db, 'bridge', 10);
  expect(claimed?.kind).toBe('leave_zalo_group');
  const result = await bridge(`/commands/${claimed!.id}/result`, { attempts: claimed!.attempts, ok: true });
  expect(result).toEqual({ status: 200, json: { ok: true, data: { ignored: false } } });

  const row = await group();
  expect(row.left_at).toEqual(expect.any(String));
  expect(row.leave_requested_at).toBeNull();
  expect(row.bot_reply_enabled).toBe(0);
  expect(row.summary_enabled).toBe(0);
  expect(row.scheduled_opt_out).toBe(1);
  expect(row.group_agent_key).toBe('care-bot');
  expect(row.bot_paused_until).toBe(LATER);
  expect(await db.prepare("SELECT status, next_run_at FROM group_schedule WHERE id = 's-1'").first()).toEqual({ status: 'paused', next_run_at: null });
  expect((await db.prepare("SELECT status FROM group_schedule WHERE id = 's-2'").first<{ status: string }>())!.status).toBe('active');

  const failed = await db.prepare("SELECT id, status, result_json FROM channel_command WHERE id IN ('cmd-pending', 'cmd-claimed', 'cmd-reply', 'cmd-msgr') ORDER BY id").all<any>();
  expect(failed.results.map((item) => item.status)).toEqual(['failed', 'failed', 'failed', 'failed']);
  expect(failed.results.every((item) => JSON.parse(item.result_json).error === 'LEFT_GROUP')).toBe(true);
  expect((await db.prepare("SELECT status FROM channel_command WHERE id = 'cmd-summary'").first<{ status: string }>())!.status).toBe('pending');
  expect((await db.prepare("SELECT status FROM channel_command WHERE id = 'cmd-lark'").first<{ status: string }>())!.status).toBe('pending');
  expect((await db.prepare("SELECT status FROM channel_command WHERE id = ?",).bind(claimed!.id).first<{ status: string }>())!.status).toBe('done');
  expect((await db.prepare("SELECT status FROM message WHERE id = 'msg-pending'").first<{ status: string }>())!.status).toBe('failed');
  expect((await db.prepare("SELECT status FROM message WHERE id = 'msg-claimed'").first<{ status: string }>())!.status).toBe('failed');

  const notes = await db.prepare("SELECT body, status, sender_kind FROM message WHERE conversation_id = 'grp-1' AND sender_kind = 'system'").all<any>();
  expect(notes.results).toEqual([{ body: 'Đã rời nhóm (do Phạm Văn Hùng)', status: 'sent', sender_kind: 'system' }]);
});

test('a failed leave clears the request so staff can ask again', async () => {
  await db.prepare("UPDATE conversation SET bot_reply_enabled = 1, summary_enabled = 1 WHERE id = 'grp-1'").run();
  const asked = await web('u-hung', 'POST', '/inbox/groups/grp-1/leave');
  const [claimed] = await claimCommands(db, 'bridge', 10);
  const result = await bridge(`/commands/${claimed!.id}/result`, {
    attempts: claimed!.attempts, ok: false, error: 'ACCOUNT_NOT_CONNECTED',
  });
  expect(result).toEqual({ status: 200, json: { ok: true, data: { ignored: false } } });

  const row = await group();
  expect(row.left_at).toBeNull();
  expect(row.leave_requested_at).toBeNull();
  expect(row.bot_reply_enabled).toBe(1);
  expect(row.summary_enabled).toBe(1);
  expect((await db.prepare('SELECT status FROM channel_command WHERE id = ?').bind(claimed!.id).first<{ status: string }>())!.status).toBe('failed');
  const notes = await db.prepare("SELECT body, status FROM message WHERE conversation_id = 'grp-1' AND sender_kind = 'system'").all<any>();
  expect(notes.results).toEqual([{ body: 'Rời nhóm không thành công: ACCOUNT_NOT_CONNECTED', status: 'sent' }]);

  const retry = await web('u-hung', 'POST', '/inbox/groups/grp-1/leave');
  expect(retry.status).toBe(200);
  expect(retry.json.data.leaveRequestedAt).not.toBe(asked.json.data.leaveRequestedAt);
  expect(await commands('leave_zalo_group')).toHaveLength(2);
});

test('staff cannot send into a group the company number has left', async () => {
  await db.prepare("UPDATE conversation SET left_at = ? WHERE id = 'grp-1'").bind(STAMP).run();
  const sent = await web('u-hung', 'POST', '/inbox/conversations/grp-1/messages', { text: 'xin chào' });
  expect(sent.status).toBe(409);
  expect(sent.json.error).toMatchObject({ code: 'CONFLICT', message: 'Nhóm đã rời' });
  expect(await commands('send_zalo')).toHaveLength(0);
  expect((await db.prepare("SELECT COUNT(*) AS n FROM message WHERE conversation_id = 'grp-1'").first<{ n: number }>())!.n).toBe(0);
});

test('a due send into a left group is dropped instead of handed to the bridge', async () => {
  await db.prepare("UPDATE conversation SET left_at = ? WHERE id = 'grp-1'").bind(STAMP).run();
  await pendingMessage('msg-due', 'grp-1');
  await pendingMessage('msg-ok', 'grp-2');
  await insertCommand({
    id: 'cmd-due', kind: 'send_zalo', nextRunAt: STAMP,
    payload: { threadId: 'g-1', threadKind: 'group', text: 'đi', messageId: 'msg-due' },
  });
  await insertCommand({
    id: 'cmd-ok', kind: 'send_zalo', nextRunAt: STAMP, conversationId: 'grp-2',
    payload: { threadId: 'g-2', threadKind: 'group', text: 'ở lại', messageId: 'msg-ok' },
  });
  const polled = await bridgeGet('/commands');
  expect(polled.status).toBe(200);
  expect(polled.json.data.map((item: { id: string }) => item.id)).toEqual(['cmd-ok']);
  const dropped = await db.prepare("SELECT status, result_json FROM channel_command WHERE id = 'cmd-due'").first<any>();
  expect(dropped.status).toBe('failed');
  expect(JSON.parse(dropped.result_json)).toEqual({ error: 'LEFT_GROUP' });
  expect((await db.prepare("SELECT status FROM message WHERE id = 'msg-due'").first<{ status: string }>())!.status).toBe('failed');
  expect((await db.prepare("SELECT status FROM message WHERE id = 'msg-ok'").first<{ status: string }>())!.status).toBe('pending');
});

test('scheduled posts and daily summaries skip a group that has been left', async () => {
  await db.prepare('UPDATE inbox_setting SET scheduled_sends_enabled = 1 WHERE id = 1').run();
  await activeSchedule('s-left', '2026-10-12T02:00:00.000Z', 'grp-1');
  await activeSchedule('s-stay', '2026-10-12T02:00:00.000Z', 'grp-2');
  await db.prepare("UPDATE conversation SET left_at = ? WHERE id = 'grp-1'").bind(STAMP).run();
  expect(await runDueSchedules(db, MONDAY_10, () => 0)).toEqual({ sent: 1, skipped: 0 });
  const sends = await commands('send_zalo');
  expect(sends.map((row) => row.conversation_id)).toEqual(['grp-2']);
  const leftSchedule = await db.prepare('SELECT status, next_run_at, last_run_at FROM group_schedule WHERE id = ?').bind('s-left').first<any>();
  expect(leftSchedule).toMatchObject({ status: 'active', next_run_at: '2026-10-12T02:00:00.000Z', last_run_at: null });

  await db.prepare("UPDATE conversation SET summary_enabled = 1 WHERE id IN ('grp-1', 'grp-2')").run();
  const insert = (id: string, conv: string) => db.prepare(`INSERT INTO message
      (id, conversation_id, direction, sender_kind, sender_external_id, body, status, created_at)
    VALUES (?, ?, 'in', 'customer', 'member-7', 'Tối nay có học không ạ?', 'received', '2026-10-12T05:00:00.000Z')`).bind(id, conv);
  await db.batch([insert('m-left', 'grp-1'), insert('m-stay', 'grp-2')]);
  expect(await enqueueDailyGroupSummaries(db, new Date('2026-10-12T14:00:00.000Z'))).toBe(1);
  const summaries = await commands('run_completion');
  expect(summaries).toHaveLength(1);
  expect(summaries[0].conversation_id).toBe('grp-2');
  expect(summaries[0].payload.purpose).toBe('group_summary');
});

test('a new group message clears a previous leave and does not resume the bot by itself', async () => {
  await db.prepare(`UPDATE conversation SET left_at = ?, leave_requested_at = ?, bot_reply_enabled = 1,
      summary_enabled = 0, scheduled_opt_out = 1 WHERE id = 'grp-1'`).bind(STAMP, STAMP).run();
  expect(await scheduleGroupReply(db, 'grp-1', 'm-while-left', {
    msgId: 'while-left', senderExternalId: 'hv-lan', senderName: 'Lan', text: '@Long lịch học',
  })).toBe(false);
  expect(await commands('run_completion')).toHaveLength(0);

  expect(await ingestEvents(db, [groupMessage({ msgId: 'back-1', mentionsSelf: true, text: '@Long lịch học' })])).toEqual({ accepted: 1, rejected: 0 });
  let row = await group();
  expect(row.left_at).toBeNull();
  expect(row.leave_requested_at).toBeNull();
  expect(row.bot_reply_enabled).toBe(1);
  expect(row.summary_enabled).toBe(0);
  expect(row.scheduled_opt_out).toBe(1);
  expect(await commands('run_completion')).toHaveLength(0);

  await ingestEvents(db, [groupMessage({ msgId: 'back-2', mentionsSelf: true, text: '@Long lịch học tiếp' })]);
  expect(await commands('run_completion')).toHaveLength(1);

  await db.prepare("UPDATE conversation SET left_at = ?, leave_requested_at = ? WHERE id = 'grp-1'").bind(STAMP, STAMP).run();
  await ingestEvents(db, [groupMessage({ msgId: 'back-2', text: '@Long lịch học tiếp' })]);
  row = await group();
  expect(row.left_at).toBe(STAMP);
  expect(row.leave_requested_at).toBe(STAMP);

  const sentAt = new Date().toISOString();
  await db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, body, status, created_at)
    VALUES ('msg-echo', 'grp-1', 'out', 'bot', 'xin chào lớp', 'pending', ?)`).bind(sentAt).run();
  await ingestEvents(db, [groupMessage({ fromSelf: true, text: 'xin chào lớp', msgId: 'echo-1', senderExternalId: 'zalo-acc-1' })]);
  expect((await group()).left_at).toBe(STAMP);
});

test('the group list exposes when a group was left and when a leave is still outstanding', async () => {
  const before = await web('u-lan', 'GET', '/inbox/groups');
  expect(before.json.data.map((item: { id: string }) => item.id)).toEqual(['grp-1', 'grp-2']);
  expect(before.json.data[0]).toMatchObject({ id: 'grp-1', leftAt: null, leaveRequestedAt: null });
  expect(before.json.data[1]).toMatchObject({ id: 'grp-2', leftAt: null, leaveRequestedAt: null });

  await db.prepare("UPDATE conversation SET left_at = ?, leave_requested_at = ? WHERE id = 'grp-1'").bind(STAMP, LATER).run();
  const after = await web('u-lan', 'GET', '/inbox/groups');
  expect(after.json.data.map((item: { id: string }) => item.id)).toEqual(['grp-1', 'grp-2']);
  expect(after.json.data[0]).toMatchObject({ leftAt: STAMP, leaveRequestedAt: LATER });
  expect(after.json.data[1]).toMatchObject({ leftAt: null, leaveRequestedAt: null });
});

test('deleting group history requires a manager and a group that has already been left', async () => {
  await otherOrg();
  await db.prepare("UPDATE conversation SET left_at = ? WHERE id = 'grp-other'").bind(STAMP).run();

  const sale = await web('u-lan', 'DELETE', '/inbox/groups/grp-1');
  expect(sale.status).toBe(403);
  expect(sale.json.error).toMatchObject({
    code: 'FORBIDDEN', message: 'Chỉ trưởng nhóm, trưởng phòng, giám đốc hoặc quản trị được xoá lịch sử nhóm',
  });
  expect((await web('u-lan', 'DELETE', '/inbox/groups/grp-other')).status).toBe(403);

  expect((await web('u-hung', 'DELETE', '/inbox/groups/grp-other')).status).toBe(404);
  expect((await web('u-hung', 'DELETE', '/inbox/groups/conv-1')).status).toBe(404);
  expect((await web('u-hung', 'DELETE', '/inbox/groups/missing')).status).toBe(404);

  const active = await web('u-hung', 'DELETE', '/inbox/groups/grp-1');
  expect(active.status).toBe(409);
  expect(active.json.error).toMatchObject({ code: 'CONFLICT', message: 'Chỉ xoá được lịch sử nhóm đã rời' });

  await db.prepare("UPDATE conversation SET leave_requested_at = ? WHERE id = 'grp-1'").bind(STAMP).run();
  const pendingLeave = await web('u-hung', 'DELETE', '/inbox/groups/grp-1');
  expect(pendingLeave.status).toBe(409);
  expect(pendingLeave.json.error).toMatchObject({ code: 'CONFLICT', message: 'Chỉ xoá được lịch sử nhóm đã rời' });
  expect(await group('grp-1')).not.toBeNull();
});

test('deleting a left group removes all its rows and R2 images, writes audit, spares other groups, and lets a later message open a fresh conversation', async () => {
  const key1 = 'org/org-abm/2026/10/11111111-1111-4111-8111-111111111111.jpg';
  const key2 = 'org/org-abm/2026/10/22222222-2222-4222-8222-222222222222.jpg';
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]);
  await env.MEDIA.put(key1, jpeg, { httpMetadata: { contentType: 'image/jpeg' } });
  await env.MEDIA.put(key2, jpeg, { httpMetadata: { contentType: 'image/jpeg' } });

  await db.batch([
    db.prepare("UPDATE conversation SET left_at = ? WHERE id IN ('grp-1', 'grp-2')").bind(STAMP),
    db.prepare(`INSERT INTO zalo_group_member (conversation_id, external_user_id, display_name, updated_at)
      VALUES ('grp-1', 'mem-1', 'Học viên 1', ?), ('grp-2', 'mem-2', 'Học viên 2', ?)`).bind(STAMP, STAMP),
    db.prepare(`INSERT INTO lead_intake (id, organization_id, conversation_id, fields_json, status, created_at, updated_at)
      VALUES ('in-1', 'org-abm', 'grp-1', '{"name":"HV 1"}', 'pending', ?, ?),
             ('in-2', 'org-abm', 'grp-2', '{"name":"HV 2"}', 'pending', ?, ?)`).bind(STAMP, STAMP, STAMP, STAMP),
    db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, body, attachments_json, status, created_at)
      VALUES ('m-1a', 'grp-1', 'out', 'staff_web', 'Ảnh lớp', ?, 'sent', ?),
             ('m-1b', 'grp-1', 'in', 'customer', 'Ảnh khách', ?, 'received', ?),
             ('m-2a', 'grp-2', 'out', 'staff_web', 'Ảnh nhóm 2', ?, 'sent', ?)`).bind(
      JSON.stringify([{ url: `/api/inbox/media/${key1}`, mimeType: 'image/jpeg', name: '1.jpg' }]), STAMP,
      JSON.stringify([{ url: 'https://f10-zpcloud.zdn.vn/123/zdn.jpg', mimeType: 'image/jpeg' }]), STAMP,
      JSON.stringify([{ url: `/api/inbox/media/${key2}`, mimeType: 'image/jpeg', name: '2.jpg' }]), STAMP,
    ),
  ]);
  await activeSchedule('sch-1', LATER, 'grp-1');
  await activeSchedule('sch-2', LATER, 'grp-2');
  await insertCommand({ id: 'cmd-1', kind: 'send_zalo', conversationId: 'grp-1', payload: { threadId: 'g-1', text: 'x' } });
  await insertCommand({ id: 'cmd-2', kind: 'send_zalo', conversationId: 'grp-2', payload: { threadId: 'g-2', text: 'y' } });

  const deleted = await web('u-hung', 'DELETE', '/inbox/groups/grp-1');
  expect(deleted).toEqual({ status: 200, json: { ok: true, data: { id: 'grp-1' } } });

  expect(await group('grp-1')).toBeNull();
  for (const table of ['zalo_group_member', 'group_schedule', 'lead_intake', 'channel_command', 'message']) {
    const count1 = await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE conversation_id = 'grp-1'`).first<{ n: number }>();
    expect(count1!.n, table).toBe(0);
    const count2 = await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE conversation_id = 'grp-2'`).first<{ n: number }>();
    expect(count2!.n, `${table} grp-2`).toBe(1);
  }
  expect(await group('grp-2')).not.toBeNull();

  expect(await env.MEDIA.head(key1)).toBeNull();
  expect(await env.MEDIA.head(key2)).not.toBeNull();

  const audit = await db.prepare("SELECT * FROM audit_log WHERE command = 'inbox.deleteGroupHistory'").first<any>();
  expect(audit).toMatchObject({
    actor_user_id: 'u-hung',
    actor_kind: 'human',
    entity: 'conversation',
    entity_id: 'grp-1',
  });
  expect(JSON.parse(audit.before_json)).toEqual({
    displayName: 'Lớp IELTS K1',
    leftAt: STAMP,
    messageCount: 2,
  });
  expect(JSON.parse(audit.after_json)).toBeNull();

  expect(await ingestEvents(db, [groupMessage({ msgId: 'reborn-1', text: 'Nhóm hoạt động lại' })])).toEqual({
    accepted: 1, rejected: 0,
  });
  const fresh = await db.prepare("SELECT * FROM conversation WHERE channel_account_id = 'ca-1' AND external_thread_id = 'g-1'").first<any>();
  expect(fresh).not.toBeNull();
  expect(fresh.id).not.toBe('grp-1');
  expect(fresh.kind).toBe('group');
  expect(fresh.left_at).toBeNull();
  expect(fresh.leave_requested_at).toBeNull();
  const freshMessages = await db.prepare('SELECT body FROM message WHERE conversation_id = ?').bind(fresh.id).all<{ body: string }>();
  expect(freshMessages.results).toEqual([{ body: 'Nhóm hoạt động lại' }]);
});

