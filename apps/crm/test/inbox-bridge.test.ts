import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';
import { claimCommands, enqueueCommand } from '../src/worker/inbox/dispatcher';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
const ORIGIN = 'http://crm.test';
const SECRET = 'test-bridge-secret';
const testEnv = { ...env, BRIDGE_SECRET: SECRET };
const STAMP = '2026-10-08T03:00:00.000Z';

beforeEach(async () => {
  await resetDb(db, seedSql);
  await db.batch([
    db.prepare(`INSERT INTO channel_account (id, organization_id, channel, external_id, display_name, agent_key, status, created_at, updated_at)
      VALUES ('ca-1', 'org-abm', 'zalo', 'zalo-acc-1', 'Số 1', 'sales-bot', 'connected', ?, ?)`).bind(STAMP, STAMP),
    db.prepare(`INSERT INTO channel_account (id, organization_id, channel, display_name, agent_key, created_at, updated_at)
      VALUES ('ca-2', 'org-abm', 'zalo', 'Số 2', 'sales-bot', ?, ?)`).bind(STAMP, STAMP),
  ]);
});
afterEach(() => vi.restoreAllMocks());

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sign(timestamp: string, body: string, secret = SECRET) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)));
}
const nowSeconds = () => Math.floor(Date.now() / 1000);

interface BridgeCall { method?: string; body?: unknown; timestamp?: number; signature?: string; headers?: Record<string, string> }
async function bridge(path: string, call: BridgeCall = {}) {
  const raw = call.body === undefined ? '' : JSON.stringify(call.body);
  const timestamp = String(call.timestamp ?? nowSeconds());
  const signature = call.signature ?? await sign(timestamp, raw);
  const res = await app.fetch(new Request(`${ORIGIN}/api/bridge${path}`, {
    method: call.method ?? (call.body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', 'X-Bridge-Timestamp': timestamp, 'X-Bridge-Signature': signature, ...call.headers },
    body: call.body === undefined ? undefined : raw,
  }), testEnv);
  return { status: res.status, json: await res.json() as any };
}

const messageEvent = (overrides: Record<string, unknown> = {}) => ({
  type: 'message', accountExternalId: 'zalo-acc-1', threadId: 'cust-1', threadKind: 'direct', msgId: 'zm-1', fromSelf: false,
  senderExternalId: 'cust-1', senderName: 'Khách A', text: 'Cho tôi hỏi học phí', sentAt: new Date().toISOString(), ...overrides,
});
const count = async (sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).first<{ n: number }>())!.n;

test('a request with a wrong signature, a stale timestamp or no signature is rejected', async () => {
  const body = { events: [] };
  expect((await bridge('/events', { body, signature: await sign(String(nowSeconds()), '{"events":[]}', 'other-secret') })).status).toBe(401);
  expect((await bridge('/events', { body, signature: 'zz' })).status).toBe(401);
  const stale = nowSeconds() - 301;
  expect((await bridge('/events', { body, timestamp: stale, signature: await sign(String(stale), JSON.stringify(body)) })).status).toBe(401);
  const res = await app.fetch(new Request(`${ORIGIN}/api/bridge/events`, { method: 'POST', body: JSON.stringify(body) }), testEnv);
  expect(res.status).toBe(401);
  const ok = await bridge('/events', { body });
  expect(ok).toEqual({ status: 200, json: { ok: true, data: { accepted: 0, rejected: 0 } } });
});

test('the bridge is closed while no secret is configured and to browser requests', async () => {
  const timestamp = String(nowSeconds());
  const body = '{"events":[]}';
  const unset = await app.fetch(new Request(`${ORIGIN}/api/bridge/events`, {
    method: 'POST', body, headers: { 'X-Bridge-Timestamp': timestamp, 'X-Bridge-Signature': await sign(timestamp, body) },
  }), { ...env, BRIDGE_SECRET: '' });
  expect(unset.status).toBe(401);
  expect((await bridge('/events', { body: { events: [] }, headers: { Origin: ORIGIN } })).status).toBe(403);
});

test('an invalid event body is rejected with 422', async () => {
  const res = await bridge('/events', { body: { events: [{ type: 'message', text: 'thiếu trường' }] } });
  expect(res.status).toBe(422);
  expect(res.json.error.code).toBe('VALIDATION_FAILED');
});

test('the same message event sent twice stores one message', async () => {
  const event = messageEvent();
  expect((await bridge('/events', { body: { events: [event] } })).json.data).toEqual({ accepted: 1, rejected: 0 });
  expect((await bridge('/events', { body: { events: [event] } })).json.data).toEqual({ accepted: 1, rejected: 0 });
  expect(await count("SELECT COUNT(*) AS n FROM message WHERE external_msg_id = 'zm-1'")).toBe(1);
  expect(await count('SELECT COUNT(*) AS n FROM conversation')).toBe(1);
});

test('a message for an unknown account is rejected without failing the batch', async () => {
  const res = await bridge('/events', { body: { events: [messageEvent({ accountExternalId: 'unknown' }), messageEvent({ msgId: 'zm-2' })] } });
  expect(res.json.data).toEqual({ accepted: 1, rejected: 1 });
});

test('a result from an expired lease is ignored and creates no message', async () => {
  await bridge('/events', { body: { events: [messageEvent()] } });
  const conv = (await db.prepare('SELECT id FROM conversation').first<{ id: string }>())!;
  const commandId = await enqueueCommand(db, {
    kind: 'run_completion', target: 'bridge', channelAccountId: 'ca-1', conversationId: conv.id,
    payload: { purpose: 'reply', text: 'x' }, dedupeKey: 'test-completion',
  });
  await db.prepare("DELETE FROM channel_command WHERE id <> ?").bind(commandId).run();
  const t0 = new Date();
  expect((await claimCommands(db, 'bridge', 10, 300, t0))[0]!.attempts).toBe(1);
  expect((await claimCommands(db, 'bridge', 10, 300, new Date(t0.getTime() + 301_000)))[0]!.attempts).toBe(2);
  const before = await count('SELECT COUNT(*) AS n FROM message');
  const res = await bridge(`/commands/${commandId}/result`, { body: { attempts: 1, ok: true, text: 'Học phí là 5 triệu' } });
  expect(res).toEqual({ status: 200, json: { ok: true, data: { ignored: true } } });
  expect(await count('SELECT COUNT(*) AS n FROM message')).toBe(before);
  expect(await count("SELECT COUNT(*) AS n FROM channel_command WHERE id = ? AND status = 'claimed'", commandId)).toBe(1);
});

test('a connected account records its Zalo id and then receives messages for it', async () => {
  expect((await bridge('/events', { body: { events: [messageEvent({ accountExternalId: 'zalo-acc-2' })] } })).json.data)
    .toEqual({ accepted: 0, rejected: 1 });
  await db.prepare("UPDATE channel_account SET qr_image = 'data:image/png;base64,AAAA', status = 'qr_pending' WHERE id = 'ca-2'").run();
  const status = await bridge('/events', { body: { events: [{ type: 'account_status', accountId: 'ca-2', accountExternalId: 'zalo-acc-2', status: 'connected' }] } });
  expect(status.json.data).toEqual({ accepted: 1, rejected: 0 });
  const account = await db.prepare("SELECT external_id, status, qr_image, last_seen_at FROM channel_account WHERE id = 'ca-2'").first<any>();
  expect(account).toMatchObject({ external_id: 'zalo-acc-2', status: 'connected', qr_image: null });
  expect(account.last_seen_at).toBeTruthy();
  expect((await bridge('/events', { body: { events: [messageEvent({ accountExternalId: 'zalo-acc-2', msgId: 'zm-9' })] } })).json.data)
    .toEqual({ accepted: 1, rejected: 0 });
  expect(await count(`SELECT COUNT(*) AS n FROM message m JOIN conversation c ON c.id = m.conversation_id
    WHERE c.channel_account_id = 'ca-2' AND m.external_msg_id = 'zm-9'`)).toBe(1);
});

test('connecting with a Zalo id another account owns marks the account as error', async () => {
  const res = await bridge('/events', { body: { events: [{ type: 'account_status', accountId: 'ca-2', accountExternalId: 'zalo-acc-1', status: 'connected' }] } });
  expect(res.json.data).toEqual({ accepted: 0, rejected: 1 });
  expect(await db.prepare("SELECT status, external_id, last_error FROM channel_account WHERE id = 'ca-2'").first())
    .toEqual({ status: 'error', external_id: null, last_error: 'ZALO_NUMBER_IN_USE' });
});

test('the error code the bridge reports is kept until the account connects and shown only to admins', async () => {
  const accounts = async (user: string) => {
    const res = await app.fetch(new Request(`${ORIGIN}/api/inbox/accounts`, { headers: { 'X-Demo-User': user } }), { ...testEnv, DEMO_MODE: '1' });
    const body = await res.json() as { data: { id: string; status: string; lastError: string | null }[] };
    return body.data.find((a) => a.id === 'ca-1')!;
  };
  const statusEvent = (status: string, extra: Record<string, unknown> = {}) =>
    bridge('/events', { body: { events: [{ type: 'account_status', accountId: 'ca-1', status, ...extra }] } });

  expect((await statusEvent('error', { lastError: 'ZALO_KICKED' })).json.data).toEqual({ accepted: 1, rejected: 0 });
  expect(await accounts('u-admin')).toMatchObject({ status: 'error', lastError: 'ZALO_KICKED' });
  expect(await accounts('u-lan')).toMatchObject({ status: 'error', lastError: null });

  // Anything that is not an error code (it could carry a cookie or token) is never stored.
  await statusEvent('error', { lastError: 'login failed: cookie=zpw_sek abc; token=secret-value' });
  expect(await db.prepare("SELECT last_error FROM channel_account WHERE id = 'ca-1'").first()).toEqual({ last_error: 'UNRECOGNIZED_ERROR' });
  await statusEvent('error');
  expect(await db.prepare("SELECT last_error FROM channel_account WHERE id = 'ca-1'").first()).toEqual({ last_error: 'UNKNOWN_ERROR' });

  await statusEvent('connected', { accountExternalId: 'zalo-acc-1' });
  expect(await accounts('u-admin')).toMatchObject({ status: 'connected', lastError: null });
});

test('qr and group list events update the account and its groups', async () => {
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const res = await bridge('/events', { body: { events: [
    { type: 'qr', accountId: 'ca-2', imageDataUrl: 'data:image/png;base64,QUJD', expiresAt },
    { type: 'group_list', accountExternalId: 'zalo-acc-1', groups: [{ threadId: 'g-1', name: 'Lớp IELTS K1' }] },
  ] } });
  expect(res.json.data).toEqual({ accepted: 2, rejected: 0 });
  expect(await db.prepare("SELECT status, qr_image, qr_expires_at FROM channel_account WHERE id = 'ca-2'").first())
    .toEqual({ status: 'qr_pending', qr_image: 'data:image/png;base64,QUJD', qr_expires_at: expiresAt });
  expect(await db.prepare("SELECT kind, display_name FROM conversation WHERE external_thread_id = 'g-1'").first())
    .toEqual({ kind: 'group', display_name: 'Lớp IELTS K1' });
});

test('a long poll with nothing due returns an empty list', async () => {
  const started = Date.now();
  const res = await bridge('/commands?wait=1');
  expect(res).toEqual({ status: 200, json: { ok: true, data: [] } });
  expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  expect((await bridge('/commands?wait=abc')).status).toBe(422);
});

test('a send for a paused account is not handed out', async () => {
  await db.prepare("UPDATE channel_account SET send_paused = 1 WHERE id = 'ca-2'").run();
  const paused = await enqueueCommand(db, { kind: 'send_zalo', target: 'bridge', channelAccountId: 'ca-2', payload: { messageId: 'm-x', text: 'a' } });
  const live = await enqueueCommand(db, { kind: 'send_zalo', target: 'bridge', channelAccountId: 'ca-1', payload: { messageId: 'm-y', text: 'b' } });
  const res = await bridge('/commands?wait=0');
  expect(res.json.data.map((c: { id: string }) => c.id)).toEqual([live]);
  expect(res.json.data[0]).toMatchObject({ kind: 'send_zalo', attempts: 1, payload: { messageId: 'm-y', text: 'b' } });
  const row = await db.prepare('SELECT status, result_json FROM channel_command WHERE id = ?').bind(paused).first<{ status: string; result_json: string }>();
  expect(row!.status).toBe('pending');
  expect(JSON.parse(row!.result_json)).toEqual({ error: 'ACCOUNT_PAUSED' });
});

test('a send result marks the message sent with its Zalo id', async () => {
  await bridge('/events', { body: { events: [messageEvent()] } });
  const conv = (await db.prepare('SELECT id FROM conversation').first<{ id: string }>())!;
  await db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, body, status, created_at)
    VALUES ('m-out', ?, 'out', 'bot', 'Chào bạn', 'pending', ?)`).bind(conv.id, new Date().toISOString()).run();
  await db.prepare('DELETE FROM channel_command').run();
  const id = await enqueueCommand(db, { kind: 'send_zalo', target: 'bridge', channelAccountId: 'ca-1', conversationId: conv.id, payload: { messageId: 'm-out', text: 'Chào bạn' } });
  const [claimed] = (await bridge('/commands')).json.data;
  expect(claimed.id).toBe(id);
  const res = await bridge(`/commands/${id}/result`, { body: { attempts: claimed.attempts, ok: true, externalMsgId: 'zm-out' } });
  expect(res.json.data).toEqual({ ignored: false });
  expect(await db.prepare("SELECT status, external_msg_id FROM message WHERE id = 'm-out'").first()).toEqual({ status: 'sent', external_msg_id: 'zm-out' });
});

test('the last failed attempt of a send leaves its message failed', async () => {
  await bridge('/events', { body: { events: [messageEvent()] } });
  const conv = (await db.prepare('SELECT id FROM conversation').first<{ id: string }>())!;
  await db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, body, status, created_at)
    VALUES ('m-out', ?, 'out', 'bot', 'Chào bạn', 'pending', ?)`).bind(conv.id, new Date().toISOString()).run();
  await db.prepare('DELETE FROM channel_command').run();
  const id = await enqueueCommand(db, { kind: 'send_zalo', target: 'bridge', channelAccountId: 'ca-1', conversationId: conv.id, payload: { messageId: 'm-out', text: 'Chào bạn' } });
  await db.prepare("UPDATE channel_command SET status = 'claimed', attempts = 5, lease_expires_at = ? WHERE id = ?")
    .bind(new Date(Date.now() + 60_000).toISOString(), id).run();
  const res = await bridge(`/commands/${id}/result`, { body: { attempts: 5, ok: false, error: 'ZALO_REJECTED' } });
  expect(res.json.data).toEqual({ ignored: false });
  expect(await db.prepare('SELECT status FROM channel_command WHERE id = ?').bind(id).first()).toEqual({ status: 'failed' });
  expect(await db.prepare("SELECT status FROM message WHERE id = 'm-out'").first()).toEqual({ status: 'failed' });
});
