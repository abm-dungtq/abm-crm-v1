import { ThreadType, type API, type Message } from 'zca-js';
import { describe, expect, it, vi } from 'vitest';
import { imageDimensions, normalizeMessage, openZcaSession, type ZaloSendReply } from '../src/zalo-client';

const OWN = 'bot-1';

function groupMessage(partial: {
  msgId?: string;
  uidFrom?: string;
  content?: unknown;
  mentions?: { uid: string; pos: number; len: number; type: 0 | 1 }[];
  quote?: { ownerId: string };
  msgType?: string;
  cliMsgId?: string;
  ts?: string;
  ttl?: number;
  propertyExt?: { color: number; size: number; type: number; subType: number; ext: string };
} = {}): Message {
  return {
    type: ThreadType.Group,
    threadId: 'g1',
    isSelf: false,
    data: {
      msgId: partial.msgId ?? 'm1',
      cliMsgId: partial.cliMsgId ?? 'c1',
      msgType: partial.msgType ?? 'webchat',
      uidFrom: partial.uidFrom ?? 'user-1',
      dName: 'Hùng',
      ts: partial.ts ?? '1710000000000',
      content: partial.content ?? 'câu hỏi',
      ttl: partial.ttl ?? 0,
      propertyExt: partial.propertyExt,
      mentions: partial.mentions,
      quote: partial.quote,
    },
  } as Message;
}

function directMessage(quote?: { ownerId: string }): Message {
  return {
    type: ThreadType.User,
    threadId: 'user-1',
    isSelf: false,
    data: {
      msgId: 'd1', uidFrom: 'user-1', dName: 'Hùng', content: 'chào', ts: '1710000000000', quote,
    },
  } as Message;
}

describe('normalizeMessage', () => {
  it('marks a mention of the bot and not a mention of someone else', () => {
    const mentioned = normalizeMessage(groupMessage({
      mentions: [{ uid: OWN, pos: 0, len: 4, type: 0 }],
    }), OWN);
    expect(mentioned).toMatchObject({ mentionsSelf: true, quotesSelf: false, threadKind: 'group' });
    const other = normalizeMessage(groupMessage({
      mentions: [{ uid: 'someone', pos: 0, len: 3, type: 0 }],
    }), OWN);
    expect(other).toMatchObject({ mentionsSelf: false, quotesSelf: false });
  });

  it('does not count an @all mention', () => {
    expect(normalizeMessage(groupMessage({
      mentions: [{ uid: OWN, pos: 0, len: 3, type: 1 }],
    }), OWN)?.mentionsSelf).toBe(false);
    expect(normalizeMessage(groupMessage({
      mentions: [{ uid: '-1', pos: 0, len: 3, type: 0 }],
    }), OWN)?.mentionsSelf).toBe(false);
    expect(normalizeMessage(groupMessage({
      mentions: [
        { uid: '-1', pos: 0, len: 3, type: 1 },
        { uid: OWN, pos: 4, len: 4, type: 0 },
      ],
    }), OWN)?.mentionsSelf).toBe(true);
  });

  it('marks a quote of the bot and not a quote of someone else', () => {
    expect(normalizeMessage(groupMessage({ quote: { ownerId: OWN } }), OWN)?.quotesSelf).toBe(true);
    expect(normalizeMessage(groupMessage({ quote: { ownerId: 'someone' } }), OWN)?.quotesSelf).toBe(false);
  });

  it('is false when the fields are absent and on a direct message', () => {
    expect(normalizeMessage(groupMessage(), OWN)).toMatchObject({ mentionsSelf: false, quotesSelf: false });
    expect(normalizeMessage(directMessage({ ownerId: OWN }), OWN)).toMatchObject({
      threadKind: 'direct', mentionsSelf: false, quotesSelf: false,
    });
    expect(normalizeMessage(directMessage(), OWN)).toMatchObject({ mentionsSelf: false, quotesSelf: false });
  });
});

function harness() {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const sendMessage = vi.fn(async (..._args: unknown[]) => ({ message: { msgId: 77 }, attachment: [] as { msgId: number }[] }));
  const getGroupInfo = vi.fn();
  const getGroupMembersInfo = vi.fn();
  const api = {
    getOwnId: () => OWN,
    sendMessage,
    getGroupInfo,
    getGroupMembersInfo,
    listener: {
      on(event: string, cb: (...args: unknown[]) => void) { handlers.set(event, cb); },
      start() {},
      stop() {},
    },
  };
  const session = openZcaSession(api as unknown as API);
  return {
    session,
    sendMessage,
    getGroupInfo,
    getGroupMembersInfo,
    deliver: (message: Message) => handlers.get('message')?.(message),
  };
}

const propertyExt = { color: 1, size: 2, type: 3, subType: 4, ext: 'x' };

function cachedAsk(): Message {
  return groupMessage({
    msgId: 'ask-1',
    uidFrom: 'user-9',
    content: 'học phí',
    msgType: 'webchat',
    cliMsgId: 'cli-9',
    ts: '1710000000001',
    ttl: 0,
    propertyExt,
  });
}

const quoteOfAsk = {
  content: 'học phí',
  msgType: 'webchat',
  propertyExt,
  uidFrom: 'user-9',
  msgId: 'ask-1',
  cliMsgId: 'cli-9',
  ts: '1710000000001',
  ttl: 0,
};

const reply: ZaloSendReply = { msgId: 'ask-1', senderId: 'user-9', senderName: 'Hùng' };
const mention = { pos: 0, uid: 'user-9', len: 'Hùng'.length + 1 };

describe('imageDimensions', () => {
  it('reads a JPEG SOF after fill bytes, a restart marker, and a Huffman table', () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xd0,
      0xff, 0xff, 0xc4, 0x00, 0x04, 0x00, 0x00,
      0xff, 0xc5, 0x00, 0x08, 0x08, 0x00, 0x14, 0x00, 0x28, 0x01,
    ]);
    expect(imageDimensions(jpeg, 'image/jpeg')).toEqual({ width: 40, height: 20 });
  });
});

describe('ZcaSession.send files', () => {
  it('passes one attachment and collects message ids from the attachment result', async () => {
    const { session, sendMessage } = harness();
    const data = new Uint8Array([1, 2, 3, 4]);
    sendMessage.mockResolvedValueOnce({
      message: { msgId: 10 },
      attachment: [{ msgId: 11 }, { msgId: 12 }],
    });
    const sent = await session.send('user-9', 'direct', '', undefined, [{
      data, filename: 'a.jpg', mimeType: 'image/jpeg', width: 8, height: 6,
    }]);
    expect(sendMessage).toHaveBeenCalledWith({
      msg: '',
      attachments: [{
        data: Buffer.from(data),
        filename: 'a.jpg',
        metadata: { totalSize: 4, width: 8, height: 6 },
      }],
    }, 'user-9', ThreadType.User);
    expect(sent).toEqual({ msgId: '10', msgIds: ['10', '11', '12'] });
  });
});

describe('group reply send', () => {
  it('quotes the cached message and tags the sender', async () => {
    const { session, sendMessage, deliver } = harness();
    deliver(cachedAsk());
    await session.send('g1', 'group', 'xin chào', reply);
    expect(sendMessage).toHaveBeenCalledWith({
      msg: '@Hùng xin chào',
      mentions: [mention],
      quote: quoteOfAsk,
    }, 'g1', ThreadType.Group);
  });

  it('sends the mention without a quote when the message is not cached', async () => {
    const { session, sendMessage } = harness();
    await session.send('g1', 'group', 'xin chào', { ...reply, msgId: 'missing' });
    expect(sendMessage).toHaveBeenCalledWith({
      msg: '@Hùng xin chào',
      mentions: [mention],
    }, 'g1', ThreadType.Group);
  });

  it('ignores replyTo on a direct thread', async () => {
    const { session, sendMessage, deliver } = harness();
    deliver(cachedAsk());
    await session.send('user-9', 'direct', 'xin chào', reply);
    expect(sendMessage).toHaveBeenCalledWith({ msg: 'xin chào' }, 'user-9', ThreadType.User);
  });

  it('skips the mention when the sender name is blank and still quotes a cached message', async () => {
    const { session, sendMessage, deliver } = harness();
    deliver(cachedAsk());
    await session.send('g1', 'group', 'xin chào', { ...reply, senderName: '  ' });
    expect(sendMessage).toHaveBeenCalledWith({ msg: 'xin chào', quote: quoteOfAsk }, 'g1', ThreadType.Group);
  });

  it('forgets the oldest cached group message after 1000', async () => {
    const { session, sendMessage, deliver } = harness();
    for (let i = 0; i <= 1000; i += 1) {
      deliver(groupMessage({ msgId: `m-${i}`, content: `c${i}`, cliMsgId: `c-${i}` }));
    }
    const tag = { msgId: 'm-0', senderId: 'user-9', senderName: 'An' };
    await session.send('g1', 'group', 'a', tag);
    expect(sendMessage.mock.calls.at(-1)?.[0]).toEqual({
      msg: '@An a',
      mentions: [{ pos: 0, uid: 'user-9', len: 3 }],
    });
    await session.send('g1', 'group', 'b', { ...tag, msgId: 'm-1000' });
    expect(sendMessage.mock.calls.at(-1)?.[0]).toMatchObject({
      msg: '@An b',
      quote: { msgId: 'm-1000', content: 'c1000', cliMsgId: 'c-1000' },
    });
  });
});

describe('listGroupMembers', () => {
  it('reads uids from memVerList and prefers displayName over zaloName', async () => {
    const { session, getGroupInfo, getGroupMembersInfo } = harness();
    getGroupInfo.mockResolvedValue({
      gridInfoMap: {
        g1: {
          memVerList: ['111_2', 'abc_def_9'],
          currentMems: [{ id: 'ignored' }],
        },
      },
    });
    getGroupMembersInfo.mockResolvedValue({
      profiles: {
        '111': { displayName: 'An', zaloName: 'z-an' },
        abc_def: { displayName: '', zaloName: 'Bình' },
      },
    });
    expect(await session.listGroupMembers('g1')).toEqual([
      { id: '111', name: 'An' },
      { id: 'abc_def', name: 'Bình' },
    ]);
    expect(getGroupMembersInfo).toHaveBeenCalledWith(['111', 'abc_def']);
  });

  it('reads member profiles keyed with the _0 suffix zca-js asks for', async () => {
    const { session, getGroupInfo, getGroupMembersInfo } = harness();
    getGroupInfo.mockResolvedValue({ gridInfoMap: { g1: { memVerList: ['111_2'], currentMems: [] } } });
    getGroupMembersInfo.mockResolvedValue({ profiles: { '111_0': { displayName: 'An', zaloName: '' } } });
    expect(await session.listGroupMembers('g1')).toEqual([{ id: '111', name: 'An' }]);
  });

  it('falls back to currentMems when memVerList is empty and clips the name', async () => {
    const { session, getGroupInfo, getGroupMembersInfo } = harness();
    getGroupInfo.mockResolvedValue({
      gridInfoMap: { g1: { memVerList: [], currentMems: [{ id: '333' }] } },
    });
    getGroupMembersInfo.mockResolvedValue({
      profiles: { '333': { displayName: 'A'.repeat(250), zaloName: 'short' } },
    });
    expect(await session.listGroupMembers('g1')).toEqual([{ id: '333', name: 'A'.repeat(200) }]);
  });

  it('loads member profiles in batches of 50', async () => {
    const { session, getGroupInfo, getGroupMembersInfo } = harness();
    const verList = Array.from({ length: 51 }, (_, i) => `${i}_1`);
    getGroupInfo.mockResolvedValue({ gridInfoMap: { g1: { memVerList: verList, currentMems: [] } } });
    getGroupMembersInfo.mockImplementation(async (batch: string[]) => {
      const profiles: Record<string, { displayName: string; zaloName: string }> = {};
      for (const id of batch) profiles[id] = { displayName: id, zaloName: '' };
      return { profiles };
    });
    const members = await session.listGroupMembers('g1');
    expect(members).toHaveLength(51);
    expect(members[0]).toEqual({ id: '0', name: '0' });
    expect(members[50]).toEqual({ id: '50', name: '50' });
    expect(getGroupMembersInfo).toHaveBeenCalledTimes(2);
    expect(getGroupMembersInfo.mock.calls[0]?.[0]).toHaveLength(50);
    expect(getGroupMembersInfo.mock.calls[1]?.[0]).toEqual(['50']);
  });

  it('keeps an https member avatar and omits one that is not https', async () => {
    const { session, getGroupInfo, getGroupMembersInfo } = harness();
    getGroupInfo.mockResolvedValue({ gridInfoMap: { g1: { memVerList: ['111_1', '222_1'], currentMems: [] } } });
    getGroupMembersInfo.mockResolvedValue({
      profiles: {
        '111': { displayName: 'An', zaloName: '', avatar: 'https://photo.zalo.me/an.jpg' },
        '222': { displayName: 'Bình', zaloName: '', avatar: 'http://photo.zalo.me/binh.jpg' },
      },
    });
    expect(await session.listGroupMembers('g1')).toEqual([
      { id: '111', name: 'An', avatar: 'https://photo.zalo.me/an.jpg' },
      { id: '222', name: 'Bình' },
    ]);
  });
});
