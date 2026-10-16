import { expect, test, vi } from 'vitest';
import {
  canDeleteZaloGroupHistory, canLeaveZaloGroup, deleteGroupHistory, groupLeavePollMs, groupLeaveState, groupLeftNotice, leaveGroup,
} from '../src/web/api';
import {
  INTAKE_FIELD_LABEL, SUMMARY_MAX, buildClassifyPayload, clampActivityText, prefillClassifyForm, summaryBullets,
} from '../src/web/components/note-format';
import { compressImage, fitImageDimensions, IMAGE_DECODE_ERROR, IMAGE_MAX_BYTES, toJpgFilename } from '../src/web/image-compress';
import { canChannelSendImages, conversationsPath, mergeMessages, senderLabel, weekdaysLabel } from '../src/web/inbox-format';
import { INTAKE_FIELDS, type InboxMessage, type LeadIntake } from '../src/web/types';

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

test('intake summary field is registered, parsed into bullet items, prefilled in the classify form, and sent only when non-empty', () => {
  expect(INTAKE_FIELDS).toContain('summary');
  for (const field of INTAKE_FIELDS) {
    expect(INTAKE_FIELD_LABEL[field]).toBeTruthy();
  }

  expect(summaryBullets(undefined)).toEqual([]);
  expect(summaryBullets('  - Khách hỏi khóa AI 199k \n- Đã báo lịch tối thứ 7\n\n• Hẹn gọi lại chiều mai ')).toEqual([
    'Khách hỏi khóa AI 199k',
    'Đã báo lịch tối thứ 7',
    'Hẹn gọi lại chiều mai',
  ]);

  const fakeIntake: LeadIntake = {
    id: 'in-1',
    conversationId: 'conv-1',
    conversationName: 'Nguyễn Minh Anh',
    externalThreadId: 'th-1',
    channel: 'zalo_oa',
    accountName: 'OA ABM',
    contactId: null,
    fields: {
      name: 'Nguyễn Minh Anh',
      phone: '0901234567',
      need: 'Học AI ứng dụng',
      summary: '- Quan tâm lớp AI 199k\n- Đã gửi thông tin lịch học',
    },
    proposed: {},
    status: 'pending',
    leadId: null,
    classifiedByUserId: null,
    classifiedAt: null,
    createdAt: '2026-10-15T04:00:00.000Z',
    updatedAt: '2026-10-15T04:00:00.000Z',
  };
  const prefilled = prefillClassifyForm(fakeIntake, null);
  expect(prefilled.summary).toBe('- Quan tâm lớp AI 199k\n- Đã gửi thông tin lịch học');
  expect(prefillClassifyForm({ ...fakeIntake, fields: { summary: 'x'.repeat(2000) } }, 'Fallback').summary.length).toBe(SUMMARY_MAX);

  expect(buildClassifyPayload('learner', { contactName: 'Minh Anh' }, '  - Ý 1\n- Ý 2  ')).toEqual({
    pipeline: 'learner',
    input: { contactName: 'Minh Anh' },
    summary: '- Ý 1\n- Ý 2',
  });
  expect(buildClassifyPayload('b2b', { contactName: 'Minh Anh' }, '   \n  ')).toEqual({
    pipeline: 'b2b',
    input: { contactName: 'Minh Anh' },
  });
  expect(buildClassifyPayload('b2b', { contactName: 'Minh Anh' })).toEqual({
    pipeline: 'b2b',
    input: { contactName: 'Minh Anh' },
  });
});

test('clampActivityText keeps short bullet summaries intact and clamps notes longer than 6 lines or 600 characters', () => {
  const shortSummary = [
    'Tóm tắt hội thoại Zalo OA:',
    '- Khách hỏi khóa AI ứng dụng cho người mới',
    '- Đã báo lịch khai giảng thứ 7 và học phí 199k',
    '- Hẹn gọi lại chiều mai xác nhận giữ chỗ',
  ].join('\n');
  expect(clampActivityText(shortSummary)).toEqual({ clamped: false, preview: shortSummary });

  const eightLines = Array.from({ length: 8 }, (_, i) => `- Dòng thứ ${i + 1}`).join('\n');
  const clampedLines = clampActivityText(eightLines);
  expect(clampedLines.clamped).toBe(true);
  expect(clampedLines.preview.split('\n')).toHaveLength(6);
  expect(clampedLines.preview.endsWith('…')).toBe(true);

  const longParagraph = 'Khách trao đổi chi tiết về nhu cầu đào tạo nội bộ. '.repeat(15);
  expect(longParagraph.length).toBeGreaterThan(600);
  const clampedChars = clampActivityText(longParagraph);
  expect(clampedChars.clamped).toBe(true);
  expect(clampedChars.preview.length).toBeLessThanOrEqual(601);
  expect(clampedChars.preview.endsWith('…')).toBe(true);
});

test('Zalo group leave helpers gate manager roles, track leaving/left state, poll every 5 s while leaving, and format the read-only notice', async () => {
  const active = { id: 'grp-1', leftAt: null, leaveRequestedAt: null };
  const leaving = { id: 'grp-1', leftAt: null, leaveRequestedAt: '2026-10-15T06:00:00.000Z' };
  const left = { id: 'grp-1', leftAt: '2026-10-15T06:01:00.000Z', leaveRequestedAt: '2026-10-15T06:00:00.000Z' };

  expect(groupLeaveState(null)).toBe('active');
  expect(groupLeaveState(active)).toBe('active');
  expect(groupLeaveState(leaving)).toBe('leaving');
  expect(groupLeaveState(left)).toBe('left');

  expect(canLeaveZaloGroup('sale', active)).toBe(false);
  for (const role of ['leader', 'head', 'director', 'admin']) {
    expect(canLeaveZaloGroup(role, active)).toBe(true);
    expect(canLeaveZaloGroup(role, leaving)).toBe(true);
    expect(canLeaveZaloGroup(role, left)).toBe(false);
    expect(canLeaveZaloGroup(role, null)).toBe(false);
  }

  expect(groupLeavePollMs([active])).toBe(30_000);
  expect(groupLeavePollMs([leaving])).toBe(5000);
  expect(groupLeavePollMs([left])).toBe(30_000);
  expect(groupLeavePollMs([active, { id: 'grp-2', leftAt: null, leaveRequestedAt: '2026-10-15T06:00:00.000Z' }], 'grp-1')).toBe(30_000);
  expect(groupLeavePollMs([active, { id: 'grp-2', leftAt: null, leaveRequestedAt: '2026-10-15T06:00:00.000Z' }], 'grp-2')).toBe(5000);

  expect(groupLeftNotice(null)).toBeNull();
  expect(groupLeftNotice('2026-10-15T06:05:00.000Z')).toBe(
    'Nick đã rời nhóm này lúc 15/10 13:05. Lịch sử tin nhắn vẫn được giữ.',
  );

  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify({ ok: true, data: { id: 'grp-1', leaveRequestedAt: '2026-10-15T06:00:00.000Z' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  try {
    const res = await leaveGroup('grp-1');
    expect(res).toEqual({ id: 'grp-1', leaveRequestedAt: '2026-10-15T06:00:00.000Z' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe('/api/inbox/groups/grp-1/leave');
    expect(spy.mock.calls[0]?.[1]?.method).toBe('POST');
  } finally {
    spy.mockRestore();
  }
});

test('canDeleteZaloGroupHistory truth table allows only manager roles on groups with leftAt set, and deleteGroupHistory calls DELETE', async () => {
  const active = { leftAt: null };
  const leaving = { leftAt: null, leaveRequestedAt: '2026-10-15T06:00:00.000Z' };
  const left = { leftAt: '2026-10-15T06:01:00.000Z' };

  for (const nonManager of ['sale', 'teacher', '']) {
    expect(canDeleteZaloGroupHistory(nonManager, active)).toBe(false);
    expect(canDeleteZaloGroupHistory(nonManager, leaving)).toBe(false);
    expect(canDeleteZaloGroupHistory(nonManager, left)).toBe(false);
    expect(canDeleteZaloGroupHistory(nonManager, null)).toBe(false);
    expect(canDeleteZaloGroupHistory(nonManager, undefined)).toBe(false);
  }

  for (const manager of ['leader', 'head', 'director', 'admin']) {
    expect(canDeleteZaloGroupHistory(manager, active)).toBe(false);
    expect(canDeleteZaloGroupHistory(manager, leaving)).toBe(false);
    expect(canDeleteZaloGroupHistory(manager, left)).toBe(true);
    expect(canDeleteZaloGroupHistory(manager, null)).toBe(false);
    expect(canDeleteZaloGroupHistory(manager, undefined)).toBe(false);
  }

  const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify({ ok: true, data: { id: 'grp-1' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  try {
    const res = await deleteGroupHistory('grp-1');
    expect(res).toEqual({ id: 'grp-1' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe('/api/inbox/groups/grp-1');
    expect(spy.mock.calls[0]?.[1]?.method).toBe('DELETE');
  } finally {
    spy.mockRestore();
  }
});



