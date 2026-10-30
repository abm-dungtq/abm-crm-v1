import { basename } from 'node:path';
import { z } from 'zod';
import { CodedError, errorCode } from './config';
import { GatewayConnection, gatewayWsUrl, type WebSocketFactory, type WebSocketLike } from './goclaw-session-cleanup';

/**
 * Calls the local GoClaw gateway.
 * Text turns use the OpenAI-compatible endpoint:
 *   POST {GOCLAW_BASE_URL}/chat/completions
 *   Authorization: Bearer <GOCLAW_API_KEY>, X-GoClaw-User-Id: <userId>
 *   { model: 'goclaw:<agentKey>', messages: [{ role: 'user', content }], stream: false }
 * Image turns use the gateway WebSocket: connect, then chat.send with temp-file paths.
 * The session key is agent:<agentKey>:http:direct:<userId>, the same session the HTTP header uses.
 * The model provider sometimes stalls for minutes on a turn that normally takes 10 s, and GoClaw waits up to
 * 180 s for it. So a turn that has not answered within its first attempt is aborted and asked again at once;
 * aborting cancels the GoClaw run before it saves anything, so the retry does not duplicate the question.
 * Only a timeout is retried here; every other failure goes back to the Worker's command lease.
 */

/**
 * Per-attempt timeouts: a first attempt, then one longer retry. The reasoning model behind the sales agent
 * takes over 30 seconds on one turn in ten, so a shorter first attempt throws away work that was nearly done.
 * Both attempts together stay well under the 300-second command lease.
 */
export const GOCLAW_TEXT_ATTEMPTS_MS: readonly number[] = [60_000, 90_000];
/** Image turns read the image with a tool first, so their attempts are longer. */
export const GOCLAW_MEDIA_ATTEMPTS_MS: readonly number[] = [90_000, 120_000];
const ABORT_TIMEOUT_MS = 5000;
/** GoClaw rejects request bodies above 1 MiB. */
const MAX_BODY_BYTES = 1024 * 1024;

const responseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable().optional() }) })).min(1),
});

export interface CompletionRequest {
  agentKey: string;
  userId: string;
  text: string;
}

export interface MediaCompletionRequest {
  agentKey: string;
  userId: string;
  text: string;
  mediaPaths: string[];
}

const chatSendSchema = z.object({ content: z.string().nullable().optional() }).passthrough();

export interface GoClawClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  /** Overrides both per-attempt timeout lists (tests). */
  attemptsMs?: readonly number[];
  webSocket?: WebSocketFactory;
}

export class GoClawClient {
  private readonly fetchImpl: typeof fetch;
  private readonly webSocket: WebSocketFactory;

  constructor(private readonly options: GoClawClientOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.webSocket = options.webSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
  }

  /** Returns the agent's reply; throws a CodedError (GOCLAW_*) on any failure or an empty reply. */
  async complete({ agentKey, userId, text }: CompletionRequest): Promise<string> {
    if (!agentKey || !userId) throw new CodedError('GOCLAW_BAD_REQUEST');
    const body = JSON.stringify({ model: `goclaw:${agentKey}`, messages: [{ role: 'user', content: text }], stream: false });
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) throw new CodedError('GOCLAW_REQUEST_TOO_LARGE');
    return this.withRetry(GOCLAW_TEXT_ATTEMPTS_MS, (timeoutMs) => this.completeOnce(userId, body, timeoutMs));
  }

  /** Runs `attempt` with each timeout in turn; only a GOCLAW_TIMEOUT moves on to the next one. */
  private async withRetry(defaults: readonly number[], attempt: (timeoutMs: number) => Promise<string>): Promise<string> {
    const timeouts = this.options.attemptsMs ?? defaults;
    for (let i = 0; ; i++) {
      try {
        return await attempt(timeouts[i]!);
      } catch (error) {
        if (errorCode(error) !== 'GOCLAW_TIMEOUT' || i === timeouts.length - 1) throw error;
      }
    }
  }

  private async completeOnce(userId: string, body: string, timeoutMs: number): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'X-GoClaw-User-Id': userId,
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new CodedError(errorCode(error) === 'TimeoutError' ? 'GOCLAW_TIMEOUT' : 'GOCLAW_NETWORK');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new CodedError(`GOCLAW_HTTP_${response.status}`);
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      throw new CodedError(errorCode(error) === 'TimeoutError' ? 'GOCLAW_TIMEOUT' : 'GOCLAW_BAD_RESPONSE');
    }
    const parsed = responseSchema.safeParse(json);
    if (!parsed.success) throw new CodedError('GOCLAW_BAD_RESPONSE');
    const content = parsed.data.choices[0]!.message.content ?? '';
    if (!content.trim()) throw new CodedError('GOCLAW_EMPTY_REPLY');
    return content;
  }

  /**
   * Image turn. Connects as `userId` and sends the temp files on the HTTP session key.
   * Timeout and error codes match `complete`.
   */
  async completeWithMedia({ agentKey, userId, text, mediaPaths }: MediaCompletionRequest): Promise<string> {
    if (!agentKey || !userId) throw new CodedError('GOCLAW_BAD_REQUEST');
    const params = {
      agentId: agentKey,
      sessionKey: `agent:${agentKey}:http:direct:${userId}`,
      stream: false,
      message: text,
      media: mediaPaths.map((path) => ({ path, filename: basename(path) })),
    };
    if (Buffer.byteLength(JSON.stringify(params), 'utf8') > MAX_BODY_BYTES) throw new CodedError('GOCLAW_REQUEST_TOO_LARGE');
    return this.withRetry(GOCLAW_MEDIA_ATTEMPTS_MS, (timeoutMs) => this.chatSendOnce(userId, params, timeoutMs));
  }

  private async chatSendOnce(userId: string, params: Record<string, unknown>, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    let connection: GatewayConnection | undefined;
    try {
      connection = await GatewayConnection.open(this.webSocket, gatewayWsUrl(this.options.baseUrl), remaining(deadline));
      await connection.request('connect', {
        token: this.options.apiKey, user_id: userId, protocolVersion: 3,
      }, remaining(deadline));
      const payload = await connection.request('chat.send', params, remaining(deadline)).catch(async (error: unknown) => {
        // A WebSocket run outlives its socket, so a timed-out run is aborted before the retry starts another one.
        if (mediaCompletionError(error).code === 'GOCLAW_TIMEOUT') {
          await connection!.request('chat.abort', { sessionKey: params.sessionKey }, ABORT_TIMEOUT_MS).catch(() => {});
        }
        throw error;
      });
      const parsed = chatSendSchema.safeParse(payload);
      if (!parsed.success) throw new CodedError('GOCLAW_BAD_RESPONSE');
      const content = parsed.data.content ?? '';
      if (!content.trim()) throw new CodedError('GOCLAW_EMPTY_REPLY');
      return content;
    } catch (error) {
      throw mediaCompletionError(error);
    } finally {
      connection?.close();
    }
  }
}

function remaining(deadline: number): number {
  const left = deadline - Date.now();
  if (left <= 0) throw new CodedError('GOCLAW_TIMEOUT');
  return left;
}

/** Maps the shared WebSocket errors onto the codes `complete` already reports. */
function mediaCompletionError(error: unknown): CodedError {
  const code = errorCode(error);
  if (code === 'GOCLAW_TIMEOUT' || code === 'GOCLAW_WS_TIMEOUT' || code === 'TimeoutError') return new CodedError('GOCLAW_TIMEOUT');
  if (code === 'GOCLAW_EMPTY_REPLY' || code === 'GOCLAW_BAD_REQUEST' || code === 'GOCLAW_REQUEST_TOO_LARGE' || code === 'GOCLAW_BAD_RESPONSE') {
    return error instanceof CodedError ? error : new CodedError(code);
  }
  if (code.startsWith('GOCLAW_RPC_')) return new CodedError('GOCLAW_BAD_RESPONSE');
  return new CodedError('GOCLAW_NETWORK');
}
