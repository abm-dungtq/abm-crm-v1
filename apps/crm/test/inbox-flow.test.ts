import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';
import { applyCompletionResult } from '../src/worker/inbox/conversation-flow';
import { enqueueCommand } from '../src/worker/inbox/dispatcher';
import { ingestEvents } from '../src/worker/inbox/ingest';
import { processWorkerCommands } from '../src/worker/inbox/worker-commands';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
const ORIGIN = 'http://crm.test';
const STAMP = '2026-10-08T03:00:00.000Z';
const APP_URL = 'https://crm.example';
const lark = { LARK_APP_ID: 'cli_fake', LARK_APP_SECRET: 'fake-secret-value-123', LARK_INBOX_CHAT_ID: 'oc_inbox' };
const testEnv = { ...env, DEMO_MODE: '1', APP_URL };

beforeEach(async () => {
  await resetDb(db, seedSql);
  await db.batch([
    db.prepare(`INSERT INTO channel_account (id, organization_id, channel, external_id, display_name, agent_key, status, created_at, updated_at)
      VALUES ('ca-1', 'org-abm', 'zalo', 'zalo-acc-1', 'Số tư vấn 1', 'sales-bot', 'connected', ?, ?)`).bind(STAMP, STAMP),
    db.prepare(`INSERT INTO app_user (id, organization_id, display_name, email, role, created_at, updated_at)
      VALUES ('u-teacher', 'org-abm', 'Giáo viên A', 'teacher@demo.abm.example', 'teacher', ?, ?)`).bind(STAMP, STAMP),
  ]);
});
afterEach(() => vi.restoreAllMocks());

let msgSeq = 0;
const message = (overrides: Record<string, unknown> = {}) => ({
  type: 'message' as const, accountExternalId: 'zalo-acc-1', threadId: 'cust-1', threadKind: 'direct' as const,
  msgId: `zm-${++msgSeq}`, fromSelf: false, senderExternalId: 'cust-1', senderName: 'Chị Hoa', text: 'Cho em hỏi lịch học',
  sentAt: new Date().toISOString(), ...overrides,
});
const ingest = (...events: ReturnType<typeof message>[]) => ingestEvents(db, events);
const conversation = () => db.prepare("SELECT * FROM conversation WHERE external_thread_id = 'cust-1'").first<any>();
const commands = (kind: string) => db.prepare('SELECT * FROM channel_command WHERE kind = ? ORDER BY created_at').bind(kind).all<any>()
  .then((r) => r.results.map((row) => ({ ...row, payload: JSON.parse(row.payload_json) })));
const messages = (conversationId: string) =>
  db.prepare('SELECT * FROM message WHERE conversation_id = ? ORDER BY created_at, rowid').bind(conversationId).all<any>().then((r) => r.results);

async function web(user: string, method: string, path: string, body?: unknown) {
  const res = await app.fetch(new Request(`${ORIGIN}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Demo-User': user },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), testEnv);
  return { status: res.status, json: await res.json() as any };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
/** Fakes Lark: the token call succeeds and every message is recorded. */
function fakeLark() {
  const sent: { url: string; receiveId: string; text: string }[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/auth/v3/tenant_access_token/internal')) return json({ code: 0, tenant_access_token: 't-fake', expire: 7200 });
    if (url.includes('/im/v1/messages')) {
      const body = JSON.parse(String(init!.body)) as { receive_id: string; content: string };
      sent.push({ url, receiveId: body.receive_id, text: JSON.parse(body.content).text });
      return json({ code: 0, data: {} });
    }
    return json({ code: 404 }, 404);
  });
  return { spy, sent };
}

test('a customer message in ai mode queues one delayed reply that later messages extend', async () => {
  const before = Date.now();
  expect(await ingest(message({ text: 'Cho em hỏi lịch học' }))).toEqual({ accepted: 1, rejected: 0 });
  const after = Date.now();
  const conv = await conversation();
  expect(conv).toMatchObject({ kind: 'direct', mode: 'ai', display_name: 'Chị Hoa' });
  expect(conv.last_inbound_at).toBeTruthy();
  const [first] = await messages(conv.id);
  const [command] = await commands('run_completion');
  expect(command).toMatchObject({ target: 'bridge', status: 'pending', channel_account_id: 'ca-1', conversation_id: conv.id, dedupe_key: `completion:${first.id}` });
  expect(command.payload).toEqual({ agentKey: 'sales-bot', userId: 'zalo:zalo-acc-1:cust-1', text: 'Cho em hỏi lịch học', conversationId: conv.id, purpose: 'reply' });
  const runAt = Date.parse(command.next_run_at);
  expect(runAt).toBeGreaterThanOrEqual(before + 8000);
  expect(runAt).toBeLessThanOrEqual(after + 8000);

  await ingest(message({ text: 'Tối thứ mấy ạ' }));
  const all = await commands('run_completion');
  expect(all).toHaveLength(1);
  expect(all[0].payload.text).toBe('Cho em hỏi lịch học\nTối thứ mấy ạ');
  expect(Date.parse(all[0].next_run_at)).toBeGreaterThanOrEqual(runAt);
});

test('no reply is queued while the customer bot is off, the account bot is off, or in a group', async () => {
  await db.prepare('UPDATE customer_bot_switch SET enabled = 1 WHERE id = 1').run();
  await ingest(message());
  expect(await commands('run_completion')).toHaveLength(0);

  await db.prepare('UPDATE customer_bot_switch SET enabled = 0 WHERE id = 1').run();
  await db.prepare("UPDATE channel_account SET bot_enabled = 0 WHERE id = 'ca-1'").run();
  await ingest(message());
  expect(await commands('run_completion')).toHaveLength(0);

  await db.prepare("UPDATE channel_account SET bot_enabled = 1 WHERE id = 'ca-1'").run();
  await ingest(message({ threadId: 'grp-1', threadKind: 'group', senderExternalId: 'member-1' }));
  expect(await commands('run_completion')).toHaveLength(0);
  expect(await db.prepare("SELECT kind, mode FROM conversation WHERE external_thread_id = 'grp-1'").first()).toEqual({ kind: 'group', mode: 'ai' });
});

test('a message typed on the shared phone switches the conversation to people', async () => {
  await ingest(message());
  await ingest(message({ fromSelf: true, senderExternalId: 'zalo-acc-1', senderName: 'Số tư vấn 1', text: 'Chị chờ em gọi lại nhé' }));
  const conv = await conversation();
  expect(conv).toMatchObject({ mode: 'human', assignee_user_id: null, display_name: 'Chị Hoa' });
  expect(conv.last_staff_reply_at).toBeTruthy();
  expect(conv.staff_context_pending).toContain('Chị chờ em gọi lại nhé');
  const rows = await messages(conv.id);
  expect(rows.at(-1)).toMatchObject({ direction: 'out', sender_kind: 'staff_phone', body: 'Chị chờ em gọi lại nhé', status: 'sent' });
});

test('the echo of a message the bot just sent is not stored again and keeps ai mode', async () => {
  await ingest(message());
  const conv = await conversation();
  await db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, body, status, created_at)
    VALUES ('m-bot', ?, 'out', 'bot', 'Xin chào', 'sent', ?)`).bind(conv.id, new Date(Date.now() - 60_000).toISOString()).run();
  const before = (await messages(conv.id)).length;
  expect(await ingest(message({ fromSelf: true, senderExternalId: 'zalo-acc-1', text: 'Xin chào', msgId: 'zm-echo' }))).toEqual({ accepted: 1, rejected: 0 });
  expect(await messages(conv.id)).toHaveLength(before);
  expect((await conversation()).mode).toBe('ai');
  expect(await db.prepare("SELECT external_msg_id FROM message WHERE id = 'm-bot'").first()).toEqual({ external_msg_id: 'zm-echo' });
});

test('a short staff reply contained in a recent bot message is not taken for its echo', async () => {
  await ingest(message());
  const conv = await conversation();
  await db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, body, status, created_at)
    VALUES ('m-bot', ?, 'out', 'bot', 'Xin chào bạn, ok nhé', 'sent', ?)`).bind(conv.id, new Date(Date.now() - 30_000).toISOString()).run();
  await ingest(message({ fromSelf: true, senderExternalId: 'zalo-acc-1', text: 'ok', msgId: 'zm-ok' }));
  expect((await conversation()).mode).toBe('human');
  expect((await messages(conv.id)).at(-1)).toMatchObject({ sender_kind: 'staff_phone', body: 'ok' });
});

test('an empty fromSelf text never matches an earlier message as its echo', async () => {
  await ingest(message());
  const conv = await conversation();
  await db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, body, status, created_at)
    VALUES ('m-bot', ?, 'out', 'bot', 'Xin chào', 'sent', ?)`).bind(conv.id, new Date().toISOString()).run();
  await ingest(message({ fromSelf: true, senderExternalId: 'zalo-acc-1', text: '', attachments: [{ url: 'https://zalo.example/a.jpg' }] }));
  expect((await conversation()).mode).toBe('human');
  expect((await messages(conv.id)).at(-1)).toMatchObject({ sender_kind: 'staff_phone', body: '' });
});

test('the echo of a bridge send is matched by its command and records the Zalo id', async () => {
  await ingest(message());
  const conv = await conversation();
  await db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, body, status, created_at)
    VALUES ('m-bot', ?, 'out', 'bot', 'Lịch học tối thứ 3', 'pending', ?)`).bind(conv.id, new Date().toISOString()).run();
  const commandId = await enqueueCommand(db, { kind: 'send_zalo', target: 'bridge', channelAccountId: 'ca-1', conversationId: conv.id, payload: { messageId: 'm-bot', text: 'Lịch học tối thứ 3' } });
  const before = (await messages(conv.id)).length;
  await ingest(message({ fromSelf: true, senderExternalId: 'zalo-acc-1', text: 'Nội dung khác', msgId: 'zm-sent', commandId }));
  expect(await messages(conv.id)).toHaveLength(before);
  expect(await db.prepare("SELECT status, external_msg_id FROM message WHERE id = 'm-bot'").first()).toEqual({ status: 'sent', external_msg_id: 'zm-sent' });
  expect((await conversation()).mode).toBe('ai');
});

test('a reply with a handoff marker sends the text without the marker and notifies the Lark group', async () => {
  await ingest(message());
  const conv = await conversation();
  const outcome = await applyCompletionResult(db, { APP_URL }, conv.id, 'Dạ em chuyển chị sang tư vấn viên ạ.\n[HANDOFF: khách hỏi học bổng]');
  expect(outcome).toEqual({ workerCommandQueued: true });
  const out = (await messages(conv.id)).at(-1);
  expect(out).toMatchObject({ direction: 'out', sender_kind: 'bot', status: 'pending', body: 'Dạ em chuyển chị sang tư vấn viên ạ.' });
  const [send] = await commands('send_zalo');
  expect(send).toMatchObject({ target: 'bridge', channel_account_id: 'ca-1', dedupe_key: `send:${out.id}` });
  expect(send.payload).toEqual({ messageId: out.id, threadId: 'cust-1', threadKind: 'direct', text: 'Dạ em chuyển chị sang tư vấn viên ạ.' });
  expect(await conversation()).toMatchObject({ mode: 'human', handoff_reason: 'khách hỏi học bổng' });
  const [notice] = await commands('send_lark');
  expect(notice).toMatchObject({ target: 'worker', status: 'pending' });
  expect(notice.payload.text).toBe(`Handoff: Chị Hoa (Số tư vấn 1) – khách hỏi học bổng – ${APP_URL}/inbox/${conv.id}`);
  expect(await db.prepare("SELECT actor_kind FROM audit_log WHERE command = 'inbox.handoff' AND entity_id = ?").bind(conv.id).first())
    .toEqual({ actor_kind: 'system' });

  const { sent } = fakeLark();
  await processWorkerCommands({ ...env, ...lark });
  expect(sent).toEqual([{ url: expect.stringContaining('receive_id_type=chat_id'), receiveId: 'oc_inbox', text: notice.payload.text }]);
  expect((await commands('send_lark'))[0].status).toBe('done');
});

test('a Lark notice without a configured group chat fails without calling Lark', async () => {
  const id = await enqueueCommand(db, { kind: 'send_lark', target: 'worker', payload: { text: 'Handoff: test' } });
  const { spy } = fakeLark();
  await processWorkerCommands({ ...env, LARK_APP_ID: lark.LARK_APP_ID, LARK_APP_SECRET: lark.LARK_APP_SECRET });
  expect(spy).not.toHaveBeenCalled();
  const row = await db.prepare('SELECT status, attempts, result_json FROM channel_command WHERE id = ?').bind(id).first<any>();
  expect(row).toMatchObject({ status: 'pending', attempts: 1 });
  expect(JSON.parse(row.result_json)).toEqual({ error: 'LARK_NOT_CONFIGURED' });
});

test('a reply that arrives after people took over is kept as a cancelled note and not sent', async () => {
  await ingest(message());
  const conv = await conversation();
  await db.prepare("UPDATE conversation SET mode = 'human' WHERE id = ?").bind(conv.id).run();
  await applyCompletionResult(db, { APP_URL }, conv.id, 'Học phí là 5 triệu ạ');
  expect(await commands('send_zalo')).toHaveLength(0);
  expect((await messages(conv.id)).at(-1)).toMatchObject({ sender_kind: 'system', body: '[Bot trả lời bị huỷ vì đã chuyển người] Học phí là 5 triệu ạ' });
});

test('after returning to ai the next bot turn starts with what staff discussed', async () => {
  await ingest(message());
  const conv = await conversation();
  expect((await web('u-lan', 'POST', `/inbox/conversations/${conv.id}/messages`, { text: 'Em gửi chị lịch học nhé' })).status).toBe(200);
  await ingest(message({ text: 'Cảm ơn em' }));
  expect((await conversation()).staff_context_pending).toBe('Nhân viên: Em gửi chị lịch học nhé\nKhách: Cảm ơn em');
  await db.prepare('DELETE FROM channel_command').run();

  const mode = await web('u-lan', 'POST', `/inbox/conversations/${conv.id}/mode`, { mode: 'ai' });
  expect(mode).toEqual({ status: 200, json: { ok: true, data: { mode: 'ai', assigneeUserId: 'u-lan' } } });
  await ingest(message({ text: 'Lớp còn chỗ không em' }));
  // Returning to ai also asks the CRM extractor to read the conversation; the bot reply is the `reply` completion.
  const completions = await commands('run_completion');
  const reply = completions.find((c) => c.payload.purpose === 'reply');
  expect(reply?.payload.text).toBe('[Nhân viên đã trao đổi: Nhân viên: Em gửi chị lịch học nhé\nKhách: Cảm ơn em]\nLớp còn chỗ không em');
  expect(completions.filter((c) => c.payload.purpose === 'extract')).toHaveLength(1);
  expect((await conversation()).staff_context_pending).toBeNull();
});

test('the pending staff context keeps only its last 1500 characters', async () => {
  await ingest(message());
  const conv = await conversation();
  await db.prepare("UPDATE conversation SET mode = 'human' WHERE id = ?").bind(conv.id).run();
  await ingest(message({ text: 'a'.repeat(1000) }));
  await ingest(message({ text: `${'b'.repeat(999)}Z` }));
  const pending = (await conversation()).staff_context_pending as string;
  expect(pending).toHaveLength(1500);
  expect(pending.endsWith(`${'b'.repeat(999)}Z`)).toBe(true);
});

test('staff writing in ai mode take over and become the assignee', async () => {
  await ingest(message());
  const conv = await conversation();
  const res = await web('u-lan', 'POST', `/inbox/conversations/${conv.id}/messages`, { text: '  Chào chị, em là Lan  ' });
  expect(res.status).toBe(200);
  expect(res.json.data).toMatchObject({ mode: 'human', assigneeUserId: 'u-lan' });
  expect(await conversation()).toMatchObject({ mode: 'human', assignee_user_id: 'u-lan' });
  const out = (await messages(conv.id)).at(-1);
  expect(out).toMatchObject({ id: res.json.data.messageId, direction: 'out', sender_kind: 'staff_web', sent_by_user_id: 'u-lan', body: 'Chào chị, em là Lan', status: 'pending' });
  const [send] = await commands('send_zalo');
  expect(send.payload).toMatchObject({ messageId: out.id, text: 'Chào chị, em là Lan' });
  expect(await db.prepare("SELECT actor_user_id FROM audit_log WHERE command = 'inbox.staffSend'").first()).toEqual({ actor_user_id: 'u-lan' });

  // Someone else writing later does not take the assignment.
  await web('u-long', 'POST', `/inbox/conversations/${conv.id}/messages`, { text: 'Em bổ sung' });
  expect((await conversation()).assignee_user_id).toBe('u-lan');
  expect((await web('u-lan', 'POST', `/inbox/conversations/${conv.id}/messages`, { text: '' })).status).toBe(422);
  expect((await web('u-lan', 'POST', `/inbox/conversations/${conv.id}/messages`, { text: 'x'.repeat(2001) })).status).toBe(422);
});

test('taking over an unassigned conversation assigns it to the person who clicked', async () => {
  await ingest(message());
  const conv = await conversation();
  const res = await web('u-hung', 'POST', `/inbox/conversations/${conv.id}/mode`, { mode: 'human' });
  expect(res.json.data).toEqual({ mode: 'human', assigneeUserId: 'u-hung' });
  expect((await web('u-hung', 'POST', `/inbox/conversations/${conv.id}/mode`, { mode: 'off' })).status).toBe(422);
  expect((await web('u-hung', 'POST', '/inbox/conversations/missing/mode', { mode: 'ai' })).status).toBe(404);
});

test('inbox roles list conversations; other roles and non-admin account changes are refused', async () => {
  await ingest(message());
  const list = await web('u-lan', 'GET', '/inbox/conversations?mode=ai');
  expect(list.status).toBe(200);
  expect(list.json.data).toHaveLength(1);
  expect(list.json.data[0]).toMatchObject({ displayName: 'Chị Hoa', accountName: 'Số tư vấn 1', lastMessageBody: 'Cho em hỏi lịch học', assigneeName: null });
  expect((await web('u-lan', 'GET', `/inbox/conversations/${list.json.data[0].id}/messages`)).json.data).toHaveLength(1);

  const teacher = await web('u-teacher', 'GET', '/inbox/conversations');
  expect(teacher).toEqual({ status: 403, json: { ok: false, error: { code: 'FORBIDDEN', message: 'Vai trò hiện tại không xem được mục này' } } });
  expect((await web('u-lan', 'POST', '/inbox/accounts', { displayName: 'Số 2', agentKey: 'sales-bot' })).status).toBe(403);
  expect((await web('u-lan', 'PUT', '/inbox/customer-bot-switch', { enabled: true })).status).toBe(403);
  expect((await web('u-lan', 'GET', `/inbox/conversations?q=${'a'.repeat(101)}`)).status).toBe(422);
});

test('admins manage channel accounts and the customer bot switch', async () => {
  const created = await web('u-admin', 'POST', '/inbox/accounts', { displayName: 'Số tư vấn 2', agentKey: 'sales-bot' });
  expect(created.status).toBe(200);
  const id = created.json.data.id;
  expect(created.json.data).toMatchObject({ channel: 'zalo', status: 'disconnected', botEnabled: true, sendPaused: false });
  const patched = await web('u-admin', 'PATCH', `/inbox/accounts/${id}`, { sendPaused: true, quietStart: '21:00', quietEnd: '07:30' });
  expect(patched.json.data).toMatchObject({ sendPaused: true, quietStart: '21:00', quietEnd: '07:30' });
  expect((await web('u-admin', 'PATCH', `/inbox/accounts/${id}`, { quietEnd: null })).status).toBe(422);

  const login = await web('u-admin', 'POST', `/inbox/accounts/${id}/connect`);
  const again = await web('u-admin', 'POST', `/inbox/accounts/${id}/connect`);
  expect(again.json.data.commandId).toBe(login.json.data.commandId);
  const [cmd] = await commands('zalo_login');
  expect(cmd).toMatchObject({ target: 'bridge', channel_account_id: id });
  expect(cmd.dedupe_key).toMatch(new RegExp(`^login:${id}:\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$`));
  await web('u-admin', 'POST', `/inbox/accounts/${id}/disconnect`);
  expect(await commands('zalo_logout')).toHaveLength(1);

  await db.prepare("UPDATE channel_account SET qr_image = 'data:image/png;base64,QQ==' WHERE id = ?").bind(id).run();
  const adminView = (await web('u-admin', 'GET', '/inbox/accounts')).json.data.find((a: { id: string }) => a.id === id);
  const saleView = (await web('u-lan', 'GET', '/inbox/accounts')).json.data.find((a: { id: string }) => a.id === id);
  expect(adminView.qrImage).toBe('data:image/png;base64,QQ==');
  expect(saleView.qrImage).toBeNull();

  expect((await web('u-admin', 'PUT', '/inbox/customer-bot-switch', { enabled: true })).json.data.enabled).toBe(true);
  expect((await web('u-admin', 'GET', '/inbox/customer-bot-switch')).json.data.enabled).toBe(true);
  expect(await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE command LIKE 'inbox.%'").first()).toEqual({ n: 6 });
});
