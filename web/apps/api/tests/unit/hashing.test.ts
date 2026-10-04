import { afterEach, describe, expect, it, vi } from 'vitest';

import { hashPassword, verifyPassword } from '../../src/auth/hashing.ts';

// A representative password that is NOT a real credential. It deliberately
// contains a space and non-ASCII characters, because the most common hashing
// defect is silent trimming or Unicode normalisation.
const PASSWORD = 'correct horse battery staple ünïcode ✅';

describe('password hashing (Argon2id)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never returns the password in the encoded hash', async () => {
    const encoded = await hashPassword(PASSWORD);

    expect(encoded).not.toContain(PASSWORD);
    expect(encoded).not.toContain('correct horse');
    expect(encoded).not.toBe(PASSWORD);
  });

  it('produces a PHC string identifying argon2id', async () => {
    const encoded = await hashPassword(PASSWORD);

    expect(encoded.startsWith('$argon2id$')).toBe(true);
  });

  it('records exactly the approved cost parameters (DEC-419)', async () => {
    // OWASP Password Storage Cheat Sheet minimum for Argon2id:
    // m=19456 KiB, t=2, p=1. Asserted against the encoded string itself,
    // which is the ground truth a future reader can verify by eye, rather
    // than against the options object we passed in.
    const encoded = await hashPassword(PASSWORD);
    const [, algorithm, version, params] = encoded.split('$');

    expect(algorithm).toBe('argon2id');
    expect(version).toBe('v=19');
    expect(params).toBe('m=19456,t=2,p=1');
  });

  it('verifies the correct password', async () => {
    const encoded = await hashPassword(PASSWORD);

    await expect(verifyPassword(PASSWORD, encoded)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const encoded = await hashPassword(PASSWORD);

    await expect(verifyPassword(`${PASSWORD}x`, encoded)).resolves.toBe(false);
  });

  it('produces a different hash each time, because the salt is fresh', async () => {
    const first = await hashPassword(PASSWORD);
    const second = await hashPassword(PASSWORD);

    expect(first).not.toBe(second);
    // Both must still verify: differing output is salt, not corruption.
    await expect(verifyPassword(PASSWORD, first)).resolves.toBe(true);
    await expect(verifyPassword(PASSWORD, second)).resolves.toBe(true);
  });

  it('preserves leading and trailing spaces exactly', async () => {
    // Trimming a password silently shrinks the keyspace and makes
    // "  secret  " and "secret" the same credential. This module must not
    // invent that behaviour.
    const padded = '  spaced secret  ';
    const encoded = await hashPassword(padded);

    await expect(verifyPassword(padded, encoded)).resolves.toBe(true);
    await expect(verifyPassword('spaced secret', encoded)).resolves.toBe(false);
  });

  it('preserves Unicode exactly, without normalisation or case folding', async () => {
    // U+00E9 (é precomposed) and U+0065 U+0301 (e + combining acute) look
    // identical but are different passwords. Normalising them together would
    // be an invented policy this module must not apply.
    const precomposed = 'café';
    const decomposed = 'café';
    const encoded = await hashPassword(precomposed);

    await expect(verifyPassword(precomposed, encoded)).resolves.toBe(true);
    await expect(verifyPassword(decomposed, encoded)).resolves.toBe(false);
    await expect(verifyPassword('CAFÉ', encoded)).resolves.toBe(false);
  });

  it('fails safely on a malformed hash rather than throwing', async () => {
    // An authentication caller must get a plain false. A raw library error
    // reaching the caller turns a corrupt stored hash into an error path
    // that behaves differently from a wrong password, which is exactly the
    // distinction an attacker probes for.
    for (const malformed of [
      '',
      'not-a-hash',
      '$argon2id$',
      '$argon2id$v=19$m=19456,t=2,p=1$notbase64$notbase64',
      '$bcrypt$v=19$m=19456,t=2,p=1$abc$def',
    ]) {
      await expect(verifyPassword(PASSWORD, malformed)).resolves.toBe(false);
    }
  });

  it('writes no password and no encoded hash to the console', async () => {
    const spies = {
      log: vi.spyOn(console, 'log').mockImplementation(() => undefined),
      info: vi.spyOn(console, 'info').mockImplementation(() => undefined),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
      debug: vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    };

    const encoded = await hashPassword(PASSWORD);
    await verifyPassword(PASSWORD, encoded);
    await verifyPassword('wrong', encoded);
    await verifyPassword(PASSWORD, 'not-a-hash');

    for (const spy of Object.values(spies)) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
