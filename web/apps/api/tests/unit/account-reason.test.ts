import { describe, expect, it } from 'vitest';

import { STATUS_CHANGE_REASON_LIMITS, parseStatusChangeReason } from '../../src/accounts/account-reason.ts';

// A disable or re-enable reason is the one free-text value account management
// stores (checkpoint 4E). It is mandatory, bounded, single-line, and refused
// whenever it could corrupt a log or visually disguise itself.

describe('status-change reason', () => {
  it('accepts an ordinary reason and stores it trimmed', () => {
    expect(parseStatusChangeReason('  Left the company on 28 September.  ')).toBe('Left the company on 28 September.');
  });

  it('accepts Arabic and mixed-direction text', () => {
    expect(parseStatusChangeReason('غادر الشركة — handover to Site 4')).toBe('غادر الشركة — handover to Site 4');
  });

  it('measures length in characters, not UTF-16 units, at both boundaries', () => {
    expect(STATUS_CHANGE_REASON_LIMITS).toEqual({ min: 3, max: 500 });
    expect(parseStatusChangeReason('abc')).toBe('abc');
    expect(parseStatusChangeReason('ab')).toBeNull();
    expect(parseStatusChangeReason('a'.repeat(500))).toBe('a'.repeat(500));
    expect(parseStatusChangeReason('a'.repeat(501))).toBeNull();
    // 500 astral characters are 1000 UTF-16 units and still within the limit.
    expect(parseStatusChangeReason('🏗'.repeat(500))).toBe('🏗'.repeat(500));
    expect(parseStatusChangeReason('🏗'.repeat(501))).toBeNull();
  });

  it.each<[string, unknown]>([
    ['a missing reason', undefined],
    ['null', null],
    ['a number', 42],
    ['an array', ['Left the company']],
    ['an empty string', ''],
    ['only whitespace', '     '],
    ['a reason that is too short once trimmed', '  a  '],
    ['a line break that could forge a log line', 'Left\nevent=admin_account_enabled'],
    ['a carriage return', 'Left the company\r'],
    ['a tab', 'Left\tthe company'],
    ['a NUL character', 'Left the company\u0000'],
    ['a C1 control character', 'Left the company\u0085'],
    ['a right-to-left override that disguises text', 'Left \u202Eynapmoc eht'],
    ['a left-to-right embedding', 'Left \u202Athe company'],
    ['a directional isolate', 'Left \u2067the company\u2069'],
    ['a lone surrogate', 'Left the company \uD83C'],
  ])('refuses %s', (_label, value) => {
    expect(parseStatusChangeReason(value)).toBeNull();
  });
});
