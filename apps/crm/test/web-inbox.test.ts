import { expect, test } from 'vitest';
import { compressImage, fitImageDimensions, IMAGE_DECODE_ERROR, IMAGE_MAX_BYTES, toJpgFilename } from '../src/web/image-compress';
import { canChannelSendImages, conversationsPath, mergeMessages, senderLabel, weekdaysLabel } from '../src/web/inbox-format';
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

test('image attachments in composer are enabled for zalo and zalo_oa and hidden for facebook', () => {
  expect(canChannelSendImages('zalo')).toBe(true);
  expect(canChannelSendImages('zalo_oa')).toBe(true);
  expect(canChannelSendImages('facebook')).toBe(false);
});

test('fitImageDimensions scales the longest side down to at most 2048 px without upscaling smaller images', () => {
  expect(fitImageDimensions(800, 600)).toEqual({ width: 800, height: 600 });
  expect(fitImageDimensions(4096, 3072)).toEqual({ width: 2048, height: 1536 });
  expect(fitImageDimensions(1800, 3600)).toEqual({ width: 1024, height: 2048 });
  expect(toJpgFilename('bien-lai.png')).toBe('bien-lai.jpg');
  expect(toJpgFilename('')).toBe('image.jpg');
});

test('compressImage steps quality down and scales further until the JPEG is at most 1,000,000 bytes, or reports unreadable images', async () => {
  const attempts: { width: number; height: number; quality: number }[] = [];
  let closed = false;
  const input = new File([new Uint8Array([1, 2, 3])], 'chup-man-hinh.png', { type: 'image/png' });

  const result = await compressImage(input, async () => ({
    width: 4000,
    height: 2000,
    encodeJpeg: async (width, height, quality) => {
      attempts.push({ width, height, quality });
      // At 2048px all qualities exceed 1,000,000 bytes; once scaled down to 1536px, quality 0.75 fits.
      const size = width > 1600 || quality > 0.75 ? IMAGE_MAX_BYTES + 50_000 : 820_000;
      return new Blob([new Uint8Array(size)], { type: 'image/jpeg' });
    },
    close: () => {
      closed = true;
    },
  }));

  expect(closed).toBe(true);
  expect(result.filename).toBe('chup-man-hinh.jpg');
  expect(result.blob.size).toBe(820_000);
  expect(result.width).toBe(1536);
  expect(result.height).toBe(768);
  expect(result.quality).toBe(0.75);
  expect(attempts.slice(0, 4)).toEqual([
    { width: 2048, height: 1024, quality: 0.85 },
    { width: 2048, height: 1024, quality: 0.75 },
    { width: 2048, height: 1024, quality: 0.65 },
    { width: 2048, height: 1024, quality: 0.55 },
  ]);
  expect(attempts[4]).toEqual({ width: 1536, height: 768, quality: 0.85 });
  expect(attempts[5]).toEqual({ width: 1536, height: 768, quality: 0.75 });

  await expect(
    compressImage(input, async () => {
      throw new Error('decode failed');
    }),
  ).rejects.toThrow(IMAGE_DECODE_ERROR);
});

