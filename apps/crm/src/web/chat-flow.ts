/** Pure helpers for laying out a message list: day separators, the "Tin mới" divider and author grouping. */
import type { ChatMessage } from './types';

const TZ = 'Asia/Ho_Chi_Minh';
const DAY_MS = 86_400_000;
/** Messages from one author this close together share one avatar and name. */
export const GROUP_WINDOW_MS = 5 * 60_000;

const dayKeyFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "YYYY-MM-DD" of the Vietnam calendar day `iso` falls on; empty for a bad date. */
export function vnDayKey(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return Number.isNaN(d.getTime()) ? '' : dayKeyFormat.format(d);
}

/** "HH:mm" in Vietnam time; empty for a bad date. */
export function vnTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : timeFormat.format(d);
}

/** "Hôm nay", "Hôm qua", otherwise "dd/MM/yyyy", by the Vietnam calendar day. */
export function chatDayLabel(iso: string, now: Date = new Date()): string {
  const key = vnDayKey(iso);
  if (!key) return '';
  if (key === vnDayKey(now)) return 'Hôm nay';
  if (key === vnDayKey(new Date(now.getTime() - DAY_MS))) return 'Hôm qua';
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
}

const isOwn = (m: ChatMessage, actorId: string) => m.authorKind === 'user' && m.authorUserId === actorId;

/**
 * The first message from someone else written after `lastReadAt`: the "Tin mới" divider goes above it. With no read
 * marker every message from someone else is new. Null when nothing qualifies.
 */
export function firstNewMessageId(
  messages: readonly ChatMessage[],
  lastReadAt: string | null,
  actorId: string,
): string | null {
  const readAt = lastReadAt ? Date.parse(lastReadAt) : Number.NEGATIVE_INFINITY;
  if (Number.isNaN(readAt)) return null;
  const first = messages.find((m) => !isOwn(m, actorId) && Date.parse(m.createdAt) > readAt);
  return first?.id ?? null;
}

/** True when `b` is written by the same person or agent as `a`; system messages never group. */
function sameAuthor(a: ChatMessage, b: ChatMessage): boolean {
  if (a.authorKind !== b.authorKind) return false;
  if (a.authorKind === 'user') return a.authorUserId !== null && a.authorUserId === b.authorUserId;
  if (a.authorKind === 'agent') return a.authorAgentId !== null && a.authorAgentId === b.authorAgentId;
  return false;
}

export type ChatFlowItem =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'new'; key: string }
  | { kind: 'message'; key: string; message: ChatMessage; continued: boolean; endsRun: boolean };

type MessageFlowItem = Extract<ChatFlowItem, { kind: 'message' }>;

/**
 * The rows of a message list, oldest first: a day separator before each new Vietnam day, the "Tin mới" divider before
 * `newMessageId`, and each message marked `continued` when it follows a message by the same author within 5 minutes
 * with no separator between them. `endsRun` marks the last message of such a run (the next one is not continued), where
 * the time is shown once for the whole run.
 */
export function buildChatFlow(
  messages: readonly ChatMessage[],
  options: { newMessageId?: string | null; now?: Date } = {},
): ChatFlowItem[] {
  const now = options.now ?? new Date();
  const items: ChatFlowItem[] = [];
  let previous: ChatMessage | null = null;
  let previousItem: MessageFlowItem | null = null;
  let previousDay = '';
  for (const m of messages) {
    const day = vnDayKey(m.createdAt);
    let separated = false;
    if (day && day !== previousDay) {
      items.push({ kind: 'day', key: `day:${day}`, label: chatDayLabel(m.createdAt, now) });
      previousDay = day;
      separated = true;
    }
    if (options.newMessageId && m.id === options.newMessageId) {
      items.push({ kind: 'new', key: 'new-divider' });
      separated = true;
    }
    const gap = previous ? Date.parse(m.createdAt) - Date.parse(previous.createdAt) : Number.NaN;
    const continued = Boolean(
      previous && !separated && sameAuthor(previous, m) && gap >= 0 && gap <= GROUP_WINDOW_MS,
    );
    if (previousItem && continued) previousItem.endsRun = false;
    const item: MessageFlowItem = { kind: 'message', key: m.id, message: m, continued, endsRun: true };
    items.push(item);
    previous = m;
    previousItem = item;
  }
  return items;
}

/**
 * A thread laid out as one flow over the root and its replies, split where the reply count sits between them: one day
 * label per day across both parts, and the first reply starts a fresh run because the count line separates it.
 */
export function buildThreadFlow(
  root: ChatMessage,
  replies: readonly ChatMessage[],
  options: { now?: Date } = {},
): { rootItems: ChatFlowItem[]; replyItems: ChatFlowItem[] } {
  const items = buildChatFlow([root, ...replies], options);
  const split = items.findIndex((item) => item.kind === 'message' && item.message.id === root.id) + 1;
  const rootItems = items.slice(0, split);
  const replyItems = items.slice(split);
  const rootItem = rootItems.at(-1);
  if (rootItem?.kind === 'message') rootItem.endsRun = true;
  const firstReply = replyItems.find((item): item is MessageFlowItem => item.kind === 'message');
  if (firstReply) firstReply.continued = false;
  return { rootItems, replyItems };
}
