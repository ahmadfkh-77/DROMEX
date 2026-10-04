import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  codeOutcome,
  normalizeCode,
  parseRetryAfter,
  passwordOutcome,
  sessionOutcome,
  signOutOutcome,
  type FailureKey,
} from './machine.ts';
import { SIGNIN_STRINGS } from './strings.ts';

const result = (status: number, data: Record<string, unknown> = {}, retryAfter: string | null = null) => ({
  status,
  data,
  retryAfter,
});

describe('parseRetryAfter', () => {
  test('accepts whole seconds from 1 to 3600 only', () => {
    assert.equal(parseRetryAfter('1'), 1);
    assert.equal(parseRetryAfter('42'), 42);
    assert.equal(parseRetryAfter('3600'), 3600);
  });
  test('drops everything else', () => {
    for (const bad of [null, undefined, '', '0', '-5', '3601', '1.5', '1e3', ' 5', '5 ', 'abc', 'Wed, 21 Oct 2026 07:28:00 GMT']) {
      assert.equal(parseRetryAfter(bad), null, String(bad));
    }
  });
});

describe('normalizeCode', () => {
  test('accepts six digits, ignoring spaces and hyphens a user may paste', () => {
    assert.equal(normalizeCode('123456'), '123456');
    assert.equal(normalizeCode(' 123 456 '), '123456');
    assert.equal(normalizeCode('123-456'), '123456');
  });
  test('refuses anything that is not exactly six digits', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12345a', '١٢٣٤٥٦']) assert.equal(normalizeCode(bad), null, bad);
  });
});

describe('passwordOutcome', () => {
  test('a password accepted with the MFA challenge moves to the code step', () => {
    assert.deepEqual(passwordOutcome(result(200, { mfaRequired: true })), { kind: 'mfa' });
  });
  test('a 200 without the challenge is never treated as success', () => {
    for (const data of [{}, { authenticated: true }, { mfaRequired: false }, { mfaRequired: 'true' }]) {
      assert.equal(passwordOutcome(result(200, data)).kind, 'failed');
    }
  });
  test('every 401 is one failure whatever the body says', () => {
    const outcomes = [
      { error: 'invalid_credentials' },
      {},
      { error: 'account_disabled' },
      { error: 'pending' },
      { error: 'user_not_found' },
    ].map((data) => passwordOutcome(result(401, data)));
    for (const outcome of outcomes) assert.deepEqual(outcome, { kind: 'failed', key: 'invalidCredentials', retryAfterSeconds: null });
  });
  test('403 means the caller already has a session, and is not the credentials message', () => {
    assert.deepEqual(passwordOutcome(result(403, { error: 'forbidden' })), { kind: 'failed', key: 'alreadySignedIn', retryAfterSeconds: null });
  });
  test('429 carries only a valid Retry-After', () => {
    assert.deepEqual(passwordOutcome(result(429, {}, '30')), { kind: 'failed', key: 'rateLimited', retryAfterSeconds: 30 });
    assert.deepEqual(passwordOutcome(result(429, {}, null)), { kind: 'failed', key: 'rateLimited', retryAfterSeconds: null });
    assert.deepEqual(passwordOutcome(result(429, {}, '99999')), { kind: 'failed', key: 'rateLimited', retryAfterSeconds: null });
  });
  test('a connection failure and a server fault are their own messages', () => {
    assert.deepEqual(passwordOutcome(result(0)), { kind: 'failed', key: 'network', retryAfterSeconds: null });
    for (const status of [400, 404, 500, 502]) assert.equal((passwordOutcome(result(status)) as { key: FailureKey }).key, 'unexpected');
  });
});

describe('codeOutcome', () => {
  test('only an explicit authenticated:true on a 200 signs in', () => {
    assert.deepEqual(codeOutcome(result(200, { authenticated: true })), { kind: 'signedIn' });
    for (const data of [{}, { authenticated: false }, { authenticated: 'true' }, { mfaRequired: true }]) {
      assert.equal(codeOutcome(result(200, data)).kind, 'failed');
    }
  });
  test('a wrong, missing or expired code is the same single failure', () => {
    for (const data of [{ error: 'invalid_code' }, {}, { error: 'challenge_expired' }]) {
      assert.deepEqual(codeOutcome(result(401, data)), { kind: 'failed', key: 'invalidCode', retryAfterSeconds: null });
    }
  });
  test('403 is a refused request, 429 a rate limit, 0 a network failure', () => {
    assert.equal((codeOutcome(result(403)) as { key: FailureKey }).key, 'refused');
    assert.deepEqual(codeOutcome(result(429, {}, '12')), { kind: 'failed', key: 'rateLimited', retryAfterSeconds: 12 });
    assert.equal((codeOutcome(result(0)) as { key: FailureKey }).key, 'network');
  });
});

describe('sessionOutcome', () => {
  test('an active session shows only name, email and the role the server states', () => {
    const user = { id: 'u1', name: 'Test Owner', email: 'owner@example.test' };
    assert.deepEqual(sessionOutcome(result(200, { user, isOwner: true })), {
      kind: 'active',
      name: 'Test Owner',
      email: 'owner@example.test',
      isOwner: true,
    });
    assert.equal((sessionOutcome(result(200, { user, isOwner: false })) as { isOwner: boolean }).isOwner, false);
  });
  test('a malformed 200 never counts as signed in, and isOwner must be a boolean', () => {
    const user = { id: 'u1', name: 'n', email: 'e@example.test' };
    for (const data of [{}, { user: null, isOwner: true }, { user: { name: 'x' }, isOwner: true }, { user }, { user, isOwner: 'true' }, { user, isOwner: 1 }]) {
      assert.notEqual(sessionOutcome(result(200, data)).kind, 'active');
    }
  });
  test('401 is an ended session; other failures are not', () => {
    assert.deepEqual(sessionOutcome(result(401)), { kind: 'ended' });
    assert.deepEqual(sessionOutcome(result(0)), { kind: 'failed', key: 'network', retryAfterSeconds: null });
    assert.equal((sessionOutcome(result(500)) as { key: FailureKey }).key, 'unexpected');
  });
});

describe('signOutOutcome', () => {
  test('success only on 200 with signedOut:true', () => {
    assert.deepEqual(signOutOutcome(result(200, { signedOut: true })), { kind: 'signedOut' });
    for (const r of [result(200, {}), result(200, { signedOut: false }), result(403), result(500), result(0)]) {
      assert.equal(signOutOutcome(r).kind, 'failed');
    }
  });
});

describe('strings', () => {
  const keys: FailureKey[] = ['invalidCredentials', 'invalidCode', 'codeFormat', 'alreadySignedIn', 'refused', 'rateLimited', 'network', 'unexpected'];
  test('every failure has its own non-empty message', () => {
    const messages = keys.map((key) => SIGNIN_STRINGS.failures[key]);
    for (const message of messages) assert.ok(message.length > 10);
    assert.equal(new Set(messages).size, keys.length);
  });
  test('the credential and code messages reveal nothing about account state', () => {
    const revealing = /disabled|pending|locked|suspended|not found|no account|does not exist|unknown (user|email)|wrong password|incorrect password/i;
    for (const key of ['invalidCredentials', 'invalidCode', 'rateLimited'] as const) {
      assert.doesNotMatch(SIGNIN_STRINGS.failures[key], revealing);
    }
  });
  test('no recovery wording on the sign-in screen (the recovery screen is a later phase)', () => {
    const all = JSON.stringify(SIGNIN_STRINGS);
    assert.doesNotMatch(all, /recovery|lost your|backup code/i);
  });
  test('the countdown wording takes a number', () => {
    assert.match(SIGNIN_STRINGS.retryIn(5), /5/);
    assert.match(SIGNIN_STRINGS.retryIn(1), /1 second\b(?!s)/);
  });
});
