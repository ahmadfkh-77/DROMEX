import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { RECOVERY_STRINGS } from '../signin/strings.ts';
import {
  enrolmentOutcome,
  normalizeRecoveryCodeInput,
  recoveryCodeOutcome,
  replacementOutcome,
  type RecoveryFailureKey,
} from './machine.ts';

const result = (status: number, data: Record<string, unknown> = {}, retryAfter: string | null = null) => ({
  status,
  data,
  retryAfter,
});

const CODE = '0123-4567-89AB-CDEF-GHJK-MNPQ';
const SET = Array.from({ length: 10 }, (_, index) => `${String(index).padStart(4, '0')}-4567-89AB-CDEF-GHJK-MNPQ`);

const failed = (key: RecoveryFailureKey, retryAfterSeconds: number | null = null) => ({ kind: 'failed', key, retryAfterSeconds });

describe('normalizeRecoveryCodeInput', () => {
  test('accepts the grouped form and what a person might type or paste', () => {
    assert.equal(normalizeRecoveryCodeInput(CODE), CODE);
    assert.equal(normalizeRecoveryCodeInput(` ${CODE.toLowerCase()} `), CODE);
    assert.equal(normalizeRecoveryCodeInput(CODE.replace(/-/g, ' ')), CODE);
    assert.equal(normalizeRecoveryCodeInput(CODE.replace(/-/g, '')), CODE);
  });
  test('reads O as 0 and I or L as 1, as the server does', () => {
    assert.equal(normalizeRecoveryCodeInput('OIL0-4567-89AB-CDEF-GHJK-MNPQ'), '0110-4567-89AB-CDEF-GHJK-MNPQ');
  });
  test('refuses anything of the wrong length or alphabet, and never truncates or pads', () => {
    for (const bad of ['', '1234', `${CODE}A`, CODE.slice(0, -1), 'UUUU-4567-89AB-CDEF-GHJK-MNPQ', '0123-4567-89AB-CDEF-GHJK-MN!Q', '٠١٢٣-4567-89AB-CDEF-GHJK-MNPQ']) {
      assert.equal(normalizeRecoveryCodeInput(bad), null, bad);
    }
  });
});

describe('recoveryCodeOutcome', () => {
  test('only the explicit replacement-required answer on a 200 continues', () => {
    assert.deepEqual(recoveryCodeOutcome(result(200, { recovery: 'authenticator_replacement_required', expiresInSeconds: 900 })), {
      kind: 'accepted',
    });
    for (const data of [{}, { recovery: 'done' }, { authenticated: true }, { recovery: 'authenticator_replacement_required ' }]) {
      assert.equal(recoveryCodeOutcome(result(200, data)).kind, 'failed');
    }
  });
  test('every 401 is one failure whatever the body says', () => {
    for (const data of [{ error: 'invalid_code' }, {}, { error: 'account_disabled' }, { error: 'not_owner' }]) {
      assert.deepEqual(recoveryCodeOutcome(result(401, data)), failed('invalidRecoveryCode'));
    }
  });
  test('403 is a refused request, 429 a rate limit with a valid Retry-After only, 0 a network failure', () => {
    assert.deepEqual(recoveryCodeOutcome(result(403)), failed('refused'));
    assert.deepEqual(recoveryCodeOutcome(result(429, {}, '30')), failed('rateLimited', 30));
    assert.deepEqual(recoveryCodeOutcome(result(429, {}, 'soon')), failed('rateLimited'));
    assert.deepEqual(recoveryCodeOutcome(result(0)), failed('network'));
    assert.deepEqual(recoveryCodeOutcome(result(500)), failed('codeMayBeUsed'));
    assert.deepEqual(recoveryCodeOutcome(result(404)), failed('unexpected'));
  });
});

describe('enrolmentOutcome', () => {
  const body = { totpUri: 'otpauth://totp/DROMEX:owner?secret=ABCDEFGH23456723&issuer=DROMEX', manualEntrySecret: 'ABCD-EFGH-2345-6723' };
  test('a 200 with a well-formed enrolment key shows the key', () => {
    assert.deepEqual(enrolmentOutcome(result(200, body)), { kind: 'enrol', manualEntrySecret: 'ABCD-EFGH-2345-6723' });
  });
  test('a malformed 200 never counts', () => {
    for (const data of [{}, { manualEntrySecret: 'ABCD' }, { ...body, manualEntrySecret: 'abcd-efgh' }, { ...body, totpUri: 'https://example.test' }, { ...body, manualEntrySecret: 5 }]) {
      assert.equal(enrolmentOutcome(result(200, data)).kind, 'failed');
    }
  });
  test('a 401 means the recovery has ended; a server fault means it must be started again', () => {
    assert.deepEqual(enrolmentOutcome(result(401, { error: 'recovery_failed' })), failed('recoveryEnded'));
    assert.deepEqual(enrolmentOutcome(result(401, { error: 'unauthorized' })), failed('recoveryEnded'));
    assert.deepEqual(enrolmentOutcome(result(500)), failed('recoveryEnded'));
    assert.deepEqual(enrolmentOutcome(result(403)), failed('refused'));
    assert.deepEqual(enrolmentOutcome(result(429, {}, '5')), failed('rateLimited', 5));
    assert.deepEqual(enrolmentOutcome(result(0)), failed('network'));
  });
});

describe('replacementOutcome', () => {
  test('success needs a 200, the full canonical set of ten codes, and signInRequired:true', () => {
    assert.deepEqual(replacementOutcome(result(200, { recoveryCodes: SET, signInRequired: true })), { kind: 'completed', recoveryCodes: SET });
  });
  test('a 200 that is not exactly that is never success', () => {
    const bad = [
      {},
      { recoveryCodes: SET },
      { recoveryCodes: SET, signInRequired: false },
      { recoveryCodes: SET.slice(1), signInRequired: true },
      { recoveryCodes: [...SET.slice(1), SET[1]], signInRequired: true },
      { recoveryCodes: [...SET.slice(1), 'not-a-code'], signInRequired: true },
      { recoveryCodes: 'x', signInRequired: true },
    ];
    for (const data of bad) assert.equal(replacementOutcome(result(200, data)).kind, 'failed');
  });
  test('a wrong code allows another try; an ended recovery does not', () => {
    assert.deepEqual(replacementOutcome(result(401, { error: 'invalid_code' })), failed('invalidCode'));
    assert.deepEqual(replacementOutcome(result(401, { error: 'recovery_failed' })), failed('recoveryEnded'));
    assert.deepEqual(replacementOutcome(result(401, { error: 'unauthorized' })), failed('recoveryEnded'));
    assert.deepEqual(replacementOutcome(result(401, {})), failed('recoveryEnded'));
    assert.deepEqual(replacementOutcome(result(500)), failed('recoveryEnded'));
    assert.deepEqual(replacementOutcome(result(429, {}, '9')), failed('rateLimited', 9));
    assert.deepEqual(replacementOutcome(result(0)), failed('network'));
  });
});

describe('recovery strings', () => {
  test('every failure has its own non-empty message', () => {
    const keys = Object.keys(RECOVERY_STRINGS.failures) as RecoveryFailureKey[];
    const messages = keys.map((key) => RECOVERY_STRINGS.failures[key]);
    for (const message of messages) assert.ok(message.length > 10);
    assert.equal(new Set(messages).size, keys.length);
  });
  test('the recovery-code failure reveals nothing about the account', () => {
    const revealing = /disabled|pending|locked|suspended|not found|no account|does not exist|not the owner|unknown (user|email)/i;
    for (const key of ['invalidRecoveryCode', 'rateLimited'] as const) assert.doesNotMatch(RECOVERY_STRINGS.failures[key], revealing);
  });
  test('the Admin guidance sends the person to the Owner and offers no self-service step', () => {
    assert.match(RECOVERY_STRINGS.adminBody, /Owner/);
    assert.doesNotMatch(RECOVERY_STRINGS.adminBody, /click|enter your|recovery code|email you|we will send/i);
  });
});
