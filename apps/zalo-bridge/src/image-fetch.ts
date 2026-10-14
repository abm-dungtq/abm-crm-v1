import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Downloads a customer image from Zalo's CDN into a temp file the GoClaw gateway can read.
 * Only https hosts `zdn.vn` and `*.zdn.vn` are accepted. The URL and the bytes are never logged.
 */

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
export const IMAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type ImageExt = 'jpg' | 'png' | 'gif' | 'webp';

function allowedImageUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  if (url.port !== '' && url.port !== '443') return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host !== 'zdn.vn' && !host.endsWith('.zdn.vn')) return null;
  return url;
}

function imageExtension(bytes: Uint8Array): ImageExt | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (
    bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return 'png';
  if (
    bytes.length >= 6
    && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38
    && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61
  ) return 'gif';
  if (
    bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'webp';
  return null;
}

/** Reads the body, stopping once it passes `max`. Null means the cap was exceeded or the read failed. */
async function readAtMost(body: ReadableStream<Uint8Array>, max: number): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      if (total + value.byteLength > max) return null;
      parts.push(value);
      total += value.byteLength;
    }
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (total === 0) return null;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/** Returns the temp file path, or null on any refusal or failure. */
export async function downloadImage(url: string, dir: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const parsed = allowedImageUrl(url);
  if (!parsed) return null;
  try {
    const response = await fetchImpl(parsed.href, {
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_IMAGE_BYTES)) {
      await response.body.cancel().catch(() => {});
      return null;
    }
    const bytes = await readAtMost(response.body, MAX_IMAGE_BYTES);
    if (!bytes) return null;
    const ext = imageExtension(bytes);
    if (!ext) return null;
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${randomUUID()}.${ext}`);
    try {
      await writeFile(path, bytes);
    } catch {
      await unlink(path).catch(() => {});
      return null;
    }
    return path;
  } catch {
    return null;
  }
}

/** Deletes files in `dir` that are at least `maxAgeMs` old. A missing directory is not an error. */
export async function cleanupOldImages(dir: string, maxAgeMs = IMAGE_MAX_AGE_MS): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const now = Date.now();
  for (const name of names) {
    const path = join(dir, name);
    try {
      const info = await lstat(path);
      if (!info.isFile()) continue;
      if (now - info.mtimeMs < maxAgeMs) continue;
      await unlink(path);
    } catch {
      // One locked or missing file does not stop the sweep; the next hour retries it.
    }
  }
}
