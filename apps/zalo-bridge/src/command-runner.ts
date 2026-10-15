import type { BridgeCommandResult } from '@abm/contracts';
import { z } from 'zod';
import { CodedError, errorCode, silentLogger, type Logger } from './config';
import type { BridgeCommand, ResultDelivery } from './crm-client';
import type { CompletionRequest, MediaCompletionRequest } from './goclaw-client';
import { downloadImage as fetchCustomerImage } from './image-fetch';
import { imageDimensions, type ThreadKind, type ZaloOutgoingFile, type ZaloSendReply, type ZaloUserProfile } from './zalo-client';

/**
 * Executes bridge commands. Commands of one conversation run strictly one after another (never two GoClaw runs
 * or sends for the same conversation at once); commands without a conversation start right away.
 * The runner makes no business decisions: it runs what the Worker queued and reports the outcome.
 */

export const MAX_CHUNK_CHARS = 2000;
const MAX_RESULT_TEXT = 20_000;
const MAX_ERROR_CHARS = 2000;
/** Pause after a failed poll before polling again. */
const POLL_ERROR_DELAY_MS = 5000;
/** Send commands whose delivered chunks are remembered; the oldest is forgotten beyond this. */
const MAX_SEND_PROGRESS = 1000;
/** Successful Zalo profile lookups are reused for a day; a miss is reused for an hour. */
const PROFILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PROFILE_NULL_TTL_MS = 60 * 60 * 1000;
const PROFILE_LOOKUP_TIMEOUT_MS = 5000;
const MAX_PROFILE_CACHE = 2000;

const completionPayload = z.object({
  agentKey: z.string().min(1),
  userId: z.string().min(1),
  text: z.string(),
  zaloUserId: z.string().min(1).optional(),
  images: z.array(z.string().url()).max(3).optional(),
});
const sendAttachment = z.object({
  key: z.string().min(1).max(300),
  mimeType: z.enum(['image/jpeg', 'image/png']),
  filename: z.string().min(1).max(200),
});
const sendPayload = z.object({
  threadId: z.string().min(1),
  threadKind: z.enum(['direct', 'group']),
  text: z.string(),
  replyTo: z.object({
    msgId: z.string().min(1),
    senderId: z.string().min(1),
    senderName: z.string().max(200),
  }).optional(),
  attachments: z.array(sendAttachment).max(4).optional(),
});
const sessionPayload = z.object({ accountId: z.string().min(1) }).partial();

export interface RunnerCrm {
  pollCommands(): Promise<BridgeCommand[]>;
  postResult(id: string, result: BridgeCommandResult, retryUntil?: number): Promise<ResultDelivery>;
  /** Signed download of one inbox image. Required only when a send carries attachments. */
  downloadMedia?(accountId: string, key: string): Promise<{ bytes: Uint8Array; contentType: string }>;
}
export interface RunnerGoClaw {
  complete(request: CompletionRequest): Promise<string>;
  completeWithMedia(request: MediaCompletionRequest): Promise<string>;
}
export interface RunnerAccounts {
  login(accountId: string): Promise<void>;
  logout(accountId: string): Promise<void>;
  send(
    accountId: string,
    threadId: string,
    threadKind: ThreadKind,
    text: string,
    commandId: string,
    reply?: ZaloSendReply,
    files?: ZaloOutgoingFile[],
  ): Promise<{ msgId: string }>;
  /** Zalo profile of a direct customer. Null when the account has no live session or Zalo has no profile. */
  profile(accountId: string, zaloUserId: string): Promise<ZaloUserProfile | null>;
}

export interface CommandRunnerOptions {
  crm: RunnerCrm;
  goclaw: RunnerGoClaw;
  accounts: RunnerAccounts;
  sendMinDelayMs: number;
  sendMaxDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  log?: Logger;
  /** Directory customer images are written to before a GoClaw image turn. */
  imageDir?: string;
  downloadImage?: (url: string, dir: string) => Promise<string | null>;
}

type Outcome = Omit<BridgeCommandResult, 'attempts'>;

/** Chunks of one send command that already reached Zalo, and the id of the first one. */
interface SendProgress { delivered: number; firstMsgId: string }

/**
 * Splits text into chunks of at most `max` characters at line boundaries. The newline where a chunk ends is the
 * boundary and belongs to neither chunk; nothing else is trimmed, so every chunk is whole lines of the original.
 * A single line longer than `max` is cut hard (never inside a surrogate pair). Whitespace-only chunks are dropped.
 */
export function splitIntoChunks(text: string, max = MAX_CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let current: string | null = null;
  const flush = () => {
    if (current !== null && current.trim()) chunks.push(current);
    current = null;
  };
  for (let line of text.split('\n')) {
    if (current !== null && current.length + 1 + line.length <= max) {
      current += `\n${line}`;
      continue;
    }
    flush();
    while (line.length > max) {
      let cut = max;
      const code = line.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
      chunks.push(line.slice(0, cut));
      line = line.slice(cut);
    }
    current = line;
  }
  flush();
  return chunks;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const profileFound = (profile: ZaloUserProfile | null) => (profile && (profile.name.length > 0 || profile.gender !== null) ? 1 : 0);

export class CommandRunner {
  private readonly queues = new Map<string, Promise<void>>();
  /** Commands queued or running, with the attempts of their latest claim. */
  private readonly inFlight = new Map<string, BridgeCommand>();
  private readonly running = new Set<Promise<void>>();
  /**
   * Delivered chunks per send command, so a retry (the same command claimed again after a failure or a lost
   * result) continues with the next chunk instead of sending the customer the earlier ones twice. Kept in
   * memory: one bridge instance runs the commands, and a restart loses at most a duplicate of sent chunks.
   */
  private readonly sendProgress = new Map<string, SendProgress>();
  /** Zalo profile per `accountId:zaloUserId`. A found profile lasts 24 h; a null result lasts 1 h. Failures are not cached. */
  private readonly profileCache = new Map<string, { profile: ZaloUserProfile | null; expiresAt: number }>();
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly log: Logger;
  private readonly imageDir: string;
  private readonly downloadImage: (url: string, dir: string) => Promise<string | null>;

  constructor(private readonly options: CommandRunnerOptions) {
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    this.log = options.log ?? silentLogger;
    this.imageDir = options.imageDir ?? '';
    this.downloadImage = options.downloadImage ?? fetchCustomerImage;
  }

  /** Polls and dispatches until `signal` aborts. Poll errors are logged and retried after a pause. */
  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      let commands: BridgeCommand[];
      try {
        commands = await this.options.crm.pollCommands();
      } catch (error) {
        this.log('warn', 'commands.poll_failed', { code: errorCode(error) });
        if (!signal.aborted) await this.sleep(POLL_ERROR_DELAY_MS);
        continue;
      }
      if (signal.aborted) break;
      for (const command of commands) this.dispatch(command);
    }
  }

  /**
   * Queues a command behind earlier commands of the same conversation. A command already queued or running
   * (claimed again after its lease ran out) is not run twice; its result is reported with the newest attempts.
   */
  dispatch(command: BridgeCommand): void {
    const known = this.inFlight.get(command.id);
    if (known) {
      known.attempts = Math.max(known.attempts, command.attempts);
      known.leaseExpiresAt = command.leaseExpiresAt;
      return;
    }
    const tracked = { ...command };
    this.inFlight.set(command.id, tracked);
    const key = command.conversationId;
    const previous = key ? this.queues.get(key) ?? Promise.resolve() : Promise.resolve();
    const task = previous.then(() => this.execute(tracked)).finally(() => {
      this.inFlight.delete(command.id);
      this.running.delete(task);
      if (key && this.queues.get(key) === task) this.queues.delete(key);
    });
    this.running.add(task);
    if (key) this.queues.set(key, task);
  }

  /** Resolves when every dispatched command has finished. */
  async idle(): Promise<void> {
    while (this.running.size) await Promise.allSettled([...this.running]);
  }

  private async execute(command: BridgeCommand): Promise<void> {
    let outcome: Outcome;
    try {
      outcome = await this.perform(command);
    } catch (error) {
      outcome = { ok: false, error: errorCode(error) };
    }
    if (outcome.error) outcome.error = outcome.error.slice(0, MAX_ERROR_CHARS);
    this.log(outcome.ok ? 'info' : 'warn', 'command.done', {
      commandId: command.id, kind: command.kind, attempts: command.attempts, ok: outcome.ok, code: outcome.error,
    });
    const leaseEnd = command.leaseExpiresAt ? Date.parse(command.leaseExpiresAt) : NaN;
    const delivery = await this.options.crm.postResult(command.id, { attempts: command.attempts, ...outcome }, Number.isFinite(leaseEnd) ? leaseEnd : 0);
    // A send is forgotten once the Worker has applied its success. An ignored success (a newer claim owns the command)
    // was not applied, so the newer claim must still find the delivered chunks.
    if (delivery === 'accepted' && outcome.ok) this.sendProgress.delete(command.id);
  }

  private async perform(command: BridgeCommand): Promise<Outcome> {
    switch (command.kind) {
      case 'run_completion': {
        const payload = completionPayload.safeParse(command.payload);
        if (!payload.success) return { ok: false, error: 'INVALID_PAYLOAD' };
        const images = await this.collectImages(payload.data.images ?? []);
        let text = await this.completionText(command, payload.data);
        if (images.failed) text += '\n[Ảnh không tải được]';
        const request = { agentKey: payload.data.agentKey, userId: payload.data.userId, text };
        const reply = images.paths.length
          ? await this.options.goclaw.completeWithMedia({ ...request, mediaPaths: images.paths })
          : await this.options.goclaw.complete(request);
        return { ok: true, text: reply.slice(0, MAX_RESULT_TEXT) };
      }
      case 'send_zalo':
        return this.sendZalo(command);
      case 'zalo_login':
      case 'zalo_logout': {
        const accountId = this.sessionAccountId(command);
        if (command.kind === 'zalo_login') await this.options.accounts.login(accountId);
        else await this.options.accounts.logout(accountId);
        return { ok: true };
      }
      default:
        return { ok: false, error: 'UNSUPPORTED_COMMAND' };
    }
  }

  /** Downloads up to three customer images. A null path counts as a failure and is left out. */
  private async collectImages(urls: string[]): Promise<{ paths: string[]; failed: boolean }> {
    const paths: string[] = [];
    let failed = false;
    for (const url of urls) {
      if (!this.imageDir) {
        failed = true;
        continue;
      }
      const path = await this.downloadImage(url, this.imageDir);
      if (path) paths.push(path);
      else failed = true;
    }
    return { paths, failed };
  }

  /**
   * Prepends one Zalo profile line when this completion names a direct customer and the account's session
   * can resolve them. A lookup that fails or takes longer than 5 s leaves the text unchanged.
   */
  private async completionText(command: BridgeCommand, payload: { text: string; zaloUserId?: string }): Promise<string> {
    const { zaloUserId, text } = payload;
    if (!zaloUserId || !command.channelAccountId) return text;
    const profile = await this.lookupProfile(command.channelAccountId, zaloUserId);
    if (!profile || (profile.name.length === 0 && profile.gender === null)) return text;
    const gender = profile.gender === 'male' ? 'nam' : profile.gender === 'female' ? 'nữ' : 'không rõ';
    return `[Hồ sơ Zalo của khách: tên "${profile.name}"; giới tính: ${gender}]\n${text}`;
  }

  private async lookupProfile(accountId: string, zaloUserId: string): Promise<ZaloUserProfile | null> {
    const key = `${accountId}:${zaloUserId}`;
    const cached = this.profileCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      this.profileCache.delete(key);
      this.profileCache.set(key, cached);
      this.log('info', 'profile.lookup', { cached: 1, found: profileFound(cached.profile) });
      return cached.profile;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const pending = this.options.accounts.profile(accountId, zaloUserId);
      // A lookup that loses the race must not surface later as an unhandled rejection.
      void pending.catch(() => {});
      const profile = await Promise.race([
        pending.then((value) => value ?? null),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new CodedError('PROFILE_TIMEOUT')), PROFILE_LOOKUP_TIMEOUT_MS);
        }),
      ]);
      this.rememberProfile(key, profile);
      this.log('info', 'profile.lookup', { cached: 0, found: profileFound(profile) });
      return profile;
    } catch (error) {
      // A blip must not hide the customer's name for an hour; the next reply looks it up again.
      this.log('warn', 'profile.lookup_failed', { code: errorCode(error) });
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
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

  private sessionAccountId(command: BridgeCommand): string {
    const payload = sessionPayload.safeParse(command.payload ?? {});
    const accountId = (payload.success ? payload.data.accountId : undefined) ?? command.channelAccountId;
    if (!accountId) throw new CodedError('INVALID_PAYLOAD');
    return accountId;
  }

  private async sendZalo(command: BridgeCommand): Promise<Outcome> {
    const payload = sendPayload.safeParse(command.payload);
    if (!payload.success || !command.channelAccountId) return { ok: false, error: 'INVALID_PAYLOAD' };
    const requested = payload.data.attachments ?? [];
    const chunks = splitIntoChunks(payload.data.text);
    if (!chunks.length && requested.length === 0) return { ok: false, error: 'EMPTY_TEXT' };
    // Text chunks first, then one Zalo message per image with an empty caption. A download happens on
    // that image's own step, so a later failure does not send the text or an earlier image again.
    const steps: { text: string; image?: (typeof requested)[number] }[] = [
      ...chunks.map((text) => ({ text })),
      ...requested.map((image) => ({ text: '', image })),
    ];
    const { sendMinDelayMs: min, sendMaxDelayMs: max } = this.options;
    const progress = this.sendProgress.get(command.id);
    let firstMsgId = progress?.firstMsgId;
    for (let index = progress?.delivered ?? 0; index < steps.length; index += 1) {
      await this.sleep(min + Math.floor(this.random() * (max - min + 1)));
      try {
        const step = steps[index]!;
        const reply = index === 0 ? payload.data.replyTo : undefined;
        const files = step.image ? await this.prepareFiles(command.channelAccountId, [step.image]) : undefined;
        const sent = files
          ? await this.options.accounts.send(
            command.channelAccountId, payload.data.threadId, payload.data.threadKind, step.text, command.id, reply, files,
          )
          : await this.options.accounts.send(
            command.channelAccountId, payload.data.threadId, payload.data.threadKind, step.text, command.id, reply,
          );
        firstMsgId ??= sent.msgId;
        this.rememberProgress(command.id, { delivered: index + 1, firstMsgId });
      } catch (error) {
        // Name a failure after some steps went out; the retry continues from this step.
        if (index > 0) return { ok: false, error: `${errorCode(error)}:PARTIAL_${index}_OF_${steps.length}` };
        throw error;
      }
    }
    return { ok: true, externalMsgId: firstMsgId };
  }

  /** Downloads each image and fills the size zca-js wants. A bad type fails the command. */
  private async prepareFiles(
    accountId: string, files: { key: string; mimeType: 'image/jpeg' | 'image/png'; filename: string }[],
  ): Promise<ZaloOutgoingFile[]> {
    const download = this.options.crm.downloadMedia;
    if (!download) throw new CodedError('MEDIA_UNAVAILABLE');
    const out: ZaloOutgoingFile[] = [];
    for (const file of files) {
      const media = await download(accountId, file.key);
      const mime = media.contentType.toLowerCase();
      if (mime !== file.mimeType) throw new CodedError('MEDIA_TYPE');
      const filename = /^[^/\\]+\.[A-Za-z0-9]+$/.test(file.filename)
        ? file.filename as `${string}.${string}`
        : (file.mimeType === 'image/png' ? 'image.png' : 'image.jpg');
      out.push({ data: media.bytes, filename, mimeType: file.mimeType, ...imageDimensions(media.bytes, file.mimeType) });
    }
    return out;
  }

  private rememberProgress(commandId: string, progress: SendProgress) {
    this.sendProgress.delete(commandId);
    this.sendProgress.set(commandId, progress);
    if (this.sendProgress.size > MAX_SEND_PROGRESS) {
      const oldest = this.sendProgress.keys().next().value;
      if (oldest !== undefined) this.sendProgress.delete(oldest);
    }
  }
}
