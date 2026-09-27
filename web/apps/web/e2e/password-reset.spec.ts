import { expect, test, type Page, type Request } from '@playwright/test';

/**
 * Password reset pages (DEC-441, DEC-442, DEC-487). The token is taken from
 * the fragment, removed from the address bar before any request, sent only in
 * a same-origin POST body, and never stored. The API is replaced by a
 * synthetic stub at the browser's network layer, so no server, account, or
 * real token exists.
 */

const TOKEN = 'SYNTHETIC_RESET_TOKEN_ONLY_'.padEnd(43, '0');
const PASSWORD = 'a synthetic preview passphrase';

interface Captured {
  url: string;
  body: unknown;
  referer: string | undefined;
}

type Stub = { status?: number; body: unknown } | 'abort';

async function stubApi(page: Page, responses: Record<string, Stub | Stub[]>): Promise<Captured[]> {
  const captured: Captured[] = [];
  const calls = new Map<string, number>();
  await page.route('**/api/password-reset/*', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    captured.push({ url: request.url(), body: request.postDataJSON(), referer: (await request.headerValue('referer')) ?? undefined });
    const configured = responses[path];
    const index = calls.get(path) ?? 0;
    calls.set(path, index + 1);
    const response = Array.isArray(configured) ? configured[Math.min(index, configured.length - 1)] : configured;
    if (response === undefined) return route.fulfill({ status: 404, json: { error: 'not_found' } });
    if (response === 'abort') return route.abort('connectionreset');
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

async function noHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

test.describe('forgot password', () => {
  test('sends only the address and shows one neutral confirmation', async ({ page, baseURL }) => {
    const requests = watchRequests(page);
    const captured = await stubApi(page, { '/api/password-reset/request': { status: 202, body: { status: 'requested' } } });

    await page.goto('/forgot-password');
    await page.getByLabel('Email address').fill('person@example.test');
    await page.getByRole('button', { name: 'Send reset link' }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Check your email');
    await expect(page.getByRole('status')).toContainText('If password reset is available for that address');
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    expect(captured.map((entry) => entry.body)).toEqual([{ email: 'person@example.test' }]);
    expect(captured[0]!.referer).toBeUndefined();
    for (const request of requests) expect(new URL(request.url()).origin).toBe(new URL(baseURL!).origin);
    expect(await storageIsEmpty(page)).toBe(true);
  });

  test('shows the rate limit, a network failure, and an empty address without leaving the form', async ({ page }) => {
    await stubApi(page, {
      '/api/password-reset/request': [{ status: 429, body: { error: 'too_many_requests' } }, 'abort'],
    });
    await page.goto('/forgot-password');

    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('alert')).toHaveText('Enter an email address.');

    await page.getByLabel('Email address').fill('person@example.test');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('alert')).toContainText('Too many attempts');

    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('alert')).toContainText('connection failed');
    await expect(page.getByLabel('Email address')).toHaveValue('person@example.test');
  });

  test('keeps the address field left-to-right and fits this viewport', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.getByLabel('Email address')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByLabel('Email address')).toHaveAttribute('autocomplete', 'email');
    expect(await noHorizontalOverflow(page)).toBe(true);
  });

  test('is reachable from the preview home page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
  });
});

test.describe('reset password', () => {
  test('removes the token from the address bar and history, and sends it only in POST bodies', async ({ page, baseURL }) => {
    const requests = watchRequests(page);
    const captured = await stubApi(page, {
      '/api/password-reset/inspect': { body: { next: 'choose_password' } },
      '/api/password-reset/complete': { body: { signInRequired: true } },
    });

    await page.goto(`/reset-password#${TOKEN}`);
    await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
    expect(page.url()).toBe(`${baseURL}/reset-password`);
    expect(await page.evaluate(() => window.location.hash)).toBe('');
    expect(await page.evaluate(() => JSON.stringify(window.history.state))).not.toContain(TOKEN);

    await page.getByLabel('New password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm new password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Set new password' }).click();

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Password changed');
    await expect(page.getByRole('status')).toContainText('authenticator app');
    expect(captured.map((entry) => [new URL(entry.url).pathname, entry.body])).toEqual([
      ['/api/password-reset/inspect', { token: TOKEN }],
      ['/api/password-reset/complete', { token: TOKEN, newPassword: PASSWORD }],
    ]);
    for (const request of requests) {
      expect(request.url()).not.toContain(TOKEN);
      expect(new URL(request.url()).origin).toBe(new URL(baseURL!).origin);
    }
    for (const entry of captured) expect(entry.referer).toBeUndefined();
    expect(await storageIsEmpty(page)).toBe(true);
    const text = (await page.textContent('body')) ?? '';
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(PASSWORD);
    expect(await page.locator('meta[name="referrer"]').getAttribute('content')).toBe('no-referrer');
  });

  test('shows one generic message for an unusable link, and asks for the email link when the fragment is missing', async ({ page }) => {
    const captured = await stubApi(page, { '/api/password-reset/inspect': { status: 400, body: { error: 'reset_link_invalid' } } });

    await page.goto(`/reset-password#${TOKEN}`);
    await expect(page.getByRole('alert')).toContainText('can no longer be used');
    await expect(page.getByRole('link', { name: 'Request a new reset link' })).toHaveAttribute('href', '/forgot-password');

    for (const url of ['/reset-password', '/reset-password#short', `/reset-password?token=${TOKEN}`]) {
      await page.goto(url);
      await expect(page.getByRole('alert')).toContainText('needs the link from your reset email');
    }
    expect(captured).toHaveLength(1);
  });

  test('checks the confirmation and length in the browser, and shows each server refusal', async ({ page }) => {
    const captured = await stubApi(page, {
      '/api/password-reset/inspect': { body: { next: 'choose_password' } },
      '/api/password-reset/complete': [
        { status: 400, body: { error: 'password_rejected', reason: 'common' } },
        { status: 429, body: { error: 'too_many_requests' } },
        'abort',
        { status: 500, body: { error: 'reset_failed' } },
      ],
    });
    await page.goto(`/reset-password#${TOKEN}`);
    const save = page.getByRole('button', { name: 'Set new password' });

    await page.getByLabel('New password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm new password').fill(`${PASSWORD}!`);
    await save.click();
    await expect(page.getByRole('alert')).toHaveText('The two passwords do not match.');

    await page.getByLabel('New password', { exact: true }).fill('too short');
    await page.getByLabel('Confirm new password').fill('too short');
    await save.click();
    await expect(page.getByRole('alert')).toHaveText('Use at least 15 characters.');
    expect(captured).toHaveLength(1);

    await page.getByLabel('New password', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Confirm new password').fill(PASSWORD);
    await save.click();
    await expect(page.getByRole('alert')).toContainText('too common');
    await save.click();
    await expect(page.getByRole('alert')).toContainText('Too many attempts');
    await save.click();
    await expect(page.getByRole('alert')).toContainText('connection failed');
    await save.click();
    await expect(page.getByRole('alert')).toContainText('could not be changed');

    // Every retry carried the same token, kept in memory across the failures.
    expect(captured.slice(1).map((entry) => (entry.body as { token: string }).token)).toEqual([TOKEN, TOKEN, TOKEN, TOKEN]);
  });

  test('announces errors through linked, labelled fields and fits this viewport', async ({ page }) => {
    await stubApi(page, {
      '/api/password-reset/inspect': { body: { next: 'choose_password' } },
      '/api/password-reset/complete': { status: 400, body: { error: 'password_rejected', reason: 'too_short' } },
    });
    await page.goto(`/reset-password#${TOKEN}`);
    const field = page.getByLabel('New password', { exact: true });
    await expect(field).toHaveAttribute('autocomplete', 'new-password');
    await expect(field).toHaveAttribute('aria-describedby', 'reset-hint');
    await field.fill(PASSWORD);
    await page.getByLabel('Confirm new password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(field).toHaveAttribute('aria-describedby', 'reset-hint reset-error');
    expect(await noHorizontalOverflow(page)).toBe(true);
  });
});
