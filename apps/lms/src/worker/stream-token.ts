import type { Env } from './env';

function base64UrlBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlJson(value: unknown): string {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

export async function signStreamToken(
  uid: string,
  env: Pick<Env, 'STREAM_SIGNING_KEY_ID' | 'STREAM_SIGNING_JWK'>,
  ttlSeconds: number,
): Promise<string> {
  if (!env.STREAM_SIGNING_KEY_ID || !env.STREAM_SIGNING_JWK) {
    throw new Error('STREAM_NOT_CONFIGURED');
  }
  const jwk = JSON.parse(atob(env.STREAM_SIGNING_JWK)) as JsonWebKey;
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const header = { alg: 'RS256', kid: env.STREAM_SIGNING_KEY_ID };
  const payload = {
    sub: uid,
    kid: env.STREAM_SIGNING_KEY_ID,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlBytes(new Uint8Array(signature))}`;
}
