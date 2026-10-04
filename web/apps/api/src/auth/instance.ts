import { betterAuth } from 'better-auth';

import { createAuthOptions, type AuthConfigInput } from './config.ts';

/**
 * Constructs the Better Auth instance from the validated options built by
 * {@link createAuthOptions}.
 *
 * Deliberately one function with one parameter. Every security decision was
 * already made and tested in `config.ts`; this module only turns those
 * options into an instance, so there is exactly one way to build an
 * authenticated subsystem and no second path that could skip validation.
 *
 * Construction is lazy with respect to the database: nothing connects here.
 * That is asserted by a test rather than assumed, because it is what makes
 * the instance safe to build at module load, including for offline schema
 * generation.
 *
 * **This instance is not mounted on any route in this checkpoint.** No
 * Fastify plugin, no handler registration, and no `/api/auth/*` surface
 * exists yet. Exposing it over HTTP is a later, separately approved step.
 */
export function createAuth(input: AuthConfigInput) {
  return betterAuth(createAuthOptions(input));
}
