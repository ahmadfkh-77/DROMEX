import { createHash, randomBytes } from 'node:crypto';

/**
 * Admin invitation tokens (DEC-440 (3)).
 *
 * A token is 32 bytes (256 bits) from the operating system's CSPRNG, encoded
 * as unpadded base64url so it survives a URL fragment unchanged. Only its
 * SHA-256 hash is stored. The hash covers a fixed, versioned label before the
 * token, so an invitation hash can never be confused with a hash of the same
 * bytes made for another purpose, such as a password-reset token.
 *
 * The token itself is returned to the caller only to be rendered into one
 * email. JavaScript strings cannot be erased from memory, so "in memory only"
 * means: never stored, logged, audited, returned by an API, or kept in a
 * long-lived structure.
 */

export const INVITATION_TOKEN_BYTES = 32;

const HASH_LABEL = 'dromex/admin-invitation/v1\0';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface InvitationToken {
  token: string;
  hash: Buffer;
}

export function isWellFormedInvitationToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value) && Buffer.from(value, 'base64url').length === INVITATION_TOKEN_BYTES;
}

export function hashInvitationToken(token: string): Buffer {
  return createHash('sha256').update(HASH_LABEL).update(token, 'utf8').digest();
}

export function generateInvitationToken(): InvitationToken {
  const token = randomBytes(INVITATION_TOKEN_BYTES).toString('base64url');
  return { token, hash: hashInvitationToken(token) };
}
