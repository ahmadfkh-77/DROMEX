import { expect, test, type Page, type Request } from '@playwright/test';

/**
 * Sign-in screen (SI-1a). The API is replaced by a synthetic stub at the
 * browser's network layer: no server, account, password, or session is real.
 * Every credential below is a made-up test value.
 */

const EMAIL = 'synthetic.person@example.test';
const PASSWORD = 'synthetic-test-passphrase-only';
const CODE = '246810';

interface Captured {
  path: string;
  body: unknown;
  referer: string | undefined;
}

type Stub = { status?: number; body?: unknown; headers?: Record<string, string> } | 'abort';
type Stubs = Record<string, Stub | Stub[] | (() => Stub)>;

async function stubApi(page: Page, responses: Stubs): Promise<Captured[]> {
  const captured: Captured[] = [];
  const calls = new Map<string, number>();
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    captured.push({
      path,
      body: request.method() === 'POST' ? request.postDataJSON() : undefined,
      referer: (await request.headerValue('referer')) ?? undefined,
    });
    const configured = responses[path];
    const index = calls.get(path) ?? 0;
    calls.set(path, index + 1);
    const response =
      typeof configured === 'function'
        ? configured()
        : Array.isArray(configured)
          ? configured[Math.min(index, configured.length - 1)]
          : configured;
    if (response === undefined) return route.fulfill({ status: 404, json: { error: 'not_found' } });
    if (response === 'abort') return route.abort('connectionreset');
    return route.fulfill({ status: response.status ?? 200, json: response.body ?? {}, headers: response.headers });
  });
  return captured;
}

const SIGN_IN = '/api/auth/sign-in/email';
const VERIFY = '/api/auth/two-factor/verify-totp';
const SESSION = '/api/session';
const SIGN_OUT = '/api/auth/sign-out';

const MFA: Stub = { body: { mfaRequired: true } };
const SIGNED_IN: Stub = { body: { authenticated: true } };
const OWNER_SESSION: Stub = { body: { user: { id: 'synthetic-1', name: 'Synthetic Owner', email: EMAIL }, isOwner: true } };

function watch(page: Page): { requests: Request[]; console: string[] } {
  const seen = { requests: [] as Request[], console: [] as string[] };
  page.on('request', (request) => seen.requests.push(request));
  page.on('console', (message) => seen.console.push(message.text()));
  page.on('pageerror', (error) => seen.console.push(error.message));
  return seen;
}

/** The development server mounts effects twice (React StrictMode), so a page may ask for the session twice in a row. */
function paths(captured: Captured[]): string[] {
  return captured.map((entry) => entry.path).filter((path, index, all) => path !== all[index - 1]);
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

async function noHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

async function enterPassword(page: Page, email = EMAIL, password = PASSWORD) {
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
}

async function reachCodeStep(page: Page) {
  await page.goto('/sign-in');
  await enterPassword(page);
  await expect(page.getByLabel('Authenticator code')).toBeVisible();
}

test.describe('password step', () => {
  test('has the right fields, attributes and focus order', async ({ page }) => {
    await stubApi(page, {});
    await page.goto('/sign-in');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in to DROMEX');
    const email = page.getByLabel('Email address');
    const password = page.getByLabel('Password');
    await expect(email).toHaveAttribute('autocomplete', 'username');
    await expect(email).toHaveAttribute('dir', 'ltr');
    await expect(password).toHaveAttribute('autocomplete', 'current-password');
    await expect(password).toHaveAttribute('type', 'password');
    await expect(password).toHaveAttribute('dir', 'ltr');
    await page.keyboard.press('Tab');
    await expect(email).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(password).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused();
    expect(await noHorizontalOverflow(page)).toBe(true);
  });

  test('has no recovery link or recovery wording (that screen is a later phase)', async ({ page }) => {
    await stubApi(page, {});
    await page.goto('/sign-in');
    await expect(page.getByText(/recovery|lost your|backup code/i)).toHaveCount(0);
    await expect(page.getByRole('link', { name: /recover/i })).toHaveCount(0);
  });

  test('Enter submits, and only the email and password are sent, to a same-origin path', async ({ page, baseURL }) => {
    const seen = watch(page);
    const captured = await stubApi(page, { [SIGN_IN]: MFA });
    await page.goto('/sign-in');
    await page.getByLabel('Email address').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByLabel('Password').press('Enter');
    await expect(page.getByLabel('Authenticator code')).toBeVisible();
    expect(captured.map((entry) => entry.path)).toEqual([SIGN_IN]);
    expect(captured[0]!.body).toEqual({ email: EMAIL, password: PASSWORD });
    expect(captured[0]!.referer).toBeUndefined();
    for (const request of seen.requests) expect(new URL(request.url()).origin).toBe(new URL(baseURL!).origin);
    expect(page.url()).toBe(`${baseURL}/sign-in`);
  });

  test('any failure shows one generic message, clears the password and focuses it', async ({ page }) => {
    await stubApi(page, {
      [SIGN_IN]: [
        { status: 401, body: { error: 'invalid_credentials' } },
        { status: 401, body: { error: 'account_disabled' } },
      ],
    });
    await page.goto('/sign-in');
    await enterPassword(page);
    const alert = page.getByRole('alert');
    await expect(alert).toHaveText('The email address or password is not correct.');
    await expect(page.getByLabel('Password')).toHaveValue('');
    await expect(page.getByLabel('Password')).toBeFocused();
    await expect(page.getByLabel('Email address')).toHaveValue(EMAIL);
    await expect(page.getByLabel('Password')).toHaveAttribute('aria-describedby', /.+/);

    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(alert).toHaveText('The email address or password is not correct.');
  });

  test('empty fields are refused before any request', async ({ page }) => {
    const captured = await stubApi(page, {});
    await page.goto('/sign-in');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert')).toHaveText('Enter your email address and password.');
    expect(captured).toHaveLength(0);
  });

  test('a 403 says the browser already has a session, with a link to it', async ({ page }) => {
    await stubApi(page, { [SIGN_IN]: { status: 403, body: { error: 'forbidden' } } });
    await page.goto('/sign-in');
    await enterPassword(page);
    await expect(page.getByRole('alert')).toContainText('already signed in');
    await expect(page.getByRole('link', { name: 'Go to your account' })).toHaveAttribute('href', '/account');
  });

  test('a rate limit with Retry-After shows a countdown and blocks resubmission', async ({ page }) => {
    await stubApi(page, { [SIGN_IN]: { status: 429, body: { error: 'too_many_requests' }, headers: { 'retry-after': '3' } } });
    await page.goto('/sign-in');
    await enterPassword(page);
    await expect(page.getByRole('alert')).toContainText('Too many attempts');
    await expect(page.getByRole('timer')).toContainText('3 seconds');
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled({ timeout: 8000 });
    await expect(page.getByRole('timer')).toHaveCount(0);
  });

  test('a rate limit with no usable Retry-After shows no number at all', async ({ page }) => {
    await stubApi(page, { [SIGN_IN]: { status: 429, body: { error: 'too_many_requests' } } });
    await page.goto('/sign-in');
    await enterPassword(page);
    await expect(page.getByRole('alert')).toContainText('Too many attempts');
    await expect(page.getByRole('timer')).toHaveCount(0);
    await expect(page.getByRole('alert')).not.toContainText(/\d/);
    await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  test('a network failure keeps the email and offers another try', async ({ page }) => {
    await stubApi(page, { [SIGN_IN]: 'abort' });
    await page.goto('/sign-in');
    await enterPassword(page);
    await expect(page.getByRole('alert')).toContainText('connection failed');
    await expect(page.getByLabel('Email address')).toHaveValue(EMAIL);
    await expect(page.getByLabel('Password')).toHaveValue('');
  });

  test('the button is disabled while the request is in flight, without moving the layout', async ({ page }) => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/auth/sign-in/email', async (route) => {
      await gate;
      await route.fulfill({ status: 200, json: { mfaRequired: true } });
    });
    await page.goto('/sign-in');
    await page.getByLabel('Email address').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    const before = await page.getByRole('button', { name: 'Continue' }).boundingBox();
    await page.getByRole('button', { name: 'Continue' }).click();
    const busy = page.getByRole('button', { name: 'Checking…' });
    await expect(busy).toBeDisabled();
    const during = await busy.boundingBox();
    expect(during!.height).toBe(before!.height);
    expect(during!.y).toBe(before!.y);
    release();
    await expect(page.getByLabel('Authenticator code')).toBeVisible();
  });
});

test.describe('code step', () => {
  test('has the right attributes, takes focus, and sends only the six digits', async ({ page }) => {
    const captured = await stubApi(page, { [SIGN_IN]: MFA, [VERIFY]: { status: 401, body: { error: 'invalid_code' } } });
    await reachCodeStep(page);
    const code = page.getByLabel('Authenticator code');
    await expect(code).toBeFocused();
    await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    await expect(code).toHaveAttribute('inputmode', 'numeric');
    await expect(code).toHaveAttribute('dir', 'ltr');
    await code.fill('246 810');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    expect(captured.find((entry) => entry.path === VERIFY)!.body).toEqual({ code: CODE });
  });

  test('the password is gone from the page once the code step shows', async ({ page }) => {
    await stubApi(page, { [SIGN_IN]: MFA });
    await reachCodeStep(page);
    await expect(page.getByLabel('Password')).toHaveCount(0);
    expect(await page.evaluate((secret) => document.documentElement.outerHTML.includes(secret), PASSWORD)).toBe(false);
  });

  test('a wrong code stays on the code step with one generic message and a start-over button', async ({ page }) => {
    await stubApi(page, { [SIGN_IN]: MFA, [VERIFY]: { status: 401, body: { error: 'invalid_code' } } });
    await reachCodeStep(page);
    await page.getByLabel('Authenticator code').fill(CODE);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('alert')).toHaveText('That code was not accepted. Check the code and try again, or start over.');
    await expect(page.getByLabel('Authenticator code')).toHaveValue('');
    await expect(page.getByLabel('Authenticator code')).toBeFocused();

    await page.getByRole('button', { name: 'Start over' }).click();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByLabel('Password')).toHaveValue('');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('a code that is not six digits is refused before any request', async ({ page }) => {
    const captured = await stubApi(page, { [SIGN_IN]: MFA });
    await reachCodeStep(page);
    await page.getByLabel('Authenticator code').fill('12345');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('alert')).toHaveText('Enter the 6-digit code from your authenticator app.');
    expect(captured.map((entry) => entry.path)).toEqual([SIGN_IN]);
  });

  test('a rate limit on the code shows its countdown', async ({ page }) => {
    await stubApi(page, { [SIGN_IN]: MFA, [VERIFY]: { status: 429, body: { error: 'too_many_requests' }, headers: { 'retry-after': '60' } } });
    await reachCodeStep(page);
    await page.getByLabel('Authenticator code').fill(CODE);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('timer')).toContainText('60 seconds');
    await expect(page.getByRole('button', { name: 'Verify' })).toBeDisabled();
  });

  test('success is shown only after the server confirms, and lands on the account page', async ({ page, baseURL }) => {
    const seen = watch(page);
    const captured = await stubApi(page, { [SIGN_IN]: MFA, [VERIFY]: SIGNED_IN, [SESSION]: OWNER_SESSION });
    await reachCodeStep(page);
    await page.getByLabel('Authenticator code').fill(CODE);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page).toHaveURL(`${baseURL}/account`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your account');
    await expect(page.getByText('Synthetic Owner')).toBeVisible();
    expect(paths(captured)).toEqual([SIGN_IN, VERIFY, SESSION]);
    expect(await storageIsEmpty(page)).toBe(true);
    const everything = [...seen.requests.map((request) => request.url()), ...seen.console, page.url()].join('\n');
    for (const secret of [PASSWORD, CODE]) expect(everything).not.toContain(secret);
  });

  test('a server error is never shown as success', async ({ page, baseURL }) => {
    await stubApi(page, { [SIGN_IN]: MFA, [VERIFY]: { status: 500, body: { error: 'internal_error' } } });
    await reachCodeStep(page);
    await page.getByLabel('Authenticator code').fill(CODE);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByRole('alert')).toContainText('Something went wrong');
    await expect(page).toHaveURL(`${baseURL}/sign-in`);
  });
});

test.describe('account page', () => {
  test('a signed-out visitor is redirected to sign-in', async ({ page, baseURL }) => {
    await stubApi(page, { [SESSION]: { status: 401, body: { error: 'unauthorized' } } });
    await page.goto('/account');
    await expect(page).toHaveURL(`${baseURL}/sign-in`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in to DROMEX');
  });

  test('shows the name, email and the role the server states, and nothing more privileged', async ({ page }) => {
    await stubApi(page, {
      [SESSION]: { body: { user: { id: 'synthetic-2', name: 'Synthetic Admin', email: 'admin@example.test' }, isOwner: false } },
    });
    await page.goto('/account');
    await expect(page.getByText('Synthetic Admin')).toBeVisible();
    await expect(page.getByText('admin@example.test')).toBeVisible();
    await expect(page.getByText('Admin', { exact: true })).toBeVisible();
    await expect(page.getByText('Owner', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /accounts/i })).toHaveCount(0);
  });

  test('the Owner sees a link to account management', async ({ page }) => {
    await stubApi(page, { [SESSION]: OWNER_SESSION });
    await page.goto('/account');
    await expect(page.getByText('Owner', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Manage Admin accounts' })).toHaveAttribute('href', '/owner/accounts');
  });

  test('sign out calls the server, and only then shows the signed-out confirmation', async ({ page }) => {
    const captured = await stubApi(page, { [SESSION]: OWNER_SESSION, [SIGN_OUT]: { body: { signedOut: true } } });
    await page.goto('/account');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('You are signed out');
    await expect(page.getByText('Synthetic Owner')).toHaveCount(0);
    expect(paths(captured)).toEqual([SESSION, SIGN_OUT]);
    await expect(page.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/sign-in');
  });

  test('a failed sign out is reported and the user stays on the signed-in page', async ({ page }) => {
    await stubApi(page, { [SESSION]: OWNER_SESSION, [SIGN_OUT]: { status: 500, body: { error: 'internal_error' } } });
    await page.goto('/account');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('alert')).toContainText('could not be confirmed');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your account');
  });

  test('an unreachable server is an error, not a sign-in or a sign-out', async ({ page, baseURL }) => {
    await stubApi(page, { [SESSION]: 'abort' });
    await page.goto('/account');
    await expect(page.getByRole('alert')).toContainText('connection failed');
    await expect(page).toHaveURL(`${baseURL}/account`);
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  });

  test('a session that ends while the page is open is shown as ended on the next check', async ({ page }) => {
    let ended = false;
    await stubApi(page, { [SESSION]: () => (ended ? { status: 401, body: { error: 'unauthorized' } } : OWNER_SESSION) });
    await page.goto('/account');
    await expect(page.getByText('Synthetic Owner')).toBeVisible();
    ended = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your session has ended');
    await expect(page.getByText('Synthetic Owner')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/sign-in');
  });
});

test.describe('layout and reach', () => {
  const LONG = `${'long-synthetic-name-'.repeat(8)}@example.test`;

  test('long text and a right-to-left document do not break the layout', async ({ page }) => {
    await stubApi(page, {
      [SIGN_IN]: { status: 401, body: {} },
      [SESSION]: { body: { user: { id: 's', name: 'N'.repeat(120), email: LONG }, isOwner: true } },
    });
    await page.goto('/sign-in');
    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    await enterPassword(page, LONG);
    await expect(page.getByRole('alert')).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);
    await page.goto('/account');
    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    await expect(page.getByText('N'.repeat(120))).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);
  });

  test('the home page links to sign-in', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test('the sign-in page loads nothing from another origin', async ({ page, baseURL }) => {
    const seen = watch(page);
    await stubApi(page, {});
    await page.goto('/sign-in');
    await page.waitForLoadState('networkidle');
    for (const request of seen.requests) expect(new URL(request.url()).origin).toBe(new URL(baseURL!).origin);
  });
});
