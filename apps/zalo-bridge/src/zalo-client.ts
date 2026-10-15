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
 *                                                     group only: m.data.mentions?: { uid, pos, len, type }[] (type 1 or uid "-1" is @all)
 *                                                     m.data.quote?: { ownerId, cliMsgId, globalMsgId, ... }
 *   api.listener.on('closed', (code, reason))         after zca-js gave up retrying; CloseReason 3000 = duplicate
 *                                                     web session, 3003 = kicked
 *   api.listener.start({ retryOnClose: true }) / stop()
 *   api.sendMessage({ msg, mentions?, quote?, attachments? }, id, ThreadType)
 *                                                     quote copies content, msgType, propertyExt, uidFrom, msgId, cliMsgId, ts, ttl
 *                                                     attachments: { data: Buffer, filename, metadata: { totalSize, width?, height? } }
 *                                                     -> { message: { msgId: number } | null, attachment: [{ msgId }] }
 *   api.getAllGroups()                                -> { gridVerMap: { [groupId]: version } }
 *   api.getGroupInfo(ids)                             -> { gridInfoMap: { [groupId]: { name, memVerList, currentMems, ... } } }
 *   api.getGroupMembersInfo(ids)                      -> { profiles: { [id]: { displayName, zaloName, avatar, ... } } }
 *   api.getUserInfo(userId)                           -> { changed_profiles: { [userId | userId_0]: User } }
 *                                                     User.displayName, else User.zaloName; User.avatar (https only, else omitted)
 *                                                     Gender.Male = 0, Gender.Female = 1
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  CloseReason, Gender, LoginQRCallbackEventType, ThreadType, Zalo,
  type API, type Credentials, type GroupMemberProfile, type Message, type MessageContent,
  type SendMessageQuote, type TMessage, type UserInfoResponse,
} from 'zca-js';
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
  /** True when a group message @-mentions this account. Always false for a direct message and for @all. */
  mentionsSelf: boolean;
  /** True when a group message quotes a message this account sent. Always false for a direct message. */
  quotesSelf: boolean;
}

/** The group message a reply should quote, and the member it should tag. */
export interface ZaloSendReply {
  msgId: string;
  senderId: string;
  senderName: string;
}

/** One image handed to zca-js. `filename` must contain a dot; width and height are optional. */
export interface ZaloOutgoingFile {
  data: Uint8Array;
  filename: `${string}.${string}`;
  mimeType: 'image/jpeg' | 'image/png';
  width?: number;
  height?: number;
}

/** PNG IHDR at offset 16, or a JPEG SOF marker. Omitted when the bytes are not that image. */
export function imageDimensions(bytes: Uint8Array, mimeType: 'image/jpeg' | 'image/png'): { width?: number; height?: number } {
  if (mimeType === 'image/png') {
    if (bytes.byteLength < 24) return {};
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    if (width > 0 && height > 0 && width < 100_000 && height < 100_000) return { width, height };
    return {};
  }
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return {};
  let offset = 2;
  while (offset < bytes.byteLength) {
    if (bytes[offset] !== 0xff) return {};
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.byteLength) return {};
    const marker = bytes[offset]!;
    offset += 1;
    // Standalone markers: TEM, SOI, and RST0–RST7 carry no length.
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) return {};
    if (offset + 1 >= bytes.byteLength) return {};
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.byteLength) return {};
    // SOF0–SOF15 except DHT (C4), JPG (C8), and DAC (CC).
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (sof) {
      if (length < 7 || offset + 6 >= bytes.byteLength) return {};
      const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
      const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      if (width > 0 && height > 0) return { width, height };
      return {};
    }
    offset += length;
  }
  return {};
}

export interface ZaloGroup { threadId: string; name: string }

export type ZaloGender = 'male' | 'female' | null;

/** Display name and gender taken from a Zalo user profile. `name` is already clipped and cleaned. */
export interface ZaloUserProfile {
  name: string;
  gender: ZaloGender;
  /** https avatar of at most 2000 characters. Absent when Zalo has none or the URL is not https. */
  avatar?: string;
}

/** How a session ended. `fatal` means reconnecting with the same credentials will not help. */
export interface SessionClose { code: string; fatal: boolean }

export interface QrCode {
  /** data:image/png;base64,... The Worker, not this PC, decides when the code expires. */
  imageDataUrl: string;
}

export interface ZaloSession {
  /** Zalo uid of the logged-in number. */
  readonly ownId: string;
  send(
    threadId: string, threadKind: ThreadKind, text: string, reply?: ZaloSendReply, files?: ZaloOutgoingFile[],
  ): Promise<{ msgId: string; msgIds?: string[] }>;
  /** Profile of one Zalo user. Null when `changed_profiles` has no entry for that id. */
  getUserProfile(userId: string): Promise<ZaloUserProfile | null>;
  listGroups(): Promise<ZaloGroup[]>;
  /** Members of one group: Zalo uid, display name, and an https avatar when the profile has one. */
  listGroupMembers(groupId: string): Promise<{ id: string; name: string; avatar?: string }[]>;
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

/**
 * A login offers this many QR codes (zca-js expires each after about 100 s) before giving up.
 * The Worker gives a zalo_login claim a 450 s lease so four codes and the result still fit.
 */
const MAX_QR_CODES = 4;
const GROUP_INFO_BATCH = 50;
const MEMBER_INFO_BATCH = 50;
const MAX_GROUPS = 1000;
const MAX_GROUP_MEMBERS = 5000;
const MAX_TEXT = 20_000;
/** Recent incoming group messages kept so a reply can quote one of them. */
const QUOTE_CACHE_MAX = 1000;

const savedSessionSchema = z.object({
  version: z.literal(1),
  imei: z.string().min(1),
  userAgent: z.string().min(1),
  language: z.string().optional(),
  cookie: z.array(z.record(z.string(), z.unknown())).min(1),
});

const clip = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);
const PROFILE_NAME_MAX = 100;

interface RawChangedProfile {
  displayName?: unknown;
  zaloName?: unknown;
  gender?: unknown;
  avatar?: unknown;
}

/** https URL of 1 to 2000 characters, or null. http and anything else are omitted. */
export function httpsAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 2000) return null;
  try {
    return new URL(trimmed).protocol === 'https:' ? trimmed : null;
  } catch {
    return null;
  }
}

/** Gender.Male = 0 and Gender.Female = 1 in zca-js. Any other value is unknown. */
function mapGender(value: unknown): ZaloGender {
  if (value === Gender.Male) return 'male';
  if (value === Gender.Female) return 'female';
  return null;
}

function profileName(value: unknown): string {
  if (typeof value !== 'string') return '';
  // The name is quoted inside a one-line marker for the agent, so line breaks, brackets and quotes are dropped.
  return clip(value.replace(/[\r\n[\]"]/g, ''), PROFILE_NAME_MAX).trim();
}

function suffixedProfile<T>(profiles: Readonly<Record<string, T>>, userId: string): T | undefined {
  const prefix = `${userId}_`;
  for (const [key, value] of Object.entries(profiles)) {
    if (key.startsWith(prefix)) return value;
  }
  return undefined;
}

/**
 * Picks the changed profile for `userId`. zca-js asks Zalo for `${userId}_0` when the id has no `_`,
 * and the response map may be keyed by either form. `displayName` wins over `zaloName`.
 */
export function zaloProfileFromInfo(
  userId: string,
  changedProfiles: Readonly<Record<string, RawChangedProfile>> | null | undefined,
): ZaloUserProfile | null {
  if (!userId || !changedProfiles) return null;
  const profile = changedProfiles[userId] ?? changedProfiles[`${userId}_0`] ?? suffixedProfile(changedProfiles, userId);
  if (!profile) return null;
  const display = profileName(profile.displayName);
  const zalo = profileName(profile.zaloName);
  const avatar = httpsAvatarUrl(profile.avatar);
  return { name: display || zalo, gender: mapGender(profile.gender), ...(avatar ? { avatar } : {}) };
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** A mention-all entry (type 1, or uid "-1") does not address the bot. */
function mentionsBot(message: Message, ownId: string): boolean {
  if (message.type !== ThreadType.Group || !ownId) return false;
  const mentions = message.data.mentions;
  if (!mentions?.length) return false;
  return mentions.some((entry) => entry.type !== 1 && String(entry.uid) !== '-1' && String(entry.uid) === ownId);
}

/** True only when a group message quotes a message this account sent. */
function quotesBot(message: Message, ownId: string): boolean {
  if (message.type !== ThreadType.Group || !ownId) return false;
  return String(message.data.quote?.ownerId ?? '') === ownId;
}

/** memVerList entries look like "<uid>_<ver>". The uid is everything before the last underscore. */
function memberIdFromVer(entry: string): string {
  const cut = entry.lastIndexOf('_');
  return cut >= 0 ? entry.slice(0, cut) : entry;
}

function memberDisplayName(profile: GroupMemberProfile | undefined): string {
  const name = profile?.displayName || profile?.zaloName || '';
  return clip(name, 200);
}

/** Maps a zca-js message to the bridge shape; null when it lacks the identifiers the Worker needs. */
export function normalizeMessage(message: Message, ownId: string): IncomingMessage | null {
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
    mentionsSelf: mentionsBot(message, ownId),
    quotesSelf: quotesBot(message, ownId),
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
  /** Incoming group messages, oldest first, keyed by msgId. */
  private readonly groupQuotes = new Map<string, TMessage>();
  private stopped = false;

  constructor(private readonly api: API) {
    this.ownId = String(api.getOwnId());
    if (!this.ownId) throw new CodedError('ZALO_NO_OWN_ID');
    const listener = api.listener;
    listener.on('message', (raw) => {
      this.rememberGroupQuote(raw);
      const message = normalizeMessage(raw, this.ownId);
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

  async send(threadId: string, threadKind: ThreadKind, text: string, reply?: ZaloSendReply, files?: ZaloOutgoingFile[]) {
    const content = this.outgoing(threadKind, text, reply);
    if (files?.length) {
      content.attachments = files.map((file) => ({
        data: Buffer.from(file.data),
        filename: file.filename,
        metadata: {
          totalSize: file.data.byteLength,
          ...(typeof file.width === 'number' ? { width: file.width } : {}),
          ...(typeof file.height === 'number' ? { height: file.height } : {}),
        },
      }));
    }
    const result = await this.api.sendMessage(
      content,
      threadId,
      threadKind === 'group' ? ThreadType.Group : ThreadType.User,
    );
    const ids: string[] = [];
    if (result.message?.msgId != null) ids.push(String(result.message.msgId));
    for (const item of result.attachment ?? []) {
      if (item?.msgId != null) ids.push(String(item.msgId));
    }
    if (!ids.length) throw new CodedError('ZALO_SEND_NO_MSG_ID');
    return { msgId: ids[0]!, msgIds: ids };
  }

  /** A direct thread, or a send with no reply, goes out as plain text. A missing cached message is not an error. */
  private outgoing(threadKind: ThreadKind, text: string, reply?: ZaloSendReply): MessageContent {
    if (!reply || threadKind !== 'group') return { msg: text };
    const quote = this.quoteFor(reply.msgId);
    if (!reply.senderName.trim()) return quote ? { msg: text, quote } : { msg: text };
    const content: MessageContent = {
      msg: `@${reply.senderName} ${text}`,
      mentions: [{ pos: 0, uid: reply.senderId, len: reply.senderName.length + 1 }],
    };
    if (quote) content.quote = quote;
    return content;
  }

  private rememberGroupQuote(message: Message) {
    if (message.type !== ThreadType.Group) return;
    const msgId = String(message.data.msgId ?? '');
    if (!msgId) return;
    this.groupQuotes.delete(msgId);
    this.groupQuotes.set(msgId, message.data);
    while (this.groupQuotes.size > QUOTE_CACHE_MAX) {
      const oldest = this.groupQuotes.keys().next().value;
      if (oldest === undefined) break;
      this.groupQuotes.delete(oldest);
    }
  }

  /** Copies exactly the fields SendMessageQuote requires from a cached raw message. */
  private quoteFor(msgId: string): SendMessageQuote | undefined {
    const raw = this.groupQuotes.get(msgId);
    if (!raw) return undefined;
    return {
      content: raw.content,
      msgType: raw.msgType,
      propertyExt: raw.propertyExt,
      uidFrom: raw.uidFrom,
      msgId: raw.msgId,
      cliMsgId: raw.cliMsgId,
      ts: raw.ts,
      ttl: raw.ttl,
    };
  }

  async getUserProfile(userId: string): Promise<ZaloUserProfile | null> {
    if (!userId) return null;
    const info: UserInfoResponse = await this.api.getUserInfo(userId);
    return zaloProfileFromInfo(userId, info?.changed_profiles);
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

  async listGroupMembers(groupId: string): Promise<{ id: string; name: string; avatar?: string }[]> {
    const info = await this.api.getGroupInfo(groupId);
    const group = info.gridInfoMap?.[groupId];
    const fromVer = (group?.memVerList ?? []).map(memberIdFromVer).filter((id) => id.length > 0);
    const ids = (fromVer.length ? fromVer : (group?.currentMems ?? []).map((member) => member.id).filter((id) => id.length > 0))
      .slice(0, MAX_GROUP_MEMBERS);
    const members: { id: string; name: string; avatar?: string }[] = [];
    for (let i = 0; i < ids.length; i += MEMBER_INFO_BATCH) {
      const batch = ids.slice(i, i + MEMBER_INFO_BATCH);
      const result = await this.api.getGroupMembersInfo(batch);
      const profiles = result.profiles ?? {};
      // zca-js asks for `${id}_0`, so the map may be keyed by either form, as with getUserInfo.
      for (const id of batch) {
        const profile = profiles[id] ?? profiles[`${id}_0`] ?? suffixedProfile(profiles, id);
        const avatar = httpsAvatarUrl(profile?.avatar);
        members.push({ id, name: memberDisplayName(profile), ...(avatar ? { avatar } : {}) });
      }
    }
    return members;
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

/** Wraps a logged-in zca-js API. Both login paths return this. */
export function openZcaSession(api: API): ZaloSession {
  return new ZcaSession(api);
}

/** Logs in by QR code. Offers up to four codes; a declined or unscanned login rejects with QR_DECLINED / QR_EXPIRED. */
export async function loginWithQr(onQr: (qr: QrCode) => void): Promise<ZaloSession> {
  let codes = 0;
  let failure: string | null = null;
  try {
    const api = await newZalo().loginQR({ language: 'vi' }, (event) => {
      switch (event.type) {
        case LoginQRCallbackEventType.QRCodeGenerated:
          codes += 1;
          onQr({ imageDataUrl: `data:image/png;base64,${event.data.image}` });
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
    return openZcaSession(api);
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
  return openZcaSession(api);
}

export const zcaConnector: ZaloConnector = { loginWithQr, loginWithSaved };
