import { expect, test } from '@playwright/test';

import { RATE_LIMITED_MESSAGE, TRUSTED_ORIGIN_HEADER, WEB_ORIGIN, newSession, quietForRateLimit, submitPassword } from './support.ts';

/**
 * Window C, last: starts after 62 quiet seconds and exhausts the sign-in
 * limit on purpose. Five priming requests with an unknown address use up the
 * allowance; the sixth, from the page, must be answered 429. The limit is the
 * real one, unchanged. Nothing runs after this window.
 */

test.describe.configure({ mode: 'serial' });

// The wait is a test of its own, so its timeout is set in the test body and
// covers the 62 seconds with margin.
test('the sign-in limit window is allowed to reset', async () => {
  test.setTimeout(120_000);
  await quietForRateLimit();
});

test('the real rate limit answers 429 and the page shows the generic rate-limited message', async ({ browser, playwright }) => {
  const client = await playwright.request.newContext({ baseURL: WEB_ORIGIN });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const primed = await client.post('/api/auth/sign-in/email', {
      data: { email: 'nobody-e2e@synthetic.invalid', password: 'a-password-that-is-not-right' },
      headers: TRUSTED_ORIGIN_HEADER,
    });
    expect(primed.status()).toBe(401);
  }
  await client.dispose();

  const { page, context } = await newSession(browser);
  const limited = page.waitForResponse((response) => response.url().endsWith('/api/auth/sign-in/email'));
  await submitPassword(page, 'nobody-e2e@synthetic.invalid', 'a-password-that-is-not-right');
  const response = await limited;

  expect(response.status()).toBe(429);
  const retryAfter = Number(response.headers()['retry-after']);
  expect(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 60).toBe(true);
  await expect(page.getByRole('alert')).toHaveText(RATE_LIMITED_MESSAGE);
  await expect(page.getByRole('timer')).toBeVisible();
  await expect(page.getByLabel('Authenticator code')).toHaveCount(0);
  await context.close();
});
