/** Pure helpers for chat deep links, thread cards and the thread panel. */

const SEARCH_VALUE_MAX = 64;
const TZ = 'Asia/Ho_Chi_Minh';

export interface ChatSearch {
  /** Root message id of the open thread panel. */
  thread?: string;
  /** Message to jump to and highlight. */
  message?: string;
}

/** `/chat/<id>`, plus `?thread=<root>` and/or `?message=<id>`. */
export function chatLink({
  conversationId,
  threadRootId,
  messageId,
}: {
  conversationId: string;
  threadRootId?: string | null;
  messageId?: string | null;
}): string {
  const params = new URLSearchParams();
  if (threadRootId) params.set('thread', threadRootId);
  if (messageId) params.set('message', messageId);
  const query = params.toString();
  return `/chat/${encodeURIComponent(conversationId)}${query ? `?${query}` : ''}`;
}

function searchValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= SEARCH_VALUE_MAX ? trimmed : undefined;
}

/** Reads `thread` and `message` from the route search; empty, non-string or over-long values are dropped. */
export function parseChatSearch(search: Record<string, unknown> | null | undefined): ChatSearch {
  const result: ChatSearch = {};
  const thread = searchValue(search?.thread);
  const message = searchValue(search?.message);
  if (thread) result.thread = thread;
  if (message) result.message = message;
  return result;
}

/** The first letter of the last word of a name, upper-cased ("Đỗ Ngọc Lan" gives "L"). */
export function replierInitials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const last = words.at(-1);
  if (!last) return '?';
  const first = Array.from(last)[0] ?? '?';
  return first.toLocaleUpperCase('vi-VN');
}

const timeOnly = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dayMonth = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit' });
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** "HH:mm" when `iso` falls on the same Vietnam day as `now`, otherwise "DD/MM". Empty for a missing or bad date. */
export function formatThreadTime(iso: string | null | undefined, now: Date | string = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  const n = typeof now === 'string' ? new Date(now) : now;
  if (Number.isNaN(d.getTime()) || Number.isNaN(n.getTime())) return '';
  return dayKey.format(d) === dayKey.format(n) ? timeOnly.format(d) : dayMonth.format(d);
}
