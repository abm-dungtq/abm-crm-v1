import type { RoleCode } from '@abm/contracts';
import type { Context } from 'hono';

export interface Env {
  DB: D1Database;
  /** Inbox images uploaded by staff. Keys are `org/<organizationId>/<yyyy>/<mm>/<uuid>.<jpg|png>`. */
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  /** `password` enables cookie sessions; otherwise the evaluation header path applies. */
  AUTH_MODE?: string;
  DEMO_MODE?: string;
  LARK_APP_ID?: string;
  LARK_APP_SECRET?: string;
  /** Shared HMAC secret that signs requests between the Zalo bridge sidecar and the Worker. */
  BRIDGE_SECRET?: string;
  /** Lark group chat that receives inbox handoff and SLA notices. */
  LARK_INBOX_CHAT_ID?: string;
  /** Facebook app secret used to verify Messenger webhook signatures. */
  FB_APP_SECRET?: string;
  /** Token Facebook echoes back when subscribing the Messenger webhook. */
  FB_VERIFY_TOKEN?: string;
  /** JSON object mapping Facebook page id to its page access token. */
  FB_PAGE_TOKENS?: string;
  /** Zalo app id for Official Account OAuth v4. */
  ZALO_OA_APP_ID?: string;
  /** Zalo app secret sent as the OAuth `secret_key` header. It is not the webhook secret. */
  ZALO_OA_APP_SECRET?: string;
  /** OA secret key that signs webhook bodies. Zalo uses a different key than the app secret. */
  ZALO_OA_WEBHOOK_SECRET?: string;
  /** Base64 AES-256 key that encrypts OA access and refresh tokens at rest. */
  ZALO_OA_TOKEN_KEY?: string;
  /** Public base URL of the CRM used in links sent outside the web app; defaults to the request origin. */
  APP_URL?: string;
}

/** Authenticated principal. Always resolved server-side; never taken from a request body. */
export interface Actor {
  id: string;
  organizationId: string;
  departmentId: string | null;
  teamId: string | null;
  role: RoleCode;
  displayName: string;
  /** Channel of the request: the web session (human) or a chat agent acting for this user (agent). */
  kind: 'human' | 'agent';
}

export type AppBindings = { Bindings: Env; Variables: { actor: Actor; mustChangePassword: boolean } };

/** Runs work after the response when the runtime allows it; tests have no ExecutionContext, so it is awaited there. */
export async function background(c: Context, work: Promise<unknown>) {
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    await work;
  }
}
