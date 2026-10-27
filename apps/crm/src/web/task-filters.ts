/** Triage on /tasks: the URL search schema, the page title and client-side filtering over the loaded task lists. */
import { vnNow, weekdayIndex, addDays, dayValue } from './date-time';
import { matchesSearch } from './text-search';
import type { TaskItem } from './types';

/**
 * `GET /tasks` returns at most this many tasks per status (see `listTasks` in the worker). Filters run on the loaded
 * list, so a list this long may hide matches and the page says so.
 */
export const TASK_LIST_CAP = 300;

export const DUE_FILTERS = [
  { id: 'overdue', label: 'Quá hạn' },
  { id: 'today', label: 'Hôm nay' },
  { id: 'week', label: 'Tuần này' },
] as const;
export type DueFilter = (typeof DUE_FILTERS)[number]['id'];

/** `status`: absent for every open task, `open` for "Cần làm" only, `in_progress` for "Đang làm", or the done tab. */
export interface TaskSearch {
  view?: 'list' | 'board';
  status?: 'open' | 'in_progress' | 'completed';
  mine?: '1';
  q?: string;
  assignee?: string;
  due?: DueFilter;
}

const STATUSES = ['open', 'in_progress', 'completed'] as const;

/** Validates the /tasks search params; unknown or malformed values are dropped. */
export function parseTaskSearch(s: Record<string, unknown>): TaskSearch {
  // The router JSON-parses search values, so a typed link like `?mine=1` or `?q=2026` arrives as a number.
  const text = (v: unknown, max: number) => {
    const str = typeof v === 'number' && Number.isFinite(v) ? String(v) : v;
    return typeof str === 'string' && str.trim() ? str.slice(0, max) : undefined;
  };
  return {
    view: s.view === 'board' ? 'board' : s.view === 'list' ? 'list' : undefined,
    // `view=completed` is an older link to the done tab.
    status: s.view === 'completed' ? 'completed' : STATUSES.includes(s.status as never) ? (s.status as TaskSearch['status']) : undefined,
    mine: s.mine === '1' || s.mine === 1 ? '1' : undefined,
    q: text(s.q, 100),
    assignee: text(s.assignee, 120),
    due: DUE_FILTERS.some((d) => d.id === s.due) ? (s.due as DueFilter) : undefined,
  };
}

/** Leaders, heads, directors and admins land on their team's tasks; Sale only ever sees their own. */
export function taskPageTitle(role: string, mine: boolean): string {
  return role === 'sale' || mine ? 'Việc của tôi' : 'Việc của nhóm';
}

/** Whether a due time falls in a due filter, in Vietnam time. "Tuần này" is Monday to Sunday of the current week. */
export function dueMatches(dueAt: string | null, filter: DueFilter, now: Date = new Date()): boolean {
  if (!dueAt) return false;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return false;
  if (filter === 'overdue') return due.getTime() < now.getTime();
  const today = vnNow(now);
  const dueDay = dayValue(vnNow(due));
  if (filter === 'today') return due.getTime() >= now.getTime() && dueDay === dayValue(today);
  const monday = addDays(today, -weekdayIndex(today));
  return dueDay >= dayValue(monday) && dueDay <= dayValue(addDays(monday, 6));
}

export interface TaskFilter {
  q?: string;
  assignee?: string;
  status?: 'open' | 'in_progress';
  due?: DueFilter;
}

/** The text a task is found by: title, lead code, customer, company and the person responsible. */
const taskText = (t: TaskItem) =>
  [t.title, t.lead?.code, t.lead?.contactName, t.lead?.accountName, t.assignee.name].filter(Boolean).join(' ');

export function filterTasks(items: readonly TaskItem[], f: TaskFilter, now: Date = new Date()): TaskItem[] {
  return items.filter((t) =>
    (!f.status || t.status === f.status)
    && (!f.assignee || t.assignee.id === f.assignee)
    && (!f.due || dueMatches(t.dueAt, f.due, now))
    && matchesSearch(taskText(t), f.q ?? ''));
}

/** How many of `items` each due filter would keep, for the chip counts. */
export function dueCounts(items: readonly TaskItem[], now: Date = new Date()): Record<DueFilter, number> {
  const counts: Record<DueFilter, number> = { overdue: 0, today: 0, week: 0 };
  for (const t of items) for (const d of DUE_FILTERS) if (dueMatches(t.dueAt, d.id, now)) counts[d.id] += 1;
  return counts;
}

export const hasActiveFilter = (f: TaskFilter) => Boolean(f.q?.trim() || f.assignee || f.status || f.due);

/** True when any loaded list reached the API cap, so filtering may miss tasks that were not loaded. */
export const reachedListCap = (...lists: (readonly unknown[] | undefined)[]) => lists.some((l) => (l?.length ?? 0) >= TASK_LIST_CAP);
