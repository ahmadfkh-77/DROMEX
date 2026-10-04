import { hash, verify, type Algorithm } from '@node-rs/argon2';

/**
 * Password hashing for the DROMEX web application (DEC-419).
 *
 * Argon2id at the OWASP Password Storage Cheat Sheet's minimum configuration.
 * Better Auth's own default is scrypt, which is acceptable but is not OWASP's
 * first recommendation; this module is what replaces it when Better Auth is
 * wired in a later checkpoint. Nothing here is wired to Better Auth yet.
 *
 * Deliberately narrow: two functions, no policy. Minimum and maximum password
 * length, breached-password checks, and every other authentication rule belong
 * to the Better Auth configuration checkpoint, not to a hashing primitive. A
 * low-level module that quietly enforces policy is a module whose callers
 * cannot tell what it will reject.
 */

/**
 * Cost parameters are stated explicitly rather than inherited from the
 * library's defaults. They currently coincide with @node-rs/argon2's defaults,
 * which is exactly why they are pinned here: a future upstream change to those
 * defaults must not silently change how DROMEX stores passwords. The encoded
 * PHC string records these values, and a test asserts them against it.
 */
/**
 * `Algorithm` is declared upstream as an ambient `const enum`, which this
 * project's `verbatimModuleSyntax` setting forbids reading in a value
 * position. The numeric member is therefore written out and typed, rather
 * than the enum being imported as a value: upstream declares
 * `Argon2id = 2`, and the test asserting `$argon2id$` in the encoded output
 * is what proves this constant still selects the algorithm it claims to.
 */
const ARGON2ID: Algorithm = 2;

const ARGON2ID_PARAMETERS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Hashes a password, returning a PHC-format string that already contains the
 * algorithm, version, cost parameters, and a freshly generated random salt.
 *
 * The salt is produced by the library's own secure generator; there is no
 * caller-supplied salt, because a caller that can choose the salt can reuse
 * one. Two calls with the same password therefore return different strings.
 *
 * This is one-way. There is deliberately no decrypt or reveal counterpart.
 */
export async function hashPassword(password: string): Promise<string> {
  // The password is passed through exactly as given: not trimmed, not
  // Unicode-normalised, not case-folded. Any of those would silently merge
  // distinct passwords and shrink the keyspace.
  return await hash(password, ARGON2ID_PARAMETERS);
}

/**
 * Verifies a password against a stored PHC string.
 *
 * Returns `false` for a wrong password *and* for a malformed, truncated, or
 * foreign-algorithm hash. That equivalence is intentional: an authentication
 * caller must not be able to distinguish "wrong password" from "corrupt
 * stored hash" by observing an exception, because that difference is exactly
 * what an attacker probes for. Failing closed is the rule (OWASP A01/A10).
 *
 * The library error is swallowed rather than rethrown or logged, so no part of
 * the hash or the password can reach a log line through an error message. The
 * caller learns only true or false.
 *
 * Note on the argument order: @node-rs/argon2's own `verify` takes the hash
 * first and the password second. This wrapper takes the password first, in the
 * order callers naturally read it, and does the swap in one place so no call
 * site can get it backwards.
 */
export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  try {
    return await verify(encodedHash, password, ARGON2ID_PARAMETERS);
  } catch {
    return false;
  }
}
