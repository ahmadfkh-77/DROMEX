/**
 * The one error terminal Owner recovery raises (DEC-437).
 *
 * Every message is a fixed string chosen by code. No message, stack, or
 * property ever carries a password, code, TOTP secret, cookie, email, user id,
 * connection string, SQL text, or an underlying driver, Better Auth, or
 * terminal error: an unexpected failure is reported as `failed` and its cause
 * is dropped, so nothing sensitive can reach a terminal or a log this way.
 */

export type TerminalRecoveryCode =
  | 'not_interactive'
  | 'cancelled'
  | 'in_progress'
  | 'not_eligible'
  | 'version_mismatch'
  | 'schema_mismatch'
  | 'throttled'
  | 'not_confirmed'
  | 'verification_failed'
  | 'totp_attempts_exhausted'
  | 'totp_locked'
  | 'factor_changed'
  | 'session_remains'
  | 'failed';

const BLOCKED = 'Business access stays blocked until a later run completes.';

const MESSAGES: Record<TerminalRecoveryCode, string> = {
  not_interactive: 'Terminal Owner recovery requires an interactive terminal. Nothing was changed.',
  cancelled: `Terminal Owner recovery was cancelled. If recovery had begun, ${BLOCKED.toLowerCase()}`,
  in_progress: 'Another terminal Owner recovery is in progress. Nothing was changed.',
  not_eligible: 'Terminal Owner recovery requires exactly one active Owner. Nothing was changed.',
  version_mismatch:
    'The installed Better Auth version is not the version this recovery was verified against. Nothing was changed.',
  schema_mismatch:
    'The database schema is not the schema this recovery was verified against. Nothing was changed.',
  throttled: 'Too many rejected passwords recently. Wait fifteen minutes, then run the command again. Nothing was changed.',
  not_confirmed: `A required confirmation was not given exactly. If recovery had begun, ${BLOCKED.toLowerCase()}`,
  verification_failed:
    'The password could not be verified. Nothing was changed. This command does not reset a forgotten password.',
  totp_attempts_exhausted: `The authenticator code could not be verified in five attempts. ${BLOCKED}`,
  totp_locked: `Too many failed authenticator verifications. Wait for the lockout to end, then run the command again. ${BLOCKED}`,
  factor_changed:
    "The Owner's factor changed while the reset was being confirmed. Nothing was reset; run the command again.",
  session_remains: `An Owner session could not be confirmed as revoked, so recovery did not complete. ${BLOCKED}`,
  failed: `Terminal Owner recovery failed. No details are shown. ${BLOCKED}`,
};

export class TerminalRecoveryError extends Error {
  readonly code: TerminalRecoveryCode;

  constructor(code: TerminalRecoveryCode) {
    super(MESSAGES[code]);
    this.name = 'TerminalRecoveryError';
    this.code = code;
  }
}
