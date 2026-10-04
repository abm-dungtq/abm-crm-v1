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
