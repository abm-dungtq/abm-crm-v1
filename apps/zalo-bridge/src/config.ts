/**
 * Runtime configuration of the Zalo bridge sidecar, read from environment variables.
 * Values are never printed: errors name the variable only.
 */

export interface BridgeConfig {
  /** Origin of the CRM Worker, without a trailing slash; the bridge API lives under /api/bridge. */
  crmBaseUrl: string;
  bridgeSecret: string;
  goclawApiKey: string;
  /** OpenAI-compatible base of the local GoClaw gateway, without a trailing slash. */
  goclawBaseUrl: string;
  sendMinDelayMs: number;
  sendMaxDelayMs: number;
  pollWaitSeconds: number;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

const REQUIRED = ['CRM_BASE_URL', 'BRIDGE_SECRET', 'GOCLAW_API_KEY'] as const;
const DEFAULT_GOCLAW_BASE_URL = 'http://127.0.0.1:18790/v1';
/** The Worker caps a long-poll at 25 seconds. */
const MAX_POLL_WAIT_SECONDS = 25;

type Env = Record<string, string | undefined>;

function baseUrl(name: string, raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`${name} không phải URL hợp lệ`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ConfigError(`${name} phải dùng http hoặc https`);
  return raw.replace(/\/+$/, '');
}

function integer(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new ConfigError(`${name} phải là số nguyên không âm`);
  const value = Number(raw);
  if (value < min || value > max) throw new ConfigError(`${name} phải nằm trong khoảng ${min}..${max}`);
  return value;
}

/** Reads and validates the configuration; throws ConfigError naming every missing required variable. */
export function loadConfig(env: Env = process.env): BridgeConfig {
  const missing = REQUIRED.filter((name) => !env[name]?.trim());
  if (missing.length) throw new ConfigError(`Thiếu biến môi trường bắt buộc: ${missing.join(', ')}`);

  const sendMinDelayMs = integer(env, 'SEND_MIN_DELAY_MS', 1500, 0, 600_000);
  const sendMaxDelayMs = integer(env, 'SEND_MAX_DELAY_MS', 4000, 0, 600_000);
  if (sendMaxDelayMs < sendMinDelayMs) throw new ConfigError('SEND_MAX_DELAY_MS phải lớn hơn hoặc bằng SEND_MIN_DELAY_MS');

  return {
    crmBaseUrl: baseUrl('CRM_BASE_URL', env.CRM_BASE_URL!.trim()),
    bridgeSecret: env.BRIDGE_SECRET!.trim(),
    goclawApiKey: env.GOCLAW_API_KEY!.trim(),
    goclawBaseUrl: baseUrl('GOCLAW_BASE_URL', env.GOCLAW_BASE_URL?.trim() || DEFAULT_GOCLAW_BASE_URL),
    sendMinDelayMs,
    sendMaxDelayMs,
    pollWaitSeconds: integer(env, 'POLL_WAIT_SECONDS', 20, 0, MAX_POLL_WAIT_SECONDS),
  };
}

/** Structured log fields: ids, kinds, counts and error codes only, never message text, cookies, tokens or QR data. */
export type LogFields = Record<string, string | number | boolean | null | undefined>;
export type Logger = (level: 'info' | 'warn' | 'error', event: string, fields?: LogFields) => void;

/** One JSON line per entry on stdout (info) or stderr (warn, error). */
export const consoleLogger: Logger = (level, event, fields) => {
  const line = JSON.stringify({ at: new Date().toISOString(), level, event, ...fields });
  if (level === 'info') console.log(line);
  else console.error(line);
};

export const silentLogger: Logger = () => {};

/** An error identified by a short machine code; the message carries nothing but that code. */
export class CodedError extends Error {
  override name = 'CodedError';
  constructor(readonly code: string) {
    super(code);
  }
}

/** Error code of an unknown thrown value, safe to log and to report to the Worker. */
export function errorCode(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code) return code.slice(0, 200);
    return error.name.slice(0, 200);
  }
  return 'UNKNOWN_ERROR';
}
