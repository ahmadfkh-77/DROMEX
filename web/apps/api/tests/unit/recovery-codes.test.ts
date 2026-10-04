import { describe, expect, it } from 'vitest';

import {
  RECOVERY_CODE_ALPHABET,
  generateRecoveryCodes,
  normalizeRecoveryCode,
} from '../../src/auth/recovery-codes.ts';

const CANONICAL = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/;

/** A deterministic random source that records every request. */
function scriptedSource(blocks: Uint8Array[]) {
  const requests: number[] = [];
  let index = 0;
  const source = (size: number): Uint8Array => {
    requests.push(size);
    const block = blocks[Math.min(index, blocks.length - 1)]!;
    index += 1;
    return block;
  };
  return { source, requests };
}

function block(byte: (position: number) => number): Uint8Array {
  return Uint8Array.from({ length: 24 }, (_, position) => byte(position));
}

describe('recovery-code generation', () => {
  it('generates exactly ten canonical grouped 24-symbol codes', () => {
    const codes = generateRecoveryCodes();

    expect(codes).toHaveLength(10);
    for (const code of codes) {
      expect(code).toMatch(CANONICAL);
      expect(code.replaceAll('-', '')).toHaveLength(24);
    }
  });

  it('uses the 32-symbol Crockford alphabet without I, L, O or U', () => {
    expect(RECOVERY_CODE_ALPHABET).toBe('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
    expect(new Set(RECOVERY_CODE_ALPHABET).size).toBe(32);
  });

  it('draws 24 random bytes per code and maps each through its low five bits', () => {
    const blocks = Array.from({ length: 10 }, (_, code) =>
      block((position) => (position + code * 3) & 0xff),
    );
    const { source, requests } = scriptedSource(blocks);

    const codes = generateRecoveryCodes(source);

    expect(requests).toEqual(Array(10).fill(24));
    // Byte 0 -> '0', 10 -> 'A', 18 -> 'J', 31 -> 'Z': hand-checked positions.
    expect(codes[0]).toBe('0123-4567-89AB-CDEF-GHJK-MNPQ');
    expect(codes[1]).toBe('3456-789A-BCDE-FGHJ-KMNP-QRST');
  });

  it('ignores the high three bits of every byte, so all 256 byte values are equally likely per symbol', () => {
    const low = Array.from({ length: 10 }, (_, code) => block((position) => (position * 7 + code) % 32));
    const high = low.map((original) =>
      Uint8Array.from(original, (value, position) => value | ((position % 8) << 5)),
    );

    expect(generateRecoveryCodes(scriptedSource(high).source)).toEqual(
      generateRecoveryCodes(scriptedSource(low).source),
    );
  });

  it('never returns a duplicate within one set, drawing again after a collision', () => {
    const repeated = block((position) => position);
    const distinct = Array.from({ length: 10 }, (_, code) => block((position) => (position + code + 1) % 32));
    const { source, requests } = scriptedSource([repeated, repeated, repeated, ...distinct]);

    const codes = generateRecoveryCodes(source);

    expect(new Set(codes).size).toBe(10);
    expect(requests.length).toBe(12);
  });

  it('fails closed rather than looping forever on a random source that never varies', () => {
    expect(() => generateRecoveryCodes(() => new Uint8Array(24))).toThrow(/recovery code/i);
  });

  it('fails closed when the random source returns the wrong amount of data', () => {
    expect(() => generateRecoveryCodes(() => new Uint8Array(23))).toThrow(/recovery code/i);
  });
});

describe('recovery-code normalization', () => {
  it.each([
    ['canonical', 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01'],
    ['outer whitespace', '  ABCD-EFGH-JKMN-PQRS-TVWX-YZ01 '],
    ['lower case, no separators', 'abcdefghjkmnpqrstvwxyz01'],
    ['spaces instead of hyphens', 'ABCD EFGH JKMN PQRS TVWX YZ01'],
    ['mixed separators', 'abcd-efgh jkmn-pqrs tvwx-yz01'],
  ])('returns the canonical grouped form for %s', (_label, input) => {
    expect(normalizeRecoveryCode(input)).toBe('ABCD-EFGH-JKMN-PQRS-TVWX-YZ01');
  });

  it('maps only the Crockford-approved look-alikes: O to 0, I and L to 1', () => {
    expect(normalizeRecoveryCode('oooo-iiii-llll-OOOO-IIII-LLLL')).toBe(
      '0000-1111-1111-0000-1111-1111',
    );
  });

  it.each([
    ['empty', ''],
    ['one symbol short', 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ0'],
    ['one symbol long, never truncated', 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ012'],
    ['the excluded letter U', 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ0U'],
    ['punctuation', 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ0!'],
    ['a tab inside', 'ABCD\tEFGH-JKMN-PQRS-TVWX-YZ01'],
    ['a full-width digit', 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ0１'],
  ])('rejects %s', (_label, input) => {
    expect(normalizeRecoveryCode(input)).toBeNull();
  });

  it('rejects a non-string without throwing', () => {
    expect(normalizeRecoveryCode(undefined as never)).toBeNull();
    expect(normalizeRecoveryCode(123 as never)).toBeNull();
  });
});
