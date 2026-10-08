import type { RoleCode } from '@abm/contracts';
import type { Context } from 'hono';

export interface Env {
  DB: D1Database;
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
