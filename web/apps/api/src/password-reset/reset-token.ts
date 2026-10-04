import { createHash, randomBytes } from 'node:crypto';

/**
 * Password reset tokens (DEC-441 (4), DEC-487 (1)).
 *
 * A token is 32 bytes (256 bits) from the operating system's CSPRNG, encoded
 * as unpadded base64url so it survives a URL fragment unchanged. Only its
 * SHA-256 hash is stored, over a fixed, versioned label before the token, so
 * a reset hash can never be confused with an invitation hash or any other
 * hash of the same bytes.
 *
 * The token is returned to the caller only to be rendered into one email.
 * JavaScript strings cannot be erased from memory, so "in memory only" means:
 * never stored, logged, audited, returned by an API, or kept in a long-lived
 * structure.
 */

export const RESET_TOKEN_BYTES = 32;

const HASH_LABEL = 'dromex/password-reset/v1\0';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface ResetToken {
  token: string;
  hash: Buffer;
}

export function isWellFormedResetToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value) && Buffer.from(value, 'base64url').length === RESET_TOKEN_BYTES;
}

export function hashResetToken(token: string): Buffer {
  return createHash('sha256').update(HASH_LABEL).update(token, 'utf8').digest();
}

export function generateResetToken(): ResetToken {
  const token = randomBytes(RESET_TOKEN_BYTES).toString('base64url');
  return { token, hash: hashResetToken(token) };
}
