import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../auth/config.ts';
import { OwnerProvisioningError } from './errors.ts';

/** What an operator enters. */
export interface OwnerDraft {
  name: string;
  email: string;
  password: string;
  passwordConfirmation: string;
}

/** A validated draft. The confirmation has served its purpose and is gone. */
export interface OwnerInput {
  name: string;
  /** Trimmed and lower-cased, exactly as Better Auth stores it. */
  email: string;
  /** Exactly as entered: never trimmed, normalised, or case-folded. */
  password: string;
}

const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;

/**
 * A deliberately conservative address shape, and a strict subset of the
 * address syntax Better Auth itself accepts, so an address that passes here
 * is never rejected by Better Auth after provisioning has started writing.
 */
const EMAIL_SHAPE =
  /^[a-z0-9_+-]+(?:\.[a-z0-9_+-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

const CONTROL_CHARACTER = /\p{Cc}/u;

/**
 * Validates an Owner draft completely before any database connection or
 * Better Auth call is made.
 *
 * Password length uses the same constants and the same measure Better Auth
 * applies. Surrounding whitespace in a password is permitted and preserved,
 * matching the existing policy: `hashPassword` passes passwords through
 * unchanged, and trimming here would silently change the credential.
 */
export function validateOwnerDraft(draft: OwnerDraft): OwnerInput {
  const name = typeof draft.name === 'string' ? draft.name.trim() : '';
  if (name.length === 0 || name.length > MAX_NAME_LENGTH || CONTROL_CHARACTER.test(name)) {
    throw new OwnerProvisioningError('invalid_name');
  }

  const email = typeof draft.email === 'string' ? draft.email.trim().toLowerCase() : '';
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_SHAPE.test(email)) {
    throw new OwnerProvisioningError('invalid_email');
  }

  const { password, passwordConfirmation } = draft;
  if (
    typeof password !== 'string' ||
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    throw new OwnerProvisioningError('invalid_password');
  }

  if (passwordConfirmation !== password) {
    throw new OwnerProvisioningError('confirmation_mismatch');
  }

  return { name, email, password };
}
