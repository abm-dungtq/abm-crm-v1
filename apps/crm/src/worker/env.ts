import type { RoleCode } from '@abm/contracts';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  DEMO_MODE?: string;
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

export type AppBindings = { Bindings: Env; Variables: { actor: Actor } };
