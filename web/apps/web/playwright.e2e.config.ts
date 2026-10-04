import { defineConfig, devices } from '@playwright/test';

/**
 * Real end-to-end sign-in tests (batch 4b-2): the real API, a disposable
 * PostgreSQL database seeded with synthetic accounts, and the built web app,
 * in the runner's installed Google Chrome. CI only: it refuses to run unless
 * the disposable-database flag is set by the workflow.
 *
 * Retries are off and there is one worker, because the rate limit counts every
 * request and a retry would spend it. Traces, videos and screenshots are off so
 * nothing that could hold a credential or a cookie is ever written, and the
 * reporter prints test names and counts only.
 */
if (process.env['DROMEX_E2E'] !== 'disposable-ci-database') {
  throw new Error('The real end-to-end tests run only in CI against a disposable database (DROMEX_E2E).');
}

const WEB_ORIGIN = 'http://127.0.0.1:5174';
const API_ORIGIN = 'http://127.0.0.1:3000';

const CHANNEL = process.env['DROMEX_PLAYWRIGHT_CHANNEL'];
const channel = CHANNEL === undefined || CHANNEL === '' ? {} : { channel: CHANNEL };

export default defineConfig({
  testDir: './e2e-real',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  // Two of the tests wait out a rate-limit window of 60 seconds.
  timeout: 120_000,
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    ...channel,
    viewport: { width: 1280, height: 800 },
    baseURL: WEB_ORIGIN,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  webServer: [
    {
      // The real API, configured entirely from the job environment.
      command: 'node src/server.ts',
      cwd: '../api',
      url: `${API_ORIGIN}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { ...(process.env as Record<string, string>), API_HOST: '127.0.0.1', API_PORT: '3000' },
    },
    {
      // The built web app; `/api` is proxied to the API from vite.config.ts,
      // so the browser sees one origin, as it will behind the production proxy.
      command: 'npx vite build && npx vite preview --host 127.0.0.1 --port 5174 --strictPort',
      url: WEB_ORIGIN,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
