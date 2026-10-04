import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import {
  GENERIC_CREDENTIALS_MESSAGE,
  TRUSTED_ORIGIN_HEADER,
  WEB_ORIGIN,
  account,
  lacksAll,
  newSession,
  signIn,
  submitPassword,
} from './support.ts';

/**
 * Window A of three (the files run in order, one worker). The real rate limit
 * allows 5 requests per minute to each of the sign-in and verify paths for the
 * one CI client, and a window ends only after 60 quiet seconds, so the tests
 * are grouped and spaced. Window A spends 4 sign-in requests (Owner, Admin A,
 * wrong password, unknown user) and 2 verify requests (Owner, Admin A): one
 * request of spare room on each path.
 */

test.describe.configure({ mode: 'serial' });

const owner = account('OWNER');
const adminA = account('ADMIN_A');

let ownerSession: { context: BrowserContext; page: Page };
let adminASession: { context: BrowserContext; page: Page };
let verifyHeaders: Record<string, string> = {};
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
  verifyHeaders = await (await verified).allHeaders();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your account');
  await expect(page.getByText('Owner', { exact: true })).toBeVisible();

  // Chrome stored a Secure, __Secure- prefixed cookie set over plain http on
  // loopback and sends it back: a reload is still signed in.
  const session = (await context.cookies()).find((cookie) => cookie.name.includes('session_token'));
  expect(session !== undefined).toBe(true);
  expect(session!.secure).toBe(true);
  expect(session!.httpOnly).toBe(true);
  expect(session!.path).toBe('/');
  expect(session!.sameSite === 'Lax' || session!.sameSite === 'Strict').toBe(true);
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

test('the real Set-Cookie carries the expected flags and the response headers are recorded', async () => {
  const cookies = (verifyHeaders['set-cookie'] ?? '').split('\n');
  const session = cookies.find((line) => line.includes('session_token')) ?? '';
  expect(session.startsWith('__Secure-')).toBe(true);
  expect(/;\s*HttpOnly/i.test(session)).toBe(true);
  expect(/;\s*Secure/i.test(session)).toBe(true);
  expect(/;\s*SameSite=(Lax|Strict)/i.test(session)).toBe(true);
  expect(/;\s*Path=\//i.test(session)).toBe(true);
  expect(/;\s*Domain=/i.test(session)).toBe(false);

  expect((verifyHeaders['content-type'] ?? '').startsWith('application/json')).toBe(true);
  expect(verifyHeaders['access-control-allow-origin']).toBeUndefined();
  expect(verifyHeaders['x-powered-by']).toBeUndefined();

  // The API sets no baseline security headers itself: that belongs to the
  // reverse proxy (production gate B16). Record which of them are present so a
  // change either way is visible, without pretending they are tested.
  const names = ['strict-transport-security', 'x-content-type-options', 'content-security-policy', 'referrer-policy', 'x-frame-options', 'cache-control'];
  test.info().annotations.push({
    type: 'security-headers',
    description: names.map((name) => `${name}: ${verifyHeaders[name] === undefined ? 'absent' : 'present'}`).join(', '),
  });
});

test('an Admin signs in and sees the Admin role, not Owner', async () => {
  const { page } = adminASession;
  await signIn(page, adminA);
  await expect(page.getByText('Admin', { exact: true })).toBeVisible();
  await expect(page.getByText('Owner', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Manage Admin accounts' })).toHaveCount(0);
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

test("an Admin disabled by the Owner loses the session that was already open", async () => {
  const disabled = await ownerSession.context.request.post(`/api/owner/accounts/${adminA.id}/disable`, {
    data: { reason: 'synthetic end-to-end check' },
    headers: TRUSTED_ORIGIN_HEADER,
  });
  expect(disabled.status()).toBe(200);

  const probe = await adminASession.context.request.get('/api/session');
  expect(probe.status()).toBe(401);

  await adminASession.page.reload();
  await expect(adminASession.page).toHaveURL(`${WEB_ORIGIN}/sign-in`);
});
