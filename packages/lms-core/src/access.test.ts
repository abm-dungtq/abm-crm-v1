import { describe, expect, it } from 'vitest';
import { resolveAccess, type AccessFacts } from './access';

const nowIso = '2026-10-16T10:00:00.000Z';

function baseFacts(overrides: Partial<AccessFacts> = {}): AccessFacts {
  return {
    programId: 'prog_1',
    enrolled: false,
    lastSessionAt: null,
    reviewDays: null,
    manual: [],
    ...overrides
  };
}

describe('resolveAccess', () => {
  it('block beats enrollment', () => {
    const res = resolveAccess(
      baseFacts({
        enrolled: true,
        manual: [{ mode: 'block', expiresAt: null }]
      }),
      nowIso
    );
    expect(res).toEqual({ state: 'none' });
  });

  it('grant opens without enrollment', () => {
    const until = '2026-11-01T00:00:00.000Z';
    const res = resolveAccess(
      baseFacts({
        enrolled: false,
        manual: [{ mode: 'grant', expiresAt: until }]
      }),
      nowIso
    );
    expect(res).toEqual({ state: 'open', until });
  });

  it('expired grant ignored', () => {
    const res = resolveAccess(
      baseFacts({
        enrolled: false,
        manual: [{ mode: 'grant', expiresAt: '2026-10-15T10:00:00.000Z' }]
      }),
      nowIso
    );
    expect(res).toEqual({ state: 'none' });
  });

  it('enrolled with null reviewDays open', () => {
    const res = resolveAccess(
      baseFacts({
        enrolled: true,
        lastSessionAt: '2026-09-01T10:00:00.000Z',
        reviewDays: null
      }),
      nowIso
    );
    expect(res).toEqual({ state: 'open', until: null });
  });

  it('enrolled within window open with until', () => {
    const res = resolveAccess(
      baseFacts({
        enrolled: true,
        lastSessionAt: '2026-10-10T10:00:00.000Z',
        reviewDays: 10
      }),
      nowIso
    );
    expect(res).toEqual({ state: 'open', until: '2026-10-20T10:00:00.000Z' });
  });

  it('enrolled after window -> expired', () => {
    const res = resolveAccess(
      baseFacts({
        enrolled: true,
        lastSessionAt: '2026-10-01T10:00:00.000Z',
        reviewDays: 10
      }),
      nowIso
    );
    expect(res).toEqual({ state: 'expired', endedAt: '2026-10-11T10:00:00.000Z' });
  });

  it('expired enrollment + live grant -> open', () => {
    const until = '2026-10-30T10:00:00.000Z';
    const res = resolveAccess(
      baseFacts({
        enrolled: true,
        lastSessionAt: '2026-10-01T10:00:00.000Z',
        reviewDays: 10,
        manual: [{ mode: 'grant', expiresAt: until }]
      }),
      nowIso
    );
    expect(res).toEqual({ state: 'open', until });
  });

  it('reports the longest open window across grants and enrollment', () => {
    const soon = '2026-10-20T00:00:00.000Z';
    const later = '2026-12-01T00:00:00.000Z';
    expect(resolveAccess(baseFacts({ manual: [{ mode: 'grant', expiresAt: soon }, { mode: 'grant', expiresAt: later }] }), nowIso))
      .toEqual({ state: 'open', until: later });
    expect(resolveAccess(baseFacts({ enrolled: true, manual: [{ mode: 'grant', expiresAt: soon }] }), nowIso))
      .toEqual({ state: 'open', until: null });
  });
});
