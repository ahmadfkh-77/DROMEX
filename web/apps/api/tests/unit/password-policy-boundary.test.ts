import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * DEC-488: every path that creates or changes a password applies the shared
 * policy inside the module that hands the password to Better Auth. This scans
 * the source rather than trusting a list, so a new password-setting call that
 * forgets the policy fails here.
 */

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({
  path: relative(SRC, path).replaceAll('\\', '/'),
  text: readFileSync(path, 'utf8'),
}));

/** Better Auth server calls that store a new password. */
const PASSWORD_WRITES = /\bapi\.(signUpEmail|resetPassword)\s*\(/;
/** Better Auth password writes DROMEX has not approved at all. */
const UNAPPROVED_WRITES = /\b(api\.(changePassword|setPassword|setUserPassword)|internalAdapter\.updatePassword)\s*\(/;

describe('the password policy boundary', () => {
  const writers = files.filter((file) => PASSWORD_WRITES.test(file.text));

  it('knows exactly which modules write a new password', () => {
    expect(writers.map((file) => file.path).sort()).toEqual([
      'invitations/enrolment-identity.ts',
      'password-reset/reset-identity.ts',
      'provisioning/owner-identity.ts',
    ]);
  });

  it.each(writers.map((file) => [file.path, file.text] as const))('%s applies the shared policy', (_path, text) => {
    expect(text).toMatch(/import \{[^}]*\bcheckNewPassword\b[^}]*\} from '\.\.\/auth\/password-policy\.ts';/);
    expect(text).toMatch(/checkNewPassword\(/);
  });

  it('calls no other Better Auth password-writing API anywhere', () => {
    expect(files.filter((file) => UNAPPROVED_WRITES.test(file.text)).map((file) => file.path)).toEqual([]);
  });

  it('never places the policy in the password hash, where sign-in would expose it', () => {
    const hashing = files.find((file) => file.path === 'auth/hashing.ts')!;
    expect(hashing.text).not.toMatch(/password-policy|checkNewPassword/);
  });
});
