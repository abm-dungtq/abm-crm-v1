import type { ApiResult, ErrorCode } from '@abm/contracts';
import { fail, ok } from './command-result';
import type { Actor, Sink } from './env';
import { notify } from './notify';
import type { SqlFragment } from './scope';
import { canSeeTask, taskScope } from './task-scope';

export interface ChatAttachmentItem {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
}

export interface ChatMessageItem {
  id: string;
  conversationId: string;
  authorKind: 'user' | 'agent' | 'system';
  authorUserId: string | null;
  authorAgentId: string | null;
  authorName: string | null;
  parentMessageId: string | null;
  body: string;
  mentions: string[];
  meta: Record<string, unknown> | null;
  createdAt: string;
  deleted: boolean;
  duplicate?: boolean;
  attachments?: ChatAttachmentItem[];
}

export interface InsertMessageInput {
  id: string;
  conversationId: string;
  authorKind: 'user' | 'agent' | 'system';
  authorUserId?: string | null;
  authorAgentId?: string | null;
  body: string;
  parentMessageId?: string | null;
  mentions?: string[];
  meta?: Record<string, unknown> | null;
}

export interface ChatConversationRow {
  id: string;
  organization_id: string;
  kind: 'group' | 'direct' | 'task';
  title: string | null;
  task_id: string | null;
  direct_key: string | null;
  system_key: string | null;
  agent_readable: number;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  archived_at: string | null;
  member_role?: 'owner' | 'member' | null;
}

export interface ChatConversationSummary {
  id: string;
  kind: 'group' | 'direct';
  title: string;
  agentReadable: boolean;
  lastMessage: string;
  lastMessageAt: string | null;
  updatedAt: string;
  unread: number;
}

export type ChatEvent =
  | { type: 'message.created'; conversationId: string; messageId: string }
  | { type: 'message.deleted'; conversationId: string; messageId: string }
  | { type: 'conversation.updated'; conversationId: string }
  | { type: 'read'; conversationId: string }
  | { type: 'agent.thinking'; conversationId: string; agentId: string };

export function parseMentions(body: string): string[] {
  const ids = new Set<string>();
  const re = /@\[[^\]]+\]\((?:user|agent):([^)\s]+)\)/g;
  for (const match of body.matchAll(re)) {
    if (match[1]) ids.add(match[1]);
  }
  return [...ids];
}

export function parseUserMentions(body: string): string[] {
  const ids = new Set<string>();
  const re = /@\[[^\]]+\]\(user:([^)\s]+)\)/g;
  for (const match of body.matchAll(re)) {
    if (match[1]) ids.add(match[1]);
  }
  return [...ids];
}

export function parseAgentMentions(body: string): string[] {
  const ids = new Set<string>();
  const re = /@\[[^\]]+\]\(agent:([^)\s]+)\)/g;
  for (const match of body.matchAll(re)) {
    if (match[1]) ids.add(match[1]);
  }
  return [...ids];
}

export function renderMentionText(body: string): string {
  return body.replace(/@\[([^\]]+)\]\((?:user|agent):[^)\s]+\)/g, '@$1');
}

export async function filterMentions(
  db: D1Database,
  organizationId: string,
  convKind: 'group' | 'direct' | 'task',
  taskId: string | null,
  members: string[],
  rawMentions: string[],
): Promise<string[]> {
  if (rawMentions.length === 0) return [];
  const uniqueRaw = [...new Set(rawMentions)];
  const memberSet = new Set(members);
  if (convKind !== 'task' || !taskId) {
    return uniqueRaw.filter((uid) => memberSet.has(uid));
  }
  const unknownIds = uniqueRaw.filter((uid) => !memberSet.has(uid));
  if (unknownIds.length === 0) {
    return uniqueRaw;
  }
  const userRows = await db.prepare(
    `SELECT id, organization_id, department_id, team_id, role, display_name
     FROM app_user
     WHERE id IN (SELECT value FROM json_each(?)) AND organization_id = ? AND status = 'active'`,
  ).bind(JSON.stringify(unknownIds), organizationId).all<{
    id: string;
    organization_id: string;
    department_id: string | null;
    team_id: string | null;
    role: Actor['role'];
    display_name: string;
  }>();
  if (userRows.results.length === 0) {
    return uniqueRaw.filter((uid) => memberSet.has(uid));
  }
  const checks = userRows.results.map((u) => {
    const candidate: Actor = {
      id: u.id,
      organizationId: u.organization_id,
      departmentId: u.department_id,
      teamId: u.team_id,
      role: u.role,
      displayName: u.display_name,
      kind: 'human',
    };
    const scope = taskScope(candidate);
    return db.prepare(`SELECT 1 AS ok FROM task tk LEFT JOIN lead l ON l.id = tk.lead_id WHERE tk.id = ? AND ${scope.sql}`)
      .bind(taskId, ...scope.binds);
  });
  const checkResults = await db.batch<{ ok: number }>(checks);
  const allowed = new Set<string>(members);
  userRows.results.forEach((u, idx) => {
    if ((checkResults[idx]?.results?.length ?? 0) > 0) {
      allowed.add(u.id);
    }
  });
  return uniqueRaw.filter((uid) => allowed.has(uid));
}

export async function addConversationMembers(
  db: D1Database,
  conversationId: string,
  userIds: string[],
): Promise<void> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return;
  const now = new Date().toISOString();
  await db.batch(
    unique.map((uid) =>
      db.prepare(`INSERT OR IGNORE INTO chat_member (conversation_id, user_id, role, joined_at)
        VALUES (?, ?, 'member', ?)`)
        .bind(conversationId, uid, now),
    ),
  );
}

export async function loadConversation(
  db: D1Database,
  actor: Actor,
  id: string,
): Promise<ChatConversationRow | null> {
  const row = await db.prepare(`
    SELECT c.*, cm.role AS member_role
    FROM chat_conversation c
    LEFT JOIN chat_member cm ON cm.conversation_id = c.id AND cm.user_id = ?
    WHERE c.id = ? AND c.organization_id = ? AND c.archived_at IS NULL`)
    .bind(actor.id, id, actor.organizationId)
    .first<ChatConversationRow>();
  if (!row) return null;
  if (row.kind === 'task') {
    if (!row.task_id || !(await canSeeTask(db, actor, row.task_id))) return null;
    return row;
  }
  if (!row.member_role) return null;
  return row;
}

export async function memberIds(db: D1Database, conversationId: string): Promise<string[]> {
  const rows = await db.prepare('SELECT user_id FROM chat_member WHERE conversation_id = ?')
    .bind(conversationId)
    .all<{ user_id: string }>();
  return rows.results.map((r) => r.user_id);
}

export async function listConversations(db: D1Database, actor: Actor): Promise<ChatConversationSummary[]> {
  const rows = await db.prepare(`
    SELECT
      c.id,
      c.kind,
      CASE
        WHEN c.kind = 'direct' THEN COALESCE(
          (SELECT u.display_name FROM chat_member m2
           JOIN app_user u ON u.id = m2.user_id
           WHERE m2.conversation_id = c.id AND m2.user_id <> ?1
           LIMIT 1),
          (SELECT a.display_name FROM chat_agent_member cam
           JOIN chat_agent a ON a.id = cam.agent_id
           WHERE cam.conversation_id = c.id
           LIMIT 1),
          c.title,
          ''
        )
        ELSE COALESCE(c.title, '')
      END AS title,
      c.agent_readable,
      c.last_message_at,
      c.updated_at,
      (SELECT CASE WHEN lm.deleted_at IS NOT NULL THEN '' ELSE SUBSTR(lm.body, 1, 120) END
       FROM chat_message lm
       WHERE lm.conversation_id = c.id
       ORDER BY lm.created_at DESC, lm.id DESC
       LIMIT 1) AS last_message,
      (SELECT COUNT(*)
       FROM chat_message um
       WHERE um.conversation_id = c.id
         AND um.created_at > COALESCE(cm.last_read_at, '')
         AND um.author_user_id IS NOT ?1
         AND um.deleted_at IS NULL) AS unread
    FROM chat_conversation c
    JOIN chat_member cm ON cm.conversation_id = c.id AND cm.user_id = ?1
    WHERE c.organization_id = ?2
      AND c.archived_at IS NULL
      AND c.kind IN ('group', 'direct')
    ORDER BY c.last_message_at DESC, c.updated_at DESC, c.id DESC`)
    .bind(actor.id, actor.organizationId)
    .all<{
      id: string;
      kind: 'group' | 'direct';
      title: string;
      agent_readable: number;
      last_message_at: string | null;
      updated_at: string;
      last_message: string | null;
      unread: number;
    }>();

  return rows.results.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    agentReadable: r.agent_readable === 1,
    lastMessage: r.last_message ?? '',
    lastMessageAt: r.last_message_at,
    updatedAt: r.updated_at,
    unread: r.unread,
  }));
}

export async function unreadTotal(db: D1Database, actor: Actor): Promise<number> {
  const row = await db.prepare(`
    SELECT COUNT(*) AS total
    FROM chat_conversation c
    JOIN chat_member cm ON cm.conversation_id = c.id AND cm.user_id = ?1
    JOIN chat_message m ON m.conversation_id = c.id
    WHERE c.organization_id = ?2
      AND c.archived_at IS NULL
      AND c.kind IN ('group', 'direct', 'task')
      AND m.created_at > COALESCE(cm.last_read_at, '')
      AND m.author_user_id IS NOT ?1
      AND m.deleted_at IS NULL`)
    .bind(actor.id, actor.organizationId)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

export async function findOrCreateDirect(
  db: D1Database,
  actor: Actor,
  otherUserId: string,
): Promise<string | null> {
  if (!otherUserId || otherUserId === actor.id) return null;
  const other = await db.prepare(
    `SELECT id FROM app_user WHERE id = ? AND organization_id = ? AND status = 'active'`,
  ).bind(otherUserId, actor.organizationId).first<{ id: string }>();
  if (!other) return null;

  const directKey = [actor.id, otherUserId].sort().join(':');
  const id = `dm:${directKey}`;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO chat_conversation
      (id, organization_id, kind, direct_key, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, 'direct', ?, ?, ?, ?)`)
      .bind(id, actor.organizationId, directKey, actor.id, now, now),
    db.prepare(`INSERT OR IGNORE INTO chat_member (conversation_id, user_id, role, joined_at)
      VALUES (?, ?, 'member', ?)`)
      .bind(id, actor.id, now),
    db.prepare(`INSERT OR IGNORE INTO chat_member (conversation_id, user_id, role, joined_at)
      VALUES (?, ?, 'member', ?)`)
      .bind(id, otherUserId, now),
  ]);
  return id;
}

export function publish(
  sink: Sink,
  organizationId: string,
  userIds: string[],
  event: ChatEvent | { type: string; [key: string]: unknown },
): void {
  try {
    const hub = sink.env.CHAT_HUB.get(sink.env.CHAT_HUB.idFromName(organizationId));
    sink.waitUntil(
      hub.fetch('https://chat-hub/broadcast', {
        method: 'POST',
        body: JSON.stringify({ userIds: [...new Set(userIds)], event }),
      }).catch(() => undefined),
    );
  } catch {
    // Never throw to the caller.
  }
}

export async function ensureTaskConversation(db: D1Database, actor: Actor, taskId: string): Promise<string> {
  const convId = `task:${taskId}`;
  const now = new Date().toISOString();
  const [task, members] = await Promise.all([
    db.prepare('SELECT title, assignee_user_id, created_by_user_id FROM task WHERE id = ?')
      .bind(taskId).first<{ title: string; assignee_user_id: string; created_by_user_id: string | null }>(),
    db.prepare('SELECT user_id FROM task_member WHERE task_id = ?')
      .bind(taskId).all<{ user_id: string }>(),
  ]);
  const userIds = new Set<string>();
  if (task?.assignee_user_id) userIds.add(task.assignee_user_id);
  if (task?.created_by_user_id) userIds.add(task.created_by_user_id);
  for (const m of members.results) userIds.add(m.user_id);

  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO chat_conversation
      (id, organization_id, kind, title, task_id, created_by_user_id, created_at, updated_at)
      VALUES (?, ?, 'task', ?, ?, ?, ?, ?)`)
      .bind(convId, actor.organizationId, task?.title ?? null, taskId, actor.id, now, now),
    ...[...userIds].map((uid) =>
      db.prepare(`INSERT OR IGNORE INTO chat_member (conversation_id, user_id, role, joined_at)
        VALUES (?, ?, 'member', ?)`)
        .bind(convId, uid, now),
    ),
  ]);
  return convId;
}

export async function listMessages(
  db: D1Database,
  conversationId: string,
  opts: { before?: string; limit?: number } = {},
): Promise<ChatMessageItem[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const before = opts.before;
  const rows = await db.prepare(`
    SELECT m.id, m.conversation_id, m.author_kind, m.author_user_id, m.author_agent_id,
      m.parent_message_id, m.body, m.mentions_json, m.meta_json, m.created_at, m.deleted_at,
      COALESCE(u.display_name, a.display_name) AS author_name
    FROM chat_message m
    LEFT JOIN app_user u ON u.id = m.author_user_id
    LEFT JOIN chat_agent a ON a.id = m.author_agent_id
    WHERE m.conversation_id = ?${before ? ' AND m.created_at < ?' : ''}
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT ?`)
    .bind(conversationId, ...(before ? [before] : []), limit)
    .all<{
      id: string;
      conversation_id: string;
      author_kind: 'user' | 'agent' | 'system';
      author_user_id: string | null;
      author_agent_id: string | null;
      parent_message_id: string | null;
      body: string;
      mentions_json: string | null;
      meta_json: string | null;
      created_at: string;
      deleted_at: string | null;
      author_name: string | null;
    }>();

  const messageIds = rows.results.map((r) => r.id);
  const attRows = messageIds.length > 0
    ? await db.prepare(`
        SELECT id, message_id, file_name, content_type, size_bytes
        FROM chat_attachment
        WHERE message_id IN (SELECT value FROM json_each(?))
        ORDER BY created_at ASC, id ASC`)
      .bind(JSON.stringify(messageIds))
      .all<{ id: string; message_id: string; file_name: string; content_type: string; size_bytes: number }>()
    : { results: [] };
  const attByMsg = new Map<string, ChatAttachmentItem[]>();
  for (const a of attRows.results) {
    const list = attByMsg.get(a.message_id) ?? [];
    list.push({ id: a.id, fileName: a.file_name, contentType: a.content_type, size: a.size_bytes });
    attByMsg.set(a.message_id, list);
  }

  return rows.results.map((r) => {
    const deleted = r.deleted_at !== null;
    return {
      id: r.id,
      conversationId: r.conversation_id,
      authorKind: r.author_kind,
      authorUserId: r.author_user_id,
      authorAgentId: r.author_agent_id,
      authorName: r.author_name ?? (r.author_kind === 'agent' ? 'Trợ lý' : r.author_kind === 'system' ? 'Hệ thống' : null),
      parentMessageId: r.parent_message_id,
      body: deleted ? '' : r.body,
      mentions: deleted || !r.mentions_json ? [] : (JSON.parse(r.mentions_json) as string[]),
      meta: deleted || !r.meta_json ? null : (JSON.parse(r.meta_json) as Record<string, unknown>),
      createdAt: r.created_at,
      deleted,
      attachments: deleted ? [] : (attByMsg.get(r.id) ?? []),
    };
  });
}

export async function insertMessage(db: D1Database, input: InsertMessageInput): Promise<ApiResult<ChatMessageItem>> {
  const text = typeof input.body === 'string' ? input.body.trim() : '';
  if (!text || text.length > 4000) {
    return fail('VALIDATION_FAILED', 'Nội dung tin nhắn cần từ 1 đến 4000 ký tự', { fields: { body: 'Không hợp lệ' } });
  }
  if (!input.id || typeof input.id !== 'string' || input.id.length > 64) {
    return fail('VALIDATION_FAILED', 'Thiếu mã tin nhắn', { fields: { id: 'Không hợp lệ' } });
  }
  const now = new Date().toISOString();
  // Only people mention people: agent and system messages are stored without mentions, so they notify nobody.
  const mentions = input.authorKind === 'user' ? (input.mentions ?? parseMentions(text).slice(0, 10)) : [];
  const parentId = input.parentMessageId ?? null;
  const authorUserId = input.authorUserId ?? null;
  const authorAgentId = input.authorAgentId ?? null;

  const insertRes = await db.prepare(`
    INSERT OR IGNORE INTO chat_message
      (id, conversation_id, author_kind, author_user_id, author_agent_id, parent_message_id, body, mentions_json, meta_json, created_at)
    SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
    WHERE ?6 IS NULL OR EXISTS (
      SELECT 1 FROM chat_message p WHERE p.id = ?6 AND p.conversation_id = ?2
    )`)
    .bind(
      input.id,
      input.conversationId,
      input.authorKind,
      authorUserId,
      authorAgentId,
      parentId,
      text,
      mentions.length ? JSON.stringify(mentions) : null,
      input.meta ? JSON.stringify(input.meta) : null,
      now,
    )
    .run();

  if ((insertRes.meta?.changes ?? 0) === 0) {
    const existing = await db.prepare(`
      SELECT id, conversation_id, author_kind, author_user_id, author_agent_id,
        parent_message_id, body, mentions_json, meta_json, created_at, deleted_at
      FROM chat_message WHERE id = ?`)
      .bind(input.id)
      .first<{
        id: string;
        conversation_id: string;
        author_kind: 'user' | 'agent' | 'system';
        author_user_id: string | null;
        author_agent_id: string | null;
        parent_message_id: string | null;
        body: string;
        mentions_json: string | null;
        meta_json: string | null;
        created_at: string;
        deleted_at: string | null;
      }>();

    if (!existing) {
      return fail('VALIDATION_FAILED', 'Tin nhắn gốc không thuộc hội thoại này', {
        fields: { parentMessageId: 'Không hợp lệ' },
      });
    }

    if (
      existing.conversation_id === input.conversationId &&
      existing.author_kind === input.authorKind &&
      existing.author_user_id === authorUserId &&
      existing.author_agent_id === authorAgentId
    ) {
      const deleted = existing.deleted_at !== null;
      return ok({
        id: existing.id,
        conversationId: existing.conversation_id,
        authorKind: existing.author_kind,
        authorUserId: existing.author_user_id,
        authorAgentId: existing.author_agent_id,
        authorName: null,
        parentMessageId: existing.parent_message_id,
        body: deleted ? '' : existing.body,
        mentions: deleted || !existing.mentions_json ? [] : (JSON.parse(existing.mentions_json) as string[]),
        meta: deleted || !existing.meta_json ? null : (JSON.parse(existing.meta_json) as Record<string, unknown>),
        createdAt: existing.created_at,
        deleted,
        duplicate: true,
      });
    }

    return fail('CONFLICT' as ErrorCode, 'Mã tin nhắn đã được sử dụng');
  }

  await db.prepare('UPDATE chat_conversation SET last_message_at = ?, updated_at = ? WHERE id = ?')
    .bind(now, now, input.conversationId)
    .run();

  return ok({
    id: input.id,
    conversationId: input.conversationId,
    authorKind: input.authorKind,
    authorUserId,
    authorAgentId,
    authorName: null,
    parentMessageId: parentId,
    body: text,
    mentions,
    meta: input.meta ?? null,
    createdAt: now,
    deleted: false,
    duplicate: false,
  });
}

/**
 * Moves the read marker forward. `at` comes from the browser, so it is normalised to ISO and capped at the server
 * clock: the marker never moves back, and a future value would hide every later message from the unread count.
 */
export async function markRead(db: D1Database, conversationId: string, userId: string, at: string) {
  const now = new Date().toISOString();
  const parsed = Date.parse(at);
  const iso = Number.isFinite(parsed) ? new Date(parsed).toISOString() : now;
  const safeAt = iso < now ? iso : now;
  await db.prepare(`UPDATE chat_member SET last_read_at = MAX(COALESCE(last_read_at, ''), ?)
    WHERE conversation_id = ? AND user_id = ?`)
    .bind(safeAt, conversationId, userId)
    .run();
}

/**
 * Conversation ids an external agent acting for `actor` may read: groups and direct chats the actor is a member of,
 * plus task threads of tasks the actor can see. A direct chat with `agent_readable = 0` and anything archived is
 * never included. The fragment is a full `SELECT vc.id ...` so callers use it as `IN (...)`.
 */
export function agentVisibleConversationSql(actor: Actor): SqlFragment {
  const scope = taskScope(actor);
  return {
    sql: `SELECT vc.id FROM chat_conversation vc
      WHERE vc.organization_id = ? AND vc.archived_at IS NULL
        AND NOT (vc.kind = 'direct' AND vc.agent_readable = 0)
        AND (
          (vc.kind IN ('group', 'direct')
            AND EXISTS (SELECT 1 FROM chat_member vm WHERE vm.conversation_id = vc.id AND vm.user_id = ?))
          OR (vc.kind = 'task' AND vc.task_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM task tk LEFT JOIN lead l ON l.id = tk.lead_id WHERE tk.id = vc.task_id AND ${scope.sql}))
        )`,
    binds: [actor.organizationId, actor.id, ...scope.binds],
  };
}

export interface AgentConversationItem {
  id: string;
  kind: 'group' | 'direct' | 'task';
  title: string;
  unread: number;
  last_message_at: string | null;
}

export const AGENT_CONVERSATION_LIMIT = 200;

/** Every conversation the agent may read, newest first, with the actor's unread count, in one query. */
export async function agentVisibleConversations(db: D1Database, actor: Actor): Promise<AgentConversationItem[]> {
  const visible = agentVisibleConversationSql(actor);
  const rows = await db.prepare(`
    SELECT c.id, c.kind, c.last_message_at,
      CASE
        WHEN c.kind = 'direct' THEN COALESCE(
          (SELECT u.display_name FROM chat_member m2 JOIN app_user u ON u.id = m2.user_id
           WHERE m2.conversation_id = c.id AND m2.user_id <> ? LIMIT 1),
          (SELECT a.display_name FROM chat_agent_member cam JOIN chat_agent a ON a.id = cam.agent_id
           WHERE cam.conversation_id = c.id LIMIT 1),
          c.title, '')
        WHEN c.kind = 'task' THEN COALESCE((SELECT t.title FROM task t WHERE t.id = c.task_id), c.title, '')
        ELSE COALESCE(c.title, '')
      END AS title,
      CASE WHEN cm.user_id IS NULL THEN 0 ELSE (
        SELECT COUNT(*) FROM chat_message um
        WHERE um.conversation_id = c.id AND um.created_at > COALESCE(cm.last_read_at, '')
          AND um.author_user_id IS NOT ? AND um.deleted_at IS NULL
      ) END AS unread
    FROM chat_conversation c
    LEFT JOIN chat_member cm ON cm.conversation_id = c.id AND cm.user_id = ?
    WHERE c.id IN (${visible.sql})
    ORDER BY c.last_message_at IS NULL, c.last_message_at DESC, c.updated_at DESC, c.id DESC
    LIMIT ${AGENT_CONVERSATION_LIMIT}`)
    .bind(actor.id, actor.id, actor.id, ...visible.binds)
    .all<AgentConversationItem>();
  return rows.results;
}

/** One message as an external agent sees it. `text` is marked as chat data, and mention markup is rendered as names. */
export interface AgentMessageItem {
  id: string;
  conversation_id?: string;
  author: string | null;
  author_kind: 'user' | 'agent' | 'system';
  at: string;
  parent_id: string | null;
  text: string;
}

interface AgentMessageRow {
  id: string;
  conversation_id: string;
  author_kind: 'user' | 'agent' | 'system';
  author_name: string | null;
  created_at: string;
  parent_message_id: string | null;
  body: string;
}

const AGENT_MESSAGE_SELECT = `SELECT m.id, m.conversation_id, m.author_kind, m.created_at, m.parent_message_id, m.body,
    COALESCE(u.display_name, a.display_name) AS author_name
  FROM chat_message m
  LEFT JOIN app_user u ON u.id = m.author_user_id
  LEFT JOIN chat_agent a ON a.id = m.author_agent_id`;

function toAgentMessage(r: AgentMessageRow, withConversation: boolean): AgentMessageItem {
  return {
    id: r.id,
    ...(withConversation ? { conversation_id: r.conversation_id } : {}),
    author: r.author_name ?? (r.author_kind === 'agent' ? 'Trợ lý' : r.author_kind === 'system' ? 'Hệ thống' : null),
    author_kind: r.author_kind,
    at: r.created_at,
    parent_id: r.parent_message_id,
    text: `[chat] ${renderMentionText(r.body)}`,
  };
}

/** True when the agent acting for `actor` may read this conversation. */
export async function agentCanReadConversation(db: D1Database, actor: Actor, conversationId: string): Promise<boolean> {
  const visible = agentVisibleConversationSql(actor);
  const row = await db.prepare(`SELECT 1 AS ok FROM chat_conversation c WHERE c.id = ? AND c.id IN (${visible.sql})`)
    .bind(conversationId, ...visible.binds).first();
  return Boolean(row);
}

/**
 * Messages of one conversation, oldest first. Without `after` it is the newest `limit` before `before` (or now);
 * with `after` it is the oldest `limit` after that time. Deleted messages are left out. The caller checks access.
 */
export async function agentMessages(
  db: D1Database,
  conversationId: string,
  opts: { before?: string; after?: string; limit: number },
): Promise<AgentMessageItem[]> {
  const where = ['m.conversation_id = ?', 'm.deleted_at IS NULL'];
  const binds: unknown[] = [conversationId];
  if (opts.before) { where.push('m.created_at < ?'); binds.push(opts.before); }
  if (opts.after) { where.push('m.created_at > ?'); binds.push(opts.after); }
  const order = opts.after ? 'ASC' : 'DESC';
  const rows = await db.prepare(`${AGENT_MESSAGE_SELECT} WHERE ${where.join(' AND ')}
    ORDER BY m.created_at ${order}, m.id ${order} LIMIT ?`)
    .bind(...binds, opts.limit).all<AgentMessageRow>();
  const list = rows.results.map((r) => toAgentMessage(r, false));
  return opts.after ? list : list.reverse();
}

/**
 * Case-insensitive substring search over the conversations the agent may read, newest first, within `since`.
 * `instr` is used instead of LIKE because D1 caps LIKE patterns at 50 bytes.
 */
export async function agentSearchMessages(
  db: D1Database,
  actor: Actor,
  opts: { query: string; conversationId?: string; since: string; limit: number },
): Promise<AgentMessageItem[]> {
  const visible = agentVisibleConversationSql(actor);
  const rows = await db.prepare(`${AGENT_MESSAGE_SELECT}
    WHERE m.conversation_id IN (${visible.sql})${opts.conversationId ? ' AND m.conversation_id = ?' : ''}
      AND m.deleted_at IS NULL AND m.created_at >= ? AND instr(lower(m.body), lower(?)) > 0
    ORDER BY m.created_at DESC, m.id DESC LIMIT ?`)
    .bind(...visible.binds, ...(opts.conversationId ? [opts.conversationId] : []), opts.since, opts.query, opts.limit)
    .all<AgentMessageRow>();
  return rows.results.map((r) => toAgentMessage(r, true));
}

/**
 * Posts a comment in a task thread: filters mentions to people who can see the task, stores the message, adds the
 * author and mentioned people to the thread, tells their open tabs and notifies the mentioned people. Shared by the
 * web route and the MCP `comment_task` tool. The caller must already have checked `canSeeTask`.
 */
export async function postTaskComment(
  db: D1Database,
  sink: Sink,
  actor: Actor,
  taskId: string,
  input: { id: string; body: string; parentMessageId?: string | null; meta?: Record<string, unknown> | null },
): Promise<ApiResult<ChatMessageItem>> {
  const conversationId = await ensureTaskConversation(db, actor, taskId);
  const existingMembers = await memberIds(db, conversationId);
  const rawMentions = parseMentions(input.body).slice(0, 10);
  const mentions = await filterMentions(db, actor.organizationId, 'task', taskId, existingMembers, rawMentions);
  const result = await insertMessage(db, {
    id: input.id,
    conversationId,
    authorKind: 'user',
    authorUserId: actor.id,
    body: input.body,
    parentMessageId: input.parentMessageId ?? null,
    mentions,
    meta: input.meta ?? null,
  });
  if (result.ok && !result.data.duplicate) {
    const newMembers = [...new Set([actor.id, ...mentions])].filter((uid) => !existingMembers.includes(uid));
    if (newMembers.length > 0) {
      await addConversationMembers(db, conversationId, newMembers);
    }
    const recipients = [...new Set([...existingMembers, ...newMembers])];
    publish(sink, actor.organizationId, recipients, {
      type: 'message.created',
      conversationId,
      messageId: result.data.id,
    });
    const mentionUserIds = result.data.mentions.filter((uid) => uid !== actor.id);
    if (mentionUserIds.length > 0) {
      await notify(sink, {
        organizationId: actor.organizationId,
        userIds: mentionUserIds,
        kind: 'chat_mention',
        title: `${actor.displayName} đã nhắc đến bạn`,
        body: renderMentionText(result.data.body),
        link: `/tasks/${taskId}`,
        dedupeKey: `msg:${result.data.id}`,
      });
    }
  }
  return result;
}
