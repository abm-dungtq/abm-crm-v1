import { describe, expect, test } from 'vitest';
import { chatLink, formatThreadTime, parseChatSearch, replierInitials } from '../src/web/chat-links';
import {
  buildChatTree,
  canCloseTopic,
  canCreateSubgroup,
  canManageMembers,
  canSwitchMode,
  type ChatTreeActor,
} from '../src/web/chat-tree';
import { draftToInitialValues, taskSourceLink, unresolvedNamesHint } from '../src/web/chat-task-draft';
import type {
  ChatConversationDetail,
  ChatConversationSummary,
  ChatManualTaskDraft,
  ChatTaskDraft,
} from '../src/web/types';

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

function summary(overrides: Partial<ChatConversationSummary> & { id: string }): ChatConversationSummary {
  return {
    kind: 'group',
    title: overrides.id,
    agentReadable: false,
    lastMessage: '',
    lastMessageAt: null,
    updatedAt: '2026-10-01T00:00:00Z',
    unread: 0,
    threadUnread: 0,
    mode: 'chat',
    departmentId: null,
    parentConversationId: null,
    parentTitle: null,
    system: false,
    ...overrides,
  };
}

function detail(overrides: Partial<ChatConversationDetail> = {}): ChatConversationDetail {
  return {
    id: 'g-1',
    kind: 'group',
    title: 'Nhóm',
    taskId: null,
    system: false,
    agentReadable: false,
    mode: 'chat',
    departmentId: null,
    parentConversationId: null,
    parentTitle: null,
    subgroups: [],
    createdByUserId: 'u-owner',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    lastMessageAt: null,
    members: [
      { id: 'u-owner', name: 'Chủ nhóm', role: 'owner' },
      { id: 'u-member', name: 'Thành viên', role: 'member' },
    ],
    ...overrides,
  };
}

const owner: ChatTreeActor = { id: 'u-owner', role: 'sale' };
const member: ChatTreeActor = { id: 'u-member', role: 'sale' };
const director: ChatTreeActor = { id: 'u-dir', role: 'director' };
const admin: ChatTreeActor = { id: 'u-admin', role: 'admin' };

describe('buildChatTree', () => {
  const tree = buildChatTree([
    summary({ id: 'dm-1', kind: 'direct', lastMessageAt: '2026-10-05T00:00:00Z' }),
    summary({ id: 'sub-a', parentConversationId: 'dept:kd', parentTitle: 'Kinh doanh', lastMessageAt: '2026-10-02T00:00:00Z' }),
    summary({ id: 'dept:kd', title: 'Kinh doanh', departmentId: 'kd', system: true }),
    summary({ id: 'sub-b', parentConversationId: 'dept:kd', parentTitle: 'Kinh doanh', lastMessageAt: '2026-10-01T00:00:00Z', unread: 2 }),
    summary({ id: 'sub-orphan', parentConversationId: 'dept:dt', parentTitle: 'Đào tạo' }),
    summary({ id: 'inbox', title: 'Inbox', system: true }),
    summary({ id: 'g-old', lastMessageAt: '2026-10-01T00:00:00Z' }),
    summary({ id: 'g-new', lastMessageAt: '2026-10-04T00:00:00Z' }),
    summary({ id: 'g-unread', lastMessageAt: '2026-09-01T00:00:00Z', unread: 1 }),
  ]);

  test('nests subgroups under their department group, unread first', () => {
    const kd = tree.departments.find((d) => d.parentId === 'dept:kd');
    expect(kd?.group?.id).toBe('dept:kd');
    expect(kd?.title).toBe('Kinh doanh');
    expect(kd?.children.map((c) => c.id)).toEqual(['sub-b', 'sub-a']);
  });

  test('lists an orphan subgroup under a header with the parent title', () => {
    const dt = tree.departments.find((d) => d.parentId === 'dept:dt');
    expect(dt).toMatchObject({ group: null, title: 'Đào tạo' });
    expect(dt?.children.map((c) => c.id)).toEqual(['sub-orphan']);
  });

  test('sorts departments by Vietnamese title', () => {
    expect(tree.departments.map((d) => d.title)).toEqual(['Đào tạo', 'Kinh doanh']);
  });

  test('puts Inbox in system, directs apart, and orders normal groups by unread then recency', () => {
    expect(tree.system.map((c) => c.id)).toEqual(['inbox']);
    expect(tree.directs.map((c) => c.id)).toEqual(['dm-1']);
    expect(tree.groups.map((c) => c.id)).toEqual(['g-unread', 'g-new', 'g-old']);
  });
});

describe('group permissions', () => {
  test('canSwitchMode: owner, director and admin; never a member or the Inbox group', () => {
    expect(canSwitchMode(detail(), owner)).toBe(true);
    expect(canSwitchMode(detail(), member)).toBe(false);
    expect(canSwitchMode(detail(), director)).toBe(true);
    expect(canSwitchMode(detail({ system: true }), admin)).toBe(false);
    expect(canSwitchMode(detail({ system: true, departmentId: 'kd' }), owner)).toBe(true);
    expect(canSwitchMode(detail({ kind: 'direct' }), admin)).toBe(false);
  });

  test('canManageMembers: false for department and Inbox groups', () => {
    expect(canManageMembers(detail(), owner)).toBe(true);
    expect(canManageMembers(detail(), member)).toBe(false);
    expect(canManageMembers(detail(), admin)).toBe(true);
    expect(canManageMembers(detail({ system: true, departmentId: 'kd' }), owner)).toBe(false);
    expect(canManageMembers(detail({ system: true }), admin)).toBe(false);
  });

  test('canCreateSubgroup: a member of the department group, or a director or admin', () => {
    const dept = summary({ id: 'dept:kd', departmentId: 'kd', system: true });
    expect(canCreateSubgroup(dept, member)).toBe(true);
    expect(canCreateSubgroup(null, member)).toBe(false);
    expect(canCreateSubgroup(null, admin)).toBe(true);
    expect(canCreateSubgroup(null, director)).toBe(true);
    expect(canCreateSubgroup(summary({ id: 'g-1' }), admin)).toBe(false);
  });

  test('canCloseTopic: the root author, the owner, a director or an admin, and only for a topic', () => {
    const topic = { isTopic: true };
    const other: ChatTreeActor = { id: 'u-other', role: 'sale' };
    const conv = detail({ members: [...detail().members, { id: 'u-other', name: 'Khác', role: 'member' }] });
    expect(canCloseTopic(topic, 'u-member', conv, member)).toBe(true);
    expect(canCloseTopic(topic, 'u-member', conv, owner)).toBe(true);
    expect(canCloseTopic(topic, 'u-member', conv, other)).toBe(false);
    expect(canCloseTopic(topic, null, conv, admin)).toBe(true);
    expect(canCloseTopic({ isTopic: false }, 'u-member', conv, member)).toBe(false);
    expect(canCloseTopic(null, 'u-member', conv, owner)).toBe(false);
  });
});

describe('task from chat', () => {
  const source = { conversationId: 'g-1', messageId: 'm-root', scope: 'thread' as const };
  const agentDraft = (over: Partial<ChatTaskDraft> = {}): ChatTaskDraft => ({
    title: 'Gửi báo giá',
    description: 'Gửi bản PDF',
    assigneeName: 'Lan',
    assigneeUserId: 'u-lan',
    memberNames: ['Minh', 'Ai đó'],
    memberUserIds: ['u-minh'],
    unresolvedNames: ['Ai đó'],
    dueDate: '2026-11-03',
    source,
    createdTaskId: null,
    ...over,
  });

  test('draftToInitialValues: an agent draft keeps its fields, gets 09:00 on the due day, and carries source and draft', () => {
    expect(draftToInitialValues(agentDraft(), 'agent:c-1', 0)).toEqual({
      title: 'Gửi báo giá',
      description: 'Gửi bản PDF',
      assigneeUserId: 'u-lan',
      due: '2026-11-03T09:00',
      memberUserIds: ['u-minh'],
      unresolvedNames: ['Ai đó'],
      source,
      draft: { messageId: 'agent:c-1', index: 0 },
    });
  });

  test('draftToInitialValues: no due date stays null and a null description becomes empty', () => {
    const values = draftToInitialValues(agentDraft({ dueDate: null, description: null }), 'agent:c-1', 2);
    expect(values.due).toBeNull();
    expect(values.description).toBe('');
    expect(values.draft).toEqual({ messageId: 'agent:c-1', index: 2 });
  });

  test('draftToInitialValues: a manual draft has a source but no draft reference', () => {
    const manual: ChatManualTaskDraft = {
      title: 'Việc từ chat',
      description: '09:00 01/11 Lan: nội dung',
      assigneeUserId: null,
      memberUserIds: ['u-minh'],
      dueDate: null,
      source: { conversationId: 'dm:a:b', messageId: 'm-1', scope: 'message' },
    };
    const values = draftToInitialValues(manual);
    expect(values.source).toEqual(manual.source);
    expect(values.draft).toBeUndefined();
    expect(values.assigneeUserId).toBeNull();
    expect(values.memberUserIds).toEqual(['u-minh']);
    expect(values.unresolvedNames).toEqual([]);
    expect(values.due).toBeNull();
  });

  test('draftToInitialValues: a draft without a source never sends a draft reference', () => {
    const values = draftToInitialValues(agentDraft({ source: null }), 'agent:c-1', 0);
    expect(values.source).toBeUndefined();
    expect(values.draft).toBeUndefined();
  });

  test('taskSourceLink: a thread opens the thread panel, a message jumps to the message', () => {
    expect(taskSourceLink({ conversationId: 'g-1', messageId: 'm-root', scope: 'thread' })).toBe('/chat/g-1?thread=m-root');
    expect(taskSourceLink({ conversationId: 'g-1', messageId: 'm-7', scope: 'message' })).toBe('/chat/g-1?message=m-7');
  });

  test('unresolvedNamesHint lists the names with @, or nothing when all matched', () => {
    expect(unresolvedNamesHint(['A', 'B'])).toBe('Chưa khớp tên: @A, @B. Chọn lại người trong danh sách.');
    expect(unresolvedNamesHint([])).toBeNull();
    expect(unresolvedNamesHint(undefined)).toBeNull();
  });
});