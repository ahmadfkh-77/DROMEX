import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Two projects with different dependency requirements.
    //
    // "unit" must stay runnable with Docker stopped. It carries no
    // globalSetup, so nothing tries to start a container. This keeps the
    // fast feedback loop, and the /ready no-leak security assertion,
    // available on a machine without a container runtime.
    //
    // "integration" starts one real postgres:18.6-trixie container for the
    // run and therefore requires Docker.
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
          pool: 'forks',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          pool: 'forks',
          globalSetup: ['./tests/setup/global-setup.ts'],
          // A cold container pull on a slow link takes far longer than the
          // default.
          testTimeout: 120_000,
          hookTimeout: 300_000,
        },
      },
    ],
  },
});
