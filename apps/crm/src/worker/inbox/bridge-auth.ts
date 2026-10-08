import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';

/**
 * Authenticates the Zalo bridge sidecar (ADR-008). Every request to /api/bridge/* carries:
 *
 *   X-Bridge-Timestamp: current Unix time in whole SECONDS, as decimal digits.
 *   X-Bridge-Signature: lowercase or uppercase hex of HMAC-SHA256(BRIDGE_SECRET, timestamp + "." + rawBody),
 *                       64 hex characters. rawBody is the exact request body bytes as UTF-8 text;
 *                       a GET (or any request without a body) signs the empty string: timestamp + ".".
 *
 * Requests whose timestamp differs from the Worker clock by more than 300 seconds, with a missing or
 * malformed header, a wrong signature, or while BRIDGE_SECRET is unset are rejected with 401. The sidecar
 * is a server client, so a request carrying a browser Origin header is rejected with 403.
 * The body is read once here; routes read it from `c.get('bridgeBody')`.
 */

export const BRIDGE_MAX_SKEW_SECONDS = 300;

export type BridgeBindings = { Bindings: Env; Variables: { bridgeBody: string } };

const unauthenticated = { ok: false as const, error: { code: 'UNAUTHENTICATED' as const, message: 'Chữ ký bridge không hợp lệ' } };
const encoder = new TextEncoder();

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** True when `signatureHex` is the HMAC of `timestamp.body`. crypto.subtle.verify compares in constant time. */
export async function verifyBridgeSignature(secret: string, timestamp: string, body: string, signatureHex: string) {
  const signature = hexToBytes(signatureHex);
  if (!signature || signature.length !== 32) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(`${timestamp}.${body}`));
}

export const bridgeAuth: MiddlewareHandler<BridgeBindings> = async (c, next) => {
  if (c.req.header('Origin')) return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Không nhận request từ trình duyệt' } }, 403);
  const secret = c.env.BRIDGE_SECRET;
  const timestamp = c.req.header('X-Bridge-Timestamp') ?? '';
  const signature = c.req.header('X-Bridge-Signature') ?? '';
  if (!secret || !/^\d{1,12}$/.test(timestamp) || !signature) return c.json(unauthenticated, 401);
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > BRIDGE_MAX_SKEW_SECONDS) return c.json(unauthenticated, 401);
  const body = await c.req.text();
  if (!(await verifyBridgeSignature(secret, timestamp, body, signature))) return c.json(unauthenticated, 401);
  c.set('bridgeBody', body);
  await next();
};
