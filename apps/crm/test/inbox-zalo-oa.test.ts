import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';
import { applyCompletionResult, asCompletionPayload } from '../src/worker/inbox/conversation-flow';
import { claimCommands } from '../src/worker/inbox/dispatcher';
import { runScheduled } from '../src/worker/inbox/scheduled';
import { processWorkerCommands } from '../src/worker/inbox/worker-commands';
import { accessToken, decryptToken, encryptToken, refreshZaloOaTokens, saveCredential, ZALO_OA_REDIRECT_URI } from '../src/worker/inbox/zalo-oa-oauth';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
const ORIGIN = 'http://crm.test';
const STAMP = '2026-10-14T03:00:00.000Z';
const OA_ID = '9001';
const USER_ID = '8001';
const APP_ID = 'app-test';
const APP_SECRET = 'app-secret-test';
const WEBHOOK_SECRET = 'webhook-secret-test';
const TOKEN_KEY = btoa('0123456789abcdef0123456789abcdef');
const TOKEN_URL = 'https://oauth.zaloapp.com/v4/oa/access_token';
const ZDN_A = 'https://photo.zdn.vn/a.jpg';
const ZDN_B = 'https://photo.zdn.vn/b.jpg';
const testEnv = {
  ...env, DEMO_MODE: '1', APP_URL: 'https://crm.example',
  ZALO_OA_APP_ID: APP_ID, ZALO_OA_APP_SECRET: APP_SECRET, ZALO_OA_WEBHOOK_SECRET: WEBHOOK_SECRET, ZALO_OA_TOKEN_KEY: TOKEN_KEY,
};

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;
const calls: { url: string; init?: RequestInit }[] = [];
let onFetch: FetchHandler = () => json({ error: 0 });

beforeEach(async () => {
  await resetDb(db, seedSql);
  await db.prepare(`INSERT INTO channel_account (id, organization_id, channel, external_id, display_name, agent_key, status, created_at, updated_at)
    VALUES ('ca-oa', 'org-abm', 'zalo_oa', ?, 'OA ABM', 'tu-van-oa', 'connected', ?, ?)`).bind(OA_ID, STAMP, STAMP).run();
  calls.length = 0;
  onFetch = () => json({ error: 0 });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, init });
    return onFetch(url, init);
  });
});
afterEach(() => vi.restoreAllMocks());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const tokenCalls = () => calls.filter((call) => call.url.startsWith(TOKEN_URL));
const csCalls = () => calls.filter((call) => call.url.includes('/v3.0/oa/message/cs'));

function headerValue(init: RequestInit | undefined, name: string): string {
  const headers = init?.headers;
  if (!headers) return '';
  if (headers instanceof Headers) return headers.get(name) ?? '';
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return found ? String(found[1]) : '';
  }
  const record = headers as Record<string, string>;
  const key = Object.keys(record).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? String(record[key] ?? '') : '';
}

async function sign(raw: string, appId = APP_ID, timestamp = '1710000000123', secret = WEBHOOK_SECRET) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${appId}${raw}${timestamp}${secret}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function userEvent(name: string, msgId: string, message: Record<string, unknown>) {
  return {
    app_id: APP_ID, timestamp: '1710000000123', oa_id: OA_ID, event_name: name,
    sender: { id: USER_ID }, recipient: { id: OA_ID }, message: { msg_id: msgId, ...message },
  };
}

function oaSend(msgId: string, text: string, recipient = USER_ID) {
  return {
    app_id: APP_ID, timestamp: '1710000000123', oa_id: OA_ID, event_name: 'oa_send_text',
    sender: { id: OA_ID }, recipient: { id: recipient }, message: { msg_id: msgId, text },
  };
}

async function webhook(payload: unknown, signature?: string, envOverride: typeof testEnv = testEnv) {
  const raw = JSON.stringify(payload);
  const event = payload as { app_id?: unknown; timestamp?: unknown };
  const sig = signature === undefined ? await sign(raw, String(event.app_id ?? ''), String(event.timestamp ?? '')) : signature;
  const res = await app.fetch(new Request(`${ORIGIN}/api/channels/zalo-oa/webhook`, {
    method: 'POST', body: raw,
    headers: { 'Content-Type': 'application/json', ...(sig === null ? {} : { 'X-ZEvent-Signature': sig }) },
  }), envOverride);
  return { status: res.status, text: await res.text() };
}

async function web(user: string, method: string, path: string, body?: unknown) {
  const res = await app.fetch(new Request(`${ORIGIN}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Demo-User': user },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), testEnv);
  return { status: res.status, json: await res.json() as any };
}

async function callback(query: string) {
  const res = await app.fetch(new Request(`${ORIGIN}/api/channels/zalo-oa/oauth/callback?${query}`), testEnv);
  return { status: res.status, location: res.headers.get('Location'), text: await res.text() };
}

const conversation = () => db.prepare('SELECT * FROM conversation WHERE external_thread_id = ?').bind(USER_ID).first<any>();
const messages = (conversationId: string) =>
  db.prepare('SELECT * FROM message WHERE conversation_id = ? ORDER BY created_at, rowid').bind(conversationId).all<any>().then((r) => r.results);
const commands = (kind: string) => db.prepare('SELECT * FROM channel_command WHERE kind = ? ORDER BY created_at').bind(kind).all<any>()
  .then((r) => r.results.map((row) => ({ ...row, payload: JSON.parse(row.payload_json), result: row.result_json ? JSON.parse(row.result_json) : null })));

async function saveTokens(access: string, refresh = 'refresh-stored', accessExpiresAt = '2027-01-01T00:00:00.000Z', accountId = 'ca-oa') {
  await saveCredential(db, TOKEN_KEY, accountId, {
    accessToken: access, refreshToken: refresh, accessExpiresAt, refreshExpiresAt: '2027-06-01T00:00:00.000Z',
  });
}

async function customerTurn(text = 'Cho em hỏi học phí') {
  expect(await webhook(userEvent('user_send_text', 'm_in_1', { text }))).toEqual({ status: 200, text: 'OK' });
  return conversation() as Promise<{ id: string }>;
}

test('a token round-trips through AES-GCM and a wrong key throws', async () => {
  const stored = await encryptToken(TOKEN_KEY, 'plain-token');
  expect(await decryptToken(TOKEN_KEY, stored)).toBe('plain-token');
  const wrong = btoa('abcdefghijklmnopqrstuvwxyz012345');
  await expect(decryptToken(wrong, stored)).rejects.toThrow();
});

test('an unknown OAuth state is rejected and writes nothing', async () => {
  const res = await callback('code=abc&state=not-a-real-state');
  expect(res.status).toBe(400);
  expect(res.text).toContain('không hợp lệ');
  expect(await db.prepare("SELECT COUNT(*) AS n FROM channel_account WHERE channel = 'zalo_oa'").first('n')).toBe(1);
  expect(await db.prepare('SELECT COUNT(*) AS n FROM zalo_oa_credential').first('n')).toBe(0);
  expect(tokenCalls()).toHaveLength(0);
});

test('a valid state creates the OA account and credential, and a replay is rejected', async () => {
  const started = await web('u-admin', 'POST', '/inbox/channel-accounts/zalo-oa/connect');
  expect(started.status).toBe(200);
  const permission = new URL(started.json.data.url);
  expect(`${permission.origin}${permission.pathname}`).toBe('https://oauth.zaloapp.com/v4/oa/permission');
  expect(permission.searchParams.get('app_id')).toBe(APP_ID);
  expect(permission.searchParams.get('redirect_uri')).toBe(ZALO_OA_REDIRECT_URI);
  expect(permission.searchParams.get('code_challenge')).toBeTruthy();
  expect(permission.searchParams.has('code_challenge_method')).toBe(false);
  const state = permission.searchParams.get('state') ?? '';
  expect(state).toMatch(/^[0-9a-f]{32}$/);

  const missing = await callback(`state=${state}`);
  expect(missing.status).toBe(400);
  expect(missing.text).toContain('Thiếu code hoặc state');
  expect(await db.prepare('SELECT COUNT(*) AS n FROM zalo_oa_oauth_state').first('n')).toBe(1);

  onFetch = async (url, init) => {
    if (url.startsWith(TOKEN_URL)) {
      expect(headerValue(init, 'secret_key')).toBe(APP_SECRET);
      const form = new URLSearchParams(String(init?.body));
      expect(form.get('grant_type')).toBe('authorization_code');
      expect(form.get('code')).toBe('auth-code');
      return json({ access_token: 'access-from-zalo', refresh_token: 'refresh-from-zalo', expires_in: 90_000 });
    }
    if (url.includes('/v2.0/oa/getoa')) {
      expect(headerValue(init, 'access_token')).toBe('access-from-zalo');
      return json({ error: 0, data: { oa_id: 4242, name: 'OA Mới' } });
    }
    return json({ error: 0 });
  };
  const done = await callback(`code=auth-code&state=${state}`);
  expect(done.status).toBe(302);
  expect(done.location).toBe('https://crm.example/channel-accounts?zalo_oa=connected');
  expect(done.location).not.toContain('access-from-zalo');
  expect(done.location).not.toContain('refresh-from-zalo');
  const account = await db.prepare("SELECT * FROM channel_account WHERE external_id = '4242'").first<any>();
  expect(account).toMatchObject({
    channel: 'zalo_oa', display_name: 'OA Mới', agent_key: 'tu-van-oa', bot_enabled: 1, status: 'connected', organization_id: 'org-abm',
  });
  expect(await accessToken(db, testEnv, account.id)).toBe('access-from-zalo');
  expect(await db.prepare('SELECT version FROM zalo_oa_credential WHERE channel_account_id = ?').bind(account.id).first('version')).toBe(1);

  const again = await callback(`code=auth-code&state=${state}`);
  expect(again.status).toBe(400);
  expect(await db.prepare("SELECT COUNT(*) AS n FROM channel_account WHERE external_id = '4242'").first('n')).toBe(1);
});

test('connecting is admin only, refuses a hand-created OA, and reports a missing app', async () => {
  expect((await web('u-lan', 'POST', '/inbox/channel-accounts/zalo-oa/connect')).status).toBe(403);
  const manual = await web('u-admin', 'POST', '/inbox/accounts', { channel: 'zalo_oa', displayName: 'OA tay', agentKey: 'tu-van-oa' });
  expect(manual.status).toBe(422);
  expect(manual.json.error.fields.channel).toBe('Zalo OA kết nối bằng OAuth');
  const res = await app.fetch(new Request(`${ORIGIN}/api/inbox/channel-accounts/zalo-oa/connect`, {
    method: 'POST', headers: { 'X-Demo-User': 'u-admin' },
  }), { ...testEnv, ZALO_OA_APP_ID: '' });
  expect(res.status).toBe(503);
  expect(await res.json()).toMatchObject({ ok: false, error: { code: 'NOT_CONFIGURED' } });
});

test('reconnecting keeps a disabled bot and an existing agent key', async () => {
  await db.prepare("UPDATE channel_account SET bot_enabled = 0, agent_key = 'sales-keep' WHERE id = 'ca-oa'").run();
  const started = await web('u-admin', 'POST', '/inbox/channel-accounts/zalo-oa/connect');
  const state = new URL(started.json.data.url).searchParams.get('state');
  onFetch = async (url) => {
    if (url.startsWith(TOKEN_URL)) return json({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 90_000 });
    if (url.includes('/getoa')) return json({ error: 0, data: { oa_id: OA_ID, name: 'OA Đổi tên' } });
    return json({ error: 0 });
  };
  const done = await callback(`code=auth-code&state=${state}`);
  expect(done.status).toBe(302);
  expect(done.location).not.toContain('access-2');
  const account = await db.prepare('SELECT * FROM channel_account WHERE id = ?').bind('ca-oa').first<any>();
  expect(account).toMatchObject({ bot_enabled: 0, agent_key: 'sales-keep', display_name: 'OA Đổi tên', status: 'connected' });
  expect(await accessToken(db, testEnv, 'ca-oa')).toBe('access-2');
});

test('an admin sets the registration policy and its group link together', async () => {
  const missing = await web('u-admin', 'PUT', '/inbox/accounts/ca-oa/registration-policy', { enabled: true });
  expect(missing.status).toBe(422);
  expect(missing.json.error.fields.groupUrl).toBe('Cần link nhóm Zalo khi bật chính sách');
  const bad = await web('u-admin', 'PUT', '/inbox/accounts/ca-oa/registration-policy', { enabled: true, groupUrl: 'https://evil.example/g/abc' });
  expect(bad.status).toBe(422);
  expect(bad.json.error.fields.groupUrl).toBe('Link nhóm Zalo không hợp lệ');
  const on = await web('u-admin', 'PUT', '/inbox/accounts/ca-oa/registration-policy', { enabled: true, groupUrl: 'https://zalo.me/g/abc123' });
  expect(on.status).toBe(200);
  expect(on.json.data).toMatchObject({ registrationPolicy: true, registrationGroupUrl: 'https://zalo.me/g/abc123' });
  const off = await web('u-admin', 'PUT', '/inbox/accounts/ca-oa/registration-policy', { enabled: false, groupUrl: null });
  expect(off.json.data).toMatchObject({ registrationPolicy: false, registrationGroupUrl: null });
  await db.prepare(`INSERT INTO channel_account (id, organization_id, channel, display_name, status, created_at, updated_at)
    VALUES ('ca-zalo', 'org-abm', 'zalo', 'Số cá nhân', 'disconnected', ?, ?)`).bind(STAMP, STAMP).run();
  const personal = await web('u-admin', 'PUT', '/inbox/accounts/ca-zalo/registration-policy', { enabled: false });
  expect(personal.status).toBe(422);
  expect(personal.json.error.message).toBe('Chỉ tài khoản Zalo OA có chính sách đăng ký');
  expect((await web('u-lan', 'PUT', '/inbox/accounts/ca-oa/registration-policy', { enabled: false })).status).toBe(403);
  expect(await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE command = 'inbox.setRegistrationPolicy'").first('n')).toBe(2);
});

test('a near-expiry credential is refreshed once, a stale version writes nothing, and a failure marks the account', async () => {
  const now = new Date('2026-10-14T04:00:00.000Z');
  await saveTokens('old-access', 'old-refresh', new Date(now.getTime() + 5 * 60 * 60_000).toISOString());
  calls.length = 0;
  await refreshTokens(now);
  expect(tokenCalls()).toHaveLength(0);

  await db.prepare('UPDATE zalo_oa_credential SET access_expires_at = ? WHERE channel_account_id = ?')
    .bind(new Date(now.getTime() + 2 * 60 * 60_000).toISOString(), 'ca-oa').run();
  calls.length = 0;
  onFetch = async (url) => (url.startsWith(TOKEN_URL)
    ? json({ access_token: 'refreshed-access', refresh_token: 'refreshed-refresh', expires_in: 36_000 })
    : json({ error: 0 }));
  await refreshTokens(now);
  expect(tokenCalls()).toHaveLength(1);
  expect(await accessToken(db, testEnv, 'ca-oa', now)).toBe('refreshed-access');

  const stored = await db.prepare('SELECT access_token_enc, version FROM zalo_oa_credential WHERE channel_account_id = ?')
    .bind('ca-oa').first<{ access_token_enc: string; version: number }>();
  await db.prepare('UPDATE zalo_oa_credential SET access_expires_at = ? WHERE channel_account_id = ?')
    .bind(new Date(now.getTime() + 30 * 60_000).toISOString(), 'ca-oa').run();
  onFetch = async (url) => {
    if (url.startsWith(TOKEN_URL)) {
      await db.prepare('UPDATE zalo_oa_credential SET version = version + 1 WHERE channel_account_id = ?').bind('ca-oa').run();
      return json({ access_token: 'should-not-stick', refresh_token: 'should-not-stick', expires_in: 3600 });
    }
    return json({ error: 0 });
  };
  calls.length = 0;
  await refreshTokens(now);
  const afterStale = await db.prepare('SELECT access_token_enc, version FROM zalo_oa_credential WHERE channel_account_id = ?')
    .bind('ca-oa').first<{ access_token_enc: string; version: number }>();
  expect(afterStale).toEqual({ access_token_enc: stored!.access_token_enc, version: stored!.version + 1 });
  expect(await db.prepare('SELECT status, last_error FROM channel_account WHERE id = ?').bind('ca-oa').first())
    .toEqual({ status: 'connected', last_error: null });
  expect(await accessToken(db, testEnv, 'ca-oa', now)).toBe('refreshed-access');

  const beforeLost = await db.prepare('SELECT version FROM zalo_oa_credential WHERE channel_account_id = ?')
    .bind('ca-oa').first<{ version: number }>();
  await db.prepare('UPDATE zalo_oa_credential SET access_expires_at = ? WHERE channel_account_id = ?')
    .bind(new Date(now.getTime() + 20 * 60_000).toISOString(), 'ca-oa').run();
  onFetch = async (url) => {
    if (url.startsWith(TOKEN_URL)) {
      await db.prepare('UPDATE zalo_oa_credential SET version = version + 1 WHERE channel_account_id = ?').bind('ca-oa').run();
      return json({ error: -14014 });
    }
    return json({ error: 0 });
  };
  calls.length = 0;
  await refreshTokens(now);
  expect(await db.prepare('SELECT version FROM zalo_oa_credential WHERE channel_account_id = ?').bind('ca-oa').first('version'))
    .toBe(beforeLost!.version + 1);
  expect(await db.prepare('SELECT status, last_error FROM channel_account WHERE id = ?').bind('ca-oa').first())
    .toEqual({ status: 'connected', last_error: null });
  expect(await commands('send_lark')).toHaveLength(0);
  expect(await accessToken(db, testEnv, 'ca-oa', now)).toBe('refreshed-access');

  await db.prepare('UPDATE zalo_oa_credential SET access_expires_at = ? WHERE channel_account_id = ?')
    .bind(new Date(now.getTime() + 30 * 60_000).toISOString(), 'ca-oa').run();
  onFetch = async (url) => (url.startsWith(TOKEN_URL) ? json({ error: -14014 }) : json({ error: 0 }));
  calls.length = 0;
  await refreshTokens(now);
  expect(await db.prepare('SELECT status, last_error FROM channel_account WHERE id = ?').bind('ca-oa').first())
    .toEqual({ status: 'error', last_error: 'ZALO_OA_REFRESH_FAILED' });
  const [lark] = await commands('send_lark');
  expect(lark.payload.text).toBe('Zalo OA OA ABM không làm mới được token');
  expect(lark.dedupe_key).toMatch(/^zalo-oa-refresh:ca-oa:\d{4}-\d{2}-\d{2}$/);
  expect(JSON.stringify(lark)).not.toContain('refreshed-access');
});

function refreshTokens(now: Date) {
  return refreshZaloOaTokens(db, testEnv, now);
}

test('the minute cron refreshes only when the UTC minute is a multiple of 10', async () => {
  const at10 = new Date(Date.UTC(2026, 9, 14, 1, 10));
  await saveTokens('old-access', 'old-refresh', new Date(at10.getTime() + 60 * 60_000).toISOString());
  calls.length = 0;
  await runScheduled(testEnv, '* * * * *', new Date(Date.UTC(2026, 9, 14, 1, 5)));
  expect(tokenCalls()).toHaveLength(0);
  onFetch = async (url) => (url.startsWith(TOKEN_URL)
    ? json({ access_token: 'cron-access', refresh_token: 'cron-refresh', expires_in: 36_000 })
    : json({ error: 0 }));
  await runScheduled(testEnv, '* * * * *', at10);
  expect(tokenCalls()).toHaveLength(1);
});

test('a correct signature stores one customer message and one completion; a replay and a bad signature do not', async () => {
  const payload = userEvent('user_send_text', 'm_in_1', { text: 'Cho em hỏi học phí' });
  const raw = JSON.stringify(payload);
  expect((await webhook(payload, 'deadbeef')).status).toBe(401);
  expect(await db.prepare('SELECT COUNT(*) AS n FROM message').first('n')).toBe(0);
  expect(await webhook(payload, await sign(raw))).toEqual({ status: 200, text: 'OK' });
  const conv = await conversation();
  expect(conv).toMatchObject({
    channel_account_id: 'ca-oa', kind: 'direct', mode: 'ai', display_name: 'Khách Zalo OA', avatar_url: null, avatar_checked_at: null,
  });
  expect(await messages(conv.id)).toMatchObject([
    { direction: 'in', sender_kind: 'customer', external_msg_id: 'm_in_1', body: 'Cho em hỏi học phí', status: 'received' },
  ]);
  const [completion] = await commands('run_completion');
  expect(completion).toMatchObject({ target: 'bridge', conversation_id: conv.id });
  expect(completion.payload).toMatchObject({
    agentKey: 'tu-van-oa', userId: `zalo_oa:${OA_ID}:${USER_ID}`, text: 'Cho em hỏi học phí', purpose: 'reply', images: [],
  });
  expect(completion.payload.zaloUserId).toBeUndefined();
  expect(await webhook(payload)).toEqual({ status: 200, text: 'OK' });
  expect(await db.prepare('SELECT COUNT(*) AS n FROM message').first('n')).toBe(1);
  expect(await db.prepare("SELECT COUNT(*) AS n FROM channel_command WHERE kind = 'run_completion'").first('n')).toBe(1);

  const ignored = await webhook({
    app_id: APP_ID, timestamp: '1710000000123', oa_id: OA_ID, event_name: 'follow', follower: { id: USER_ID },
  });
  expect(ignored).toEqual({ status: 200, text: 'OK' });
  expect(await db.prepare('SELECT COUNT(*) AS n FROM message').first('n')).toBe(1);

  const unset = await webhook(payload, await sign(raw), { ...testEnv, ZALO_OA_WEBHOOK_SECRET: '' });
  expect(unset).toEqual({ status: 503, text: 'Webhook Zalo chưa được cấu hình' });
  const { app_id: _app, ...withoutApp } = payload;
  expect((await webhook(withoutApp)).status).toBe(400);
  const broken = await app.fetch(new Request(`${ORIGIN}/api/channels/zalo-oa/webhook`, {
    method: 'POST', body: '{', headers: { 'Content-Type': 'application/json' },
  }), testEnv);
  expect(broken.status).toBe(400);
  expect(await broken.text()).toBe('Payload không hợp lệ');
});

test('a profile name is prefixed once, and a burst keeps at most three zdn images', async () => {
  await saveTokens('profile-access');
  onFetch = async (url, init) => {
    if (!url.includes('/user/detail')) return json({ error: 0 });
    expect(headerValue(init, 'access_token')).toBe('profile-access');
    expect(url).not.toContain('profile-access');
    return json({ error: 0, data: { display_name: 'Mai Trần', user_gender: 1 } });
  };
  await webhook(userEvent('user_send_text', 'm1', {
    text: 'Xin chào', attachments: [{ type: 'image', payload: { url: ZDN_A } }],
  }));
  const conv = await conversation();
  expect(conv.display_name).toBe('Mai Trần');
  const [first] = await commands('run_completion');
  expect(first.payload.zaloUserId).toBeUndefined();
  expect(first.payload.images).toEqual([ZDN_A]);
  expect(first.payload.text).toBe('[Hồ sơ Zalo của khách: tên "Mai Trần"; giới tính: không rõ]\nXin chào');

  await webhook(userEvent('user_send_image', 'm2', {
    attachments: [
      { type: 'image', payload: { url: ZDN_B } },
      { type: 'image', payload: { url: 'https://example.com/a.jpg' } },
      { type: 'image', payload: { url: 'http://photo.zdn.vn/nope.jpg' } },
    ],
  }));
  expect(await db.prepare("SELECT COUNT(*) AS n FROM channel_command WHERE kind = 'run_completion'").first('n')).toBe(1);
  const [merged] = await commands('run_completion');
  expect(merged.payload.images).toEqual([ZDN_A, ZDN_B]);
  expect(merged.payload.text.match(/Hồ sơ Zalo của khách/g)).toHaveLength(1);
  expect(merged.payload.text).toContain('Xin chào');
  // The handoff check reads only the customer's lines: no profile prefix, the image-only message as its placeholder.
  expect(merged.payload.customerText).toBe('Xin chào\n[Tệp đính kèm]');
  expect(merged.payload.text).toContain('[Tệp đính kèm]');
  expect((await conversation()).display_name).toBe('Mai Trần');
});

test('an image message keeps the CRM attachment shape and drops non-zdn urls from the completion', async () => {
  const res = await webhook(userEvent('user_send_image', 'img1', {
    attachments: [
      { type: 'image', payload: { url: ZDN_A } },
      { type: 'image', payload: { url: 'https://example.com/a.jpg' } },
      { type: 'image', payload: { url: 'http://photo.zdn.vn/nope.jpg' } },
      { type: 'gif', payload: { url: 'https://stc.zdn.vn/a.gif' } },
    ],
  }));
  expect(res.status).toBe(200);
  const conv = await conversation();
  const [message] = await messages(conv.id);
  expect(JSON.parse(message.attachments_json)).toEqual([
    { url: ZDN_A, mimeType: 'image/jpeg' },
    { url: 'https://example.com/a.jpg', mimeType: 'image/jpeg' },
    { url: 'http://photo.zdn.vn/nope.jpg', mimeType: 'image/jpeg' },
    { url: 'https://stc.zdn.vn/a.gif', mimeType: 'image/gif' },
  ]);
  const [completion] = await commands('run_completion');
  expect(completion.payload.images).toEqual([ZDN_A, 'https://stc.zdn.vn/a.gif']);
  expect(completion.payload.zaloUserId).toBeUndefined();
});

test('a file keeps its name and is not sent to the agent as an image', async () => {
  await webhook(userEvent('user_send_file', 'f1', {
    attachments: [{ type: 'file', payload: { url: 'https://example.com/hoc-phi.pdf', name: 'hoc-phi.pdf' } }],
  }));
  const conv = await conversation();
  const [message] = await messages(conv.id);
  expect(message.body).toBe('[Tệp] hoc-phi.pdf');
  expect(JSON.parse(message.attachments_json)).toEqual([{ url: 'https://example.com/hoc-phi.pdf', name: 'hoc-phi.pdf' }]);
  expect((await commands('run_completion'))[0].payload.images).toEqual([]);
});

test('a failed profile lookup keeps the placeholder name', async () => {
  await saveTokens('profile-access');
  onFetch = async (url) => (url.includes('/user/detail') ? json({ error: -212 }) : json({ error: 0 }));
  await webhook(userEvent('user_send_text', 'm1', { text: 'Xin chào' }));
  expect((await conversation()).display_name).toBe('Khách Zalo OA');
  expect((await commands('run_completion'))[0].payload.text).toBe('Xin chào');
});

test('an echo of our own message changes nothing, and a seen event sets seen_at', async () => {
  const conv = await customerTurn();
  await saveTokens('send-access');
  onFetch = async (url) => (url.includes('/message/cs') ? json({ error: 0, data: { message_id: 'm_bot_1' } }) : json({ error: 0 }));
  await applyCompletionResult(db, testEnv, conv.id, 'Học phí là 5 triệu ạ');
  await processWorkerCommands(testEnv);
  const before = (await messages(conv.id)).length;
  const echo = await webhook({
    app_id: APP_ID, timestamp: '1710000000123', oa_id: OA_ID, event_name: 'oa_send_text',
    sender: { id: OA_ID }, recipient: { id: USER_ID }, message: { msg_id: 'm_bot_1', text: 'Học phí là 5 triệu ạ' },
  });
  expect(echo.status).toBe(200);
  expect(await messages(conv.id)).toHaveLength(before);
  expect((await conversation()).mode).toBe('ai');

  const seen = await webhook({
    app_id: APP_ID, timestamp: '1710000000999', oa_id: OA_ID, event_name: 'user_seen_message',
    sender: { id: USER_ID }, recipient: { id: OA_ID }, message: { msg_ids: ['m_bot_1'] },
  });
  expect(seen.status).toBe(200);
  expect((await messages(conv.id)).find((message) => message.sender_kind === 'bot').seen_at).toBe(new Date(1710000000999).toISOString());
});

test('an oa_send for an unknown customer creates nothing', async () => {
  const res = await webhook(oaSend('broadcast-1', 'Tin gửi hàng loạt', '7999'));
  expect(res).toEqual({ status: 200, text: 'OK' });
  expect(await db.prepare("SELECT COUNT(*) AS n FROM conversation WHERE external_thread_id = '7999'").first('n')).toBe(0);
  expect(await db.prepare('SELECT COUNT(*) AS n FROM message').first('n')).toBe(0);
});

test('both echoes of a two-part reply leave the conversation with the bot', async () => {
  const conv = await customerTurn();
  await saveTokens('send-access');
  const longText = `${'a'.repeat(1500)}\n${'b'.repeat(1500)}`;
  const echoStatuses: number[] = [];
  onFetch = async (url) => {
    if (!url.includes('/message/cs')) return json({ error: 0 });
    const text = JSON.parse(String(csCalls().at(-1)?.init?.body)).message.text as string;
    const mid = `echo-${csCalls().length}`;
    echoStatuses.push((await webhook(oaSend(mid, text))).status);
    return json({ error: 0, data: { message_id: mid } });
  };
  await applyCompletionResult(db, testEnv, conv.id, longText);
  await processWorkerCommands(testEnv);
  expect(echoStatuses).toEqual([200, 200]);
  expect((await conversation()).mode).toBe('ai');
  const rows = await messages(conv.id);
  expect(rows.filter((message) => message.sender_kind === 'staff_phone')).toHaveLength(0);
  expect(rows.filter((message) => message.sender_kind === 'bot')).toEqual([
    expect.objectContaining({ status: 'sent', external_msg_id: 'echo-1', body: longText }),
  ]);
  expect(rows).toHaveLength(2);
});

test('an echo that arrives before the send recorded the Zalo message id changes nothing else', async () => {
  const conv = await customerTurn();
  await saveTokens('send-access');
  let early: { status: string; external_msg_id: string | null; sender_kind: string }[] = [];
  let earlyMode = '';
  let echoStatus = 0;
  onFetch = async (url) => {
    if (!url.includes('/message/cs')) return json({ error: 0 });
    const text = JSON.parse(String(csCalls().at(-1)?.init?.body)).message.text as string;
    echoStatus = (await webhook(oaSend('mid-early', text))).status;
    early = (await db.prepare("SELECT status, external_msg_id, sender_kind FROM message WHERE body = ? AND direction = 'out'")
      .bind(text).all<{ status: string; external_msg_id: string | null; sender_kind: string }>()).results;
    earlyMode = (await conversation()).mode;
    return json({ error: 0, data: { message_id: 'mid-early' } });
  };
  await applyCompletionResult(db, testEnv, conv.id, 'Học phí là 5 triệu ạ');
  await processWorkerCommands(testEnv);
  expect(echoStatus).toBe(200);
  // The echo may fill the channel id. Only the send loop marks the row sent.
  expect(early).toEqual([{ status: 'pending', external_msg_id: 'mid-early', sender_kind: 'bot' }]);
  expect(earlyMode).toBe('ai');
  expect((await conversation()).mode).toBe('ai');
  expect(await messages(conv.id)).toHaveLength(2);
  expect((await messages(conv.id)).find((message) => message.sender_kind === 'bot')).toMatchObject({
    status: 'sent', external_msg_id: 'mid-early',
  });
});

test('an OA auto-reply three seconds after the customer stays visible and leaves the mode alone', async () => {
  const conv = await customerTurn();
  await db.prepare('UPDATE message SET created_at = ? WHERE conversation_id = ?')
    .bind(new Date(Date.now() - 3_000).toISOString(), conv.id).run();
  const res = await webhook(oaSend('welcome-1', 'OA xin chào anh chị'));
  expect(res).toEqual({ status: 200, text: 'OK' });
  const after = await conversation();
  expect(after.mode).toBe('ai');
  expect(after.last_staff_reply_at).toBeNull();
  expect(await messages(conv.id)).toMatchObject([
    { sender_kind: 'customer', body: 'Cho em hỏi học phí' },
    { direction: 'out', sender_kind: 'system', external_msg_id: 'welcome-1', body: 'OA xin chào anh chị', status: 'sent' },
  ]);
  expect(await commands('run_completion')).toHaveLength(1);
});

test('a staff reply in the OA app five minutes later switches the conversation to human', async () => {
  const conv = await customerTurn();
  await db.prepare('UPDATE message SET created_at = ? WHERE conversation_id = ?')
    .bind(new Date(Date.now() - 5 * 60_000).toISOString(), conv.id).run();
  const res = await webhook(oaSend('staff-1', 'Em gọi lại'));
  expect(res).toEqual({ status: 200, text: 'OK' });
  expect((await conversation()).mode).toBe('human');
  expect((await messages(conv.id)).find((message) => message.external_msg_id === 'staff-1')).toMatchObject({
    direction: 'out', sender_kind: 'staff_phone', body: 'Em gọi lại', status: 'sent',
  });
});

test('a retried send is still recognised when its echo arrives after the insert window', async () => {
  const conv = await customerTurn();
  await saveTokens('send-access');
  onFetch = async (url) => {
    if (!url.includes('/message/cs')) return json({ error: 0 });
    if (csCalls().length === 1) return json({ error: 0 }, 500);
    const text = JSON.parse(String(csCalls().at(-1)?.init?.body)).message.text as string;
    expect((await webhook(oaSend('mid-retry', text))).status).toBe(200);
    return json({ error: 0, data: { message_id: 'mid-retry' } });
  };
  await applyCompletionResult(db, testEnv, conv.id, 'Học phí là 5 triệu ạ');
  await processWorkerCommands(testEnv);
  expect((await commands('send_zalo_oa'))[0]).toMatchObject({ status: 'pending', attempts: 1 });

  const aged = new Date(Date.now() - 3 * 60_000).toISOString();
  await db.prepare(`UPDATE message SET created_at = ? WHERE conversation_id = ? AND direction = 'out'`)
    .bind(aged, conv.id).run();
  await db.prepare(`UPDATE channel_command SET created_at = ?, updated_at = ?, next_run_at = ? WHERE kind = 'send_zalo_oa'`)
    .bind(aged, aged, aged).run();
  await processWorkerCommands(testEnv);

  expect((await conversation()).mode).toBe('ai');
  const rows = await messages(conv.id);
  expect(rows.filter((message) => message.sender_kind === 'staff_phone')).toHaveLength(0);
  expect(rows.filter((message) => message.sender_kind === 'bot')).toEqual([
    expect.objectContaining({ status: 'sent', external_msg_id: 'mid-retry', body: 'Học phí là 5 triệu ạ' }),
  ]);
  expect(rows).toHaveLength(2);
});

test('a short staff reply is stored even when a recent bot reply contains it', async () => {
  const conv = await customerTurn();
  await saveTokens('send-access');
  onFetch = async (url) => (url.includes('/message/cs') ? json({ error: 0, data: { message_id: 'm_bot_da' } }) : json({ error: 0 }));
  await applyCompletionResult(db, testEnv, conv.id, 'Dạ, học phí khoá là 5 triệu ạ');
  await processWorkerCommands(testEnv);
  const sentAt = new Date(Date.now() - 30_000).toISOString();
  await db.prepare(`UPDATE message SET created_at = ? WHERE conversation_id = ? AND sender_kind = 'bot'`)
    .bind(sentAt, conv.id).run();
  await db.prepare(`UPDATE channel_command SET updated_at = ? WHERE kind = 'send_zalo_oa'`).bind(sentAt).run();
  const res = await webhook(oaSend('staff-da', 'Dạ'));
  expect(res).toEqual({ status: 200, text: 'OK' });
  expect((await conversation()).mode).toBe('human');
  expect((await messages(conv.id)).find((message) => message.external_msg_id === 'staff-da')).toMatchObject({
    direction: 'out', sender_kind: 'staff_phone', body: 'Dạ', status: 'sent',
  });
});

test('an echo of one part of a pending reply leaves that reply pending until the send loop posts it', async () => {
  const conv = await customerTurn();
  await saveTokens('send-access');
  const longText = `${'a'.repeat(1500)}\n${'b'.repeat(1500)}`;
  await applyCompletionResult(db, testEnv, conv.id, longText);
  const res = await webhook(oaSend('part-1', 'a'.repeat(1500)));
  expect(res).toEqual({ status: 200, text: 'OK' });
  expect((await conversation()).mode).toBe('ai');
  expect((await messages(conv.id)).find((message) => message.sender_kind === 'bot')).toMatchObject({
    status: 'pending', external_msg_id: 'part-1', body: longText,
  });
  expect((await messages(conv.id)).filter((message) => message.sender_kind === 'staff_phone')).toHaveLength(0);

  onFetch = async (url) => (url.includes('/message/cs') ? json({ error: 0, data: { message_id: `mid-${csCalls().length}` } }) : json({ error: 0 }));
  calls.length = 0;
  await processWorkerCommands(testEnv);
  expect(csCalls().map((call) => JSON.parse(String(call.init?.body)).message.text)).toEqual(['a'.repeat(1500), 'b'.repeat(1500)]);
  expect((await messages(conv.id)).find((message) => message.sender_kind === 'bot')).toMatchObject({
    status: 'sent', external_msg_id: 'part-1',
  });
  expect((await conversation()).mode).toBe('ai');
});

test('a long reply is posted in two parts, an outside-window code is final, and -216 refreshes once', async () => {
  const conv = await customerTurn();
  await saveTokens('send-access');
  const longText = `${'a'.repeat(1500)}\n${'b'.repeat(1500)}`;
  onFetch = async (url) => (url.includes('/message/cs')
    ? json({ error: 0, data: { message_id: `mid-${csCalls().length}` } })
    : json({ error: 0 }));
  calls.length = 0;
  await applyCompletionResult(db, testEnv, conv.id, longText);
  await processWorkerCommands(testEnv);
  expect(csCalls().map((call) => JSON.parse(String(call.init?.body)).message.text)).toEqual(['a'.repeat(1500), 'b'.repeat(1500)]);
  expect(headerValue(csCalls()[0]?.init, 'access_token')).toBe('send-access');
  expect((await commands('send_zalo_oa'))[0]).toMatchObject({ target: 'worker', status: 'done' });
  expect(JSON.stringify((await commands('send_zalo_oa'))[0].result)).not.toContain('send-access');

  await db.prepare("UPDATE conversation SET mode = 'ai' WHERE id = ?").bind(conv.id).run();
  onFetch = async (url) => (url.includes('/message/cs') ? json({ error: -230 }) : json({ error: 0 }));
  calls.length = 0;
  await applyCompletionResult(db, testEnv, conv.id, 'Ngoài giờ');
  await processWorkerCommands(testEnv);
  expect(csCalls()).toHaveLength(1);
  expect(tokenCalls()).toHaveLength(0);
  expect((await commands('send_zalo_oa')).at(-1)).toMatchObject({ status: 'failed', attempts: 1, result: { error: 'ZALO_OA_OUTSIDE_WINDOW:-230' } });
  expect((await messages(conv.id)).find((message) => message.body === 'Ngoài giờ')).toMatchObject({ status: 'failed' });
  expect((await messages(conv.id)).find((message) => message.sender_kind === 'system')).toMatchObject({
    direction: 'out', status: 'failed', body: 'Quá thời hạn trả lời của Zalo OA (ZALO_OA_OUTSIDE_WINDOW:-230)',
  });

  onFetch = async (url, init) => {
    if (url.startsWith(TOKEN_URL)) return json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 36_000 });
    if (url.includes('/message/cs')) {
      return headerValue(init, 'access_token') === 'send-access'
        ? json({ error: -216 })
        : json({ error: 0, data: { message_id: 'mid-216' } });
    }
    return json({ error: 0 });
  };
  calls.length = 0;
  await db.prepare("UPDATE conversation SET mode = 'ai' WHERE id = ?").bind(conv.id).run();
  await applyCompletionResult(db, testEnv, conv.id, 'Gửi lại');
  await processWorkerCommands(testEnv);
  expect(tokenCalls()).toHaveLength(1);
  expect(csCalls().map((call) => headerValue(call.init, 'access_token'))).toEqual(['send-access', 'new-access']);
  expect((await messages(conv.id)).find((message) => message.body === 'Gửi lại')).toMatchObject({ status: 'sent', external_msg_id: 'mid-216' });
  expect(JSON.stringify((await commands('send_zalo_oa')).at(-1).result)).not.toContain('new-access');
});

test('HTTP 401 refreshes once and an unknown Zalo code stays retryable', async () => {
  const conv = await customerTurn();
  await saveTokens('send-access');
  onFetch = async (url, init) => {
    if (url.startsWith(TOKEN_URL)) return json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 36_000 });
    if (url.includes('/message/cs')) {
      return headerValue(init, 'access_token') === 'send-access' ? json({ error: 0 }, 401) : json({ error: 0, data: { message_id: 'mid-401' } });
    }
    return json({ error: 0 });
  };
  calls.length = 0;
  await applyCompletionResult(db, testEnv, conv.id, 'Một');
  await processWorkerCommands(testEnv);
  expect(tokenCalls()).toHaveLength(1);
  expect(csCalls()).toHaveLength(2);

  onFetch = async (url) => (url.includes('/message/cs') ? json({ error: -201 }) : json({ error: 0 }));
  await db.prepare("UPDATE conversation SET mode = 'ai' WHERE id = ?").bind(conv.id).run();
  await applyCompletionResult(db, testEnv, conv.id, 'Hai');
  await processWorkerCommands(testEnv);
  expect((await commands('send_zalo_oa')).at(-1)).toMatchObject({ status: 'pending', attempts: 1, result: { error: 'ZALO_-201' } });
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]);

async function uploadStaffImage() {
  const form = new FormData();
  form.set('file', new File([JPEG], 'a.jpg', { type: 'image/jpeg' }));
  const res = await app.fetch(new Request(`${ORIGIN}/api/inbox/media`, {
    method: 'POST', body: form, headers: { 'X-Demo-User': 'u-lan' },
  }), testEnv);
  const body = await res.json() as { data: { key: string; url: string } };
  expect(res.status).toBe(200);
  return body.data;
}

function oaImage(msgId: string, url = 'https://photo.zdn.vn/echo.jpg') {
  return {
    app_id: APP_ID, timestamp: '1710000000123', oa_id: OA_ID, event_name: 'oa_send_image',
    sender: { id: OA_ID }, recipient: { id: USER_ID },
    message: { msg_id: msgId, text: '', attachments: [{ type: 'image', payload: { url } }] },
  };
}

test('a staff image is uploaded, then sent with no repeated caption, and its echoes do not add a row', async () => {
  const conv = await customerTurn();
  await saveTokens('send-access');
  const media = await uploadStaffImage();
  const order: string[] = [];
  onFetch = async (url, init) => {
    if (url.includes('/oa/upload/image')) {
      order.push('upload');
      expect(headerValue(init, 'access_token')).toBe('send-access');
      expect(init?.body).toBeInstanceOf(FormData);
      return json({ error: 0, data: { attachment_id: 'att-1' } });
    }
    if (url.includes('/message/cs')) {
      order.push('cs');
      return json({ error: 0, data: { message_id: `mid-${order.length}` } });
    }
    return json({ error: 0 });
  };
  calls.length = 0;
  const sent = await web('u-lan', 'POST', `/inbox/conversations/${conv.id}/messages`, {
    text: 'Xem ảnh này', attachments: [{ key: media.key }],
  });
  expect(sent.status).toBe(200);
  expect(order).toEqual(['cs', 'upload', 'cs']);
  const bodies = csCalls().map((call) => JSON.parse(String(call.init?.body)));
  expect(bodies[0].message).toEqual({ text: 'Xem ảnh này' });
  expect(bodies[1].message).toEqual({
    attachment: { type: 'template', payload: { template_type: 'media', elements: [{ media_type: 'image', attachment_id: 'att-1' }] } },
  });
  const staff = (await messages(conv.id)).find((message) => message.id === sent.json.data.messageId);
  expect(staff).toMatchObject({ status: 'sent', body: 'Xem ảnh này' });
  expect(JSON.parse(staff.attachments_json)[0].url).toBe(media.url);

  const command = (await commands('send_zalo_oa')).at(-1);
  expect(command.payload.sentMids).toEqual(['mid-1', 'mid-3']);
  expect(command.result.sentMids).toEqual(['mid-1', 'mid-3']);
  const before = (await messages(conv.id)).length;
  expect((await webhook(oaImage('mid-1'))).status).toBe(200);
  expect((await webhook(oaImage('mid-3', 'https://photo.zdn.vn/echo-2.jpg'))).status).toBe(200);
  const after = await messages(conv.id);
  expect(after).toHaveLength(before);
  expect(after.find((message) => message.id === staff.id)).toMatchObject({ external_msg_id: 'mid-1' });
  expect(JSON.parse(after.find((message) => message.id === staff.id).attachments_json)[0].url).toBe(media.url);
  expect(after.filter((message) => message.sender_kind === 'staff_phone')).toHaveLength(0);
});

test('an image-only staff send does not post the placeholder, and an image echo does not swallow a text send', async () => {
  const conv = await customerTurn();
  await saveTokens('send-access');
  const media = await uploadStaffImage();
  onFetch = async (url) => {
    if (url.includes('/oa/upload/image')) return json({ error: 0, data: { attachment_id: 'att-2' } });
    if (url.includes('/message/cs')) return json({ error: 0, data: { message_id: 'mid-img' } });
    return json({ error: 0 });
  };
  calls.length = 0;
  const sent = await web('u-lan', 'POST', `/inbox/conversations/${conv.id}/messages`, { attachments: [{ key: media.key }] });
  expect(sent.status).toBe(200);
  expect((await db.prepare('SELECT body FROM message WHERE id = ?').bind(sent.json.data.messageId).first<{ body: string }>()))
    .toEqual({ body: '[Tệp đính kèm]' });
  expect(csCalls()).toHaveLength(1);
  expect(JSON.parse(String(csCalls()[0]!.init?.body)).message.text).toBeUndefined();
  expect((await messages(conv.id)).find((message) => message.sender_kind === 'staff_web').external_msg_id).toBe('mid-img');
});

test('an image typed in the OA app after a text reply is stored', async () => {
  const conv = await customerTurn();
  await saveTokens('send-access');
  onFetch = async (url) => (url.includes('/message/cs') ? json({ error: 0, data: { message_id: 'mid-text' } }) : json({ error: 0 }));
  const text = await web('u-lan', 'POST', `/inbox/conversations/${conv.id}/messages`, { text: 'Em nhắn tiếp' });
  await processWorkerCommands(testEnv);
  expect(text.status).toBe(200);
  const before = (await messages(conv.id)).length;
  expect((await webhook(oaImage('from-app'))).status).toBe(200);
  const rows = await messages(conv.id);
  expect(rows).toHaveLength(before + 1);
  expect(rows.find((message) => message.external_msg_id === 'from-app')).toMatchObject({ sender_kind: 'staff_phone' });
  expect(rows.find((message) => message.id === text.json.data.messageId).external_msg_id).toBe('mid-text');
});

test('an image from the OA app 30 seconds after a CRM image is stored', async () => {
  const conv = await customerTurn();
  await saveTokens('send-access');
  const media = await uploadStaffImage();
  onFetch = async (url) => {
    if (url.includes('/oa/upload/image')) return json({ error: 0, data: { attachment_id: 'att-app' } });
    if (url.includes('/message/cs')) return json({ error: 0, data: { message_id: 'mid-crm' } });
    return json({ error: 0 });
  };
  calls.length = 0;
  const sent = await web('u-lan', 'POST', `/inbox/conversations/${conv.id}/messages`, { attachments: [{ key: media.key }] });
  expect(sent.status).toBe(200);
  const ago = new Date(Date.now() - 30_000).toISOString();
  await db.prepare('UPDATE message SET created_at = ? WHERE id = ?').bind(ago, sent.json.data.messageId).run();
  await db.prepare(`UPDATE channel_command SET created_at = ?, updated_at = ? WHERE kind = 'send_zalo_oa'`).bind(ago, ago).run();
  const before = (await messages(conv.id)).length;
  expect((await webhook(oaImage('from-app-30'))).status).toBe(200);
  const rows = await messages(conv.id);
  expect(rows).toHaveLength(before + 1);
  expect(rows.find((message) => message.external_msg_id === 'from-app-30')).toMatchObject({ sender_kind: 'staff_phone' });
  expect(rows.find((message) => message.id === sent.json.data.messageId).external_msg_id).toBe('mid-crm');
});

test('an echo of CRM image A does not fill CRM image B', async () => {
  const conv = await customerTurn();
  await saveTokens('send-access');
  const imageA = await uploadStaffImage();
  const imageB = await uploadStaffImage();
  let n = 0;
  onFetch = async (url) => {
    if (url.includes('/oa/upload/image')) return json({ error: 0, data: { attachment_id: `att-${n}` } });
    if (url.includes('/message/cs')) {
      n += 1;
      return json({ error: 0, data: { message_id: `mid-${n}` } });
    }
    return json({ error: 0 });
  };
  calls.length = 0;
  const sentA = await web('u-lan', 'POST', `/inbox/conversations/${conv.id}/messages`, {
    text: 'Ảnh A', attachments: [{ key: imageA.key }],
  });
  const sentB = await web('u-lan', 'POST', `/inbox/conversations/${conv.id}/messages`, {
    text: 'Ảnh B', attachments: [{ key: imageB.key }],
  });
  expect(sentA.status).toBe(200);
  expect(sentB.status).toBe(200);
  await db.prepare('UPDATE message SET external_msg_id = NULL WHERE id = ?').bind(sentB.json.data.messageId).run();
  const before = (await messages(conv.id)).length;
  expect((await webhook(oaImage('mid-2'))).status).toBe(200);
  const rows = await messages(conv.id);
  expect(rows).toHaveLength(before);
  expect(rows.find((message) => message.id === sentA.json.data.messageId).external_msg_id).toBe('mid-1');
  expect(rows.find((message) => message.id === sentB.json.data.messageId).external_msg_id).toBeNull();
});

test('an echo whose id is in sentMids creates no row', async () => {
  const conv = await customerTurn();
  await saveTokens('send-access');
  const media = await uploadStaffImage();
  onFetch = async (url) => {
    if (url.includes('/oa/upload/image')) return json({ error: 0, data: { attachment_id: 'att-mid' } });
    if (url.includes('/message/cs')) return json({ error: 0, data: { message_id: 'mid-recorded' } });
    return json({ error: 0 });
  };
  calls.length = 0;
  const sent = await web('u-lan', 'POST', `/inbox/conversations/${conv.id}/messages`, {
    text: 'Một ảnh', attachments: [{ key: media.key }],
  });
  const recorded = (await commands('send_zalo_oa')).at(-1).payload.sentMids as string[];
  expect(recorded).toContain('mid-recorded');
  await db.prepare('UPDATE message SET external_msg_id = NULL WHERE id = ?').bind(sent.json.data.messageId).run();
  const before = (await messages(conv.id)).length;
  expect((await webhook(oaImage('mid-recorded'))).status).toBe(200);
  const rows = await messages(conv.id);
  expect(rows).toHaveLength(before);
  expect(rows.find((message) => message.id === sent.json.data.messageId).external_msg_id).toBe('mid-recorded');
  expect(rows.filter((message) => message.sender_kind === 'staff_phone')).toHaveLength(0);
});

test('a sticker echo inside the image window is stored', async () => {
  const conv = await customerTurn();
  await saveTokens('send-access');
  const media = await uploadStaffImage();
  onFetch = async (url) => {
    if (url.includes('/oa/upload/image')) return json({ error: 0, data: { attachment_id: 'att-stk' } });
    if (url.includes('/message/cs')) return json({ error: 0, data: { message_id: 'mid-stk' } });
    return json({ error: 0 });
  };
  calls.length = 0;
  const sent = await web('u-lan', 'POST', `/inbox/conversations/${conv.id}/messages`, { attachments: [{ key: media.key }] });
  expect(sent.status).toBe(200);
  const before = (await messages(conv.id)).length;
  const sticker = {
    app_id: APP_ID, timestamp: '1710000000123', oa_id: OA_ID, event_name: 'oa_send_sticker',
    sender: { id: OA_ID }, recipient: { id: USER_ID },
    message: { msg_id: 'stk-1', text: '', attachments: [{ type: 'sticker', payload: { url: 'https://photo.zdn.vn/sticker.png' } }] },
  };
  expect((await webhook(sticker)).status).toBe(200);
  const rows = await messages(conv.id);
  expect(rows).toHaveLength(before + 1);
  expect(rows.find((message) => message.external_msg_id === 'stk-1')).toMatchObject({ sender_kind: 'staff_phone' });
  expect(rows.find((message) => message.id === sent.json.data.messageId).external_msg_id).toBe('mid-stk');
});

test('a retry after the image call fails sends only the image', async () => {
  const conv = await customerTurn();
  await saveTokens('send-access');
  const media = await uploadStaffImage();
  let imageAttempts = 0;
  onFetch = async (url, init) => {
    if (url.includes('/oa/upload/image')) return json({ error: 0, data: { attachment_id: 'att-part' } });
    if (url.includes('/message/cs')) {
      const body = JSON.parse(String(init?.body)) as { message?: { text?: string } };
      if (body.message?.text) return json({ error: 0, data: { message_id: 'mid-text' } });
      imageAttempts += 1;
      if (imageAttempts === 1) return json({ error: -201 });
      return json({ error: 0, data: { message_id: 'mid-img' } });
    }
    return json({ error: 0 });
  };
  calls.length = 0;
  const sent = await web('u-lan', 'POST', `/inbox/conversations/${conv.id}/messages`, {
    text: 'Xem ảnh', attachments: [{ key: media.key }],
  });
  expect(sent.status).toBe(200);
  expect(csCalls().map((call) => JSON.parse(String(call.init?.body)).message.text)).toEqual(['Xem ảnh', undefined]);
  const failed = (await commands('send_zalo_oa')).at(-1);
  expect(failed).toMatchObject({ status: 'pending', attempts: 1, result: { error: 'ZALO_-201' } });
  expect(failed.payload.sentMids).toEqual(['mid-text']);
  expect((await messages(conv.id)).find((message) => message.id === sent.json.data.messageId)).toMatchObject({ status: 'pending' });

  const past = new Date(Date.now() - 60_000).toISOString();
  await db.prepare(`UPDATE channel_command SET next_run_at = ? WHERE kind = 'send_zalo_oa'`).bind(past).run();
  calls.length = 0;
  await processWorkerCommands(testEnv);
  expect(csCalls()).toHaveLength(1);
  expect(JSON.parse(String(csCalls()[0]!.init?.body)).message.text).toBeUndefined();
  expect(JSON.parse(String(csCalls()[0]!.init?.body)).message.attachment.payload.elements[0].attachment_id).toBe('att-part');
  const done = (await commands('send_zalo_oa')).at(-1);
  expect(done.result).toMatchObject({ sent: true, parts: 2, externalMsgId: 'mid-text', sentMids: ['mid-text', 'mid-img'] });
  expect((await messages(conv.id)).find((message) => message.id === sent.json.data.messageId)).toMatchObject({
    status: 'sent', external_msg_id: 'mid-text',
  });
});

test('an outside-window error on the image call is final', async () => {
  const conv = await customerTurn();
  await saveTokens('send-access');
  const media = await uploadStaffImage();
  onFetch = async (url) => {
    if (url.includes('/oa/upload/image')) return json({ error: 0, data: { attachment_id: 'att-3' } });
    if (url.includes('/message/cs')) return json({ error: -213 });
    return json({ error: 0 });
  };
  calls.length = 0;
  const sent = await web('u-lan', 'POST', `/inbox/conversations/${conv.id}/messages`, { attachments: [{ key: media.key }] });
  expect(csCalls()).toHaveLength(1);
  expect((await commands('send_zalo_oa')).at(-1)).toMatchObject({ status: 'failed', result: { error: 'ZALO_OA_OUTSIDE_WINDOW:-213' } });
  expect((await messages(conv.id)).find((message) => message.id === sent.json.data.messageId)).toMatchObject({ status: 'failed' });
  expect((await messages(conv.id)).find((message) => message.sender_kind === 'system')).toMatchObject({
    body: 'Quá thời hạn trả lời của Zalo OA (ZALO_OA_OUTSIDE_WINDOW:-213)',
  });
});

test('a registration confirmation with the wrong group link is not sent and hands off', async () => {
  const conv = await customerTurn();
  await db.prepare('UPDATE channel_account SET registration_policy = 1, registration_group_url = ? WHERE id = ?')
    .bind('https://zalo.me/g/abc123', 'ca-oa').run();
  const reply = 'Anh/chị đã đăng ký thành công chương trình Xây dựng Bộ não thứ hai & Đội quân Trợ lý AI cá nhân hóa. https://zalo.me/g/wrong';
  const outcome = await applyCompletionResult(db, testEnv, conv.id, reply);
  expect(outcome.workerCommandQueued).toBe(true);
  expect(await commands('send_zalo_oa')).toHaveLength(0);
  expect((await conversation()).mode).toBe('human');
  const system = (await messages(conv.id)).find((message) => message.sender_kind === 'system');
  expect(system).toMatchObject({ direction: 'out', status: 'failed' });
  expect(system.body.startsWith('Chưa gửi (kiểm tra 199k):')).toBe(true);
  expect(system.body).toContain(reply);
  expect(await commands('send_lark')).toHaveLength(1);
});

test('a 199k payment keeps the registration rules: the handoff check never hands off a confirmed or 199k-policy turn', async () => {
  const activeEnv = { ...testEnv, HANDOFF_NET_MODE: 'active' };
  const handoffChecks = () => db.prepare("SELECT after_json FROM audit_log WHERE command = 'inbox.handoffCheck' ORDER BY created_at")
    .all<{ after_json: string }>().then((r) => r.results.map((row) => JSON.parse(row.after_json)));
  await db.prepare('UPDATE channel_account SET registration_policy = 1, registration_group_url = ? WHERE id = ?')
    .bind('https://zalo.me/g/abc123', 'ca-oa').run();
  const conv = await customerTurn('Em gửi bill chuyển khoản rồi ạ');
  const [pending] = await commands('run_completion');
  const reply = 'Anh/chị đã đăng ký thành công chương trình Xây dựng Bộ não thứ hai & Đội quân Trợ lý AI cá nhân hóa. Mời vào nhóm: https://zalo.me/g/abc123';
  const confirmed = await applyCompletionResult(db, activeEnv, conv.id, reply, undefined, asCompletionPayload(pending.payload));
  await confirmed.handoffCheck?.();
  expect(await commands('send_zalo_oa')).toHaveLength(1);
  expect((await conversation()).mode).toBe('ai');

  // The bot asks for the receipt instead of confirming: on a 199k-policy account the payment turn is still left to the bot.
  const asking = await applyCompletionResult(db, activeEnv, conv.id, 'Dạ Anh/Chị gửi giúp em ảnh biên lai nhé', undefined,
    asCompletionPayload(pending.payload));
  await asking.handoffCheck?.();
  expect((await conversation()).mode).toBe('ai');
  expect(await commands('send_lark')).toHaveLength(0);
  expect((await handoffChecks()).map((after) => [after.decided?.category, after.held, after.applied])).toEqual([
    ['payment_done', 'registration_confirmed', false],
    ['payment_done', 'payment_199k', false],
  ]);
});

test('a processing error answers 503 and the same event twice stores one message', async () => {
  const payload = userEvent('user_send_text', 'm_retry', { text: 'Gửi lại giúp em' });
  const original = db.prepare.bind(db);
  let armed = true;
  const spy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
    if (armed && sql.includes('INSERT INTO message')) {
      armed = false;
      throw new Error('d1 down');
    }
    return original(sql);
  });
  try {
    const failed = await webhook(payload);
    expect(failed).toEqual({ status: 503, text: 'Tạm thời không xử lý được' });
  } finally {
    spy.mockRestore();
  }
  expect(await db.prepare("SELECT COUNT(*) AS n FROM message WHERE external_msg_id = 'm_retry'").first('n')).toBe(0);
  expect(await webhook(payload)).toEqual({ status: 200, text: 'OK' });
  expect(await webhook(payload)).toEqual({ status: 200, text: 'OK' });
  expect(await db.prepare("SELECT COUNT(*) AS n FROM message WHERE external_msg_id = 'm_retry'").first('n')).toBe(1);
});

test('a follow-up failure after the insert is recovered when Zalo sends the event again', async () => {
  const payload = userEvent('user_send_text', 'm_follow', { text: 'Nhắc lại giúp em' });
  const original = db.prepare.bind(db);
  let armed = true;
  const spy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
    if (armed && sql.includes('last_inbound_at') && sql.startsWith('UPDATE')) {
      armed = false;
      throw new Error('follow-up down');
    }
    return original(sql);
  });
  try {
    const failed = await webhook(payload);
    expect(failed).toEqual({ status: 503, text: 'Tạm thời không xử lý được' });
  } finally {
    spy.mockRestore();
  }
  expect(await db.prepare("SELECT COUNT(*) AS n FROM message WHERE external_msg_id = 'm_follow'").first('n')).toBe(1);
  expect(await db.prepare("SELECT COUNT(*) AS n FROM channel_command WHERE kind = 'run_completion'").first('n')).toBe(0);
  expect(await webhook(payload)).toEqual({ status: 200, text: 'OK' });
  expect(await db.prepare("SELECT COUNT(*) AS n FROM message WHERE external_msg_id = 'm_follow'").first('n')).toBe(1);
  expect(await commands('run_completion')).toEqual([
    expect.objectContaining({ status: 'pending', payload: expect.objectContaining({ text: 'Nhắc lại giúp em' }) }),
  ]);
  expect(await webhook(payload)).toEqual({ status: 200, text: 'OK' });
  expect(await db.prepare("SELECT COUNT(*) AS n FROM message WHERE external_msg_id = 'm_follow'").first('n')).toBe(1);
  expect(await commands('run_completion')).toHaveLength(1);
});

test('classifying an OA conversation creates a lead with source zalo', async () => {
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO conversation (id, organization_id, channel_account_id, kind, external_thread_id, display_name, created_at, updated_at)
    VALUES ('conv-oa-lead', 'org-abm', 'ca-oa', 'direct', ?, 'Khách OA', ?, ?)`).bind('oa-user-lead', now, now).run();
  await db.prepare(`INSERT INTO message (id, conversation_id, direction, sender_kind, body, status, created_at)
    VALUES ('msg-oa-lead', 'conv-oa-lead', 'in', 'customer', 'Em muốn học', 'received', ?)`).bind(now).run();
  await db.prepare(`INSERT INTO lead_intake (id, organization_id, conversation_id, fields_json, status, created_at, updated_at)
    VALUES ('intake-oa', 'org-abm', 'conv-oa-lead', ?, 'pending', ?, ?)`)
    .bind(JSON.stringify({ name: 'Chị OA', phone: '0933000444' }), now, now).run();
  const res = await web('u-lan', 'POST', '/inbox/intakes/intake-oa/classify', {
    pipeline: 'b2b',
    input: {
      contactName: 'Chị OA', phone: '0933000444', needSummary: 'Hỏi khóa qua OA',
      nextAction: { title: 'Gọi tư vấn', dueAt: new Date(Date.now() + 86_400_000).toISOString() },
      source: 'zalo_oa',
    },
  });
  expect(res.status).toBe(200);
  const lead = await db.prepare('SELECT pipeline, source FROM lead WHERE id = ?').bind(res.json.data.leadId).first();
  expect(lead).toEqual({ pipeline: 'b2b', source: 'zalo' });
});

const profileCalls = () => calls.filter((call) => call.url.includes('/user/detail'));
const MINUTE = new Date(Date.UTC(2026, 9, 14, 1, 5));

function oaUser(userId: string, msgId: string, text = 'Xin chào') {
  return {
    app_id: APP_ID, timestamp: '1710000000123', oa_id: OA_ID, event_name: 'user_send_text',
    sender: { id: userId }, recipient: { id: OA_ID }, message: { msg_id: msgId, text },
  };
}

test('an OA profile lookup stores the name and an https avatar, with size fallbacks', async () => {
  await saveTokens('profile-access');
  onFetch = async (url) => {
    if (!url.includes('/user/detail')) return json({ error: 0 });
    const data = new URL(url).searchParams.get('data') ?? '';
    if (data.includes('user-full')) {
      return json({ error: 0, data: { display_name: 'An', avatar: 'https://photo.zalo.me/full.jpg', avatars: { '240': 'https://photo.zalo.me/240.jpg' } } });
    }
    if (data.includes('user-240')) {
      return json({ error: 0, data: { display_name: 'Mai', avatar: 'http://insecure.example/a.jpg', avatars: { '240': 'https://photo.zalo.me/240.jpg', '120': 'https://photo.zalo.me/120.jpg' } } });
    }
    return json({ error: 0, data: { display_name: 'Lan', avatars: { '240': 'http://photo.zalo.me/nope.jpg', '120': 'https://photo.zalo.me/120.jpg' } } });
  };
  await webhook(oaUser('user-full', 'm-full'));
  await webhook(oaUser('user-240', 'm-240'));
  await webhook(oaUser('user-120', 'm-120'));
  const rows = await db.prepare("SELECT external_thread_id, display_name, avatar_url FROM conversation WHERE channel_account_id = 'ca-oa' ORDER BY external_thread_id").all<{ external_thread_id: string; display_name: string; avatar_url: string }>();
  expect(rows.results).toEqual([
    { external_thread_id: 'user-120', display_name: 'Lan', avatar_url: 'https://photo.zalo.me/120.jpg' },
    { external_thread_id: 'user-240', display_name: 'Mai', avatar_url: 'https://photo.zalo.me/240.jpg' },
    { external_thread_id: 'user-full', display_name: 'An', avatar_url: 'https://photo.zalo.me/full.jpg' },
  ]);
});

test('a placeholder with no avatar check is looked up on the next message', async () => {
  await saveTokens('profile-access');
  await db.prepare(`INSERT INTO conversation (id, organization_id, channel_account_id, kind, external_thread_id, display_name, created_at, updated_at)
    VALUES ('cv-ph', 'org-abm', 'ca-oa', 'direct', ?, 'Khách Zalo OA', ?, ?)`).bind(USER_ID, STAMP, STAMP).run();
  onFetch = async (url) => (url.includes('/user/detail')
    ? json({ error: 0, data: { display_name: 'Mai Trần', avatar: 'https://photo.zalo.me/mai.jpg' } })
    : json({ error: 0 }));
  calls.length = 0;
  await webhook(userEvent('user_send_text', 'm-retry', { text: 'Xin chào' }));
  const conv = await conversation();
  expect(profileCalls()).toHaveLength(1);
  expect(conv.display_name).toBe('Mai Trần');
  expect(conv.avatar_url).toBe('https://photo.zalo.me/mai.jpg');
  expect(conv.avatar_checked_at).toBeTruthy();
});

test('a failed profile lookup stamps the check and is repeated only after a day', async () => {
  await saveTokens('profile-access');
  onFetch = async (url) => (url.includes('/user/detail') ? json({ error: -212 }) : json({ error: 0 }));
  calls.length = 0;
  await webhook(userEvent('user_send_text', 'm1', { text: 'Xin chào' }));
  const failed = await conversation();
  expect(failed.display_name).toBe('Khách Zalo OA');
  expect(failed.avatar_url).toBeNull();
  expect(failed.avatar_checked_at).toBeTruthy();
  expect(profileCalls()).toHaveLength(1);
  expect((await commands('run_completion'))[0].payload.text).toBe('Xin chào');

  await webhook(userEvent('user_send_text', 'm2', { text: 'Lại nữa' }));
  expect(profileCalls()).toHaveLength(1);
  expect((await conversation()).display_name).toBe('Khách Zalo OA');

  const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  await db.prepare('UPDATE conversation SET avatar_checked_at = ? WHERE id = ?').bind(stale, failed.id).run();
  onFetch = async (url) => (url.includes('/user/detail')
    ? json({ error: 0, data: { display_name: 'Mai Trần', avatar: 'https://photo.zalo.me/mai.jpg' } })
    : json({ error: 0 }));
  await webhook(userEvent('user_send_text', 'm3', { text: 'Hôm sau' }));
  const named = await conversation();
  expect(profileCalls()).toHaveLength(2);
  expect(named.display_name).toBe('Mai Trần');
  expect(named.avatar_url).toBe('https://photo.zalo.me/mai.jpg');
  expect(Date.parse(named.avatar_checked_at)).toBeGreaterThan(Date.parse(stale));

  await db.prepare('UPDATE conversation SET avatar_checked_at = ? WHERE id = ?').bind(stale, failed.id).run();
  onFetch = async (url) => (url.includes('/user/detail') ? json({ error: -212 }) : json({ error: 0 }));
  await webhook(userEvent('user_send_text', 'm4', { text: 'Vẫn tên cũ' }));
  const kept = await conversation();
  expect(profileCalls()).toHaveLength(3);
  expect(kept.display_name).toBe('Mai Trần');
  expect(kept.avatar_url).toBe('https://photo.zalo.me/mai.jpg');
  expect(Date.parse(kept.avatar_checked_at)).toBeGreaterThan(Date.parse(stale));
});

test('-212 on user detail falls back to the conversation history for name and avatar', async () => {
  await saveTokens('profile-access');
  onFetch = async (url) => {
    if (url.includes('/user/detail')) return json({ error: -212 });
    if (url.includes('/oa/conversation')) {
      return json({ error: 0, data: [
        { from_id: OA_ID, from_display_name: 'ABM', from_avatar: 'https://photo.zalo.me/oa.jpg', to_id: USER_ID, to_display_name: '', to_avatar: 'https://photo.zalo.me/lan.jpg' },
        { from_id: USER_ID, from_display_name: 'Lan Phạm', from_avatar: 'https://photo.zalo.me/lan.jpg', to_id: OA_ID },
      ] });
    }
    return json({ error: 0 });
  };
  await webhook(userEvent('user_send_text', 'm1', { text: 'Xin chào' }));
  const row = await conversation();
  expect(row.display_name).toBe('Lan Phạm');
  expect(row.avatar_url).toBe('https://photo.zalo.me/lan.jpg');
  expect(row.avatar_checked_at).toBeTruthy();
});

test('the minute backfill refreshes at most 10 unchecked OA conversations', async () => {
  await saveTokens('profile-access');
  const ids = Array.from({ length: 11 }, (_, i) => `user-${String(i).padStart(2, '0')}`);
  await db.batch(ids.map((userId, i) => db.prepare(`INSERT INTO conversation (id, organization_id, channel_account_id, kind, external_thread_id, display_name, created_at, updated_at)
    VALUES (?, 'org-abm', 'ca-oa', 'direct', ?, 'Khách Zalo OA', ?, ?)`).bind(`cv-${userId}`, userId, `2026-10-01T00:00:${String(i).padStart(2, '0')}.000Z`, STAMP)));
  onFetch = async (url) => {
    if (!url.includes('/user/detail')) return json({ error: 0 });
    const data = new URL(url).searchParams.get('data') ?? '';
    const userId = /user-\d+/.exec(data)?.[0] ?? 'x';
    return json({ error: 0, data: { display_name: `Khách ${userId}`, avatar: `https://photo.zalo.me/${userId}.jpg` } });
  };
  calls.length = 0;
  await runScheduled(testEnv, '* * * * *', MINUTE);
  expect(profileCalls()).toHaveLength(10);
  expect(tokenCalls()).toHaveLength(0);
  const unchecked = await db.prepare("SELECT external_thread_id, avatar_checked_at FROM conversation WHERE channel_account_id = 'ca-oa' AND avatar_checked_at IS NULL").all();
  expect(unchecked.results).toEqual([{ external_thread_id: 'user-10', avatar_checked_at: null }]);
  const first = await db.prepare("SELECT display_name, avatar_url FROM conversation WHERE external_thread_id = 'user-00'").first();
  expect(first).toEqual({ display_name: 'Khách user-00', avatar_url: 'https://photo.zalo.me/user-00.jpg' });
});

test('backfill skips an OA with no token and stamps a failed lookup', async () => {
  await saveTokens('profile-access', 'refresh-stored', '2027-01-01T00:00:00.000Z', 'ca-oa');
  await db.prepare(`INSERT INTO channel_account (id, organization_id, channel, external_id, display_name, agent_key, status, created_at, updated_at)
    VALUES ('ca-oa-2', 'org-abm', 'zalo_oa', '9002', 'OA khác', 'tu-van-oa', 'connected', ?, ?)`).bind(STAMP, STAMP).run();
  await db.batch([
    db.prepare(`INSERT INTO conversation (id, organization_id, channel_account_id, kind, external_thread_id, display_name, created_at, updated_at)
      VALUES ('cv-fail', 'org-abm', 'ca-oa', 'direct', 'user-fail', 'Khách Zalo OA', ?, ?)`).bind('2026-10-01T00:00:00.000Z', STAMP),
    db.prepare(`INSERT INTO conversation (id, organization_id, channel_account_id, kind, external_thread_id, display_name, created_at, updated_at)
      VALUES ('cv-notoken', 'org-abm', 'ca-oa-2', 'direct', 'user-notoken', 'Khách Zalo OA', ?, ?)`).bind('2026-10-01T00:00:01.000Z', STAMP),
  ]);
  onFetch = async (url) => (url.includes('/user/detail') ? json({ error: -212 }) : json({ error: 0 }));
  calls.length = 0;
  await runScheduled(testEnv, '* * * * *', MINUTE);
  expect(profileCalls()).toHaveLength(1);
  expect(tokenCalls()).toHaveLength(0);
  const failed = await db.prepare('SELECT display_name, avatar_url, avatar_checked_at FROM conversation WHERE id = ?').bind('cv-fail').first<{ display_name: string; avatar_url: string | null; avatar_checked_at: string | null }>();
  expect(failed!.display_name).toBe('Khách Zalo OA');
  expect(failed!.avatar_url).toBeNull();
  expect(failed!.avatar_checked_at).toBe(MINUTE.toISOString());
  const skipped = await db.prepare('SELECT avatar_checked_at FROM conversation WHERE id = ?').bind('cv-notoken').first<{ avatar_checked_at: string | null }>();
  expect(skipped!.avatar_checked_at).toBeNull();
});

test('the bridge cannot claim a Zalo OA send', async () => {
  await db.prepare(`INSERT INTO channel_command (id, kind, target, channel_account_id, payload_json, next_run_at, created_at, updated_at)
    VALUES ('cmd-oa-send', 'send_zalo_oa', 'worker', 'ca-oa', '{}', '2020-01-01T00:00:00.000Z', ?, ?)`).bind(STAMP, STAMP).run();
  expect((await claimCommands(db, 'bridge', 10)).map((command) => command.kind)).not.toContain('send_zalo_oa');
  expect((await claimCommands(db, 'worker', 10)).map((command) => command.kind)).toContain('send_zalo_oa');
});
