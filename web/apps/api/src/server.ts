import type { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';

import Fastify, { type FastifyInstance } from 'fastify';

import { authCookieNames, type AuthSettings } from './auth/config.ts';
import {
  registerAuthenticationGuard,
  registerAuthRoutes,
  type AuthRoutesDependencies,
} from './auth/http.ts';
import { createAuth } from './auth/instance.ts';
import { commonPasswordBlocklistSize } from './auth/password-policy.ts';
import { createOwnerRecovery } from './auth/owner-recovery.ts';
import { createPrincipalRepository } from './auth/principal.ts';
import { registerRecoveryRoutes, type RecoveryBackend } from './auth/recovery-http.ts';
import { createSecurityAudit } from './auth/security-audit.ts';
import { createTotpReplayGuard } from './auth/totp-replay.ts';
import { loadRuntimeConfig, type RuntimeConfig } from './config/runtime.ts';
import { checkDatabase, createPool } from './db.ts';
import { parseLinkOrigin } from './email/message.ts';
import type { ResendDependencies } from './email/resend.ts';
import type { SecretFileOptions } from './email/secret-file.ts';
import { createEmailDelivery } from './email/transport.ts';
import { createAdminInvitationService, type InvitationDelivery } from './invitations/admin-invitations.ts';
import { registerInvitationAcceptanceRoutes } from './invitations/acceptance-http.ts';
import { createInvitationAcceptance } from './invitations/invitation-acceptance.ts';
import { registerInvitationRoutes } from './invitations/invitation-http.ts';
import {
  createPasswordResetService,
  type PasswordResetDependencies,
  type PasswordResetService,
} from './password-reset/password-reset.ts';
import { registerPasswordResetRoutes } from './password-reset/reset-http.ts';
import { registerRouteAccessGuard } from './routeAccess.ts';

export interface BuildServerOptions {
  /** PostgreSQL connection string. Required; there is no ambient fallback. */
  databaseUrl: string;
  /** Authentication settings. Required now that authentication routes exist. */
  auth: AuthSettings;
  /** Structured request logging. Off in tests, on for the running server. */
  logger?: boolean;
  /** Captures structured logs, so tests can prove what is never written. */
  logStream?: Writable;
  /**
   * How invitation, password-reset, and password-changed emails are sent; the
   * one delivery serves all three. Absent means email is not configured:
   * invitations and resets are still recorded, and honestly reported as not
   * sent. The running server builds it from configuration through
   * {@link buildServerFromConfig}; tests may inject a capture transport.
   */
  email?: InvitationDelivery;
  /**
   * Test seams for password reset: job scheduling, the password-write
   * identity, interruption points, and access to the service so a test can
   * wait for queued jobs. Production passes nothing.
   */
  passwordResetTestSeams?: Pick<PasswordResetDependencies, 'schedule' | 'identity' | 'interrupt'> & {
    expose?: (service: PasswordResetService) => void;
  };
}

/**
 * Defence in depth. Fastify's default serializers already record only the
 * method, URL, host, and socket address of a request, never its headers or
 * body; these paths keep that true if a log call ever adds headers.
 */
/**
 * The Better Auth server API calls Owner recovery needs (DEC-436). The
 * runtime options are typed as plain `BetterAuthOptions`, so the two-factor
 * plugin's endpoints are not visible on `auth.api` to the type system; their
 * presence is checked at startup instead, and a missing one refuses to build.
 */
interface RecoveryServerApi {
  revokeSessions(input: { headers: Headers; asResponse: true }): Promise<Response>;
  revokeOtherSessions(input: { headers: Headers; asResponse: true }): Promise<Response>;
  disableTwoFactor(input: { headers: Headers; body: { password: string }; asResponse: true }): Promise<Response>;
  enableTwoFactor(input: {
    headers: Headers;
    body: { password: string; method: 'totp' };
    asResponse: true;
  }): Promise<Response>;
  viewBackupCodes(input: { body: { userId: string } }): Promise<{ backupCodes: string[] }>;
}

function recoveryBackendOf(api: unknown): RecoveryBackend {
  const recoveryApi = api as RecoveryServerApi;
  for (const name of ['revokeSessions', 'revokeOtherSessions', 'disableTwoFactor', 'enableTwoFactor', 'viewBackupCodes'] as const) {
    if (typeof (recoveryApi as unknown as Record<string, unknown>)[name] !== 'function') {
      throw new Error('The configured authentication system lacks the Owner recovery API.');
    }
  }
  return {
    revokeSessions: (headers) => recoveryApi.revokeSessions({ headers, asResponse: true }),
    revokeOtherSessions: (headers) => recoveryApi.revokeOtherSessions({ headers, asResponse: true }),
    disableTwoFactor: (headers, password) =>
      recoveryApi.disableTwoFactor({ headers, body: { password }, asResponse: true }),
    enableTwoFactor: (headers, password) =>
      recoveryApi.enableTwoFactor({ headers, body: { password, method: 'totp' }, asResponse: true }),
    viewRecoveryCodes: async (userId) => (await recoveryApi.viewBackupCodes({ body: { userId } })).backupCodes,
  };
}

const LOG_REDACTIONS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  'headers.cookie',
  'headers.authorization',
];

export async function buildServer(options: BuildServerOptions): Promise<FastifyInstance> {
  if (!options?.auth) {
    throw new Error('Authentication configuration is required to build the API server.');
  }
  if (!options.databaseUrl) {
    throw new Error('A database URL is required to build the API server.');
  }

  const logging = options.logStream !== undefined || options.logger === true;
  const app = Fastify({
    logger: logging
      ? {
          level: options.logStream ? 'trace' : 'info',
          redact: LOG_REDACTIONS,
          ...(options.logStream ? { stream: options.logStream } : {}),
        }
      : false,
  });

  // DEC-488: a missing or altered common-password blocklist stops startup.
  commonPasswordBlocklistSize();

  // One pool serves readiness, Better Auth, and principal lookups alike.
  const pool = createPool(options.databaseUrl);

  let auth: ReturnType<typeof createAuth>;
  try {
    auth = createAuth({ ...options.auth, database: pool });
  } catch (cause) {
    await pool.end().catch(() => undefined);
    throw cause;
  }

  let recoveryBackend: RecoveryBackend;
  try {
    recoveryBackend = recoveryBackendOf(auth.api);
  } catch (cause) {
    await pool.end().catch(() => undefined);
    throw cause;
  }
  const audit = createSecurityAudit(pool);
  const recovery = createOwnerRecovery(pool, audit);

  let delivery: InvitationDelivery | null = null;
  if (options.email !== undefined) {
    try {
      delivery = { ...options.email, linkOrigin: parseLinkOrigin(options.email.linkOrigin, options.auth.environment) };
    } catch (cause) {
      await pool.end().catch(() => undefined);
      throw cause;
    }
  }
  const invitations = createAdminInvitationService({ pool, audit, delivery });
  // Owns the server-internal, never-routed sign-up capability (DEC-444 (5)).
  const acceptance = createInvitationAcceptance({ pool, audit, settings: options.auth });
  // Owns the server-internal, never-routed password-write capability (DEC-487 (2)).
  const { expose, ...resetSeams } = options.passwordResetTestSeams ?? {};
  const resets = createPasswordResetService({
    pool,
    audit,
    settings: options.auth,
    delivery,
    ...resetSeams,
    onJobError: (name) => app.log.error({ errorName: name }, 'password reset job failed'),
  });
  expose?.(resets);

  const authDependencies: AuthRoutesDependencies = {
    backend: {
      handle: (request) => auth.handler(request),
      getSession: (headers) => auth.api.getSession({ headers, asResponse: true }),
      signOut: (headers) => auth.api.signOut({ headers, asResponse: true }),
    },
    principals: createPrincipalRepository(pool),
    replay: createTotpReplayGuard(pool),
    recoverySessions: recovery,
    cookies: authCookieNames(auth.options),
    // Already validated and normalised by createAuth, which would have thrown.
    baseURL: new URL(options.auth.baseURL).origin,
    trustedOrigins: options.auth.trustedOrigins,
  };

  // Both guards are installed before any route: registration-time
  // classification, then request-time enforcement of it.
  registerRouteAccessGuard(app);
  registerAuthenticationGuard(app, authDependencies);

  // Liveness only: answers "is this process up". It must never consult a
  // dependency, or an orchestrator would restart a healthy process whenever
  // the database blips.
  //
  // Explicitly public: an orchestrator probes this before any session can
  // exist. "Public" here is a recorded decision, not an omission.
  app.get('/health', { config: { access: 'public' } }, async () => ({ status: 'ok' }));

  // Readiness: answers "can this process serve traffic". Public for the same
  // reason as /health, and it already returns a generic body that leaks no
  // infrastructure detail to an unauthenticated caller.
  app.get('/ready', { config: { access: 'public' } }, async (_request, reply) => {
    try {
      await checkDatabase(pool);
      return { status: 'ready' };
    } catch (cause) {
      // The detail goes to the log, never to the caller. Connection strings,
      // host names, and driver errors identify internal infrastructure to an
      // unauthenticated client (OWASP A10). The generic body is asserted by a
      // test so a later refactor cannot quietly reintroduce a leak.
      app.log.error({ err: cause }, 'readiness check failed');
      return reply.code(503).send({ status: 'not_ready' });
    }
  });

  // Owner recovery (DEC-436). Registered before the authentication routes so
  // its sign-out hooks are in place for them.
  registerRecoveryRoutes(app, { ...authDependencies, recovery, audit, recoveryBackend });
  registerAuthRoutes(app, authDependencies);
  registerInvitationRoutes(app, invitations);
  registerInvitationAcceptanceRoutes(app, { acceptance, cookies: authDependencies.cookies });
  registerPasswordResetRoutes(app, { resets, cookies: authDependencies.cookies });

  app.addHook('onClose', async () => {
    // Queued reset jobs finish before the pool they use closes.
    await resets.close().catch(() => undefined);
    await pool.end().catch(() => undefined);
  });

  return app;
}

export interface ServerStartupOptions
  extends Pick<BuildServerOptions, 'logger' | 'logStream' | 'passwordResetTestSeams'> {
  /** Test seam: the key file opener and platform. The running server passes nothing. */
  secretFile?: SecretFileOptions;
  /** Test seam: Resend's `fetch`, clock, and timers. The running server passes nothing. */
  resend?: Partial<ResendDependencies>;
}

/**
 * Builds the API from validated runtime configuration, as the entry point does
 * (DEC-489). Email delivery is built exactly once, here, and injected: when
 * disabled nothing is built and no file is opened; when Resend is configured
 * its key is read once through the secure secret-file loader. Startup checks
 * local configuration only: it sends nothing and never contacts the provider,
 * so a provider outage cannot stop the API from starting.
 */
export async function buildServerFromConfig(
  config: RuntimeConfig,
  options: ServerStartupOptions = {},
): Promise<FastifyInstance> {
  const { secretFile, resend, ...server } = options;
  const email = await createEmailDelivery(config.email, {
    environment: config.auth.environment,
    ...(secretFile === undefined ? {} : { secretFile }),
    ...(resend === undefined ? {} : { resend }),
  });

  const app = await buildServer({
    databaseUrl: config.databaseUrl,
    auth: config.auth,
    ...server,
    ...(email === null ? {} : { email }),
  });
  // The mode only: never the sender, the key file, or any other value.
  app.log.info(
    { emailDelivery: config.email.kind },
    email === null
      ? 'email delivery is disabled; invitation and password emails are recorded as not sent'
      : 'email delivery is enabled; nothing is sent at startup',
  );
  return app;
}

function exitWithConfigurationError(cause: unknown): never {
  // Messages from configuration validation name variables, never values.
  const message = cause instanceof Error ? cause.message : 'Unknown configuration error.';
  process.stderr.write(`The API cannot start: ${message}\n`);
  process.exit(1);
}

// Runs only when this file is the process entry point, so importing
// buildServer from a test never binds a port or reads the environment. The
// container's CMD runs this file directly, which is what makes the service
// actually listen. Without this the container starts, does nothing, and
// exits 0.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let config: RuntimeConfig;
  let app: FastifyInstance;

  try {
    config = loadRuntimeConfig(process.env);
    app = await buildServerFromConfig(config, { logger: true });
  } catch (cause) {
    exitWithConfigurationError(cause);
  }

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (cause) {
    app.log.error({ err: cause }, 'the API failed to start');
    process.exit(1);
  }

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      void app.close().then(() => process.exit(0));
    });
  }
}
