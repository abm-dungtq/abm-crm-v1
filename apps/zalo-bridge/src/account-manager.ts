import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { BridgeEvent } from '@abm/contracts';
import { CodedError, errorCode, silentLogger, type Logger } from './config';
import { httpsAvatarUrl, type IncomingMessage, type ThreadKind, type ZaloConnector, type ZaloGroup, type ZaloOutgoingFile, type ZaloSendReply, type ZaloSession, type ZaloUserProfile } from './zalo-client';

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
/** How often a live session pushes its group list and member lists again. */
export const GROUP_MEMBERS_REFRESH_MS = 6 * 60 * 60 * 1000;
/** A found Zalo profile is reused for a day; an explicit miss is reused for an hour. A failure is not cached. */
const PROFILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PROFILE_NULL_TTL_MS = 60 * 60 * 1000;
/** A direct-message profile lookup that takes longer than this is sent without an avatar. */
export const PROFILE_LOOKUP_TIMEOUT_MS = 5000;
const MAX_PROFILE_CACHE = 2000;
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
  /** Pause between two groups' member lookups, so a scan does not burst Zalo's API. Default 1.5 s. */
  memberScanDelayMs?: number;
}

const MEMBER_SCAN_DELAY_MS = 1500;

interface Account {
  accountId: string;
  session: ZaloSession | null;
  externalId: string | null;
  failures: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  /** Repeats pushGroups while the session is open. */
  groupRefresh: ReturnType<typeof setInterval> | null;
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
  /** Sessions whose group scan is still running; a timer tick during a scan is skipped. A new session after a reconnect scans at once. */
  private readonly scanning = new Set<ZaloSession>();
  /** Zalo profile per `accountId:zaloUserId`. Shared by inbound avatars and the bot-prompt lookup. */
  private readonly profileCache = new Map<string, { profile: ZaloUserProfile | null; expiresAt: number }>();
  private readonly profileInflight = new Map<string, Promise<ZaloUserProfile | null>>();
  /** https avatar of a group member, keyed by `accountExternalId:memberId`, filled by the member scan. */
  private readonly memberAvatars = new Map<string, string>();
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
        this.options.emit([{ type: 'qr', accountId, imageDataUrl: qr.imageDataUrl }]);
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

  /**
   * Sends text or images from the account and remembers every returned message id, including ids that
   * arrive on `result.attachment`, so each echo carries `commandId`. The ids are stored before this returns.
   */
  async send(
    accountId: string,
    threadId: string,
    threadKind: ThreadKind,
    text: string,
    commandId: string,
    reply?: ZaloSendReply,
    files?: ZaloOutgoingFile[],
  ): Promise<{ msgId: string; msgIds: string[] }> {
    const session = this.accounts.get(accountId)?.session;
    if (!session) throw new CodedError('ACCOUNT_NOT_CONNECTED');
    const result = files?.length
      ? await session.send(threadId, threadKind, text, reply, files)
      : await session.send(threadId, threadKind, text, reply);
    const ids = result.msgIds?.length ? result.msgIds : [result.msgId];
    const now = Date.now();
    for (const [msgId, entry] of this.sent) if (now - entry.at > SENT_ID_TTL_MS) this.sent.delete(msgId);
    for (const msgId of ids) this.sent.set(msgId, { commandId, at: now });
    return { msgId: ids[0] ?? result.msgId, msgIds: ids };
  }

  /**
   * Profile of a Zalo user on this account. Null when the account has no live session.
   * A found profile is cached for 24 hours and an explicit miss for 1 hour. A thrown lookup is not cached.
   * Calls already in flight for the same user share one `getUserInfo`. A missing session is not cached.
   */
  async profile(accountId: string, zaloUserId: string): Promise<ZaloUserProfile | null> {
    const session = this.accounts.get(accountId)?.session;
    if (!session) return null;
    const key = `${accountId}:${zaloUserId}`;
    const cached = this.profileCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      this.profileCache.delete(key);
      this.profileCache.set(key, cached);
      return cached.profile;
    }
    const pending = this.profileInflight.get(key);
    if (pending) return pending;
    const work = session.getUserProfile(zaloUserId).then((profile) => {
      this.rememberProfile(key, profile);
      return profile;
    });
    this.profileInflight.set(key, work);
    void work.catch(() => {}).finally(() => {
      if (this.profileInflight.get(key) === work) this.profileInflight.delete(key);
    });
    return work;
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
      account = { accountId, session: null, externalId: null, failures: 0, reconnectTimer: null, groupRefresh: null, loggingIn: false };
      this.accounts.set(accountId, account);
    }
    return account;
  }

  private attach(account: Account, session: ZaloSession) {
    this.clearGroupRefresh(account);
    account.session = session;
    account.externalId = session.ownId;
    account.failures = 0;
    const { accountId } = account;
    const externalId = session.ownId;
    session.onMessage((message) => this.onMessage(externalId, message));
    session.onClose((close) => {
      if (account.session !== session) return;
      this.clearGroupRefresh(account);
      account.session = null;
      this.log('warn', 'account.closed', { accountId, code: close.code });
      if (close.fatal) {
        this.options.emit([{ type: 'account_status', accountId, status: 'error', lastError: close.code }]);
      } else {
        this.scheduleReconnect(account);
      }
    });
    this.options.emit([{ type: 'account_status', accountId, accountExternalId: externalId, status: 'connected' }]);
    account.groupRefresh = setInterval(() => {
      if (this.stopped || account.session !== session) return;
      void this.pushGroups(accountId, externalId, session);
    }, GROUP_MEMBERS_REFRESH_MS);
    void this.pushGroups(accountId, externalId, session);
  }

  private clearGroupRefresh(account: Account) {
    if (account.groupRefresh) clearInterval(account.groupRefresh);
    account.groupRefresh = null;
  }

  private async pushGroups(accountId: string, externalId: string, session: ZaloSession) {
    if (this.scanning.has(session)) return;
    this.scanning.add(session);
    try {
      await this.scanGroups(accountId, externalId, session);
    } finally {
      this.scanning.delete(session);
    }
  }

  private async scanGroups(accountId: string, externalId: string, session: ZaloSession) {
    let groups: ZaloGroup[];
    try {
      groups = await session.listGroups();
    } catch (error) {
      this.log('warn', 'account.group_list_failed', { accountId, code: errorCode(error) });
      return;
    }
    this.options.emit([{ type: 'group_list', accountExternalId: externalId, groups }]);
    const delayMs = this.options.memberScanDelayMs ?? MEMBER_SCAN_DELAY_MS;
    for (const [index, group] of groups.entries()) {
      if (this.stopped || this.accounts.get(accountId)?.session !== session) return;
      if (index > 0 && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      try {
        const loaded = await session.listGroupMembers(group.threadId);
        const members = loaded.map((member) => {
          const avatar = httpsAvatarUrl(member.avatar);
          if (avatar) this.memberAvatars.set(`${externalId}:${member.id}`, avatar);
          return { id: member.id, name: member.name, ...(avatar ? { avatar } : {}) };
        });
        this.options.emit([{ type: 'group_members', accountExternalId: externalId, threadId: group.threadId, members }]);
      } catch (error) {
        this.log('warn', 'account.group_members_failed', { accountId, code: errorCode(error) });
      }
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
    this.clearGroupRefresh(account);
    const session = account.session;
    account.session = null;
    session?.close();
  }

  private rememberProfile(key: string, profile: ZaloUserProfile | null) {
    this.profileCache.delete(key);
    this.profileCache.set(key, {
      profile,
      expiresAt: Date.now() + (profile ? PROFILE_CACHE_TTL_MS : PROFILE_NULL_TTL_MS),
    });
    while (this.profileCache.size > MAX_PROFILE_CACHE) {
      const oldest = this.profileCache.keys().next().value;
      if (oldest === undefined) break;
      this.profileCache.delete(oldest);
    }
  }

  private accountForExternalId(externalId: string): Account | undefined {
    for (const account of this.accounts.values()) {
      if (account.externalId === externalId && account.session) return account;
    }
    return undefined;
  }

  private onMessage(externalId: string, message: IncomingMessage) {
    const deliver = () => {
      // Only a customer's direct message waits on the profile. Own messages stay synchronous.
      if (message.threadKind === 'direct' && !message.fromSelf) {
        void this.deliverDirect(externalId, message);
        return;
      }
      this.emitMessage(externalId, message);
    };
    if (!message.fromSelf || this.sent.has(message.msgId)) {
      deliver();
      return;
    }
    // The echo of our own send can arrive before send() returns its id: hold it briefly.
    const timer = setTimeout(() => {
      this.holds.delete(timer);
      deliver();
    }, ECHO_HOLD_MS);
    this.holds.add(timer);
  }

  /** Looks up the sender avatar, then emits. A timeout or error emits the message without one and does not cache the failure. */
  private async deliverDirect(externalId: string, message: IncomingMessage) {
    const account = this.accountForExternalId(externalId);
    let senderAvatar: string | undefined;
    if (account) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const pending = this.profile(account.accountId, message.senderId);
        void pending.catch(() => {});
        const profile = await Promise.race([
          pending,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('PROFILE_TIMEOUT')), PROFILE_LOOKUP_TIMEOUT_MS);
          }),
        ]);
        senderAvatar = httpsAvatarUrl(profile?.avatar) ?? undefined;
      } catch {
        senderAvatar = undefined;
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    this.emitMessage(externalId, message, senderAvatar);
  }

  private emitMessage(externalId: string, message: IncomingMessage, senderAvatar?: string) {
    const commandId = message.fromSelf ? this.sent.get(message.msgId)?.commandId : undefined;
    const avatar = senderAvatar ?? (message.threadKind === 'group' ? this.memberAvatars.get(`${externalId}:${message.senderId}`) : undefined);
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
      ...(avatar ? { senderAvatar: avatar } : {}),
      ...(commandId ? { commandId } : {}),
      ...(message.threadKind === 'group' ? { mentionsSelf: message.mentionsSelf, quotesSelf: message.quotesSelf } : {}),
    }]);
  }
}
