import { defineConfig, devices } from '@playwright/test';

// Port 5174, not the 5173 the development container publishes. A dedicated
// port means Playwright can never collide with, or silently reuse, a server
// running someone else's build.
const BASE_URL = 'http://127.0.0.1:5174';

// CI-only: the runner's installed Google Chrome ('chrome'), so nothing is downloaded.
// Unset locally, where the Chromium Playwright already installed is used.
const CHANNEL = process.env.DROMEX_PLAYWRIGHT_CHANNEL;
const channel = CHANNEL === undefined || CHANNEL === '' ? {} : { channel: CHANNEL };

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'off',
  },
  // The preview must be verified at the three widths the product supports.
  projects: [
    {
      name: 'mobile-375',
      use: { ...devices['Desktop Chrome'], ...channel, viewport: { width: 375, height: 812 } },
    },
    {
      name: 'tablet-768',
      use: { ...devices['Desktop Chrome'], ...channel, viewport: { width: 768, height: 1024 } },
    },
    {
      name: 'desktop-1280',
      use: { ...devices['Desktop Chrome'], ...channel, viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    // CI serves the built app: the development server re-optimises its
    // dependencies on a cold cache and reloads the page mid-test, which a
    // fresh runner always hits. Local runs keep the development server.
    command:
      process.env.CI !== undefined
        ? 'npx vite build && npx vite preview --host 127.0.0.1 --port 5174 --strictPort'
        : 'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort',
    url: BASE_URL,
    // Always start a fresh server against current source. Reusing an
    // existing one can silently test a stale build and report a false pass.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
