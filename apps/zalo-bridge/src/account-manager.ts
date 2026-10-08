import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { BridgeEvent } from '@abm/contracts';
import { CodedError, errorCode, silentLogger, type Logger } from './config';
import type { IncomingMessage, ThreadKind, ZaloConnector, ZaloSession } from './zalo-client';

/**
 * Session lifecycle of every Zalo account the bridge holds. One session file per CRM account id lives in
 * `sessionsDir/<accountId>.json`. A lost connection is retried after 5 s, 10 s, 20 s ... (at most 5 minutes);
 * after 10 failed attempts the account is reported as `error` and left alone until the next QR login.
 */

export const RECONNECT_BASE_MS = 5000;
export const RECONNECT_MAX_MS = 5 * 60_000;
export const MAX_RECONNECT_FAILURES = 10;
/** How long an own message waits for the send that produced it to be recorded. */
export const ECHO_HOLD_MS = 3000;
/** Sent message ids are remembered this long for echo matching. */
const SENT_ID_TTL_MS = 10 * 60_000;
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SESSION_SUFFIX = '.json';
/** Files in the sessions directory that are not Zalo sessions (the GoClaw cleanup's id list). */
export const STATELESS_USERS_FILE = 'stateless-users.json';
const RESERVED_FILE_NAMES = new Set([STATELESS_USERS_FILE.slice(0, -SESSION_SUFFIX.length)]);

/** Error codes for which retrying the saved session cannot succeed. */
const PERMANENT_SAVED_LOGIN_ERRORS = new Set(['SESSION_FILE_MISSING', 'SESSION_FILE_INVALID']);

export interface AccountManagerOptions {
  connector: ZaloConnector;
  sessionsDir: string;
  /** Hands events to the CRM client queue; must not throw. */
  emit: (events: BridgeEvent[]) => void;
  log?: Logger;
}

interface Account {
  accountId: string;
  session: ZaloSession | null;
  externalId: string | null;
  failures: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  loggingIn: boolean;
}

export function reconnectDelayMs(failures: number): number {
  return Math.min(RECONNECT_BASE_MS * 2 ** Math.max(failures, 0), RECONNECT_MAX_MS);
}

export class AccountManager {
  private readonly accounts = new Map<string, Account>();
  /** msgId of a message the bridge sent -> the send_zalo command that sent it. */
  private readonly sent = new Map<string, { commandId: string; at: number }>();
  private readonly holds = new Set<ReturnType<typeof setTimeout>>();
  private readonly log: Logger;
  private stopped = false;

  constructor(private readonly options: AccountManagerOptions) {
    this.log = options.log ?? silentLogger;
  }

  /** Logs in again every account that has a saved session. Failures go through the reconnect backoff. */
  async startSaved(): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.options.sessionsDir);
    } catch {
      return;
    }
    const ids = names.filter((n) => n.endsWith(SESSION_SUFFIX)).map((n) => n.slice(0, -SESSION_SUFFIX.length))
      .filter((id) => ACCOUNT_ID.test(id) && !RESERVED_FILE_NAMES.has(id));
    await Promise.all(ids.map((accountId) => this.reconnect(this.account(accountId))));
  }

  /** QR login for a CRM account: pushes the QR, then connected + group list. Rejects with a CodedError on failure. */
  async login(accountId: string): Promise<void> {
    const account = this.account(this.checkId(accountId));
    if (account.loggingIn) throw new CodedError('LOGIN_IN_PROGRESS');
    account.loggingIn = true;
    this.cancelReconnect(account);
    this.closeSession(account);
    try {
      const session = await this.options.connector.loginWithQr((qr) => {
        this.options.emit([{ type: 'qr', accountId, imageDataUrl: qr.imageDataUrl, expiresAt: qr.expiresAt.toISOString() }]);
      });
      if (this.stopped) {
        session.close();
        throw new CodedError('BRIDGE_STOPPING');
      }
      try {
        await session.save(this.sessionFile(accountId));
      } catch {
        session.close();
        throw new CodedError('SESSION_SAVE_FAILED');
      }
      this.attach(account, session);
      this.log('info', 'account.logged_in', { accountId });
    } catch (error) {
      const code = errorCode(error);
      this.log('error', 'account.login_failed', { accountId, code });
      this.options.emit([{ type: 'account_status', accountId, status: 'error', lastError: code }]);
      throw error instanceof CodedError ? error : new CodedError(code);
    } finally {
      account.loggingIn = false;
    }
  }

  /** Closes the session, deletes its file and reports the account disconnected. */
  async logout(accountId: string): Promise<void> {
    this.checkId(accountId);
    const account = this.accounts.get(accountId);
    if (account) {
      this.cancelReconnect(account);
      this.closeSession(account);
      this.accounts.delete(accountId);
    }
    await rm(this.sessionFile(accountId), { force: true });
    this.log('info', 'account.logged_out', { accountId });
    this.options.emit([{ type: 'account_status', accountId, status: 'disconnected' }]);
  }

  /** Sends text from the account and remembers the message id so its echo carries `commandId`. */
  async send(accountId: string, threadId: string, threadKind: ThreadKind, text: string, commandId: string): Promise<{ msgId: string }> {
    const session = this.accounts.get(accountId)?.session;
    if (!session) throw new CodedError('ACCOUNT_NOT_CONNECTED');
    const result = await session.send(threadId, threadKind, text);
    const now = Date.now();
    for (const [msgId, entry] of this.sent) if (now - entry.at > SENT_ID_TTL_MS) this.sent.delete(msgId);
    this.sent.set(result.msgId, { commandId, at: now });
    return result;
  }

  /** Stops every session and timer; used on shutdown. */
  stopAll(): void {
    this.stopped = true;
    for (const timer of this.holds) clearTimeout(timer);
    this.holds.clear();
    for (const account of this.accounts.values()) {
      this.cancelReconnect(account);
      this.closeSession(account);
    }
  }

  private checkId(accountId: string): string {
    if (!ACCOUNT_ID.test(accountId) || RESERVED_FILE_NAMES.has(accountId)) throw new CodedError('INVALID_ACCOUNT_ID');
    return accountId;
  }

  private sessionFile(accountId: string) {
    return join(this.options.sessionsDir, `${accountId}${SESSION_SUFFIX}`);
  }

  private account(accountId: string): Account {
    let account = this.accounts.get(accountId);
    if (!account) {
      account = { accountId, session: null, externalId: null, failures: 0, reconnectTimer: null, loggingIn: false };
      this.accounts.set(accountId, account);
    }
    return account;
  }

  private attach(account: Account, session: ZaloSession) {
    account.session = session;
    account.externalId = session.ownId;
    account.failures = 0;
    const { accountId } = account;
    const externalId = session.ownId;
    session.onMessage((message) => this.onMessage(externalId, message));
    session.onClose((close) => {
      if (account.session !== session) return;
      account.session = null;
      this.log('warn', 'account.closed', { accountId, code: close.code });
      if (close.fatal) {
        this.options.emit([{ type: 'account_status', accountId, status: 'error', lastError: close.code }]);
      } else {
        this.scheduleReconnect(account);
      }
    });
    this.options.emit([{ type: 'account_status', accountId, accountExternalId: externalId, status: 'connected' }]);
    void this.pushGroups(accountId, externalId, session);
  }

  private async pushGroups(accountId: string, externalId: string, session: ZaloSession) {
    try {
      const groups = await session.listGroups();
      this.options.emit([{ type: 'group_list', accountExternalId: externalId, groups }]);
    } catch (error) {
      this.log('warn', 'account.group_list_failed', { accountId, code: errorCode(error) });
    }
  }

  private async reconnect(account: Account): Promise<void> {
    account.reconnectTimer = null;
    if (this.stopped || account.session || account.loggingIn) return;
    try {
      const session = await this.options.connector.loginWithSaved(this.sessionFile(account.accountId));
      if (this.stopped || account.loggingIn || !this.accounts.has(account.accountId)) {
        session.close();
        return;
      }
      this.attach(account, session);
      this.log('info', 'account.reconnected', { accountId: account.accountId });
    } catch (error) {
      const code = errorCode(error);
      account.failures += 1;
      this.log('warn', 'account.reconnect_failed', { accountId: account.accountId, code, failures: account.failures });
      if (PERMANENT_SAVED_LOGIN_ERRORS.has(code) || account.failures >= MAX_RECONNECT_FAILURES) {
        this.options.emit([{ type: 'account_status', accountId: account.accountId, status: 'error', lastError: code }]);
        return;
      }
      this.scheduleReconnect(account);
    }
  }

  private scheduleReconnect(account: Account) {
    if (this.stopped || account.reconnectTimer) return;
    account.reconnectTimer = setTimeout(() => void this.reconnect(account), reconnectDelayMs(account.failures));
  }

  private cancelReconnect(account: Account) {
    if (account.reconnectTimer) clearTimeout(account.reconnectTimer);
    account.reconnectTimer = null;
  }

  private closeSession(account: Account) {
    const session = account.session;
    account.session = null;
    session?.close();
  }

  private onMessage(externalId: string, message: IncomingMessage) {
    if (!message.fromSelf || this.sent.has(message.msgId)) {
      this.emitMessage(externalId, message);
      return;
    }
    // The echo of our own send can arrive before send() returns its id: hold it briefly.
    const timer = setTimeout(() => {
      this.holds.delete(timer);
      this.emitMessage(externalId, message);
    }, ECHO_HOLD_MS);
    this.holds.add(timer);
  }

  private emitMessage(externalId: string, message: IncomingMessage) {
    const commandId = message.fromSelf ? this.sent.get(message.msgId)?.commandId : undefined;
    this.options.emit([{
      type: 'message',
      accountExternalId: externalId,
      threadId: message.threadId,
      threadKind: message.threadKind,
      msgId: message.msgId,
      fromSelf: message.fromSelf,
      senderExternalId: message.senderId,
      senderName: message.senderName,
      text: message.text,
      sentAt: message.sentAt,
      ...(message.attachments.length ? { attachments: message.attachments.slice(0, 20) } : {}),
      ...(commandId ? { commandId } : {}),
    }]);
  }
}
