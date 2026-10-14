import { env } from 'cloudflare:test';
import { beforeEach, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';
import { ingestEvents } from '../src/worker/inbox/ingest';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
const ORIGIN = 'http://crm.test';
const STAMP = '2026-10-08T03:00:00.000Z';
const AVATAR = 'https://photo.zalo.me/hoa.jpg';
const testEnv = { ...env, DEMO_MODE: '1', APP_URL: 'https://crm.example' };

beforeEach(async () => {
  await resetDb(db, seedSql);
  await db.prepare(`INSERT INTO channel_account (id, organization_id, channel, external_id, display_name, agent_key, status, created_at, updated_at)
    VALUES ('ca-1', 'org-abm', 'zalo', 'zalo-acc-1', 'Số tư vấn 1', 'sales-bot', 'connected', ?, ?)`).bind(STAMP, STAMP).run();
});

let msgSeq = 0;
const message = (overrides: Record<string, unknown> = {}) => ({
  type: 'message' as const, accountExternalId: 'zalo-acc-1', threadId: 'cust-1', threadKind: 'direct' as const,
  msgId: `zm-${++msgSeq}`, fromSelf: false, senderExternalId: 'cust-1', senderName: 'Chị Hoa', text: 'Cho em hỏi lịch học',
  sentAt: new Date().toISOString(), ...overrides,
});

const conversation = (threadId = 'cust-1') =>
  db.prepare('SELECT display_name, avatar_url, avatar_checked_at, kind FROM conversation WHERE external_thread_id = ?').bind(threadId).first<any>();
const member = (conversationId: string, userId: string) =>
  db.prepare('SELECT display_name, avatar_url FROM zalo_group_member WHERE conversation_id = ? AND external_user_id = ?')
    .bind(conversationId, userId).first<any>();

async function web(path: string) {
  const res = await app.fetch(new Request(`${ORIGIN}/api${path}`, { headers: { 'X-Demo-User': 'u-lan' } }), testEnv);
  return { status: res.status, json: await res.json() as any };
}

test('a direct customer avatar is stored and a non-https value is dropped without losing the message', async () => {
  expect(await ingestEvents(db, [message({ senderAvatar: AVATAR })])).toEqual({ accepted: 1, rejected: 0 });
  const conv = await conversation();
  expect(conv).toMatchObject({ display_name: 'Chị Hoa', avatar_url: AVATAR, avatar_checked_at: null, kind: 'direct' });

  expect(await ingestEvents(db, [message({ senderAvatar: 'http://photo.zalo.me/hoa.jpg', text: 'link thường' })])).toEqual({ accepted: 1, rejected: 0 });
  expect((await conversation()).avatar_url).toBe(AVATAR);
  expect(await ingestEvents(db, [message({ senderAvatar: '', text: 'trống' })])).toEqual({ accepted: 1, rejected: 0 });
  expect((await conversation()).avatar_url).toBe(AVATAR);

  expect(await ingestEvents(db, [message({
    fromSelf: true, senderExternalId: 'zalo-acc-1', senderName: 'Shop', senderAvatar: 'https://photo.zalo.me/shop.jpg', text: 'Shop trả lời',
  })])).toEqual({ accepted: 1, rejected: 0 });
  expect(await conversation()).toMatchObject({ display_name: 'Chị Hoa', avatar_url: AVATAR, avatar_checked_at: null });

  const fresh = await ingestEvents(db, [message({ threadId: 'cust-http', senderExternalId: 'cust-http', senderAvatar: 'http://photo.zalo.me/nope.jpg', text: 'chỉ http' })]);
  expect(fresh).toEqual({ accepted: 1, rejected: 0 });
  expect(await conversation('cust-http')).toMatchObject({ avatar_url: null, avatar_checked_at: null });
  const stored = await db.prepare("SELECT COUNT(*) AS n FROM message WHERE external_msg_id IS NOT NULL AND body = 'chỉ http'").first<{ n: number }>();
  expect(stored!.n).toBe(1);
});

test('a group sender avatar is stored on the member and returned by the inbox API', async () => {
  const avatar = 'https://photo.zalo.me/an.jpg';
  expect(await ingestEvents(db, [message({
    threadId: 'grp-1', threadKind: 'group', senderExternalId: 'member-1', senderName: 'An', senderAvatar: avatar, text: 'chào nhóm',
  })])).toEqual({ accepted: 1, rejected: 0 });
  const conv = await conversation('grp-1');
  expect(conv).toMatchObject({ kind: 'group', avatar_url: null, avatar_checked_at: null });
  const group = await db.prepare("SELECT id FROM conversation WHERE external_thread_id = 'grp-1'").first<{ id: string }>();
  expect(await member(group!.id, 'member-1')).toEqual({ display_name: 'An', avatar_url: avatar });

  expect(await ingestEvents(db, [message({
    threadId: 'grp-1', threadKind: 'group', senderExternalId: 'member-1', senderName: 'An', senderAvatar: 'http://photo.zalo.me/an.jpg', text: 'không đổi ảnh',
  })])).toEqual({ accepted: 1, rejected: 0 });
  expect(await member(group!.id, 'member-1')).toEqual({ display_name: 'An', avatar_url: avatar });

  expect(await ingestEvents(db, [{
    type: 'group_members', accountExternalId: 'zalo-acc-1', threadId: 'grp-1',
    members: [
      { id: 'member-1', name: 'An mới', avatar: 'https://photo.zalo.me/an-2.jpg' },
      { id: 'member-2', name: 'Bình' },
    ],
  }])).toEqual({ accepted: 1, rejected: 0 });
  expect(await member(group!.id, 'member-1')).toEqual({ display_name: 'An mới', avatar_url: 'https://photo.zalo.me/an-2.jpg' });
  expect(await member(group!.id, 'member-2')).toEqual({ display_name: 'Bình', avatar_url: null });

  expect(await ingestEvents(db, [{
    type: 'group_members', accountExternalId: 'zalo-acc-1', threadId: 'grp-1',
    members: [{ id: 'member-1', name: '', avatar: '' }],
  }])).toEqual({ accepted: 1, rejected: 0 });
  expect(await member(group!.id, 'member-1')).toEqual({ display_name: 'An mới', avatar_url: 'https://photo.zalo.me/an-2.jpg' });

  const list = await web('/inbox/conversations?kind=direct');
  expect(list.status).toBe(200);
  expect(list.json.data.find((row: { displayName: string }) => row.displayName === 'Chị Hoa')).toBeUndefined();
  const direct = await ingestEvents(db, [message({ senderAvatar: AVATAR })]);
  expect(direct).toEqual({ accepted: 1, rejected: 0 });
  const listed = await web('/inbox/conversations');
  const directRow = listed.json.data.find((row: { externalThreadId: string }) => row.externalThreadId === 'cust-1');
  expect(directRow.avatarUrl).toBe(AVATAR);
  const detail = await web(`/inbox/conversations/${directRow.id}`);
  expect(detail.json.data.avatarUrl).toBe(AVATAR);

  const groupRow = listed.json.data.find((row: { externalThreadId: string }) => row.externalThreadId === 'grp-1');
  expect(groupRow.avatarUrl).toBeNull();
  const messages = await web(`/inbox/conversations/${group!.id}/messages`);
  expect(messages.json.data.find((row: { body: string }) => row.body === 'chào nhóm')).toMatchObject({
    senderDisplayName: 'An mới', senderAvatarUrl: 'https://photo.zalo.me/an-2.jpg',
  });
  const members = await web(`/inbox/groups/${group!.id}/members`);
  expect(members.status).toBe(200);
  expect(members.json.data).toEqual(expect.arrayContaining([
    expect.objectContaining({ externalUserId: 'member-1', displayName: 'An mới', avatarUrl: 'https://photo.zalo.me/an-2.jpg' }),
    expect.objectContaining({ externalUserId: 'member-2', displayName: 'Bình', avatarUrl: null }),
  ]));
});
