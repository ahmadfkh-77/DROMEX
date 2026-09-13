import { describe, expect, it } from 'vitest';

import { OwnerProvisioningError } from '../../src/provisioning/errors.ts';
import { validateOwnerDraft, type OwnerDraft } from '../../src/provisioning/owner-input.ts';

// Synthetic values only. The passphrase is 22 characters, above the
// 15-character minimum, and is never a real credential.
const PASSPHRASE = 'synthetic owner phrase';

function draft(overrides: Partial<OwnerDraft> = {}): OwnerDraft {
  return {
    name: 'Synthetic Owner',
    email: 'owner@synthetic.invalid',
    password: PASSPHRASE,
    passwordConfirmation: PASSPHRASE,
    ...overrides,
  };
}

function refusalOf(action: () => unknown): OwnerProvisioningError {
  try {
    action();
  } catch (error) {
    if (error instanceof OwnerProvisioningError) return error;
    throw error;
  }
  throw new Error('expected validation to refuse the draft');
}

describe('Owner draft validation', () => {
  it('accepts a well-formed draft and normalises the email to lower case', () => {
    expect(
      validateOwnerDraft(draft({ name: '  Synthetic Owner ', email: ' Owner@Synthetic.INVALID ' })),
    ).toEqual({
      name: 'Synthetic Owner',
      email: 'owner@synthetic.invalid',
      password: PASSPHRASE,
    });
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['a control character', 'Synthetic\u0007Owner'],
    ['a line break', 'Synthetic\nOwner'],
    ['longer than 100 characters', 'n'.repeat(101)],
  ])('refuses a name that is %s', (_label, name) => {
    expect(refusalOf(() => validateOwnerDraft(draft({ name }))).code).toBe('invalid_name');
  });

  it.each([
    ['empty', ''],
    ['missing an at sign', 'owner.synthetic.invalid'],
    ['missing a top-level domain', 'owner@synthetic'],
    ['holding consecutive dots', 'own..er@synthetic.invalid'],
    ['holding a space', 'own er@synthetic.invalid'],
    ['longer than 254 characters', `${'a'.repeat(250)}@synthetic.invalid`],
  ])('refuses an email that is %s', (_label, email) => {
    expect(refusalOf(() => validateOwnerDraft(draft({ email }))).code).toBe('invalid_email');
  });

  it('refuses a password shorter than 15 characters', () => {
    const short = 'fourteen chars';
    expect(short).toHaveLength(14);

    const error = refusalOf(() =>
      validateOwnerDraft(draft({ password: short, passwordConfirmation: short })),
    );
    expect(error.code).toBe('invalid_password');
  });

  it('accepts a password of exactly 15 and exactly 128 characters', () => {
    for (const password of ['p'.repeat(15), 'p'.repeat(128)]) {
      expect(validateOwnerDraft(draft({ password, passwordConfirmation: password })).password).toBe(
        password,
      );
    }
  });

  it('refuses a password longer than 128 characters', () => {
    const long = 'p'.repeat(129);
    const error = refusalOf(() =>
      validateOwnerDraft(draft({ password: long, passwordConfirmation: long })),
    );
    expect(error.code).toBe('invalid_password');
  });

  it('passes the password through exactly, never trimming it', () => {
    const spaced = '  synthetic owner phrase  ';
    expect(
      validateOwnerDraft(draft({ password: spaced, passwordConfirmation: spaced })).password,
    ).toBe(spaced);
  });

  it('refuses a confirmation that does not match', () => {
    const error = refusalOf(() =>
      validateOwnerDraft(draft({ passwordConfirmation: `${PASSPHRASE}!` })),
    );
    expect(error.code).toBe('confirmation_mismatch');
  });

  it('never includes the password, confirmation, or email in a refusal', () => {
    const cases: Partial<OwnerDraft>[] = [
      { password: 'short secret', passwordConfirmation: 'short secret' },
      { passwordConfirmation: 'a different synthetic phrase' },
      { email: 'not-an-email-synthetic' },
    ];

    for (const overrides of cases) {
      const error = refusalOf(() => validateOwnerDraft(draft(overrides)));
      const text = `${error.name}\n${error.message}\n${error.stack ?? ''}`;
      for (const leak of ['short secret', 'a different synthetic phrase', PASSPHRASE, 'not-an-email-synthetic']) {
        expect(text).not.toContain(leak);
      }
    }
  });
});
