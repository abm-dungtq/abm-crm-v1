/**
 * The only module that touches zca-js (2.2.0, MIT). Real API used, checked against the published package:
 *   new Zalo({ selfListen: true })                    selfListen is required, otherwise our own messages are dropped
 *   zalo.loginQR({ userAgent?, language? }, cb)       cb events (LoginQRCallbackEventType): QRCodeGenerated (data.image is
 *                                                     bare base64 PNG, valid ~100 s), QRCodeExpired, QRCodeScanned,
 *                                                     QRCodeDeclined (each with actions.retry / actions.abort), GotLoginInfo
 *   zalo.login({ imei, cookie, userAgent, language }) re-login from saved credentials
 *   api.getContext()                                  { imei, cookie: CookieJar, userAgent, language, ... }
 *   api.getOwnId()                                    Zalo uid of the logged-in number
 *   api.listener.on('message', m)                     m.type ThreadType.User | Group, m.threadId, m.isSelf,
 *                                                     m.data.msgId / content (string or object) / uidFrom / dName / ts
 *   api.listener.on('closed', (code, reason))         after zca-js gave up retrying; CloseReason 3000 = duplicate
 *                                                     web session, 3003 = kicked
 *   api.listener.start({ retryOnClose: true }) / stop()
 *   api.sendMessage({ msg }, threadId, ThreadType)    -> { message: { msgId: number } | null, attachment: [...] }
 *   api.getAllGroups()                                -> { gridVerMap: { [groupId]: version } }
 *   api.getGroupInfo(ids)                             -> { gridInfoMap: { [groupId]: { name, ... } } }
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CloseReason, LoginQRCallbackEventType, ThreadType, Zalo, type API, type Credentials, type Message } from 'zca-js';
import { z } from 'zod';
import { CodedError } from './config';

export type ThreadKind = 'direct' | 'group';

export interface ZaloAttachment { url: string; name?: string; mimeType?: string }

export interface IncomingMessage {
  threadId: string;
  threadKind: ThreadKind;
  msgId: string;
  fromSelf: boolean;
  senderId: string;
  senderName: string;
  text: string;
  attachments: ZaloAttachment[];
  /** ISO 8601 instant. */
  sentAt: string;
}

export interface ZaloGroup { threadId: string; name: string }

/** How a session ended. `fatal` means reconnecting with the same credentials will not help. */
export interface SessionClose { code: string; fatal: boolean }

export interface QrCode {
  /** data:image/png;base64,... */
  imageDataUrl: string;
  expiresAt: Date;
}

export interface ZaloSession {
  /** Zalo uid of the logged-in number. */
  readonly ownId: string;
  send(threadId: string, threadKind: ThreadKind, text: string): Promise<{ msgId: string }>;
  listGroups(): Promise<ZaloGroup[]>;
  onMessage(cb: (message: IncomingMessage) => void): void;
  /** Called once when the connection ends for good; not called after close(). */
  onClose(cb: (close: SessionClose) => void): void;
  /** Writes the credentials needed by loginWithSaved to `file` (atomic replace). */
  save(file: string): Promise<void>;
  close(): void;
}

export interface ZaloConnector {
  loginWithQr(onQr: (qr: QrCode) => void): Promise<ZaloSession>;
  loginWithSaved(file: string): Promise<ZaloSession>;
}

/** A QR code is valid this long (zca-js expires it after 100 s). */
const QR_TTL_MS = 100_000;
/** A login offers this many QR codes before giving up, which keeps it inside the Worker's 300 s command lease. */
const MAX_QR_CODES = 2;
const GROUP_INFO_BATCH = 50;
const MAX_GROUPS = 1000;
const MAX_TEXT = 20_000;

const savedSessionSchema = z.object({
  version: z.literal(1),
  imei: z.string().min(1),
  userAgent: z.string().min(1),
  language: z.string().optional(),
  cookie: z.array(z.record(z.string(), z.unknown())).min(1),
});

const clip = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Maps a zca-js message to the bridge shape; null when it lacks the identifiers the Worker needs. */
export function normalizeMessage(message: Message): IncomingMessage | null {
  const data = message.data;
  const msgId = String(data.msgId ?? '');
  const threadId = String(message.threadId ?? '');
  const senderId = String(data.uidFrom ?? '');
  if (!msgId || !threadId || !senderId) return null;
  const content: unknown = data.content;
  const attachments: ZaloAttachment[] = [];
  let text = '';
  if (typeof content === 'string') {
    text = clip(content, MAX_TEXT);
  } else if (content && typeof content === 'object') {
    const { href, title } = content as { href?: unknown; title?: unknown };
    if (isHttpUrl(href)) attachments.push({ url: href, ...(typeof title === 'string' && title ? { name: clip(title, 255) } : {}) });
  }
  const ts = Number(data.ts);
  return {
    threadId,
    threadKind: message.type === ThreadType.Group ? 'group' : 'direct',
    msgId,
    fromSelf: message.isSelf,
    senderId,
    senderName: clip(typeof data.dName === 'string' ? data.dName : '', 200),
    text,
    attachments,
    sentAt: new Date(Number.isFinite(ts) && ts > 0 ? ts : Date.now()).toISOString(),
  };
}

function closeOf(code: number): SessionClose {
  if (code === CloseReason.DuplicateConnection) return { code: 'ZALO_DUPLICATE_SESSION', fatal: true };
  if (code === CloseReason.KickConnection) return { code: 'ZALO_KICKED', fatal: true };
  return { code: `ZALO_CLOSED_${code}`, fatal: false };
}

class ZcaSession implements ZaloSession {
  readonly ownId: string;
  private readonly messageCallbacks: ((message: IncomingMessage) => void)[] = [];
  private readonly closeCallbacks: ((close: SessionClose) => void)[] = [];
  private stopped = false;

  constructor(private readonly api: API) {
    this.ownId = String(api.getOwnId());
    if (!this.ownId) throw new CodedError('ZALO_NO_OWN_ID');
    const listener = api.listener;
    listener.on('message', (raw) => {
      const message = normalizeMessage(raw);
      if (!message) return;
      for (const cb of this.messageCallbacks) cb(message);
    });
    // Without an 'error' listener an EventEmitter error would crash the process; zca-js closes and retries by itself.
    listener.on('error', () => {});
    listener.on('closed', (code) => {
      if (this.stopped) return;
      this.stopped = true;
      const close = closeOf(code);
      for (const cb of this.closeCallbacks) cb(close);
    });
    listener.start({ retryOnClose: true });
  }

  async send(threadId: string, threadKind: ThreadKind, text: string) {
    const result = await this.api.sendMessage({ msg: text }, threadId, threadKind === 'group' ? ThreadType.Group : ThreadType.User);
    const msgId = result.message?.msgId;
    if (msgId === undefined || msgId === null) throw new CodedError('ZALO_SEND_NO_MSG_ID');
    return { msgId: String(msgId) };
  }

  async listGroups(): Promise<ZaloGroup[]> {
    const all = await this.api.getAllGroups();
    const ids = Object.keys(all.gridVerMap ?? {}).slice(0, MAX_GROUPS);
    const groups: ZaloGroup[] = [];
    for (let i = 0; i < ids.length; i += GROUP_INFO_BATCH) {
      const info = await this.api.getGroupInfo(ids.slice(i, i + GROUP_INFO_BATCH));
      for (const [threadId, group] of Object.entries(info.gridInfoMap ?? {})) {
        if (threadId) groups.push({ threadId, name: clip(typeof group.name === 'string' ? group.name : '', 200) });
      }
    }
    return groups;
  }

  onMessage(cb: (message: IncomingMessage) => void) {
    this.messageCallbacks.push(cb);
  }

  onClose(cb: (close: SessionClose) => void) {
    this.closeCallbacks.push(cb);
  }

  async save(file: string) {
    const context = this.api.getContext();
    const cookies = context.cookie.toJSON()?.cookies ?? [];
    const saved: z.infer<typeof savedSessionSchema> = {
      version: 1, imei: context.imei, userAgent: context.userAgent, language: context.language,
      cookie: cookies as unknown as Record<string, unknown>[],
    };
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(saved), { encoding: 'utf8', mode: 0o600 });
    await rename(tmp, file);
  }

  close() {
    if (this.stopped) return;
    this.stopped = true;
    this.api.listener.stop();
  }
}

const newZalo = () => new Zalo({ selfListen: true, logging: false });

/** Logs in by QR code. Offers up to two codes; a declined or unscanned login rejects with QR_DECLINED / QR_EXPIRED. */
export async function loginWithQr(onQr: (qr: QrCode) => void): Promise<ZaloSession> {
  let codes = 0;
  let failure: string | null = null;
  try {
    const api = await newZalo().loginQR({ language: 'vi' }, (event) => {
      switch (event.type) {
        case LoginQRCallbackEventType.QRCodeGenerated:
          codes += 1;
          onQr({ imageDataUrl: `data:image/png;base64,${event.data.image}`, expiresAt: new Date(Date.now() + QR_TTL_MS) });
          return;
        case LoginQRCallbackEventType.QRCodeExpired:
          if (codes < MAX_QR_CODES) return event.actions.retry();
          failure = 'QR_EXPIRED';
          return event.actions.abort();
        case LoginQRCallbackEventType.QRCodeDeclined:
          failure = 'QR_DECLINED';
          return event.actions.abort();
        default:
          return;
      }
    });
    return new ZcaSession(api);
  } catch (error) {
    if (failure) throw new CodedError(failure);
    if (error instanceof CodedError) throw error;
    throw new CodedError('ZALO_LOGIN_FAILED');
  }
}

/** Logs in again with the credentials saved by ZaloSession.save. */
export async function loginWithSaved(file: string): Promise<ZaloSession> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    throw new CodedError('SESSION_FILE_MISSING');
  }
  let parsed: z.infer<typeof savedSessionSchema>;
  try {
    parsed = savedSessionSchema.parse(JSON.parse(raw));
  } catch {
    throw new CodedError('SESSION_FILE_INVALID');
  }
  // The file holds what CookieJar.toJSON() produced; zca-js parses each entry with Cookie.fromJSON.
  const credentials: Credentials = {
    imei: parsed.imei, userAgent: parsed.userAgent, language: parsed.language,
    cookie: parsed.cookie as unknown as Credentials['cookie'],
  };
  let api: API;
  try {
    api = await newZalo().login(credentials);
  } catch {
    throw new CodedError('ZALO_LOGIN_FAILED');
  }
  return new ZcaSession(api);
}

export const zcaConnector: ZaloConnector = { loginWithQr, loginWithSaved };
