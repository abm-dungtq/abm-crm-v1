import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';
import { ensureInboxConversation } from '../src/worker/inbox-notices';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
beforeEach(() => resetDb(db, seedSql));

type Json = { ok: boolean; data?: any; error?: { code: string; message: string; fields?: Record<string, string> } };

async function call(user: string, method: string, path: string, body?: unknown) {
  const response = await app.fetch(new Request(`http://crm.test/api${path}`, {
    method,
    headers: { 'X-Demo-User': user, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { ...env, DEMO_MODE: '1' });
  return { status: response.status, json: (await response.json()) as Json };
}

const DEPT_KD = 'dept:dep-kd';
const KD_USERS = ['u-head', 'u-hung', 'u-huy', 'u-lan', 'u-long', 'u-mai'];
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const version = async (id: string) =>
  (await db.prepare('SELECT version FROM app_user WHERE id = ?').bind(id).first<{ version: number }>())!.version;
const members = async (conversationId: string) =>
  (await db.prepare('SELECT user_id FROM chat_member WHERE conversation_id = ? ORDER BY user_id').bind(conversationId)
    .all<{ user_id: string }>()).results.map((r) => r.user_id);

/** Adds the "Phòng Đào tạo" department with one team; the admin edit only accepts existing departments. */
async function addTrainingDepartment() {
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT INTO department (id, organization_id, name, created_at, updated_at) VALUES ('dep-dt', 'org-abm', 'Phòng Đào tạo', ?, ?)")
      .bind(now, now),
    db.prepare("INSERT INTO team (id, department_id, name, created_at, updated_at) VALUES ('team-dt1', 'dep-dt', 'Đào tạo 1', ?, ?)")
      .bind(now, now),
  ]);
}

const moveHuyToTraining = async () => call('u-admin', 'PATCH', '/admin/users/u-huy', {
  departmentName: 'Phòng Đào tạo',
  teamName: 'Đào tạo 1',
  version: await version('u-huy'),
});

const post = (user: string, conversationId: string, body: Record<string, unknown>) =>
  call(user, 'POST', `/chat/conversations/${conversationId}/messages`, { id: crypto.randomUUID(), ...body });

describe('department groups', () => {
  test('the conversation list creates the department group with exactly the active department members', async () => {
    const list = await call('u-lan', 'GET', '/chat/conversations');
    expect(list.status).toBe(200);
    const dept = list.json.data.find((c: any) => c.id === DEPT_KD);
    expect(dept).toMatchObject({
      kind: 'group',
      title: 'Phòng Kinh doanh',
      departmentId: 'dep-kd',
      parentConversationId: null,
      mode: 'chat',
      system: true,
    });

    const detail = await call('u-lan', 'GET', `/chat/conversations/${DEPT_KD}`);
    expect(detail.status).toBe(200);
    expect(detail.json.data.members.map((m: any) => m.id).sort()).toEqual(KD_USERS);
    expect(detail.json.data.members.find((m: any) => m.id === 'u-head').role).toBe('owner');
    expect(detail.json.data.members.filter((m: any) => m.role === 'owner')).toHaveLength(1);
    expect(detail.json.data).toMatchObject({ departmentId: 'dep-kd', mode: 'chat', subgroups: [] });

    const adminList = await call('u-admin', 'GET', '/chat/conversations');
    expect(adminList.json.data.some((c: any) => c.id === DEPT_KD)).toBe(false);
    expect((await call('u-admin', 'GET', `/chat/conversations/${DEPT_KD}`)).status).toBe(404);
  });

  test('admin saves move, disable and enable department members in the same request', async () => {
    await call('u-lan', 'GET', '/chat/conversations');
    await addTrainingDepartment();

    const moved = await moveHuyToTraining();
    expect(moved.status).toBe(200);
    expect(await members('dept:dep-dt')).toEqual(['u-huy']);
    expect(await members(DEPT_KD)).not.toContain('u-huy');
    const groups = await db.prepare('SELECT id, title FROM chat_conversation WHERE department_id IS NOT NULL ORDER BY id').all();
    expect(groups.results).toEqual([
      { id: 'dept:dep-dt', title: 'Phòng Đào tạo' },
      { id: DEPT_KD, title: 'Phòng Kinh doanh' },
    ]);

    const disabled = await call('u-admin', 'POST', '/admin/users/u-long/status', { status: 'disabled', version: await version('u-long') });
    expect(disabled.status).toBe(200);
    expect(await members(DEPT_KD)).not.toContain('u-long');

    const enabled = await call('u-admin', 'POST', '/admin/users/u-long/status', { status: 'active', version: await version('u-long') });
    expect(enabled.status).toBe(200);
    expect(await members(DEPT_KD)).toContain('u-long');
    expect(await members(DEPT_KD)).toEqual(['u-head', 'u-hung', 'u-lan', 'u-long', 'u-mai']);
  });

  test('nobody edits department group members or its name; owners switch the mode, the Inbox group cannot', async () => {
    await call('u-lan', 'GET', '/chat/conversations');

    expect((await call('u-head', 'POST', `/chat/conversations/${DEPT_KD}/members`, { userIds: ['u-admin'] })).status).toBe(403);
    expect((await call('u-lan', 'DELETE', `/chat/conversations/${DEPT_KD}/members/u-lan`)).status).toBe(403);

    const rename = await call('u-head', 'PATCH', `/chat/conversations/${DEPT_KD}`, { title: 'Tên khác' });
    expect(rename.status).toBe(422);
    expect(rename.json.error?.message).toBe('Tên nhóm phòng ban theo tên phòng ban');

    expect((await call('u-lan', 'PATCH', `/chat/conversations/${DEPT_KD}`, { mode: 'topic' })).status).toBe(403);
    const switched = await call('u-head', 'PATCH', `/chat/conversations/${DEPT_KD}`, { mode: 'topic' });
    expect(switched.status).toBe(200);
    expect(switched.json.data.mode).toBe('topic');
    expect((await call('u-lan', 'GET', `/chat/conversations/${DEPT_KD}`)).json.data.mode).toBe('topic');
    expect((await call('u-head', 'PATCH', `/chat/conversations/${DEPT_KD}`, { mode: 'board' })).status).toBe(422);

    const inboxId = await ensureInboxConversation(db, 'org-abm');
    const inbox = await call('u-admin', 'PATCH', `/chat/conversations/${inboxId}`, { mode: 'topic' });
    expect(inbox.status).toBe(422);
    const row = await db.prepare('SELECT mode FROM chat_conversation WHERE id = ?').bind(inboxId).first<{ mode: string }>();
    expect(row?.mode).toBe('chat');
  });
});

describe('subgroups', () => {
  test('department members, directors and admins create subgroups; others are refused', async () => {
    await call('u-lan', 'GET', '/chat/conversations');

    const created = await call('u-lan', 'POST', '/chat/conversations', {
      kind: 'group', title: 'Dự án A', memberUserIds: ['u-admin'], parentConversationId: DEPT_KD,
    });
    expect(created.status).toBe(200);
    const subId = created.json.data.id as string;
    const sub = await call('u-lan', 'GET', `/chat/conversations/${subId}`);
    expect(sub.json.data).toMatchObject({ parentConversationId: DEPT_KD, parentTitle: 'Phòng Kinh doanh', departmentId: null, subgroups: [] });
    expect(sub.json.data.members.map((m: any) => m.id).sort()).toEqual(['u-admin', 'u-lan']);
    const listed = (await call('u-admin', 'GET', '/chat/conversations')).json.data.find((c: any) => c.id === subId);
    expect(listed).toMatchObject({ parentConversationId: DEPT_KD, parentTitle: 'Phòng Kinh doanh', system: false });

    const byAdmin = await call('u-admin', 'POST', '/chat/conversations', {
      kind: 'group', title: 'Dự án B', memberUserIds: ['u-hung'], parentConversationId: DEPT_KD,
    });
    expect(byAdmin.status).toBe(200);

    // The department group lists only the subgroups the reader belongs to.
    expect((await call('u-lan', 'GET', `/chat/conversations/${DEPT_KD}`)).json.data.subgroups).toEqual([{ id: subId, title: 'Dự án A' }]);
    expect((await call('u-hung', 'GET', `/chat/conversations/${DEPT_KD}`)).json.data.subgroups)
      .toEqual([{ id: byAdmin.json.data.id, title: 'Dự án B' }]);

    await addTrainingDepartment();
    expect((await moveHuyToTraining()).status).toBe(200);
    const outsider = await call('u-huy', 'POST', '/chat/conversations', {
      kind: 'group', title: 'Không được', memberUserIds: ['u-lan'], parentConversationId: DEPT_KD,
    });
    expect(outsider.status).toBe(403);

    const normal = await call('u-lan', 'POST', '/chat/conversations', { kind: 'group', title: 'Nhóm thường', memberUserIds: ['u-long'] });
    const underNormal = await call('u-lan', 'POST', '/chat/conversations', {
      kind: 'group', title: 'Con nhóm thường', memberUserIds: ['u-long'], parentConversationId: normal.json.data.id,
    });
    expect(underNormal.status).toBe(422);
    expect(underNormal.json.error?.message).toBe('Nhóm nhỏ chỉ tạo được trong nhóm phòng ban');
    const underSub = await call('u-lan', 'POST', '/chat/conversations', {
      kind: 'group', title: 'Con nhóm nhỏ', memberUserIds: ['u-long'], parentConversationId: subId,
    });
    expect(underSub.status).toBe(422);
    const count = await db.prepare('SELECT COUNT(*) AS n FROM chat_conversation WHERE parent_conversation_id IS NOT NULL').first<{ n: number }>();
    expect(count?.n).toBe(2);
  });
});

describe('topic mode', () => {
  test('top-level posts start topics, the list follows activity, topics close and reopen', async () => {
    await call('u-lan', 'GET', '/chat/conversations');
    const old = await post('u-mai', DEPT_KD, { body: 'Tin trước khi bật chủ đề' });
    expect(old.status).toBe(200);
    expect((await call('u-head', 'PATCH', `/chat/conversations/${DEPT_KD}`, { mode: 'topic' })).status).toBe(200);
    await tick();

    const first = await post('u-lan', DEPT_KD, { body: 'Chủ đề 1 @[Long](user:u-long)' });
    expect(first.status).toBe(200);
    const firstId = first.json.data.id as string;
    const thread = await db.prepare('SELECT is_topic, reply_count FROM chat_thread WHERE root_message_id = ?').bind(firstId).first();
    expect(thread).toEqual({ is_topic: 1, reply_count: 0 });
    const followers = await db.prepare('SELECT user_id, via FROM chat_thread_follower WHERE root_message_id = ? ORDER BY user_id')
      .bind(firstId).all();
    expect(followers.results).toEqual([{ user_id: 'u-lan', via: 'author' }, { user_id: 'u-long', via: 'mention' }]);

    await tick();
    const second = await post('u-hung', DEPT_KD, { body: 'Chủ đề 2' });
    const secondId = second.json.data.id as string;
    await tick();
    expect((await post('u-mai', DEPT_KD, { body: 'Trả lời chủ đề 1', threadRootId: firstId })).status).toBe(200);

    const topics = await call('u-lan', 'GET', `/chat/conversations/${DEPT_KD}/topics`);
    expect(topics.status).toBe(200);
    expect(topics.json.data.map((m: any) => m.id)).toEqual([firstId, secondId, old.json.data.id]);
    expect(topics.json.data[0].thread).toMatchObject({ isTopic: true, replyCount: 1, closed: false, following: true });
    expect(topics.json.data[0].thread.latest[0].snippet).toBe('Trả lời chủ đề 1');
    const page2 = await call('u-lan', 'GET', `/chat/conversations/${DEPT_KD}/topics?limit=1&before=${encodeURIComponent(topics.json.data[0].thread.lastActivityAt)}`);
    expect(page2.json.data.map((m: any) => m.id)).toEqual([secondId]);
    // Messages from before the switch stay in the main flow.
    const main = await call('u-lan', 'GET', `/chat/conversations/${DEPT_KD}/messages`);
    expect(main.json.data.map((m: any) => m.id)).toContain(old.json.data.id);

    const quote = await post('u-lan', DEPT_KD, { body: 'Trích dẫn', replyToMessageId: secondId });
    expect(quote.status).toBe(422);
    expect(quote.json.error?.message).toBe('Ở chế độ Chủ đề, hãy trả lời trong chủ đề');

    expect((await call('u-long', 'POST', `/chat/threads/${firstId}/close`, { closed: true })).status).toBe(403);
    const closed = await call('u-lan', 'POST', `/chat/threads/${firstId}/close`, { closed: true });
    expect(closed.status).toBe(200);
    expect(closed.json.data).toMatchObject({ rootId: firstId, closed: true, isTopic: true });
    const refused = await post('u-mai', DEPT_KD, { body: 'Trả lời khi đã đóng', threadRootId: firstId });
    expect(refused.status).toBe(422);
    expect(refused.json.error?.message).toBe('Chủ đề đã đóng');

    const reopened = await call('u-head', 'POST', `/chat/threads/${firstId}/close`, { closed: false });
    expect(reopened.status).toBe(200);
    expect(reopened.json.data.closed).toBe(false);
    expect((await post('u-mai', DEPT_KD, { body: 'Trả lời sau khi mở lại', threadRootId: firstId })).status).toBe(200);

    // The old message becomes a topic on its first reply.
    expect((await post('u-lan', DEPT_KD, { body: 'Trả lời tin cũ', threadRootId: old.json.data.id })).status).toBe(200);
    const oldThread = await db.prepare('SELECT is_topic FROM chat_thread WHERE root_message_id = ?').bind(old.json.data.id).first();
    expect(oldThread).toEqual({ is_topic: 1 });
  });

  test('only a topic can be closed', async () => {
    const group = await call('u-lan', 'POST', '/chat/conversations', { kind: 'group', title: 'Nhóm chat', memberUserIds: ['u-long'] });
    const groupId = group.json.data.id as string;
    const root = await post('u-lan', groupId, { body: 'Tin gốc' });
    expect((await post('u-long', groupId, { body: 'Trả lời', threadRootId: root.json.data.id })).status).toBe(200);
    const res = await call('u-lan', 'POST', `/chat/threads/${root.json.data.id}/close`, { closed: true });
    expect(res.status).toBe(422);
    expect(res.json.error?.message).toBe('Chỉ đóng được chủ đề');
    expect((await call('u-lan', 'POST', `/chat/threads/${root.json.data.id}/close`, { closed: 'yes' })).status).toBe(422);
  });
});
