import { describe, expect, test } from 'vitest';
import { buildChatFlow, buildThreadFlow, chatDayLabel, firstNewMessageId, vnTime, type ChatFlowItem } from '../src/web/chat-flow';
import { taskSourceSummary } from '../src/web/chat-task-draft';
import { filterConversations, hasUnread } from '../src/web/chat-tree';
import type { ChatConversationSummary, ChatMessage } from '../src/web/types';

function msg(id: string, createdAt: string, author: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    conversationId: 'g-1',
    authorKind: 'user',
    authorUserId: 'u-lan',
    authorAgentId: null,
    authorName: 'Đỗ Ngọc Lan',
    replyToMessageId: null,
    replyTo: null,
    threadRootId: null,
    alsoInMain: false,
    body: id,
    mentions: [],
    meta: null,
    createdAt,
    deleted: false,
    thread: null,
    ...author,
  };
}

const huy = { authorUserId: 'u-huy', authorName: 'Bùi Quang Huy' };
const shape = (items: ChatFlowItem[]) =>
  items.map((i) => (i.kind === 'message' ? `${i.message.id}${i.continued ? '+' : ''}` : i.kind === 'day' ? `[${i.label}]` : '[Tin mới]'));

// 27/10/2026 10:00 in Vietnam is 03:00Z.
const NOW = new Date('2026-10-27T05:00:00.000Z');

describe('chat day labels', () => {
  test('today, yesterday, then dd/MM/yyyy, by the Vietnam calendar day', () => {
    expect(chatDayLabel('2026-10-27T00:30:00.000Z', NOW)).toBe('Hôm nay');
    // 23:30 on 26/10 in Vietnam.
    expect(chatDayLabel('2026-10-26T16:30:00.000Z', NOW)).toBe('Hôm qua');
    // 06:59 on 26/10 in Vietnam, still yesterday although it is 25/10 in UTC.
    expect(chatDayLabel('2026-10-25T23:59:00.000Z', NOW)).toBe('Hôm qua');
    expect(chatDayLabel('2026-10-20T03:00:00.000Z', NOW)).toBe('20/10/2026');
    expect(chatDayLabel('2025-12-31T18:00:00.000Z', NOW)).toBe('01/01/2026');
    expect(chatDayLabel('not a date', NOW)).toBe('');
  });

  test('message times are HH:mm in Vietnam time', () => {
    expect(vnTime('2026-10-27T03:05:00.000Z')).toBe('10:05');
    expect(vnTime('2026-10-26T17:00:00.000Z')).toBe('00:00');
  });
});

describe('message grouping and day separators', () => {
  test('three messages from one author within 5 minutes share one avatar and name', () => {
    const items = buildChatFlow(
      [
        msg('a', '2026-10-27T03:00:00.000Z'),
        msg('b', '2026-10-27T03:02:00.000Z'),
        msg('c', '2026-10-27T03:05:00.000Z'),
      ],
      { now: NOW },
    );
    expect(shape(items)).toEqual(['[Hôm nay]', 'a', 'b+', 'c+']);
  });

  test('a new run starts after a gap over 5 minutes, another author, or a system message', () => {
    const items = buildChatFlow(
      [
        msg('a', '2026-10-27T03:00:00.000Z'),
        msg('b', '2026-10-27T03:05:01.000Z'),
        msg('c', '2026-10-27T03:06:00.000Z', huy),
        msg('d', '2026-10-27T03:06:30.000Z', { authorKind: 'system', authorUserId: null, authorName: null }),
        msg('e', '2026-10-27T03:07:00.000Z', { authorKind: 'system', authorUserId: null, authorName: null }),
        msg('f', '2026-10-27T03:07:30.000Z', huy),
      ],
      { now: NOW },
    );
    expect(shape(items)).toEqual(['[Hôm nay]', 'a', 'b', 'c', 'd', 'e', 'f']);
  });

  test('agents group by agent, not with people', () => {
    const agent = { authorKind: 'agent' as const, authorUserId: null, authorAgentId: 'ag-1', authorName: 'Trợ lý' };
    const items = buildChatFlow(
      [
        msg('a', '2026-10-27T03:00:00.000Z', agent),
        msg('b', '2026-10-27T03:01:00.000Z', agent),
        msg('c', '2026-10-27T03:01:30.000Z', { ...agent, authorAgentId: 'ag-2' }),
      ],
      { now: NOW },
    );
    expect(shape(items)).toEqual(['[Hôm nay]', 'a', 'b+', 'c']);
  });

  test('a day separator goes before each new day and breaks a run', () => {
    const items = buildChatFlow(
      [
        msg('a', '2026-10-20T03:00:00.000Z'),
        msg('b', '2026-10-26T16:58:00.000Z'),
        // 00:01 on 27/10 in Vietnam, three minutes after b.
        msg('c', '2026-10-26T17:01:00.000Z'),
        msg('d', '2026-10-26T17:02:00.000Z'),
      ],
      { now: NOW },
    );
    expect(shape(items)).toEqual(['[20/10/2026]', 'a', '[Hôm qua]', 'b', '[Hôm nay]', 'c', 'd+']);
  });

  test('only the last message of a run shows the time', () => {
    const items = buildChatFlow(
      [
        msg('a', '2026-10-27T03:00:00.000Z'),
        msg('b', '2026-10-27T03:01:00.000Z'),
        msg('c', '2026-10-27T03:02:00.000Z'),
        msg('d', '2026-10-27T03:03:00.000Z', huy),
        msg('e', '2026-10-27T03:20:00.000Z', huy),
      ],
      { now: NOW },
    );
    const ends = items.flatMap((i) => (i.kind === 'message' && i.endsRun ? [i.message.id] : []));
    expect(ends).toEqual(['c', 'd', 'e']);
  });

  test('a thread shows one day label across the root and its replies, and the first reply starts a run', () => {
    const { rootItems, replyItems } = buildThreadFlow(
      msg('root', '2026-10-27T03:00:00.000Z'),
      [
        msg('r1', '2026-10-27T03:01:00.000Z'),
        msg('r2', '2026-10-27T03:02:00.000Z'),
        msg('r3', '2026-10-28T01:00:00.000Z', huy),
      ],
      { now: NOW },
    );
    expect(shape(rootItems)).toEqual(['[Hôm nay]', 'root']);
    expect(shape(replyItems)).toEqual(['r1', 'r2+', '[28/10/2026]', 'r3']);
    expect(rootItems.at(-1)).toMatchObject({ kind: 'message', endsRun: true });
    expect(replyItems.flatMap((i) => (i.kind === 'message' && i.endsRun ? [i.message.id] : []))).toEqual(['r2', 'r3']);
  });

  test('a thread on an older day labels the replies of a later day only', () => {
    const { rootItems, replyItems } = buildThreadFlow(
      msg('root', '2026-10-26T03:00:00.000Z'),
      [msg('r1', '2026-10-27T03:00:00.000Z', huy)],
      { now: NOW },
    );
    expect(shape(rootItems)).toEqual(['[Hôm qua]', 'root']);
    expect(shape(replyItems)).toEqual(['[Hôm nay]', 'r1']);
    expect(shape(buildThreadFlow(msg('root', '2026-10-27T03:00:00.000Z'), [], { now: NOW }).replyItems)).toEqual([]);
  });

  test('an empty list has no rows', () => {
    expect(buildChatFlow([], { now: NOW })).toEqual([]);
  });
});

describe('"Tin mới" divider', () => {
  const list = [
    msg('a', '2026-10-27T03:00:00.000Z', huy),
    msg('b', '2026-10-27T03:01:00.000Z'),
    msg('c', '2026-10-27T03:02:00.000Z'),
    msg('d', '2026-10-27T03:03:00.000Z', huy),
    msg('e', '2026-10-27T03:04:00.000Z', huy),
  ];

  test('goes above the first message from someone else newer than the read marker', () => {
    // Lan read up to a; her own b and c do not count as new.
    expect(firstNewMessageId(list, '2026-10-27T03:00:00.000Z', 'u-lan')).toBe('d');
    // For Huy, b is the first message from someone else after his marker.
    expect(firstNewMessageId(list, '2026-10-27T03:00:30.000Z', 'u-huy')).toBe('b');
  });

  test('without a read marker the first message from someone else is new; when all is read there is none', () => {
    expect(firstNewMessageId(list, null, 'u-lan')).toBe('a');
    expect(firstNewMessageId(list, '2026-10-27T03:04:00.000Z', 'u-lan')).toBeNull();
    expect(firstNewMessageId(list, 'bad', 'u-lan')).toBeNull();
  });

  test('sits before that message and starts a new run there', () => {
    const items = buildChatFlow(list, { now: NOW, newMessageId: 'd' });
    expect(shape(items)).toEqual(['[Hôm nay]', 'a', 'b', 'c+', '[Tin mới]', 'd', 'e+']);
  });

  test('an unknown id adds no divider', () => {
    expect(shape(buildChatFlow(list, { now: NOW, newMessageId: 'zzz' }))).not.toContain('[Tin mới]');
  });
});

describe('conversation list filter', () => {
  const conv = (id: string, title: string, unread = 0, threadUnread = 0): ChatConversationSummary => ({
    id,
    kind: 'group',
    title,
    agentReadable: true,
    lastMessage: '',
    lastMessageAt: null,
    updatedAt: '2026-10-27T03:00:00.000Z',
    unread,
    threadUnread,
    mode: 'chat',
    departmentId: null,
    parentConversationId: null,
    parentTitle: null,
    system: false,
    lastReadAt: null,
  });
  const all = [conv('a', 'Dự án Lộc Thọ', 3), conv('b', 'Phòng Kinh doanh'), conv('c', 'Đội Đặt hàng', 0, 2)];

  test('search matches titles ignoring case and Vietnamese accents', () => {
    const ids = (q: string) => filterConversations(all, { query: q, unreadOnly: false }).map((c) => c.id);
    expect(ids('lộc')).toEqual(['a']);
    expect(ids('LOC tho')).toEqual(['a']);
    expect(ids('dat')).toEqual(['c']);
    expect(ids('  ')).toEqual(['a', 'b', 'c']);
    expect(ids('không có')).toEqual([]);
  });

  test('"Chưa đọc" keeps conversations with unread messages or unread followed-thread replies', () => {
    expect(hasUnread(all[1]!)).toBe(false);
    expect(filterConversations(all, { query: '', unreadOnly: true }).map((c) => c.id)).toEqual(['a', 'c']);
    expect(filterConversations(all, { query: 'loc', unreadOnly: true }).map((c) => c.id)).toEqual(['a']);
  });

  test('the open conversation stays under "Chưa đọc" after it is read, but search still applies to it', () => {
    expect(filterConversations(all, { query: '', unreadOnly: true, keepId: 'b' }).map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(filterConversations(all, { query: 'loc', unreadOnly: true, keepId: 'b' }).map((c) => c.id)).toEqual(['a']);
  });
});

describe('task source summary', () => {
  test('names the scope and quotes the source on one line with mentions as names', () => {
    expect(taskSourceSummary({ scope: 'message' }, 'Nhờ @[Bùi Quang Huy](user:u-huy)\ngửi báo giá')).toEqual({
      label: 'Từ một tin nhắn',
      note: 'Thẻ việc sẽ được gửi trả lời ngay tin này.',
      quote: 'Nhờ @Bùi Quang Huy gửi báo giá',
    });
    expect(taskSourceSummary({ scope: 'thread' })).toEqual({
      label: 'Từ cả chuỗi trả lời',
      note: 'Thẻ việc sẽ được gửi vào cuối chuỗi.',
      quote: null,
    });
  });

  test('cuts a long quote to 160 characters', () => {
    const quote = taskSourceSummary({ scope: 'message' }, 'a'.repeat(300)).quote!;
    expect(quote).toHaveLength(160);
    expect(quote.endsWith('…')).toBe(true);
  });
});
