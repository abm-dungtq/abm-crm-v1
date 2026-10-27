import {
  MENTION_SOURCE,
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
  /** The one member the source mentions, when it mentions exactly one; otherwise null. */
  assigneeUserId: string | null;
  memberUserIds: string[];
  dueDate: null;
  source: TaskSourceRef;
}

const TITLE_MAX_CHARS = 200;
const DESCRIPTION_MAX_CHARS = 5000;
const THREAD_REPLY_LIMIT = 50;
/** Replies quoted in a thread draft's description, the newest ones. */
const DESCRIPTION_REPLY_LIMIT = 5;
const MEMBER_LIMIT = 20;

/** Joins the lines of a message into one line; whitespace around line breaks becomes one space. Linear: no regex backtracking. */
const flatten = (text: string) =>
  text.split(/[\r\n]+/).map((line) => line.trim()).filter(Boolean).join(' ');

/** A character allowed between addressed mentions: "@A, @B: …", "@A – …". */
const MENTION_GAP_CHAR = /[\s,:;–-]/u;
const SPACE_CHAR = /\s/u;
/** Trailing punctuation stripped from a title, one character at a time. */
const TRAILING_PUNCT_CHAR = /[\s.,!?;:…~]/u;
/**
 * Closing courtesy particles, stripped only as their own lower-case word at the end, so a capitalised name such as
 * "Gia Nha" is kept.
 */
const CLOSING_PARTICLES = ['ạ', 'nhé', 'nha'] as const;

interface MentionSpan { start: number; end: number; name: string }

function mentionSpans(line: string): MentionSpan[] {
  return [...line.matchAll(new RegExp(MENTION_SOURCE, 'gu'))].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    name: m[1]!,
  }));
}

/** The first index at or after `from` (or, going back, the end index at or before `from`) whose character is not in `set`. */
function skipForward(text: string, from: number, set: RegExp): number {
  let i = from;
  while (i < text.length && set.test(text[i]!)) i += 1;
  return i;
}
function skipBack(text: string, from: number, set: RegExp): number {
  let i = from;
  while (i > 0 && set.test(text[i - 1]!)) i -= 1;
  return i;
}

/**
 * Drops the mentions a line is addressed with (a run of mentions at its start or its end, with the separators between
 * them) and turns the mentions inside the sentence into plain names. One pass over the mention spans, so it is linear.
 */
function stripAddressedMentions(line: string): string {
  const spans = mentionSpans(line);
  let first = 0;
  let start = skipForward(line, 0, SPACE_CHAR);
  while (first < spans.length && spans[first]!.start === start) {
    start = skipForward(line, spans[first]!.end, MENTION_GAP_CHAR);
    first += 1;
  }
  let last = spans.length;
  let end = skipBack(line, line.length, SPACE_CHAR);
  while (last > first && spans[last - 1]!.end === end) {
    end = skipBack(line, spans[last - 1]!.start, MENTION_GAP_CHAR);
    last -= 1;
  }
  if (end <= start) return '';
  let out = '';
  let at = start;
  for (let i = first; i < last; i += 1) {
    const span = spans[i]!;
    out += line.slice(at, span.start) + span.name;
    at = span.end;
  }
  return out + line.slice(at, end);
}

/** Strips trailing punctuation and closing particles, repeatedly, by moving one end index: linear in the title. */
function stripTrailingNoise(title: string): string {
  let end = title.length;
  for (;;) {
    end = skipBack(title, end, TRAILING_PUNCT_CHAR);
    const particle = CLOSING_PARTICLES.find((p) =>
      end >= p.length
      && title.startsWith(p, end - p.length)
      && (end === p.length || SPACE_CHAR.test(title[end - p.length - 1]!)));
    if (!particle) return title.slice(0, end);
    end -= particle.length;
  }
}

/** Cuts to at most 200 characters on a word boundary, with `…` when cut. */
function capTitle(line: string): string {
  if (line.length <= TITLE_MAX_CHARS) return line;
  const head = line.slice(0, TITLE_MAX_CHARS - 1);
  const space = head.lastIndexOf(' ');
  return `${(space > 0 ? head.slice(0, space) : head).trimEnd()}…`;
}

/**
 * A task title from a raw message body: its first line with words, without the people it is addressed to (mentions at
 * the start or the end), with mentions inside the sentence kept as plain names, and without trailing punctuation or
 * closing particles ("ạ", "nhé", "nha"). "@Huy gửi báo giá giúp em nhé ạ." gives "Gửi báo giá giúp em".
 */
export function draftTitleFrom(body: string): string {
  const line = body
    .normalize('NFC')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.replace(new RegExp(MENTION_SOURCE, 'gu'), '').trim()) ?? '';
  const title = stripTrailingNoise(stripAddressedMentions(line).replace(/\s+/g, ' ').trim()).trim();
  if (!title) return 'Việc từ chat';
  const first = Array.from(title)[0]!;
  return capTitle(`${first.toLocaleUpperCase('vi-VN')}${title.slice(first.length)}`);
}

/** Root line first, then as many of the given reply lines as fit in 5000 characters; `…` marks dropped older replies. */
function threadDescription(rootLine: string, replyLines: string[], olderDropped: boolean): string {
  const full = [rootLine, ...(olderDropped ? ['…'] : []), ...replyLines].join('\n');
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
 * Builds the manual draft from a message (`scope 'message'`) or a thread in one `db.batch`. A thread draft describes the
 * root and its newest 5 replies; the people come from the mentions in the root and its newest 50 replies. The caller has already checked that the actor can read the conversation and that the message is a live
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
  // Every member the source mentions, the actor included, in order of first mention.
  const mentioned: string[] = [];
  for (const row of ordered) {
    for (const uid of row.mentions_json ? (JSON.parse(row.mentions_json) as string[]) : []) {
      if (memberSet.has(uid) && !mentioned.includes(uid)) mentioned.push(uid);
    }
  }
  const assigneeUserId = mentioned.length === 1 ? mentioned[0]! : null;
  const memberUserIds = mentioned.filter((uid) => uid !== actorId && uid !== assigneeUserId).slice(0, MEMBER_LIMIT);

  // "Name: text", one line per message. No timestamps: the task links back to the chat, where the times are.
  const lineOf = (row: DraftMessageRow) =>
    `${authorNameOrDefault(row.author_name, row.author_kind) ?? 'Nhân viên'}: ${flatten(renderMentionText(row.body))}`;
  const replies = ordered.slice(1);
  const quoted = replies.slice(-DESCRIPTION_REPLY_LIMIT).map(lineOf);
  const description = input.scope === 'message'
    ? renderMentionText(root.body).slice(0, DESCRIPTION_MAX_CHARS)
    : threadDescription(lineOf(root), quoted, replies.length > quoted.length);

  return {
    title: draftTitleFrom(root.body),
    description,
    assigneeUserId,
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
