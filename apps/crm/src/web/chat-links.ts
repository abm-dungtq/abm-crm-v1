/** Pure helpers for chat deep links, thread cards and the thread panel. */

const SEARCH_VALUE_MAX = 64;
const TZ = 'Asia/Ho_Chi_Minh';

export interface ChatSearch {
  /** Root message id of the open thread panel. */
  thread?: string;
  /** Message to jump to and highlight. */
  message?: string;
  /** The conversation list shows followed threads ("Chuỗi") instead of every conversation. */
  list?: 'threads';
}

/** `/chat/<id>`, plus `?thread=<root>`, `?message=<id>` and/or `?list=threads`. */
export function chatLink({
  conversationId,
  threadRootId,
  messageId,
  list,
}: {
  conversationId: string;
  threadRootId?: string | null;
  messageId?: string | null;
  list?: 'threads';
}): string {
  const params = new URLSearchParams();
  if (threadRootId) params.set('thread', threadRootId);
  if (messageId) params.set('message', messageId);
  if (list === 'threads') params.set('list', 'threads');
  const query = params.toString();
  return `/chat/${encodeURIComponent(conversationId)}${query ? `?${query}` : ''}`;
}

function searchValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= SEARCH_VALUE_MAX ? trimmed : undefined;
}

/**
 * Reads `thread`, `message` and `list` from the route search; empty, non-string or over-long values are dropped, and
 * `list` is kept only as "threads".
 */
export function parseChatSearch(search: Record<string, unknown> | null | undefined): ChatSearch {
  const result: ChatSearch = {};
  const thread = searchValue(search?.thread);
  const message = searchValue(search?.message);
  if (thread) result.thread = thread;
  if (message) result.message = message;
  if (search?.list === 'threads') result.list = 'threads';
  return result;
}

const DRAFT_PREFIX = 'chat-draft:';

/**
 * Where an unsent composer text is kept for this tab: one draft per person, per conversation main flow and per thread.
 * The user id keeps one person's draft away from the next person on a shared device.
 */
export function chatDraftKey(userId: string, conversationId: string, threadRootId?: string | null): string {
  return `${DRAFT_PREFIX}${userId}:${conversationId}:${threadRootId || 'main'}`;
}

type DraftStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Removes every saved composer draft from this tab, for logout and for switching the demo user. Never throws. */
export function clearChatDrafts(store: Pick<Storage, 'key' | 'length' | 'removeItem'> | null = sessionStore()): void {
  if (!store) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key?.startsWith(DRAFT_PREFIX)) keys.push(key);
    }
    for (const key of keys) store.removeItem(key);
  } catch {
    // Storage blocked: there is nothing to clear.
  }
}

/** The tab's sessionStorage, or null where it is missing or blocked (private mode, sandboxed frames). */
function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** The saved draft for `key`, or "" when there is none or storage cannot be read. */
export function readChatDraft(key: string | null, store: DraftStore | null = sessionStore()): string {
  if (!key || !store) return '';
  try {
    return store.getItem(key) ?? '';
  } catch {
    return '';
  }
}

/** Saves a non-blank draft and removes a blank one; a full or blocked storage just drops the draft. */
export function writeChatDraft(key: string | null, text: string, store: DraftStore | null = sessionStore()): void {
  if (!key || !store) return;
  try {
    if (text.trim()) store.setItem(key, text);
    else store.removeItem(key);
  } catch {
    // Quota exceeded or storage disabled: the draft only lives in memory.
  }
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
