import { expect, test } from 'vitest';
import { conversationsPath, mergeMessages, senderLabel, weekdaysLabel } from '../src/web/inbox-format';
import type { InboxMessage } from '../src/web/types';

const msg = (id: string, createdAt: string, overrides: Partial<InboxMessage> = {}): InboxMessage => ({
  id, direction: 'in', senderKind: 'customer', senderExternalId: null, sentByUserId: null, sentByName: null, externalMsgId: null,
  body: id, attachmentsJson: null, status: 'received', createdAt, ...overrides,
});

test('merging messages replaces a known id, adds new ones and keeps the list oldest first', () => {
  const prev = [msg('a', '2026-10-08T03:00:00.000Z'), msg('b', '2026-10-08T03:01:00.000Z', { direction: 'out', status: 'pending' })];
  const merged = mergeMessages(prev, [
    msg('c', '2026-10-08T03:02:00.000Z'),
    msg('b', '2026-10-08T03:01:00.000Z', { direction: 'out', status: 'sent' }),
    msg('z', '2026-10-08T02:59:00.000Z'),
  ]);
  expect(merged.map((m) => m.id)).toEqual(['z', 'a', 'b', 'c']);
  expect(merged.find((m) => m.id === 'b')!.status).toBe('sent');
  expect(prev.map((m) => m.status)).toEqual(['received', 'pending']);
});

test('merging nothing new returns the same list so the view does not re-render', () => {
  const prev = [msg('a', '2026-10-08T03:00:00.000Z')];
  expect(mergeMessages(prev, [])).toBe(prev);
  expect(mergeMessages([], [msg('a', '2026-10-08T03:00:00.000Z')]).map((m) => m.id)).toEqual(['a']);
});

test('the conversation list query sends only filters that have a value, trimmed and encoded', () => {
  expect(conversationsPath()).toBe('/inbox/conversations');
  expect(conversationsPath({ mode: undefined, q: '   ', assignee: '' })).toBe('/inbox/conversations');
  const url = new URL(conversationsPath({ mode: 'human', kind: 'direct', assignee: 'none', account: 'ca-1', q: ' Chị Hoa & Co ', before: '2026-10-08T03:00:00.000Z' }), 'http://crm.test');
  expect(url.pathname).toBe('/inbox/conversations');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    mode: 'human', kind: 'direct', assignee: 'none', account: 'ca-1', q: 'Chị Hoa & Co', before: '2026-10-08T03:00:00.000Z',
  });
});

test('weekday masks read Monday first, every day as "Hằng ngày", none as a dash', () => {
  expect(weekdaysLabel(0b1111111)).toBe('Hằng ngày');
  expect(weekdaysLabel(0b0011111)).toBe('T2, T3, T4, T5, T6');
  expect(weekdaysLabel(0b1000001)).toBe('T2, CN');
  expect(weekdaysLabel(0b0100000)).toBe('T7');
  expect(weekdaysLabel(0)).toBe('—');
  // Bits above Sunday are not days.
  expect(weekdaysLabel(0b10000000)).toBe('—');
  expect(weekdaysLabel(0b11111111)).toBe('Hằng ngày');
});

test('a reply typed outside the CRM is labelled by its channel: the phone on Zalo, Meta Business Suite on Facebook', () => {
  const phone = msg('p', '2026-10-08T03:00:00.000Z', { direction: 'out', senderKind: 'staff_phone' });
  expect(senderLabel(phone, 'zalo')).toBe('Điện thoại');
  expect(senderLabel(phone, 'facebook')).toBe('Meta Business Suite');
  const web = msg('w', '2026-10-08T03:00:00.000Z', { direction: 'out', senderKind: 'staff_web', sentByName: 'Đỗ Ngọc Lan' });
  expect(senderLabel(web, 'facebook')).toBe('Đỗ Ngọc Lan');
  expect(senderLabel({ ...web, sentByName: null }, 'zalo')).toBe('Nhân viên');
  expect(senderLabel(msg('b', '2026-10-08T03:00:00.000Z', { senderKind: 'bot' }), 'facebook')).toBe('Bot');
  expect(senderLabel(msg('c', '2026-10-08T03:00:00.000Z'), 'facebook')).toBeNull();
});
