import { env } from 'cloudflare:test';
import type { BridgeEvent } from '@abm/contracts';
import { beforeEach, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';
import { accountSendsToday, enqueueCommand } from '../src/worker/inbox/dispatcher';
import {
  BOT_SILENT_REASON, GROUP_PAUSE_MS, abandonStaleReplies, applyCompletionResult, notifyGroupHelp,
} from '../src/worker/inbox/conversation-flow';
import { runDueSchedules, vnDayStart } from '../src/worker/inbox/group-schedules';
import { ingestEvents } from '../src/worker/inbox/ingest';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
const ORIGIN = 'http://crm.test';
const STAMP = '2026-10-08T03:00:00.000Z';
const APP_URL = 'https://crm.example';
const SECRET = 'test-bridge-secret';
/** Monday 2026-10-12, 10:00 Vietnam time, outside the default quiet hours. */
const MONDAY_10 = new Date('2026-10-12T03:00:00.000Z');
const testEnv = { ...env, DEMO_MODE: '1', APP_URL, BRIDGE_SECRET: SECRET };

beforeEach(async () => {
  await resetDb(db, seedSql);
  await db.batch([
    db.prepare(`INSERT INTO channel_account (id, organization_id, channel, external_id, display_name, agent_key, status, created_at, updated_at)
      VALUES ('ca-1', 'org-abm', 'zalo', 'zalo-acc-1', 'Số tư vấn 1', 'sales-bot', 'connected', ?, ?)`).bind(STAMP, STAMP),
    db.prepare(`INSERT INTO conversation (id, organization_id, channel_account_id, kind, external_thread_id, display_name, created_at, updated_at)
      VALUES ('grp-1', 'org-abm', 'ca-1', 'group', 'g-1', 'Lớp IELTS K1', ?, ?)`).bind(STAMP, STAMP),
    db.prepare(`INSERT INTO conversation (id, organization_id, channel_account_id, kind, external_thread_id, display_name, created_at, updated_at)
      VALUES ('conv-1', 'org-abm', 'ca-1', 'direct', 'cust-1', 'Chị Hoa', ?, ?)`).bind(STAMP, STAMP),
    db.prepare('DELETE FROM zalo_group_member'),
    db.prepare('DELETE FROM zalo_staff_member'),
  ]);
});

let msgSeq = 0;
const groupMessage = (overrides: Record<string, unknown> = {}) => ({
  type: 'message' as const, accountExternalId: 'zalo-acc-1', threadId: 'g-1', threadKind: 'group' as const,
  msgId: `gm-${++msgSeq}`, fromSelf: false, senderExternalId: 'hv-lan', senderName: 'Lan', text: 'Mai học bài gì ạ',
  sentAt: new Date().toISOString(), mentionsSelf: false, quotesSelf: false, ...overrides,
});
const ingest = (...events: BridgeEvent[]) => ingestEvents(db, events);
const enableBot = () => db.prepare("UPDATE conversation SET bot_reply_enabled = 1 WHERE id = 'grp-1'").run();
const group = () => db.prepare("SELECT * FROM conversation WHERE id = 'grp-1'").first<Record<string, unknown>>();
const commands = (kind: string) => db.prepare('SELECT * FROM channel_command WHERE kind = ? ORDER BY created_at, rowid').bind(kind).all<any>()
  .then((r) => r.results.map((row) => ({ ...row, payload: JSON.parse(row.payload_json) })));
const messages = () => db.prepare("SELECT * FROM message WHERE conversation_id = 'grp-1' ORDER BY created_at, rowid").all<any>().then((r) => r.results);

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

test('a group with the bot off queues nothing for a mention', async () => {
  expect(await ingest(groupMessage({ mentionsSelf: true, text: '@Long lịch học' }))).toEqual({ accepted: 1, rejected: 0 });
  expect(await commands('run_completion')).toHaveLength(0);

  await enableBot();
  await db.prepare('UPDATE customer_bot_switch SET enabled = 1 WHERE id = 1').run();
  await ingest(groupMessage({ mentionsSelf: true, text: '@Long lịch học' }));
  await db.prepare('UPDATE customer_bot_switch SET enabled = 0 WHERE id = 1').run();
  await db.prepare("UPDATE channel_account SET bot_enabled = 0 WHERE id = 'ca-1'").run();
  await ingest(groupMessage({ quotesSelf: true, text: 'tin cũ' }));
  expect(await commands('run_completion')).toHaveLength(0);
  expect(await group()).toMatchObject({ mode: 'ai' });
});

test('a mention, a quote and "Long ơi" each queue one group reply and nothing is coalesced', async () => {
  await enableBot();
  const before = Date.now();
  await ingest(groupMessage({ mentionsSelf: true, msgId: 'z-mention', text: '@Long nhắc lịch' }));
  await ingest(groupMessage({ quotesSelf: true, msgId: 'z-quote', senderExternalId: 'hv-minh', senderName: 'Minh', text: 'đúng tin này' }));
  await ingest(groupMessage({ msgId: 'z-call', text: 'Long ơi lịch mai' }));
  const replies = await commands('run_completion');
  expect(replies).toHaveLength(3);
  expect(replies.map((row) => row.payload.text)).toEqual([
    '[Nhóm Zalo "Lớp IELTS K1"] Lan: @Long nhắc lịch',
    '[Nhóm Zalo "Lớp IELTS K1"] Minh: đúng tin này',
    '[Nhóm Zalo "Lớp IELTS K1"] Lan: Long ơi lịch mai',
  ]);
  for (const row of replies) {
    expect(row).toMatchObject({ target: 'bridge', status: 'pending', channel_account_id: 'ca-1', conversation_id: 'grp-1' });
    expect(row.payload).toMatchObject({ agentKey: 'cham-soc-hoc-vien', userId: 'zalo:zalo-acc-1:g-1', conversationId: 'grp-1', purpose: 'reply' });
    expect(row.payload.replyTo.msgId).toBeTruthy();
    expect(Date.parse(row.next_run_at)).toBeGreaterThanOrEqual(before - 1000);
    expect(Date.parse(row.next_run_at)).toBeLessThan(before + 5000);
  }
  expect(replies[0].payload).toMatchObject({ zaloUserId: 'hv-lan', replyTo: { msgId: 'z-mention', senderId: 'hv-lan', senderName: 'Lan' } });
  expect(replies[1].payload).toMatchObject({ zaloUserId: 'hv-minh', replyTo: { msgId: 'z-quote', senderId: 'hv-minh', senderName: 'Minh' } });
  expect(replies[2].payload.replyTo).toEqual({ msgId: 'z-call', senderId: 'hv-lan', senderName: 'Lan' });
  expect(replies[0].dedupe_key).toBe(`completion:${(await messages())[0].id}`);
});

test('"long lanh" and a plain group message queue nothing', async () => {
  await enableBot();
  await ingest(groupMessage({ text: 'long lanh quá' }));
  await ingest(groupMessage({ text: 'Mai học bài gì ạ' }));
  expect(await commands('run_completion')).toHaveLength(0);
});

test('a decomposed "Long ơi" matches and "Long ới" does not', async () => {
  await enableBot();
  await ingest(groupMessage({ text: 'Long o\u031B\u0301i' }));
  expect(await commands('run_completion')).toHaveLength(0);
  await ingest(groupMessage({ text: 'Long \u01A1i'.normalize('NFD') }));
  const replies = await commands('run_completion');
  expect(replies).toHaveLength(1);
  expect(replies[0].payload.text).toContain('Long ơi');
});

test('a staff member message queues nothing and cancels a pending reply', async () => {
  await enableBot();
  await ingest(groupMessage({ mentionsSelf: true, text: '@Long lịch' }));
  expect(await commands('run_completion')).toHaveLength(1);
  await db.prepare(`INSERT INTO zalo_staff_member (channel_account_id, external_user_id, display_name, created_at)
    VALUES ('ca-1', 'hv-hung', 'Hùng', ?)`).bind(STAMP).run();
  await ingest(groupMessage({ senderExternalId: 'hv-hung', senderName: 'Hùng', mentionsSelf: true, text: '@Long để anh' }));
  const replies = await commands('run_completion');
  expect(replies).toHaveLength(1);
  expect(replies[0]).toMatchObject({ status: 'failed' });
  expect(replies[0].result_json).toBe('{"error":"GROUP_STAFF_SPOKE"}');
  expect(await group()).toMatchObject({ mode: 'ai', bot_paused_until: null });
});

test('someone typing on the bot account pauses the group and keeps ai mode', async () => {
  await enableBot();
  const before = Date.now();
  await ingest(groupMessage({ fromSelf: true, senderExternalId: 'zalo-acc-1', senderName: 'Số tư vấn 1', text: 'Mình trả lời tay' }));
  const row = await group();
  expect(row).toMatchObject({ mode: 'ai', staff_context_pending: null });
  const pause = Date.parse(String(row!.bot_paused_until));
  expect(pause).toBeGreaterThanOrEqual(before + GROUP_PAUSE_MS);
  expect(pause).toBeLessThanOrEqual(Date.now() + GROUP_PAUSE_MS);
  await ingest(groupMessage({ mentionsSelf: true, text: '@Long còn không' }));
  expect(await commands('run_completion')).toHaveLength(0);
});

test('the echo of a bot group reply does not pause the group', async () => {
  await enableBot();
  const sentAt = new Date().toISOString();
  await db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, body, status, created_at)
    VALUES ('m-bot', 'grp-1', 'out', 'bot', '@Lan Dạ em chào bạn', 'pending', ?)`).bind(sentAt).run();
  await ingest(groupMessage({
    fromSelf: true, senderExternalId: 'zalo-acc-1', senderName: 'Số tư vấn 1', text: '@Lan Dạ em chào bạn', msgId: 'echo-1',
  }));
  expect(await messages()).toHaveLength(1);
  expect(await db.prepare("SELECT status, external_msg_id FROM message WHERE id = 'm-bot'").first())
    .toEqual({ status: 'sent', external_msg_id: 'echo-1' });
  expect(await group()).toMatchObject({ mode: 'ai', bot_paused_until: null });
});

test('a web reply in a group pauses the bot and does not take the conversation over', async () => {
  await enableBot();
  await ingest(groupMessage({ mentionsSelf: true, text: '@Long lịch' }));
  const sent = await web('u-lan', 'POST', '/inbox/conversations/grp-1/messages', { text: 'Cô gửi lịch ở đây nhé' });
  expect(sent.status, JSON.stringify(sent.json)).toBe(200);
  expect(sent.json.data).toMatchObject({ mode: 'ai', assigneeUserId: null });
  const row = await group();
  expect(row).toMatchObject({ mode: 'ai', assignee_user_id: null, staff_context_pending: null });
  expect(row!.bot_paused_until).toBeTruthy();
  expect((await commands('run_completion'))[0]).toMatchObject({ status: 'failed', result_json: '{"error":"GROUP_STAFF_SPOKE"}' });
});

test('a completion sends one group reply that quotes the learner', async () => {
  await enableBot();
  const outcome = await applyCompletionResult(db, { APP_URL }, 'grp-1', 'Dạ em gửi lịch ạ', undefined, {
    replyTo: { msgId: 'z-1', senderId: 'hv-lan', senderName: 'Lan' },
  });
  expect(outcome).toEqual({ workerCommandQueued: false });
  const out = (await messages()).at(-1);
  expect(out).toMatchObject({ direction: 'out', sender_kind: 'bot', status: 'pending', body: '@Lan Dạ em gửi lịch ạ' });
  const [send] = await commands('send_zalo');
  expect(send.payload).toEqual({
    messageId: out.id, threadId: 'g-1', threadKind: 'group', text: 'Dạ em gửi lịch ạ',
    replyTo: { msgId: 'z-1', senderId: 'hv-lan', senderName: 'Lan' },
  });
});

test('a staff message after the trigger drops the reply as a cancelled note', async () => {
  await enableBot();
  await db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, sender_external_id, body, status, created_at)
    VALUES ('trig-1', 'grp-1', 'in', 'customer', 'hv-lan', 'Lịch học ngày mai', 'received', '2026-10-13T01:00:00.000Z')`).run();
  await db.prepare(`INSERT INTO zalo_staff_member (channel_account_id, external_user_id, display_name, created_at)
    VALUES ('ca-1', 'hv-hung', 'Hùng', ?)`).bind(STAMP).run();
  await db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, sender_external_id, body, status, created_at)
    VALUES ('staff-1', 'grp-1', 'in', 'customer', 'hv-hung', 'Để anh trả lời', 'received', '2026-10-13T01:00:05.000Z')`).run();
  await applyCompletionResult(db, { APP_URL }, 'grp-1', 'Dạ em gửi lịch ạ', undefined, {
    triggerMessageId: 'trig-1', replyTo: { msgId: 'z-1', senderId: 'hv-lan', senderName: 'Lan' },
  });
  expect(await commands('send_zalo')).toHaveLength(0);
  expect((await messages()).at(-1)).toMatchObject({
    sender_kind: 'system', status: 'failed', body: '[Bot trả lời bị huỷ vì đã chuyển người] Dạ em gửi lịch ạ',
  });
  expect(await group()).toMatchObject({ mode: 'ai' });
});

test('a handoff marker in a group notifies Lark and stays in ai mode', async () => {
  await enableBot();
  await db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, sender_external_id, body, status, created_at)
    VALUES ('trig-1', 'grp-1', 'in', 'customer', 'hv-lan', 'Lịch học ngày mai', 'received', '2026-10-13T01:00:00.000Z')`).run();
  const outcome = await applyCompletionResult(db, { APP_URL }, 'grp-1', 'Dạ em chuyển người hỗ trợ.\n[HANDOFF: cần giáo viên]', undefined, {
    triggerMessageId: 'trig-1', replyTo: { msgId: 'z-1', senderId: 'hv-lan', senderName: 'Lan' }, commandId: 'cmd-h',
  });
  expect(outcome).toEqual({ workerCommandQueued: true });
  expect((await messages()).filter((row) => row.sender_kind === 'bot').at(-1)?.body).toBe('@Lan Dạ em chuyển người hỗ trợ.');
  const [notice] = await commands('send_lark');
  expect(notice.dedupe_key).toBe('group-help:cmd-h');
  expect(notice.payload.text).toBe(
    `Nhóm Zalo cần hỗ trợ: Lớp IELTS K1 (Số tư vấn 1) – Lan hỏi: "Lịch học ngày mai" – cần giáo viên – ${APP_URL}/inbox/grp-1`,
  );
  expect(await group()).toMatchObject({ mode: 'ai', handoff_reason: null });

  await notifyGroupHelp(db, { APP_URL }, 'grp-1', 'cần giáo viên', 'trig-1', undefined,
    { commandId: 'cmd-h', replyTo: { msgId: 'z-1', senderId: 'hv-lan', senderName: 'Lan' } });
  expect(await commands('send_lark')).toHaveLength(1);
});

test('a failed or stale group reply notifies Lark once and does not change mode', async () => {
  await enableBot();
  await ingest(groupMessage({ mentionsSelf: true, text: 'Lịch học ngày mai' }));
  const [reply] = await commands('run_completion');
  await db.prepare("UPDATE channel_command SET status = 'claimed', attempts = 5, lease_expires_at = ? WHERE id = ?")
    .bind(new Date(Date.now() + 60_000).toISOString(), reply.id).run();
  const failed = await bridge(`/commands/${reply.id}/result`, { attempts: 5, ok: false, error: 'GOCLAW_HTTP_500' });
  expect(failed.json.data).toEqual({ ignored: false });
  const notices = await commands('send_lark');
  expect(notices).toHaveLength(1);
  expect(notices[0].dedupe_key).toBe(`group-help:${reply.id}`);
  expect(notices[0].payload.text).toContain('Nhóm Zalo cần hỗ trợ');
  expect(notices[0].payload.text).toContain(BOT_SILENT_REASON);
  expect(await group()).toMatchObject({ mode: 'ai' });

  await db.prepare('DELETE FROM channel_command').run();
  const staleId = await enqueueCommand(db, {
    kind: 'run_completion', target: 'bridge', channelAccountId: 'ca-1', conversationId: 'grp-1',
    payload: {
      agentKey: 'cham-soc-hoc-vien', userId: 'zalo:zalo-acc-1:g-1', text: 'x', conversationId: 'grp-1', purpose: 'reply',
      triggerMessageId: (await messages())[0].id, replyTo: { msgId: 'z-stale', senderId: 'hv-lan', senderName: 'Lan' },
    },
    dedupeKey: 'stale-group',
  });
  const old = new Date(Date.now() - 11 * 60_000).toISOString();
  await db.prepare("UPDATE channel_command SET created_at = ?, next_run_at = ? WHERE id = ?").bind(old, old, staleId).run();
  expect(await abandonStaleReplies(db, { APP_URL })).toBe(1);
  const staleNotices = (await commands('send_lark')).filter((row) => row.dedupe_key === `group-help:${staleId}`);
  expect(staleNotices).toHaveLength(1);
  expect(staleNotices[0].payload.text).toContain('Nhóm Zalo cần hỗ trợ');
  expect(await group()).toMatchObject({ mode: 'ai' });
});

test('group member events upsert the roster', async () => {
  const members = Array.from({ length: 101 }, (_, i) => ({ id: `m-${i}`, name: i === 0 ? 'Lan' : `Bạn ${i}` }));
  expect(await ingest({
    type: 'group_members', accountExternalId: 'zalo-acc-1', threadId: 'g-1', members,
  })).toEqual({ accepted: 1, rejected: 0 });
  expect(await db.prepare("SELECT COUNT(*) AS n FROM zalo_group_member WHERE conversation_id = 'grp-1'").first()).toEqual({ n: 101 });
  await ingest({
    type: 'group_members', accountExternalId: 'zalo-acc-1', threadId: 'g-1',
    members: [{ id: 'm-0', name: 'Lan updated' }, { id: 'm-new', name: 'Mới' }],
  });
  expect(await db.prepare("SELECT display_name FROM zalo_group_member WHERE conversation_id = 'grp-1' AND external_user_id = 'm-0'").first())
    .toEqual({ display_name: 'Lan updated' });
  expect(await db.prepare("SELECT COUNT(*) AS n FROM zalo_group_member WHERE conversation_id = 'grp-1'").first()).toEqual({ n: 102 });
  expect(await ingest({
    type: 'group_members', accountExternalId: 'zalo-acc-1', threadId: 'missing-group', members: [{ id: 'x', name: 'X' }],
  })).toEqual({ accepted: 1, rejected: 0 });
  expect(await db.prepare('SELECT COUNT(*) AS n FROM zalo_group_member').first()).toEqual({ n: 102 });
});

test('group settings and staff marks follow the role rules', async () => {
  expect((await web('u-lan', 'PATCH', '/inbox/groups/grp-1', { botReplyEnabled: true })).status).toBe(403);
  expect((await web('u-lan', 'PATCH', '/inbox/groups/grp-1', {})).status).toBe(422);
  const enabled = await web('u-hung', 'PATCH', '/inbox/groups/grp-1', { botReplyEnabled: true });
  expect(enabled.status, JSON.stringify(enabled.json)).toBe(200);
  expect(enabled.json.data).toMatchObject({ botReplyEnabled: true, agentKey: null, botPausedUntil: null });
  expect((await web('u-hung', 'PATCH', '/inbox/groups/grp-1', { agentKey: 'other-agent' })).status).toBe(403);
  const custom = await web('u-admin', 'PATCH', '/inbox/groups/grp-1', { agentKey: 'other-agent' });
  expect(custom.json.data.agentKey).toBe('other-agent');
  expect((await web('u-admin', 'PATCH', '/inbox/groups/grp-1', { agentKey: null })).json.data.agentKey).toBeNull();
  const audit = await db.prepare("SELECT before_json, after_json FROM audit_log WHERE command = 'inbox.updateGroup' ORDER BY created_at, rowid").all<any>();
  expect(JSON.parse(audit.results[0].after_json)).toMatchObject({ botReplyEnabled: true, agentKey: null });

  await ingest({
    type: 'group_members', accountExternalId: 'zalo-acc-1', threadId: 'g-1',
    members: [{ id: 'hv-an', name: 'An' }, { id: 'hv-lan', name: 'Lan' }, { id: 'hv-minh', name: 'Minh' }],
  });
  expect((await web('u-lan', 'PUT', '/inbox/groups/grp-1/members/hv-minh/staff', { isStaff: true })).status).toBe(403);
  expect((await web('u-hung', 'PUT', '/inbox/groups/grp-1/members/nobody/staff', { isStaff: true })).status).toBe(404);
  expect((await web('u-hung', 'PUT', '/inbox/groups/missing/members/hv-minh/staff', { isStaff: true })).status).toBe(404);
  expect((await web('u-hung', 'PUT', '/inbox/groups/grp-1/members/hv-minh/staff', { isStaff: true })).json.data).toEqual({ externalUserId: 'hv-minh', isStaff: true });
  const listed = await web('u-lan', 'GET', '/inbox/groups/grp-1/members');
  expect(listed.status).toBe(200);
  expect(listed.json.data.map((row: { externalUserId: string; isStaff: boolean }) => [row.externalUserId, row.isStaff])).toEqual([
    ['hv-minh', true], ['hv-an', false], ['hv-lan', false],
  ]);
  expect((await web('u-hung', 'PUT', '/inbox/groups/grp-1/members/hv-minh/staff', { isStaff: false })).json.data.isStaff).toBe(false);
  expect((await web('u-lan', 'GET', '/inbox/groups/grp-1/members')).json.data.every((row: { isStaff: boolean }) => !row.isStaff)).toBe(true);

  await web('u-admin', 'PATCH', '/inbox/groups/grp-1', { agentKey: 'other-agent', botReplyEnabled: true });
  await ingest(groupMessage({ mentionsSelf: true, text: '@Long lịch' }));
  expect((await commands('run_completion'))[0].payload.agentKey).toBe('other-agent');
});

test('a bot reply in a group does not use the daily send cap', async () => {
  const dayStart = vnDayStart(MONDAY_10).toISOString();
  await db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, body, status, created_at)
    VALUES ('m-direct', 'conv-1', 'out', 'bot', 'Chào', 'pending', ?),
           ('m-group', 'grp-1', 'out', 'bot', '@Lan Dạ', 'pending', ?),
           ('m-staff', 'grp-1', 'out', 'staff_web', 'Cô gửi', 'pending', ?)`).bind(MONDAY_10.toISOString(), MONDAY_10.toISOString(), MONDAY_10.toISOString()).run();
  const stamp = async (dedupeKey: string) => {
    await db.prepare('UPDATE channel_command SET created_at = ? WHERE dedupe_key = ?').bind(MONDAY_10.toISOString(), dedupeKey).run();
  };
  await enqueueCommand(db, { kind: 'send_zalo', target: 'bridge', channelAccountId: 'ca-1', conversationId: 'conv-1', payload: { messageId: 'm-direct', text: 'Chào' }, dedupeKey: 'direct' });
  await enqueueCommand(db, {
    kind: 'send_zalo', target: 'bridge', channelAccountId: 'ca-1', conversationId: 'grp-1',
    payload: { messageId: 'm-group', threadKind: 'group', text: 'Dạ', replyTo: { msgId: 'z-1', senderId: 'hv-lan', senderName: 'Lan' } },
    dedupeKey: 'group-reply',
  });
  await enqueueCommand(db, { kind: 'send_zalo', target: 'bridge', channelAccountId: 'ca-1', conversationId: 'grp-1', payload: { messageId: 'm-staff', text: 'Cô gửi' }, dedupeKey: 'staff' });
  await stamp('direct');
  await stamp('group-reply');
  await stamp('staff');
  // The direct bot send and the staff send count. The group bot reply does not.
  expect(await accountSendsToday(db, 'ca-1', dayStart)).toBe(2);

  await db.prepare("DELETE FROM channel_command WHERE dedupe_key IN ('direct', 'staff')").run();
  await db.prepare("UPDATE channel_account SET daily_send_cap = 1 WHERE id = 'ca-1'").run();
  await db.prepare('UPDATE inbox_setting SET scheduled_sends_enabled = 1 WHERE id = 1').run();
  await db.prepare(`INSERT INTO group_schedule (id, conversation_id, template_text, weekdays_mask, time_of_day, status,
      approved_by_user_id, approved_at, next_run_at, created_by_user_id, created_at, updated_at)
    VALUES ('s-1', 'grp-1', 'Nhắc lịch học tối nay 19:00', 127, '09:00', 'active', 'u-mai', ?, ?, 'u-hung', ?, ?)`)
    .bind(STAMP, MONDAY_10.toISOString(), STAMP, STAMP).run();
  expect(await runDueSchedules(db, MONDAY_10, () => 0)).toEqual({ sent: 1, skipped: 0 });

  // A scheduled group post is a bot message too, but it still uses up the cap.
  expect(await accountSendsToday(db, 'ca-1', dayStart)).toBe(1);
  await db.prepare(`INSERT INTO group_schedule (id, conversation_id, template_text, weekdays_mask, time_of_day, status,
      approved_by_user_id, approved_at, next_run_at, created_by_user_id, created_at, updated_at)
    VALUES ('s-2', 'grp-1', 'Nhắc nộp bài', 127, '09:00', 'active', 'u-mai', ?, ?, 'u-hung', ?, ?)`)
    .bind(STAMP, MONDAY_10.toISOString(), STAMP, STAMP).run();
  expect(await runDueSchedules(db, MONDAY_10, () => 0)).toEqual({ sent: 0, skipped: 1 });
});
