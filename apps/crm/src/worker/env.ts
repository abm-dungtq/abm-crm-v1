import type { RoleCode } from '@abm/contracts';
import type { Context } from 'hono';

export interface Env {
  DB: D1Database;
  CHAT_HUB: DurableObjectNamespace;
  /** Inbox images uploaded by staff. Keys are `org/<organizationId>/<yyyy>/<mm>/<uuid>.<jpg|png>`. */
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  /** `password` enables cookie sessions; otherwise the evaluation header path applies. */
  AUTH_MODE?: string;
  DEMO_MODE?: string;
  /** Shared HMAC secret that signs requests between the Zalo bridge sidecar and the Worker. */
  BRIDGE_SECRET?: string;
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
  /** R2 bucket storing published LMS handbook HTML versions (`programs/<programId>/v<version>.html`). */
  LMS_CONTENT: R2Bucket;
  LMS_CONTENT_ORIGIN: string;
  STREAM_ACCOUNT_ID: string;
  STREAM_API_TOKEN?: string;
  CONTENT_SIGNING_SECRET?: string;
  /** Whether the handoff check on customer turns is `off`, logged only (`shadow`) or acted on (`active`). */
  HANDOFF_NET_MODE?: string;
  /** Whether TypeSafe Jev's answer is not asked (`off`), logged only (`shadow`) or used (`active`) by that check. */
  JEV_INTENT_MODE?: string;
  /** Minimum Jev confidence, 0 to 1, for its answer to count. */
  JEV_CONFIDENCE?: string;
  /** Pinned Jev model version. */
  JEV_MODEL?: string;
  /** TypeSafe API key. Customer text is masked for emails, phones and long numbers before it is sent. */
  TYPESAFE_API_KEY?: string;
  /** Web Push VAPID public key (base64url raw P-256 point) and contact subject; private key is a secret. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_SUBJECT?: string;
  VAPID_PRIVATE_KEY?: string;
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

/** MCP token scope: `legacy` for script-issued tokens, `read` / `read_tasks` for self-service tokens. */
export type TokenScope = 'legacy' | 'read' | 'read_tasks';

export type AppBindings = {
  Bindings: Env;
  Variables: { actor: Actor; mustChangePassword: boolean; tokenScope?: TokenScope; tokenId?: string };
};

/** Runs work after the response when the runtime allows it; tests have no ExecutionContext, so it is awaited there. */
export async function background(c: Context, work: Promise<unknown>) {
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    await work;
  }
}

export interface Sink {
  env: Env;
  waitUntil(work: Promise<unknown>): void;
}

export function sinkFrom(c: Context<AppBindings>): Sink {
  return {
    env: c.env,
    waitUntil: (w) => {
      void background(c, w);
    },
  };
}
