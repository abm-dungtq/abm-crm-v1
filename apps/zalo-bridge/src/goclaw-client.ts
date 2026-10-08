import { z } from 'zod';
import { CodedError, errorCode } from './config';

/**
 * Calls the local GoClaw gateway's OpenAI-compatible endpoint:
 *   POST {GOCLAW_BASE_URL}/chat/completions
 *   Authorization: Bearer <GOCLAW_API_KEY>, X-GoClaw-User-Id: <userId>
 *   { model: 'goclaw:<agentKey>', messages: [{ role: 'user', content }], stream: false }
 * The API has no idempotency key, so a failed call is never retried here; the Worker's command lease decides.
 */

export const GOCLAW_TIMEOUT_MS = 180_000;
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

export interface GoClawClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class GoClawClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GoClawClientOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /** Returns the agent's reply; throws a CodedError (GOCLAW_*) on any failure or an empty reply. */
  async complete({ agentKey, userId, text }: CompletionRequest): Promise<string> {
    if (!agentKey || !userId) throw new CodedError('GOCLAW_BAD_REQUEST');
    const body = JSON.stringify({ model: `goclaw:${agentKey}`, messages: [{ role: 'user', content: text }], stream: false });
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) throw new CodedError('GOCLAW_REQUEST_TOO_LARGE');
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
        signal: AbortSignal.timeout(this.options.timeoutMs ?? GOCLAW_TIMEOUT_MS),
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
}
