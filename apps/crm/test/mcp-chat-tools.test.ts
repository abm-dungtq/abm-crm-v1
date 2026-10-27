import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import seedSql from '../seed/demo.sql?raw';
import issueAgentTokensScript from '../scripts/issue-agent-tokens.mjs?raw';
import app from '../src/worker/index';
import { sha256 } from '../src/worker/commands';
import { resetDb } from './helpers/reset-db';

const db = env.DB;
const ORIGIN = 'http://crm.test';

beforeEach(async () => {
  await resetDb(db, seedSql);
  await db.prepare('INSERT INTO agent_kill_switch (id, enabled) VALUES (1, 0) ON CONFLICT(id) DO UPDATE SET enabled = 0').run();
});
afterEach(() => vi.restoreAllMocks());

type Json = { ok: boolean; data?: any; error?: { code: string; message: string } };

/** Web call as a signed-in person (demo header). */
async function web(user: string, method: string, path: string, body?: unknown) {
  const res = await app.fetch(new Request(`${ORIGIN}/api${path}`, {
    method,
    headers: { 'X-Demo-User': user, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { ...env, DEMO_MODE: '1' });
  return { status: res.status, json: (await res.json()) as Json, headers: res.headers };
}

async function mcp(token: string, body: unknown) {
  const res = await app.fetch(new Request(`${ORIGIN}/api/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  }), { ...env, DEMO_MODE: '1' });
  return { status: res.status, json: res.status === 200 ? await res.json() as any : null };
}
const rpc = (method: string, params?: unknown) => ({ jsonrpc: '2.0', id: 1, method, params });
async function listTools(token: string): Promise<string[]> {
  return (await mcp(token, rpc('tools/list'))).json.result.tools.map((t: { name: string }) => t.name);
}
async function tool(token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await mcp(token, rpc('tools/call', { name, arguments: args }));
  expect(res.status).toBe(200);
  const result = res.json.result;
  return { isError: Boolean(result.isError), data: JSON.parse(result.content[0].text) };
}

/** Creates a self-service token through the web route; the value only lives in this test's memory. */
async function selfToken(user: string, scope: 'read' | 'read_tasks' = 'read', label = 'Claude Code') {
  const res = await web(user, 'POST', '/agent-tokens', { label, scope });
  expect(res.status).toBe(200);
  return res.json.data as { id: string; token: string; mcpUrl: string; expiresAt: string };
}

async function group(owner: string, members: string[], title = 'Nhóm Sales') {
  const res = await web(owner, 'POST', '/chat/conversations', { kind: 'group', title, memberUserIds: members });
  expect(res.status).toBe(200);
  return res.json.data.id as string;
}
async function say(user: string, conversationId: string, body: string) {
  const res = await web(user, 'POST', `/chat/conversations/${conversationId}/messages`, { id: crypto.randomUUID(), body });
  expect(res.status).toBe(200);
  return res.json.data.id as string;
}

const READ_SET = ['whoami', 'search_leads', 'get_lead', 'my_tasks', 'dashboard_summary', 'list_conversations', 'read_messages', 'search_messages', 'get_task'];
const TASK_WRITES = ['complete_task', 'create_task', 'update_task', 'comment_task'];

describe('self-service tokens', () => {
  test('a read token is returned once and only its hash is stored', async () => {
    const created = await selfToken('u-lan');
    expect(created.token.startsWith('abmcrm_')).toBe(true);
    const appUrl = (env as unknown as { APP_URL?: string }).APP_URL;
    expect(created.mcpUrl).toBe(`${(appUrl || ORIGIN).replace(/\/+$/, '')}/api/mcp`);
    const plain = await db.prepare('SELECT COUNT(*) AS n FROM agent_token WHERE token_hash = ?').bind(created.token).first<{ n: number }>();
    expect(plain?.n).toBe(0);
    const row = await db.prepare('SELECT user_id, scope, created_via, expires_at, created_at FROM agent_token WHERE token_hash = ?')
      .bind(await sha256(created.token)).first<any>();
    expect(row).toMatchObject({ user_id: 'u-lan', scope: 'read', created_via: 'self' });
    expect(Math.round((Date.parse(row.expires_at) - Date.parse(row.created_at)) / 86_400_000)).toBe(90);
    const audits = (await db.prepare("SELECT command, after_json FROM audit_log WHERE entity = 'agent_token'").all<any>()).results;
    expect(audits.map((a) => a.command)).toEqual(['agentToken.create']);
    expect(JSON.stringify(audits)).not.toContain(created.token);
    const listed = await web('u-lan', 'GET', '/agent-tokens');
    expect(listed.json.data).toEqual([expect.objectContaining({ id: created.id, label: 'Claude Code', scope: 'read', expiresAt: row.expires_at })]);
    expect(JSON.stringify(listed.json)).not.toContain(created.token);
    // Another person never sees or touches this token.
    expect((await web('u-long', 'GET', '/agent-tokens')).json.data).toEqual([]);
    expect((await web('u-long', 'DELETE', `/agent-tokens/${created.id}`)).status).toBe(404);
    expect((await web('u-long', 'POST', `/agent-tokens/${created.id}/rotate`)).status).toBe(404);
  });

  test('a read token lists read tools only and is refused any write', async () => {
    const { token } = await selfToken('u-lan');
    const names = await listTools(token);
    expect(names).toEqual(READ_SET);
    expect(names).not.toContain('create_lead');
    expect(names).not.toContain('create_task');
    const denied = await tool(token, 'create_task', { title: 'Không được' });
    expect(denied).toMatchObject({ isError: true, data: { code: 'FORBIDDEN' } });
    expect((await tool(token, 'log_activity', { lead_code: 'L-0004', type: 'note', summary: 'x' })).data.code).toBe('FORBIDDEN');
  });

  test('expired and revoked tokens get 401, and the sixth active token is refused while expired ones do not count', async () => {
    const a = await selfToken('u-lan');
    expect((await mcp(a.token, rpc('ping'))).status).toBe(200);
    await db.prepare("UPDATE agent_token SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(a.id).run();
    expect((await mcp(a.token, rpc('ping'))).status).toBe(401);

    const b = await selfToken('u-lan');
    expect((await web('u-lan', 'DELETE', `/agent-tokens/${b.id}`)).status).toBe(200);
    expect((await mcp(b.token, rpc('ping'))).status).toBe(401);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE command = 'agentToken.revoke' AND entity_id = ?").bind(b.id).first<{ n: number }>())?.n).toBe(1);

    for (let i = 0; i < 5; i += 1) await selfToken('u-lan', 'read', `Máy ${i}`);
    const sixth = await web('u-lan', 'POST', '/agent-tokens', { label: 'Máy 6' });
    expect(sixth.status).toBe(422);
    expect(sixth.json.data).toBeUndefined();
  });

  test('bad input is refused', async () => {
    expect((await web('u-lan', 'POST', '/agent-tokens', { label: '' })).status).toBe(422);
    expect((await web('u-lan', 'POST', '/agent-tokens', { label: 'x'.repeat(41) })).status).toBe(422);
    expect((await web('u-lan', 'POST', '/agent-tokens', { label: 'ok', scope: 'legacy' })).status).toBe(422);
    expect((await web('u-lan', 'POST', '/agent-tokens', { label: 'ok', expiresInDays: 365 })).status).toBe(422);
  });

  test('rotate revokes the old value and keeps label, scope and expiry length', async () => {
    const res = await web('u-lan', 'POST', '/agent-tokens', { label: 'Codex', scope: 'read_tasks', expiresInDays: 30 });
    const old = res.json.data as { id: string; token: string };
    const rotated = await web('u-lan', 'POST', `/agent-tokens/${old.id}/rotate`);
    expect(rotated.status).toBe(200);
    expect(rotated.headers.get('Cache-Control')).toBe('no-store');
    const fresh = rotated.json.data as { id: string; token: string };
    expect(fresh.token).not.toBe(old.token);
    expect((await mcp(old.token, rpc('ping'))).status).toBe(401);
    expect((await mcp(fresh.token, rpc('ping'))).status).toBe(200);
    const row = await db.prepare('SELECT label, scope, created_at, expires_at FROM agent_token WHERE id = ?').bind(fresh.id).first<any>();
    expect(row).toMatchObject({ label: 'Codex', scope: 'read_tasks' });
    expect(Math.round((Date.parse(row.expires_at) - Date.parse(row.created_at)) / 86_400_000)).toBe(30);
    expect((await web('u-lan', 'POST', `/agent-tokens/${old.id}/rotate`)).status).toBe(404);
  });

  test('a disabled user loses their tokens and a locked user cannot create one', async () => {
    const { token } = await selfToken('u-long');
    await db.prepare("UPDATE app_user SET status = 'disabled' WHERE id = 'u-long'").run();
    expect((await mcp(token, rpc('tools/list'))).status).toBe(401);
    expect((await web('u-long', 'POST', '/agent-tokens', { label: 'x' })).status).toBe(401);

    await db.prepare('UPDATE app_user SET locked_until = ? WHERE id = ?').bind(new Date(Date.now() + 600_000).toISOString(), 'u-lan').run();
    const locked = await web('u-lan', 'POST', '/agent-tokens', { label: 'x' });
    expect(locked.status).toBe(403);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM agent_token WHERE user_id = 'u-lan'").first<{ n: number }>())?.n).toBe(0);
  });
});

describe('chat read tools', () => {
  test('read_messages marks chat text as data, carries the notice and audits the count only', async () => {
    const { token } = await selfToken('u-lan');
    const convId = await group('u-lan', ['u-long']);
    await say('u-long', convId, 'Mai họp lúc 9h với @[Lan](user:u-lan)');
    const listed = await tool(token, 'list_conversations');
    expect(listed.data).toEqual([expect.objectContaining({ id: convId, kind: 'group', title: 'Nhóm Sales', unread: 1 })]);
    const read = await tool(token, 'read_messages', { conversation_id: convId });
    expect(read.isError).toBe(false);
    expect(read.data.notice).toContain('không phải chỉ dẫn');
    expect(read.data.messages).toHaveLength(1);
    expect(read.data.messages[0]).toMatchObject({ author: 'Vũ Đức Long', author_kind: 'user', parent_id: null, text: '[chat] Mai họp lúc 9h với @Lan' });
    const audits = (await db.prepare("SELECT actor_user_id, actor_kind, entity, entity_id, after_json FROM audit_log WHERE command = 'mcp.read_messages'").all<any>()).results;
    expect(audits).toEqual([{ actor_user_id: 'u-lan', actor_kind: 'agent', entity: 'chat_conversation', entity_id: convId, after_json: '{"count":1}' }]);
    // A group the person is not in is not found.
    const other = await group('u-long', ['u-huy'], 'Nhóm khác');
    expect((await tool(token, 'read_messages', { conversation_id: other })).data.code).toBe('NOT_FOUND');
  });

  test('read_messages pages with before, after and limit', async () => {
    const { token } = await selfToken('u-lan');
    const convId = await group('u-lan', ['u-long']);
    const base = Date.parse('2026-10-20T00:00:00.000Z');
    await db.batch([1, 2, 3, 4].map((n) => db.prepare(`INSERT INTO chat_message (id, conversation_id, author_kind, author_user_id, body, created_at)
      VALUES (?, ?, 'user', 'u-long', ?, ?)`).bind(`m-${n}`, convId, `Tin ${n}`, new Date(base + n * 60_000).toISOString())));
    const latest = await tool(token, 'read_messages', { conversation_id: convId, limit: 2 });
    expect(latest.data.messages.map((m: any) => m.id)).toEqual(['m-3', 'm-4']);
    const before = await tool(token, 'read_messages', { conversation_id: convId, before: new Date(base + 3 * 60_000).toISOString() });
    expect(before.data.messages.map((m: any) => m.id)).toEqual(['m-1', 'm-2']);
    const after = await tool(token, 'read_messages', { conversation_id: convId, after: new Date(base + 60_000).toISOString(), limit: 2 });
    expect(after.data.messages.map((m: any) => m.id)).toEqual(['m-2', 'm-3']);
    expect((await tool(token, 'read_messages', { conversation_id: convId, limit: 101 })).data.code).toBe('VALIDATION_FAILED');
    expect((await tool(token, 'read_messages', { conversation_id: convId, before: 'hôm qua' })).data.code).toBe('VALIDATION_FAILED');
  });

  test('a direct chat with agent reading turned off is never returned', async () => {
    const { token } = await selfToken('u-lan');
    const dm = await web('u-lan', 'POST', '/chat/conversations', { kind: 'direct', userId: 'u-huy' });
    const dmId = dm.json.data.id as string;
    await say('u-huy', dmId, 'Chuyện riêng tư');
    expect((await tool(token, 'list_conversations')).data.map((c: any) => c.id)).toContain(dmId);
    expect((await web('u-huy', 'PATCH', `/chat/conversations/${dmId}`, { agentReadable: false })).status).toBe(200);
    expect((await tool(token, 'list_conversations')).data.map((c: any) => c.id)).not.toContain(dmId);
    expect((await tool(token, 'read_messages', { conversation_id: dmId })).data.code).toBe('NOT_FOUND');
    expect((await tool(token, 'search_messages', { query: 'riêng tư' })).data.messages).toEqual([]);
  });

  test('read_messages with thread_id is refused on a direct chat with agent reading turned off', async () => {
    const { token } = await selfToken('u-lan');
    const dm = await web('u-lan', 'POST', '/chat/conversations', { kind: 'direct', userId: 'u-huy' });
    const dmId = dm.json.data.id as string;
    const root = await say('u-huy', dmId, 'Chuyện riêng tư');
    const reply = await web('u-lan', 'POST', `/chat/conversations/${dmId}/messages`, { id: crypto.randomUUID(), body: 'Trả lời riêng', threadRootId: root });
    expect(reply.status).toBe(200);
    expect((await tool(token, 'read_messages', { conversation_id: dmId, thread_id: root })).data.messages).toHaveLength(2);

    expect((await web('u-huy', 'PATCH', `/chat/conversations/${dmId}`, { agentReadable: false })).status).toBe(200);
    const refused = await tool(token, 'read_messages', { conversation_id: dmId, thread_id: root });
    expect(refused).toMatchObject({ isError: true, data: { code: 'NOT_FOUND' } });
    expect(JSON.stringify(refused.data)).not.toContain('riêng');
  });

  test('search_messages finds visible messages case-insensitively and is rate limited', async () => {
    const { token } = await selfToken('u-lan');
    const convId = await group('u-lan', ['u-long']);
    await say('u-long', convId, 'Gửi báo giá ABC cho khách');
    const hidden = await group('u-long', ['u-huy'], 'Không có Lan');
    await say('u-long', hidden, 'Báo giá abc nội bộ');
    const found = await tool(token, 'search_messages', { query: 'abc' });
    expect(found.data.notice).toBeTruthy();
    expect(found.data.messages).toEqual([expect.objectContaining({ conversation_id: convId, text: '[chat] Gửi báo giá ABC cho khách' })]);
    expect((await tool(token, 'search_messages', { query: 'a' })).data.code).toBe('VALIDATION_FAILED');
    const audit = await db.prepare("SELECT after_json FROM audit_log WHERE command = 'mcp.search_messages'").first<{ after_json: string }>();
    expect(audit?.after_json).toBe('{"count":1}');
    const now = new Date().toISOString();
    await db.batch(Array.from({ length: 29 }, () => db.prepare(`INSERT INTO audit_log (id, actor_user_id, actor_kind, command, entity, entity_id, created_at)
      VALUES (?, 'u-lan', 'agent', 'mcp.search_messages', 'chat_conversation', '*', ?)`).bind(crypto.randomUUID(), now)));
    const limited = await tool(token, 'search_messages', { query: 'abc' });
    expect(limited).toMatchObject({ isError: true, data: { message: 'Tìm quá nhiều lần, thử lại sau ít phút' } });
  });

  test('get_task returns the task with its latest comments, and my_tasks reads internal tasks by status', async () => {
    const writer = await selfToken('u-lan', 'read_tasks');
    const created = await tool(writer.token, 'create_task', { title: 'Soạn kế hoạch tuần' });
    expect(created.isError).toBe(false);
    const taskId = created.data.taskId as string;
    await tool(writer.token, 'comment_task', { task_id: taskId, body: 'Đã soạn xong phần 1' });
    const reader = await selfToken('u-lan');
    const detail = await tool(reader.token, 'get_task', { task_id: taskId });
    expect(detail.data).toMatchObject({ id: taskId, kind: 'internal', lead: null });
    expect(detail.data.comments.map((m: any) => m.text)).toEqual(['[chat] Đã soạn xong phần 1']);
    expect(detail.data.notice).toBeTruthy();
    expect((await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE command = 'mcp.get_task' AND entity = 'task' AND entity_id = ?").bind(taskId).first<{ n: number }>())?.n).toBe(1);
    expect((await tool(reader.token, 'my_tasks')).data.some((t: any) => t.id === taskId)).toBe(true);
    expect((await tool(writer.token, 'update_task', { task_id: taskId, status: 'in_progress' })).isError).toBe(false);
    expect((await tool(reader.token, 'my_tasks', { status: 'in_progress' })).data.map((t: any) => t.id)).toEqual([taskId]);
    const other = await selfToken('u-huy');
    expect((await tool(other.token, 'get_task', { task_id: taskId })).data.code).toBe('NOT_FOUND');
  });

  test('read_messages reads the main flow by default and a whole thread with thread_id', async () => {
    const { token } = await selfToken('u-lan');
    const convId = await group('u-lan', ['u-long']);
    const root = await say('u-lan', convId, 'Tin gốc');
    const reply = await web('u-long', 'POST', `/chat/conversations/${convId}/messages`, { id: crypto.randomUUID(), body: 'Chỉ trong chuỗi', threadRootId: root });
    expect(reply.status).toBe(200);
    const replyId = reply.json.data.id as string;

    const listed = await tool(token, 'list_conversations');
    expect(listed.data.find((c: any) => c.id === convId)).toMatchObject({ mode: 'chat', parent_conversation_id: null });

    const main = await tool(token, 'read_messages', { conversation_id: convId });
    expect(main.data.messages.map((m: any) => m.id)).toEqual([root]);
    expect(main.data.messages[0]).toMatchObject({ thread_id: root, reply_to_id: null, parent_id: null, reply_count: 1 });

    const thread = await tool(token, 'read_messages', { conversation_id: convId, thread_id: root });
    expect(thread.data.messages.map((m: any) => [m.id, m.thread_id])).toEqual([[root, root], [replyId, root]]);
    expect(thread.data.messages[1]).toMatchObject({ parent_id: root, reply_to_id: null });
    expect(thread.data.messages[1].reply_count).toBeUndefined();

    const otherConv = await group('u-lan', ['u-huy'], 'Nhóm khác');
    const otherRoot = await say('u-lan', otherConv, 'Gốc ở nhóm khác');
    expect((await tool(token, 'read_messages', { conversation_id: convId, thread_id: otherRoot })).data.code).toBe('NOT_FOUND');
    expect((await tool(token, 'read_messages', { conversation_id: convId, thread_id: replyId })).data.code).toBe('NOT_FOUND');

    const found = await tool(token, 'search_messages', { query: 'chỉ trong chuỗi' });
    expect(found.data.messages).toEqual([expect.objectContaining({ id: replyId, conversation_id: convId, thread_id: root })]);
  });

  test('get_task shows a chat source only when the agent may read that chat', async () => {
    const { token } = await selfToken('u-lan');
    const convId = await group('u-lan', ['u-long']);
    const msg = await say('u-lan', convId, 'Gửi báo giá');
    const fromGroup = await web('u-lan', 'POST', '/commands/createTask', {
      kind: 'internal', title: 'Gửi báo giá', assigneeUserId: 'u-lan', source: { conversationId: convId, messageId: msg, scope: 'message' },
    });
    expect(fromGroup.status).toBe(200);
    const detail = await tool(token, 'get_task', { task_id: fromGroup.json.data.taskId });
    expect(detail.data.source).toEqual({ conversation_id: convId, message_id: msg, scope: 'message' });

    const dm = await web('u-lan', 'POST', '/chat/conversations', { kind: 'direct', userId: 'u-huy' });
    const dmId = dm.json.data.id as string;
    const dmMsg = await say('u-huy', dmId, 'Nhờ chị gửi hợp đồng');
    const fromDm = await web('u-lan', 'POST', '/commands/createTask', {
      kind: 'internal', title: 'Gửi hợp đồng', assigneeUserId: 'u-lan', source: { conversationId: dmId, messageId: dmMsg, scope: 'message' },
    });
    expect(fromDm.status).toBe(200);
    expect((await tool(token, 'get_task', { task_id: fromDm.json.data.taskId })).data.source).toEqual({ conversation_id: dmId, message_id: dmMsg, scope: 'message' });
    expect((await web('u-huy', 'PATCH', `/chat/conversations/${dmId}`, { agentReadable: false })).status).toBe(200);
    const hidden = await tool(token, 'get_task', { task_id: fromDm.json.data.taskId });
    expect(hidden.isError).toBe(false);
    expect(hidden.data).not.toHaveProperty('source');
  });

  test('the kill switch stops chat reads and task comments', async () => {
    const reader = await selfToken('u-lan');
    const writer = await selfToken('u-lan', 'read_tasks');
    const convId = await group('u-lan', ['u-long']);
    const task = await tool(writer.token, 'create_task', { title: 'Việc thử công tắc' });
    await db.prepare('UPDATE agent_kill_switch SET enabled = 1 WHERE id = 1').run();
    for (const [name, args] of [
      ['list_conversations', {}], ['read_messages', { conversation_id: convId }], ['search_messages', { query: 'abc' }],
      ['get_task', { task_id: task.data.taskId }],
    ] as const) {
      expect((await tool(reader.token, name, args)).data.code).toBe('KILL_SWITCH_ON');
    }
    expect((await tool(writer.token, 'comment_task', { task_id: task.data.taskId, body: 'x' })).data.code).toBe('KILL_SWITCH_ON');
    expect((await tool(writer.token, 'create_task', { title: 'Việc khác' })).data.code).toBe('KILL_SWITCH_ON');
    expect((await db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE command LIKE 'mcp.%'").first<{ n: number }>())?.n).toBe(0);
  });
});

describe('read_tasks writes', () => {
  test('a read_tasks token manages tasks and comments, but no tool posts to a chat', async () => {
    const { id: tokenId, token } = await selfToken('u-lan', 'read_tasks');
    const names = await listTools(token);
    expect(names.sort()).toEqual([...READ_SET, ...TASK_WRITES].sort());
    expect(names.some((n) => /send|post|message$/.test(n) && n !== 'read_messages' && n !== 'search_messages')).toBe(false);

    const created = await tool(token, 'create_task', { title: 'Gọi lại nhà cung cấp', member_emails: ['long@demo.abm.example'], priority: 'high' });
    expect(created.isError).toBe(false);
    const taskId = created.data.taskId as string;
    const row = await db.prepare('SELECT kind, assignee_user_id, created_by_user_id, priority FROM task WHERE id = ?').bind(taskId).first<any>();
    expect(row).toEqual({ kind: 'internal', assignee_user_id: 'u-lan', created_by_user_id: 'u-lan', priority: 'high' });
    expect((await tool(token, 'create_task', { title: 'x', assignee_email: 'nobody@example.com' })).data.code).toBe('VALIDATION_FAILED');

    const body = 'Đã gọi, chờ báo giá @[Long](user:u-long)';
    const first = await tool(token, 'comment_task', { task_id: taskId, body });
    expect(first.isError).toBe(false);
    expect(first.data).toMatchObject({ conversation_id: `task:${taskId}`, duplicate: false });
    const retry = await tool(token, 'comment_task', { task_id: taskId, body });
    expect(retry.data).toMatchObject({ id: first.data.id, duplicate: true });
    const stored = (await db.prepare('SELECT id, author_user_id, meta_json, mentions_json FROM chat_message WHERE conversation_id = ?').bind(`task:${taskId}`).all<any>()).results;
    expect(stored).toEqual([{ id: first.data.id, author_user_id: 'u-lan', meta_json: '{"via":"mcp"}', mentions_json: '["u-long"]' }]);
    // The mention goes through the same notify path as the web route.
    expect((await db.prepare("SELECT COUNT(*) AS n FROM notification WHERE user_id = 'u-long' AND kind = 'chat_mention'").first<{ n: number }>())?.n).toBe(1);
    expect(first.data.id).not.toContain(tokenId);

    const withRequest = { task_id: taskId, body: 'Bình luận có mã', request_id: 'req-1' };
    const r1 = await tool(token, 'comment_task', withRequest);
    const r2 = await tool(token, 'comment_task', withRequest);
    expect(r2.data).toMatchObject({ id: r1.data.id, duplicate: true });
    expect((await db.prepare('SELECT COUNT(*) AS n FROM chat_message WHERE conversation_id = ?').bind(`task:${taskId}`).first<{ n: number }>())?.n).toBe(2);

    // A task outside the person's scope cannot be commented on.
    const foreign = await web('u-huy', 'POST', '/commands/createTask', { kind: 'internal', title: 'Việc của Huy', assigneeUserId: 'u-huy' });
    expect((await tool(token, 'comment_task', { task_id: foreign.json.data.taskId, body: 'x' })).data.code).toBe('NOT_FOUND');
  });

  test('re-issuing the GoClaw key with the script leaves self-service and LMS publish tokens working', async () => {
    const self = await selfToken('u-lan');
    await db.batch([
      db.prepare("INSERT INTO agent_token (id, user_id, token_hash, label, created_at) VALUES ('tok-old-goclaw', 'u-lan', 'h-goclaw', 'goclaw', '2026-10-04T00:00:00Z')"),
      db.prepare("INSERT INTO agent_token (id, user_id, token_hash, label, created_at) VALUES ('tok-lms', 'u-lan', 'h-lms', 'lms-publish', '2026-10-04T00:00:00Z')"),
    ]);
    // Runs the script's own revoke statement, so a change to it is tested as written.
    const revoke = issueAgentTokensScript.match(/UPDATE agent_token SET revoked_at = '\$\{now\}' WHERE [^;]+;/)?.[0];
    expect(revoke).toBeDefined();
    await db.prepare(revoke!.replaceAll('${now}', '2026-10-26T00:00:00.000Z').replaceAll('${p.userId}', 'u-lan')).run();
    const live = (await db.prepare("SELECT id FROM agent_token WHERE user_id = 'u-lan' AND revoked_at IS NULL ORDER BY id").all<{ id: string }>()).results;
    expect(live.map((r) => r.id).sort()).toEqual([self.id, 'tok-lms'].sort());
    expect((await mcp(self.token, rpc('ping'))).status).toBe(200);
  });

  test('a legacy script token keeps every role tool plus the new ones', async () => {
    const legacy = crypto.randomUUID();
    await db.prepare("INSERT INTO agent_token (id, user_id, token_hash, label, created_at) VALUES ('tok-goclaw', 'u-lan', ?, 'goclaw', '2026-10-04T00:00:00Z')")
      .bind(await sha256(legacy)).run();
    const names = await listTools(legacy);
    expect(names).toEqual([
      'whoami', 'search_leads', 'get_lead', 'my_tasks', 'dashboard_summary', 'create_lead', 'log_activity', 'complete_task',
      'change_stage', 'assign_lead', 'request_owner_change',
      'list_conversations', 'read_messages', 'search_messages', 'get_task', 'create_task', 'update_task', 'comment_task',
    ]);
  });

  test('the LMS publish token is refused by the MCP gateway', async () => {
    const lms = crypto.randomUUID();
    await db.prepare("INSERT INTO agent_token (id, user_id, token_hash, label, created_at) VALUES ('tok-lms-mcp', 'u-lan', ?, 'lms-publish', '2026-10-04T00:00:00Z')")
      .bind(await sha256(lms)).run();
    expect((await mcp(lms, rpc('ping'))).status).toBe(401);
  });
});

describe('D1 budget', () => {
  /** Counts D1 round trips during `work`; a `db.batch` is one. */
  async function countD1(work: () => Promise<unknown>) {
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
    const prepareSpy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => wrap(origPrepare(sql)));
    const batchSpy = vi.spyOn(db, 'batch').mockImplementation(async (stmts: D1PreparedStatement[]) => {
      d1 += 1;
      insideBatch = true;
      try { return await origBatch(stmts); } finally { insideBatch = false; }
    });
    try {
      await work();
    } finally {
      prepareSpy.mockRestore();
      batchSpy.mockRestore();
    }
    return d1;
  }

  test('list_conversations over 30 conversations and search_messages each stay within 10 D1 queries', async () => {
    const { token } = await selfToken('u-lan');
    const now = Date.now();
    const statements: D1PreparedStatement[] = [];
    for (let i = 0; i < 30; i += 1) {
      const id = `grp-${i}`;
      const at = new Date(now - i * 60_000).toISOString();
      statements.push(
        db.prepare(`INSERT INTO chat_conversation (id, organization_id, kind, title, created_by_user_id, created_at, updated_at, last_message_at)
          VALUES (?, 'org-abm', 'group', ?, 'u-long', ?, ?, ?)`).bind(id, `Nhóm ${i}`, at, at, at),
        db.prepare("INSERT INTO chat_member (conversation_id, user_id, role, joined_at) VALUES (?, 'u-lan', 'member', ?)").bind(id, at),
        db.prepare("INSERT INTO chat_member (conversation_id, user_id, role, joined_at) VALUES (?, 'u-long', 'owner', ?)").bind(id, at),
        db.prepare(`INSERT INTO chat_message (id, conversation_id, author_kind, author_user_id, body, created_at)
          VALUES (?, ?, 'user', 'u-long', ?, ?)`).bind(`msg-${i}`, id, `Báo giá số ${i}`, at),
      );
    }
    await db.batch(statements);

    let listed: Awaited<ReturnType<typeof tool>> | undefined;
    const listQueries = await countD1(async () => { listed = await tool(token, 'list_conversations'); });
    expect(listed!.data).toHaveLength(30);
    expect(listed!.data.every((c: any) => c.unread === 1)).toBe(true);
    let searched: Awaited<ReturnType<typeof tool>> | undefined;
    const searchQueries = await countD1(async () => { searched = await tool(token, 'search_messages', { query: 'báo giá', limit: 20 }); });
    expect(searched!.data.messages).toHaveLength(20);
    console.info('mcp_d1_budget', JSON.stringify({ listConversations: listQueries, searchMessages: searchQueries }));
    expect(listQueries).toBeLessThanOrEqual(10);
    expect(searchQueries).toBeLessThanOrEqual(10);
  });
});
