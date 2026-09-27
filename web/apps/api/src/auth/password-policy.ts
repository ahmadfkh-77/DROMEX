import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './config.ts';

/**
 * The policy every new web password must meet (DEC-419, DEC-488).
 *
 * One function, {@link checkNewPassword}, answers "may this become a
 * password?". Every path that creates or changes a password calls it inside
 * the identity port that hands the password to Better Auth: terminal Owner
 * activation, Admin invitation setup, and password reset. A boundary test
 * proves each such port does.
 *
 * It is deliberately **not** placed inside the password hash function.
 * Better Auth also hashes candidate passwords while signing in an unknown
 * account, to even out timing; a refusal there would reveal whether an
 * account exists. Existing passwords are never re-checked at sign-in.
 *
 * **The common-password blocklist (DEC-488).** An offline list derived from
 * the NCSC "PwnedPasswordsTop100k" list as mirrored in SecLists, pinned by
 * commit and hash. Only entries that can matter under the length policy are
 * kept: each is normalised exactly as a candidate is compared (Unicode NFKC,
 * then lower case), kept only if 15 to 128 UTF-16 code units long,
 * deduplicated, and sorted. The committed file carries that list, and its
 * entries are verified against a pinned SHA-256 on first use, which the server
 * forces while it is built, so an unreviewed edit stops startup instead of
 * quietly weakening the check.
 * Nothing is ever fetched at runtime and no password leaves the process.
 *
 * **Normalisation.** A candidate is compared after NFKC and lower-casing, so
 * letter case, full-width forms, and compatibility characters cannot dodge an
 * entry. Surrounding whitespace is kept, because the password keeps it. A
 * password that is 15 units long only because NFKC would remove or merge
 * characters is refused as too short, so combining marks cannot pad a short
 * common password past the length rule.
 */

export type PasswordPolicyReason = 'too_short' | 'too_long' | 'common';
export type PasswordPolicyResult = { ok: true } | { ok: false; reason: PasswordPolicyReason };

export const COMMON_PASSWORD_BLOCKLIST_SOURCE = {
  name: 'NCSC PwnedPasswordsTop100k, mirrored in SecLists',
  path: 'Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt',
  commit: 'a23e8a413d8facdad2aa8093492f396e19ab64c1',
  sha256: 'c2e5696882c603b76bb67a47ee970897e5a76fc4c3f5547abe3d0ca340c576e0',
  licence: 'MIT',
} as const;

/** SHA-256 of the committed entries joined by `\n`, independent of the file's line endings. */
export const COMMON_PASSWORD_BLOCKLIST_ENTRIES_SHA256 = '70e286518746e80dd6670c62cdd6aa775b2f0bb83802dfa4033e7f397a26211d';

const BLOCKLIST_FILE = new URL('./common-passwords.txt', import.meta.url);

export function normalizeForPasswordComparison(password: string): string {
  return password.normalize('NFKC').toLowerCase();
}

function withinPolicyLength(value: string): boolean {
  return value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH;
}

/** The derived list from a raw source list: normalised, policy-length only, unique, sorted. */
export function deriveCommonPasswordBlocklist(source: string): string[] {
  const entries = new Set<string>();
  for (const line of source.split(/\r?\n/)) {
    if (line === '') continue;
    const normalized = normalizeForPasswordComparison(line);
    if (withinPolicyLength(normalized)) entries.add(normalized);
  }
  return [...entries].sort();
}

function entriesDigest(entries: readonly string[]): string {
  return createHash('sha256').update(entries.join('\n'), 'utf8').digest('hex');
}

/**
 * The entries of a committed blocklist file. Lines starting with `#` are the
 * provenance header; blank lines are ignored. With `verify`, the entries must
 * match the pinned hash or this throws without echoing any entry.
 */
export function parseCommonPasswordBlocklist(text: string, options: { verify?: boolean } = {}): string[] {
  const entries = text.split(/\r?\n/).filter((line) => line !== '' && !line.startsWith('#'));
  if (options.verify === true && entriesDigest(entries) !== COMMON_PASSWORD_BLOCKLIST_ENTRIES_SHA256) {
    throw new Error('The common-password blocklist does not match its pinned hash. Restore the reviewed file.');
  }
  return entries;
}

let blocklist: ReadonlySet<string> | null = null;

/** Loads and verifies the committed list once. Throws, failing closed, if it is missing or altered. */
function loadedBlocklist(): ReadonlySet<string> {
  blocklist ??= new Set(parseCommonPasswordBlocklist(readFileSync(BLOCKLIST_FILE, 'utf8'), { verify: true }));
  return blocklist;
}

/**
 * The number of verified entries. The server calls this while it is built,
 * so a missing or altered list stops startup rather than the first request.
 */
export function commonPasswordBlocklistSize(): number {
  return loadedBlocklist().size;
}

/**
 * Whether `password` may become a new password. Measures length exactly as
 * Better Auth does (UTF-16 code units, untrimmed), then the normalised form.
 */
export function checkNewPassword(password: unknown): PasswordPolicyResult {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) return { ok: false, reason: 'too_short' };
  if (password.length > PASSWORD_MAX_LENGTH) return { ok: false, reason: 'too_long' };
  const normalized = normalizeForPasswordComparison(password);
  if (normalized.length < PASSWORD_MIN_LENGTH) return { ok: false, reason: 'too_short' };
  if (loadedBlocklist().has(normalized)) return { ok: false, reason: 'common' };
  return { ok: true };
}
