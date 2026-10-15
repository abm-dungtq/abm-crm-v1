import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bridgeEventSchema, type BridgeEvent } from '@abm/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountManager, ECHO_HOLD_MS, GROUP_MEMBERS_REFRESH_MS, MAX_RECONNECT_FAILURES, PROFILE_LOOKUP_TIMEOUT_MS, reconnectDelayMs } from '../src/account-manager';
import { CodedError } from '../src/config';
import type { IncomingMessage, QrCode, SessionClose, ZaloConnector, ZaloSession, ZaloUserProfile } from '../src/zalo-client';

class FakeSession implements ZaloSession {
  readonly ownId = 'own-uid';
  messageCb: ((m: IncomingMessage) => void) | null = null;
  closeCb: ((c: SessionClose) => void) | null = null;
  closed = false;
  nextMsgId = 1000;
  send = vi.fn(async (): Promise<{ msgId: string; msgIds?: string[] }> => ({ msgId: String(this.nextMsgId++) }));
  getUserProfile = vi.fn(async (_userId: string): Promise<ZaloUserProfile | null> => null);
  listGroups = vi.fn(async () => [{ threadId: 'g1', name: 'Nhóm 1' }]);
  listGroupMembers = vi.fn(async (_groupId: string): Promise<{ id: string; name: string; avatar?: string }[]> => [{ id: 'mem-1', name: 'An' }]);
  onMessage(cb: (m: IncomingMessage) => void) { this.messageCb = cb; }
  onClose(cb: (c: SessionClose) => void) { this.closeCb = cb; }
  save = vi.fn(async (file: string) => { await writeFile(file, '{}'); });
  close() { this.closed = true; }
}

const selfMessage = (msgId: string): IncomingMessage => ({
  threadId: 'cust-1', threadKind: 'direct', msgId, fromSelf: true, senderId: 'own-uid', senderName: 'Shop',
  text: 'xin chào', attachments: [], sentAt: '2026-10-08T07:00:00.000Z', mentionsSelf: false, quotesSelf: false,
});

let dir: string;
let events: BridgeEvent[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zalo-bridge-test-'));
  events = [];
  vi.useFakeTimers();
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

function manager(connector: ZaloConnector, log?: (level: string, event: string, fields?: unknown) => void) {
  return new AccountManager({
    connector, sessionsDir: dir, emit: (batch) => events.push(...batch), memberScanDelayMs: 0,
    ...(log ? { log: (level, event, fields) => log(level, event, fields) } : {}),
  });
}

async function loggedIn() {
  const session = new FakeSession();
  const connector: ZaloConnector = {
    loginWithQr: vi.fn(async (onQr: (qr: QrCode) => void) => {
      onQr({ imageDataUrl: 'data:image/png;base64,AAAA' });
      return session;
    }),
    loginWithSaved: vi.fn(async () => session),
  };
  const accounts = manager(connector);
  await accounts.login('acc-1');
  await vi.advanceTimersByTimeAsync(0);
  return { accounts, session };
}

const messages = () => events.filter((e): e is Extract<BridgeEvent, { type: 'message' }> => e.type === 'message');

describe('AccountManager', () => {
  it('QR login pushes the QR, connected with the own uid, and the group list, and saves the session', async () => {
    await loggedIn();
    expect(events[0]).toEqual({ type: 'qr', accountId: 'acc-1', imageDataUrl: 'data:image/png;base64,AAAA' });
    expect(events).toContainEqual({ type: 'account_status', accountId: 'acc-1', accountExternalId: 'own-uid', status: 'connected' });
    expect(events).toContainEqual({ type: 'group_list', accountExternalId: 'own-uid', groups: [{ threadId: 'g1', name: 'Nhóm 1' }] });
    expect(await readdir(dir)).toEqual(['acc-1.json']);
  });

  it('reads a customer profile from the live session and returns null without one', async () => {
    const { accounts, session } = await loggedIn();
    session.getUserProfile.mockResolvedValueOnce({ name: 'Hùng', gender: 'male' });
    expect(await accounts.profile('acc-1', 'uid-9')).toEqual({ name: 'Hùng', gender: 'male' });
    expect(session.getUserProfile).toHaveBeenCalledWith('uid-9');
    expect(await accounts.profile('other', 'uid-9')).toBeNull();
    expect(session.getUserProfile).toHaveBeenCalledTimes(1);
  });

  it('tags an own message whose id the bridge just sent with the command id', async () => {
    const { accounts, session } = await loggedIn();
    const { msgId } = await accounts.send('acc-1', 'cust-1', 'direct', 'xin chào', 'cmd-7');
    session.messageCb!(selfMessage(msgId));
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatchObject({ msgId, fromSelf: true, commandId: 'cmd-7', accountExternalId: 'own-uid' });
  });

  it('records every attachment message id, including one that echoes before send() returns', async () => {
    const { accounts, session } = await loggedIn();
    session.send.mockResolvedValueOnce({ msgId: '1000', msgIds: ['1000', '1001'] });
    await accounts.send('acc-1', 'cust-1', 'direct', '', 'cmd-img');
    session.messageCb!({ ...selfMessage('1001'), text: '' });
    expect(messages()[0]).toMatchObject({ msgId: '1001', commandId: 'cmd-img' });

    session.send.mockImplementationOnce(async () => {
      session.messageCb!({ ...selfMessage('1002'), text: '' });
      return { msgId: '1002', msgIds: ['1002'] };
    });
    await accounts.send('acc-1', 'cust-1', 'direct', '', 'cmd-early');
    expect(messages().some((message) => message.msgId === '1002')).toBe(false);
    await vi.advanceTimersByTimeAsync(ECHO_HOLD_MS);
    expect(messages().find((message) => message.msgId === '1002')).toMatchObject({ commandId: 'cmd-early' });
  });

  it('matches an echo that arrives before send() returns, within the hold time', async () => {
    const { accounts, session } = await loggedIn();
    session.messageCb!(selfMessage('1000'));
    expect(messages()).toHaveLength(0);
    await accounts.send('acc-1', 'cust-1', 'direct', 'xin chào', 'cmd-8');
    await vi.advanceTimersByTimeAsync(ECHO_HOLD_MS);
    expect(messages()[0]).toMatchObject({ msgId: '1000', commandId: 'cmd-8' });
  });

  it('sends an own message the bridge did not send without a command id after the hold time', async () => {
    const { session } = await loggedIn();
    session.messageCb!(selfMessage('555'));
    await vi.advanceTimersByTimeAsync(ECHO_HOLD_MS);
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).not.toHaveProperty('commandId');
    expect(messages()[0]).toMatchObject({ msgId: '555', fromSelf: true, senderName: 'Shop' });
  });

  it('reports error after 10 failed reconnects, backing off 5 s, 10 s, 20 s ... up to 5 minutes', async () => {
    await writeFile(join(dir, 'acc-2.json'), '{}');
    const loginWithSaved = vi.fn(async () => {
      throw new CodedError('ZALO_LOGIN_FAILED');
    });
    const accounts = manager({ loginWithQr: vi.fn(), loginWithSaved });
    await accounts.startSaved();
    expect(loginWithSaved).toHaveBeenCalledTimes(1);

    for (let failures = 1; failures < MAX_RECONNECT_FAILURES; failures++) {
      expect(events.filter((e) => e.type === 'account_status')).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(reconnectDelayMs(failures));
    }
    expect(loginWithSaved).toHaveBeenCalledTimes(MAX_RECONNECT_FAILURES);
    expect(events).toEqual([{ type: 'account_status', accountId: 'acc-2', status: 'error', lastError: 'ZALO_LOGIN_FAILED' }]);

    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(loginWithSaved).toHaveBeenCalledTimes(MAX_RECONNECT_FAILURES);
    expect([0, 1, 2, 3, 4, 5, 6, 9].map(reconnectDelayMs)).toEqual([5000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000]);
  });

  it('reconnects with the saved session after a non-fatal close and reports a fatal one as error', async () => {
    const { session } = await loggedIn();
    session.closeCb!({ code: 'ZALO_CLOSED_1006', fatal: false });
    await vi.advanceTimersByTimeAsync(reconnectDelayMs(0));
    expect(events.filter((e) => e.type === 'account_status' && e.status === 'connected')).toHaveLength(2);

    session.closeCb!({ code: 'ZALO_KICKED', fatal: true });
    expect(events.at(-1)).toEqual({ type: 'account_status', accountId: 'acc-1', status: 'error', lastError: 'ZALO_KICKED' });
  });

  it('logout closes the session, deletes its file and reports disconnected', async () => {
    const { accounts, session } = await loggedIn();
    await accounts.logout('acc-1');
    expect(session.closed).toBe(true);
    expect(await readdir(dir)).toEqual([]);
    expect(events.at(-1)).toEqual({ type: 'account_status', accountId: 'acc-1', status: 'disconnected' });
    await expect(accounts.send('acc-1', 't', 'direct', 'x', 'c')).rejects.toThrow('ACCOUNT_NOT_CONNECTED');
  });

  it('refuses account ids that could escape the sessions directory or clobber the cleanup id list', async () => {
    const accounts = manager({ loginWithQr: vi.fn(), loginWithSaved: vi.fn() });
    await expect(accounts.login('../evil')).rejects.toThrow('INVALID_ACCOUNT_ID');
    await expect(accounts.logout('stateless-users')).rejects.toThrow('INVALID_ACCOUNT_ID');
  });

  it('forwards mention and quote flags on group messages and omits them on direct messages', async () => {
    const { session } = await loggedIn();
    session.messageCb!({
      threadId: 'g1', threadKind: 'group', msgId: 'm-g', fromSelf: false, senderId: 'u1', senderName: 'An',
      text: 'Long ơi', attachments: [], sentAt: '2026-10-13T01:00:00.000Z', mentionsSelf: true, quotesSelf: false,
    });
    expect(messages().at(-1)).toMatchObject({
      type: 'message', threadKind: 'group', msgId: 'm-g', mentionsSelf: true, quotesSelf: false,
    });
    session.messageCb!({
      threadId: 'cust-1', threadKind: 'direct', msgId: 'm-d', fromSelf: false, senderId: 'cust-1', senderName: 'Lan',
      text: 'chào', attachments: [], sentAt: '2026-10-13T01:00:01.000Z', mentionsSelf: true, quotesSelf: true,
    });
    await vi.advanceTimersByTimeAsync(0);
    const direct = messages().at(-1)!;
    expect(direct.threadKind).toBe('direct');
    expect(direct).not.toHaveProperty('mentionsSelf');
    expect(direct).not.toHaveProperty('quotesSelf');
  });

  it('puts the cached profile avatar on a direct customer message and looks the profile up once', async () => {
    const { session } = await loggedIn();
    session.getUserProfile.mockResolvedValue({ name: 'Lan', gender: 'female', avatar: 'https://photo.zalo.me/lan.jpg' });
    const direct = {
      threadId: 'cust-1', threadKind: 'direct' as const, msgId: 'm-d', fromSelf: false, senderId: 'cust-1', senderName: 'Lan',
      text: 'chào', attachments: [], sentAt: '2026-10-13T01:00:01.000Z', mentionsSelf: false, quotesSelf: false,
    };
    session.messageCb!(direct);
    await vi.advanceTimersByTimeAsync(0);
    expect(messages().at(-1)).toMatchObject({ msgId: 'm-d', senderAvatar: 'https://photo.zalo.me/lan.jpg' });
    expect(bridgeEventSchema.safeParse(messages().at(-1)).success).toBe(true);
    session.messageCb!({ ...direct, msgId: 'm-d2' });
    await vi.advanceTimersByTimeAsync(0);
    expect(session.getUserProfile).toHaveBeenCalledTimes(1);
    expect(messages().at(-1)).toMatchObject({ msgId: 'm-d2', senderAvatar: 'https://photo.zalo.me/lan.jpg' });
  });

  it('omits a direct avatar that is not https or is longer than 2000 characters', async () => {
    const { session } = await loggedIn();
    const direct = {
      threadId: 'cust-1', threadKind: 'direct' as const, msgId: 'm-http', fromSelf: false, senderId: 'cust-1', senderName: 'Lan',
      text: 'chào', attachments: [], sentAt: '2026-10-13T01:00:01.000Z', mentionsSelf: false, quotesSelf: false,
    };
    session.getUserProfile.mockResolvedValueOnce({ name: 'Lan', gender: null, avatar: 'http://photo.zalo.me/lan.jpg' });
    session.messageCb!(direct);
    await vi.advanceTimersByTimeAsync(0);
    expect(messages().at(-1)).toMatchObject({ msgId: 'm-http' });
    expect(messages().at(-1)).not.toHaveProperty('senderAvatar');

    session.getUserProfile.mockResolvedValueOnce({ name: 'Lan', gender: null, avatar: `https://photo.zalo.me/${'a'.repeat(2000)}` });
    session.messageCb!({ ...direct, msgId: 'm-long', senderId: 'cust-2' });
    await vi.advanceTimersByTimeAsync(0);
    expect(messages().at(-1)).toMatchObject({ msgId: 'm-long' });
    expect(messages().at(-1)).not.toHaveProperty('senderAvatar');
  });

  it('sends a direct customer message without an avatar when the profile lookup exceeds 5 seconds', async () => {
    const { session } = await loggedIn();
    session.getUserProfile.mockReturnValue(new Promise(() => {}));
    session.messageCb!({
      threadId: 'cust-1', threadKind: 'direct', msgId: 'm-slow', fromSelf: false, senderId: 'cust-1', senderName: 'Lan',
      text: 'chào', attachments: [], sentAt: '2026-10-13T01:00:01.000Z', mentionsSelf: false, quotesSelf: false,
    });
    await vi.advanceTimersByTimeAsync(PROFILE_LOOKUP_TIMEOUT_MS - 1);
    expect(messages().some((message) => message.msgId === 'm-slow')).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const sent = messages().find((message) => message.msgId === 'm-slow');
    expect(sent).toMatchObject({ msgId: 'm-slow', threadKind: 'direct' });
    expect(sent).not.toHaveProperty('senderAvatar');
  });

  it('puts a loaded member avatar on the roster and on that member message', async () => {
    const session = new FakeSession();
    session.listGroups.mockResolvedValue([{ threadId: 'g1', name: 'Nhóm A' }]);
    session.listGroupMembers.mockResolvedValue([
      { id: 'u1', name: 'An', avatar: 'https://photo.zalo.me/an.jpg' },
      { id: 'u2', name: 'Bình', avatar: 'http://photo.zalo.me/binh.jpg' },
    ]);
    const connector: ZaloConnector = { loginWithQr: vi.fn(async () => session), loginWithSaved: vi.fn() };
    const accounts = manager(connector);
    await accounts.login('acc-1');
    await vi.advanceTimersByTimeAsync(0);
    expect(events.filter((event) => event.type === 'group_members')).toEqual([
      {
        type: 'group_members', accountExternalId: 'own-uid', threadId: 'g1',
        members: [
          { id: 'u1', name: 'An', avatar: 'https://photo.zalo.me/an.jpg' },
          { id: 'u2', name: 'Bình' },
        ],
      },
    ]);
    session.messageCb!({
      threadId: 'g1', threadKind: 'group', msgId: 'm-g1', fromSelf: false, senderId: 'u1', senderName: 'An',
      text: 'chào', attachments: [], sentAt: '2026-10-13T01:00:00.000Z', mentionsSelf: false, quotesSelf: false,
    });
    expect(messages().at(-1)).toMatchObject({ msgId: 'm-g1', senderAvatar: 'https://photo.zalo.me/an.jpg' });
    session.messageCb!({
      threadId: 'g1', threadKind: 'group', msgId: 'm-g2', fromSelf: false, senderId: 'u2', senderName: 'Bình',
      text: 'chào', attachments: [], sentAt: '2026-10-13T01:00:01.000Z', mentionsSelf: false, quotesSelf: false,
    });
    expect(messages().at(-1)).toMatchObject({ msgId: 'm-g2' });
    expect(messages().at(-1)).not.toHaveProperty('senderAvatar');
  });

  it('passes replyTo through to the session', async () => {
    const { accounts, session } = await loggedIn();
    const reply = { msgId: 'm1', senderId: 'u1', senderName: 'Hùng' };
    await accounts.send('acc-1', 'g1', 'group', 'xin chào', 'cmd-9', reply);
    expect(session.send).toHaveBeenCalledWith('g1', 'group', 'xin chào', reply);
  });

  it('emits group_members after group_list and keeps going when one group fails', async () => {
    const session = new FakeSession();
    session.listGroups.mockResolvedValue([
      { threadId: 'g1', name: 'Nhóm A' },
      { threadId: 'g2', name: 'Nhóm B' },
    ]);
    session.listGroupMembers.mockImplementation(async (groupId: string) => {
      if (groupId === 'g1') throw new CodedError('ZALO_MEMBERS_FAILED');
      return [{ id: 'u2', name: 'Lan' }];
    });
    const logs: { event: string; fields?: unknown }[] = [];
    const connector: ZaloConnector = { loginWithQr: vi.fn(async () => session), loginWithSaved: vi.fn() };
    const accounts = manager(connector, (_level, event, fields) => logs.push({ event, fields }));
    await accounts.login('acc-1');
    await vi.advanceTimersByTimeAsync(0);
    const types = events.map((event) => event.type);
    const listAt = types.indexOf('group_list');
    const membersAt = types.indexOf('group_members');
    expect(listAt).toBeGreaterThanOrEqual(0);
    expect(membersAt).toBeGreaterThan(listAt);
    expect(events.filter((event) => event.type === 'group_members')).toEqual([
      { type: 'group_members', accountExternalId: 'own-uid', threadId: 'g2', members: [{ id: 'u2', name: 'Lan' }] },
    ]);
    expect(logs).toContainEqual({ event: 'account.group_members_failed', fields: { accountId: 'acc-1', code: 'ZALO_MEMBERS_FAILED' } });
    expect(JSON.stringify(logs)).not.toContain('Lan');
  });

  it('waits between groups and skips a refresh while a member scan is still running', async () => {
    const session = new FakeSession();
    session.listGroups.mockResolvedValue([
      { threadId: 'g1', name: 'Nhóm A' },
      { threadId: 'g2', name: 'Nhóm B' },
    ]);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    session.listGroupMembers.mockImplementation(async (groupId: string) => {
      if (groupId === 'g1') await held;
      return [];
    });
    const connector: ZaloConnector = { loginWithQr: vi.fn(async () => session), loginWithSaved: vi.fn() };
    const accounts = new AccountManager({ connector, sessionsDir: dir, emit: (batch) => events.push(...batch), memberScanDelayMs: 1000 });
    await accounts.login('acc-1');
    await vi.advanceTimersByTimeAsync(GROUP_MEMBERS_REFRESH_MS);
    expect(session.listGroups).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(session.listGroupMembers).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.listGroupMembers).toHaveBeenCalledTimes(2);
  });

  it('refreshes group members every 6 hours and clears the interval when the session closes', async () => {
    const { session } = await loggedIn();
    expect(GROUP_MEMBERS_REFRESH_MS).toBe(6 * 60 * 60 * 1000);
    expect(session.listGroups).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(GROUP_MEMBERS_REFRESH_MS);
    expect(session.listGroups).toHaveBeenCalledTimes(2);
    expect(events.filter((event) => event.type === 'group_members')).toHaveLength(2);
    session.closeCb!({ code: 'ZALO_KICKED', fatal: true });
    await vi.advanceTimersByTimeAsync(GROUP_MEMBERS_REFRESH_MS);
    expect(session.listGroups).toHaveBeenCalledTimes(2);
  });

  it('does not treat the GoClaw cleanup id list as a Zalo session', async () => {
    await writeFile(join(dir, 'stateless-users.json'), '{"version":1,"users":{}}');
    const loginWithSaved = vi.fn();
    await manager({ loginWithQr: vi.fn(), loginWithSaved }).startSaved();
    expect(loginWithSaved).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});
