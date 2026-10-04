import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import {
  API_ORIGIN,
  GENERIC_CREDENTIALS_MESSAGE,
  WEB_ORIGIN,
  account,
  lacksAll,
  newSession,
  signIn,
  statusFromPage,
  submitPassword,
} from './support.ts';

/**
 * Window A of three (the files run in order, one worker). The real rate limit
 * allows 5 requests per minute to each of the sign-in and verify paths for the
 * one CI client, and a window ends only after 60 quiet seconds, so the tests
 * are grouped and spaced. Window A spends 4 sign-in requests (Owner, Admin A,
 * wrong password, unknown user) and 2 verify requests (Owner, Admin A): one
 * request of spare room on each path. The header and cookie checks below send
 * no sign-in or verify request at all.
 */

const owner = account('OWNER');
const adminA = account('ADMIN_A');

/** Filled by the Owner sign-in test, read by the cookie checks. */
let setCookieLines: string[] = [];
let sessionCookieLine = '';

test.describe('window A: sessions', () => {
  test.describe.configure({ mode: 'serial' });

  let ownerSession: { context: BrowserContext; page: Page };
  let adminASession: { context: BrowserContext; page: Page };
  let wrongPasswordMessage = '';
  const consoleLines: string[] = [];

  test.beforeAll(async ({ browser }) => {
    ownerSession = await newSession(browser);
    adminASession = await newSession(browser);
    for (const { page } of [ownerSession, adminASession]) {
      page.on('console', (message) => consoleLines.push(message.text()));
      page.on('pageerror', (error) => consoleLines.push(error.message));
    }
  });

  test.afterAll(async () => {
    await ownerSession.context.close();
    await adminASession.context.close();
  });

  test('the Owner signs in with password and code and sees the Owner role', async () => {
    const { page, context } = ownerSession;
    const verified = page.waitForResponse((response) => response.url().endsWith('/api/auth/two-factor/verify-totp'));
    await signIn(page, owner);
    const response = await verified;
    setCookieLines = (await response.headersArray())
      .filter((header) => header.name.toLowerCase() === 'set-cookie')
      .flatMap((header) => header.value.split('\n'));
    sessionCookieLine = setCookieLines.find((line) => line.includes('session_token')) ?? '';

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your account');
    await expect(page.getByText('Owner', { exact: true })).toBeVisible();

    // Chrome stored a Secure, __Secure- prefixed cookie set over plain http on
    // loopback and sends it back: a reload is still signed in.
    const session = (await context.cookies()).find((cookie) => cookie.name.includes('session_token'));
    expect(session !== undefined).toBe(true);
    expect(session!.secure).toBe(true);
    expect(session!.httpOnly).toBe(true);
    expect(session!.path).toBe('/');
    expect(session!.sameSite).toBe('Lax');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your account');

    // Nothing sensitive is reachable from page script, storage, the URL, the
    // page source or the console.
    expect(await page.evaluate(() => document.cookie)).toBe('');
    const storageEmpty = await page.evaluate(
      async () => localStorage.length === 0 && sessionStorage.length === 0 && (await indexedDB.databases()).length === 0,
    );
    expect(storageEmpty).toBe(true);
    const secrets = [owner.password, owner.totpSecret!, session!.value];
    expect(lacksAll(page.url(), secrets)).toBe(true);
    expect(lacksAll(await page.content(), secrets)).toBe(true);
    expect(lacksAll(consoleLines.join('\n'), secrets)).toBe(true);
  });

  test('an Admin signs in and sees the Admin role, not Owner', async () => {
    const { page } = adminASession;
    await signIn(page, adminA);
    await expect(page.getByText('Admin', { exact: true })).toBeVisible();
    await expect(page.getByText('Owner', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Manage Admin accounts' })).toHaveCount(0);
    // Positive control for the probe used after the account is disabled.
    expect(await statusFromPage(page, '/api/session')).toBe(200);
  });

  test('a wrong password shows the one generic message', async ({ browser }) => {
    const { page, context } = await newSession(browser);
    await submitPassword(page, owner.email, 'a-password-that-is-not-right');
    await expect(page.getByRole('alert')).toHaveText(GENERIC_CREDENTIALS_MESSAGE);
    await expect(page.getByLabel('Authenticator code')).toHaveCount(0);
    wrongPasswordMessage = (await page.getByRole('alert').textContent()) ?? '';
    await context.close();
  });

  test('an unknown user shows exactly the same message', async ({ browser }) => {
    const { page, context } = await newSession(browser);
    await submitPassword(page, 'nobody-e2e@synthetic.invalid', 'another-password-that-is-not-right');
    await expect(page.getByRole('alert')).toHaveText(GENERIC_CREDENTIALS_MESSAGE);
    const unknownMessage = (await page.getByRole('alert').textContent()) ?? '';
    expect(unknownMessage === wrongPasswordMessage).toBe(true);
    await context.close();
  });

  test('an Admin disabled by the Owner loses the session that was already open', async () => {
    // The Owner disables through the real route, from the real page (same
    // origin, Chrome's own cookie jar and Origin header), with no further sign-in.
    const disabled = await statusFromPage(ownerSession.page, `/api/owner/accounts/${adminA.id}/disable`, {
      method: 'POST',
      json: { reason: 'synthetic end-to-end check' },
    });
    expect(disabled).toBe(200);

    expect(await statusFromPage(adminASession.page, '/api/session')).toBe(401);

    await adminASession.page.reload();
    await expect(adminASession.page).toHaveURL(`${WEB_ORIGIN}/sign-in`);
  });
});

// Zero sign-in and verify requests, and no shared state between checks apart
// from what the Owner sign-in captured: one failure cannot hide another, and the
// diagnostics name the check that failed.
test.describe('window A: session cookie and API response checks', () => {
  test.describe.configure({ mode: 'default' });

  let apiHeaders: Record<string, string> = {};

  test.beforeAll(async ({ playwright }) => {
    // The API itself, not `vite preview` (which adds CORS headers and is test-only).
    const client = await playwright.request.newContext();
    const response = await client.get(`${API_ORIGIN}/api/session`, { headers: { origin: WEB_ORIGIN } });
    apiHeaders = response.headers();
    await client.dispose();
  });

  test('check: the verify response set a session cookie', () => {
    expect(sessionCookieLine !== '').toBe(true);
  });
  test('check: the session cookie name has the __Secure- prefix', () => {
    expect(sessionCookieLine.startsWith('__Secure-')).toBe(true);
  });
  test('check: the session cookie is HttpOnly', () => {
    expect(/;\s*HttpOnly/i.test(sessionCookieLine)).toBe(true);
  });
  test('check: the session cookie is Secure', () => {
    expect(/;\s*Secure/i.test(sessionCookieLine)).toBe(true);
  });
  test('check: the session cookie is SameSite=Lax', () => {
    expect(/;\s*SameSite=Lax(;|$)/i.test(sessionCookieLine)).toBe(true);
  });
  test('check: the session cookie has Path=/', () => {
    expect(/;\s*Path=\/(;|$)/i.test(sessionCookieLine)).toBe(true);
  });
  test('check: the session cookie has no Domain attribute', () => {
    expect(sessionCookieLine !== '' && !/;\s*Domain=/i.test(sessionCookieLine)).toBe(true);
  });
  test('check: the session cookie expires within 12 hours', () => {
    const maxAge = /;\s*Max-Age=(\d+)/i.exec(sessionCookieLine);
    const expires = /;\s*Expires=([^;]+)/i.exec(sessionCookieLine);
    const seconds = maxAge !== null ? Number(maxAge[1]) : expires !== null ? (Date.parse(expires[1]!) - Date.now()) / 1000 : Number.NaN;
    expect(Number.isFinite(seconds) && seconds > 0 && seconds <= 12 * 60 * 60 + 60).toBe(true);
  });
  test('check: the API itself sends no CORS allow-origin header', () => {
    expect(Object.keys(apiHeaders).length > 0).toBe(true);
    expect(apiHeaders['access-control-allow-origin'] === undefined).toBe(true);
  });
  test('check: the API itself sends no X-Powered-By header', () => {
    expect(Object.keys(apiHeaders).length > 0).toBe(true);
    expect(apiHeaders['x-powered-by'] === undefined).toBe(true);
  });
  test('check: the API itself answers JSON', () => {
    expect((apiHeaders['content-type'] ?? '').startsWith('application/json')).toBe(true);
  });
  test('record: which baseline security headers the API itself sends (not an assertion)', () => {
    // Expected at the reverse proxy (production gate B16). Names only.
    const names = ['strict-transport-security', 'x-content-type-options', 'content-security-policy', 'referrer-policy', 'x-frame-options', 'cache-control'];
    test.info().annotations.push({
      type: 'security-headers',
      description: names.map((name) => `${name}: ${apiHeaders[name] === undefined ? 'absent' : 'present'}`).join(', '),
    });
  });
});
