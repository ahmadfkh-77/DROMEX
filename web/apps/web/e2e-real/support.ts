import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';

// TEST-ONLY RFC 6238 generator and step helpers, shared with the API's tests.
import { TotpSequence, totpCode, waitForFreshStep, wrongCode } from '../../api/tests/helpers/totp.ts';

/**
 * Support for the real end-to-end sign-in tests (batch 4b-2).
 *
 * Nothing here prints a credential. Test titles, assertion messages and
 * thrown errors never contain a password, TOTP seed, code or cookie value:
 * values are compared as booleans, and a missing variable is named, never
 * shown. The workflow masks every value in the job log as well.
 */

export const WEB_ORIGIN = 'http://127.0.0.1:5174';

/** The one message every failed password step shows (the unit tests pin the wording). */
export const GENERIC_CREDENTIALS_MESSAGE = 'The email address or password is not correct.';
export const GENERIC_CODE_MESSAGE = 'That code was not accepted. Check the code and try again, or start over.';
export const RATE_LIMITED_MESSAGE = 'Too many attempts. Wait before trying again.';

/** The rate limit forgets a client after 60 seconds without a request; this adds margin. */
export const RATE_LIMIT_QUIET_MS = 62_000;

export function envValue(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set; the workflow seeds it.`);
  return value;
}

export interface Account {
  id: string;
  email: string;
  password: string;
  totp: TotpSequence | null;
  totpSecret: string | null;
}

export function account(prefix: 'OWNER' | 'ADMIN_A' | 'ADMIN_B' | 'ADMIN_C' | 'ADMIN_D'): Account {
  const secret = process.env[`DROMEX_E2E_${prefix}_TOTP_SECRET`];
  return {
    id: envValue(`DROMEX_E2E_${prefix}_ID`),
    email: envValue(`DROMEX_E2E_${prefix}_EMAIL`),
    password: envValue(`DROMEX_E2E_${prefix}_PASSWORD`),
    totpSecret: secret === undefined || secret === '' ? null : secret,
    totp: secret === undefined || secret === '' ? null : new TotpSequence(secret),
  };
}

export async function quietForRateLimit(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_QUIET_MS));
}

/** A fresh, isolated browser context (its own cookies and storage). */
export async function newSession(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

/** Spends exactly one sign-in request. */
export async function submitPassword(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
}

/** Spends exactly one verify request. */
export async function submitCode(page: Page, code: string): Promise<void> {
  await page.getByLabel('Authenticator code').fill(code);
  await page.getByRole('button', { name: 'Verify' }).click();
}

/** Password step, then a fresh code: one sign-in request and one verify request. */
export async function signIn(page: Page, who: Account): Promise<void> {
  await submitPassword(page, who.email, who.password);
  await expect(page.getByLabel('Authenticator code')).toBeVisible();
  await submitCode(page, await who.totp!.next());
  await expect(page).toHaveURL(`${WEB_ORIGIN}/account`);
}

/** A request context carrying the browser context's cookies and the trusted Origin. */
export function apiAs(context: BrowserContext): APIRequestContext {
  return context.request;
}

export const TRUSTED_ORIGIN_HEADER = { origin: WEB_ORIGIN };

export { totpCode, waitForFreshStep, wrongCode };

/** True when none of the given secrets occurs in the text. Never prints them. */
export function lacksAll(text: string, secrets: readonly string[]): boolean {
  return secrets.every((secret) => secret === '' || !text.includes(secret));
}

/** The API itself, bypassing `vite preview` (which adds CORS headers of its own and is test-only). */
export const API_ORIGIN = 'http://127.0.0.1:3000';

/**
 * Runs a same-origin `fetch` inside the page, in real Chrome with its own
 * cookie jar and the browser's own Origin header, and returns only the status.
 * Costs no sign-in or verify request.
 */
export async function statusFromPage(page: Page, path: string, init?: { method: 'POST'; json: unknown }): Promise<number> {
  return page.evaluate(
    async ({ path: target, init: request }) => {
      const response = await fetch(target, {
        method: request?.method ?? 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: request === undefined ? undefined : { 'content-type': 'application/json' },
        body: request === undefined ? undefined : JSON.stringify(request.json),
      });
      return response.status;
    },
    { path, init },
  );
}
