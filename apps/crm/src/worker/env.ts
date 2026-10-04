import type { RoleCode } from '@abm/contracts';

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
}

export type AppBindings = { Bindings: Env; Variables: { actor: Actor; mustChangePassword: boolean } };
