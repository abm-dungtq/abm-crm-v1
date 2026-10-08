import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BridgeEvent } from '@abm/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountManager, ECHO_HOLD_MS, MAX_RECONNECT_FAILURES, reconnectDelayMs } from '../src/account-manager';
import { CodedError } from '../src/config';
import type { IncomingMessage, QrCode, SessionClose, ZaloConnector, ZaloSession } from '../src/zalo-client';

class FakeSession implements ZaloSession {
  readonly ownId = 'own-uid';
  messageCb: ((m: IncomingMessage) => void) | null = null;
  closeCb: ((c: SessionClose) => void) | null = null;
  closed = false;
  nextMsgId = 1000;
  send = vi.fn(async () => ({ msgId: String(this.nextMsgId++) }));
  listGroups = vi.fn(async () => [{ threadId: 'g1', name: 'Nhóm 1' }]);
  onMessage(cb: (m: IncomingMessage) => void) { this.messageCb = cb; }
  onClose(cb: (c: SessionClose) => void) { this.closeCb = cb; }
  save = vi.fn(async (file: string) => { await writeFile(file, '{}'); });
  close() { this.closed = true; }
}

const selfMessage = (msgId: string): IncomingMessage => ({
  threadId: 'cust-1', threadKind: 'direct', msgId, fromSelf: true, senderId: 'own-uid', senderName: 'Shop',
  text: 'xin chào', attachments: [], sentAt: '2026-10-08T07:00:00.000Z',
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

function manager(connector: ZaloConnector) {
  return new AccountManager({ connector, sessionsDir: dir, emit: (batch) => events.push(...batch) });
}

async function loggedIn() {
  const session = new FakeSession();
  const connector: ZaloConnector = {
    loginWithQr: vi.fn(async (onQr: (qr: QrCode) => void) => {
      onQr({ imageDataUrl: 'data:image/png;base64,AAAA', expiresAt: new Date('2026-10-08T07:01:40.000Z') });
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
    expect(events[0]).toEqual({ type: 'qr', accountId: 'acc-1', imageDataUrl: 'data:image/png;base64,AAAA', expiresAt: '2026-10-08T07:01:40.000Z' });
    expect(events).toContainEqual({ type: 'account_status', accountId: 'acc-1', accountExternalId: 'own-uid', status: 'connected' });
    expect(events).toContainEqual({ type: 'group_list', accountExternalId: 'own-uid', groups: [{ threadId: 'g1', name: 'Nhóm 1' }] });
    expect(await readdir(dir)).toEqual(['acc-1.json']);
  });

  it('tags an own message whose id the bridge just sent with the command id', async () => {
    const { accounts, session } = await loggedIn();
    const { msgId } = await accounts.send('acc-1', 'cust-1', 'direct', 'xin chào', 'cmd-7');
    session.messageCb!(selfMessage(msgId));
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatchObject({ msgId, fromSelf: true, commandId: 'cmd-7', accountExternalId: 'own-uid' });
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

  it('refuses account ids that could escape the sessions directory', async () => {
    const accounts = manager({ loginWithQr: vi.fn(), loginWithSaved: vi.fn() });
    await expect(accounts.login('../evil')).rejects.toThrow('INVALID_ACCOUNT_ID');
  });
});
