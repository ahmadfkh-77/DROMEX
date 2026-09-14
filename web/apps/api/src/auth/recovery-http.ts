import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { PASSWORD_MAX_LENGTH } from './config.ts';
import {
  AUTH_BODY_LIMIT,
  FORBIDDEN,
  INTERNAL_ERROR,
  INVALID_CODE,
  UNAUTHORIZED,
  backendRequest,
  cookiePair,
  errorCode,
  errorName,
  expiredCookie,
  hasTrustedOrigin,
  isExpiring,
  readSession,
  readTotpCode,
  requestCookie,
  revokeSession,
  sendTooManyRequests,
  setCookiesNamed,
  toBackendHeaders,
  type AuthRoutesDependencies,
  type SessionView,
} from './http.ts';
import {
  RECOVERY_LIFETIME_SECONDS,
  RECOVERY_MAX_VERIFY_ATTEMPTS,
  type ActiveRecovery,
  type OpenRecoveryStep,
  type OwnerRecovery,
  type RecoveryActor,
} from './owner-recovery.ts';
import { RECOVERY_CODE_COUNT, normalizeRecoveryCode } from './recovery-codes.ts';
import { securityEvent, type SecurityAudit } from './security-audit.ts';

/**
 * Owner recovery over HTTP (DEC-435 precision correction, DEC-436).
 *
 * Three routes, and nothing else:
 *
 * 1. `POST /api/auth/recovery/verify-code` (`mfa-challenge`) exchanges the
 *    password step's signed challenge cookie and one unused recovery code for
 *    a recovery session, through Better Auth's `verify-backup-code` with
 *    `trustDevice: false`. Better Auth's router applies the rate limit and the
 *    shared account lockout. Before the session cookie leaves the server, one
 *    DROMEX transaction clears `mfa_completed_at`, records the recovery, and
 *    records the session as a recovery session; any failure revokes the
 *    session instead of releasing it. All other Owner sessions are revoked.
 *
 * 2. `POST /api/auth/recovery/authenticator/start` (`recovery`) re-checks the
 *    recovery and claims the step, then calls Better Auth's `disableTwoFactor`
 *    and immediately `enableTwoFactor`, returning only the new enrolment
 *    secret.
 *
 * 3. `POST /api/auth/recovery/authenticator/verify` (`recovery`) accepts at
 *    most five codes from the new authenticator through Better Auth's
 *    `verify-totp`, records the accepted code against replay, completes the
 *    recovery, shows the new recovery codes once, and revokes every Owner
 *    session.
 *
 * A recovery session never reaches any other route: the ordinary gate refuses
 * every recovery session and every session while `mfa_completed_at` is null.
 * Sign-out stays available, and a sign-out during recovery is recorded as
 * abandonment. Nothing here writes a Better Auth-owned row with SQL; every
 * change to a factor, a code, or a session is Better Auth's own API.
 */

export interface RecoveryBackend {
  revokeSessions(headers: Headers): Promise<Response>;
  revokeOtherSessions(headers: Headers): Promise<Response>;
  disableTwoFactor(headers: Headers, password: string): Promise<Response>;
  enableTwoFactor(headers: Headers, password: string): Promise<Response>;
  /** Better Auth's server-only retrieval of the user's unused recovery codes. */
  viewRecoveryCodes(userId: string): Promise<string[]>;
}

export interface RecoveryRoutesDependencies extends AuthRoutesDependencies {
  recovery: OwnerRecovery;
  audit: SecurityAudit;
  recoveryBackend: RecoveryBackend;
}

interface RecoveryContext {
  recovery: ActiveRecovery;
  actor: RecoveryActor;
  /** The `name=value` pair of the request's own session cookie. */
  sessionPair: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    dromexRecovery: RecoveryContext | null;
    dromexRecoverySignOut: string | null;
  }
}

const VERIFY_CODE_PATH = '/api/auth/recovery/verify-code';
const START_PATH = '/api/auth/recovery/authenticator/start';
const VERIFY_PATH = '/api/auth/recovery/authenticator/verify';
const SIGN_OUT_PATH = '/api/auth/sign-out';
const BACKUP_CODE_BACKEND_PATH = '/api/auth/two-factor/verify-backup-code';
const VERIFY_TOTP_BACKEND_PATH = '/api/auth/two-factor/verify-totp';

const RECOVERY_FAILED = { error: 'recovery_failed' } as const;
const CANONICAL_CODE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/;
const BASE32 = /^[A-Z2-7]+$/;
const MAX_SUBMITTED_CODE_LENGTH = 64;

function assertRecoveryDependencies(deps: RecoveryRoutesDependencies | undefined): asserts deps is RecoveryRoutesDependencies {
  if (typeof deps?.recovery?.begin !== 'function') throw new Error('Owner recovery requires the recovery state.');
  if (typeof deps.audit?.record !== 'function') throw new Error('Owner recovery requires the security audit.');
  const backend = deps.recoveryBackend;
  for (const name of ['revokeSessions', 'revokeOtherSessions', 'disableTwoFactor', 'enableTwoFactor', 'viewRecoveryCodes'] as const) {
    if (typeof backend?.[name] !== 'function') throw new Error('Owner recovery requires the Better Auth recovery API.');
  }
}

/** Exactly `{ code: "<recovery code>" }`, normalised to canonical form. */
function readRecoveryCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'code') return null;
  const { code } = body as { code: unknown };
  if (typeof code !== 'string' || code.length > MAX_SUBMITTED_CODE_LENGTH) return null;
  return normalizeRecoveryCode(code);
}

/** Exactly `{ password: "<password>" }`. */
function readPassword(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'password') return null;
  const { password } = body as { password: unknown };
  return typeof password === 'string' && password.length > 0 && password.length <= PASSWORD_MAX_LENGTH ? password : null;
}

/** The TOTP URI and its Base32 secret grouped in fours, or null for anything unexpected. */
function describeTotpUri(value: unknown): { totpUri: string; manualEntrySecret: string } | null {
  if (typeof value !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  const secret = parsed.searchParams.get('secret');
  if (parsed.protocol !== 'otpauth:' || parsed.host !== 'totp' || secret === null || !BASE32.test(secret)) return null;
  return { totpUri: value, manualEntrySecret: secret.match(/.{1,4}/g)!.join('-') };
}

function isCanonicalCodeSet(codes: unknown): codes is string[] {
  return (
    Array.isArray(codes) &&
    codes.length === RECOVERY_CODE_COUNT &&
    new Set(codes).size === RECOVERY_CODE_COUNT &&
    codes.every((code) => typeof code === 'string' && CANONICAL_CODE.test(code))
  );
}

function liveSessionCookies(response: Response, deps: RecoveryRoutesDependencies): string[] {
  return setCookiesNamed(response, deps.cookies.sessionToken).filter((cookie) => !isExpiring(cookie));
}

/** Runs one step; a thrown error is logged by name only and becomes null. */
async function attempt<T>(request: FastifyRequest, label: string, work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch (error) {
    request.log.error({ errorName: errorName(error) }, label);
    return null;
  }
}

async function sessionViewOf(deps: RecoveryRoutesDependencies, sessionPair: string): Promise<SessionView | null> {
  const response = await deps.backend.getSession(new Headers({ cookie: sessionPair }));
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  return readSession(await response.json());
}

async function revokeQuietly(request: FastifyRequest, deps: RecoveryRoutesDependencies, sessionPair: string): Promise<void> {
  await revokeSession(deps, sessionPair).catch((error: unknown) => {
    request.log.error({ errorName: errorName(error) }, 'revoking a recovery session failed');
  });
}

async function recordQuietly(
  request: FastifyRequest,
  deps: RecoveryRoutesDependencies,
  event: ReturnType<typeof securityEvent>,
): Promise<void> {
  await deps.audit.record(event).catch((error: unknown) => {
    request.log.error({ errorName: errorName(error) }, 'recording a security event failed');
  });
}

/** Ends the recovery as failed, then revokes every session pair given. Never throws. */
async function failRecovery(
  request: FastifyRequest,
  deps: RecoveryRoutesDependencies,
  context: RecoveryContext,
  reason: string,
  factorDisabled: boolean,
  sessionPairs: readonly string[],
): Promise<void> {
  await deps.recovery
    .end(context.recovery, 'failed', reason, context.actor, request.ip, { factorDisabled })
    .catch((error: unknown) => request.log.error({ errorName: errorName(error) }, 'ending a failed recovery failed'));
  for (const pair of sessionPairs) await revokeQuietly(request, deps, pair);
}

function signedOutCookies(deps: RecoveryRoutesDependencies): string[] {
  return [
    expiredCookie(deps.cookies.sessionToken),
    expiredCookie(deps.cookies.twoFactor),
    expiredCookie(deps.cookies.trustDevice),
  ];
}

/**
 * The recovery gate for one step. Every fact is read from the database: the
 * Better Auth session, the recovery bound to exactly that session, its step
 * and expiry, and the Owner principal. Any disagreement denies.
 */
function recoveryGateFor(step: OpenRecoveryStep, deps: RecoveryRoutesDependencies) {
  return async (request: FastifyRequest): Promise<boolean> => {
    request.dromexRecovery = null;
    if (!hasTrustedOrigin(request, deps)) return false;

    const token = requestCookie(request, deps.cookies.sessionToken);
    if (token === null) return false;
    const sessionPair = `${deps.cookies.sessionToken}=${token}`;

    const view = await sessionViewOf(deps, sessionPair);
    if (view === null) return false;
    const actor: RecoveryActor = { userId: view.user.id, name: view.user.name };

    const found = await deps.recovery.loadForSession(view.sessionId, actor, request.ip);
    if (found === null) return false;
    if (found === 'expired') {
      await revokeQuietly(request, deps, sessionPair);
      return false;
    }

    const principal = await deps.principals.findByUserId(view.user.id);
    if (
      found.userId !== view.user.id ||
      principal === null ||
      principal.status !== 'active' ||
      principal.isOwner !== true ||
      principal.mfaCompletedAt !== null
    ) {
      await deps.recovery.end(found, 'failed', 'not_eligible', actor, request.ip);
      await revokeQuietly(request, deps, sessionPair);
      return false;
    }

    if (found.step !== step) return false;

    request.dromexRecovery = { recovery: found, actor, sessionPair };
    return true;
  };
}

export function registerRecoveryRoutes(app: FastifyInstance, deps: RecoveryRoutesDependencies): void {
  assertRecoveryDependencies(deps);
  app.decorateRequest('dromexRecovery', null);
  app.decorateRequest('dromexRecoverySignOut', null);

  // A sign-out by a recovery session abandons the recovery. The session is
  // identified before sign-out destroys it, and the abandonment is recorded
  // only when sign-out succeeded. Neither step can change sign-out's response.
  app.addHook('preHandler', async (request) => {
    if (request.is404 || request.method !== 'POST' || request.routeOptions.url !== SIGN_OUT_PATH) return;
    if (!hasTrustedOrigin(request, deps)) return;
    const token = requestCookie(request, deps.cookies.sessionToken);
    if (token === null) return;
    const view = await attempt(request, 'identifying a signing-out session failed', () =>
      sessionViewOf(deps, `${deps.cookies.sessionToken}=${token}`),
    );
    if (view !== null) request.dromexRecoverySignOut = view.sessionId;
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const sessionId = request.dromexRecoverySignOut;
    if (sessionId !== null && reply.statusCode === 200) {
      await attempt(request, 'recording an abandoned recovery failed', () =>
        deps.recovery.abandonForSession(sessionId, request.ip),
      );
    }
    return payload;
  });

  app.post(VERIFY_CODE_PATH, { config: { access: 'mfa-challenge' }, bodyLimit: AUTH_BODY_LIMIT }, async (request, reply) =>
    verifyRecoveryCode(request, reply, deps),
  );

  app.post(
    START_PATH,
    { config: { access: 'recovery', recoveryGate: recoveryGateFor('code_accepted', deps) }, bodyLimit: AUTH_BODY_LIMIT },
    async (request, reply) => startReplacement(request, reply, deps),
  );

  app.post(
    VERIFY_PATH,
    { config: { access: 'recovery', recoveryGate: recoveryGateFor('enrolment_started', deps) }, bodyLimit: AUTH_BODY_LIMIT },
    async (request, reply) => verifyReplacement(request, reply, deps),
  );
}

async function verifyRecoveryCode(request: FastifyRequest, reply: FastifyReply, deps: RecoveryRoutesDependencies) {
  if (!hasTrustedOrigin(request, deps)) return reply.code(403).send(FORBIDDEN);

  const challenge = requestCookie(request, deps.cookies.twoFactor);
  const code = readRecoveryCode(request.body);

  // Every attempt passes Better Auth's router, whose rate limiter runs before
  // anything else, so no rejection is audited until the attempt has been
  // counted. A malformed code is never forwarded: the request carries no code
  // at all, is counted, and then fails Better Auth's body schema without
  // reaching verification or the account lockout. Without a challenge no
  // cookie is forwarded. A trusted device is never requested (DEC-434,
  // DEC-436).
  const headers = toBackendHeaders(request, deps);
  if (challenge === null) headers.delete('cookie');
  else headers.set('cookie', `${deps.cookies.twoFactor}=${challenge}`);
  const body = code === null ? { trustDevice: false } : { code, trustDevice: false };
  const response = await attempt(request, 'recovery code verification failed', () =>
    deps.backend.handle(backendRequest(deps, BACKUP_CODE_BACKEND_PATH, headers, body)),
  );
  if (response === null) return reply.code(500).send(INTERNAL_ERROR);

  const challengeCookies = setCookiesNamed(response, deps.cookies.twoFactor);
  if (!response.ok || code === null || challenge === null) {
    const failure: unknown = response.ok ? null : await response.json().catch(() => null);
    if (response.ok) {
      // Unreachable while Better Auth refuses both. Fail closed regardless.
      await response.body?.cancel();
      for (const cookie of liveSessionCookies(response, deps)) await revokeQuietly(request, deps, cookiePair(cookie));
    }
    if (challengeCookies.length > 0) reply.header('set-cookie', challengeCookies);
    // Limited attempts, and a locked account, are never audited: nothing an
    // attacker repeats past the limit may add a row.
    if (response.status === 429) return sendTooManyRequests(response, reply);
    // A session refused by the principal hook surfaces as a 500 with this
    // code; it is a refusal, not a server fault.
    if (response.status >= 500 && errorCode(failure) !== 'FAILED_TO_CREATE_SESSION') {
      return reply.code(500).send(INTERNAL_ERROR);
    }
    if (challenge !== null) {
      await recordQuietly(request, deps, securityEvent('recovery_code_rejected', 'failure', null, null, request.ip, { reason: 'invalid_code' }));
    }
    return reply.code(401).send(INVALID_CODE);
  }
  await response.body?.cancel();

  const sessionCookies = liveSessionCookies(response, deps);
  const sessionPair = sessionCookies[0] === undefined ? null : cookiePair(sessionCookies[0]);
  if (sessionPair === null) {
    request.log.error({ errorName: 'MissingSessionCookie' }, 'recovery code verification issued no session');
    return reply.code(500).send(INTERNAL_ERROR);
  }

  // From here until the reply, the session exists only on the server.
  const view = await attempt(request, 'resolving the recovery session failed', () => sessionViewOf(deps, sessionPair));
  if (view === null) {
    await revokeQuietly(request, deps, sessionPair);
    return reply.code(500).send(INTERNAL_ERROR);
  }
  const actor: RecoveryActor = { userId: view.user.id, name: view.user.name };

  const begun = await attempt(request, 'recording the recovery failed', () =>
    deps.recovery.begin({ actor, sessionId: view.sessionId, clientAddress: request.ip }),
  );
  if (begun === null) {
    await revokeQuietly(request, deps, sessionPair);
    return reply.code(500).send(INTERNAL_ERROR);
  }
  if ('refused' in begun) {
    await revokeQuietly(request, deps, sessionPair);
    await recordQuietly(request, deps, securityEvent('recovery_code_rejected', 'failure', actor, null, request.ip, { reason: begun.refused }));
    return reply.code(401).send(INVALID_CODE);
  }

  const context: RecoveryContext = {
    recovery: {
      id: begun.recoveryId,
      userId: actor.userId,
      sessionId: view.sessionId,
      step: 'code_accepted',
      factorDisabled: false,
      verifyAttempts: 0,
    },
    actor,
    sessionPair,
  };

  const others = await attempt(request, 'counting other Owner sessions failed', () =>
    deps.recovery.countSessions(actor.userId, view.sessionId),
  );
  const revoked = await attempt(request, 'revoking other Owner sessions failed', () =>
    deps.recoveryBackend.revokeOtherSessions(new Headers({ cookie: sessionPair })),
  );
  await revoked?.body?.cancel();
  if (revoked === null || !revoked.ok) {
    await recordQuietly(request, deps, securityEvent('other_sessions_revoked', 'failure', actor, begun.recoveryId, request.ip, { revokedSessionCount: null }));
    await failRecovery(request, deps, context, 'session_revocation_failed', false, [sessionPair]);
    return reply.code(500).send(INTERNAL_ERROR);
  }
  await recordQuietly(request, deps, securityEvent('other_sessions_revoked', 'success', actor, begun.recoveryId, request.ip, { revokedSessionCount: others }));

  reply.header('cache-control', 'no-store');
  reply.header('set-cookie', [
    ...sessionCookies,
    ...(challengeCookies.length > 0 ? challengeCookies : [expiredCookie(deps.cookies.twoFactor)]),
  ]);
  return reply.code(200).send({ recovery: 'authenticator_replacement_required', expiresInSeconds: RECOVERY_LIFETIME_SECONDS });
}

async function startReplacement(request: FastifyRequest, reply: FastifyReply, deps: RecoveryRoutesDependencies) {
  const context = request.dromexRecovery;
  if (context === null) return reply.code(401).send(UNAUTHORIZED);
  const password = readPassword(request.body);
  if (password === null) return reply.code(401).send(UNAUTHORIZED);

  const claimed = await attempt(request, 'claiming the replacement failed', () =>
    deps.recovery.claimReplacement(context.recovery, context.actor, request.ip),
  );
  if (claimed === null) return reply.code(500).send(INTERNAL_ERROR);
  if (!claimed) return reply.code(401).send(UNAUTHORIZED);

  const disabled = await attempt(request, 'disabling the old factor failed', () =>
    deps.recoveryBackend.disableTwoFactor(new Headers({ cookie: context.sessionPair }), password),
  );
  if (disabled === null || !disabled.ok) {
    await disabled?.body?.cancel();
    // Better Auth does not disable a factor atomically. Whatever the response
    // said, trust only what the database now reports.
    const absent = await attempt(request, 'reading the factor state failed', () =>
      deps.recovery.factorIsAbsent(context.actor.userId),
    );
    const factorGone = absent !== false;
    const wrongPassword = !factorGone && disabled?.status === 400;
    await failRecovery(
      request,
      deps,
      context,
      factorGone ? 'disable_incomplete' : wrongPassword ? 'invalid_password' : 'disable_failed',
      factorGone,
      [context.sessionPair],
    );
    return wrongPassword ? reply.code(401).send(RECOVERY_FAILED) : reply.code(500).send(INTERNAL_ERROR);
  }

  // Better Auth rotated the session while disabling the factor.
  const enrolmentCookies = liveSessionCookies(disabled, deps);
  await disabled.body?.cancel();
  const enrolmentPair = enrolmentCookies[0] === undefined ? null : cookiePair(enrolmentCookies[0]);
  const enrolmentView =
    enrolmentPair === null
      ? null
      : await attempt(request, 'resolving the enrolment session failed', () => sessionViewOf(deps, enrolmentPair));
  if (enrolmentPair === null || enrolmentView === null || enrolmentView.user.id !== context.actor.userId) {
    await failRecovery(request, deps, context, 'enrolment_session_missing', true, enrolmentPair === null ? [] : [enrolmentPair]);
    return reply.code(500).send(INTERNAL_ERROR);
  }

  const enabled = await attempt(request, 'enrolling the new factor failed', () =>
    deps.recoveryBackend.enableTwoFactor(new Headers({ cookie: enrolmentPair }), password),
  );
  const enabledBody: unknown =
    enabled !== null && enabled.ok ? await enabled.json().catch(() => null) : (await enabled?.body?.cancel(), null);
  // Only the enrolment URI is used. The recovery codes in this response are
  // never shown; codes are shown only after the new factor verifies.
  const enrolment = describeTotpUri((enabledBody as { totpURI?: unknown } | null)?.totpURI);
  if (enrolment === null) {
    await failRecovery(request, deps, context, 'enrolment_failed', true, [enrolmentPair]);
    return reply.code(500).send(INTERNAL_ERROR);
  }

  const recorded = await attempt(request, 'recording the enrolment failed', async () => {
    await deps.recovery.recordEnrolmentStarted(context.recovery, enrolmentView.sessionId, context.actor, request.ip);
    return true;
  });
  if (recorded !== true) {
    await failRecovery(request, deps, context, 'enrolment_not_recorded', true, [enrolmentPair]);
    return reply.code(500).send(INTERNAL_ERROR);
  }

  reply.header('cache-control', 'no-store');
  reply.header('set-cookie', enrolmentCookies);
  return reply.code(200).send(enrolment);
}

async function verifyReplacement(request: FastifyRequest, reply: FastifyReply, deps: RecoveryRoutesDependencies) {
  const context = request.dromexRecovery;
  if (context === null) return reply.code(401).send(UNAUTHORIZED);
  const code = readTotpCode(request.body);
  if (code === null) return reply.code(401).send(INVALID_CODE);

  const attempts = await attempt(request, 'reserving a verification attempt failed', () =>
    deps.recovery.reserveVerifyAttempt(context.recovery),
  );
  if (attempts === null) return reply.code(401).send(UNAUTHORIZED);

  const headers = toBackendHeaders(request, deps);
  headers.set('cookie', context.sessionPair);
  const verified = await attempt(request, 'verifying the new factor failed', () =>
    deps.backend.handle(backendRequest(deps, VERIFY_TOTP_BACKEND_PATH, headers, { code, trustDevice: false })),
  );
  if (verified === null || verified.status >= 500) {
    await verified?.body?.cancel();
    await failRecovery(request, deps, context, 'verification_failed', true, [context.sessionPair]);
    return reply.code(500).send(INTERNAL_ERROR);
  }
  if (verified.status === 429) {
    await verified.body?.cancel();
    return sendTooManyRequests(verified, reply);
  }
  if (!verified.ok) {
    await verified.body?.cancel();
    await recordQuietly(request, deps, securityEvent('new_totp_rejected', 'failure', context.actor, context.recovery.id, request.ip, { reason: 'invalid_code' }));
    if (attempts >= RECOVERY_MAX_VERIFY_ATTEMPTS) {
      await failRecovery(request, deps, context, 'attempts_exhausted', true, [context.sessionPair]);
      return reply.code(401).send(RECOVERY_FAILED);
    }
    return reply.code(401).send(INVALID_CODE);
  }

  // Better Auth enabled the factor and rotated the session.
  const completedCookies = liveSessionCookies(verified, deps);
  await verified.body?.cancel();
  const completedPair = completedCookies[0] === undefined ? null : cookiePair(completedCookies[0]);
  const completedView =
    completedPair === null
      ? null
      : await attempt(request, 'resolving the verified session failed', () => sessionViewOf(deps, completedPair));
  if (completedPair === null || completedView === null || completedView.user.id !== context.actor.userId) {
    await failRecovery(request, deps, context, 'verification_session_missing', true, [completedPair ?? context.sessionPair]);
    return reply.code(500).send(INTERNAL_ERROR);
  }

  const replay = await attempt(request, 'recording the new code against replay failed', () =>
    deps.replay.record(context.actor.userId, code),
  );
  if (replay !== 'accepted') {
    await failRecovery(request, deps, context, 'code_not_recorded', true, [completedPair]);
    return reply.code(500).send(INTERNAL_ERROR);
  }

  const codes = await attempt(request, 'reading the new recovery codes failed', () =>
    deps.recoveryBackend.viewRecoveryCodes(context.actor.userId),
  );
  if (!isCanonicalCodeSet(codes)) {
    await failRecovery(request, deps, context, 'codes_unavailable', true, [completedPair]);
    return reply.code(500).send(INTERNAL_ERROR);
  }

  const completed = await attempt(request, 'completing the recovery failed', async () => {
    await deps.recovery.complete(context.recovery, completedView.sessionId, context.actor, request.ip);
    return true;
  });
  if (completed !== true) {
    await failRecovery(request, deps, context, 'completion_failed', true, [completedPair]);
    return reply.code(500).send(INTERNAL_ERROR);
  }

  // Ordinary access returns only through a fresh password-and-TOTP sign-in.
  const sessionCount = await attempt(request, 'counting Owner sessions failed', () =>
    deps.recovery.countSessions(context.actor.userId),
  );
  const revoked = await attempt(request, 'revoking every Owner session failed', () =>
    deps.recoveryBackend.revokeSessions(new Headers({ cookie: completedPair })),
  );
  await revoked?.body?.cancel();
  await recordQuietly(
    request,
    deps,
    securityEvent('recovery_sessions_revoked', revoked?.ok ? 'success' : 'failure', context.actor, context.recovery.id, request.ip, {
      revokedSessionCount: sessionCount,
    }),
  );
  if (!revoked?.ok) await revokeQuietly(request, deps, completedPair);

  reply.header('cache-control', 'no-store');
  reply.header('set-cookie', signedOutCookies(deps));
  return reply.code(200).send({ recoveryCodes: codes, signInRequired: true });
}
