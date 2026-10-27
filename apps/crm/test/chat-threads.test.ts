import { env, type D1Migration } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import type { Env as WorkerEnv, Sink } from '../src/worker/env';
import app from '../src/worker/index';
import { notify } from '../src/worker/notify';
import { resetDb } from './helpers/reset-db';

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      MEDIA: R2Bucket;
      CHAT_HUB: DurableObjectNamespace;
      TEST_MIGRATIONS: D1Migration[];
      DEMO_MODE: string;
      AUTH_MODE: string;
    }
  }
}

const db = env.DB;
beforeEach(() => resetDb(db, seedSql));
afterEach(() => vi.restoreAllMocks());

type Json = { ok: boolean; data?: any; error?: { code: string; message: string; fields?: Record<string, string>; details?: any } };

async function call(
  user: string,
  method: string,
  path: string,
  body?: unknown,
  opts: { env?: Record<string, unknown>; ctx?: ExecutionContext } = {},
) {
  const response = await app.fetch(new Request(`http://crm.test/api${path}`, {
    method,
    headers: { 'X-Demo-User': user, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { ...env, DEMO_MODE: '1', ...opts.env }, opts.ctx);
  return { status: response.status, json: (await response.json()) as Json };
}

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const b of u8) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** Group G created by u-lan with u-long, u-huy and u-mai. */
async function groupG(): Promise<string> {
  const created = await call('u-lan', 'POST', '/chat/conversations', {
    kind: 'group',
    title: 'Nhóm chuỗi',
    memberUserIds: ['u-long', 'u-huy', 'u-mai'],
  });
  expect(created.status).toBe(200);
  return created.json.data.id as string;
}

async function post(user: string, convId: string, body: string, extra: Record<string, unknown> = {}, id = crypto.randomUUID()) {
  const res = await call(user, 'POST', `/chat/conversations/${encodeURIComponent(convId)}/messages`, { id, body, ...extra });
  return { id, ...res };
}

async function notificationsOf(userId: string) {
  const rows = await db.prepare('SELECT kind, link FROM notification WHERE user_id = ? ORDER BY created_at, id')
    .bind(userId).all<{ kind: string; link: string | null }>();
  return rows.results;
}

async function followersOf(rootId: string) {
  const rows = await db.prepare('SELECT user_id, via, muted FROM chat_thread_follower WHERE root_message_id = ? ORDER BY user_id')
    .bind(rootId).all<{ user_id: string; via: string; muted: number }>();
  return rows.results;
}

const conversationOf = async (user: string, convId: string) =>
  ((await call(user, 'GET', '/chat/conversations')).json.data as any[]).find((c) => c.id === convId);
const unreadOf = async (user: string) => (await call(user, 'GET', '/chat/unread')).json.data.total as number;
const followedOf = async (user: string) => (await call(user, 'GET', '/chat/threads')).json.data as any[];
// Keeps two writes out of the same millisecond, so read markers and "last reply" times are told apart.
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('chat threads', () => {
  test('a thread reply stays out of the main flow and shows on the root as a thread card', async () => {
    const g = await groupG();
    const root = await post('u-lan', g, 'Tin gốc');
    const reply = await post('u-long', g, 'Trả lời trong chuỗi', { threadRootId: root.id });
    expect(reply.status).toBe(200);
    expect(reply.json.data).toMatchObject({ threadRootId: root.id, alsoInMain: false });

    const main = await call('u-lan', 'GET', `/chat/conversations/${g}/messages`);
    const ids = (main.json.data as any[]).map((m) => m.id);
    expect(ids).toContain(root.id);
    expect(ids).not.toContain(reply.id);
    const rootItem = (main.json.data as any[]).find((m) => m.id === root.id);
    expect(rootItem.thread.replyCount).toBe(1);
    expect(rootItem.thread.repliers[0].userId).toBe('u-long');
    expect(rootItem.thread.latest[0].snippet).toBe('Trả lời trong chuỗi');

    const thread = await call('u-lan', 'GET', `/chat/threads/${root.id}`);
    expect(thread.status).toBe(200);
    expect(thread.json.data.root.id).toBe(root.id);
    expect(thread.json.data.thread.replyCount).toBe(1);
    expect((thread.json.data.replies as any[]).map((m) => m.id)).toEqual([reply.id]);
    expect(thread.json.data.hasMore).toBe(false);

    // A thread-only reply does not move the conversation in the list.
    const conv = await db.prepare('SELECT last_message_at FROM chat_conversation WHERE id = ?').bind(g).first<{ last_message_at: string }>();
    expect(conv!.last_message_at).toBe(root.json.data.createdAt);
  });

  test('the root author and the replier follow; only followers get a chat_thread notification', async () => {
    const g = await groupG();
    const root = await post('u-lan', g, 'Tin gốc');
    await post('u-long', g, 'Trả lời', { threadRootId: root.id });

    expect(await followersOf(root.id)).toEqual([
      { user_id: 'u-lan', via: 'author', muted: 0 },
      { user_id: 'u-long', via: 'reply', muted: 0 },
    ]);
    expect(await notificationsOf('u-lan')).toEqual([{ kind: 'chat_thread', link: `/chat/${g}?thread=${root.id}` }]);
    expect(await notificationsOf('u-long')).toEqual([]);
    expect(await notificationsOf('u-huy')).toEqual([]);
    expect(await notificationsOf('u-mai')).toEqual([]);
  });

  test('a mention inside a thread makes the person follow and sends chat_mention, not chat_thread', async () => {
    const g = await groupG();
    const root = await post('u-lan', g, 'Tin gốc');
    await post('u-long', g, 'Nhờ @[Hoàng Mai](user:u-mai) xem', { threadRootId: root.id });

    expect((await followersOf(root.id)).find((f) => f.user_id === 'u-mai')).toEqual({ user_id: 'u-mai', via: 'mention', muted: 0 });
    expect(await notificationsOf('u-mai')).toEqual([{ kind: 'chat_mention', link: `/chat/${g}?thread=${root.id}` }]);
  });

  test('"also send to the group" shows the reply in both places and counts as main-flow unread only', async () => {
    const g = await groupG();
    const root = await post('u-lan', g, 'Tin gốc');
    await call('u-huy', 'POST', `/chat/conversations/${g}/read`, {});
    const huyBefore = await conversationOf('u-huy', g);
    expect(huyBefore.unread).toBe(0);

    const reply = await post('u-long', g, 'Trả lời cho cả nhóm', { threadRootId: root.id, alsoSendToMain: true });
    expect(reply.status).toBe(200);
    expect(reply.json.data.alsoInMain).toBe(true);

    const main = await call('u-huy', 'GET', `/chat/conversations/${g}/messages`);
    expect((main.json.data as any[]).map((m) => m.id)).toContain(reply.id);
    const thread = await call('u-huy', 'GET', `/chat/threads/${root.id}`);
    expect((thread.json.data.replies as any[]).map((m) => m.id)).toEqual([reply.id]);

    const huyAfter = await conversationOf('u-huy', g);
    expect(huyAfter.unread).toBe(1);
    expect(huyAfter.threadUnread).toBe(0);
    expect(await notificationsOf('u-huy')).toEqual([]);
  });

  test('thread unread counts in the thread list and the badge, not in the main flow, until the thread is read', async () => {
    const g = await groupG();
    const root = await post('u-lan', g, 'Tin gốc');
    await call('u-lan', 'POST', `/chat/conversations/${g}/read`, {});
    const mainBefore = (await conversationOf('u-lan', g)).unread;
    const badgeBefore = await unreadOf('u-lan');

    await post('u-huy', g, 'Ý một', { threadRootId: root.id });
    await post('u-huy', g, 'Ý hai', { threadRootId: root.id });

    const conv = await conversationOf('u-lan', g);
    expect(conv.unread).toBe(mainBefore);
    expect(conv.threadUnread).toBe(2);
    const listed = (await followedOf('u-lan')).find((t) => t.rootId === root.id);
    expect(listed).toMatchObject({ unread: 2, following: true, muted: false, conversationTitle: 'Nhóm chuỗi', rootSnippet: 'Tin gốc' });
    expect(await unreadOf('u-lan')).toBe(badgeBefore + 2);

    const read = await call('u-lan', 'POST', `/chat/threads/${root.id}/read`, {});
    expect(read.json.data).toEqual({ rootId: root.id });
    expect((await followedOf('u-lan')).find((t) => t.rootId === root.id).unread).toBe(0);
    expect(await unreadOf('u-lan')).toBe(badgeBefore);
    expect((await conversationOf('u-lan', g)).threadUnread).toBe(0);
  });

  test('mute keeps the thread listed without notifications or badge; none unfollows; following an empty root creates the thread', async () => {
    const g = await groupG();
    const root = await post('u-lan', g, 'Tin gốc');
    await call('u-lan', 'POST', `/chat/conversations/${g}/read`, {});
    await post('u-huy', g, 'Ý một', { threadRootId: root.id });
    await call('u-lan', 'POST', `/chat/threads/${root.id}/read`, {});
    const badgeBefore = await unreadOf('u-lan');
    const notesBefore = (await notificationsOf('u-lan')).length;

    const muted = await call('u-lan', 'PUT', `/chat/threads/${root.id}/subscription`, { state: 'muted' });
    expect(muted.json.data).toEqual({ rootId: root.id, following: true, muted: true });
    await post('u-huy', g, 'Ý hai', { threadRootId: root.id });
    expect((await notificationsOf('u-lan')).length).toBe(notesBefore);
    expect((await followedOf('u-lan')).find((t) => t.rootId === root.id)).toMatchObject({ muted: true, unread: 1 });
    expect(await unreadOf('u-lan')).toBe(badgeBefore);

    const none = await call('u-lan', 'PUT', `/chat/threads/${root.id}/subscription`, { state: 'none' });
    expect(none.json.data).toEqual({ rootId: root.id, following: false, muted: false });
    expect((await followedOf('u-lan')).find((t) => t.rootId === root.id)).toBeUndefined();

    const empty = await post('u-long', g, 'Tin chưa ai trả lời');
    const follow = await call('u-mai', 'PUT', `/chat/threads/${empty.id}/subscription`, { state: 'following' });
    expect(follow.json.data).toEqual({ rootId: empty.id, following: true, muted: false });
    const thread = await call('u-mai', 'GET', `/chat/threads/${empty.id}`);
    expect(thread.json.data.thread).toMatchObject({ replyCount: 0, following: true });
    expect((await followedOf('u-mai')).map((t) => t.rootId)).toContain(empty.id);

    const bad = await call('u-mai', 'PUT', `/chat/threads/${empty.id}/subscription`, { state: 'loud' });
    expect(bad.status).toBe(422);
  });

  test('a manual follow starts read, while an existing follower keeps their unread replies', async () => {
    const g = await groupG();
    const root = await post('u-lan', g, 'Tin gốc');
    for (const text of ['Một', 'Hai', 'Ba']) await post('u-long', g, text, { threadRootId: root.id });

    const follow = await call('u-huy', 'PUT', `/chat/threads/${root.id}/subscription`, { state: 'following' });
    expect(follow.status).toBe(200);
    expect((await followedOf('u-huy')).find((t) => t.rootId === root.id)).toMatchObject({ following: true, unread: 0 });
    // A later reply must not share the follow's millisecond, or it would count as read.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await post('u-long', g, 'Bốn', { threadRootId: root.id });
    expect((await followedOf('u-huy')).find((t) => t.rootId === root.id).unread).toBe(1);

    // u-lan already follows as the root author: setting the state again leaves the read marker alone.
    expect((await followedOf('u-lan')).find((t) => t.rootId === root.id).unread).toBe(4);
    await call('u-lan', 'PUT', `/chat/threads/${root.id}/subscription`, { state: 'following' });
    expect((await followedOf('u-lan')).find((t) => t.rootId === root.id).unread).toBe(4);
  });

  test('invalid thread targets are rejected with 422', async () => {
    const g = await groupG();
    const root = await post('u-lan', g, 'Tin gốc');
    const other = await post('u-lan', g, 'Tin khác trong luồng chính');
    const reply = await post('u-long', g, 'Trả lời', { threadRootId: root.id });

    const onReply = await post('u-long', g, 'Trả lời của trả lời', { threadRootId: reply.id });
    expect(onReply.status).toBe(422);
    expect(onReply.json.error?.message).toBe('Chỉ trả lời theo chuỗi cho tin gốc');

    const g2 = await groupG();
    const foreignRoot = await post('u-lan', g2, 'Tin ở nhóm khác');
    const foreign = await post('u-long', g, 'Sai nhóm', { threadRootId: foreignRoot.id });
    expect(foreign.status).toBe(422);
    expect(foreign.json.error?.message).toBe('Không tìm thấy tin gốc của chuỗi');

    await call('u-lan', 'GET', '/tasks/task-1/comments');
    const comment = await call('u-lan', 'POST', '/tasks/task-1/comments', { id: crypto.randomUUID(), body: 'Bình luận' });
    expect(comment.status).toBe(200);
    const inTask = await post('u-lan', 'task:task-1', 'Trả lời chuỗi', { threadRootId: comment.json.data.id });
    expect(inTask.status).toBe(422);
    expect(inTask.json.error?.message).toBe('Bình luận việc không trả lời theo chuỗi');

    const alsoAlone = await post('u-long', g, 'Gửi vào nhóm', { alsoSendToMain: true });
    expect(alsoAlone.status).toBe(422);
    expect(alsoAlone.json.error?.message).toBe('Không gửi vào nhóm được ở đây');

    const quoteMain = await post('u-long', g, 'Trích tin luồng chính', { threadRootId: root.id, replyToMessageId: other.id });
    expect(quoteMain.status).toBe(422);
    // Quoting the root or a reply of the same thread is fine.
    const quoteReply = await post('u-long', g, 'Trích trả lời', { threadRootId: root.id, replyToMessageId: reply.id });
    expect(quoteReply.status).toBe(200);
  });

  test('recalling a thread reply lowers the reply count once', async () => {
    const g = await groupG();
    const root = await post('u-lan', g, 'Tin gốc');
    const r1 = await post('u-long', g, 'Một', { threadRootId: root.id });
    await post('u-long', g, 'Hai', { threadRootId: root.id });

    const del = await call('u-long', 'DELETE', `/chat/messages/${r1.id}`);
    expect(del.status).toBe(200);
    await call('u-long', 'DELETE', `/chat/messages/${r1.id}`);
    const thread = await call('u-lan', 'GET', `/chat/threads/${root.id}`);
    expect(thread.json.data.thread.replyCount).toBe(1);
    expect(thread.json.data.thread.latest.map((l: any) => l.snippet)).toEqual(['Hai']);
  });

  test('recalling the last reply moves the last reply time back to the remaining replies, and to none', async () => {
    const g = await groupG();
    const root = await post('u-lan', g, 'Tin gốc');
    const r1 = await post('u-long', g, 'Một', { threadRootId: root.id });
    await tick();
    const r2 = await post('u-long', g, 'Hai', { threadRootId: root.id });
    const threadRow = () => db.prepare('SELECT last_reply_at, last_activity_at FROM chat_thread WHERE root_message_id = ?')
      .bind(root.id).first<{ last_reply_at: string | null; last_activity_at: string }>();
    expect(await threadRow()).toEqual({ last_reply_at: r2.json.data.createdAt, last_activity_at: r2.json.data.createdAt });

    expect((await call('u-long', 'DELETE', `/chat/messages/${r2.id}`)).status).toBe(200);
    expect(await threadRow()).toEqual({ last_reply_at: r1.json.data.createdAt, last_activity_at: r2.json.data.createdAt });
    expect((await call('u-lan', 'GET', `/chat/threads/${root.id}`)).json.data.thread.lastReplyAt).toBe(r1.json.data.createdAt);

    expect((await call('u-long', 'DELETE', `/chat/messages/${r1.id}`)).status).toBe(200);
    expect(await threadRow()).toEqual({ last_reply_at: null, last_activity_at: r2.json.data.createdAt });
  });

  test('a mentioned newcomer has only the mentioning reply and later ones unread', async () => {
    const g = await groupG();
    const root = await post('u-lan', g, 'Tin gốc');
    await post('u-long', g, 'Một', { threadRootId: root.id });
    await tick();
    await post('u-long', g, 'Hai', { threadRootId: root.id });
    await tick();
    await post('u-long', g, 'Nhờ @[Hoàng Mai](user:u-mai) xem', { threadRootId: root.id });
    expect((await followedOf('u-mai')).find((t) => t.rootId === root.id)).toMatchObject({ following: true, unread: 1 });
    await tick();
    await post('u-huy', g, 'Ba', { threadRootId: root.id });
    expect((await followedOf('u-mai')).find((t) => t.rootId === root.id).unread).toBe(2);
  });

  test('in a direct chat a thread-only reply reaches the other person from the first reply on', async () => {
    const dm = await call('u-lan', 'POST', '/chat/conversations', { kind: 'direct', userId: 'u-huy' });
    const dmId = dm.json.data.id as string;
    const root = await post('u-lan', dmId, 'Tin gốc');
    await call('u-huy', 'POST', `/chat/conversations/${dmId}/read`, {});
    await tick();

    expect((await post('u-lan', dmId, 'Chỉ trong chuỗi', { threadRootId: root.id })).status).toBe(200);
    expect(await followersOf(root.id)).toEqual([
      { user_id: 'u-huy', via: 'author', muted: 0 },
      { user_id: 'u-lan', via: 'author', muted: 0 },
    ]);
    expect((await followedOf('u-huy')).find((t) => t.rootId === root.id)).toMatchObject({ following: true, unread: 1 });
    expect((await conversationOf('u-huy', dmId)).threadUnread).toBe(1);
    expect(await notificationsOf('u-huy')).toEqual([
      { kind: 'chat_direct', link: `/chat/${dmId}` },
      { kind: 'chat_thread', link: `/chat/${dmId}?thread=${root.id}` },
    ]);

    // Someone who unfollows is not added back by later replies.
    await call('u-huy', 'PUT', `/chat/threads/${root.id}/subscription`, { state: 'none' });
    await post('u-lan', dmId, 'Thêm một ý', { threadRootId: root.id });
    expect((await followersOf(root.id)).map((f) => f.user_id)).toEqual(['u-lan']);
    expect((await notificationsOf('u-huy')).filter((n) => n.kind === 'chat_thread')).toHaveLength(1);
  });

  test('in a direct chat with the agent only the person follows, and agent replies notify nobody', async () => {
    const created = await call('u-admin', 'POST', '/admin/chat-agents', { displayName: 'Trợ lý', dmAgentKey: 'crm-assistant', groupAgentKey: 'crm-group-assistant' });
    const agentId = created.json.data.id as string;
    const dm = await call('u-lan', 'POST', '/chat/conversations', { kind: 'direct', agentId });
    expect(dm.status).toBe(200);
    const dmId = dm.json.data.id as string;
    // The bridge is offline, so the agent side answers at once with its notice, inside the thread.
    await db.prepare('UPDATE inbox_setting SET bridge_last_seen_at = ? WHERE id = 1')
      .bind(new Date(Date.now() - 60 * 60_000).toISOString()).run();
    const root = await post('u-lan', dmId, 'Tin gốc');
    await db.prepare('DELETE FROM notification').run();
    expect((await post('u-lan', dmId, 'Hỏi trong chuỗi', { threadRootId: root.id })).status).toBe(200);

    expect(await followersOf(root.id)).toEqual([{ user_id: 'u-lan', via: 'author', muted: 0 }]);
    const agentReplies = await db.prepare("SELECT COUNT(*) AS n FROM chat_message WHERE thread_root_id = ? AND author_kind <> 'user'")
      .bind(root.id).first<{ n: number }>();
    expect(agentReplies!.n).toBeGreaterThan(0);
    expect(await db.prepare('SELECT COUNT(*) AS n FROM notification').first()).toEqual({ n: 0 });
  });

  test('a person outside the conversation gets 404 from every thread, topic, context and draft route', async () => {
    const g = await groupG();
    const root = await post('u-lan', g, 'Tin gốc');
    const reply = await post('u-long', g, 'Trả lời', { threadRootId: root.id });
    const routes: [string, string, unknown?][] = [
      ['PUT', `/chat/threads/${root.id}/subscription`, { state: 'following' }],
      ['POST', `/chat/threads/${root.id}/read`, {}],
      ['POST', `/chat/threads/${root.id}/close`, { closed: true }],
      ['GET', `/chat/conversations/${g}/topics`],
      ['GET', `/chat/messages/${reply.id}/context`],
      ['GET', `/chat/messages/${root.id}/context`],
      ['GET', `/chat/threads/${root.id}`],
      ['POST', `/chat/conversations/${g}/task-drafts`, { messageId: root.id, scope: 'message' }],
    ];
    for (const [method, path, body] of routes) {
      const res = await call('u-hung', method, path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(res.json.error?.code, `${method} ${path}`).toBe('NOT_FOUND');
    }
    expect(await followersOf(root.id)).not.toContainEqual(expect.objectContaining({ user_id: 'u-hung' }));
    expect(await db.prepare('SELECT closed_at FROM chat_thread WHERE root_message_id = ?').bind(root.id).first()).toEqual({ closed_at: null });
  });

  test('a follower removed from the conversation gets no thread notification', async () => {
    const g = await groupG();
    const root = await post('u-lan', g, 'Tin gốc');
    await call('u-huy', 'PUT', `/chat/threads/${root.id}/subscription`, { state: 'following' });
    const removed = await call('u-lan', 'DELETE', `/chat/conversations/${g}/members/u-huy`);
    expect(removed.status).toBe(200);

    await post('u-long', g, 'Trả lời', { threadRootId: root.id });
    expect(await notificationsOf('u-huy')).toEqual([]);
    expect((await notificationsOf('u-lan')).map((n) => n.kind)).toEqual(['chat_thread']);
    expect(await followedOf('u-huy')).toEqual([]);
    expect((await call('u-huy', 'GET', `/chat/threads/${root.id}`)).status).toBe(404);
  });

  test('notify calls made with one sink share one push allowance of 25', async () => {
    const users = ['u-admin', 'u-bgd', 'u-head', 'u-hung', 'u-lan', 'u-long', 'u-mai', 'u-huy'];
    const stamp = new Date().toISOString();
    const subKey = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
    const p256dh = toBase64Url(await crypto.subtle.exportKey('raw', subKey.publicKey) as ArrayBuffer);
    await db.batch(users.flatMap((uid) => [1, 2].map((n) => db.prepare(`INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(`ps-${uid}-${n}`, uid, `https://push.example/${uid}/${n}`, p256dh, toBase64Url(crypto.getRandomValues(new Uint8Array(16))), stamp))));
    const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
    let pushes = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { pushes += 1; return new Response(null, { status: 201 }); });
    const pending: Promise<unknown>[] = [];
    const sink: Sink = {
      env: {
        ...(env as unknown as WorkerEnv),
        CHAT_HUB: { idFromName: () => 'org', get: () => ({ fetch: async () => new Response('ok') }) } as unknown as DurableObjectNamespace,
        VAPID_PUBLIC_KEY: toBase64Url(await crypto.subtle.exportKey('raw', vapid.publicKey) as ArrayBuffer),
        VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', vapid.privateKey) as JsonWebKey).d!,
      },
      waitUntil: (w) => { pending.push(w); },
    };
    for (const kind of ['chat_mention', 'chat_direct', 'chat_thread'] as const) {
      await notify(sink, { organizationId: 'org-abm', userIds: users, kind, title: 'Thử', dedupeKey: `allowance:${kind}` });
    }
    await Promise.all(pending);
    // 16 devices on the first call (per-call cap 20), 9 on the second, none on the third; every row is still stored.
    expect(pushes).toBe(25);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM notification WHERE dedupe_key LIKE 'allowance:%'").first<{ n: number }>()).toEqual({ n: 24 });
  });

  test('budget: the heaviest message send stays within 40 D1 queries and 40 subrequests', async () => {
    const created = await call('u-admin', 'POST', '/admin/chat-agents', {
      displayName: 'Trợ lý',
      dmAgentKey: 'crm-assistant',
      groupAgentKey: 'crm-group-assistant',
    });
    const agentId = created.json.data.id as string;
    const g = await groupG();
    expect((await call('u-lan', 'POST', `/chat/conversations/${g}/agents`, { agentId })).status).toBe(200);
    await db.prepare('UPDATE inbox_setting SET bridge_last_seen_at = ? WHERE id = 1')
      .bind(new Date(Date.now() - 60 * 60_000).toISOString()).run();
    const root = await post('u-lan', g, 'Tin gốc');
    await post('u-huy', g, 'Trả lời trước', { threadRootId: root.id });

    const stamp = new Date().toISOString();
    const subKey = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
    const p256dh = toBase64Url(await crypto.subtle.exportKey('raw', subKey.publicKey) as ArrayBuffer);
    await db.batch(['u-lan', 'u-long', 'u-huy', 'u-mai'].flatMap((uid) => [1, 2].map((n) => db.prepare(`INSERT INTO push_subscription (id, user_id, endpoint, p256dh, auth, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(`ps-${uid}-${n}`, uid, `https://push.example/${uid}/${n}`, p256dh, toBase64Url(crypto.getRandomValues(new Uint8Array(16))), stamp))));
    const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;

    let d1 = 0;
    let insideBatch = false;
    const origBatch = db.batch.bind(db);
    const origPrepare = db.prepare.bind(db);
    const wrap = (stmt: D1PreparedStatement): D1PreparedStatement => {
      const [bind, first, all, run, raw] = [stmt.bind.bind(stmt), stmt.first.bind(stmt), stmt.all.bind(stmt), stmt.run.bind(stmt), stmt.raw.bind(stmt)];
      const count = () => { if (!insideBatch) d1 += 1; };
      stmt.bind = (...args: unknown[]) => wrap(bind(...args));
      stmt.first = ((...a: [string?]) => { count(); return first(...(a as [never])); }) as typeof stmt.first;
      stmt.all = (() => { count(); return all(); }) as typeof stmt.all;
      stmt.run = (() => { count(); return run(); }) as typeof stmt.run;
      stmt.raw = ((...a: [never?]) => { count(); return raw(...a); }) as typeof stmt.raw;
      return stmt;
    };
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => wrap(origPrepare(sql)));
    vi.spyOn(db, 'batch').mockImplementation(async (stmts: D1PreparedStatement[]) => {
      d1 += 1;
      insideBatch = true;
      try { return await origBatch(stmts); } finally { insideBatch = false; }
    });
    let pushes = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { pushes += 1; return new Response(null, { status: 201 }); });
    let hubCalls = 0;
    const hub = { fetch: async () => { hubCalls += 1; return new Response('ok'); } };
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (w: Promise<unknown>) => { pending.push(w); }, passThroughOnException: () => undefined } as unknown as ExecutionContext;

    const res = await call('u-long', 'POST', `/chat/conversations/${g}/messages`, {
      id: crypto.randomUUID(),
      body: [
        'Chốt việc',
        '@[Đỗ Ngọc Lan](user:u-lan)',
        '@[Bùi Quang Huy](user:u-huy)',
        '@[Hoàng Mai](user:u-mai)',
        `@[Trợ lý](agent:${agentId})`,
      ].join(' '),
      threadRootId: root.id,
      alsoSendToMain: true,
    }, {
      env: {
        CHAT_HUB: { idFromName: () => 'org', get: () => hub } as unknown as DurableObjectNamespace,
        VAPID_PUBLIC_KEY: toBase64Url(await crypto.subtle.exportKey('raw', vapid.publicKey) as ArrayBuffer),
        VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey('jwk', vapid.privateKey) as JsonWebKey).d!,
      },
      ctx,
    });
    await Promise.all(pending);
    vi.restoreAllMocks();
    expect(res.status).toBe(200);

    console.log('message_budget', { d1, pushes, hubCalls, subrequests: hubCalls + pushes });
    expect(d1).toBeLessThanOrEqual(40);
    expect(pushes).toBeLessThanOrEqual(25);
    expect(hubCalls + pushes).toBeLessThanOrEqual(40);
    // The measured request really did the heavy work: three mentioned people pushed on both devices, an agent turn
    // queued, and the reply plus the offline notice counted in the thread.
    expect(pushes).toBe(6);
    expect(await db.prepare("SELECT COUNT(*) AS n FROM notification WHERE kind = 'chat_mention'").first<{ n: number }>()).toEqual({ n: 3 });
    expect(await db.prepare("SELECT COUNT(*) AS n FROM channel_command WHERE kind = 'run_completion'").first<{ n: number }>()).toEqual({ n: 1 });
    expect(await db.prepare('SELECT reply_count FROM chat_thread WHERE root_message_id = ?').bind(root.id).first<{ reply_count: number }>())
      .toEqual({ reply_count: 3 });
  });
});
