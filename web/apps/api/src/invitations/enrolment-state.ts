/**
 * The invited Admin's setup as an explicit state machine (DEC-440 (7),
 * DEC-444).
 *
 * One `dromex_admin_enrolment` row per invited address carries the step. Every
 * change of step goes through a conditional update that names the steps it may
 * leave, and migration 0009 refuses any other transition in the database as
 * well, so an application defect cannot skip a step either.
 *
 * - `identity_pending`  the intent is recorded; Better Auth may or may not have
 *                       created the identity yet (a crash can leave it
 *                       created but unrecorded).
 * - `password_verified` the identity exists with a `pending` principal, and the
 *                       password was created or proven under the current
 *                       invitation.
 * - `totp_enrolling`    a TOTP secret was issued and awaits its first code.
 * - `factor_challenge`  the factor was verified by an earlier, interrupted
 *                       setup; resuming requires a code from it.
 * - `codes_issued`      the factor is verified and a recovery-code set was
 *                       shown; activation awaits acknowledgement.
 * - `completed`         the principal is active and the invitation consumed.
 *
 * A verified factor never falls back to password-only enrolment, and only
 * `codes_issued` reaches `completed`.
 */

export const ENROLMENT_STEPS = [
  'identity_pending',
  'password_verified',
  'totp_enrolling',
  'factor_challenge',
  'codes_issued',
  'completed',
] as const;

export type EnrolmentStep = (typeof ENROLMENT_STEPS)[number];

function frozen(steps: EnrolmentStep[]): readonly EnrolmentStep[] {
  return Object.freeze(steps);
}

export const ENROLMENT_TRANSITIONS: Readonly<Record<EnrolmentStep, readonly EnrolmentStep[]>> = Object.freeze({
  // Re-recording an unconfirmed intent under a newer invitation.
  identity_pending: frozen(['identity_pending', 'password_verified']),
  // A repeated password step replaces an unverified secret.
  password_verified: frozen(['password_verified', 'totp_enrolling']),
  // A crash after Better Auth verified the factor resumes as a challenge.
  totp_enrolling: frozen(['password_verified', 'totp_enrolling', 'factor_challenge', 'codes_issued']),
  factor_challenge: frozen(['factor_challenge', 'codes_issued']),
  // Codes shown but never acknowledged are replaced through a new challenge.
  codes_issued: frozen(['factor_challenge', 'completed']),
  completed: frozen([]),
});

const KNOWN = new Set<string>(ENROLMENT_STEPS);

export function isEnrolmentStep(value: unknown): value is EnrolmentStep {
  return typeof value === 'string' && KNOWN.has(value);
}

export function canTransition(from: EnrolmentStep, to: EnrolmentStep): boolean {
  return isEnrolmentStep(from) && isEnrolmentStep(to) && ENROLMENT_TRANSITIONS[from].includes(to);
}

/** The steps from which `to` may be entered; the conditional updates use exactly this list. */
export function stepsLeadingTo(to: EnrolmentStep): EnrolmentStep[] {
  return ENROLMENT_STEPS.filter((from) => ENROLMENT_TRANSITIONS[from].includes(to));
}

export function isOpenStep(step: EnrolmentStep): boolean {
  return step !== 'completed';
}

/** Throws when a transition is not permitted. The message never repeats its input. */
export function assertEnrolmentTransition(from: EnrolmentStep, to: EnrolmentStep): void {
  if (!canTransition(from, to)) throw new Error('The enrolment transition is not permitted.');
}
