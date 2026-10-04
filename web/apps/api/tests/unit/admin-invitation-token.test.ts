import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  INVITATION_TOKEN_BYTES,
  generateInvitationToken,
  hashInvitationToken,
  isWellFormedInvitationToken,
} from '../../src/invitations/invitation-token.ts';

// DEC-440 (3): a cryptographically random 256-bit token, of which only a
// SHA-256 hash is ever stored.

describe('Admin invitation token', () => {
  it('carries exactly 256 bits of randomness, encoded as unpadded base64url', () => {
    expect(INVITATION_TOKEN_BYTES).toBe(32);
    const { token } = generateInvitationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(isWellFormedInvitationToken(token)).toBe(true);
  });

  it('never repeats across many generations', () => {
    const tokens = new Set(Array.from({ length: 2_000 }, () => generateInvitationToken().token));
    expect(tokens.size).toBe(2_000);
  });

  it('returns a 32-byte SHA-256 hash that is not the token and matches the documented derivation', () => {
    const { token, hash } = generateInvitationToken();
    expect(hash).toBeInstanceOf(Buffer);
    expect(hash).toHaveLength(32);
    expect(hash.equals(Buffer.from(token, 'base64url'))).toBe(false);
    expect(hash.toString('base64url')).not.toBe(token);
    const expected = createHash('sha256').update('dromex/admin-invitation/v1\0').update(token, 'utf8').digest();
    expect(hash.equals(expected)).toBe(true);
    expect(hashInvitationToken(token).equals(hash)).toBe(true);
  });

  it('separates the invitation hash from a plain SHA-256 of the token', () => {
    const { token, hash } = generateInvitationToken();
    expect(hash.equals(createHash('sha256').update(token).digest())).toBe(false);
  });

  it('recognises only a well-formed token', () => {
    for (const value of [
      '',
      'a'.repeat(42),
      'a'.repeat(44),
      `${'a'.repeat(42)}=`,
      `${'a'.repeat(42)}+`,
      `${'a'.repeat(42)}/`,
      ` ${'a'.repeat(42)}`,
      42,
      null,
      undefined,
      ['a'.repeat(43)],
    ]) {
      expect(isWellFormedInvitationToken(value), String(value)).toBe(false);
    }
  });
});
