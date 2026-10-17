import { describe, expect, it } from 'vitest';
import { signContentPath, verifyContentPath } from './content-url';

const SECRET = 'test-signing-secret-0123456789abcdef';
const NOW = 1_760_000_000_000;

describe('content-url signing and verification', () => {
  it('round trip ok', async () => {
    const path = await signContentPath('prog-abc-123', 4, SECRET, 1800, NOW);
    const verified = await verifyContentPath(new URL(`https://content.test${path}`), SECRET, NOW + 60_000);
    expect(verified).toEqual({ programId: 'prog-abc-123', contentVersion: 4 });
  });

  it('tampered version -> null', async () => {
    const path = await signContentPath('prog-abc-123', 4, SECRET, 1800, NOW);
    const tampered = path.replace('/c/prog-abc-123/4?', '/c/prog-abc-123/5?');
    const verified = await verifyContentPath(new URL(`https://content.test${tampered}`), SECRET, NOW);
    expect(verified).toBeNull();
  });

  it('expired -> null', async () => {
    const path = await signContentPath('prog-abc-123', 4, SECRET, 60, NOW);
    const verified = await verifyContentPath(new URL(`https://content.test${path}`), SECRET, NOW + 60_000);
    expect(verified).toBeNull();
  });

  it('wrong secret -> null', async () => {
    const path = await signContentPath('prog-abc-123', 4, SECRET, 1800, NOW);
    const verified = await verifyContentPath(new URL(`https://content.test${path}`), 'wrong-secret', NOW);
    expect(verified).toBeNull();
  });
});
