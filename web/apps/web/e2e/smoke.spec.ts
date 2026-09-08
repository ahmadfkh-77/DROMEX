import { expect, test } from '@playwright/test';

test('preview renders its heading', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/DROMEX/i);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('DROMEX');
});

test('preview is labelled as a non-production environment', async ({ page }) => {
  await page.goto('/');

  // A screenshot of this page must never be mistaken for a working product.
  await expect(page.getByTestId('environment-banner')).toContainText(
    /development preview/i,
  );
});

test('preview exposes no business data before authentication exists', async ({ page }) => {
  await page.goto('/');
  const body = (await page.textContent('body')) ?? '';

  // DEC-409: an unauthenticated visitor receives no business information.
  // Phase 1 ships no authentication, so it must ship no business data either.
  for (const term of ['customer', 'supplier', 'invoice', 'payment', 'load']) {
    expect(body.toLowerCase()).not.toContain(term);
  }
});

test('layout does not overflow horizontally at this viewport', async ({ page }) => {
  await page.goto('/');

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );

  expect(overflow).toBe(false);
});
