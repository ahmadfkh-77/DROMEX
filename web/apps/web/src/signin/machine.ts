/**
 * What each server answer means for the sign-in and account pages. Pure
 * functions with no browser access, so they are unit tested alone.
 *
 * The server answers every failed sign-in with one 401, whatever the cause
 * (unknown address, wrong password, disabled or pending account), and every
 * failed code with one 401. These functions must never invent a distinction
 * the server does not make, and must never treat a response that is not an
 * explicit success as one.
 */

export interface ApiResult {
  status: number;
  data: Record<string, unknown>;
  /** The raw `Retry-After` header, if any. */
  retryAfter: string | null;
}

export type FailureKey =
  | 'invalidCredentials'
  | 'invalidCode'
  | 'codeFormat'
  | 'alreadySignedIn'
  | 'refused'
  | 'rateLimited'
  | 'network'
  | 'unexpected';

export interface Failure {
  kind: 'failed';
  key: FailureKey;
  /** Whole seconds from the server, only for `rateLimited` and only when valid. */
  retryAfterSeconds: number | null;
}

export type PasswordOutcome = { kind: 'mfa' } | Failure;
export type CodeOutcome = { kind: 'signedIn' } | Failure;
export type SignOutOutcome = { kind: 'signedOut' } | Failure;
export type SessionOutcome =
  | { kind: 'active'; name: string; email: string; isOwner: boolean }
  | { kind: 'ended' }
  | Failure;

const MAX_RETRY_AFTER_SECONDS = 3600;

/** A whole number of seconds from 1 to 3600, or `null`. The server sends nothing else. */
export function parseRetryAfter(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,3}$/.test(value)) return null;
  const seconds = Number(value);
  return seconds <= MAX_RETRY_AFTER_SECONDS ? seconds : null;
}

/** Exactly six ASCII digits once spaces and hyphens a user may paste are removed. */
export function normalizeCode(raw: string): string | null {
  const cleaned = raw.replace(/[\s-]/g, '');
  return /^[0-9]{6}$/.test(cleaned) ? cleaned : null;
}

function failure(key: FailureKey, retryAfterSeconds: number | null = null): Failure {
  return { kind: 'failed', key, retryAfterSeconds };
}

/** Failures every endpoint shares. `unauthorized` is the caller's own 401 meaning. */
function common(result: ApiResult, unauthorized: FailureKey): Failure {
  switch (result.status) {
    case 0:
      return failure('network');
    case 401:
      return failure(unauthorized);
    case 429:
      return failure('rateLimited', parseRetryAfter(result.retryAfter));
    default:
      return failure('unexpected');
  }
}

export function passwordOutcome(result: ApiResult): PasswordOutcome {
  if (result.status === 200) {
    return result.data.mfaRequired === true ? { kind: 'mfa' } : failure('unexpected');
  }
  // 403 here only means this browser already holds a full session; it says
  // nothing about the account being tried.
  if (result.status === 403) return failure('alreadySignedIn');
  return common(result, 'invalidCredentials');
}

export function codeOutcome(result: ApiResult): CodeOutcome {
  if (result.status === 200) {
    return result.data.authenticated === true ? { kind: 'signedIn' } : failure('unexpected');
  }
  // 403 here is an untrusted origin, not an account state.
  if (result.status === 403) return failure('refused');
  return common(result, 'invalidCode');
}

export function sessionOutcome(result: ApiResult): SessionOutcome {
  if (result.status === 200) {
    const user = result.data.user as { name?: unknown; email?: unknown; id?: unknown } | null | undefined;
    if (
      typeof user === 'object' &&
      user !== null &&
      typeof user.id === 'string' &&
      typeof user.name === 'string' &&
      typeof user.email === 'string' &&
      typeof result.data.isOwner === 'boolean'
    ) {
      return { kind: 'active', name: user.name, email: user.email, isOwner: result.data.isOwner };
    }
    return failure('unexpected');
  }
  if (result.status === 401) return { kind: 'ended' };
  return common(result, 'unexpected');
}

export function signOutOutcome(result: ApiResult): SignOutOutcome {
  if (result.status === 200 && result.data.signedOut === true) return { kind: 'signedOut' };
  return common(result, 'unexpected');
}
