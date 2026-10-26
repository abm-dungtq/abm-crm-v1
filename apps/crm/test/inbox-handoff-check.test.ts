import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import { applyCompletionResult, asCompletionPayload } from '../src/worker/inbox/conversation-flow';
import {
  JEV_URL, classifyWithJev, maskPersonalData, matchHandoffRule, mentions199k, resetJevBreaker,
} from '../src/worker/inbox/decision-layer';
import { ingestEvents } from '../src/worker/inbox/ingest';
import { resetDb } from './helpers/reset-db';
import { testSink } from './helpers/test-sink';

const db = env.DB;
const STAMP = '2026-10-08T03:00:00.000Z';
const baseEnv = { ...env, APP_URL: 'https://crm.example' };
const active = { ...baseEnv, HANDOFF_NET_MODE: 'active' };
const withJev = (mode: string, extra: Record<string, string> = {}) =>
  ({ ...active, JEV_INTENT_MODE: mode, TYPESAFE_API_KEY: 'test-typesafe-key', ...extra });

beforeEach(async () => {
  resetJevBreaker();
  await resetDb(db, seedSql);
  await db.prepare(`INSERT INTO channel_account (id, organization_id, channel, external_id, display_name, agent_key, status, created_at, updated_at)
    VALUES ('ca-1', 'org-abm', 'zalo', 'zalo-acc-1', 'Số tư vấn 1', 'sales-bot', 'connected', ?, ?)`).bind(STAMP, STAMP).run();
});
afterEach(() => vi.restoreAllMocks());

let msgSeq = 0;
const customerSays = (text: string) => ingestEvents(db, [{
  type: 'message', accountExternalId: 'zalo-acc-1', threadId: 'cust-1', threadKind: 'direct', msgId: `hc-${++msgSeq}`,
  fromSelf: false, senderExternalId: 'cust-1', senderName: 'Chị Hoa', text, sentAt: new Date().toISOString(),
}], testSink());
const conversation = () => db.prepare("SELECT * FROM conversation WHERE external_thread_id = 'cust-1'").first<any>();
const pendingReply = async () => {
  const row = await db.prepare("SELECT payload_json FROM channel_command WHERE kind = 'run_completion' AND status = 'pending'")
    .first<{ payload_json: string }>();
  return JSON.parse(row!.payload_json) as Record<string, unknown>;
};
const checks = () => db.prepare("SELECT before_json, after_json FROM audit_log WHERE command = 'inbox.handoffCheck' ORDER BY created_at")
  .all<{ before_json: string; after_json: string }>()
  .then((r) => r.results.map((row) => ({ before: JSON.parse(row.before_json), after: JSON.parse(row.after_json) })));
const botReplies = (conversationId: string) => db.prepare(
  "SELECT body FROM message WHERE conversation_id = ? AND direction = 'out' AND sender_kind = 'bot'",
).bind(conversationId).all<{ body: string }>().then((r) => r.results.map((row) => row.body));

/** Customer writes, the bot answers `reply`, then the deferred check runs as the bridge route runs it. */
async function turn(customer: string, reply: string, flowEnv: Parameters<typeof applyCompletionResult>[1],
  beforeCheck?: (conversationId: string) => Promise<unknown>) {
  await customerSays(customer);
  const conv = await conversation();
  const outcome = await applyCompletionResult(db, flowEnv, conv.id, reply, 'http://crm.test', asCompletionPayload(await pendingReply()), testSink());
  await beforeCheck?.(conv.id);
  await outcome.handoffCheck?.();
  return conversation();
}

const jevReply = (choice: string, confidence: number) => new Response(JSON.stringify({
  model: 'jev-1.13.0', answers: { handoff: { type: 'choice', choice, confidence, probabilities: {} } },
  usage: { input_tokens: 300, output_tokens: 34 },
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('rules recognise clear handoff turns with or without Vietnamese marks and leave ordinary questions alone', () => {
  expect(matchHandoffRule('Em đã chuyển khoản rồi nhé')).toBe('payment_done');
  expect(matchHandoffRule('da ck roi a')).toBe('payment_done');
  expect(matchHandoffRule('Cho em nói chuyện với người thật')).toBe('wants_human');
  expect(matchHandoffRule('Tôi muốn gặp quản lý')).toBe('wants_human');
  expect(matchHandoffRule('Tôi muốn hoàn tiền')).toBe('complaint');
  expect(matchHandoffRule('Em không vào được nhóm học')).toBe('access_problem');
  expect(matchHandoffRule('Em gửi ảnh bill ạ')).toBe('payment_done');
  expect(matchHandoffRule('ck 199k rồi nhé')).toBe('payment_done');
  expect(matchHandoffRule('Em đã chuyển 500.000đ')).toBe('payment_done');
  expect(matchHandoffRule('Em đã chuyển sang lớp tối')).toBeNull();
  expect(matchHandoffRule('Tôi muốn hoàn lại tiền')).toBe('complaint');
  for (const question of [
    'Chuyển khoản như thế nào ạ?', 'Cho em hỏi học phí khoá 199k', 'Khoá này học online hay offline?',
    'Chính sách hoàn tiền thế nào ạ', 'Có cam kết hoàn lại tiền không', 'Bên mình có lừa đảo không vậy',
    'Có xuất hoá đơn không, cần bill cho công ty', 'Nếu em đã chuyển khoản thì bao lâu có link', 'Em đã thanh toán chưa nhỉ',
    'Có phải người thật không hay bot',
  ]) expect(matchHandoffRule(question), question).toBeNull();
});

test('personal data is masked before it is sent to Jev', () => {
  expect(maskPersonalData('SĐT 0912 345 678, mail hoa.nguyen@gmail.com, STK 1903 6688 9999, giá 199k'))
    .toBe('SĐT [phone], mail [email], STK [number], giá 199k');
  expect(maskPersonalData('Số em là +84912345678')).toBe('Số em là [phone]');
  expect(maskPersonalData('0912/345/678 và 1903,6688,9999 và 1903_6688_9999')).toBe('[phone] và [number] và [number]');
  expect(maskPersonalData('０９１２３４５６７８')).toBe('[phone]');
});

test('a queued reply keeps the customer lines apart from staff context, and later messages extend them', async () => {
  await customerSays('Cho em hỏi');
  const conv = await conversation();
  await db.prepare("UPDATE conversation SET staff_context_pending = 'Nhân viên: đã gửi giá' WHERE id = ?").bind(conv.id).run();
  await db.prepare("DELETE FROM channel_command WHERE kind = 'run_completion'").run();
  await customerSays('Em muốn đăng ký');
  await customerSays('đã chuyển khoản');
  const payload = await pendingReply();
  expect(payload.text).toBe('[Nhân viên đã trao đổi: Nhân viên: đã gửi giá]\nEm muốn đăng ký\nđã chuyển khoản');
  expect(payload.customerText).toBe('Em muốn đăng ký\nđã chuyển khoản');
});

test('in active mode a rule hit hands off after the bot reply when the bot wrote no HANDOFF line', async () => {
  const conv = await turn('Em chuyển khoản rồi nhé', 'Dạ em kiểm tra rồi nhắn lại Anh/Chị ạ', active);
  expect(conv).toMatchObject({ mode: 'human', handoff_reason: 'Khách báo đã chuyển khoản hoặc chốt đăng ký' });
  expect(await botReplies(conv.id)).toEqual(['Dạ em kiểm tra rồi nhắn lại Anh/Chị ạ']);
  expect(await checks()).toEqual([{
    before: { botHandedOff: false },
    after: { mode: 'active', jevMode: 'off', rule: 'payment_done', jev: null, decided: { layer: 'rule', category: 'payment_done' }, applied: true },
  }]);
});

test('a 199k payment is left to the bot and its own rules, while its HANDOFF line still applies', async () => {
  expect(['199k', 'đã ck 199K', '199.000đ', '199,000', '199 nghìn', '199 ngàn'].every(mentions199k)).toBe(true);
  expect(['1199k', '199', '199 người', '2199.000'].some(mentions199k)).toBe(false);
  const conv = await turn('Em chuyển khoản 199k rồi nhé', 'Dạ em ghi nhận, Anh/Chị gửi giúp em ảnh biên lai ạ', active);
  expect(conv.mode).toBe('ai');
  expect((await checks())[0]!.after).toMatchObject({ decided: { layer: 'rule', category: 'payment_done' }, held: 'payment_199k', applied: false });

  const second = await turn('Đây ạ, em đã chuyển 199.000đ', 'Dạ em đối soát rồi báo lại ạ\n[HANDOFF: Khách đã CK 199k]', active);
  expect(second).toMatchObject({ mode: 'human', handoff_reason: 'Khách đã CK 199k' });
});

test('in shadow mode the check is only logged and the conversation stays with the bot', async () => {
  const conv = await turn('Cho em gặp người thật', 'Dạ Anh/Chị cần hỗ trợ gì ạ', { ...baseEnv, HANDOFF_NET_MODE: 'shadow' });
  expect(conv.mode).toBe('ai');
  const [check] = await checks();
  expect(check!.after).toMatchObject({ mode: 'shadow', decided: { layer: 'rule', category: 'wants_human' }, applied: false });
});

test('with the check off nothing is evaluated or logged', async () => {
  const conv = await turn('Em chuyển khoản rồi', 'Dạ', baseEnv);
  expect(conv.mode).toBe('ai');
  expect(await checks()).toEqual([]);
});

test('when the bot hands off itself, its reason is kept and the check is logged as not applied', async () => {
  const conv = await turn('Em chuyển khoản rồi', 'Dạ em đối soát rồi báo lại ạ\n[HANDOFF: Khách đã CK]', active);
  expect(conv).toMatchObject({ mode: 'human', handoff_reason: 'Khách đã CK' });
  const [check] = await checks();
  expect(check).toMatchObject({ before: { botHandedOff: true }, after: { applied: false, decided: { layer: 'rule' } } });
  const notices = await db.prepare(
    "SELECT author_kind, body FROM chat_message WHERE conversation_id = 'sys:inbox:org-abm'",
  ).all<{ author_kind: string; body: string }>();
  expect(notices.results).toEqual([{
    author_kind: 'system',
    body: `Handoff: Chị Hoa (Số tư vấn 1) – Khách đã CK – https://crm.example/inbox/${conv.id}`,
  }]);
});

test('active Jev hands off a turn the rules miss, sending masked text with the pinned model', async () => {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jevReply('schedule_or_link', 0.92));
  const conv = await turn('Khi nào khai giảng lớp tiếp theo, sđt em 0912345678', 'Dạ em kiểm tra lịch rồi nhắn lại ạ', withJev('active'));
  expect(conv).toMatchObject({ mode: 'human', handoff_reason: 'Khách hỏi lịch, link hoặc địa điểm học' });
  const [url, init] = spy.mock.calls.find(([input]) => String(input) === JEV_URL)!;
  expect(url).toBe(JEV_URL);
  expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer test-typesafe-key');
  const body = JSON.parse(String(init!.body));
  expect(body.model).toBe('jev-1.13.0');
  expect(body.state).toContain('sđt em [phone]');
  expect(body.state).not.toContain('0912345678');
  expect(Object.keys(body.questions.handoff.criteria)).toContain('none');
  const [check] = await checks();
  expect(check!.after).toMatchObject({ jevMode: 'active', rule: null, jev: { choice: 'schedule_or_link', confidence: 0.92 },
    decided: { layer: 'jev', category: 'schedule_or_link' }, applied: true });
});

test('Jev below the confidence threshold, saying none, or in shadow mode does not hand off', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jevReply('special_pricing', 0.6));
  expect((await turn('Có ưu đãi gì không ạ', 'Dạ', withJev('active'))).mode).toBe('ai');
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jevReply('none', 0.99));
  expect((await turn('Khoá học dạy những gì', 'Dạ', withJev('active'))).mode).toBe('ai');
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jevReply('complaint', 0.99));
  expect((await turn('Sao mãi không ai trả lời', 'Dạ', withJev('shadow'))).mode).toBe('ai');
  const logged = (await checks()).map((c) => c.after);
  expect(logged.map((a) => a.decided)).toEqual([null, null, null]);
  expect(logged[2]).toMatchObject({ jevMode: 'shadow', jev: { choice: 'complaint', confidence: 0.99 } });
});

test('active mode does not ask Jev after the bot handed off, and attachment-only turns are not checked', async () => {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jevReply('complaint', 0.99));
  const conv = await turn('Khi nào khai giảng', 'Dạ em kiểm tra lịch rồi báo ạ\n[HANDOFF: Hỏi lịch]', withJev('active'));
  expect(conv.handoff_reason).toBe('Hỏi lịch');
  expect(spy).not.toHaveBeenCalled();
  expect((await checks())[0]!.after).toMatchObject({ jev: null, decided: null, applied: false });

  await db.prepare("UPDATE conversation SET mode = 'ai' WHERE id = ?").bind(conv.id).run();
  const outcome = await applyCompletionResult(db, withJev('active'), conv.id, 'Dạ em nhận được ảnh ạ', 'http://crm.test',
    { customerText: '[Tệp đính kèm]\n[Tệp đính kèm]' }, testSink());
  expect(outcome.handoffCheck).toBeUndefined();
});

test('a decision is logged as not applied when staff took the conversation before the check ran', async () => {
  const conv = await turn('Em chuyển khoản rồi', 'Dạ em đối soát rồi báo lại ạ', active,
    (id) => db.prepare("UPDATE conversation SET mode = 'human', handoff_reason = 'Nhân viên nhận' WHERE id = ?").bind(id).run());
  expect(conv.handoff_reason).toBe('Nhân viên nhận');
  expect((await checks())[0]!.after).toMatchObject({ decided: { layer: 'rule', category: 'payment_done' }, applied: false });
});

test('a Jev failure leaves the bot reply in place and is logged as no decision', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('busy', { status: 529 }));
  const conv = await turn('Khi nào khai giảng', 'Dạ lớp sắp tới em gửi sau ạ', withJev('active'));
  expect(conv.mode).toBe('ai');
  expect(await botReplies(conv.id)).toEqual(['Dạ lớp sắp tới em gửi sau ạ']);
  const [check] = await checks();
  expect(check!.after).toMatchObject({ jev: { error: 'http_529' }, decided: null, applied: false });
});

test('five Jev failures in a row open the breaker; bad credentials never do', async () => {
  const jevEnv = { TYPESAFE_API_KEY: 'k' };
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('no', { status: 401 }));
  for (let i = 0; i < 6; i++) expect(await classifyWithJev(jevEnv, 'x', 1000)).toEqual({ ok: false, error: 'misconfigured_401' });
  expect(spy).toHaveBeenCalledTimes(6);
  spy.mockImplementation(async () => { throw new TypeError('fetch failed'); });
  for (let i = 0; i < 5; i++) expect(await classifyWithJev(jevEnv, 'x', 1000)).toEqual({ ok: false, error: 'network' });
  expect(await classifyWithJev(jevEnv, 'x', 2000)).toEqual({ ok: false, error: 'breaker_open' });
  expect(spy).toHaveBeenCalledTimes(11);
  spy.mockImplementation(async () => jevReply('none', 0.9));
  expect(await classifyWithJev(jevEnv, 'x', 1000 + 30_001)).toEqual({ ok: true, answer: { choice: 'none', confidence: 0.9 } });
  expect(await classifyWithJev({}, 'x')).toEqual({ ok: false, error: 'no_key' });
});
