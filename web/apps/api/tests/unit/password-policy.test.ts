import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../src/auth/config.ts';
import {
  COMMON_PASSWORD_BLOCKLIST_ENTRIES_SHA256,
  COMMON_PASSWORD_BLOCKLIST_SOURCE,
  checkNewPassword,
  commonPasswordBlocklistSize,
  deriveCommonPasswordBlocklist,
  normalizeForPasswordComparison,
  parseCommonPasswordBlocklist,
} from '../../src/auth/password-policy.ts';

/**
 * The common-password check (DEC-488): an offline, pinned blocklist applied
 * to every new password, in addition to the existing length policy.
 */

const BLOCKLIST_FILE = new URL('../../src/auth/common-passwords.txt', import.meta.url);

/** A committed entry, read from the file itself so the test tracks the data. */
function committedEntries(): string[] {
  return parseCommonPasswordBlocklist(readFileSync(BLOCKLIST_FILE, 'utf8'));
}

describe('normalizeForPasswordComparison', () => {
  it('applies NFKC and then lower-cases', () => {
    // U+FB01 LATIN SMALL LIGATURE FI becomes "fi" under NFKC.
    expect(normalizeForPasswordComparison('ﬁELD')).toBe('field');
    // A decomposed "é" composes.
    expect(normalizeForPasswordComparison('Café')).toBe('café');
    // Full-width letters fold to ASCII.
    expect(normalizeForPasswordComparison('ＡＢＣ')).toBe('abc');
  });

  it('keeps surrounding whitespace, because the password keeps it', () => {
    expect(normalizeForPasswordComparison(' Abc ')).toBe(' abc ');
  });
});

describe('deriveCommonPasswordBlocklist', () => {
  it('normalises, keeps only policy-length entries, deduplicates, and sorts', () => {
    const source = [
      'short',
      'ExactlyFifteen!',
      'exactlyfifteen!',
      'EXACTLYFIFTEEN!',
      'a'.repeat(PASSWORD_MAX_LENGTH + 1),
      'b'.repeat(PASSWORD_MAX_LENGTH),
      '',
      'Zzzzzzzzzzzzzzzzzzz',
    ].join('\n');

    expect(deriveCommonPasswordBlocklist(source)).toEqual(['b'.repeat(PASSWORD_MAX_LENGTH), 'exactlyfifteen!', 'zzzzzzzzzzzzzzzzzzz']);
  });

  it('accepts CRLF sources', () => {
    expect(deriveCommonPasswordBlocklist('aaaaaaaaaaaaaaaaaaaa\r\nbbbbbbbbbbbbbbbbbbbb\r\n')).toEqual([
      'aaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbb',
    ]);
  });
});

describe('the committed blocklist', () => {
  it('records its source of record', () => {
    expect(COMMON_PASSWORD_BLOCKLIST_SOURCE).toEqual({
      name: 'NCSC PwnedPasswordsTop100k, mirrored in SecLists',
      path: 'Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt',
      commit: 'a23e8a413d8facdad2aa8093492f396e19ab64c1',
      sha256: 'c2e5696882c603b76bb67a47ee970897e5a76fc4c3f5547abe3d0ca340c576e0',
      licence: 'MIT',
    });
  });

  it('is already normalised, within policy length, unique, and sorted', () => {
    const entries = committedEntries();
    expect(entries.length).toBeGreaterThan(300);
    for (const entry of entries) {
      expect(normalizeForPasswordComparison(entry)).toBe(entry);
      expect(entry.length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
      expect(entry.length).toBeLessThanOrEqual(PASSWORD_MAX_LENGTH);
    }
    expect(new Set(entries).size).toBe(entries.length);
    expect([...entries].sort()).toEqual(entries);
  });

  it('matches its pinned hash, so an edit that bypasses review is detected', () => {
    const digest = createHash('sha256').update(committedEntries().join('\n'), 'utf8').digest('hex');
    expect(digest).toBe(COMMON_PASSWORD_BLOCKLIST_ENTRIES_SHA256);
    expect(commonPasswordBlocklistSize()).toBe(committedEntries().length);
  });

  it('refuses a file whose entries do not match the pinned hash', () => {
    expect(() => parseCommonPasswordBlocklist('# header\nnot a pinned entry at all\n', { verify: true })).toThrow(
      /blocklist/i,
    );
  });
});

describe('checkNewPassword', () => {
  it('accepts a long, uncommon passphrase', () => {
    expect(checkNewPassword('synthetic preview passphrase')).toEqual({ ok: true });
  });

  it('refuses the length boundaries exactly as Better Auth measures them', () => {
    expect(checkNewPassword('x'.repeat(PASSWORD_MIN_LENGTH - 1))).toEqual({ ok: false, reason: 'too_short' });
    expect(checkNewPassword('q7'.repeat(8).slice(0, PASSWORD_MIN_LENGTH))).toEqual({ ok: true });
    expect(checkNewPassword('y'.repeat(PASSWORD_MAX_LENGTH + 1))).toEqual({ ok: false, reason: 'too_long' });
  });

  it('refuses a non-string', () => {
    expect(checkNewPassword(undefined)).toEqual({ ok: false, reason: 'too_short' });
    expect(checkNewPassword(123)).toEqual({ ok: false, reason: 'too_short' });
  });

  it('refuses every committed entry, in any letter case', () => {
    const entries = committedEntries();
    for (const entry of [entries[0]!, entries[Math.floor(entries.length / 2)]!, entries.at(-1)!]) {
      expect(checkNewPassword(entry)).toEqual({ ok: false, reason: 'common' });
      expect(checkNewPassword(entry.toUpperCase())).toEqual({ ok: false, reason: 'common' });
    }
  });

  it('refuses a known long common password from the source list', () => {
    expect(checkNewPassword('1q2w3e4r5t6y7u8i9o0p')).toEqual({ ok: false, reason: 'common' });
    expect(checkNewPassword('123456789987654321')).toEqual({ ok: false, reason: 'common' });
  });

  it('refuses a password that is only long because of characters NFKC removes', () => {
    // Fourteen letters plus a combining accent: 15 UTF-16 units raw, 14 after NFKC.
    const padded = 'abcdefghijklmé';
    expect(padded.length).toBe(15);
    expect(checkNewPassword(padded)).toEqual({ ok: false, reason: 'too_short' });
  });

  it('never compares a trimmed form', () => {
    const entry = committedEntries()[0]!;
    expect(checkNewPassword(` ${entry}`)).toEqual({ ok: true });
  });
});
