import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    // Starts one ephemeral PostgreSQL container for the run. Never the
    // development database; the setup guards against that explicitly.
    globalSetup: ['./tests/setup/global-setup.ts'],
    // A cold container pull on a slow link takes far longer than the default.
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
