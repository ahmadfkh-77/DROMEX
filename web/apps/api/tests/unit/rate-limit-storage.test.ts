import { describe, expect, it } from 'vitest';

import {
  parseStoredCount,
  parseStoredMillis,
  RateLimitStorageError,
} from '../../src/auth/rate-limit-storage.ts';

// node-postgres returns BIGINT as text and INTEGER as a number. These parsers
// are the only place stored rate-limit values become JavaScript numbers, so
// every malformed or unsafe shape must fail closed here.

describe('rate-limit stored value parsing', () => {
  it('converts PostgreSQL BIGINT text into the exact millisecond number', () => {
    expect(parseStoredMillis('0')).toBe(0);
    expect(parseStoredMillis('1789289796705')).toBe(1_789_289_796_705);
    expect(parseStoredMillis(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([
    ['negative', '-1'],
    ['decimal', '1.5'],
    ['exponent', '1e12'],
    ['empty', ''],
    ['padded', ' 1'],
    ['leading zero', '01'],
    ['hexadecimal', '0x10'],
    ['text', 'not-a-number'],
    ['just past the safe range', '9007199254740992'],
    ['far past the safe range', '99999999999999999999'],
  ])('rejects %s BIGINT text', (_label, value) => {
    expect(() => parseStoredMillis(value)).toThrow(RateLimitStorageError);
  });

  it.each([[1_789_289_796_705], [null], [undefined], [1n], [{}]])(
    'rejects a driver value that is not BIGINT text (%s)',
    (value) => {
      expect(() => parseStoredMillis(value)).toThrow(RateLimitStorageError);
    },
  );

  it('never echoes the rejected value in its error', () => {
    try {
      parseStoredMillis('-424242424242');
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain('424242');
    }
  });

  it('accepts only non-negative safe integer counts', () => {
    expect(parseStoredCount(0)).toBe(0);
    expect(parseStoredCount(5)).toBe(5);
    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '5', null]) {
      expect(() => parseStoredCount(value)).toThrow(RateLimitStorageError);
    }
  });
});
