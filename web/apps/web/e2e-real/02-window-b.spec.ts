import { expect, test } from '@playwright/test';

import {
  GENERIC_CODE_MESSAGE,
  GENERIC_CREDENTIALS_MESSAGE,
  WEB_ORIGIN,
  account,
  newSession,
  quietForRateLimit,
  submitCode,
  submitPassword,
  totpCode,
  waitForFreshStep,
  wrongCode,
} from './support.ts';

/**
 * Window B of three: starts after 62 quiet seconds, so the limit is fresh.
 * It spends 4 sign-in requests (disabled Admin B 1, Admin C 2, Admin D 1) and
 * 3 verify requests (Admin C 2, Admin D 1): one request of spare room on the
 * sign-in path and two on the verify path. The wrong-Origin requests are
 * refused before the limiter and cost nothing.
 */

test.describe.configure({ mode: 'serial' });

const adminB = account('ADMIN_B');
const adminC = account('ADMIN_C');
const adminD = account('ADMIN_D');

let replayMessage = '';

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await quietForRateLimit();
});

test('a disabled Admin cannot sign in and gets the generic message', async ({ browser }) => {
  const { page, context } = await newSession(browser);
  await submitPassword(page, adminB.email, adminB.password);
  await expect(page.getByRole('alert')).toHaveText(GENERIC_CREDENTIALS_MESSAGE);
  await expect(page.getByLabel('Authenticator code')).toHaveCount(0);
  await context.close();
});

test('sign-out ends the session on the server, and a replayed code is refused', async ({ browser, playwright }) => {
  // Both uses of the one code must fall in the same 30-second step, so it is
  // refused for replay and not because it expired.
  await waitForFreshStep(20_000);
  const code = totpCode(adminC.totpSecret!);

  const { page, context } = await newSession(browser);
  await submitPassword(page, adminC.email, adminC.password);
  await expect(page.getByLabel('Authenticator code')).toBeVisible();
  await submitCode(page, code);
  await expect(page).toHaveURL(`${WEB_ORIGIN}/account`);

  const session = (await context.cookies()).find((cookie) => cookie.name.includes('session_token'));
  expect(session !== undefined).toBe(true);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('You are signed out');

  // The old cookie, sent by hand, no longer opens a session: the logout
  // happened on the server, not just in the browser.
  const probe = await playwright.request.newContext({ baseURL: WEB_ORIGIN });
  const replayed = await probe.get('/api/session', { headers: { cookie: `${session!.name}=${session!.value}` } });
  expect(replayed.status()).toBe(401);
  await probe.dispose();

  // Sign in again and present the same code in the same step.
  await submitPassword(page, adminC.email, adminC.password);
  await expect(page.getByLabel('Authenticator code')).toBeVisible();
  await submitCode(page, code);
  await expect(page.getByRole('alert')).toHaveText(GENERIC_CODE_MESSAGE);
  await expect(page.getByLabel('Authenticator code')).toBeVisible();
  await expect(page).toHaveURL(`${WEB_ORIGIN}/sign-in`);
  replayMessage = (await page.getByRole('alert').textContent()) ?? '';
  await context.close();
});

test('a wrong code shows the same generic message and stays on the code step', async ({ browser }) => {
  const { page, context } = await newSession(browser);
  await submitPassword(page, adminD.email, adminD.password);
  await expect(page.getByLabel('Authenticator code')).toBeVisible();
  await submitCode(page, wrongCode(adminD.totpSecret!));
  await expect(page.getByRole('alert')).toHaveText(GENERIC_CODE_MESSAGE);
  await expect(page.getByLabel('Authenticator code')).toBeVisible();
  const wrongMessage = (await page.getByRole('alert').textContent()) ?? '';
  expect(wrongMessage === replayMessage).toBe(true);
  await context.close();
});

test('state-changing auth routes refuse a foreign or missing Origin', async ({ playwright }) => {
  const client = await playwright.request.newContext({ baseURL: WEB_ORIGIN });
  const routes: Array<{ path: string; data: Record<string, string> }> = [
    { path: '/api/auth/two-factor/verify-totp', data: { code: '000000' } },
    { path: '/api/auth/sign-out', data: {} },
  ];
  for (const { path, data } of routes) {
    const foreign = await client.post(path, { data, headers: { origin: 'https://attacker.example' } });
    expect(foreign.status()).toBe(403);
    const missing = await client.post(path, { data });
    expect(missing.status()).toBe(403);
  }
  await client.dispose();
});
