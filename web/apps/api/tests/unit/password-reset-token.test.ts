import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { hashInvitationToken } from '../../src/invitations/invitation-token.ts';
import {
  RESET_TOKEN_BYTES,
  generateResetToken,
  hashResetToken,
  isWellFormedResetToken,
} from '../../src/password-reset/reset-token.ts';

// DEC-441 (4), DEC-487 (1): a 256-bit token from the CSPRNG, of which only a
// labelled SHA-256 hash is ever stored.

describe('password reset token', () => {
  it('carries exactly 256 bits of randomness, encoded as unpadded base64url', () => {
    expect(RESET_TOKEN_BYTES).toBe(32);
    const { token } = generateResetToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(isWellFormedResetToken(token)).toBe(true);
  });

  it('never repeats across many generations', () => {
    expect(new Set(Array.from({ length: 2_000 }, () => generateResetToken().token)).size).toBe(2_000);
  });

  it('stores a labelled 32-byte SHA-256 hash that matches the documented derivation', () => {
    const { token, hash } = generateResetToken();
    expect(hash).toHaveLength(32);
    const expected = createHash('sha256').update('dromex/password-reset/v1\0').update(token, 'utf8').digest();
    expect(hash.equals(expected)).toBe(true);
    expect(hashResetToken(token).equals(hash)).toBe(true);
  });

  it('can never be confused with an invitation hash or a plain hash of the same token', () => {
    const { token, hash } = generateResetToken();
    expect(hash.equals(hashInvitationToken(token))).toBe(false);
    expect(hash.equals(createHash('sha256').update(token).digest())).toBe(false);
  });

  it('recognises only a well-formed token', () => {
    for (const value of ['', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}=`, ` ${'a'.repeat(42)}`, 42, null, undefined, ['a'.repeat(43)]]) {
      expect(isWellFormedResetToken(value), String(value)).toBe(false);
    }
  });
});
