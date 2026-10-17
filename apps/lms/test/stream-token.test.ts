import { describe, expect, it } from 'vitest';
import { signStreamToken } from '../src/worker/stream-token';

function fromBase64Url(str: string): Uint8Array {
  const base64 = str.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

describe('signStreamToken', () => {
  it('throws STREAM_NOT_CONFIGURED when secrets are missing', async () => {
    await expect(
      signStreamToken('0123456789abcdef0123456789abcdef', {}, 7200),
    ).rejects.toThrow('STREAM_NOT_CONFIGURED');
  });

  it('signs a valid RS256 JWT with sub, kid, and exp verifiable by the public key', async () => {
    const keyPair = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;

    const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
    const jwkBase64 = btoa(JSON.stringify(privateJwk));
    const uid = '0123456789abcdef0123456789abcdef';
    const beforeSec = Math.floor(Date.now() / 1000);

    const token = await signStreamToken(
      uid,
      {
        STREAM_SIGNING_KEY_ID: 'key-id-test',
        STREAM_SIGNING_JWK: jwkBase64,
      },
      7200,
    );

    const afterSec = Math.floor(Date.now() / 1000);
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    const [h64, p64, s64] = parts as [string, string, string];

    const header = JSON.parse(new TextDecoder().decode(fromBase64Url(h64))) as {
      alg: string;
      kid: string;
    };
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(p64))) as {
      sub: string;
      kid: string;
      exp: number;
    };

    expect(header).toEqual({ alg: 'RS256', kid: 'key-id-test' });
    expect(payload.sub).toBe(uid);
    expect(payload.kid).toBe('key-id-test');
    expect(payload.exp).toBeGreaterThanOrEqual(beforeSec + 7200);
    expect(payload.exp).toBeLessThanOrEqual(afterSec + 7200);

    const valid = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      keyPair.publicKey,
      fromBase64Url(s64),
      new TextEncoder().encode(`${h64}.${p64}`),
    );
    expect(valid).toBe(true);
  });
});
