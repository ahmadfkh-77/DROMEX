import { expect, test, type Page, type Request } from '@playwright/test';

/**
 * Invitation page (DEC-442, DEC-444): the token is taken from the fragment,
 * removed from the address bar before any request, sent only in a same-origin
 * POST body, and never stored. The API is replaced by a synthetic stub at the
 * browser's network layer, so no server, account, or real token exists.
 */

const TOKEN = 'SYNTHETIC_TEST_TOKEN_ONLY_'.padEnd(43, '0');
const PASSWORD = 'synthetic preview passphrase';
const CODES = Array.from({ length: 10 }, (_, index) => `ABCD-EFGH-JKMN-PQRS-TVWX-YZ0${index}`);

interface Captured {
  url: string;
  body: unknown;
  referer: string | undefined;
}

async function stubApi(page: Page, responses: Record<string, { status?: number; body: unknown }>): Promise<Captured[]> {
  const captured: Captured[] = [];
  await page.route('**/api/invitation/*', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    captured.push({ url: request.url(), body: request.postDataJSON(), referer: await request.headerValue('referer') ?? undefined });
    const response = responses[path];
    if (response === undefined) return route.fulfill({ status: 404, json: { error: 'not_found' } });
    return route.fulfill({ status: response.status ?? 200, json: response.body });
  });
  return captured;
}

function watchRequests(page: Page): Request[] {
  const requests: Request[] = [];
  page.on('request', (request) => requests.push(request));
  return requests;
}

async function storageIsEmpty(page: Page): Promise<boolean> {
  return page.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0 && document.cookie === '');
}

test('removes the token from the address bar and sends it only in a POST body', async ({ page, baseURL }) => {
  const requests = watchRequests(page);
  const captured = await stubApi(page, { '/api/invitation/inspect': { body: { next: 'create_password' } } });

  await page.goto(`/invitation#${TOKEN}`);
  await expect(page.getByLabel('Your name')).toBeVisible();

  expect(page.url()).toBe(`${baseURL}/invitation`);
  expect(await page.evaluate(() => window.location.hash)).toBe('');
  expect(captured).toHaveLength(1);
  expect(captured[0]!.body).toEqual({ token: TOKEN });
  expect(captured[0]!.url).not.toContain(TOKEN);
  expect(captured[0]!.referer).toBeUndefined();
  for (const request of requests) {
    expect(request.url()).not.toContain(TOKEN);
    expect(new URL(request.url()).origin).toBe(new URL(baseURL!).origin);
  }
  expect(await storageIsEmpty(page)).toBe(true);
  expect(await page.locator('meta[name="referrer"]').getAttribute('content')).toBe('no-referrer');
  const history = await page.evaluate(() => JSON.stringify(window.history.state));
  expect(history).not.toContain(TOKEN);
});

test('walks the new-identity setup with the approved request bodies and keeps nothing in storage', async ({ page }) => {
  const captured = await stubApi(page, {
    '/api/invitation/inspect': { body: { next: 'create_password' } },
    '/api/invitation/password': {
      body: { next: 'verify_totp', totpUri: 'otpauth://totp/DROMEX:synthetic?secret=AAAABBBBCCCCDDDD&issuer=DROMEX', manualEntrySecret: 'AAAA-BBBB-CCCC-DDDD' },
    },
    '/api/invitation/totp': { body: { recoveryCodes: CODES, next: 'acknowledge_recovery_codes' } },
    '/api/invitation/complete': { body: { signInRequired: true } },
  });

  await page.goto(`/invitation#${TOKEN}`);
  await page.getByLabel('Your name').fill('Synthetic Invitee');
  await page.getByLabel('Password (15 to 128 characters)').fill(PASSWORD);
  await page.getByLabel('Confirm password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByTestId('manual-entry-secret')).toHaveText('AAAA-BBBB-CCCC-DDDD');
  await page.getByLabel('Authenticator code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();

  await expect(page.getByTestId('recovery-codes').locator('li')).toHaveCount(10);
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByTestId('recovery-codes')).toBeVisible();
  await page.getByLabel('I saved these recovery codes').check();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByRole('status')).toContainText('Setup is complete');

  expect(captured.map((entry) => [new URL(entry.url).pathname, entry.body])).toEqual([
    ['/api/invitation/inspect', { token: TOKEN }],
    ['/api/invitation/password', { token: TOKEN, name: 'Synthetic Invitee', password: PASSWORD }],
    ['/api/invitation/totp', { code: '123456' }],
    ['/api/invitation/complete', { recoveryCodesSaved: true }],
  ]);
  expect(await storageIsEmpty(page)).toBe(true);
  const text = (await page.textContent('body')) ?? '';
  expect(text).not.toContain(PASSWORD);
  expect(text).not.toContain(TOKEN);
});

test('resumes a verified authenticator by proving the existing password and sending it once more with the code', async ({ page }) => {
  const captured = await stubApi(page, {
    '/api/invitation/inspect': { body: { next: 'confirm_password' } },
    '/api/invitation/password': { body: { next: 'verify_existing_totp' } },
    '/api/invitation/totp': { body: { recoveryCodes: CODES, next: 'acknowledge_recovery_codes' } },
  });

  await page.goto(`/invitation#${TOKEN}`);
  await expect(page.getByLabel('Your name')).toHaveCount(0);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Authenticator code').fill('654321');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByTestId('recovery-codes').locator('li')).toHaveCount(10);

  expect(captured.map((entry) => entry.body)).toEqual([
    { token: TOKEN },
    { token: TOKEN, password: PASSWORD },
    { code: '654321', password: PASSWORD, token: TOKEN },
  ]);
});

test('shows one generic message for an ended invitation and a missing or malformed fragment, without calling the API for the latter', async ({ page }) => {
  const captured = await stubApi(page, { '/api/invitation/inspect': { status: 400, body: { error: 'invitation_invalid' } } });

  await page.goto(`/invitation#${TOKEN}`);
  await expect(page.getByRole('alert')).toContainText('no longer valid');

  for (const url of ['/invitation', '/invitation#short', `/invitation?token=${TOKEN}`]) {
    await page.goto(url);
    await expect(page.getByRole('alert')).toContainText('no longer valid');
  }
  expect(captured).toHaveLength(1);
});

test('the invitation page does not overflow horizontally at this viewport', async ({ page }) => {
  await stubApi(page, { '/api/invitation/inspect': { body: { next: 'create_password' } } });
  await page.goto(`/invitation#${TOKEN}`);
  await expect(page.getByLabel('Your name')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
