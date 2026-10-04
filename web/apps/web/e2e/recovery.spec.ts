import { expect, test, type Page, type Request } from '@playwright/test';

/**
 * Lost-authenticator screens (batch 4c). The API is replaced by a synthetic
 * stub at the browser's network layer: no server, account, password, recovery
 * code, setup key or session is real. Every value below is made up.
 */

const EMAIL = 'synthetic.owner@example.test';
const PASSWORD = 'synthetic-test-passphrase-only';
const RECOVERY_CODE = '0123-4567-89AB-CDEF-GHJK-MNPQ';
const SETUP_KEY = 'ABCD-EFGH-2345-6723';
const NEW_CODES = Array.from({ length: 10 }, (_, index) => `${String(index).padStart(4, '0')}-ABCD-EFGH-JKMN-PQRS-TVWX`);
const CODE = '246810';

type Stub = { status?: number; body?: unknown; headers?: Record<string, string> } | 'abort';
type Stubs = Record<string, Stub | Stub[]>;
interface Captured {
  path: string;
  body: unknown;
}

async function stubApi(page: Page, responses: Stubs): Promise<Captured[]> {
  const captured: Captured[] = [];
  const calls = new Map<string, number>();
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    captured.push({ path, body: request.method() === 'POST' ? request.postDataJSON() : undefined });
    const configured = responses[path];
    const index = calls.get(path) ?? 0;
    calls.set(path, index + 1);
    const response = Array.isArray(configured) ? configured[Math.min(index, configured.length - 1)] : configured;
    if (response === undefined) return route.fulfill({ status: 404, json: { error: 'not_found' } });
    if (response === 'abort') return route.abort('connectionreset');
    return route.fulfill({ status: response.status ?? 200, json: response.body ?? {}, headers: response.headers });
  });
  return captured;
}

const SIGN_IN = '/api/auth/sign-in/email';
const VERIFY_CODE = '/api/auth/recovery/verify-code';
const START = '/api/auth/recovery/authenticator/start';
const VERIFY = '/api/auth/recovery/authenticator/verify';

const MFA: Stub = { body: { mfaRequired: true } };
const ACCEPTED: Stub = { body: { recovery: 'authenticator_replacement_required', expiresInSeconds: 900 } };
const ENROL: Stub = { body: { totpUri: 'otpauth://totp/DROMEX:owner?secret=ABCDEFGH23456723&issuer=DROMEX', manualEntrySecret: SETUP_KEY } };
const COMPLETED: Stub = { body: { recoveryCodes: NEW_CODES, signInRequired: true } };

function watch(page: Page): { requests: Request[]; console: string[] } {
  const seen = { requests: [] as Request[], console: [] as string[] };
  page.on('request', (request) => seen.requests.push(request));
  page.on('console', (message) => seen.console.push(message.text()));
  page.on('pageerror', (error) => seen.console.push(error.message));
  return seen;
}

async function noHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

async function storageIsEmpty(page: Page): Promise<boolean> {
  return page.evaluate(
    async () =>
      localStorage.length === 0 &&
      sessionStorage.length === 0 &&
      document.cookie === '' &&
      (await indexedDB.databases()).length === 0,
  );
}

async function toCodeStep(page: Page) {
  await page.goto('/recover-authenticator');
  await page.getByLabel('Email address').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByLabel('Recovery code')).toBeVisible();
}

async function toReplaceStep(page: Page) {
  await toCodeStep(page);
  await page.getByLabel('Recovery code').fill(RECOVERY_CODE);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Confirm your password' })).toBeVisible();
}

async function toEnrolStep(page: Page) {
  await toReplaceStep(page);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Set up new authenticator' }).click();
  await expect(page.getByTestId('manual-entry-secret')).toHaveText(SETUP_KEY);
}

test.describe('lost-authenticator guidance', () => {
  test('the sign-in code step links to it; the password step does not', async ({ page }) => {
    await stubApi(page, { [SIGN_IN]: MFA });
    await page.goto('/sign-in');
    await expect(page.getByRole('link', { name: 'Lost your authenticator?' })).toHaveCount(0);
    await page.getByLabel('Email address').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('link', { name: 'Lost your authenticator?' }).click();
    await expect(page).toHaveURL(/\/lost-authenticator$/);
  });

  test('makes no request, shows the same text to everyone, and never offers an Admin self-service step', async ({ page }) => {
    const captured = await stubApi(page, {});
    await page.goto('/lost-authenticator');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Lost your authenticator?');
    await expect(page.getByText('Ask the Owner to reset your authenticator.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Recover as the Owner' })).toHaveAttribute('href', '/recover-authenticator');
    await expect(page.getByLabel(/email|password|code/i)).toHaveCount(0);
    expect(captured).toEqual([]);
    expect(await noHorizontalOverflow(page)).toBe(true);
    expect(await storageIsEmpty(page)).toBe(true);
  });
});

test.describe('Owner recovery', () => {
  test('the whole path: password, recovery code, password again, new authenticator, new codes, sign in', async ({ page, baseURL }) => {
    const seen = watch(page);
    const captured = await stubApi(page, { [SIGN_IN]: MFA, [VERIFY_CODE]: ACCEPTED, [START]: ENROL, [VERIFY]: COMPLETED });
    await toEnrolStep(page);
    await expect(page.getByTestId('recovery-codes')).toHaveCount(0);
    await page.getByLabel('Authenticator code').fill(CODE);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByTestId('recovery-codes').getByRole('listitem')).toHaveCount(10);
    // The one-time key is gone once it was used.
    await expect(page.getByTestId('manual-entry-secret')).toHaveCount(0);
    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(page.getByRole('alert')).toHaveText('Confirm that you saved the recovery codes before continuing.');
    await page.getByLabel('I saved these recovery codes').check();
    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(page.getByRole('status')).toContainText('Your authenticator was replaced');
    await expect(page.getByTestId('recovery-codes')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/sign-in');

    expect(captured.map((entry) => entry.path)).toEqual([SIGN_IN, VERIFY_CODE, START, VERIFY]);
    expect(captured[0]!.body).toEqual({ email: EMAIL, password: PASSWORD });
    expect(captured[1]!.body).toEqual({ code: RECOVERY_CODE });
    expect(captured[2]!.body).toEqual({ password: PASSWORD });
    expect(captured[3]!.body).toEqual({ code: CODE });
    for (const request of seen.requests) expect(new URL(request.url()).origin).toBe(new URL(baseURL!).origin);
    // No secret reached the console, the address bar, or any storage.
    const logged = seen.console.join('\n');
    for (const secret of [PASSWORD, RECOVERY_CODE, SETUP_KEY, CODE, NEW_CODES[0]!]) expect(logged.includes(secret)).toBe(false);
    expect(page.url()).toBe(`${baseURL}/recover-authenticator`);
    expect(await storageIsEmpty(page)).toBe(true);
  });

  test('a recovery code typed in lower case with spaces is sent in canonical form', async ({ page }) => {
    const captured = await stubApi(page, { [SIGN_IN]: MFA, [VERIFY_CODE]: ACCEPTED });
    await toCodeStep(page);
    await page.getByLabel('Recovery code').fill(RECOVERY_CODE.toLowerCase().replace(/-/g, ' '));
    await page.getByLabel('Recovery code').press('Enter');
    await expect(page.getByRole('heading', { name: 'Confirm your password' })).toBeVisible();
    expect(captured.find((entry) => entry.path === VERIFY_CODE)!.body).toEqual({ code: RECOVERY_CODE });
  });

  test('a malformed recovery code is refused before any request', async ({ page }) => {
    const captured = await stubApi(page, { [SIGN_IN]: MFA });
    await toCodeStep(page);
    await page.getByLabel('Recovery code').fill('1234');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert')).toHaveText('Enter a recovery code: 24 letters and digits, in groups of four.');
    expect(captured.map((entry) => entry.path)).toEqual([SIGN_IN]);
  });

  test('every wrong recovery code gets one generic message and stays on the code step', async ({ page }) => {
    await stubApi(page, {
      [SIGN_IN]: MFA,
      [VERIFY_CODE]: [
        { status: 401, body: { error: 'invalid_code' } },
        { status: 401, body: { error: 'account_disabled' } },
      ],
    });
    await toCodeStep(page);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.getByLabel('Recovery code').fill(RECOVERY_CODE);
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByRole('alert')).toHaveText('That recovery code was not accepted. Check it and try again, or start over.');
      await expect(page.getByLabel('Recovery code')).toHaveValue('');
    }
  });

  test('a server fault on the recovery code returns to the start and warns the code may be used', async ({ page }) => {
    await stubApi(page, { [SIGN_IN]: MFA, [VERIFY_CODE]: { status: 500, body: { error: 'internal_error' } } });
    await toCodeStep(page);
    await page.getByLabel('Recovery code').fill(RECOVERY_CODE);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert')).toContainText('may already be used');
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(page.getByLabel('Recovery code')).toHaveCount(0);
  });

  test('a failed password step shows the sign-in screen generic message and never advances', async ({ page }) => {
    await stubApi(page, { [SIGN_IN]: { status: 401, body: { error: 'anything' } } });
    await page.goto('/recover-authenticator');
    await page.getByLabel('Email address').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert')).toHaveText('The email address or password is not correct.');
    await expect(page.getByLabel('Password')).toHaveValue('');
    await expect(page.getByLabel('Recovery code')).toHaveCount(0);
  });

  test('a rate limit shows its countdown and blocks resubmission', async ({ page }) => {
    await stubApi(page, { [SIGN_IN]: MFA, [VERIFY_CODE]: { status: 429, body: {}, headers: { 'retry-after': '30' } } });
    await toCodeStep(page);
    await page.getByLabel('Recovery code').fill(RECOVERY_CODE);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert')).toHaveText('Too many attempts. Wait before trying again.');
    await expect(page.getByRole('timer')).toContainText('30');
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  test('an ended recovery at the password-again step returns to the start with the reason shown', async ({ page }) => {
    await stubApi(page, { [SIGN_IN]: MFA, [VERIFY_CODE]: ACCEPTED, [START]: { status: 401, body: { error: 'recovery_failed' } } });
    await toReplaceStep(page);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Set up new authenticator' }).click();
    await expect(page.getByRole('alert')).toHaveText('The recovery could not continue and has ended. Start over.');
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(page.getByLabel('Password')).toHaveValue('');
  });

  test('a server fault is never shown as success', async ({ page }) => {
    await stubApi(page, { [SIGN_IN]: MFA, [VERIFY_CODE]: ACCEPTED, [START]: ENROL, [VERIFY]: { status: 500, body: { error: 'internal_error' } } });
    await toEnrolStep(page);
    await page.getByLabel('Authenticator code').fill(CODE);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('alert')).toHaveText('The recovery could not continue and has ended. Start over.');
    await expect(page.getByTestId('recovery-codes')).toHaveCount(0);
    await expect(page.getByTestId('manual-entry-secret')).toHaveCount(0);
  });

  test('a wrong new-authenticator code keeps the step and the setup key for another try', async ({ page }) => {
    await stubApi(page, { [SIGN_IN]: MFA, [VERIFY_CODE]: ACCEPTED, [START]: ENROL, [VERIFY]: { status: 401, body: { error: 'invalid_code' } } });
    await toEnrolStep(page);
    await page.getByLabel('Authenticator code').fill(CODE);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('alert')).toHaveText('That code was not accepted. Wait for a new code from your new authenticator and try again.');
    await expect(page.getByTestId('manual-entry-secret')).toHaveText(SETUP_KEY);
  });

  test('a code that is not six digits is refused before any request', async ({ page }) => {
    const captured = await stubApi(page, { [SIGN_IN]: MFA, [VERIFY_CODE]: ACCEPTED, [START]: ENROL });
    await toEnrolStep(page);
    await page.getByLabel('Authenticator code').fill('12ab');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('alert')).toHaveText('Enter the 6-digit code from your new authenticator.');
    expect(captured.map((entry) => entry.path)).not.toContain(VERIFY);
  });

  test('a connection failure is reported and keeps the step', async ({ page }) => {
    await stubApi(page, { [SIGN_IN]: MFA, [VERIFY_CODE]: 'abort' });
    await toCodeStep(page);
    await page.getByLabel('Recovery code').fill(RECOVERY_CODE);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert')).toHaveText('The connection failed. Check your connection and try again.');
    await expect(page.getByLabel('Recovery code')).toBeVisible();
  });

  test('has the right attributes, keeps focus on the step heading, and fits the screen', async ({ page }) => {
    await stubApi(page, { [SIGN_IN]: MFA });
    await page.goto('/recover-authenticator');
    await expect(page.getByLabel('Password')).toHaveAttribute('type', 'password');
    await expect(page.getByLabel('Password')).toHaveAttribute('autocomplete', 'current-password');
    expect(await noHorizontalOverflow(page)).toBe(true);
    await page.getByLabel('Email address').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Enter a recovery code' })).toBeFocused();
    await expect(page.getByLabel('Recovery code')).toHaveAttribute('autocomplete', 'off');
    expect(await noHorizontalOverflow(page)).toBe(true);
  });
});
