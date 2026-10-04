/**
 * Password hashing with WebCrypto PBKDF2-SHA256. workerd rejects more than 100 000 iterations and
 * the free plan allows ~10 ms CPU per request, so the count is measured on the deployed Worker.
 * Keep scripts/bootstrap-admin.mjs in sync with these values.
 */
export const PASSWORD_ITERATIONS = 50_000;
/**
 * Generated temporary passwords carry ~70 bits of randomness, so stretching adds nothing and would
 * cost ~10 ms CPU per user when an import issues dozens at once. Chosen passwords use the full count.
 */
export const TEMP_PASSWORD_ITERATIONS = 1;
export const TEMP_PASSWORD_HOURS = 48;

export interface StoredPassword {
  hash: string;
  salt: string;
  iterations: number;
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations = PASSWORD_ITERATIONS): Promise<StoredPassword> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { hash: toBase64(await derive(password, salt, iterations)), salt: toBase64(salt), iterations };
}

export async function verifyPassword(password: string, stored: StoredPassword): Promise<boolean> {
  const expected = fromBase64(stored.hash);
  const actual = await derive(password, fromBase64(stored.salt), stored.iterations);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!;
  return diff === 0;
}

// No look-alike characters (0/O, 1/l/I) so a password read aloud or retyped survives.
const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export function generateTempPassword(length = 12): string {
  const out: string[] = [];
  const limit = 256 - (256 % TEMP_ALPHABET.length);
  while (out.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < limit && out.length < length) out.push(TEMP_ALPHABET[byte % TEMP_ALPHABET.length]!);
    }
  }
  return out.join('');
}
