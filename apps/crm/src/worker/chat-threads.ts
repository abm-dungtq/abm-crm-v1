import {
  authorNameOrDefault,
  clampReadAt,
  conversationTitleSql,
  hydrateMessages,
  loadConversation,
  MESSAGE_ROW_SELECT,
  publish,
  renderMentionText,
  type ChatConversationRow,
  type ChatMessageItem,
  type MessageRow,
} from './chat';
import type { Actor, Sink } from './env';

/** The thread card under a root message, and the per-follower state of the reader. */
export interface ThreadSummary {
  rootId: string;
  conversationId: string;
  replyCount: number;
  lastReplyAt: string | null;
  lastActivityAt: string;
  isTopic: boolean;
  closed: boolean;
  closedAt: string | null;
  /** Up to 3 people who replied, newest reply first. */
  repliers: { userId: string; name: string }[];
  /** Up to 3 latest replies, newest first. */
  latest: { id: string; authorName: string | null; snippet: string; createdAt: string }[];
  following: boolean;
  muted: boolean;
  /** Replies by others after the reader's thread read marker; 0 when the reader does not follow. */
  unread: number;
}

/** One row of the "Chuỗi" tab. */
export type FollowedThreadItem = ThreadSummary & {
  conversationTitle: string;
  conversationKind: 'group' | 'direct';
  rootAuthorName: string | null;
  rootSnippet: string;
  rootDeleted: boolean;
};

export interface ThreadPage {
  root: ChatMessageItem;
  thread: ThreadSummary | null;
  /** Oldest first. */
  replies: ChatMessageItem[];
  hasMore: boolean;
}

export type ThreadSubscriptionState = 'following' | 'muted' | 'none';

const SNIPPET_MAX_CHARS = 120;
const snippetOf = (body: string) => renderMentionText(body).slice(0, SNIPPET_MAX_CHARS);

interface AfterThreadMessageInput {
  organizationId: string;
  conversationId: string;
  rootId: string;
  /** The root's author when it is a user; null for agent or system roots. */
  rootAuthorUserId: string | null;
  isTopic: boolean;
  message: Pick<ChatMessageItem, 'id' | 'createdAt' | 'alsoInMain'>;
  /** The replying user; null for agent and system messages, which follow nothing. */
  authorUserId: string | null;
  mentionIds: string[];
  memberIds: string[];
}

/**
 * Records a stored thread reply in ONE `db.batch`: creates the thread row if needed, bumps the counters, adds the
 * automatic followers (root author still in the conversation, the replier, mentioned people, and in a direct chat
 * every member on the first reply), marks the thread read
 * for the replier and reads the unmuted followers who are still members. Then tells the members' open tabs.
 * Returns the unmuted follower ids (the author included); the caller decides who is notified.
 */
export async function afterThreadMessage(sink: Sink, db: D1Database, input: AfterThreadMessageInput): Promise<string[]> {
  const now = new Date().toISOString();
  const at = input.message.createdAt;
  // A mentioned newcomer has read everything before the mentioning reply, so that reply and later ones are unread.
  const justBefore = new Date(Date.parse(at) - 1).toISOString();
  const memberSet = new Set(input.memberIds);
  const followers: { u: string; v: 'author' | 'reply' | 'mention'; r: string | null }[] = [];
  const seen = new Set<string>();
  const addFollower = (userId: string | null, via: 'author' | 'reply' | 'mention') => {
    if (!userId || seen.has(userId)) return;
    seen.add(userId);
    followers.push({ u: userId, v: via, r: via === 'mention' ? justBefore : null });
  };
  if (input.rootAuthorUserId && memberSet.has(input.rootAuthorUserId)) addFollower(input.rootAuthorUserId, 'author');
  addFollower(input.authorUserId, 'reply');
  for (const uid of input.mentionIds) addFollower(uid, 'mention');

  const statements: D1PreparedStatement[] = [
    db.prepare(`INSERT OR IGNORE INTO chat_thread (root_message_id, conversation_id, is_topic, reply_count, last_activity_at, created_at)
      VALUES (?, ?, ?, 0, ?, ?)`)
      .bind(input.rootId, input.conversationId, input.isTopic ? 1 : 0, at, now),
    db.prepare('UPDATE chat_thread SET reply_count = reply_count + 1, last_reply_at = ?, last_activity_at = ? WHERE root_message_id = ?')
      .bind(at, at, input.rootId),
  ];
  if (followers.length > 0) {
    statements.push(
      db.prepare(`INSERT OR IGNORE INTO chat_thread_follower (root_message_id, user_id, via, muted, last_read_at, followed_at)
        SELECT ?1, json_extract(value, '$.u'), json_extract(value, '$.v'), 0, json_extract(value, '$.r'), ?2 FROM json_each(?3)`)
        .bind(input.rootId, now, JSON.stringify(followers)),
    );
  }
  // In a direct chat both people follow from the first reply on, so a thread-only reply always reaches the other one.
  // Only on the first reply ever, so someone who unfollowed later is not added back.
  statements.push(
    db.prepare(`INSERT OR IGNORE INTO chat_thread_follower (root_message_id, user_id, via, muted, last_read_at, followed_at)
      SELECT ?1, cm.user_id, CASE WHEN cm.user_id IS ?2 THEN 'reply' ELSE 'author' END, 0, NULL, ?3
      FROM chat_member cm
      JOIN chat_conversation c ON c.id = cm.conversation_id AND c.kind = 'direct'
      WHERE cm.conversation_id = ?4
        AND NOT EXISTS (SELECT 1 FROM chat_message r WHERE r.thread_root_id = ?1 AND r.id <> ?5)`)
      .bind(input.rootId, input.authorUserId, now, input.conversationId, input.message.id),
  );
  if (input.authorUserId) {
    statements.push(
      db.prepare(`UPDATE chat_thread_follower SET last_read_at = MAX(COALESCE(last_read_at, ''), ?)
        WHERE root_message_id = ? AND user_id = ?`)
        .bind(at, input.rootId, input.authorUserId),
    );
  }
  statements.push(
    db.prepare(`SELECT f.user_id FROM chat_thread_follower f
      JOIN chat_member cm ON cm.conversation_id = ? AND cm.user_id = f.user_id
      WHERE f.root_message_id = ? AND f.muted = 0`)
      .bind(input.conversationId, input.rootId),
  );
  const results = await db.batch(statements);
  const followerIds = ((results[results.length - 1]?.results ?? []) as { user_id: string }[]).map((r) => r.user_id);

  publish(sink, input.organizationId, input.memberIds, {
    type: 'thread.updated',
    conversationId: input.conversationId,
    rootId: input.rootId,
    messageId: input.message.id,
  });
  if (input.message.alsoInMain) {
    publish(sink, input.organizationId, input.memberIds, {
      type: 'message.created',
      conversationId: input.conversationId,
      messageId: input.message.id,
    });
  }
  return followerIds;
}

/**
 * A new top-level message in a topic-mode conversation starts a topic: its thread row (no replies yet) and the
 * followers, the author first, then the mentioned people. Run the statements in one `db.batch` after the insert.
 */
export function startTopicStatements(
  db: D1Database,
  input: { conversationId: string; rootId: string; authorUserId: string; mentionIds: string[]; now: string },
): D1PreparedStatement[] {
  const followers = [
    { u: input.authorUserId, v: 'author' },
    ...[...new Set(input.mentionIds)].filter((uid) => uid !== input.authorUserId).map((uid) => ({ u: uid, v: 'mention' })),
  ];
  return [
    db.prepare(`INSERT OR IGNORE INTO chat_thread (root_message_id, conversation_id, is_topic, reply_count, last_activity_at, created_at)
      VALUES (?, ?, 1, 0, ?, ?)`)
      .bind(input.rootId, input.conversationId, input.now, input.now),
    db.prepare(`INSERT OR IGNORE INTO chat_thread_follower (root_message_id, user_id, via, muted, last_read_at, followed_at)
      SELECT ?1, json_extract(value, '$.u'), json_extract(value, '$.v'), 0, NULL, ?2 FROM json_each(?3)`)
      .bind(input.rootId, input.now, JSON.stringify(followers)),
  ];
}

/**
 * One page of a conversation's topics: top-level messages (user or agent) that quote nothing, latest activity first.
 * `before` is an activity timestamp from the previous page. Each item carries its thread summary.
 */
export async function listTopics(
  db: D1Database,
  actorId: string,
  conversationId: string,
  opts: { before?: string; limit?: number } = {},
): Promise<ChatMessageItem[]> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 50);
  const where = ['m.conversation_id = ?', 'm.thread_root_id IS NULL', 'm.reply_to_message_id IS NULL', "m.author_kind IN ('user', 'agent')"];
  const binds: unknown[] = [conversationId];
  if (opts.before) { where.push('COALESCE(t.last_activity_at, m.created_at) < ?'); binds.push(opts.before); }
  const rows = await db.prepare(`${MESSAGE_ROW_SELECT}
    LEFT JOIN chat_thread t ON t.root_message_id = m.id
    WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(t.last_activity_at, m.created_at) DESC, m.id DESC
    LIMIT ?`)
    .bind(...binds, limit)
    .all<MessageRow>();
  return hydrateMessages(db, actorId, rows.results);
}

/**
 * Closes or reopens a thread. Only a topic can be closed: a thread marked as a topic, or any thread root of a
 * conversation now in topic mode (messages from before the switch included; a root without replies gets its thread
 * row here). Reopening is always allowed. Returns the summary for the actor (null when the root has no thread row), or
 * a Vietnamese error message.
 */
export async function setThreadClosed(
  db: D1Database,
  actorId: string,
  root: { id: string; conversation_id: string },
  conversation: Pick<ChatConversationRow, 'mode'>,
  closed: boolean,
): Promise<{ ok: true; thread: ThreadSummary | null } | { ok: false; message: string }> {
  const now = new Date().toISOString();
  const rootId = root.id;
  if (closed) {
    const closeStatement = db.prepare(`UPDATE chat_thread SET closed_at = COALESCE(closed_at, ?1), closed_by_user_id = COALESCE(closed_by_user_id, ?2)
      WHERE root_message_id = ?3 AND (is_topic = 1 OR ?4 = 1)`)
      .bind(now, actorId, rootId, conversation.mode === 'topic' ? 1 : 0);
    const results = conversation.mode === 'topic'
      ? await db.batch([
        db.prepare(`INSERT OR IGNORE INTO chat_thread (root_message_id, conversation_id, is_topic, reply_count, last_activity_at, created_at)
          VALUES (?, ?, 1, 0, ?, ?)`)
          .bind(rootId, root.conversation_id, now, now),
        closeStatement,
      ])
      : [await closeStatement.run()];
    if ((results[results.length - 1]?.meta?.changes ?? 0) === 0) return { ok: false, message: 'Chỉ đóng được chủ đề' };
  } else {
    await db.prepare('UPDATE chat_thread SET closed_at = NULL, closed_by_user_id = NULL WHERE root_message_id = ?')
      .bind(rootId)
      .run();
  }
  const summaries = await loadThreadSummaries(db, actorId, [rootId]);
  return { ok: true, thread: summaries.get(rootId) ?? null };
}

/**
 * The three reads behind thread summaries (thread rows with the reader's follow state, the latest 3 replies, the
 * repliers), each restricted to `rootIds`. Run them in one `db.batch` and pass the results to `buildThreadSummaries`.
 */
export function threadSummaryStatements(db: D1Database, actorId: string | null, rootIds: string[]): D1PreparedStatement[] {
  const ids = JSON.stringify(rootIds);
  return [
    db.prepare(`
      SELECT t.root_message_id, t.conversation_id, t.is_topic, t.reply_count, t.last_reply_at, t.last_activity_at, t.closed_at,
        f.user_id AS follower_id, f.muted,
        CASE WHEN f.user_id IS NULL THEN 0 ELSE (
          SELECT COUNT(*) FROM chat_message r
          WHERE r.thread_root_id = t.root_message_id
            AND r.created_at > COALESCE(f.last_read_at, '')
            AND r.author_user_id IS NOT ?2
            AND r.deleted_at IS NULL
        ) END AS unread
      FROM chat_thread t
      LEFT JOIN chat_thread_follower f ON f.root_message_id = t.root_message_id AND f.user_id = ?2
      WHERE t.root_message_id IN (SELECT value FROM json_each(?1))`)
      .bind(ids, actorId),
    db.prepare(`
      SELECT id, thread_root_id, author_kind, body, created_at, author_name FROM (
        SELECT r.id, r.thread_root_id, r.author_kind, r.body, r.created_at,
          COALESCE(u.display_name, a.display_name) AS author_name,
          ROW_NUMBER() OVER (PARTITION BY r.thread_root_id ORDER BY r.created_at DESC, r.id DESC) AS rn
        FROM chat_message r
        LEFT JOIN app_user u ON u.id = r.author_user_id
        LEFT JOIN chat_agent a ON a.id = r.author_agent_id
        WHERE r.thread_root_id IN (SELECT value FROM json_each(?)) AND r.deleted_at IS NULL
      ) WHERE rn <= 3
      ORDER BY created_at DESC, id DESC`)
      .bind(ids),
    db.prepare(`
      SELECT r.thread_root_id, r.author_user_id, u.display_name, MAX(r.created_at) AS at
      FROM chat_message r
      JOIN app_user u ON u.id = r.author_user_id
      WHERE r.thread_root_id IN (SELECT value FROM json_each(?)) AND r.author_kind = 'user' AND r.deleted_at IS NULL
      GROUP BY r.thread_root_id, r.author_user_id
      ORDER BY at DESC`)
      .bind(ids),
  ];
}

/** Builds the summaries from the results of `threadSummaryStatements`, in that order. */
export function buildThreadSummaries(results: D1Result[]): Map<string, ThreadSummary> {
  const [threadRes, latestRes, replierRes] = results;
  const map = new Map<string, ThreadSummary>();
  for (const t of (threadRes?.results ?? []) as {
    root_message_id: string;
    conversation_id: string;
    is_topic: number;
    reply_count: number;
    last_reply_at: string | null;
    last_activity_at: string;
    closed_at: string | null;
    follower_id: string | null;
    muted: number | null;
    unread: number;
  }[]) {
    map.set(t.root_message_id, {
      rootId: t.root_message_id,
      conversationId: t.conversation_id,
      replyCount: t.reply_count,
      lastReplyAt: t.last_reply_at,
      lastActivityAt: t.last_activity_at,
      isTopic: t.is_topic === 1,
      closed: t.closed_at !== null,
      closedAt: t.closed_at,
      repliers: [],
      latest: [],
      following: t.follower_id !== null,
      muted: t.muted === 1,
      unread: t.unread,
    });
  }
  for (const r of (latestRes?.results ?? []) as {
    id: string;
    thread_root_id: string;
    author_kind: 'user' | 'agent' | 'system';
    body: string;
    created_at: string;
    author_name: string | null;
  }[]) {
    map.get(r.thread_root_id)?.latest.push({
      id: r.id,
      authorName: authorNameOrDefault(r.author_name, r.author_kind),
      snippet: snippetOf(r.body),
      createdAt: r.created_at,
    });
  }
  for (const r of (replierRes?.results ?? []) as {
    thread_root_id: string;
    author_user_id: string;
    display_name: string;
  }[]) {
    const summary = map.get(r.thread_root_id);
    if (summary && summary.repliers.length < 3) summary.repliers.push({ userId: r.author_user_id, name: r.display_name });
  }
  return map;
}

/** Thread summaries of `rootIds` for `actorId`, in one `db.batch`; no query when `rootIds` is empty. */
export async function loadThreadSummaries(
  db: D1Database,
  actorId: string | null,
  rootIds: string[],
): Promise<Map<string, ThreadSummary>> {
  if (rootIds.length === 0) return new Map();
  return buildThreadSummaries(await db.batch(threadSummaryStatements(db, actorId, rootIds)));
}

/**
 * A top-level message the actor can read, with its conversation. Null when the message is missing, is itself a
 * thread reply, or its conversation is out of reach.
 */
export async function resolveThreadRoot(
  db: D1Database,
  actor: Actor,
  rootId: string,
): Promise<{ root: MessageRow; conversation: ChatConversationRow } | null> {
  const root = await db.prepare(`${MESSAGE_ROW_SELECT} WHERE m.id = ?`).bind(rootId).first<MessageRow>();
  if (!root || root.thread_root_id !== null) return null;
  const conversation = await loadConversation(db, actor, root.conversation_id);
  if (!conversation) return null;
  return { root, conversation };
}

/** The root and one page of its replies (newest `limit` before `before`, returned oldest first). */
export async function getThread(
  db: D1Database,
  actor: Actor,
  rootId: string,
  opts: { before?: string; limit?: number } = {},
): Promise<ThreadPage | null> {
  const resolved = await resolveThreadRoot(db, actor, rootId);
  if (!resolved) return null;
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const where = ['m.thread_root_id = ?'];
  const binds: unknown[] = [rootId];
  if (opts.before) { where.push('m.created_at < ?'); binds.push(opts.before); }
  const replies = await db.prepare(`${MESSAGE_ROW_SELECT}
    WHERE ${where.join(' AND ')}
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT ?`)
    .bind(...binds, limit)
    .all<MessageRow>();
  const hasMore = replies.results.length === limit;
  const [root, ...items] = await hydrateMessages(db, actor.id, [resolved.root, ...replies.results.reverse()]);
  return { root: root!, thread: root!.thread, replies: items, hasMore };
}

/** Threads the actor follows (muted included) in conversations they still belong to, newest activity first. */
export async function listFollowedThreads(
  db: D1Database,
  actor: Actor,
  opts: { before?: string; limit?: number } = {},
): Promise<FollowedThreadItem[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 50);
  const rows = await db.prepare(`
    SELECT t.root_message_id, c.kind AS conversation_kind,
      ${conversationTitleSql('c', '?1')} AS conversation_title,
      r.author_kind, r.body, r.deleted_at, COALESCE(u.display_name, a.display_name) AS root_author_name
    FROM chat_thread_follower f
    JOIN chat_thread t ON t.root_message_id = f.root_message_id
    JOIN chat_conversation c ON c.id = t.conversation_id AND c.archived_at IS NULL AND c.organization_id = ?2
    JOIN chat_member cm ON cm.conversation_id = c.id AND cm.user_id = f.user_id
    JOIN chat_message r ON r.id = t.root_message_id
    LEFT JOIN app_user u ON u.id = r.author_user_id
    LEFT JOIN chat_agent a ON a.id = r.author_agent_id
    WHERE f.user_id = ?1 AND c.kind IN ('group', 'direct')${opts.before ? ' AND t.last_activity_at < ?4' : ''}
    ORDER BY t.last_activity_at DESC, t.root_message_id DESC
    LIMIT ?3`)
    .bind(actor.id, actor.organizationId, limit, ...(opts.before ? [opts.before] : []))
    .all<{
      root_message_id: string;
      conversation_kind: 'group' | 'direct';
      conversation_title: string;
      author_kind: 'user' | 'agent' | 'system';
      body: string;
      deleted_at: string | null;
      root_author_name: string | null;
    }>();
  const summaries = await loadThreadSummaries(db, actor.id, rows.results.map((r) => r.root_message_id));
  const items: FollowedThreadItem[] = [];
  for (const r of rows.results) {
    const summary = summaries.get(r.root_message_id);
    if (!summary) continue;
    const rootDeleted = r.deleted_at !== null;
    items.push({
      ...summary,
      conversationTitle: r.conversation_title,
      conversationKind: r.conversation_kind,
      rootAuthorName: authorNameOrDefault(r.root_author_name, r.author_kind),
      rootSnippet: rootDeleted ? '' : snippetOf(r.body),
      rootDeleted,
    });
  }
  return items;
}

/** Moves the follower's thread read marker forward (never back), clamped like the conversation marker. */
export async function markThreadRead(db: D1Database, rootId: string, userId: string, at: string): Promise<void> {
  await db.prepare(`UPDATE chat_thread_follower SET last_read_at = MAX(COALESCE(last_read_at, ''), ?)
    WHERE root_message_id = ? AND user_id = ?`)
    .bind(clampReadAt(at), rootId, userId)
    .run();
}

/**
 * Follows, mutes or unfollows a thread in one batch. Following a root without replies creates its thread row. A new
 * follower starts with the replies so far read.
 * Only the person's own choice (`explicit: true`, the subscription route) changes the mute of an existing follower;
 * an automatic follow (asking the agent for a draft) adds the row when missing and leaves a muted thread muted.
 * The caller has checked that `root` is a top-level message of a group or direct chat the actor belongs to.
 */
export async function setThreadSubscription(
  db: D1Database,
  actor: Actor,
  root: { id: string; conversation_id: string },
  conversation: Pick<ChatConversationRow, 'mode'>,
  state: ThreadSubscriptionState,
  opts: { explicit?: boolean } = {},
): Promise<{ rootId: string; following: boolean; muted: boolean }> {
  if (state === 'none') {
    await db.prepare('DELETE FROM chat_thread_follower WHERE root_message_id = ? AND user_id = ?')
      .bind(root.id, actor.id).run();
    return { rootId: root.id, following: false, muted: false };
  }
  const now = new Date().toISOString();
  const muted = state === 'muted' ? 1 : 0;
  const statements = [
    db.prepare(`INSERT OR IGNORE INTO chat_thread (root_message_id, conversation_id, is_topic, reply_count, last_activity_at, created_at)
      VALUES (?, ?, ?, 0, ?, ?)`)
      .bind(root.id, root.conversation_id, conversation.mode === 'topic' ? 1 : 0, now, now),
    // A new manual follower starts with everything so far read; an existing follower keeps their read marker.
    db.prepare(`INSERT OR IGNORE INTO chat_thread_follower (root_message_id, user_id, via, muted, last_read_at, followed_at)
      VALUES (?, ?, 'manual', ?, ?, ?)`)
      .bind(root.id, actor.id, muted, now, now),
  ];
  if (opts.explicit) {
    statements.push(db.prepare('UPDATE chat_thread_follower SET muted = ? WHERE root_message_id = ? AND user_id = ?')
      .bind(muted, root.id, actor.id));
  }
  statements.push(db.prepare('SELECT muted FROM chat_thread_follower WHERE root_message_id = ? AND user_id = ?')
    .bind(root.id, actor.id));
  const results = await db.batch(statements);
  const row = (results[results.length - 1]?.results?.[0] ?? null) as { muted: number } | null;
  return { rootId: root.id, following: true, muted: (row?.muted ?? muted) === 1 };
}
