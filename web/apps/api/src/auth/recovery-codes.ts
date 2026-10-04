import { randomBytes } from 'node:crypto';

/**
 * DROMEX recovery codes (DEC-435), generated for Better Auth through its
 * supported `backupCodeOptions.customBackupCodesGenerate` hook.
 *
 * Each code is 24 symbols from the 32-symbol Crockford Base32 alphabet, which
 * leaves out I, L, O, and U so that a handwritten or printed code cannot be
 * misread. Each symbol is the low five bits of one byte from Node's
 * cryptographic random source. Because 32 is a power of two, every one of
 * the 256 byte values maps to exactly one symbol eight times over: there is
 * no modulo bias, and each code carries exactly 24 × 5 = 120 bits.
 *
 * Storage is Better Auth's, and it is reversible encryption rather than a
 * hash (an accepted deviation from NIST SP 800-63B Rev. 4 §3.1.2.2). Nothing
 * here logs, returns, or retains a code beyond the array it hands back.
 */

export const RECOVERY_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_CODE_SYMBOLS = 24;

const GROUP_SIZE = 4;
/** A healthy source essentially never collides; a broken one must not loop forever. */
const MAX_DRAWS = RECOVERY_CODE_COUNT * 4;
const CANONICAL_SYMBOLS = /^[0-9A-HJKMNP-TV-Z]{24}$/;

export type RandomSource = (size: number) => Uint8Array;

function grouped(symbols: string): string {
  const groups: string[] = [];
  for (let index = 0; index < symbols.length; index += GROUP_SIZE) {
    groups.push(symbols.slice(index, index + GROUP_SIZE));
  }
  return groups.join('-');
}

/**
 * Returns ten distinct codes in canonical grouped form,
 * `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`. Synchronous, because Better Auth's hook is.
 */
export function generateRecoveryCodes(random: RandomSource = randomBytes): string[] {
  const codes = new Set<string>();

  for (let draws = 0; codes.size < RECOVERY_CODE_COUNT; draws += 1) {
    if (draws >= MAX_DRAWS) {
      throw new Error('Recovery code generation failed: the random source did not produce distinct codes.');
    }

    const bytes = random(RECOVERY_CODE_SYMBOLS);
    if (!(bytes instanceof Uint8Array) || bytes.length !== RECOVERY_CODE_SYMBOLS) {
      throw new Error('Recovery code generation failed: the random source returned the wrong amount of data.');
    }

    let symbols = '';
    for (const byte of bytes) symbols += RECOVERY_CODE_ALPHABET[byte & 0x1f];
    codes.add(grouped(symbols));
  }

  return [...codes];
}

/**
 * Normalises what a person types into the canonical grouped form, or returns
 * `null`. Outer whitespace is trimmed; spaces and hyphens inside are removed;
 * letters are upper-cased; and only the Crockford decoding rules are applied
 * (O reads as 0, I and L read as 1). Anything else invalid is rejected, and a
 * code of the wrong length is never truncated or padded.
 */
export function normalizeRecoveryCode(input: string): string | null {
  if (typeof input !== 'string') return null;

  const compact = input
    .trim()
    .replace(/[ -]/g, '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');

  return CANONICAL_SYMBOLS.test(compact) ? grouped(compact) : null;
}
