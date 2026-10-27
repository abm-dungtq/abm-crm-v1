import { describe, expect, test } from 'vitest';
import {
  calendarWeeks, commitFieldText, dayLabel, formatFieldValue, parseFieldInput, quickDueValue, splitFieldValue,
} from '../src/web/date-time';
import { fromLocalInput } from '../src/web/format';
import { foldDiacritics, matchesSearch } from '../src/web/text-search';
import {
  TASK_LIST_CAP, dueCounts, dueMatches, filterTasks, hasActiveFilter, parseTaskSearch, reachedListCap, taskPageTitle,
} from '../src/web/task-filters';
import type { TaskItem } from '../src/web/types';

// Thursday 29/10/2026 10:00 in Vietnam (03:00 UTC).
const NOW = new Date('2026-10-29T03:00:00Z');

describe('Vietnamese date-time field', () => {
  test('shows a stored value as day/month/year with a 24-hour time', () => {
    expect(formatFieldValue('2026-10-30T09:00')).toBe('30/10/2026 09:00');
    expect(formatFieldValue('2026-10-30T21:05')).toBe('30/10/2026 21:05');
    expect(formatFieldValue('2026-10-30')).toBe('30/10/2026');
    expect(formatFieldValue('')).toBe('');
    expect(formatFieldValue('2026-02-30T09:00')).toBe('');
  });

  test('reads short and full typed dates, filling the year and the time', () => {
    const opts = { mode: 'datetime' as const, now: NOW };
    expect(parseFieldInput('31/10 14:00', opts)).toBe('2026-10-31T14:00');
    expect(parseFieldInput('31/10/2026 14:00', opts)).toBe('2026-10-31T14:00');
    expect(parseFieldInput('1/11/26 9h30', opts)).toBe('2026-11-01T09:30');
    expect(parseFieldInput('1-11-2026 14h', opts)).toBe('2026-11-01T14:00');
    expect(parseFieldInput('31.10 lúc 8', opts)).toBe('2026-10-31T08:00');
    expect(parseFieldInput('31/10', opts)).toBe('2026-10-31T09:00');
    expect(parseFieldInput('31/10', { ...opts, fallbackTime: '17:00' })).toBe('2026-10-31T17:00');
    expect(parseFieldInput('2026-10-31T14:00', opts)).toBe('2026-10-31T14:00');
    expect(parseFieldInput('   ', opts)).toBe('');
  });

  test('rejects days that do not exist, bad times and US month-first input', () => {
    const opts = { mode: 'datetime' as const, now: NOW };
    for (const bad of ['31/02', '29/02/2027', '10/30/2026', '31/10 24:00', '31/10 9:7', '31/10 abc', 'mai', '0/10']) {
      expect(parseFieldInput(bad, opts)).toBeNull();
    }
    expect(parseFieldInput('29/02/2028 08:00', opts)).toBe('2028-02-29T08:00');
  });

  test('a date-only field takes a day and refuses a time', () => {
    expect(parseFieldInput('5/1/2027', { mode: 'date', now: NOW })).toBe('2027-01-05');
    expect(parseFieldInput('5/1 09:00', { mode: 'date', now: NOW })).toBeNull();
  });

  test('leaving the field commits a readable entry and puts back the value it had on focus otherwise', () => {
    const opts = { mode: 'datetime' as const, revertTo: '2026-10-30T09:00', now: NOW };
    expect(commitFieldText('2', opts)).toEqual({ value: '2026-10-30T09:00', text: '30/10/2026 09:00', ok: false });
    expect(commitFieldText('31/10 abc', opts)).toEqual({ value: '2026-10-30T09:00', text: '30/10/2026 09:00', ok: false });
    expect(commitFieldText('31/10 14h', opts)).toEqual({ value: '2026-10-31T14:00', text: '31/10/2026 14:00', ok: true });
    // A day alone keeps the time the field already had.
    expect(commitFieldText('2/11', { ...opts, revertTo: '2026-10-30T15:30' }).value).toBe('2026-11-02T15:30');
    expect(commitFieldText('', opts)).toEqual({ value: '', text: '', ok: true });
    expect(commitFieldText('mai', { ...opts, revertTo: '' })).toEqual({ value: '', text: '', ok: false });
  });

  test('field values keep the shape sent to the API, read in Vietnam time', () => {
    const value = parseFieldInput('30/10/2026 09:00', { mode: 'datetime', now: NOW })!;
    expect(fromLocalInput(value)).toBe('2026-10-30T02:00:00.000Z');
    expect(splitFieldValue(value)).toEqual({ day: { year: 2026, month: 10, day: 30 }, time: '09:00' });
  });

  test('quick due values count Vietnam days, across the month end', () => {
    expect(quickDueValue(0, 17, 0, NOW)).toBe('2026-10-29T17:00');
    expect(quickDueValue(3, 9, 0, NOW)).toBe('2026-11-01T09:00');
    // 23:30 on 31/10 in Vietnam is still 31/10 there although it is 16:30 UTC.
    expect(quickDueValue(1, 9, 0, new Date('2026-10-31T16:30:00Z'))).toBe('2026-11-01T09:00');
  });

  test('the calendar starts weeks on Monday and names days in Vietnamese', () => {
    const weeks = calendarWeeks(2026, 10);
    expect(weeks).toHaveLength(6);
    // 1/10/2026 is a Thursday: Monday 28/9 opens the first week.
    expect(weeks[0]![0]).toEqual({ year: 2026, month: 9, day: 28, inMonth: false });
    expect(weeks[0]![3]).toEqual({ year: 2026, month: 10, day: 1, inMonth: true });
    expect(dayLabel({ year: 2026, month: 10, day: 30 })).toBe('Thứ Sáu, 30/10/2026');
    expect(dayLabel({ year: 2026, month: 11, day: 1 })).toBe('Chủ Nhật, 01/11/2026');
  });
});

describe('accent-insensitive matching', () => {
  test('folds Vietnamese accents and đ', () => {
    expect(foldDiacritics('Đỗ Ngọc Lân')).toBe('do ngoc lan');
  });

  test('finds people and titles by any words, in any order, without accents', () => {
    expect(matchesSearch('Bùi Quang Huy', 'huy')).toBe(true);
    expect(matchesSearch('Bùi Quang Huy', 'quang bui')).toBe(true);
    expect(matchesSearch('Dự án Lộc Thọ', 'lộc')).toBe(true);
    expect(matchesSearch('Dự án Lộc Thọ', 'loc tho')).toBe(true);
    expect(matchesSearch('Vũ Đức Long', 'duc')).toBe(true);
    expect(matchesSearch('Bùi Quang Huy', 'xyz')).toBe(false);
    expect(matchesSearch('Bùi Quang Huy', '  ')).toBe(true);
  });
});

const task = (over: Partial<TaskItem>): TaskItem => ({
  id: over.id ?? 't',
  kind: 'internal',
  title: 'Việc',
  description: null,
  priority: 'normal',
  parentTaskId: null,
  dueAt: null,
  status: 'open',
  outcome: null,
  completedAt: null,
  version: 1,
  assignee: { id: 'u-lan', name: 'Đỗ Ngọc Lan' },
  isNextAction: false,
  lead: null,
  bucket: 'nodue',
  ...over,
});

describe('task triage filters', () => {
  const items = [
    task({ id: 'a', title: 'Gửi báo giá cho Công ty Lộc Thọ', dueAt: '2026-10-27T02:00:00Z', bucket: 'overdue' }),
    task({ id: 'b', title: 'Gọi lại khách', dueAt: '2026-10-29T10:00:00Z', bucket: 'today', status: 'in_progress',
      assignee: { id: 'u-long', name: 'Vũ Đức Long' } }),
    task({
      id: 'c', kind: 'crm', title: 'Demo sản phẩm', dueAt: '2026-11-01T02:00:00Z', bucket: 'upcoming',
      lead: {
        id: 'l1', code: 'L-0007', stage: 'contacted', status: 'active', version: 1, pipeline: 'b2b', contactId: 'c1',
        contactName: 'Trần Thị Hoa', accountName: 'Công ty Minh Phát',
      },
    }),
    task({ id: 'd', title: 'Việc sau', dueAt: '2026-11-03T02:00:00Z', bucket: 'upcoming' }),
    task({ id: 'e', title: 'Chưa có hạn' }),
  ];
  const ids = (list: TaskItem[]) => list.map((t) => t.id);

  test('due filters use Vietnam days; this week runs Monday 26/10 to Sunday 1/11', () => {
    expect(dueMatches('2026-10-29T02:59:00Z', 'overdue', NOW)).toBe(true);
    expect(dueMatches('2026-10-29T16:59:00Z', 'today', NOW)).toBe(true);
    expect(dueMatches('2026-10-29T17:00:00Z', 'today', NOW)).toBe(false);
    expect(dueMatches('2026-10-25T16:59:00Z', 'week', NOW)).toBe(false);
    expect(dueMatches('2026-10-25T17:00:00Z', 'week', NOW)).toBe(true);
    expect(dueMatches('2026-11-01T16:59:00Z', 'week', NOW)).toBe(true);
    expect(dueMatches('2026-11-01T17:00:00Z', 'week', NOW)).toBe(false);
    expect(dueMatches(null, 'overdue', NOW)).toBe(false);
  });

  test('search covers title, lead code, customer, company and assignee without accents', () => {
    expect(ids(filterTasks(items, { q: 'loc tho' }, NOW))).toEqual(['a']);
    expect(ids(filterTasks(items, { q: 'l-0007' }, NOW))).toEqual(['c']);
    expect(ids(filterTasks(items, { q: 'minh phat' }, NOW))).toEqual(['c']);
    expect(ids(filterTasks(items, { q: 'long' }, NOW))).toEqual(['b']);
  });

  test('assignee, status and due filters combine', () => {
    expect(ids(filterTasks(items, { assignee: 'u-long' }, NOW))).toEqual(['b']);
    expect(ids(filterTasks(items, { status: 'open' }, NOW))).toEqual(['a', 'c', 'd', 'e']);
    expect(ids(filterTasks(items, { due: 'week' }, NOW))).toEqual(['a', 'b', 'c']);
    expect(ids(filterTasks(items, { due: 'week', status: 'open', q: 'demo' }, NOW))).toEqual(['c']);
    expect(dueCounts(items, NOW)).toEqual({ overdue: 1, today: 1, week: 3 });
  });

  test('the search schema keeps valid values and drops the rest', () => {
    expect(parseTaskSearch({ view: 'board', status: 'in_progress', mine: '1', q: 'Lộc', assignee: 'u-long', due: 'week' }))
      .toEqual({ view: 'board', status: 'in_progress', mine: '1', q: 'Lộc', assignee: 'u-long', due: 'week' });
    expect(parseTaskSearch({ view: 'completed' }).status).toBe('completed');
    expect(parseTaskSearch({ status: 'cancelled', due: 'month', q: '  ', mine: 'yes' }))
      .toEqual({ view: undefined, status: undefined, mine: undefined, q: undefined, assignee: undefined, due: undefined });
    expect(parseTaskSearch({ q: 'x'.repeat(300) }).q).toHaveLength(100);
    // Typed links reach the parser as numbers.
    expect(parseTaskSearch({ mine: 1, q: 2026 })).toMatchObject({ mine: '1', q: '2026' });
  });

  test('page title: team view for managers, own tasks for Sale and with "Chỉ việc của tôi"', () => {
    for (const role of ['leader', 'head', 'director', 'admin']) {
      expect(taskPageTitle(role, false)).toBe('Việc của nhóm');
      expect(taskPageTitle(role, true)).toBe('Việc của tôi');
    }
    expect(taskPageTitle('sale', false)).toBe('Việc của tôi');
  });

  test('active filters and the list cap are detected', () => {
    expect(hasActiveFilter({})).toBe(false);
    expect(hasActiveFilter({ q: '  ' })).toBe(false);
    expect(hasActiveFilter({ due: 'today' })).toBe(true);
    expect(reachedListCap([], undefined)).toBe(false);
    expect(reachedListCap(new Array(TASK_LIST_CAP).fill(0))).toBe(true);
  });
});
