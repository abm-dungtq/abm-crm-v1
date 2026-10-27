import { describe, expect, test } from 'vitest';
import { extractTaskDrafts } from '../src/worker/chat-task-markers';

const members = [
  { user_id: 'u-long', display_name: 'Vũ Đức Long' },
  { user_id: 'u-lan', display_name: 'Đỗ Ngọc Lan' },
  { user_id: 'u-hung', display_name: 'Phạm Văn Hùng' },
];

const SAMPLE = [
  '[TASK]',
  'title: Gửi báo giá cho khách Gốm Thanh Lam',
  'assignee: @Vũ Đức Long',
  'members: @Đỗ Ngọc Lan, @Phạm Văn Hùng',
  'due: 2026-10-30',
  'description:',
  'Khách cần báo giá trọn gói trước thứ 6.',
  'Lan gửi thông tin đơn hàng cho Long.',
  '[/TASK]',
].join('\n');

describe('task markers', () => {
  test('the sample block resolves every name, keeps the multi-line description and the due date', () => {
    const { body, drafts } = extractTaskDrafts(`Mình đề xuất:\n${SAMPLE}`, members);
    expect(body).toBe('Mình đề xuất:');
    expect(drafts).toEqual([{
      title: 'Gửi báo giá cho khách Gốm Thanh Lam',
      description: 'Khách cần báo giá trọn gói trước thứ 6.\nLan gửi thông tin đơn hàng cho Long.',
      assigneeName: 'Vũ Đức Long',
      assigneeUserId: 'u-long',
      memberNames: ['Đỗ Ngọc Lan', 'Phạm Văn Hùng'],
      memberUserIds: ['u-lan', 'u-hung'],
      unresolvedNames: [],
      dueDate: '2026-10-30',
    }]);
  });

  test('names match without case or diacritics, and tags and keys ignore case and spaces', () => {
    const { drafts } = extractTaskDrafts([' [ task ] ', '  TITLE :  Gọi khách', 'Assignee: @vu duc LONG', 'Members: @do ngoc lan', '[/Task]'].join('\n'), members);
    expect(drafts[0]).toMatchObject({ title: 'Gọi khách', assigneeUserId: 'u-long', memberUserIds: ['u-lan'], unresolvedNames: [] });
  });

  test('a date that is not on the calendar becomes null', () => {
    const { drafts } = extractTaskDrafts('[TASK]\ntitle: Việc\ndue: 2026-02-30\n[/TASK]', members);
    expect(drafts[0]!.dueDate).toBeNull();
    expect(extractTaskDrafts('[TASK]\ntitle: Việc\ndue: thứ 6\n[/TASK]', members).drafts[0]!.dueDate).toBeNull();
  });

  test('a name shared by two members, or matching nobody, stays unresolved as text', () => {
    const twins = [...members, { user_id: 'u-mai', display_name: 'Hoàng Mai' }, { user_id: 'u-mai-2', display_name: 'Hoàng Mai' }];
    const { drafts } = extractTaskDrafts('[TASK]\ntitle: Việc\nassignee: @Hoàng Mai\nmembers: @Hoàng Mai, @Người Lạ, @Phạm Văn Hùng\n[/TASK]', twins);
    expect(drafts[0]).toMatchObject({
      assigneeName: 'Hoàng Mai',
      assigneeUserId: null,
      memberNames: ['Hoàng Mai', 'Người Lạ', 'Phạm Văn Hùng'],
      memberUserIds: ['u-hung'],
      unresolvedNames: ['Hoàng Mai', 'Người Lạ'],
    });
  });

  test('the Vietnamese keys work', () => {
    const text = ['[TASK]', 'Tiêu đề: Chuẩn bị hợp đồng', 'Người làm: @Đỗ Ngọc Lan', 'Người liên quan: @Vũ Đức Long', 'Hạn: 2026-11-02', 'Mô tả: Dòng một', 'Dòng hai', '[/TASK]'].join('\n');
    expect(extractTaskDrafts(text, members).drafts).toEqual([{
      title: 'Chuẩn bị hợp đồng',
      description: 'Dòng một\nDòng hai',
      assigneeName: 'Đỗ Ngọc Lan',
      assigneeUserId: 'u-lan',
      memberNames: ['Vũ Đức Long'],
      memberUserIds: ['u-long'],
      unresolvedNames: [],
      dueDate: '2026-11-02',
    }]);
  });

  test('a block without [/TASK] runs to the end of the text', () => {
    const { body, drafts } = extractTaskDrafts('Trước khối\n[TASK]\ntitle: Việc dở\ndescription:\nMột\nHai', members);
    expect(body).toBe('Trước khối');
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.description).toBe('Một\nHai');
  });

  test('four blocks give three drafts, and every block leaves the body', () => {
    const blocks = [1, 2, 3, 4].map((n) => `[TASK]\ntitle: Việc ${n}\n[/TASK]`).join('\nGiữa\n');
    const { body, drafts } = extractTaskDrafts(blocks, members);
    expect(drafts.map((d) => d.title)).toEqual(['Việc 1', 'Việc 2', 'Việc 3']);
    expect(body).toBe('Giữa\nGiữa\nGiữa');
  });

  test('the legacy line with a date and members gives one draft', () => {
    const { body, drafts } = extractTaskDrafts('Ok\n[TASK: Gọi lại khách | @Vũ Đức Long | 2026-11-01 | @Đỗ Ngọc Lan, @Phạm Văn Hùng]', members);
    expect(body).toBe('Ok');
    expect(drafts).toEqual([{
      title: 'Gọi lại khách',
      description: null,
      assigneeName: 'Vũ Đức Long',
      assigneeUserId: 'u-long',
      memberNames: ['Đỗ Ngọc Lan', 'Phạm Văn Hùng'],
      memberUserIds: ['u-lan', 'u-hung'],
      unresolvedNames: [],
      dueDate: '2026-11-01',
    }]);
    expect(extractTaskDrafts('[TASK: Gọi lại | @Vũ Đức Long]', members).drafts[0]).toMatchObject({ title: 'Gọi lại', dueDate: null, memberUserIds: [] });
  });

  test('a body made only of blocks becomes "Đề xuất công việc:"', () => {
    expect(extractTaskDrafts(SAMPLE, members).body).toBe('Đề xuất công việc:');
  });

  test('a block without a title is ignored', () => {
    const { body, drafts } = extractTaskDrafts('Xin chào\n[TASK]\nassignee: @Vũ Đức Long\n[/TASK]', members);
    expect(drafts).toEqual([]);
    expect(body).toBe('Xin chào');
  });

  test('the title is cut to 200 characters and the description to 5000', () => {
    const { drafts } = extractTaskDrafts(`[TASK]\ntitle: ${'t'.repeat(300)}\ndescription:\n${'d'.repeat(6000)}\n[/TASK]`, members);
    expect(drafts[0]!.title).toHaveLength(200);
    expect(drafts[0]!.description).toHaveLength(5000);
  });

  test('keys are read with spaces around them, and hostile lines are parsed in linear time', () => {
    expect(extractTaskDrafts('[TASK]\n   Tiêu đề   :  Gọi khách \n[/TASK]', members).drafts[0]).toMatchObject({ title: 'Gọi khách' });
    const timed = (text: string) => {
      const start = performance.now();
      extractTaskDrafts(text, members);
      return performance.now() - start;
    };
    expect(timed(`[TASK]\n${' '.repeat(10_000)}x\n[/TASK]`)).toBeLessThan(50);
    expect(timed(`[TASK]\n${'a '.repeat(5000)}\ntitle: x\n[/TASK]`)).toBeLessThan(50);
    expect(timed(`[task:${'] '.repeat(5000)}x`)).toBeLessThan(50);
  });
});
