import { describe, expect, it } from 'vitest';
import { zaloProfileFromInfo } from '../src/zalo-client';

describe('zaloProfileFromInfo', () => {
  it('reads the profile by user id or by the _0 key Zalo returns', () => {
    expect(zaloProfileFromInfo('123', { '123': { displayName: 'Hùng', gender: 0 } })).toEqual({ name: 'Hùng', gender: 'male' });
    expect(zaloProfileFromInfo('123', { '123_0': { displayName: 'Lan', zaloName: 'other', gender: 1 } })).toEqual({ name: 'Lan', gender: 'female' });
    expect(zaloProfileFromInfo('123', {
      '123': { displayName: 'Hùng', gender: 0 },
      '123_0': { displayName: 'Lan', gender: 1 },
    })).toEqual({ name: 'Hùng', gender: 'male' });
  });

  it('falls back to zaloName and drops an unknown gender', () => {
    expect(zaloProfileFromInfo('1', { '1': { displayName: '', zaloName: 'Zalo Name', gender: 2 } }))
      .toEqual({ name: 'Zalo Name', gender: null });
    expect(zaloProfileFromInfo('1', { '1': { displayName: 'An', gender: null } })).toEqual({ name: 'An', gender: null });
    expect(zaloProfileFromInfo('1', { '1': { displayName: 'An', gender: '0' } })).toEqual({ name: 'An', gender: null });
    expect(zaloProfileFromInfo('1', {})).toBeNull();
    expect(zaloProfileFromInfo('1', undefined)).toBeNull();
    expect(zaloProfileFromInfo('', { '': { displayName: 'A', gender: 0 } })).toBeNull();
  });

  it('strips newlines and brackets and clips the name to 100 characters', () => {
    expect(zaloProfileFromInfo('1', { '1': { displayName: 'Hùng\r\n[A]', gender: 0 } })).toEqual({ name: 'HùngA', gender: 'male' });
    const long = 'a'.repeat(120);
    const clipped = zaloProfileFromInfo('1', { '1_0': { displayName: `[${long}]\n`, gender: 1 } });
    expect(clipped?.name).toBe('a'.repeat(100));
  });
});
