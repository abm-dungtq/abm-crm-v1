const CONTENT_PATH_RE = /^\/c\/([A-Za-z0-9-]{1,64})\/(\d{1,6})$/;
const HEX_SIG_RE = /^[0-9a-f]{64}$/i;

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function importHmacKey(secret: string, usage: 'sign' | 'verify') {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  );
}

/** Path served by abm-lms-content: /c/<programId>/<contentVersion>?exp=<unix seconds>&sig=<hex HMAC-SHA256>. */
export async function signContentPath(
  programId: string,
  contentVersion: number,
  secret: string,
  ttlSeconds: number,
  nowMs: number,
): Promise<string> {
  const exp = Math.floor(nowMs / 1000) + Math.floor(ttlSeconds);
  const key = await importHmacKey(secret, 'sign');
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${programId}.${contentVersion}.${exp}`),
  );
  const sig = toHex(new Uint8Array(mac));
  return `/c/${programId}/${contentVersion}?exp=${exp}&sig=${sig}`;
}

export async function verifyContentPath(
  url: URL,
  secret: string,
  nowMs: number,
): Promise<{ programId: string; contentVersion: number } | null> {
  if (!secret) return null;
  const match = url.pathname.match(CONTENT_PATH_RE);
  if (!match) return null;
  const programId = match[1]!;
  const contentVersion = Number(match[2]!);
  const expStr = url.searchParams.get('exp');
  const sig = url.searchParams.get('sig');
  if (!expStr || !/^\d+$/.test(expStr) || !sig || !HEX_SIG_RE.test(sig)) return null;
  const exp = Number(expStr);
  if (!Number.isSafeInteger(exp) || exp * 1000 <= nowMs) return null;

  const key = await importHmacKey(secret, 'verify');
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    fromHex(sig),
    new TextEncoder().encode(`${programId}.${contentVersion}.${expStr}`),
  );
  if (!valid) return null;
  return { programId, contentVersion };
}
