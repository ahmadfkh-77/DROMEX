import { parseRetryAfter, type ApiResult } from '../signin/machine.ts';

/**
 * What each server answer means for the Owner recovery screen (batch 4c). Pure
 * functions with no browser access. Only an explicit, well-formed success
 * counts as success; a 200 that is anything else is a failure. The server
 * answers every wrong recovery code with one 401, and these functions never
 * invent a distinction it does not make.
 */

export type RecoveryFailureKey =
  | 'missingFields'
  | 'invalidRecoveryCode'
  | 'recoveryCodeFormat'
  | 'invalidCode'
  | 'codeFormat'
  | 'recoveryEnded'
  | 'codeMayBeUsed'
  | 'refused'
  | 'rateLimited'
  | 'network'
  | 'unexpected';

export interface RecoveryFailure {
  kind: 'failed';
  key: RecoveryFailureKey;
  /** Whole seconds from the server, only for `rateLimited` and only when valid. */
  retryAfterSeconds: number | null;
}

export type RecoveryCodeOutcome = { kind: 'accepted' } | RecoveryFailure;
export type EnrolmentOutcome = { kind: 'enrol'; manualEntrySecret: string } | RecoveryFailure;
export type ReplacementOutcome = { kind: 'completed'; recoveryCodes: string[] } | RecoveryFailure;

const CANONICAL_CODE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/;
const SETUP_KEY = /^[A-Z2-7]{1,4}(-[A-Z2-7]{1,4})*$/;
const CODE_COUNT = 10;

function failure(key: RecoveryFailureKey, retryAfterSeconds: number | null = null): RecoveryFailure {
  return { kind: 'failed', key, retryAfterSeconds };
}

/** The server's Crockford rules: separators dropped, upper-cased, O to 0, I and L to 1, exactly 24 symbols. */
export function normalizeRecoveryCodeInput(raw: string): string | null {
  const compact = raw
    .trim()
    .replace(/[ -]/g, '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (!/^[0-9A-HJKMNP-TV-Z]{24}$/.test(compact)) return null;
  return compact.match(/.{4}/g)!.join('-');
}

/** Failures every recovery endpoint shares. */
function common(result: ApiResult): RecoveryFailure {
  switch (result.status) {
    case 0:
      return failure('network');
    case 403:
      return failure('refused');
    case 429:
      return failure('rateLimited', parseRetryAfter(result.retryAfter));
    default:
      return failure('unexpected');
  }
}

export function recoveryCodeOutcome(result: ApiResult): RecoveryCodeOutcome {
  if (result.status === 200) {
    return result.data.recovery === 'authenticator_replacement_required' ? { kind: 'accepted' } : failure('unexpected');
  }
  if (result.status === 401) return failure('invalidRecoveryCode');
  // The server may have used the code up before it failed, so a retry with the same code cannot be offered.
  if (result.status >= 500) return failure('codeMayBeUsed');
  return common(result);
}

/** After the recovery has begun, a 401 or a server fault means the server ended it. */
function afterRecoveryBegan(result: ApiResult): RecoveryFailure {
  if (result.status === 401 || result.status >= 500) return failure('recoveryEnded');
  return common(result);
}

export function enrolmentOutcome(result: ApiResult): EnrolmentOutcome {
  if (result.status === 200) {
    const { totpUri, manualEntrySecret } = result.data;
    if (
      typeof totpUri === 'string' &&
      totpUri.startsWith('otpauth://totp/') &&
      typeof manualEntrySecret === 'string' &&
      SETUP_KEY.test(manualEntrySecret)
    ) {
      return { kind: 'enrol', manualEntrySecret };
    }
    return failure('unexpected');
  }
  return afterRecoveryBegan(result);
}

export function replacementOutcome(result: ApiResult): ReplacementOutcome {
  if (result.status === 200) {
    const { recoveryCodes, signInRequired } = result.data;
    if (
      signInRequired === true &&
      Array.isArray(recoveryCodes) &&
      recoveryCodes.length === CODE_COUNT &&
      recoveryCodes.every((code) => typeof code === 'string' && CANONICAL_CODE.test(code)) &&
      new Set(recoveryCodes).size === CODE_COUNT
    ) {
      return { kind: 'completed', recoveryCodes: recoveryCodes as string[] };
    }
    return failure('unexpected');
  }
  // Only the server's explicit "wrong code" keeps the recovery open for another try.
  if (result.status === 401 && result.data.error === 'invalid_code') return failure('invalidCode');
  return afterRecoveryBegan(result);
}
