/**
 * The one error Owner provisioning raises.
 *
 * Every message is a fixed string chosen by code. No message, stack, or
 * property ever carries a password, confirmation, email, name, user id,
 * connection string, SQL text, or an underlying driver or Better Auth error:
 * an unexpected failure is reported as `failed` and its cause is dropped, so
 * nothing sensitive can reach a terminal or a log by way of an error.
 */

export type OwnerProvisioningCode =
  | 'invalid_name'
  | 'invalid_email'
  | 'invalid_password'
  | 'confirmation_mismatch'
  | 'not_interactive'
  | 'cancelled'
  | 'owner_exists'
  | 'in_progress'
  | 'different_pending_email'
  | 'identity_conflict'
  | 'verification_failed'
  | 'session_remains'
  | 'failed';

const MESSAGES: Record<OwnerProvisioningCode, string> = {
  invalid_name: 'The Owner name must be 1 to 100 characters with no control characters.',
  invalid_email: 'The Owner email address is not valid.',
  invalid_password: 'The password must be 15 to 128 characters.',
  confirmation_mismatch: 'The password confirmation does not match.',
  not_interactive: 'Owner provisioning requires an interactive terminal.',
  cancelled: 'Owner provisioning was cancelled. Nothing was created.',
  owner_exists: 'An Owner already exists. Provisioning is refused.',
  in_progress: 'Another Owner provisioning operation is in progress. Nothing was changed.',
  different_pending_email:
    'An interrupted Owner provisioning exists for a different email address. Resume it with the original email address.',
  identity_conflict:
    'An identity with this email address exists that this provisioning cannot claim. Nothing was changed.',
  verification_failed:
    'The password could not be verified for the interrupted provisioning. Nothing was claimed.',
  session_remains:
    'A session for the identity could not be confirmed as revoked. The Owner was not created.',
  failed: 'Owner provisioning failed. No details are shown; the operation can be retried.',
};

export class OwnerProvisioningError extends Error {
  readonly code: OwnerProvisioningCode;

  constructor(code: OwnerProvisioningCode) {
    super(MESSAGES[code]);
    this.name = 'OwnerProvisioningError';
    this.code = code;
  }
}
