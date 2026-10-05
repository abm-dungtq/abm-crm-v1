import type { ApiError, ApiResult } from '@abm/contracts';
import type { Actor } from './env';
import type { GuardedTx } from './guarded-tx';

export type ApiFail = Extract<ApiResult<never>, { ok: false }>;

export const fail = (code: ApiError['code'], message: string, extra?: Partial<ApiError>): ApiFail =>
  ({ ok: false, error: { code, message, ...extra } });
export const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data });

/** One canonical UTC instant. Rejects a string Date cannot read. */
export function isoUtc(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export type Ctx<I> = { db: D1Database; actor: Actor; input: I; tx: GuardedTx };
export type Handler<I> = (ctx: Ctx<I>) => Promise<ApiResult<unknown>>;
