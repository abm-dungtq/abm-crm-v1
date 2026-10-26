import type { Context } from 'hono';
import type { Env, Sink } from '../env';
import { postInboxNotice } from '../inbox-notices';

/**
 * Zalo Official Account OAuth v4 (PKCE) and the AES-GCM storage of the resulting tokens.
 * The access token is sent as a header, never in a URL or a log line.
 */

const PERMISSION_URL = 'https://oauth.zaloapp.com/v4/oa/permission';
const TOKEN_URL = 'https://oauth.zaloapp.com/v4/oa/access_token';
const OA_INFO_URL = 'https://openapi.zalo.me/v2.0/oa/getoa';
/** Public callback. Caddy rewrites this path onto the Worker's OAuth route. */
export const ZALO_OA_REDIRECT_URI = 'https://chatbot.abmedu.vn/api/zalo/oauth/callback';
const VERIFIER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const STATE_TTL_MS = 10 * 60_000;
const REFRESH_WINDOW_MS = 3 * 60 * 60_000;
const REFRESH_FALLBACK_SECONDS = 90 * 24 * 60 * 60;
const OA_NAME_MAX = 200;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class ZaloOaNotConfigured extends Error {
  constructor() {
    super('Zalo OA chưa được cấu hình');
    this.name = 'ZaloOaNotConfigured';
  }
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  refresh_expires_in?: unknown;
  refresh_token_expires_in?: unknown;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function base64ToBytes(value: string): Uint8Array {
  const bin = atob(value);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  const bytes = base64ToBytes(keyB64.trim());
  if (bytes.byteLength !== 32) throw new Error('ZALO_OA_TOKEN_KEY phải đúng 32 byte');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Encrypts one token. The stored value is base64(12-byte IV || ciphertext). */
export async function encryptToken(keyB64: string, plaintext: string): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext)));
  const blob = new Uint8Array(iv.byteLength + cipher.byteLength);
  blob.set(iv);
  blob.set(cipher, iv.byteLength);
  return bytesToBase64(blob);
}

/** Decrypts a value from `encryptToken`. A wrong key or a damaged blob throws. */
export async function decryptToken(keyB64: string, stored: string): Promise<string> {
  const key = await importKey(keyB64);
  const blob = base64ToBytes(stored);
  if (blob.byteLength <= 12) throw new Error('ciphertext quá ngắn');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.slice(0, 12) }, key, blob.slice(12));
  return decoder.decode(plain);
}

/** PKCE verifier: 43 characters from [A-Za-z0-9], as Zalo OAuth v4 asks for. */
export function randomCodeVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(43));
  let out = '';
  for (const b of bytes) out += VERIFIER_ALPHABET[b % VERIFIER_ALPHABET.length];
  return out;
}

/** code_challenge = base64url(SHA-256(verifier)) without padding. */
export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(verifier));
  return bytesToBase64(new Uint8Array(digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function requireApp(env: Pick<Env, 'ZALO_OA_APP_ID' | 'ZALO_OA_APP_SECRET' | 'ZALO_OA_TOKEN_KEY'>): { appId: string; secret: string; key: string } {
  const appId = env.ZALO_OA_APP_ID;
  const secret = env.ZALO_OA_APP_SECRET;
  const key = env.ZALO_OA_TOKEN_KEY;
  if (!appId || !secret || !key) throw new ZaloOaNotConfigured();
  return { appId, secret, key };
}

function expiryIso(now: Date, seconds: number): string {
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

function clipName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'Zalo OA';
  return Array.from(trimmed).slice(0, OA_NAME_MAX).join('');
}

/** Writes a token pair and bumps `version`, whether or not a row already exists. */
export async function saveCredential(db: D1Database, key: string, accountId: string, tokens: TokenPair, now = new Date()): Promise<void> {
  const accessEnc = await encryptToken(key, tokens.accessToken);
  const refreshEnc = await encryptToken(key, tokens.refreshToken);
  await db.prepare(`INSERT INTO zalo_oa_credential (
      channel_account_id, access_token_enc, refresh_token_enc, access_expires_at, refresh_expires_at, version, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(channel_account_id) DO UPDATE SET
      access_token_enc = excluded.access_token_enc,
      refresh_token_enc = excluded.refresh_token_enc,
      access_expires_at = excluded.access_expires_at,
      refresh_expires_at = excluded.refresh_expires_at,
      version = zalo_oa_credential.version + 1,
      updated_at = excluded.updated_at`)
    .bind(accountId, accessEnc, refreshEnc, tokens.accessExpiresAt, tokens.refreshExpiresAt, now.toISOString())
    .run();
}

/** The current access token, or null when it is missing, expired, or cannot be decrypted. */
export async function accessToken(db: D1Database, env: Pick<Env, 'ZALO_OA_TOKEN_KEY'>, accountId: string, now = new Date()): Promise<string | null> {
  const key = env.ZALO_OA_TOKEN_KEY;
  if (!key) return null;
  const row = await db.prepare('SELECT access_token_enc, access_expires_at FROM zalo_oa_credential WHERE channel_account_id = ?')
    .bind(accountId).first<{ access_token_enc: string; access_expires_at: string }>();
  if (!row || Date.parse(row.access_expires_at) <= now.getTime()) return null;
  try {
    return await decryptToken(key, row.access_token_enc);
  } catch {
    return null;
  }
}

async function requestTokens(env: Pick<Env, 'ZALO_OA_APP_SECRET'>, body: Record<string, string>, now: Date): Promise<TokenPair> {
  const secret = env.ZALO_OA_APP_SECRET;
  if (!secret) throw new ZaloOaNotConfigured();
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', secret_key: secret },
      body: new URLSearchParams(body).toString(),
    });
  } catch {
    throw new Error('ZALO_OA_NETWORK');
  }
  const json = await res.json().catch(() => null) as TokenResponse | null;
  const access = json?.access_token;
  const refresh = json?.refresh_token;
  if (!res.ok || typeof access !== 'string' || !access || typeof refresh !== 'string' || !refresh) {
    // Zalo's error fields carry no secret; they are the only clue to why an exchange or refresh was refused.
    const reason = json as { error?: unknown; error_name?: unknown; error_description?: unknown } | null;
    console.error('zalo_oa_token_rejected', res.status, String(reason?.error ?? ''), String(reason?.error_name ?? ''), String(reason?.error_description ?? '').slice(0, 200));
    throw new Error('ZALO_OA_TOKEN_REJECTED');
  }
  const accessSeconds = Number(json?.expires_in ?? 0);
  const refreshRaw = Number(json?.refresh_expires_in ?? json?.refresh_token_expires_in);
  const refreshSeconds = Number.isFinite(refreshRaw) && refreshRaw > 0 ? refreshRaw : REFRESH_FALLBACK_SECONDS;
  return {
    accessToken: access,
    refreshToken: refresh,
    accessExpiresAt: expiryIso(now, Number.isFinite(accessSeconds) && accessSeconds > 0 ? accessSeconds : 0),
    refreshExpiresAt: expiryIso(now, refreshSeconds),
  };
}

interface OaProfile { id: string; name: string }

async function fetchOaProfile(token: string): Promise<OaProfile> {
  let res: Response;
  try {
    res = await fetch(OA_INFO_URL, { headers: { access_token: token } });
  } catch {
    throw new Error('ZALO_OA_NETWORK');
  }
  const json = await res.json().catch(() => null) as { error?: unknown; data?: { oa_id?: unknown; name?: unknown } } | null;
  const oaId = json?.data?.oa_id;
  const id = oaId === undefined || oaId === null ? '' : String(oaId).trim();
  if (!res.ok || !json || Number(json.error ?? 0) !== 0 || !id) {
    console.error('zalo_oa_profile_failed', res.status, String(json?.error ?? ''), String((json as { message?: unknown } | null)?.message ?? '').slice(0, 200));
    throw new Error('ZALO_OA_PROFILE_FAILED');
  }
  const name = typeof json.data?.name === 'string' ? json.data.name : '';
  return { id, name: clipName(name) };
}

/** Starts the admin's browser at Zalo's permission page and remembers the PKCE verifier for ten minutes. */
export async function beginZaloOaConnect(db: D1Database, env: Env, userId: string, now = new Date()): Promise<{ url: string }> {
  const { appId } = requireApp(env);
  const verifier = randomCodeVerifier();
  const stateBytes = crypto.getRandomValues(new Uint8Array(16));
  const state = [...stateBytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  const challenge = await codeChallenge(verifier);
  await db.prepare(`INSERT INTO zalo_oa_oauth_state (state, code_verifier, created_by_user_id, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)`).bind(state, verifier, userId, now.toISOString(), new Date(now.getTime() + STATE_TTL_MS).toISOString()).run();
  const url = new URL(PERMISSION_URL);
  url.searchParams.set('app_id', appId);
  url.searchParams.set('redirect_uri', ZALO_OA_REDIRECT_URI);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('state', state);
  return { url: url.toString() };
}

function redirectTo(env: Pick<Env, 'APP_URL'>, result: 'connected' | 'error'): Response {
  const path = `/channel-accounts?zalo_oa=${result}`;
  const base = env.APP_URL?.replace(/\/+$/, '');
  const location = base ? `${base}${path}` : path;
  return new Response(null, { status: 302, headers: { Location: location } });
}

/**
 * Public OAuth callback. The state row is consumed by one DELETE, so a replay cannot exchange the code again.
 * A failed exchange redirects to the error page and never puts a token in the URL.
 */
export async function zaloOaOauthCallback(c: Context<{ Bindings: Env }>): Promise<Response> {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) {
    return c.json({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'Thiếu code hoặc state' } }, 400);
  }
  let app: { appId: string; secret: string; key: string };
  try {
    app = requireApp(c.env);
  } catch {
    return redirectTo(c.env, 'error');
  }
  const now = new Date();
  const consumed = await c.env.DB.prepare(`DELETE FROM zalo_oa_oauth_state WHERE state = ? AND expires_at > ?
    RETURNING code_verifier, created_by_user_id`).bind(state, now.toISOString()).first<{ code_verifier: string; created_by_user_id: string }>();
  if (!consumed) {
    console.error('zalo_oa_oauth_state_missing');
    return c.json({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'Phiên kết nối Zalo OA không hợp lệ hoặc đã hết hạn' } }, 400);
  }
  try {
    const user = await c.env.DB.prepare('SELECT organization_id FROM app_user WHERE id = ?')
      .bind(consumed.created_by_user_id).first<{ organization_id: string }>();
    if (!user) return redirectTo(c.env, 'error');
    const tokens = await requestTokens(c.env, {
      code, app_id: app.appId, grant_type: 'authorization_code', code_verifier: consumed.code_verifier,
    }, now);
    const profile = await fetchOaProfile(tokens.accessToken);
    const accountId = crypto.randomUUID();
    const saved = await c.env.DB.prepare(`INSERT INTO channel_account (
        id, organization_id, channel, external_id, display_name, agent_key, bot_enabled, status, created_at, updated_at
      ) VALUES (?, ?, 'zalo_oa', ?, ?, 'tu-van-oa', 1, 'connected', ?, ?)
      ON CONFLICT(channel, external_id) DO UPDATE SET
        display_name = excluded.display_name,
        status = 'connected',
        last_error = NULL,
        agent_key = COALESCE(channel_account.agent_key, 'tu-van-oa'),
        updated_at = excluded.updated_at
      WHERE channel_account.organization_id = excluded.organization_id
      RETURNING id`).bind(accountId, user.organization_id, profile.id, profile.name, now.toISOString(), now.toISOString())
      .first<{ id: string }>();
    if (!saved) return redirectTo(c.env, 'error');
    await saveCredential(c.env.DB, app.key, saved.id, tokens, now);
    return redirectTo(c.env, 'connected');
  } catch (error) {
    // Our own error codes (ZALO_OA_*), never a token.
    console.error('zalo_oa_oauth_error', error instanceof Error ? error.message.slice(0, 100) : 'unknown');
    return redirectTo(c.env, 'error');
  }
}

export type RefreshOutcome = 'refreshed' | 'stale' | 'failed';

/**
 * True when a newer refresh already replaced the pair this run started from. The losing call must not
 * be recorded as an error: Zalo refresh tokens are single-use, so the loser is rejected after the winner.
 */
async function refreshWasSuperseded(db: D1Database, accountId: string, startedVersion: number | null): Promise<boolean> {
  if (startedVersion === null) return false;
  const current = await db.prepare('SELECT version FROM zalo_oa_credential WHERE channel_account_id = ?')
    .bind(accountId).first<{ version: number }>();
  return current !== null && current.version !== startedVersion;
}

/**
 * Refreshes one account's tokens. The write matches the version read before the call, so a slower
 * run does not overwrite a newer pair. `stale` means another run already rotated the pair, including
 * when Zalo rejected this run because that token was already used. `failed` is only a failure that
 * still sees the version this run started from.
 */
export async function refreshZaloOaAccount(db: D1Database, env: Pick<Env, 'ZALO_OA_APP_ID' | 'ZALO_OA_APP_SECRET' | 'ZALO_OA_TOKEN_KEY'>, accountId: string, now = new Date()): Promise<RefreshOutcome> {
  let startedVersion: number | null = null;
  try {
    const app = requireApp(env);
    const row = await db.prepare('SELECT refresh_token_enc, version FROM zalo_oa_credential WHERE channel_account_id = ?')
      .bind(accountId).first<{ refresh_token_enc: string; version: number }>();
    if (!row) return 'failed';
    startedVersion = row.version;
    const refreshToken = await decryptToken(app.key, row.refresh_token_enc);
    const tokens = await requestTokens(env, { refresh_token: refreshToken, app_id: app.appId, grant_type: 'refresh_token' }, now);
    const accessEnc = await encryptToken(app.key, tokens.accessToken);
    const refreshEnc = await encryptToken(app.key, tokens.refreshToken);
    const res = await db.prepare(`UPDATE zalo_oa_credential SET access_token_enc = ?, refresh_token_enc = ?,
        access_expires_at = ?, refresh_expires_at = ?, version = version + 1, updated_at = ?
      WHERE channel_account_id = ? AND version = ?`)
      .bind(accessEnc, refreshEnc, tokens.accessExpiresAt, tokens.refreshExpiresAt, now.toISOString(), accountId, row.version)
      .run();
    if (res.meta.changes !== 1) return 'stale';
    await db.prepare(`UPDATE channel_account SET status = 'connected', last_error = NULL, updated_at = ?
      WHERE id = ? AND last_error = 'ZALO_OA_REFRESH_FAILED'`).bind(now.toISOString(), accountId).run();
    return 'refreshed';
  } catch {
    if (await refreshWasSuperseded(db, accountId, startedVersion)) return 'stale';
    console.error('zalo_oa_refresh_failed');
    return 'failed';
  }
}

/** Vietnam calendar day, used so a refresh failure notifies the inbox group once per account per day. */
function vietnamDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Saigon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Marks the account in error and posts one CRM inbox notice for this Vietnam day. The text contains no token. */
export async function recordZaloOaRefreshFailure(
  db: D1Database, accountId: string, now: Date, sink: Sink, ensuredOrgs?: Set<string>,
): Promise<void> {
  const account = await db.prepare(`UPDATE channel_account SET status = 'error', last_error = 'ZALO_OA_REFRESH_FAILED', updated_at = ?
    WHERE id = ? RETURNING organization_id, display_name`).bind(now.toISOString(), accountId).first<{ organization_id: string; display_name: string }>();
  if (!account) return;
  await postInboxNotice(sink, db, {
    organizationId: account.organization_id,
    text: `Zalo OA ${account.display_name} không làm mới được token`,
    dedupeKey: `zalo-oa-refresh:${accountId}:${vietnamDate(now)}`,
    ensuredOrgs,
  });
}

/** Refreshes every OA credential whose access token expires within three hours. */
export async function refreshZaloOaTokens(
  db: D1Database,
  env: Pick<Env, 'ZALO_OA_APP_ID' | 'ZALO_OA_APP_SECRET' | 'ZALO_OA_TOKEN_KEY'>,
  now: Date,
  sink: Sink,
): Promise<void> {
  const due = await db.prepare(`SELECT c.channel_account_id FROM zalo_oa_credential c
    JOIN channel_account a ON a.id = c.channel_account_id
    WHERE a.channel = 'zalo_oa' AND c.access_expires_at <= ?`).bind(new Date(now.getTime() + REFRESH_WINDOW_MS).toISOString())
    .all<{ channel_account_id: string }>();
  const ensuredOrgs = new Set<string>();
  for (const row of due.results) {
    const outcome = await refreshZaloOaAccount(db, env, row.channel_account_id, now);
    if (outcome === 'failed') await recordZaloOaRefreshFailure(db, row.channel_account_id, now, sink, ensuredOrgs);
  }
}
