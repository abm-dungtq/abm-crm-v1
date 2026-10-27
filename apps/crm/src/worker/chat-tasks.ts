import {
  authorNameOrDefault,
  insertMessage,
  publish,
  renderMentionText,
  type ChatConversationRow,
} from './chat';
import { afterThreadMessage } from './chat-threads';
import type { Actor, Sink } from './env';

export type TaskSourceScope = 'message' | 'thread';

/** Where a task made from chat came from: one message, or a whole thread (`messageId` is then the root). */
export interface TaskSourceRef {
  conversationId: string;
  messageId: string;
  scope: TaskSourceScope;
}

/** The editable draft the web shows before "Tạo việc" when no agent writes one. */
export interface ManualTaskDraft {
  title: string;
  description: string;
  assigneeUserId: null;
  memberUserIds: string[];
  dueDate: null;
  source: TaskSourceRef;
}

const TITLE_MAX_CHARS = 200;
const DESCRIPTION_MAX_CHARS = 5000;
const THREAD_REPLY_LIMIT = 50;
const MEMBER_LIMIT = 20;
const VN_OFFSET_MS = 7 * 3600_000;

const flatten = (text: string) => text.replace(/\s*[\r\n]+\s*/g, ' ').trim();

/** `HH:mm DD/MM` in Vietnam time (UTC+7, no daylight saving). */
function vnStamp(iso: string): string {
  const d = new Date(Date.parse(iso) + VN_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`;
}

/** First non-empty line, cut on a word boundary to at most 200 characters (with `…` when cut). */
export function draftTitleFrom(text: string): string {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
  if (!line) return 'Việc từ chat';
  if (line.length <= TITLE_MAX_CHARS) return line;
  const head = line.slice(0, TITLE_MAX_CHARS - 1);
  const space = head.lastIndexOf(' ');
  return `${(space > 0 ? head.slice(0, space) : head).trimEnd()}…`;
}

/** Root line first, then as many of the newest replies as fit in 5000 characters; `…` marks dropped older replies. */
function threadDescription(rootLine: string, replyLines: string[]): string {
  const full = [rootLine, ...replyLines].join('\n');
  if (full.length <= DESCRIPTION_MAX_CHARS) return full;
  const kept: string[] = [];
  let length = rootLine.length + 2; // the root line and the `…` line
  for (let i = replyLines.length - 1; i >= 0; i -= 1) {
    const line = replyLines[i]!;
    if (length + line.length + 1 > DESCRIPTION_MAX_CHARS) break;
    kept.unshift(line);
    length += line.length + 1;
  }
  return [rootLine, '…', ...kept].join('\n').slice(0, DESCRIPTION_MAX_CHARS);
}

interface DraftMessageRow {
  id: string;
  author_kind: 'user' | 'agent' | 'system';
  author_name: string | null;
  body: string;
  mentions_json: string | null;
  created_at: string;
}

/**
 * Builds the manual draft from a message (`scope 'message'`) or a thread (the root plus its newest 50 replies) in one
 * `db.batch`. The caller has already checked that the actor can read the conversation and that the message is a live
 * message of it (a top-level one for `scope 'thread'`). Null when the message is gone.
 */
export async function buildManualTaskDraft(
  db: D1Database,
  conversation: Pick<ChatConversationRow, 'id'>,
  input: { messageId: string; scope: TaskSourceScope },
  actorId: string,
): Promise<ManualTaskDraft | null> {
  const select = `SELECT m.id, m.author_kind, COALESCE(u.display_name, a.display_name) AS author_name, m.body, m.mentions_json, m.created_at
    FROM chat_message m
    LEFT JOIN app_user u ON u.id = m.author_user_id
    LEFT JOIN chat_agent a ON a.id = m.author_agent_id`;
  const messagesStatement = input.scope === 'message'
    ? db.prepare(`${select} WHERE m.id = ?1 AND m.conversation_id = ?2 AND m.deleted_at IS NULL`)
      .bind(input.messageId, conversation.id)
    // The root first, then the newest replies; reordered oldest first below.
    : db.prepare(`${select}
        WHERE m.conversation_id = ?2 AND m.deleted_at IS NULL AND (m.id = ?1 OR m.thread_root_id = ?1)
        ORDER BY (m.id = ?1) DESC, m.created_at DESC, m.id DESC
        LIMIT ?3`)
      .bind(input.messageId, conversation.id, THREAD_REPLY_LIMIT + 1);
  const [messagesRes, membersRes] = await db.batch([
    messagesStatement,
    db.prepare('SELECT user_id FROM chat_member WHERE conversation_id = ?').bind(conversation.id),
  ]);
  const rows = (messagesRes?.results ?? []) as DraftMessageRow[];
  const root = rows[0];
  if (!root || root.id !== input.messageId) return null;
  const ordered = [root, ...rows.slice(1).reverse()];

  const memberSet = new Set(((membersRes?.results ?? []) as { user_id: string }[]).map((r) => r.user_id));
  const memberUserIds: string[] = [];
  for (const row of ordered) {
    for (const uid of row.mentions_json ? (JSON.parse(row.mentions_json) as string[]) : []) {
      if (uid !== actorId && memberSet.has(uid) && !memberUserIds.includes(uid) && memberUserIds.length < MEMBER_LIMIT) {
        memberUserIds.push(uid);
      }
    }
  }

  const rootText = renderMentionText(root.body);
  const lineOf = (row: DraftMessageRow) =>
    `${vnStamp(row.created_at)} ${authorNameOrDefault(row.author_name, row.author_kind) ?? 'Nhân viên'}: ${flatten(renderMentionText(row.body))}`;
  const description = input.scope === 'message'
    ? rootText.slice(0, DESCRIPTION_MAX_CHARS)
    : threadDescription(lineOf(root), ordered.slice(1).map(lineOf));

  return {
    title: draftTitleFrom(rootText),
    description,
    assigneeUserId: null,
    memberUserIds,
    dueDate: null,
    source: { conversationId: conversation.id, messageId: input.messageId, scope: input.scope },
  };
}

/**
 * Where a message about a source goes (the task card, the agent's draft): into the thread for `scope 'thread'`; for
 * `scope 'message'` a quote reply to the source, inside the source's thread when it is a thread reply. In topic mode a
 * top-level source is a topic, and the main flow takes no quote replies there, so the message goes into that topic.
 */
export function sourcePlacement(
  source: Pick<TaskSourceRef, 'messageId' | 'scope'>,
  sourceThreadRootId: string | null,
  mode: 'chat' | 'topic',
): { replyToMessageId: string | null; threadRootId: string | null } {
  if (source.scope === 'thread') return { replyToMessageId: null, threadRootId: source.messageId };
  if (sourceThreadRootId) return { replyToMessageId: source.messageId, threadRootId: sourceThreadRootId };
  if (mode === 'topic') return { replyToMessageId: null, threadRootId: source.messageId };
  return { replyToMessageId: source.messageId, threadRootId: null };
}

export interface TaskCardInput {
  taskId: string;
  title: string;
  assigneeName: string | null;
  dueAt: string | null;
  source: TaskSourceRef;
}

/**
 * Posts the "Đã tạo việc" card where the task came from: into the thread for `scope 'thread'`; as a quote reply to the
 * source for `scope 'message'`, inside the source's thread when the source is a thread reply. The id is fixed by the
 * task, so the card exists once. Never throws; a failure logs only the task id.
 */
export async function postTaskCard(sink: Sink, db: D1Database, actor: Actor, input: TaskCardInput): Promise<void> {
  try {
    const { source } = input;
    const [sourceRes, membersRes] = await db.batch([
      db.prepare(`
        SELECT m.thread_root_id, c.organization_id, c.mode, r.author_kind AS root_author_kind, r.author_user_id AS root_author_user_id
        FROM chat_message m
        JOIN chat_conversation c ON c.id = m.conversation_id
        LEFT JOIN chat_message r ON r.id = COALESCE(m.thread_root_id, m.id)
        WHERE m.id = ? AND m.conversation_id = ?`)
        .bind(source.messageId, source.conversationId),
      db.prepare('SELECT user_id FROM chat_member WHERE conversation_id = ?').bind(source.conversationId),
    ]);
    const row = (sourceRes?.results?.[0] ?? null) as {
      thread_root_id: string | null;
      organization_id: string;
      mode: 'chat' | 'topic';
      root_author_kind: string | null;
      root_author_user_id: string | null;
    } | null;
    if (!row || row.organization_id !== actor.organizationId) throw new Error('source missing');
    const memberIds = ((membersRes?.results ?? []) as { user_id: string }[]).map((r) => r.user_id);

    const { replyToMessageId, threadRootId } = sourcePlacement(source, row.thread_root_id, row.mode);
    const inserted = await insertMessage(db, {
      id: `task-card:${input.taskId}`,
      conversationId: source.conversationId,
      authorKind: 'system',
      body: `Đã tạo việc: ${input.title}`,
      replyToMessageId,
      threadRootId,
      meta: {
        taskCard: {
          taskId: input.taskId,
          title: input.title,
          assigneeName: input.assigneeName,
          dueAt: input.dueAt,
          createdByName: actor.displayName,
        },
      },
    });
    if (!inserted.ok) throw new Error(inserted.error.code);
    if (inserted.data.duplicate) return;

    if (threadRootId) {
      await afterThreadMessage(sink, db, {
        organizationId: row.organization_id,
        conversationId: source.conversationId,
        rootId: threadRootId,
        rootAuthorUserId: row.root_author_kind === 'user' ? row.root_author_user_id : null,
        isTopic: row.mode === 'topic',
        message: inserted.data,
        authorUserId: null,
        mentionIds: [],
        memberIds,
      });
    } else {
      publish(sink, row.organization_id, memberIds, {
        type: 'message.created',
        conversationId: source.conversationId,
        messageId: inserted.data.id,
      });
    }
  } catch {
    // Only the task id: the error may quote chat text.
    console.error('task_card_failed', input.taskId);
  }
}
