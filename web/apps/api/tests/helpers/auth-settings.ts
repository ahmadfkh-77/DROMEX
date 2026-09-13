import { randomBytes } from 'node:crypto';

import type { AuthSettings } from '../../src/auth/config.ts';

/**
 * Synthetic authentication settings for tests. Nothing here is read from the
 * environment, and the secret is generated in memory per call and never
 * printed.
 */

export const TEST_BASE_URL = 'http://127.0.0.1:3000';
export const TEST_TRUSTED_ORIGIN = 'http://127.0.0.1:5173';

/** Port 1 is reserved and closed, so nothing can connect through this. */
export const UNREACHABLE_DATABASE_URL = 'postgresql://127.0.0.1:1/unused';

export function syntheticAuthSettings(overrides: Partial<AuthSettings> = {}): AuthSettings {
  return {
    environment: 'test',
    secret: randomBytes(32).toString('hex'),
    baseURL: TEST_BASE_URL,
    trustedOrigins: [TEST_TRUSTED_ORIGIN],
    ...overrides,
  };
}

/**
 * Better Auth runs an asynchronous schema probe after construction. Letting
 * it settle before teardown keeps its log from racing the worker shutdown.
 */
export async function settle(ms = 200): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
