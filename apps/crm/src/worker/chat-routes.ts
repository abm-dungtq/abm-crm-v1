import { Hono } from 'hono';
import { sinkFrom, type AppBindings } from './env';
import {
  addConversationMembers,
  ensureTaskConversation,
  filterMentions,
  findOrCreateDirect,
  insertMessage,
  listConversations,
  listMessages,
  loadConversation,
  markRead,
  memberIds,
  parseUserMentions,
  publish,
  renderMentionText,
  unreadTotal,
} from './chat';
import {
  addConversationAgent,
  findOrCreateAgentDirect,
  listEnabledChatAgents,
  removeConversationAgent,
  scheduleAgentTurns,
} from './chat-agents';
import { asUploadFile } from './inbox/media';
import { notify } from './notify';
import { canSeeTask } from './task-scope';

export const chatRoutes = new Hono<AppBindings>();

const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const CHAT_ATTACHMENT_OVERHEAD = 64 * 1024;

const ALLOWED_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
]);

const INLINE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const STATUS: Record<string, 400 | 401 | 403 | 404 | 409 | 422> = {
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  STALE_VERSION: 409,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
};

const ok = <T>(data: T) => ({ ok: true as const, data });
const fail = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  ({ ok: false as const, error: { code, message, ...extra } });
const notFound = fail('NOT_FOUND', 'Không tìm thấy trong phạm vi của bạn');
const forbidden = fail('FORBIDDEN', 'Vai trò hiện tại không thực hiện được thao tác này');

async function validateActiveUsers(db: D1Database, organizationId: string, userIds: string[]): Promise<boolean> {
  if (userIds.length === 0) return true;
  const unique = [...new Set(userIds)];
  const rows = await db.prepare(
    `SELECT id FROM app_user WHERE id IN (SELECT value FROM json_each(?)) AND organization_id = ? AND status = 'active'`,
  ).bind(JSON.stringify(unique), organizationId).all<{ id: string }>();
  return rows.results.length === unique.length;
}

chatRoutes.get('/socket', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') {
    return c.json(fail('VALIDATION_FAILED', 'Cần kết nối WebSocket'), 426);
  }
  const origin = c.req.header('Origin');
  if (origin && origin !== new URL(c.req.url).origin) {
    return c.json(forbidden, 403);
  }
  const actor = c.get('actor');
  const hub = c.env.CHAT_HUB.get(c.env.CHAT_HUB.idFromName(actor.organizationId));
  return hub.fetch(new Request('https://chat-hub/connect', {
    headers: { Upgrade: 'websocket', 'X-Chat-User': actor.id },
  }));
});

chatRoutes.get('/conversations', async (c) => {
  return c.json(ok(await listConversations(c.env.DB, c.get('actor'))));
});

chatRoutes.get('/agents', async (c) => {
  return c.json(ok(await listEnabledChatAgents(c.env.DB, c.get('actor').organizationId)));
});

chatRoutes.get('/unread', async (c) => {
  return c.json(ok({ total: await unreadTotal(c.env.DB, c.get('actor')) }));
});

chatRoutes.post('/conversations', async (c) => {
  const actor = c.get('actor');
  const db = c.env.DB;
  const body = await c.req.json<{
    kind?: string;
    title?: string;
    memberUserIds?: unknown;
    userId?: string;
    agentId?: string;
  }>().catch(() => null);

  if (!body || (body.kind !== 'group' && body.kind !== 'direct')) {
    return c.json(fail('VALIDATION_FAILED', 'Loại hội thoại không hợp lệ'), 422);
  }

  if (body.kind === 'direct') {
    const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : '';
    if (agentId) {
      const id = await findOrCreateAgentDirect(db, actor, agentId);
      if (!id) {
        return c.json(fail('VALIDATION_FAILED', 'Trợ lý không hợp lệ', { fields: { agentId: 'Không hợp lệ' } }), 422);
      }
      publish(sinkFrom(c), actor.organizationId, [actor.id], {
        type: 'conversation.updated',
        conversationId: id,
      });
      return c.json(ok({ id }));
    }
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    const id = await findOrCreateDirect(db, actor, userId);
    if (!id) {
      return c.json(fail('VALIDATION_FAILED', 'Người nhận không hợp lệ', { fields: { userId: 'Không hợp lệ' } }), 422);
    }
    publish(sinkFrom(c), actor.organizationId, [actor.id, userId], {
      type: 'conversation.updated',
      conversationId: id,
    });
    return c.json(ok({ id }));
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title.length < 1 || title.length > 80) {
    return c.json(fail('VALIDATION_FAILED', 'Tên nhóm cần từ 1 đến 80 ký tự', { fields: { title: 'Không hợp lệ' } }), 422);
  }
  if (!Array.isArray(body.memberUserIds) || body.memberUserIds.length < 1 || body.memberUserIds.length > 50) {
    return c.json(fail('VALIDATION_FAILED', 'Danh sách thành viên cần từ 1 đến 50 người', { fields: { memberUserIds: 'Không hợp lệ' } }), 422);
  }
  const rawMembers = [...new Set(
    body.memberUserIds
      .filter((u): u is string => typeof u === 'string')
      .map((u) => u.trim())
      .filter(Boolean),
  )];
  if (rawMembers.length < 1 || rawMembers.length > 50 || !(await validateActiveUsers(db, actor.organizationId, rawMembers))) {
    return c.json(fail('VALIDATION_FAILED', 'Thành viên không hợp lệ', { fields: { memberUserIds: 'Không hợp lệ' } }), 422);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const allMembers = [...new Set([actor.id, ...rawMembers])];

  await db.batch([
    db.prepare(`INSERT INTO chat_conversation
      (id, organization_id, kind, title, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, 'group', ?, ?, ?, ?)`)
      .bind(id, actor.organizationId, title, actor.id, now, now),
    ...allMembers.map((uid) =>
      db.prepare(`INSERT INTO chat_member (conversation_id, user_id, role, joined_at)
        VALUES (?, ?, ?, ?)`)
        .bind(id, uid, uid === actor.id ? 'owner' : 'member', now),
    ),
  ]);

  publish(sinkFrom(c), actor.organizationId, allMembers, {
    type: 'conversation.updated',
    conversationId: id,
  });

  return c.json(ok({ id }));
});

chatRoutes.get('/conversations/:id', async (c) => {
  const actor = c.get('actor');
  const db = c.env.DB;
  const conv = await loadConversation(db, actor, c.req.param('id'));
  if (!conv) return c.json(notFound, 404);

  const [membersRes, agentsRes] = await db.batch([
    db.prepare(`
      SELECT cm.user_id AS id, u.display_name AS name, cm.role
      FROM chat_member cm
      JOIN app_user u ON u.id = cm.user_id
      WHERE cm.conversation_id = ?
      ORDER BY CASE cm.role WHEN 'owner' THEN 0 ELSE 1 END, u.display_name`)
      .bind(conv.id),
    db.prepare(`
      SELECT cam.agent_id AS id, a.display_name AS name, a.enabled, a.dm_agent_key, a.group_agent_key
      FROM chat_agent_member cam
      JOIN chat_agent a ON a.id = cam.agent_id
      WHERE cam.conversation_id = ?
      ORDER BY a.display_name, a.id`)
      .bind(conv.id),
  ]);

  const memberRows = (membersRes?.results ?? []) as { id: string; name: string; role: 'owner' | 'member' }[];
  const agentRows = ((agentsRes?.results ?? []) as {
    id: string;
    name: string;
    enabled: number;
    dm_agent_key: string | null;
    group_agent_key: string | null;
  }[]).map((a) => ({
    id: a.id,
    name: a.name,
    enabled: a.enabled === 1,
    canDm: Boolean(a.dm_agent_key),
    canGroup: Boolean(a.group_agent_key),
  }));

  const title = conv.kind === 'direct'
    ? (memberRows.find((m) => m.id !== actor.id)?.name ?? agentRows[0]?.name ?? conv.title ?? '')
    : (conv.title ?? '');

  return c.json(ok({
    id: conv.id,
    kind: conv.kind,
    title,
    taskId: conv.task_id,
    system: conv.system_key !== null,
    agentReadable: conv.agent_readable === 1,
    createdByUserId: conv.created_by_user_id,
    createdAt: conv.created_at,
    updatedAt: conv.updated_at,
    lastMessageAt: conv.last_message_at,
    members: memberRows,
    agents: agentRows,
  }));
});

chatRoutes.patch('/conversations/:id', async (c) => {
  const actor = c.get('actor');
  const db = c.env.DB;
  const conv = await loadConversation(db, actor, c.req.param('id'));
  if (!conv) return c.json(notFound, 404);

  const body = await c.req.json<{ title?: unknown; agentReadable?: unknown }>().catch(() => null);
  if (!body || (body.title === undefined && body.agentReadable === undefined)) {
    return c.json(fail('VALIDATION_FAILED', 'Dữ liệu không hợp lệ'), 422);
  }

  const now = new Date().toISOString();
  let nextTitle = conv.title;
  let nextAgentReadable = conv.agent_readable === 1;

  if (body.agentReadable !== undefined) {
    if (typeof body.agentReadable !== 'boolean' || conv.kind !== 'direct') {
      return c.json(fail('VALIDATION_FAILED', 'Chỉ hội thoại riêng mới đổi được cài đặt đọc của agent'), 422);
    }
    nextAgentReadable = body.agentReadable;
    await db.prepare('UPDATE chat_conversation SET agent_readable = ?, updated_at = ? WHERE id = ?')
      .bind(body.agentReadable ? 1 : 0, now, conv.id)
      .run();
  }

  if (body.title !== undefined) {
    if (conv.kind !== 'group') {
      return c.json(fail('VALIDATION_FAILED', 'Chỉ hội thoại nhóm mới đổi được tên'), 422);
    }
    const trimmed = typeof body.title === 'string' ? body.title.trim() : '';
    if (trimmed.length < 1 || trimmed.length > 80) {
      return c.json(fail('VALIDATION_FAILED', 'Tên nhóm cần từ 1 đến 80 ký tự', { fields: { title: 'Không hợp lệ' } }), 422);
    }
    const mayRename = conv.member_role === 'owner' || actor.role === 'director' || actor.role === 'admin';
    if (!mayRename) return c.json(forbidden, 403);
    nextTitle = trimmed;
    await db.prepare('UPDATE chat_conversation SET title = ?, updated_at = ? WHERE id = ?')
      .bind(trimmed, now, conv.id)
      .run();
  }

  const recipients = await memberIds(db, conv.id);
  publish(sinkFrom(c), actor.organizationId, recipients, {
    type: 'conversation.updated',
    conversationId: conv.id,
  });

  return c.json(ok({ id: conv.id, title: nextTitle, agentReadable: nextAgentReadable }));
});

chatRoutes.post('/conversations/:id/members', async (c) => {
  const actor = c.get('actor');
  const db = c.env.DB;
  const conv = await loadConversation(db, actor, c.req.param('id'));
  if (!conv) return c.json(notFound, 404);
  if (conv.kind !== 'group') {
    return c.json(fail('VALIDATION_FAILED', 'Chỉ hội thoại nhóm mới thêm được thành viên'), 422);
  }
  // A system group (the "Inbox" group) keeps its members in sync with the roster; nobody edits them by hand.
  if (conv.system_key) return c.json(forbidden, 403);
  const mayManage = conv.member_role === 'owner' || actor.role === 'director' || actor.role === 'admin';
  if (!mayManage) return c.json(forbidden, 403);

  const body = await c.req.json<{ userIds?: unknown }>().catch(() => null);
  if (!body || !Array.isArray(body.userIds) || body.userIds.length < 1 || body.userIds.length > 50) {
    return c.json(fail('VALIDATION_FAILED', 'Danh sách thành viên không hợp lệ', { fields: { userIds: 'Không hợp lệ' } }), 422);
  }
  const userIds = [...new Set(
    body.userIds
      .filter((u): u is string => typeof u === 'string')
      .map((u) => u.trim())
      .filter(Boolean),
  )];
  if (userIds.length < 1 || !(await validateActiveUsers(db, actor.organizationId, userIds))) {
    return c.json(fail('VALIDATION_FAILED', 'Thành viên không hợp lệ', { fields: { userIds: 'Không hợp lệ' } }), 422);
  }

  const now = new Date().toISOString();
  await db.batch([
    ...userIds.map((uid) =>
      db.prepare(`INSERT OR IGNORE INTO chat_member (conversation_id, user_id, role, joined_at)
        VALUES (?, ?, 'member', ?)`)
        .bind(conv.id, uid, now),
    ),
    db.prepare('UPDATE chat_conversation SET updated_at = ? WHERE id = ?').bind(now, conv.id),
  ]);

  const allMembers = await memberIds(db, conv.id);
  publish(sinkFrom(c), actor.organizationId, allMembers, {
    type: 'conversation.updated',
    conversationId: conv.id,
  });

  return c.json(ok({ conversationId: conv.id, memberIds: allMembers }));
});

chatRoutes.delete('/conversations/:id/members/:userId', async (c) => {
  const actor = c.get('actor');
  const db = c.env.DB;
  const conv = await loadConversation(db, actor, c.req.param('id'));
  if (!conv) return c.json(notFound, 404);
  if (conv.kind !== 'group') {
    return c.json(fail('VALIDATION_FAILED', 'Chỉ hội thoại nhóm mới xóa được thành viên'), 422);
  }
  if (conv.system_key) return c.json(forbidden, 403);
  const targetUserId = c.req.param('userId');
  const mayRemove = targetUserId === actor.id || conv.member_role === 'owner' || actor.role === 'director' || actor.role === 'admin';
  if (!mayRemove) return c.json(forbidden, 403);

  const oldMembers = await memberIds(db, conv.id);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare('DELETE FROM chat_member WHERE conversation_id = ? AND user_id = ?').bind(conv.id, targetUserId),
    db.prepare('UPDATE chat_conversation SET updated_at = ? WHERE id = ?').bind(now, conv.id),
  ]);

  publish(sinkFrom(c), actor.organizationId, [...new Set([...oldMembers, targetUserId])], {
    type: 'conversation.updated',
    conversationId: conv.id,
  });

  return c.json(ok({ conversationId: conv.id, removedUserId: targetUserId }));
});

chatRoutes.post('/conversations/:id/agents', async (c) => {
  const actor = c.get('actor');
  const db = c.env.DB;
  const rawId = c.req.param('id');
  let conv = await loadConversation(db, actor, rawId);
  if (!conv && rawId.startsWith('task:')) {
    const taskId = rawId.slice(5);
    if (taskId && (await canSeeTask(db, actor, taskId))) {
      await ensureTaskConversation(db, actor, taskId);
      conv = await loadConversation(db, actor, rawId);
    }
  }
  if (!conv) return c.json(notFound, 404);
  if (conv.kind === 'direct') {
    return c.json(fail('VALIDATION_FAILED', 'Chỉ hội thoại nhóm hoặc công việc mới thêm được trợ lý'), 422);
  }
  if (conv.kind === 'group') {
    const mayManage = conv.member_role === 'owner' || actor.role === 'director' || actor.role === 'admin';
    if (!mayManage) return c.json(forbidden, 403);
  }

  const body = await c.req.json<{ agentId?: unknown }>().catch(() => null);
  const agentId = typeof body?.agentId === 'string' ? body.agentId.trim() : '';
  if (!agentId) {
    return c.json(fail('VALIDATION_FAILED', 'Thiếu trợ lý', { fields: { agentId: 'Không hợp lệ' } }), 422);
  }

  const added = await addConversationAgent(db, actor.organizationId, conv.id, actor.id, agentId);
  if (!added) {
    return c.json(fail('VALIDATION_FAILED', 'Trợ lý không hợp lệ', { fields: { agentId: 'Không hợp lệ' } }), 422);
  }

  const recipients = await memberIds(db, conv.id);
  publish(sinkFrom(c), actor.organizationId, recipients, {
    type: 'conversation.updated',
    conversationId: conv.id,
  });

  return c.json(ok({ conversationId: conv.id, agentId }));
});

chatRoutes.delete('/conversations/:id/agents/:agentId', async (c) => {
  const actor = c.get('actor');
  const db = c.env.DB;
  const conv = await loadConversation(db, actor, c.req.param('id'));
  if (!conv) return c.json(notFound, 404);
  if (conv.kind === 'direct') {
    return c.json(fail('VALIDATION_FAILED', 'Chỉ hội thoại nhóm hoặc công việc mới xóa được trợ lý'), 422);
  }
  if (conv.kind === 'group') {
    const mayManage = conv.member_role === 'owner' || actor.role === 'director' || actor.role === 'admin';
    if (!mayManage) return c.json(forbidden, 403);
  }

  const targetAgentId = c.req.param('agentId');
  await removeConversationAgent(db, conv.id, targetAgentId);

  const recipients = await memberIds(db, conv.id);
  publish(sinkFrom(c), actor.organizationId, recipients, {
    type: 'conversation.updated',
    conversationId: conv.id,
  });

  return c.json(ok({ conversationId: conv.id, removedAgentId: targetAgentId }));
});

chatRoutes.get('/conversations/:id/messages', async (c) => {
  const actor = c.get('actor');
  const db = c.env.DB;
  const conv = await loadConversation(db, actor, c.req.param('id'));
  if (!conv) return c.json(notFound, 404);

  const before = c.req.query('before') || undefined;
  const limitParam = c.req.query('limit');
  const limit = limitParam ? Number(limitParam) : undefined;
  const messages = await listMessages(db, conv.id, {
    before,
    limit: limit !== undefined && Number.isFinite(limit) ? limit : undefined,
  });
  return c.json(ok(messages));
});

chatRoutes.post('/conversations/:id/messages', async (c) => {
  const actor = c.get('actor');
  const db = c.env.DB;
  const conv = await loadConversation(db, actor, c.req.param('id'));
  if (!conv) return c.json(notFound, 404);

  const body = await c.req.json<{
    id?: unknown;
    body?: unknown;
    parentMessageId?: unknown;
    attachmentIds?: unknown;
  }>().catch(() => null);

  if (!body || typeof body.id !== 'string' || typeof body.body !== 'string') {
    return c.json(fail('VALIDATION_FAILED', 'Dữ liệu chưa hợp lệ'), 422);
  }
  if (body.parentMessageId !== undefined && body.parentMessageId !== null && typeof body.parentMessageId !== 'string') {
    return c.json(fail('VALIDATION_FAILED', 'Tin nhắn gốc không hợp lệ', { fields: { parentMessageId: 'Không hợp lệ' } }), 422);
  }

  let attachmentIds: string[] = [];
  if (body.attachmentIds !== undefined) {
    if (!Array.isArray(body.attachmentIds) || body.attachmentIds.length > 5 || !body.attachmentIds.every((a) => typeof a === 'string')) {
      return c.json(fail('VALIDATION_FAILED', 'Tối đa 5 tệp đính kèm', { fields: { attachmentIds: 'Không hợp lệ' } }), 422);
    }
    attachmentIds = [...new Set(body.attachmentIds.map((a) => a.trim()).filter(Boolean))];
  }

  const members = await memberIds(db, conv.id);
  const rawMentions = parseUserMentions(body.body).slice(0, 10);
  const mentions = await filterMentions(db, actor.organizationId, conv.kind, conv.task_id, members, rawMentions);

  const result = await insertMessage(db, {
    id: body.id,
    conversationId: conv.id,
    authorKind: 'user',
    authorUserId: actor.id,
    body: body.body,
    parentMessageId: (body.parentMessageId as string | null | undefined) ?? null,
    mentions,
  });

  if (!result.ok) {
    return c.json(result, STATUS[result.error.code] ?? 400);
  }

  if (!result.data.duplicate) {
    let recipients = members;
    if (conv.kind === 'task') {
      const newMembers = [...new Set([actor.id, ...mentions])].filter((uid) => !members.includes(uid));
      if (newMembers.length > 0) {
        await addConversationMembers(db, conv.id, newMembers);
        recipients = [...new Set([...members, ...newMembers])];
      }
    }
    if (attachmentIds.length > 0) {
      await db.prepare(`
        UPDATE chat_attachment
        SET message_id = ?1
        WHERE id IN (SELECT value FROM json_each(?2))
          AND conversation_id = ?3
          AND uploaded_by_user_id = ?4
          AND message_id IS NULL`)
        .bind(result.data.id, JSON.stringify(attachmentIds), conv.id, actor.id)
        .run();
    }
    const sink = sinkFrom(c);
    publish(sink, actor.organizationId, recipients, {
      type: 'message.created',
      conversationId: conv.id,
      messageId: result.data.id,
    });

    const renderedBody = renderMentionText(result.data.body);
    if (conv.kind === 'direct') {
      const otherMembers = recipients.filter((uid) => uid !== actor.id);
      if (otherMembers.length > 0) {
        await notify(sink, {
          organizationId: actor.organizationId,
          userIds: otherMembers,
          kind: 'chat_direct',
          title: actor.displayName,
          body: renderedBody,
          link: `/chat/${conv.id}`,
          dedupeKey: `msg:${result.data.id}`,
        });
      }
    }

    const mentionUserIds = result.data.mentions.filter((uid) => uid !== actor.id);
    if (mentionUserIds.length > 0) {
      await notify(sink, {
        organizationId: actor.organizationId,
        userIds: mentionUserIds,
        kind: 'chat_mention',
        title: `${actor.displayName} đã nhắc đến bạn`,
        body: renderedBody,
        link: conv.kind === 'task' && conv.task_id ? `/tasks/${conv.task_id}` : `/chat/${conv.id}`,
        dedupeKey: `msg:${result.data.id}`,
      });
    }

    // The message is already saved; a failure to queue the agent turn must not turn the send into an error.
    try {
      await scheduleAgentTurns(sink, db, actor, conv, result.data, recipients);
    } catch {
      // Only the message id is logged: the error may quote the message text.
      console.error('schedule_agent_turns_failed', result.data.id);
    }
  }

  return c.json(result, 200);
});

chatRoutes.delete('/messages/:id', async (c) => {
  const actor = c.get('actor');
  const db = c.env.DB;
  const msg = await db.prepare(
    'SELECT id, conversation_id, author_kind, author_user_id FROM chat_message WHERE id = ?',
  ).bind(c.req.param('id')).first<{
    id: string;
    conversation_id: string;
    author_kind: string;
    author_user_id: string | null;
  }>();
  if (!msg) return c.json(notFound, 404);

  const conv = await loadConversation(db, actor, msg.conversation_id);
  if (!conv) return c.json(notFound, 404);

  if (msg.author_kind !== 'user' || msg.author_user_id !== actor.id) {
    return c.json(forbidden, 403);
  }

  const now = new Date().toISOString();
  await db.prepare('UPDATE chat_message SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ?')
    .bind(now, msg.id)
    .run();

  const recipients = await memberIds(db, conv.id);
  publish(sinkFrom(c), actor.organizationId, recipients, {
    type: 'message.deleted',
    conversationId: conv.id,
    messageId: msg.id,
  });

  return c.json(ok({ id: msg.id, conversationId: conv.id, deleted: true }));
});

chatRoutes.post('/conversations/:id/read', async (c) => {
  const actor = c.get('actor');
  const db = c.env.DB;
  const conv = await loadConversation(db, actor, c.req.param('id'));
  if (!conv) return c.json(notFound, 404);
  if (!conv.member_role) {
    return c.json(ok({ conversationId: conv.id }));
  }

  const body = await c.req.json<{ at?: string }>().catch(() => null);
  const at = typeof body?.at === 'string' && body.at ? body.at : new Date().toISOString();
  await markRead(db, conv.id, actor.id, at);

  publish(sinkFrom(c), actor.organizationId, [actor.id], {
    type: 'read',
    conversationId: conv.id,
  });

  return c.json(ok({ conversationId: conv.id }));
});

chatRoutes.post('/conversations/:id/attachments', async (c) => {
  const actor = c.get('actor');
  const db = c.env.DB;
  const conv = await loadConversation(db, actor, c.req.param('id'));
  if (!conv) return c.json(notFound, 404);

  const declaredLength = Number(c.req.header('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > CHAT_ATTACHMENT_MAX_BYTES + CHAT_ATTACHMENT_OVERHEAD) {
    return c.json(fail('PAYLOAD_TOO_LARGE', 'Tệp đính kèm tối đa 10 MB'), 413);
  }

  const form = await c.req.parseBody().catch(() => null);
  const file = asUploadFile(form?.file);
  if (!file || file.size === 0) {
    return c.json(fail('VALIDATION_FAILED', 'Thiếu tệp đính kèm', { fields: { file: 'Bắt buộc' } }), 422);
  }
  if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
    return c.json(fail('PAYLOAD_TOO_LARGE', 'Tệp đính kèm tối đa 10 MB'), 413);
  }

  const rawType = (file.type || '').toLowerCase().split(';')[0]!.trim();
  const contentType = ALLOWED_CONTENT_TYPES.has(rawType) ? rawType : 'application/octet-stream';
  const id = crypto.randomUUID();
  const r2Key = `chat/${conv.id}/${id}`;
  const fileName = (file.name || 'attachment').slice(0, 255);
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (bytes.byteLength > CHAT_ATTACHMENT_MAX_BYTES) {
    return c.json(fail('PAYLOAD_TOO_LARGE', 'Tệp đính kèm tối đa 10 MB'), 413);
  }

  await c.env.MEDIA.put(r2Key, bytes, { httpMetadata: { contentType } });
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO chat_attachment
      (id, conversation_id, message_id, r2_key, file_name, content_type, size_bytes, uploaded_by_user_id, created_at)
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`)
    .bind(id, conv.id, r2Key, fileName, contentType, bytes.byteLength, actor.id, now)
    .run();

  return c.json(ok({ id, fileName, contentType, size: bytes.byteLength }));
});

chatRoutes.get('/attachments/:id', async (c) => {
  const actor = c.get('actor');
  const db = c.env.DB;
  const att = await db.prepare(`
    SELECT a.id, a.conversation_id, a.message_id, a.uploaded_by_user_id, a.r2_key, a.file_name, a.content_type,
      m.deleted_at AS message_deleted_at
    FROM chat_attachment a
    LEFT JOIN chat_message m ON m.id = a.message_id
    WHERE a.id = ?`,
  ).bind(c.req.param('id')).first<{
    id: string;
    conversation_id: string;
    message_id: string | null;
    uploaded_by_user_id: string;
    r2_key: string;
    file_name: string;
    content_type: string;
    message_deleted_at: string | null;
  }>();
  if (!att) return c.json(notFound, 404);
  if (att.message_deleted_at !== null) return c.json(notFound, 404);
  if (att.message_id === null && att.uploaded_by_user_id !== actor.id) return c.json(notFound, 404);

  const conv = await loadConversation(db, actor, att.conversation_id);
  if (!conv) return c.json(notFound, 404);

  const object = await c.env.MEDIA.get(att.r2_key);
  if (!object) return c.json(notFound, 404);

  const contentType = ALLOWED_CONTENT_TYPES.has(att.content_type) ? att.content_type : 'application/octet-stream';
  const disposition = INLINE_IMAGE_TYPES.has(contentType) ? 'inline' : 'attachment';
  const encodedName = encodeURIComponent(att.file_name);

  return new Response(object.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodedName}`,
    },
  });
});
