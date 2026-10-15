import { env } from 'cloudflare:test';
import { beforeEach, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';
import { ingestEvents } from '../src/worker/inbox/ingest';
import { MEDIA_BODY_OVERHEAD, MEDIA_MAX_BYTES } from '../src/worker/inbox/media';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
const ORIGIN = 'http://crm.test';
const SECRET = 'test-bridge-secret';
const STAMP = '2026-10-15T03:00:00.000Z';
const testEnv = { ...env, DEMO_MODE: '1', BRIDGE_SECRET: SECRET };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

beforeEach(async () => {
  await resetDb(db, seedSql);
  await db.batch([
    db.prepare(`INSERT INTO organization (id, name, created_at, updated_at) VALUES ('org-other', 'Tổ chức khác', ?, ?)`).bind(STAMP, STAMP),
    db.prepare(`INSERT INTO channel_account (id, organization_id, channel, external_id, display_name, agent_key, status, created_at, updated_at)
      VALUES ('ca-1', 'org-abm', 'zalo', 'zalo-acc-1', 'Số tư vấn 1', 'sales-bot', 'connected', ?, ?)`).bind(STAMP, STAMP),
    db.prepare(`INSERT INTO channel_account (id, organization_id, channel, external_id, display_name, agent_key, status, created_at, updated_at)
      VALUES ('ca-other', 'org-other', 'zalo', 'zalo-other', 'Số khác', 'sales-bot', 'connected', ?, ?)`).bind(STAMP, STAMP),
    db.prepare(`INSERT INTO app_user (id, organization_id, display_name, email, role, created_at, updated_at)
      VALUES ('u-other', 'org-other', 'Người khác', 'other@demo.abm.example', 'sale', ?, ?)`).bind(STAMP, STAMP),
    db.prepare(`INSERT INTO app_user (id, organization_id, display_name, email, role, created_at, updated_at)
      VALUES ('u-teacher', 'org-abm', 'Giáo viên A', 'teacher@demo.abm.example', 'teacher', ?, ?)`).bind(STAMP, STAMP),
  ]);
});

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sign(timestamp: string, body: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)));
}

function file(bytes: Uint8Array, type: string, name = 'anh.jpg') {
  return new File([bytes], name, { type });
}

async function upload(user: string, bytes: Uint8Array, type: string, name?: string) {
  const form = new FormData();
  form.set('file', file(bytes, type, name));
  const res = await app.fetch(new Request(`${ORIGIN}/api/inbox/media`, {
    method: 'POST', body: form, headers: { 'X-Demo-User': user },
  }), testEnv);
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) as any : null };
}

async function web(user: string, method: string, path: string, body?: unknown) {
  const res = await app.fetch(new Request(`${ORIGIN}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'X-Demo-User': user },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), testEnv);
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) as any : null, headers: res.headers };
}

const saigonMonth = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Saigon', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return `${parts.find((part) => part.type === 'year')?.value}/${parts.find((part) => part.type === 'month')?.value}`;
};

async function openConversation() {
  await ingestEvents(db, [{
    type: 'message', accountExternalId: 'zalo-acc-1', threadId: 'cust-1', threadKind: 'direct', msgId: 'zm-1',
    fromSelf: false, senderExternalId: 'cust-1', senderName: 'Chị Hoa', text: 'Cho em hỏi', sentAt: new Date().toISOString(),
  }]);
  return db.prepare("SELECT id FROM conversation WHERE external_thread_id = 'cust-1'").first<{ id: string }>();
}

test('upload accepts a real JPEG or PNG, rejects the wrong bytes, a large file, and a role outside inbox', async () => {
  const jpeg = await upload('u-lan', JPEG, 'image/jpeg');
  expect(jpeg.status).toBe(200);
  expect(jpeg.json.data.mimeType).toBe('image/jpeg');
  expect(jpeg.json.data.size).toBe(JPEG.byteLength);
  expect(jpeg.json.data.key).toMatch(new RegExp(`^org/org-abm/${saigonMonth()}/[0-9a-f-]{36}\\.jpg$`));
  expect(jpeg.json.data.url).toBe(`/api/inbox/media/${jpeg.json.data.key}`);

  const png = await upload('u-lan', PNG, 'image/png', 'anh.png');
  expect(png.status).toBe(200);
  expect(png.json.data.key.endsWith('.png')).toBe(true);

  expect((await upload('u-lan', new TextEncoder().encode('not an image'), 'image/jpeg')).status).toBe(422);
  expect((await upload('u-lan', PNG, 'image/jpeg', 'anh.jpg')).status).toBe(422);
  expect((await upload('u-lan', JPEG, 'image/png', 'anh.png')).status).toBe(422);
  expect((await upload('u-lan', JPEG, 'text/plain')).status).toBe(422);
  expect((await upload('u-lan', new Uint8Array(1024 * 1024 + 1), 'image/jpeg')).status).toBe(413);
  expect((await upload('u-teacher', JPEG, 'image/jpeg')).status).toBe(403);

  const anon = await app.fetch(new Request(`${ORIGIN}/api/inbox/media`, { method: 'POST', body: new FormData() }), testEnv);
  expect(anon.status).toBe(401);
});

test('serving an image stays inside the actor organization and keeps the stored type', async () => {
  const jpeg = await upload('u-lan', JPEG, 'image/jpeg');
  const key = jpeg.json.data.key as string;
  const ok = await app.fetch(new Request(`${ORIGIN}/api/inbox/media/${key}`, { headers: { 'X-Demo-User': 'u-lan' } }), testEnv);
  expect(ok.status).toBe(200);
  expect(ok.headers.get('content-type')).toBe('image/jpeg');
  expect(ok.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
  expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
  expect(new Uint8Array(await ok.arrayBuffer())).toEqual(JPEG);

  const foreign = await app.fetch(new Request(`${ORIGIN}/api/inbox/media/${key}`, { headers: { 'X-Demo-User': 'u-other' } }), testEnv);
  const missing = await app.fetch(new Request(`${ORIGIN}/api/inbox/media/org/org-abm/2026/10/11111111-1111-4111-8111-111111111111.jpg`, {
    headers: { 'X-Demo-User': 'u-lan' },
  }), testEnv);
  const dotted = await app.fetch(new Request(`${ORIGIN}/api/inbox/media/org/org-abm/../org-other/2026/10/11111111-1111-4111-8111-111111111111.jpg`, {
    headers: { 'X-Demo-User': 'u-lan' },
  }), testEnv);
  expect(foreign.status).toBe(404);
  expect(missing.status).toBe(404);
  expect(dotted.status).toBe(404);
  expect(await foreign.json()).toEqual(await missing.json());
});

test('a staff send stores the image, queues it for personal Zalo, and conflicts when the attachments change', async () => {
  const conv = await openConversation();
  const first = await upload('u-lan', JPEG, 'image/jpeg');
  const second = await upload('u-lan', PNG, 'image/png', 'b.png');
  const path = `/inbox/conversations/${conv!.id}/messages`;
  const clientMessageId = crypto.randomUUID();
  const imageOnly = await web('u-lan', 'POST', path, { attachments: [{ key: first.json.data.key }], clientMessageId });
  expect(imageOnly.status).toBe(200);
  const row = await db.prepare('SELECT body, attachments_json, sender_kind FROM message WHERE id = ?')
    .bind(imageOnly.json.data.messageId).first<{ body: string; attachments_json: string; sender_kind: string }>();
  expect(row).toMatchObject({ body: '[Tệp đính kèm]', sender_kind: 'staff_web' });
  expect(JSON.parse(row!.attachments_json)).toEqual([{
    url: first.json.data.url, mimeType: 'image/jpeg', name: first.json.data.key.split('/').pop(),
  }]);
  const command = await db.prepare("SELECT payload_json FROM channel_command WHERE kind = 'send_zalo'").first<{ payload_json: string }>();
  const payload = JSON.parse(command!.payload_json);
  expect(payload.text).toBe('');
  expect(payload.attachments).toEqual([{
    key: first.json.data.key, mimeType: 'image/jpeg', filename: first.json.data.key.split('/').pop(),
  }]);
  expect((await db.prepare('SELECT staff_context_pending FROM conversation WHERE id = ?').bind(conv!.id).first<{ staff_context_pending: string }>()))
    .toEqual({ staff_context_pending: 'Nhân viên: [Tệp đính kèm]' });

  const retry = await web('u-lan', 'POST', path, { attachments: [{ key: first.json.data.key }], clientMessageId });
  expect(retry.status).toBe(200);
  expect(retry.json.data.messageId).toBe(imageOnly.json.data.messageId);
  expect(await db.prepare("SELECT COUNT(*) AS n FROM channel_command WHERE kind = 'send_zalo'").first<{ n: number }>()).toEqual({ n: 1 });

  expect((await web('u-lan', 'POST', path, { attachments: [{ key: second.json.data.key }], clientMessageId })).status).toBe(409);
  expect((await web('u-lan', 'POST', path, { text: 'chỉ chữ', clientMessageId })).status).toBe(409);
  expect((await web('u-lan', 'POST', path, { text: 'xem', attachments: [{ key: 'org/org-other/2026/10/11111111-1111-4111-8111-111111111111.jpg' }] })).status).toBe(422);
  expect((await web('u-lan', 'POST', path, { attachments: [] })).status).toBe(422);

  const withText = await web('u-lan', 'POST', path, { text: 'Xem ảnh', attachments: [{ key: second.json.data.key }] });
  expect(withText.status).toBe(200);
  const secondPayload = JSON.parse((await db.prepare("SELECT payload_json FROM channel_command WHERE json_extract(payload_json, '$.messageId') = ?")
    .bind(withText.json.data.messageId).first<{ payload_json: string }>())!.payload_json);
  expect(secondPayload.text).toBe('Xem ảnh');
  expect(secondPayload.attachments).toHaveLength(1);
  expect(secondPayload.attachments[0].mimeType).toBe('image/png');
});

test('an upload stream larger than the cap is rejected when Content-Length is absent', async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(MEDIA_MAX_BYTES + MEDIA_BODY_OVERHEAD + 1));
      controller.close();
    },
  });
  const init = {
    method: 'POST',
    body: stream,
    duplex: 'half',
    headers: { 'X-Demo-User': 'u-lan', 'Content-Type': 'application/octet-stream' },
  };
  const res = await app.fetch(new Request(`${ORIGIN}/api/inbox/media`, init as RequestInit), testEnv);
  expect(res.status).toBe(413);
  expect(await res.json()).toEqual({ ok: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Ảnh lớn hơn 1 MB' } });
});

test('a facebook conversation with an attachment is rejected', async () => {
  await db.batch([
    db.prepare(`INSERT INTO channel_account (id, organization_id, channel, external_id, display_name, agent_key, status, created_at, updated_at)
      VALUES ('ca-fb', 'org-abm', 'facebook', 'page-1', 'Fanpage', 'sales-bot', 'connected', ?, ?)`).bind(STAMP, STAMP),
    db.prepare(`INSERT INTO conversation (id, organization_id, channel_account_id, kind, external_thread_id, display_name, created_at, updated_at)
      VALUES ('conv-fb', 'org-abm', 'ca-fb', 'direct', 'psid-1', 'Khách FB', ?, ?)`).bind(STAMP, STAMP),
  ]);
  const jpeg = await upload('u-lan', JPEG, 'image/jpeg');
  const res = await web('u-lan', 'POST', '/inbox/conversations/conv-fb/messages', {
    text: 'xem', attachments: [{ key: jpeg.json.data.key }],
  });
  expect(res.status).toBe(422);
  expect(res.json.error).toMatchObject({ message: 'Kênh này chưa gửi được ảnh' });
  expect(await db.prepare("SELECT COUNT(*) AS n FROM message WHERE conversation_id = 'conv-fb'").first<{ n: number }>()).toEqual({ n: 0 });
});

test('the bridge media route requires the HMAC and the account organization', async () => {
  const key = 'org/org-abm/2026/10/11111111-1111-4111-8111-111111111111.jpg';
  await env.MEDIA.put(key, JPEG, { httpMetadata: { contentType: 'image/jpeg' } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers = { 'X-Bridge-Timestamp': timestamp, 'X-Bridge-Signature': await sign(timestamp, '') };
  const ok = await app.fetch(new Request(`${ORIGIN}/api/bridge/media?${new URLSearchParams({ key, accountId: 'ca-1' })}`, { headers }), testEnv);
  expect(ok.status).toBe(200);
  expect(ok.headers.get('content-type')).toBe('image/jpeg');
  expect(new Uint8Array(await ok.arrayBuffer())).toEqual(JPEG);

  const unsigned = await app.fetch(new Request(`${ORIGIN}/api/bridge/media?key=${encodeURIComponent(key)}&accountId=ca-1`), testEnv);
  expect(unsigned.status).toBe(401);

  const otherAccount = await app.fetch(new Request(`${ORIGIN}/api/bridge/media?${new URLSearchParams({ key, accountId: 'ca-other' })}`, { headers }), testEnv);
  const missingAccount = await app.fetch(new Request(`${ORIGIN}/api/bridge/media?${new URLSearchParams({ key, accountId: 'missing' })}`, { headers }), testEnv);
  const missingObject = await app.fetch(new Request(`${ORIGIN}/api/bridge/media?${new URLSearchParams({
    key: 'org/org-abm/2026/10/22222222-2222-4222-8222-222222222222.jpg', accountId: 'ca-1',
  })}`, { headers }), testEnv);
  expect(otherAccount.status).toBe(404);
  expect(missingAccount.status).toBe(404);
  expect(missingObject.status).toBe(404);
  expect(await otherAccount.json()).toEqual(await missingObject.json());
});
