import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ENROLMENT_STEPS,
  ENROLMENT_TRANSITIONS,
  assertEnrolmentTransition,
  canTransition,
  isOpenStep,
  type EnrolmentStep,
} from '../../src/invitations/enrolment-state.ts';

/**
 * Checkpoint 4B2 (DEC-440, DEC-444): the invited Admin's setup is an explicit
 * state machine. These tests pin every permitted transition and refuse every
 * other one, so a later change cannot quietly open a shortcut to activation.
 */

const EXPECTED: Record<EnrolmentStep, EnrolmentStep[]> = {
  identity_pending: ['identity_pending', 'password_verified'],
  password_verified: ['password_verified', 'totp_enrolling'],
  totp_enrolling: ['password_verified', 'totp_enrolling', 'factor_challenge', 'codes_issued'],
  factor_challenge: ['factor_challenge', 'codes_issued'],
  codes_issued: ['factor_challenge', 'completed'],
  completed: [],
};

describe('invited Admin enrolment state machine', () => {
  it('has exactly the approved steps, in order', () => {
    expect([...ENROLMENT_STEPS]).toEqual([
      'identity_pending',
      'password_verified',
      'totp_enrolling',
      'factor_challenge',
      'codes_issued',
      'completed',
    ]);
  });

  it('permits exactly the approved transitions', () => {
    expect(Object.keys(ENROLMENT_TRANSITIONS).sort()).toEqual([...ENROLMENT_STEPS].sort());
    for (const from of ENROLMENT_STEPS) {
      expect([...ENROLMENT_TRANSITIONS[from]].sort(), from).toEqual([...EXPECTED[from]].sort());
      for (const to of ENROLMENT_STEPS) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(EXPECTED[from].includes(to));
      }
    }
  });

  it('reaches completion only from acknowledged recovery codes', () => {
    const into = ENROLMENT_STEPS.filter((from) => canTransition(from, 'completed'));
    expect(into).toEqual(['codes_issued']);
  });

  it('issues recovery codes only after a verified factor: from enrolment or an existing-factor challenge', () => {
    const into = ENROLMENT_STEPS.filter((from) => canTransition(from, 'codes_issued'));
    expect(into.sort()).toEqual(['factor_challenge', 'totp_enrolling']);
  });

  it('never leaves completion and never returns to an unconfirmed identity', () => {
    for (const to of ENROLMENT_STEPS) expect(canTransition('completed', to)).toBe(false);
    for (const from of ENROLMENT_STEPS) expect(canTransition(from, 'identity_pending')).toBe(from === 'identity_pending');
  });

  it('never lets a verified factor fall back to password-only enrolment', () => {
    expect(canTransition('factor_challenge', 'password_verified')).toBe(false);
    expect(canTransition('codes_issued', 'password_verified')).toBe(false);
    expect(canTransition('factor_challenge', 'totp_enrolling')).toBe(false);
    expect(canTransition('codes_issued', 'totp_enrolling')).toBe(false);
  });

  it('treats every step except completion as open', () => {
    expect(ENROLMENT_STEPS.filter(isOpenStep)).toEqual([
      'identity_pending',
      'password_verified',
      'totp_enrolling',
      'factor_challenge',
      'codes_issued',
    ]);
  });

  it('refuses unknown steps and forbidden transitions without echoing input', () => {
    expect(canTransition('identity_pending' as EnrolmentStep, 'completed')).toBe(false);
    expect(canTransition('hunter2-secret' as EnrolmentStep, 'completed')).toBe(false);
    expect(canTransition('password_verified', 'hunter2-secret' as EnrolmentStep)).toBe(false);
    expect(() => assertEnrolmentTransition('password_verified', 'completed')).toThrow(/transition/i);
    try {
      assertEnrolmentTransition('hunter2-secret' as EnrolmentStep, 'completed');
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain('hunter2');
    }
    expect(() => assertEnrolmentTransition('codes_issued', 'completed')).not.toThrow();
  });

  it('matches the transitions migration 0009 enforces in the database, pair for pair', async () => {
    const sql = await readFile(
      fileURLToPath(new URL('../../migrations/dromex/0009_dromex_admin_enrolment.sql', import.meta.url)),
      'utf8',
    );
    const block = /-- BEGIN ENROLMENT TRANSITIONS([\s\S]*?)-- END ENROLMENT TRANSITIONS/.exec(sql);
    expect(block).not.toBeNull();
    const pairs = [...block![1]!.matchAll(/\('([a-z_]+)',\s*'([a-z_]+)'\)/g)].map((match) => `${match[1]}->${match[2]}`).sort();
    const expected = ENROLMENT_STEPS.flatMap((from) => ENROLMENT_TRANSITIONS[from].map((to) => `${from}->${to}`)).sort();
    expect(pairs).toEqual(expected);
  });

  it('is frozen, so no caller can add a transition at runtime', () => {
    expect(Object.isFrozen(ENROLMENT_TRANSITIONS)).toBe(true);
    for (const step of ENROLMENT_STEPS) expect(Object.isFrozen(ENROLMENT_TRANSITIONS[step])).toBe(true);
  });
});
