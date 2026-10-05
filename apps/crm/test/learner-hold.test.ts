import { describe, expect, test } from 'vitest';
import { holdExpiry, isHeld } from '../src/worker/learner-hold';

describe('holdExpiry', () => {
  test('adds three calendar months and clamps to the last day of the target month', () => {
    // 10:00 on 31 January in Vietnam becomes 10:00 on 30 April.
    expect(holdExpiry('2026-01-31T03:00:00.000Z')).toBe('2026-04-30T03:00:00.000Z');
  });

  test('counts the month in Vietnam time, not UTC', () => {
    // 20:00Z on 30 November is 03:00 on 1 December in Vietnam; three months later is 1 March 03:00 local.
    expect(holdExpiry('2026-11-30T20:00:00.000Z')).toBe('2027-02-28T20:00:00.000Z');
  });

  test('handles a leap year', () => {
    expect(holdExpiry('2027-11-30T03:00:00.000Z')).toBe('2028-02-29T03:00:00.000Z');
  });

  test('keeps hours, minutes, seconds and milliseconds', () => {
    expect(holdExpiry('2026-05-15T08:09:10.123Z')).toBe('2026-08-15T08:09:10.123Z');
  });
});

describe('isHeld', () => {
  const now = new Date('2026-10-05T00:00:00.000Z');
  const held = { owner_user_id: 'u-1', hold_expires_at: '2026-12-01T00:00:00.000Z', owner_eligible: true };

  test('is held while the hold runs and the owner can still work the customer', () => {
    expect(isHeld(held, false, now)).toBe(true);
  });

  test('is free once the hold ran out, unless a learner lead was won', () => {
    const expired = { ...held, hold_expires_at: '2026-10-04T00:00:00.000Z' };
    expect(isHeld(expired, false, now)).toBe(false);
    expect(isHeld(expired, true, now)).toBe(true);
  });

  test('a customer without an owner is never held', () => {
    expect(isHeld({ ...held, owner_user_id: null }, true, now)).toBe(false);
  });

  test('an owner who is no longer an active Sale or Leader voids the hold', () => {
    expect(isHeld({ ...held, owner_eligible: false }, false, now)).toBe(false);
    expect(isHeld({ ...held, owner_eligible: false }, true, now)).toBe(false);
  });
});
