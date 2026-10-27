import { env, type D1Migration } from 'cloudflare:test';
import { beforeEach, describe, expect, test } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import app from '../src/worker/index';
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

type Json = { ok: boolean; data?: any; error?: { code: string; message: string; fields?: Record<string, string>; details?: any } };

async function call(user: string, method: string, path: string, body?: unknown, key: string = crypto.randomUUID()) {
  const response = await app.fetch(new Request(`http://crm.test/api${path}`, {
    method,
    headers: { 'X-Demo-User': user, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { ...env, DEMO_MODE: '1' });
  return { status: response.status, json: (await response.json()) as Json };
}
const command = (user: string, name: string, body: unknown, key?: string) => call(user, 'POST', `/commands/${name}`, body, key);

describe('internal chat', () => {
  test('1. group chat creation, unread counter, mark read, and access control', async () => {
    const created = await call('u-lan', 'POST', '/chat/conversations', {
      kind: 'group',
      title: 'Nhóm Sales Team 1',
      memberUserIds: ['u-long'],
    });
    expect(created.status).toBe(200);
    const convId = created.json.data.id as string;

    const msgId = crypto.randomUUID();
    const post = await call('u-long', 'POST', `/chat/conversations/${convId}/messages`, {
      id: msgId,
      body: 'Chào @[Lan](user:u-lan)',
    });
    expect(post.status).toBe(200);

    const lanList1 = await call('u-lan', 'GET', '/chat/conversations');
    expect(lanList1.status).toBe(200);
    const conv1 = lanList1.json.data.find((c: any) => c.id === convId);
    expect(conv1?.unread).toBe(1);

    const lanUnread1 = await call('u-lan', 'GET', '/chat/unread');
    expect(lanUnread1.json.data.total).toBe(1);

    const readRes = await call('u-lan', 'POST', `/chat/conversations/${convId}/read`, {
      at: new Date(Date.now() + 1000).toISOString(),
    });
    expect(readRes.status).toBe(200);

    const lanList2 = await call('u-lan', 'GET', '/chat/conversations');
    const conv2 = lanList2.json.data.find((c: any) => c.id === convId);
    expect(conv2?.unread).toBe(0);

    const huyMsgs = await call('u-huy', 'GET', `/chat/conversations/${convId}/messages`);
    expect(huyMsgs.status).toBe(404);
  });

  test('2. direct conversation u-lan -> u-huy twice and u-huy -> u-lan return the same id', async () => {
    const d1 = await call('u-lan', 'POST', '/chat/conversations', { kind: 'direct', userId: 'u-huy' });
    const d2 = await call('u-lan', 'POST', '/chat/conversations', { kind: 'direct', userId: 'u-huy' });
    const d3 = await call('u-huy', 'POST', '/chat/conversations', { kind: 'direct', userId: 'u-lan' });

    expect(d1.status).toBe(200);
    expect(d2.status).toBe(200);
    expect(d3.status).toBe(200);
    expect(d1.json.data.id).toBe('dm:u-huy:u-lan');
    expect(d2.json.data.id).toBe(d1.json.data.id);
    expect(d3.json.data.id).toBe(d1.json.data.id);
  });

  test('3. PATCH agentReadable:false by either member updates column to 0; on a group fails with VALIDATION_FAILED', async () => {
    const dm = await call('u-lan', 'POST', '/chat/conversations', { kind: 'direct', userId: 'u-huy' });
    const dmId = dm.json.data.id as string;

    const patchDm = await call('u-huy', 'PATCH', `/chat/conversations/${dmId}`, { agentReadable: false });
    expect(patchDm.status).toBe(200);
    const row = await db.prepare('SELECT agent_readable FROM chat_conversation WHERE id = ?')
      .bind(dmId).first<{ agent_readable: number }>();
    expect(row?.agent_readable).toBe(0);

    const grp = await call('u-lan', 'POST', '/chat/conversations', {
      kind: 'group',
      title: 'Nhóm nội bộ',
      memberUserIds: ['u-long'],
    });
    const grpId = grp.json.data.id as string;

    const patchGrp = await call('u-lan', 'PATCH', `/chat/conversations/${grpId}`, { agentReadable: false });
    expect(patchGrp.json.ok).toBe(false);
    expect(patchGrp.json.error?.code).toBe('VALIDATION_FAILED');
  });

  test('4. duplicate message id same author returns duplicate:true and stores one row; another conversation returns CONFLICT; parent from another conversation is rejected', async () => {
    const g1 = await call('u-lan', 'POST', '/chat/conversations', {
      kind: 'group',
      title: 'Nhóm 1',
      memberUserIds: ['u-long'],
    });
    const g2 = await call('u-lan', 'POST', '/chat/conversations', {
      kind: 'group',
      title: 'Nhóm 2',
      memberUserIds: ['u-long'],
    });
    const conv1 = g1.json.data.id as string;
    const conv2 = g2.json.data.id as string;

    const msgId = crypto.randomUUID();
    const p1 = await call('u-lan', 'POST', `/chat/conversations/${conv1}/messages`, {
      id: msgId,
      body: 'Tin nhắn đầu tiên',
    });
    expect(p1.status).toBe(200);
    expect(p1.json.data.duplicate).toBe(false);

    const p2 = await call('u-lan', 'POST', `/chat/conversations/${conv1}/messages`, {
      id: msgId,
      body: 'Tin nhắn đầu tiên',
    });
    expect(p2.status).toBe(200);
    expect(p2.json.data.duplicate).toBe(true);

    const countRow = await db.prepare('SELECT COUNT(*) AS n FROM chat_message WHERE id = ?')
      .bind(msgId).first<{ n: number }>();
    expect(countRow?.n).toBe(1);

    // Same id from another conversation -> CONFLICT (409)
    const conflict = await call('u-lan', 'POST', `/chat/conversations/${conv2}/messages`, {
      id: msgId,
      body: 'Dùng lại id ở hội thoại khác',
    });
    expect(conflict.status).toBe(409);
    expect(conflict.json.ok).toBe(false);
    expect(conflict.json.error?.code).toBe('CONFLICT');

    // Parent from another conversation -> rejected (422 VALIDATION_FAILED)
    const badReply = await call('u-lan', 'POST', `/chat/conversations/${conv2}/messages`, {
      id: crypto.randomUUID(),
      body: 'Trả lời tin của nhóm 1 trong nhóm 2',
      parentMessageId: msgId,
    });
    expect(badReply.status).toBe(422);
    expect(badReply.json.ok).toBe(false);
    expect(badReply.json.error?.code).toBe('VALIDATION_FAILED');
  });

  test('5. deleting someone else message returns 403; own message becomes deleted:true in list', async () => {
    const grp = await call('u-lan', 'POST', '/chat/conversations', {
      kind: 'group',
      title: 'Nhóm thảo luận',
      memberUserIds: ['u-long'],
    });
    const convId = grp.json.data.id as string;
    const msgId = crypto.randomUUID();

    await call('u-long', 'POST', `/chat/conversations/${convId}/messages`, {
      id: msgId,
      body: 'Tin của Long',
    });

    const delByLan = await call('u-lan', 'DELETE', `/chat/messages/${msgId}`);
    expect(delByLan.status).toBe(403);

    const delByLong = await call('u-long', 'DELETE', `/chat/messages/${msgId}`);
    expect(delByLong.status).toBe(200);

    const list = await call('u-lan', 'GET', `/chat/conversations/${convId}/messages`);
    expect(list.status).toBe(200);
    expect(list.json.data[0]).toMatchObject({ id: msgId, deleted: true, body: '' });
  });

  test('6. attachment upload of 11 MB returns 413; text/html upload serves with Content-Disposition attachment and nosniff', async () => {
    const grp = await call('u-lan', 'POST', '/chat/conversations', {
      kind: 'group',
      title: 'Nhóm tài liệu',
      memberUserIds: ['u-long'],
    });
    const convId = grp.json.data.id as string;

    const bigForm = new FormData();
    bigForm.append('file', new File([new Uint8Array(11 * 1024 * 1024)], 'huge.bin', { type: 'application/octet-stream' }));
    const bigRes = await app.fetch(new Request(`http://crm.test/api/chat/conversations/${convId}/attachments`, {
      method: 'POST',
      headers: { 'X-Demo-User': 'u-lan' },
      body: bigForm,
    }), { ...env, DEMO_MODE: '1' });
    expect(bigRes.status).toBe(413);

    const htmlForm = new FormData();
    htmlForm.append('file', new File(['<script>alert(1)</script>'], 'xss.html', { type: 'text/html' }));
    const htmlUp = await app.fetch(new Request(`http://crm.test/api/chat/conversations/${convId}/attachments`, {
      method: 'POST',
      headers: { 'X-Demo-User': 'u-lan' },
      body: htmlForm,
    }), { ...env, DEMO_MODE: '1' });
    expect(htmlUp.status).toBe(200);
    const htmlJson = (await htmlUp.json()) as Json;
    const attId = htmlJson.data.id as string;

    await call('u-lan', 'POST', `/chat/conversations/${convId}/messages`, {
      id: crypto.randomUUID(),
      body: 'Đính kèm tệp',
      attachmentIds: [attId],
    });

    const getAtt = await app.fetch(new Request(`http://crm.test/api/chat/attachments/${attId}`, {
      headers: { 'X-Demo-User': 'u-long' },
    }), { ...env, DEMO_MODE: '1' });
    expect(getAtt.status).toBe(200);
    expect(getAtt.headers.get('Content-Disposition')?.startsWith('attachment')).toBe(true);
    expect(getAtt.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(getAtt.headers.get('Cache-Control')).toBe('private, max-age=300');
  });

  test('7. GET /api/chat/socket with Origin: https://evil.example returns 403', async () => {
    const res = await app.fetch(new Request('http://crm.test/api/chat/socket', {
      headers: {
        'X-Demo-User': 'u-lan',
        Upgrade: 'websocket',
        Origin: 'https://evil.example',
      },
    }), { ...env, DEMO_MODE: '1' });
    expect(res.status).toBe(403);
  });

  test('8. updateTask prunes chat_member rows of task:<taskId> when memberUserIds or assignee changes', async () => {
    const created = await command('u-lan', 'createTask', {
      kind: 'internal',
      title: 'Chuẩn bị báo cáo tuần',
      assigneeUserId: 'u-long',
      memberUserIds: ['u-huy'],
    });
    const taskId = created.json.data.taskId as string;

    // Trigger task conversation creation so u-lan, u-long, u-huy are in chat_member
    const comments = await call('u-lan', 'GET', `/tasks/${taskId}/comments`);
    expect(comments.status).toBe(200);

    const beforeMembers = await db.prepare('SELECT user_id FROM chat_member WHERE conversation_id = ? ORDER BY user_id')
      .bind(`task:${taskId}`).all<{ user_id: string }>();
    expect(beforeMembers.results.map((r) => r.user_id)).toEqual(['u-huy', 'u-lan', 'u-long']);

    // Remove u-huy from memberUserIds and reassign from u-long to u-lan
    const updated = await command('u-lan', 'updateTask', {
      taskId,
      expectedVersion: 1,
      assigneeUserId: 'u-lan',
      memberUserIds: [],
    });
    expect(updated.status).toBe(200);

    const afterMembers = await db.prepare('SELECT user_id FROM chat_member WHERE conversation_id = ? ORDER BY user_id')
      .bind(`task:${taskId}`).all<{ user_id: string }>();
    expect(afterMembers.results.map((r) => r.user_id)).toEqual(['u-lan']);
  });

  test('a user outside the task scope cannot read, post to, upload to or download from its thread', async () => {
    const created = await command('u-lan', 'createTask', { kind: 'internal', title: 'Việc riêng nhóm 1', assigneeUserId: 'u-long' });
    const taskId = created.json.data.taskId as string;
    const comments = await call('u-lan', 'GET', `/tasks/${taskId}/comments`);
    const convId = comments.json.data.conversationId as string;

    const form = new FormData();
    form.append('file', new File(['bao cao'], 'bao-cao.txt', { type: 'text/plain' }));
    const upload = (user: string) => app.fetch(new Request(`http://crm.test/api/chat/conversations/${convId}/attachments`, {
      method: 'POST', headers: { 'X-Demo-User': user }, body: form,
    }), { ...env, DEMO_MODE: '1' });
    const uploaded = await upload('u-lan');
    expect(uploaded.status).toBe(200);
    const attId = ((await uploaded.json()) as Json).data.id as string;

    expect((await call('u-huy', 'GET', `/chat/conversations/${convId}/messages`)).status).toBe(404);
    expect((await call('u-huy', 'POST', `/chat/conversations/${convId}/messages`, { id: crypto.randomUUID(), body: 'x' })).status).toBe(404);
    expect((await upload('u-huy')).status).toBe(404);
    const download = await app.fetch(new Request(`http://crm.test/api/chat/attachments/${attId}`, {
      headers: { 'X-Demo-User': 'u-huy' },
    }), { ...env, DEMO_MODE: '1' });
    expect(download.status).toBe(404);
    expect((await call('u-long', 'GET', `/chat/conversations/${convId}/messages`)).status).toBe(200);
  });

  test('a read marker in the future is capped at the server clock so later messages still count as unread', async () => {
    const grp = await call('u-lan', 'POST', '/chat/conversations', { kind: 'group', title: 'Nhóm đồng hồ', memberUserIds: ['u-long'] });
    const convId = grp.json.data.id as string;
    await call('u-lan', 'POST', `/chat/conversations/${convId}/read`, { at: '2099-01-01T00:00:00.000Z' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await call('u-long', 'POST', `/chat/conversations/${convId}/messages`, { id: crypto.randomUUID(), body: 'Tin sau' });
    expect((await call('u-lan', 'GET', '/chat/unread')).json.data.total).toBe(1);
  });

  test('P1. attachment download returns 404 when message_id is NULL for non-uploader, 200 for uploader, and 404 after message is deleted', async () => {
    const grp = await call('u-lan', 'POST', '/chat/conversations', {
      kind: 'group',
      title: 'Nhóm P1',
      memberUserIds: ['u-long'],
    });
    const convId = grp.json.data.id as string;

    const form = new FormData();
    form.append('file', new File(['tai lieu'], 'doc.txt', { type: 'text/plain' }));
    const up = await app.fetch(new Request(`http://crm.test/api/chat/conversations/${convId}/attachments`, {
      method: 'POST',
      headers: { 'X-Demo-User': 'u-lan' },
      body: form,
    }), { ...env, DEMO_MODE: '1' });
    expect(up.status).toBe(200);
    const attId = ((await up.json()) as Json).data.id as string;

    // While message_id is NULL: uploader gets 200, other member gets 404
    const byUploader = await app.fetch(new Request(`http://crm.test/api/chat/attachments/${attId}`, {
      headers: { 'X-Demo-User': 'u-lan' },
    }), { ...env, DEMO_MODE: '1' });
    expect(byUploader.status).toBe(200);
    expect(byUploader.headers.get('Cache-Control')).toBe('private, max-age=300');

    const byOtherBeforeSend = await app.fetch(new Request(`http://crm.test/api/chat/attachments/${attId}`, {
      headers: { 'X-Demo-User': 'u-long' },
    }), { ...env, DEMO_MODE: '1' });
    expect(byOtherBeforeSend.status).toBe(404);

    // Attach to a message -> other member gets 200
    const msgId = crypto.randomUUID();
    const sent = await call('u-lan', 'POST', `/chat/conversations/${convId}/messages`, {
      id: msgId,
      body: 'Gửi tài liệu',
      attachmentIds: [attId],
    });
    expect(sent.status).toBe(200);

    const byOtherAfterSend = await app.fetch(new Request(`http://crm.test/api/chat/attachments/${attId}`, {
      headers: { 'X-Demo-User': 'u-long' },
    }), { ...env, DEMO_MODE: '1' });
    expect(byOtherAfterSend.status).toBe(200);

    // Delete parent message -> both uploader and other member get 404
    const del = await call('u-lan', 'DELETE', `/chat/messages/${msgId}`);
    expect(del.status).toBe(200);

    const afterDeleteOther = await app.fetch(new Request(`http://crm.test/api/chat/attachments/${attId}`, {
      headers: { 'X-Demo-User': 'u-long' },
    }), { ...env, DEMO_MODE: '1' });
    expect(afterDeleteOther.status).toBe(404);

    const afterDeleteUploader = await app.fetch(new Request(`http://crm.test/api/chat/attachments/${attId}`, {
      headers: { 'X-Demo-User': 'u-lan' },
    }), { ...env, DEMO_MODE: '1' });
    expect(afterDeleteUploader.status).toBe(404);
  });

  test('P2. GET /tasks/:id/comments and /read do not insert a non-member viewer; commenting or valid mention adds membership', async () => {
    const created = await command('u-lan', 'createTask', {
      kind: 'internal',
      title: 'Việc nhóm KD1',
      assigneeUserId: 'u-long',
    });
    const taskId = created.json.data.taskId as string;

    // Leader u-hung can see the task but is not creator/assignee/task_member
    const hungView = await call('u-hung', 'GET', `/tasks/${taskId}/comments`);
    expect(hungView.status).toBe(200);
    expect(hungView.json.data.isMember).toBe(false);

    // /read by non-member u-hung is a no-op returning 200 and does not insert u-hung
    const hungRead1 = await call('u-hung', 'POST', `/tasks/${taskId}/comments/read`, { at: new Date().toISOString() });
    expect(hungRead1.status).toBe(200);
    const hungRead2 = await call('u-hung', 'POST', `/chat/conversations/task:${taskId}/read`, { at: new Date().toISOString() });
    expect(hungRead2.status).toBe(200);

    const membersBefore = await db.prepare('SELECT user_id FROM chat_member WHERE conversation_id = ? ORDER BY user_id')
      .bind(`task:${taskId}`).all<{ user_id: string }>();
    expect(membersBefore.results.map((r) => r.user_id)).toEqual(['u-lan', 'u-long']);

    // Creator u-lan gets isMember: true
    const lanView = await call('u-lan', 'GET', `/tasks/${taskId}/comments`);
    expect(lanView.status).toBe(200);
    expect(lanView.json.data.isMember).toBe(true);

    // Mentioning u-bgd (director, passes canSeeTask) adds u-bgd; u-hung commenting adds u-hung
    await call('u-hung', 'POST', `/tasks/${taskId}/comments`, {
      id: crypto.randomUUID(),
      body: 'Báo cáo @[BGĐ](user:u-bgd)',
    });

    const hungViewAfter = await call('u-hung', 'GET', `/tasks/${taskId}/comments`);
    expect(hungViewAfter.json.data.isMember).toBe(true);
    const bgdViewAfter = await call('u-bgd', 'GET', `/tasks/${taskId}/comments`);
    expect(bgdViewAfter.json.data.isMember).toBe(true);
  });

  test('P3. POST /tasks/:id/comments filters mentions with canSeeTask: mentioning u-mai in a team-kd1 task stores no mention for her', async () => {
    const created = await command('u-lan', 'createTask', {
      kind: 'internal',
      title: 'Việc nội bộ KD1',
      assigneeUserId: 'u-long',
    });
    const taskId = created.json.data.taskId as string;

    const msgId = crypto.randomUUID();
    const post = await call('u-lan', 'POST', `/tasks/${taskId}/comments`, {
      id: msgId,
      body: 'Nhờ @[Mai](user:u-mai) và @[Long](user:u-long) xem giúp',
    });
    expect(post.status).toBe(200);
    expect(post.json.data.mentions).toEqual(['u-long']);

    const row = await db.prepare('SELECT mentions_json FROM chat_message WHERE id = ?')
      .bind(msgId).first<{ mentions_json: string | null }>();
    expect(JSON.parse(row?.mentions_json ?? '[]')).toEqual(['u-long']);
  });
});

describe('quote replies and message context', () => {
  async function group(title: string, memberUserIds: string[] = ['u-long']) {
    const created = await call('u-lan', 'POST', '/chat/conversations', { kind: 'group', title, memberUserIds });
    expect(created.status).toBe(200);
    return created.json.data.id as string;
  }
  async function post(user: string, convId: string, body: string, extra: Record<string, unknown> = {}) {
    const id = crypto.randomUUID();
    const res = await call(user, 'POST', `/chat/conversations/${convId}/messages`, { id, body, ...extra });
    return { id, res };
  }

  test('a quote reply stays in the main flow and carries a preview of the quoted message', async () => {
    const convId = await group('Nhóm trích dẫn');
    const a = await post('u-lan', convId, 'Chiều nay họp lúc 3h nhé');
    const b = await post('u-long', convId, 'Mình vào đúng giờ', { replyToMessageId: a.id });
    expect(b.res.status).toBe(200);
    expect(b.res.json.data.replyToMessageId).toBe(a.id);

    const list = await call('u-lan', 'GET', `/chat/conversations/${convId}/messages`);
    expect(list.status).toBe(200);
    const ids = (list.json.data as { id: string }[]).map((m) => m.id);
    expect(ids).toEqual([b.id, a.id]);
    const reply = list.json.data[0];
    expect(reply).toMatchObject({
      replyToMessageId: a.id,
      threadRootId: null,
      alsoInMain: false,
      replyTo: { id: a.id, authorName: 'Đỗ Ngọc Lan', snippet: 'Chiều nay họp lúc 3h nhé', deleted: false, threadRootId: null },
    });
    expect(list.json.data[1]).toMatchObject({ replyToMessageId: null, replyTo: null });
  });

  test('the old parentMessageId field is stored as the quoted message', async () => {
    const convId = await group('Nhóm tên cũ');
    const a = await post('u-lan', convId, 'Tin gốc');
    const b = await post('u-long', convId, 'Trả lời bằng tên cũ', { parentMessageId: a.id });
    expect(b.res.status).toBe(200);
    const row = await db.prepare('SELECT reply_to_message_id FROM chat_message WHERE id = ?')
      .bind(b.id).first<{ reply_to_message_id: string | null }>();
    expect(row?.reply_to_message_id).toBe(a.id);
  });

  test('quoting a message of another conversation or a recalled message is rejected', async () => {
    const conv1 = await group('Nhóm một');
    const conv2 = await group('Nhóm hai');
    const other = await post('u-lan', conv1, 'Tin ở nhóm một');
    const cross = await post('u-lan', conv2, 'Trích tin nhóm khác', { replyToMessageId: other.id });
    expect(cross.res.status).toBe(422);
    expect(cross.res.json.error).toMatchObject({ code: 'VALIDATION_FAILED', fields: { replyToMessageId: 'Không hợp lệ' } });

    const recalled = await post('u-lan', conv2, 'Tin sẽ thu hồi');
    expect((await call('u-lan', 'DELETE', `/chat/messages/${recalled.id}`)).status).toBe(200);
    const onRecalled = await post('u-long', conv2, 'Trích tin đã thu hồi', { replyToMessageId: recalled.id });
    expect(onRecalled.res.status).toBe(422);
    expect(onRecalled.res.json.error?.code).toBe('VALIDATION_FAILED');
  });

  test('recalling a quoted message empties the preview and marks it deleted', async () => {
    const convId = await group('Nhóm thu hồi');
    const a = await post('u-lan', convId, 'Tin sẽ bị thu hồi');
    const b = await post('u-long', convId, 'Đã nhận', { replyToMessageId: a.id });
    expect(b.res.status).toBe(200);
    expect((await call('u-lan', 'DELETE', `/chat/messages/${a.id}`)).status).toBe(200);

    const list = await call('u-long', 'GET', `/chat/conversations/${convId}/messages`);
    const reply = (list.json.data as any[]).find((m) => m.id === b.id);
    expect(reply.replyTo).toMatchObject({ id: a.id, deleted: true, snippet: '' });
  });

  test('message context returns the main-flow window around a message and hides it from non-members', async () => {
    const convId = await group('Nhóm lịch sử');
    const base = Date.parse('2026-10-01T00:00:00.000Z');
    const ids = Array.from({ length: 60 }, (_, i) => `ctx-${String(i + 1).padStart(2, '0')}`);
    await db.batch(ids.map((id, i) => db.prepare(`INSERT INTO chat_message
      (id, conversation_id, author_kind, author_user_id, body, created_at)
      VALUES (?, ?, 'user', 'u-lan', ?, ?)`)
      .bind(id, convId, `Tin số ${i + 1}`, new Date(base + i * 60_000).toISOString())));
    const tenth = ids[9]!;

    const ctx = await call('u-long', 'GET', `/chat/messages/${tenth}/context`);
    expect(ctx.status).toBe(200);
    expect(ctx.json.data).toMatchObject({ conversationId: convId, messageId: tenth, threadRootId: null });
    const windowIds = (ctx.json.data.messages as { id: string }[]).map((m) => m.id);
    // Nine older messages, the tenth itself and the 25 that follow it, newest first.
    expect(windowIds).toEqual(ids.slice(0, 35).reverse());

    const stranger = await call('u-huy', 'GET', `/chat/messages/${tenth}/context`);
    expect(stranger.status).toBe(404);
    expect((await call('u-long', 'GET', '/chat/messages/missing-id/context')).status).toBe(404);
  });

  test('the schema has the reply, thread and task source columns and accepts chat_thread notifications', async () => {
    const msgCols = (await db.prepare('PRAGMA table_info(chat_message)').all<{ name: string }>()).results.map((c) => c.name);
    expect(msgCols).toEqual(expect.arrayContaining(['reply_to_message_id', 'thread_root_id', 'also_in_main']));
    const taskCols = (await db.prepare('PRAGMA table_info(task)').all<{ name: string }>()).results.map((c) => c.name);
    expect(taskCols).toEqual(expect.arrayContaining(['source_conversation_id', 'source_message_id', 'source_scope']));

    await db.prepare(`INSERT INTO notification (id, user_id, kind, title, created_at)
      VALUES ('n-thread', 'u-lan', 'chat_thread', 'Có trả lời mới trong chuỗi', ?)`)
      .bind(new Date().toISOString()).run();
    const row = await db.prepare("SELECT kind FROM notification WHERE id = 'n-thread'").first<{ kind: string }>();
    expect(row?.kind).toBe('chat_thread');
  });

  test('the data fix copies an old parent_message_id into reply_to_message_id', async () => {
    const convId = await group('Nhóm dữ liệu cũ');
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(`INSERT INTO chat_message (id, conversation_id, author_kind, author_user_id, body, created_at)
        VALUES ('old-root', ?, 'user', 'u-lan', 'Tin gốc cũ', ?)`).bind(convId, now),
      db.prepare(`INSERT INTO chat_message (id, conversation_id, author_kind, author_user_id, parent_message_id, body, created_at)
        VALUES ('old-reply', ?, 'user', 'u-long', 'old-root', 'Trả lời cũ', ?)`).bind(convId, now),
    ]);
    const before = await db.prepare("SELECT reply_to_message_id FROM chat_message WHERE id = 'old-reply'")
      .first<{ reply_to_message_id: string | null }>();
    expect(before?.reply_to_message_id).toBeNull();

    await db.prepare('UPDATE chat_message SET reply_to_message_id = parent_message_id WHERE parent_message_id IS NOT NULL').run();
    const after = await db.prepare("SELECT reply_to_message_id FROM chat_message WHERE id = 'old-reply'")
      .first<{ reply_to_message_id: string | null }>();
    expect(after?.reply_to_message_id).toBe('old-root');
  });
});
