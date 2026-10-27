import { describe, expect, test } from 'vitest';
import { chatLink, formatThreadTime, parseChatSearch, replierInitials } from '../src/web/chat-links';

describe('chatLink', () => {
  test('encodes the conversation id and adds no query without a target', () => {
    expect(chatLink({ conversationId: 'dm:u-1/u 2' })).toBe('/chat/dm%3Au-1%2Fu%202');
  });

  test('adds the thread or message parameter', () => {
    expect(chatLink({ conversationId: 'g-1', threadRootId: 'm-root' })).toBe('/chat/g-1?thread=m-root');
    expect(chatLink({ conversationId: 'g-1', messageId: 'm 9&x' })).toBe('/chat/g-1?message=m+9%26x');
    const both = new URL(chatLink({ conversationId: 'g-1', threadRootId: 'r', messageId: 'm' }), 'http://crm.test');
    expect(both.pathname).toBe('/chat/g-1');
    expect(Object.fromEntries(both.searchParams)).toEqual({ thread: 'r', message: 'm' });
  });

  test('ignores empty or null targets', () => {
    expect(chatLink({ conversationId: 'g-1', threadRootId: '', messageId: null })).toBe('/chat/g-1');
  });
});

describe('parseChatSearch', () => {
  test('keeps valid thread and message values', () => {
    expect(parseChatSearch({ thread: 'm-root', message: 'm-1' })).toEqual({ thread: 'm-root', message: 'm-1' });
  });

  test('drops empty, non-string and over-long values', () => {
    expect(parseChatSearch({ thread: '', message: '   ' })).toEqual({});
    expect(parseChatSearch({ thread: 42, message: ['m'] })).toEqual({});
    expect(parseChatSearch({ thread: 'x'.repeat(65), message: 'y'.repeat(64) })).toEqual({ message: 'y'.repeat(64) });
    expect(parseChatSearch(undefined)).toEqual({});
  });
});

describe('replierInitials', () => {
  test('takes the first letter of the last word, upper-cased and Vietnamese-safe', () => {
    expect(replierInitials('Đỗ Ngọc Lan')).toBe('L');
    expect(replierInitials('trợ lý')).toBe('L');
    expect(replierInitials('  Nguyễn  Đức ')).toBe('Đ');
    expect(replierInitials('')).toBe('?');
    expect(replierInitials(null)).toBe('?');
  });
});

describe('formatThreadTime', () => {
  test('shows HH:mm for the same day in Vietnam time', () => {
    expect(formatThreadTime('2026-10-26T16:30:00Z', '2026-10-26T16:45:00Z')).toBe('23:30');
  });

  test('shows DD/MM once the Vietnam day has changed', () => {
    // 17:30 UTC on 26/10 is already 00:30 on 27/10 in Vietnam.
    expect(formatThreadTime('2026-10-26T16:30:00Z', '2026-10-26T17:30:00Z')).toBe('26/10');
    expect(formatThreadTime('2026-10-01T02:05:00Z', new Date('2026-10-26T03:00:00Z'))).toBe('01/10');
  });

  test('returns an empty string for a missing or invalid time', () => {
    expect(formatThreadTime(null)).toBe('');
    expect(formatThreadTime('not a date', '2026-10-26T16:45:00Z')).toBe('');
  });
});
