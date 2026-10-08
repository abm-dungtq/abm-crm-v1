import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';
import { applyCompletionResult } from '../src/worker/inbox/conversation-flow';
import { GRAPH_API_VERSION, OUTSIDE_WINDOW_NOTE, messengerDelivery, splitMessengerText } from '../src/worker/inbox/facebook-send';
import { processWorkerCommands } from '../src/worker/inbox/worker-commands';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
const ORIGIN = 'http://crm.test';
const STAMP = '2026-10-08T03:00:00.000Z';
const PAGE_ID = '1001';
const PSID = '7001';
const APP_SECRET = 'test-fb-app-secret';
const VERIFY_TOKEN = 'test-verify-token';
const PAGE_TOKEN = 'EAAtest-page-token';
const testEnv = {
  ...env, DEMO_MODE: '1', APP_URL: 'https://crm.example',
  FB_APP_SECRET: APP_SECRET, FB_VERIFY_TOKEN: VERIFY_TOKEN, FB_PAGE_TOKENS: JSON.stringify({ [PAGE_ID]: PAGE_TOKEN }),
};
const HOUR = 60 * 60_000;

beforeEach(async () => {
  await resetDb(db, seedSql);
  await db.prepare(`INSERT INTO channel_account (id, organization_id, channel, external_id, display_name, agent_key, status, created_at, updated_at)
    VALUES ('ca-fb', 'org-abm', 'facebook', ?, 'Fanpage ABM', 'sales-bot', 'connected', ?, ?)`).bind(PAGE_ID, STAMP, STAMP).run();
});
afterEach(() => vi.restoreAllMocks());

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sign(body: string, secret = APP_SECRET) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `sha256=${hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))}`;
}

async function webhook(payload: unknown, signature?: string) {
  const raw = JSON.stringify(payload);
  const res = await app.fetch(new Request(`${ORIGIN}/api/channels/facebook/webhook`, {
    method: 'POST', body: raw,
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature ?? await sign(raw) },
  }), testEnv);
  return { status: res.status, text: await res.text() };
}

const page = (...messaging: unknown[]) => ({ object: 'page', entry: [{ id: PAGE_ID, time: Date.now(), messaging }] });
const inbound = (mid: string, text = 'Cho em hỏi học phí') =>
  ({ sender: { id: PSID }, recipient: { id: PAGE_ID }, timestamp: Date.now(), message: { mid, text } });
const echo = (mid: string, text: string, metadata?: string) =>
  ({ sender: { id: PAGE_ID }, recipient: { id: PSID }, timestamp: Date.now(), message: { mid, text, is_echo: true, app_id: 123, ...(metadata ? { metadata } : {}) } });

async function web(user: string, method: string, path: string, body?: unknown) {
  const res = await app.fetch(new Request(`${ORIGIN}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Demo-User': user },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), testEnv);
  return { status: res.status, json: await res.json() as any };
}

const conversation = () => db.prepare('SELECT * FROM conversation WHERE external_thread_id = ?').bind(PSID).first<any>();
const messages = (conversationId: string) =>
  db.prepare('SELECT * FROM message WHERE conversation_id = ? ORDER BY created_at, rowid').bind(conversationId).all<any>().then((r) => r.results);
const commands = (kind: string) => db.prepare('SELECT * FROM channel_command WHERE kind = ? ORDER BY created_at').bind(kind).all<any>()
  .then((r) => r.results.map((row) => ({ ...row, payload: JSON.parse(row.payload_json), result: row.result_json ? JSON.parse(row.result_json) : null })));

interface GraphCall { url: string; body: any }
/** Fakes the Graph Send API: each call is recorded and answered with `reply(call, index)`. */
function fakeGraph(reply: (call: GraphCall, index: number) => Response = (_c, i) => json({ recipient_id: PSID, message_id: `m_out_${i + 1}` })) {
  const calls: GraphCall[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://graph.facebook.com/')) return json({ code: 404 }, 404);
    const call = { url, body: JSON.parse(String(init!.body)) };
    calls.push(call);
    return reply(call, calls.length - 1);
  });
  return calls;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A customer conversation whose last customer message was `ageMs` ago. */
async function customerConversation(ageMs = 0) {
  await webhook(page(inbound('m_in_1')));
  const conv = await conversation();
  await db.prepare('UPDATE conversation SET last_inbound_at = ? WHERE id = ?').bind(new Date(Date.now() - ageMs).toISOString(), conv.id).run();
  return conv as { id: string };
}

test('the subscription handshake answers the challenge only for the right verify token', async () => {
  const verify = (token: string, mode = 'subscribe') => app.fetch(new Request(
    `${ORIGIN}/api/channels/facebook/webhook?hub.mode=${mode}&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=chal-42`), testEnv);
  const ok = await verify(VERIFY_TOKEN);
  expect(ok.status).toBe(200);
  expect(await ok.text()).toBe('chal-42');
  expect((await verify('wrong')).status).toBe(403);
  expect((await verify(VERIFY_TOKEN, 'unsubscribe')).status).toBe(403);
  const unset = await app.fetch(new Request(`${ORIGIN}/api/channels/facebook/webhook?hub.mode=subscribe&hub.verify_token=&hub.challenge=x`),
    { ...testEnv, FB_VERIFY_TOKEN: '' });
  expect(unset.status).toBe(403);
});

test('a wrong or missing signature is rejected; a signed message enters the inbox and queues the bot under the page user id', async () => {
  const payload = page(inbound('m_in_1'));
  expect((await webhook(payload, await sign(JSON.stringify(payload), 'other-secret'))).status).toBe(401);
  expect((await webhook(payload, 'sha256=zz')).status).toBe(401);
  expect((await webhook(payload, '')).status).toBe(401);
  expect(await db.prepare('SELECT COUNT(*) AS n FROM message').first('n')).toBe(0);

  expect(await webhook(payload)).toEqual({ status: 200, text: 'EVENT_RECEIVED' });
  const conv = await conversation();
  expect(conv).toMatchObject({ channel_account_id: 'ca-fb', kind: 'direct', mode: 'ai' });
  expect(conv.last_inbound_at).toBeTruthy();
  expect(await messages(conv.id)).toMatchObject([
    { direction: 'in', sender_kind: 'customer', external_msg_id: 'm_in_1', body: 'Cho em hỏi học phí', status: 'received' },
  ]);
  const [completion] = await commands('run_completion');
  expect(completion).toMatchObject({ target: 'bridge', conversation_id: conv.id });
  expect(completion.payload).toMatchObject({ agentKey: 'sales-bot', userId: `facebook:${PAGE_ID}:${PSID}`, purpose: 'reply' });
});

test('the same webhook delivered twice stores one message', async () => {
  await webhook(page(inbound('m_in_1')));
  await webhook(page(inbound('m_in_1')));
  expect(await db.prepare("SELECT COUNT(*) AS n FROM message WHERE external_msg_id = 'm_in_1'").first('n')).toBe(1);
});

test('delivery and read receipts add no message', async () => {
  const res = await webhook(page(
    { sender: { id: PSID }, recipient: { id: PAGE_ID }, delivery: { mids: ['m_x'], watermark: Date.now() } },
    { sender: { id: PSID }, recipient: { id: PAGE_ID }, read: { watermark: Date.now() } },
  ));
  expect(res.status).toBe(200);
  expect(await db.prepare('SELECT COUNT(*) AS n FROM message').first('n')).toBe(0);
  expect(await db.prepare('SELECT COUNT(*) AS n FROM conversation').first('n')).toBe(0);
});

test('an echo of the bot reply adds nothing; a reply typed in Meta Business Suite is staff_phone and hands over to people', async () => {
  const conv = await customerConversation();
  const calls = fakeGraph(() => json({ recipient_id: PSID, message_id: 'm_bot_1' }));
  const outcome = await applyCompletionResult(db, testEnv, conv.id, 'Học phí là 5 triệu ạ');
  expect(outcome.workerCommandQueued).toBe(true);
  await processWorkerCommands(testEnv);

  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe(`https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages?access_token=${PAGE_TOKEN}`);
  expect(calls[0]!.body).toMatchObject({ recipient: { id: PSID }, messaging_type: 'RESPONSE', message: { text: 'Học phí là 5 triệu ạ' } });
  expect(calls[0]!.body.tag).toBeUndefined();
  const [send] = await commands('send_messenger');
  expect(send).toMatchObject({ target: 'worker', status: 'done' });
  expect(JSON.stringify(send.result)).not.toContain(PAGE_TOKEN);
  const bot = (await messages(conv.id)).find((m) => m.sender_kind === 'bot');
  expect(bot).toMatchObject({ status: 'sent', external_msg_id: 'm_bot_1' });
  expect(calls[0]!.body.message.metadata).toBe(bot.id);

  const before = (await messages(conv.id)).length;
  await webhook(page(echo('m_bot_1', 'Học phí là 5 triệu ạ', bot.id)));
  expect(await messages(conv.id)).toHaveLength(before);
  expect((await conversation()).mode).toBe('ai');

  await webhook(page(echo('m_staff_1', 'Em gọi lại chị nhé')));
  const after = await messages(conv.id);
  expect(after).toHaveLength(before + 1);
  expect(after.at(-1)).toMatchObject({ direction: 'out', sender_kind: 'staff_phone', external_msg_id: 'm_staff_1', status: 'sent' });
  expect(await conversation()).toMatchObject({ mode: 'human', staff_context_pending: 'Nhân viên: Em gọi lại chị nhé' });
});

test('an echo that arrives before the send response is recognised by its metadata', async () => {
  const conv = await customerConversation();
  await applyCompletionResult(db, testEnv, conv.id, 'Dạ em chào chị');
  const bot = (await messages(conv.id)).find((m) => m.sender_kind === 'bot');
  await webhook(page(echo('m_early', 'Dạ em chào chị', bot.id)));
  expect(await messages(conv.id)).toHaveLength(2);
  expect((await messages(conv.id)).find((m) => m.id === bot.id)).toMatchObject({ status: 'sent', external_msg_id: 'm_early' });
  expect((await conversation()).mode).toBe('ai');
});

test('outside 24 hours the bot is refused with OUTSIDE_WINDOW while staff reply with the HUMAN_AGENT tag', async () => {
  const conv = await customerConversation(25 * HOUR);
  const calls = fakeGraph();
  await applyCompletionResult(db, testEnv, conv.id, 'Bot trả lời muộn');
  await processWorkerCommands(testEnv);
  expect(calls).toHaveLength(0);
  const [botSend] = await commands('send_messenger');
  expect(botSend).toMatchObject({ status: 'failed', result: { error: 'OUTSIDE_WINDOW' } });
  const afterBot = await messages(conv.id);
  expect(afterBot.find((m) => m.sender_kind === 'bot')).toMatchObject({ status: 'failed' });
  expect(afterBot.at(-1)).toMatchObject({ sender_kind: 'system', body: OUTSIDE_WINDOW_NOTE, status: 'failed' });

  const staff = await web('u-lan', 'POST', `/inbox/conversations/${conv.id}/messages`, { text: 'Chị ơi em gửi lịch học' });
  expect(staff.status).toBe(200);
  expect(calls).toHaveLength(1);
  expect(calls[0]!.body).toMatchObject({ messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT', message: { text: 'Chị ơi em gửi lịch học' } });
  expect((await messages(conv.id)).find((m) => m.id === staff.json.data.messageId)).toMatchObject({ status: 'sent', external_msg_id: 'm_out_1' });
});

test('a staff reply more than 7 days after the customer is refused too', async () => {
  const conv = await customerConversation(8 * 24 * HOUR);
  const calls = fakeGraph();
  const staff = await web('u-lan', 'POST', `/inbox/conversations/${conv.id}/messages`, { text: 'Chị còn quan tâm không ạ' });
  expect(staff.status).toBe(200);
  expect(calls).toHaveLength(0);
  expect((await commands('send_messenger'))[0]).toMatchObject({ status: 'failed', result: { error: 'OUTSIDE_WINDOW' } });
  expect((await messages(conv.id)).find((m) => m.id === staff.json.data.messageId)).toMatchObject({ status: 'failed' });
});

test('a long reply is sent as several messages cut at line breaks', async () => {
  const conv = await customerConversation();
  const calls = fakeGraph();
  const line = 'x'.repeat(900);
  await applyCompletionResult(db, testEnv, conv.id, [line, line, line, line, line].join('\n'));
  await processWorkerCommands(testEnv);
  expect(calls.map((c) => c.body.message.text.length)).toEqual([1801, 1801, 900]);
  const bot = (await messages(conv.id)).find((m) => m.sender_kind === 'bot');
  expect(bot).toMatchObject({ status: 'sent', external_msg_id: 'm_out_1' });
  expect(calls.every((c) => c.body.message.metadata === bot.id)).toBe(true);
});

test('a Graph error fails the attempt with the Graph code and never records the token', async () => {
  const conv = await customerConversation();
  const errors = vi.spyOn(console, 'error');
  fakeGraph(() => json({ error: { message: 'Bad token', type: 'OAuthException', code: 190, error_subcode: 463, fbtrace_id: 'x' } }, 400));
  await applyCompletionResult(db, testEnv, conv.id, 'Xin chào');
  await processWorkerCommands(testEnv);
  const [send] = await commands('send_messenger');
  expect(send).toMatchObject({ status: 'pending', attempts: 1, result: { error: 'GRAPH_190_463' } });
  expect((await messages(conv.id)).find((m) => m.sender_kind === 'bot')).toMatchObject({ status: 'pending' });
  expect(JSON.stringify(errors.mock.calls)).not.toContain(PAGE_TOKEN);

  // The last allowed attempt leaves the message failed.
  await db.prepare("UPDATE channel_command SET attempts = 4, next_run_at = ? WHERE id = ?").bind(new Date(Date.now() - 1000).toISOString(), send.id).run();
  await processWorkerCommands(testEnv);
  expect((await commands('send_messenger'))[0]).toMatchObject({ status: 'failed', attempts: 5 });
  expect((await messages(conv.id)).find((m) => m.sender_kind === 'bot')).toMatchObject({ status: 'failed' });
});

test('a page without a configured token is not sent and does not throw', async () => {
  const conv = await customerConversation();
  const calls = fakeGraph();
  await applyCompletionResult(db, testEnv, conv.id, 'Xin chào');
  await expect(processWorkerCommands({ ...testEnv, FB_PAGE_TOKENS: 'not json' })).resolves.toBeUndefined();
  expect(calls).toHaveLength(0);
  expect((await commands('send_messenger'))[0]).toMatchObject({ status: 'pending', result: { error: 'FB_NOT_CONFIGURED' } });
});

test('an admin adds a Facebook Page by its page id; a duplicate page or missing id is refused', async () => {
  const created = await web('u-admin', 'POST', '/inbox/accounts', { channel: 'facebook', externalId: '2002', displayName: 'Fanpage 2', agentKey: 'sales-bot' });
  expect(created.status).toBe(200);
  expect(created.json.data).toMatchObject({ channel: 'facebook', externalId: '2002', status: 'connected', displayName: 'Fanpage 2' });
  const dup = await web('u-admin', 'POST', '/inbox/accounts', { channel: 'facebook', externalId: '2002', displayName: 'Fanpage 2b', agentKey: 'sales-bot' });
  expect(dup.status).toBe(422);
  expect(dup.json.error.fields).toHaveProperty('externalId');
  const missing = await web('u-admin', 'POST', '/inbox/accounts', { channel: 'facebook', displayName: 'Fanpage 3', agentKey: 'sales-bot' });
  expect(missing.status).toBe(422);
  expect(missing.json.error.fields).toHaveProperty('externalId');
  expect((await web('u-lan', 'POST', '/inbox/accounts', { channel: 'facebook', externalId: '3003', displayName: 'X', agentKey: 'sales-bot' })).status).toBe(403);
  const zalo = await web('u-admin', 'POST', '/inbox/accounts', { displayName: 'Số 3', agentKey: 'sales-bot' });
  expect(zalo.json.data).toMatchObject({ channel: 'zalo', externalId: null, status: 'disconnected' });
});

test('text splitting and the reply window rules', () => {
  expect(splitMessengerText('a\nb')).toEqual(['a\nb']);
  expect(splitMessengerText('y'.repeat(4500))).toEqual(['y'.repeat(2000), 'y'.repeat(2000), 'y'.repeat(500)]);
  expect(splitMessengerText('😀'.repeat(2001)).map((p) => Array.from(p).length)).toEqual([2000, 1]);
  expect(splitMessengerText('  \n ')).toEqual([]);
  const now = new Date('2026-10-08T10:00:00.000Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  expect(messengerDelivery('bot', ago(23 * HOUR), now)).toEqual({ messaging_type: 'RESPONSE' });
  expect(messengerDelivery('bot', ago(25 * HOUR), now)).toBeNull();
  expect(messengerDelivery('staff_web', ago(25 * HOUR), now)).toEqual({ messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' });
  expect(messengerDelivery('staff_web', ago(7 * 24 * HOUR + 1), now)).toBeNull();
  expect(messengerDelivery('staff_web', null, now)).toBeNull();
});
