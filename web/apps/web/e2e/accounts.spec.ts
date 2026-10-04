import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Owner account management (checkpoint 4E). The API is replaced by a synthetic
 * stub at the browser's network layer, so no server, account, session, or
 * credential exists; every name and address is invented. The server's own
 * authorization is proven by the API integration suite; these tests prove the
 * screens: states, confirmations, errors, keyboard use, and small screens.
 */

const OWNER = { user: { id: 'owner_synthetic', name: 'Synthetic Owner', email: 'owner@example.test' }, isOwner: true };
const LONG_NAME = 'Maximilian Alexander Konstantin Bartholomew-Featherstonehaugh the Third of Site Four';
const ARABIC_NAME = 'أحمد الفقيه المهندس المسؤول';

function snapshot(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: '41',
    status,
    createdAt: '2026-09-28T08:00:00.000Z',
    expiresAt: '2026-09-29T08:00:00.000Z',
    endedAt: status === 'pending' ? null : '2026-09-28T10:00:00.000Z',
    delivery: { status: 'provider_accepted', reason: null },
    ...overrides,
  };
}

const LIST = {
  accounts: [
    { userId: 'admin_active', name: 'Synthetic Active Admin', email: 'active@example.test', state: 'active', activeSessions: 2, invitation: snapshot('accepted') },
    { userId: 'admin_disabled', name: 'Synthetic Disabled Admin', email: 'disabled@example.test', state: 'disabled', activeSessions: null, invitation: null },
    { userId: 'admin_setup', name: ARABIC_NAME, email: 'setup@example.test', state: 'enrolment_in_progress', activeSessions: null, invitation: snapshot('pending') },
    { userId: 'admin_long', name: LONG_NAME, email: 'a.very.long.address.for.layout.testing.only@subdomain.example.test', state: 'active', activeSessions: 0, invitation: null },
  ],
  invitations: [
    { invitationId: '51', email: 'pending@example.test', state: 'invitation_pending', createdAt: '2026-09-29T08:00:00.000Z', expiresAt: '2026-09-30T08:00:00.000Z', endedAt: null, delivery: { status: 'not_sent', reason: 'email_disabled' } },
    { invitationId: '52', email: 'expired@example.test', state: 'invitation_expired', createdAt: '2026-09-20T08:00:00.000Z', expiresAt: '2026-09-21T08:00:00.000Z', endedAt: '2026-09-21T08:00:00.000Z', delivery: { status: 'provider_accepted', reason: null } },
    { invitationId: '53', email: 'cancelled@example.test', state: 'invitation_cancelled', createdAt: '2026-09-22T08:00:00.000Z', expiresAt: '2026-09-23T08:00:00.000Z', endedAt: '2026-09-22T09:00:00.000Z', delivery: { status: 'provider_accepted', reason: null } },
  ],
};

function detail(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'admin_active',
    name: 'Synthetic Active Admin',
    email: 'active@example.test',
    state: 'active',
    identityCreatedAt: '2026-09-28T09:00:00.000Z',
    setupCompletedAt: null,
    invitation: snapshot('accepted'),
    lastStatusChange: null,
    sessions: [
      { ref: 'a'.repeat(32), signedInAt: '2026-09-29T07:00:00.000Z', expiresAt: '2026-09-29T19:00:00.000Z' },
      { ref: 'b'.repeat(32), signedInAt: '2026-09-29T08:00:00.000Z', expiresAt: '2026-09-29T20:00:00.000Z' },
    ],
    actions: {
      disable: { available: true, reason: null },
      enable: { available: false, reason: 'account_not_disabled' },
      revokeAllSessions: { available: true, reason: null },
    },
    ...overrides,
  };
}

interface Call {
  method: string;
  path: string;
  body: unknown;
}

type Responder = (call: Call) => { status?: number; body: unknown } | undefined;

/** Stubs the API; later handlers win. Every call is recorded. */
async function stub(page: Page, responders: Record<string, Responder | { status?: number; body: unknown }>): Promise<Call[]> {
  const calls: Call[] = [];
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const call = { method: request.method(), path, body: request.method() === 'POST' ? request.postDataJSON() : undefined };
    calls.push(call);
    const entry = responders[`${call.method} ${path}`];
    const response = typeof entry === 'function' ? entry(call) : entry;
    if (response === undefined) return route.fulfill({ status: 404, json: { error: 'not_found' } });
    return route.fulfill({ status: response.status ?? 200, json: response.body });
  });
  return calls;
}

function ownerApi(extra: Record<string, Responder | { status?: number; body: unknown }> = {}) {
  return {
    'GET /api/session': { body: OWNER },
    'GET /api/owner/accounts': { body: LIST },
    'GET /api/owner/accounts/admin_active': { body: { account: detail() } },
    ...extra,
  };
}

async function noHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

test.describe('Owner accounts list', () => {
  test('groups Admins and invitations with plain-language states and no secret-shaped data', async ({ page }) => {
    await stub(page, ownerApi());
    await page.goto('/owner/accounts');

    await expect(page.getByRole('heading', { level: 1, name: 'Accounts' })).toBeVisible();
    const admins = page.getByRole('region', { name: 'Admin accounts' });
    await expect(admins.getByRole('listitem')).toHaveCount(4);
    await expect(admins.getByRole('listitem').filter({ hasText: 'Synthetic Active Admin' })).toContainText('Active');
    await expect(admins.getByRole('listitem').filter({ hasText: 'Synthetic Active Admin' })).toContainText('2 active sessions');
    await expect(admins.getByRole('listitem').filter({ hasText: 'Synthetic Disabled Admin' })).toContainText('Disabled');
    await expect(admins.getByRole('listitem').filter({ hasText: ARABIC_NAME })).toContainText('Enrolment in progress');

    const invitations = page.getByRole('region', { name: 'Invitations without an account' });
    await expect(invitations.getByRole('listitem').filter({ hasText: 'pending@example.test' })).toContainText('Invitation pending');
    await expect(invitations.getByRole('listitem').filter({ hasText: 'pending@example.test' })).toContainText(
      'Email not sent: email delivery is not configured',
    );
    await expect(invitations.getByRole('listitem').filter({ hasText: 'expired@example.test' })).toContainText('Invitation expired');
    await expect(invitations.getByRole('listitem').filter({ hasText: 'cancelled@example.test' })).toContainText('Invitation cancelled');

    // Every state carries text and a shape, never colour alone.
    for (const badge of await page.getByTestId('state-badge').all()) {
      expect((await badge.textContent())!.trim().length).toBeGreaterThan(0);
      await expect(badge.locator('svg')).toHaveCount(1);
    }

    const text = (await page.textContent('body')) ?? '';
    for (const term of ['token', 'password hash', 'user agent', 'IP address', 'Last active', 'last seen']) {
      expect(text).not.toContain(term);
    }
    expect(await noHorizontalOverflow(page)).toBe(true);
  });

  test('shows teaching empty states when nothing exists yet', async ({ page }) => {
    await stub(page, ownerApi({ 'GET /api/owner/accounts': { body: { accounts: [], invitations: [] } } }));
    await page.goto('/owner/accounts');

    await expect(page.getByRole('region', { name: 'Admin accounts' })).toContainText('No Admin account has finished setup yet');
    await expect(page.getByRole('region', { name: 'Invitations without an account' })).toContainText('No open or recently ended invitations');
    await expect(page.getByLabel('Email address')).toBeVisible();
  });

  test('refuses to show anything to a signed-out visitor or an Admin, without calling the accounts API', async ({ page }) => {
    const signedOut = await stub(page, { 'GET /api/session': { status: 401, body: { error: 'unauthorized' } } });
    await page.goto('/owner/accounts');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in required' })).toBeVisible();
    expect(signedOut.some((call) => call.path.startsWith('/api/owner/'))).toBe(false);

    await page.unroute('**/api/**');
    const admin = await stub(page, { 'GET /api/session': { body: { ...OWNER, isOwner: false } } });
    await page.goto('/owner/accounts/admin_active');
    await expect(page.getByRole('heading', { level: 1, name: 'Owner only' })).toBeVisible();
    expect(admin.some((call) => call.path.startsWith('/api/owner/'))).toBe(false);
  });

  test('explains a failed load and recovers on retry', async ({ page }) => {
    let failing = true;
    await stub(
      page,
      ownerApi({
        'GET /api/owner/accounts': () => (failing ? { status: 500, body: { error: 'internal_error' } } : { body: LIST }),
      }),
    );
    await page.goto('/owner/accounts');

    await expect(page.getByRole('alert')).toContainText('Accounts could not be loaded');
    await expect(page.getByRole('alert')).toContainText('Nothing was changed. Try again');
    failing = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('region', { name: 'Admin accounts' }).getByRole('listitem')).toHaveCount(4);
  });

  test('invites an Admin with exactly the address, and reports the honest delivery state', async ({ page }) => {
    const calls = await stub(
      page,
      ownerApi({
        'POST /api/owner/invitations': {
          status: 201,
          body: { invitation: { id: '60', email: 'new.admin@example.test', status: 'pending', createdAt: '2026-09-29T09:00:00.000Z', expiresAt: '2026-09-30T09:00:00.000Z', endedAt: null, delivery: { status: 'not_sent', reason: 'email_disabled' } } },
        },
      }),
    );
    await page.goto('/owner/accounts');

    await page.getByRole('button', { name: 'Send invitation', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Enter a valid email address.');
    await expect(page.getByLabel('Email address')).toBeFocused();
    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);

    await page.getByLabel('Email address').fill('  new.admin@example.test ');
    await page.getByRole('button', { name: 'Send invitation', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Invitation created for new.admin@example.test');
    await expect(page.getByRole('status')).toContainText('Email not sent: email delivery is not configured');
    expect(calls.filter((call) => call.method === 'POST')).toEqual([
      { method: 'POST', path: '/api/owner/invitations', body: { email: 'new.admin@example.test' } },
    ]);
  });

  test('cancels a pending invitation only after a confirmation, and resends through the existing route', async ({ page }) => {
    const calls = await stub(
      page,
      ownerApi({
        'POST /api/owner/invitations/51/cancel': { body: { invitation: { ...snapshot('cancelled', { id: '51' }), email: 'pending@example.test' } } },
        'POST /api/owner/invitations/51/resend': { body: { invitation: { ...snapshot('pending', { id: '61' }), email: 'pending@example.test' } } },
      }),
    );
    await page.goto('/owner/accounts');
    const row = page.getByRole('region', { name: 'Invitations without an account' }).getByRole('listitem').filter({ hasText: 'pending@example.test' });

    await row.getByRole('button', { name: 'Cancel invitation' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancel the invitation to pending@example.test?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep as is' }).click();
    await expect(dialog).toBeHidden();
    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);

    await row.getByRole('button', { name: 'Cancel invitation' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel invitation' }).click();
    await expect(page.getByRole('status')).toContainText('The invitation to pending@example.test is cancelled.');

    await row.getByRole('button', { name: 'Resend invitation' }).click();
    await expect(page.getByRole('status')).toContainText('A new invitation replaced the earlier one for pending@example.test.');
    expect(calls.filter((call) => call.method === 'POST').map((call) => [call.path, call.body])).toEqual([
      ['/api/owner/invitations/51/cancel', {}],
      ['/api/owner/invitations/51/resend', {}],
    ]);
  });

  test('opens an account from the keyboard', async ({ page }) => {
    await stub(page, ownerApi());
    await page.goto('/owner/accounts');

    const link = page.getByRole('link', { name: 'Open Synthetic Active Admin' });
    await link.focus();
    await expect(link).toBeFocused();
    const outline = await link.evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(outline).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/owner\/accounts\/admin_active$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Synthetic Active Admin' })).toBeFocused();
  });
});

test.describe('Owner account detail', () => {
  test('shows safe facts, honest unknowns, sessions, and why an action is unavailable', async ({ page }) => {
    await stub(page, ownerApi());
    await page.goto('/owner/accounts/admin_active');

    await expect(page.getByRole('heading', { level: 1, name: 'Synthetic Active Admin' })).toBeVisible();
    const facts = page.getByRole('region', { name: 'Account' });
    await expect(facts).toContainText('Active');
    await expect(facts).toContainText('Not recorded');
    await expect(facts).toContainText('Never disabled or re-enabled');
    await expect(facts.locator('time').first()).toHaveAttribute('datetime', '2026-09-28T09:00:00.000Z');

    const sessions = page.getByRole('region', { name: 'Sessions' });
    await expect(sessions.getByRole('listitem')).toHaveCount(2);
    await expect(sessions.getByRole('button', { name: 'Sign out this session' })).toHaveCount(2);
    await expect(sessions).not.toContainText('a'.repeat(32));

    const actions = page.getByRole('region', { name: 'Actions' });
    await expect(actions.getByRole('button', { name: 'Disable account' })).toBeEnabled();
    await expect(actions.getByRole('button', { name: 'Re-enable account' })).toHaveCount(0);
    await expect(actions).toContainText('Only a disabled account can be re-enabled.');
    expect(await noHorizontalOverflow(page)).toBe(true);
  });

  test('disables only after a confirmation that names the person, requires a reason, and sends exactly that reason', async ({ page }) => {
    const disabled = detail({
      state: 'disabled',
      sessions: [],
      lastStatusChange: { action: 'disabled', reason: 'Left the company', changedAt: '2026-09-29T09:00:00.000Z', changedByName: 'Synthetic Owner' },
      actions: {
        disable: { available: false, reason: 'account_not_active' },
        enable: { available: true, reason: null },
        revokeAllSessions: { available: true, reason: null },
      },
    });
    const calls = await stub(page, ownerApi({ 'POST /api/owner/accounts/admin_active/disable': { body: { account: disabled } } }));
    await page.goto('/owner/accounts/admin_active');

    const trigger = page.getByRole('button', { name: 'Disable account' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Disable Synthetic Active Admin?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Every session ends immediately');
    await expect(dialog.getByLabel('Reason (required)')).toBeFocused();

    // Escape closes without any request and returns focus to the trigger.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await dialog.getByRole('button', { name: 'Disable account' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Enter a reason of 3 to 500 characters on a single line.');
    await expect(dialog.getByLabel('Reason (required)')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);

    await dialog.getByLabel('Reason (required)').fill('  Left the company  ');
    await expect(dialog).toContainText('16 of 500 characters');
    await dialog.getByRole('button', { name: 'Disable account' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status')).toContainText('Synthetic Active Admin is disabled and signed out everywhere.');
    await expect(page.getByRole('region', { name: 'Account' })).toContainText('Left the company');
    await expect(page.getByRole('region', { name: 'Actions' }).getByRole('button', { name: 'Re-enable account' })).toBeVisible();
    expect(calls.filter((call) => call.method === 'POST')).toEqual([
      { method: 'POST', path: '/api/owner/accounts/admin_active/disable', body: { reason: 'Left the company' } },
    ]);
  });

  test('re-enables with a reason and says a new sign-in is required', async ({ page }) => {
    const disabled = detail({
      state: 'disabled',
      sessions: [],
      actions: {
        disable: { available: false, reason: 'account_not_active' },
        enable: { available: true, reason: null },
        revokeAllSessions: { available: true, reason: null },
      },
    });
    const calls = await stub(
      page,
      ownerApi({
        'GET /api/owner/accounts/admin_active': { body: { account: disabled } },
        'POST /api/owner/accounts/admin_active/enable': { body: { account: detail({ sessions: [] }) } },
      }),
    );
    await page.goto('/owner/accounts/admin_active');
    await expect(page.getByRole('region', { name: 'Sessions' })).toContainText('Sessions are listed only for active accounts.');

    await page.getByRole('button', { name: 'Re-enable account' }).click();
    const dialog = page.getByRole('dialog', { name: 'Re-enable Synthetic Active Admin?' });
    await expect(dialog).toContainText('No earlier session comes back.');
    await dialog.getByLabel('Reason (required)').fill('غادر ثم عاد إلى الموقع');
    await dialog.getByRole('button', { name: 'Re-enable account' }).click();
    await expect(page.getByRole('status')).toContainText('Synthetic Active Admin is re-enabled. They must sign in again.');
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.body)).toEqual([{ reason: 'غادر ثم عاد إلى الموقع' }]);
  });

  test('ends one session, or every session, only after a confirmation, with empty request bodies', async ({ page }) => {
    const oneLeft = detail({ sessions: [detail().sessions[1]] });
    const calls = await stub(
      page,
      ownerApi({
        [`POST /api/owner/accounts/admin_active/sessions/${'a'.repeat(32)}/revoke`]: { body: { account: oneLeft } },
        'POST /api/owner/accounts/admin_active/sessions/revoke-all': { body: { account: detail({ sessions: [] }) } },
      }),
    );
    await page.goto('/owner/accounts/admin_active');

    const sessions = page.getByRole('region', { name: 'Sessions' });
    await sessions.getByRole('listitem').first().getByRole('button', { name: 'Sign out this session' }).click();
    const one = page.getByRole('dialog', { name: 'End this session of Synthetic Active Admin?' });
    await expect(one.getByRole('button', { name: 'Keep as is' })).toBeFocused();
    await one.getByRole('button', { name: 'Sign out this session' }).click();
    await expect(page.getByRole('status')).toContainText('The session has ended.');
    await expect(sessions.getByRole('listitem')).toHaveCount(1);

    await page.getByRole('region', { name: 'Actions' }).getByRole('button', { name: 'Sign out everywhere' }).click();
    await page.getByRole('dialog', { name: 'Sign Synthetic Active Admin out everywhere?' }).getByRole('button', { name: 'Sign out everywhere' }).click();
    await expect(page.getByRole('status')).toContainText('Synthetic Active Admin is signed out everywhere.');
    await expect(sessions).toContainText('No active sessions. This person is signed out everywhere.');

    expect(calls.filter((call) => call.method === 'POST').map((call) => [call.path, call.body])).toEqual([
      [`/api/owner/accounts/admin_active/sessions/${'a'.repeat(32)}/revoke`, {}],
      ['/api/owner/accounts/admin_active/sessions/revoke-all', {}],
    ]);
  });

  test('shows a server refusal inside the confirmation and refreshes to the current state', async ({ page }) => {
    let refused = false;
    await stub(
      page,
      ownerApi({
        'GET /api/owner/accounts/admin_active': () => {
          return { body: { account: !refused ? detail() : detail({ state: 'disabled', sessions: [], actions: { disable: { available: false, reason: 'account_not_active' }, enable: { available: true, reason: null }, revokeAllSessions: { available: true, reason: null } } }) } };
        },
        'POST /api/owner/accounts/admin_active/disable': () => {
          // Another window disabled the account first.
          refused = true;
          return { status: 409, body: { error: 'account_not_active' } };
        },
      }),
    );
    await page.goto('/owner/accounts/admin_active');

    await page.getByRole('button', { name: 'Disable account' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Reason (required)').fill('Left the company');
    await dialog.getByRole('button', { name: 'Disable account' }).click();
    await expect(dialog.getByRole('alert')).toContainText('This account is no longer active. The latest details are shown.');
    await dialog.getByRole('button', { name: 'Keep as is' }).click();
    await expect(page.getByRole('region', { name: 'Actions' }).getByRole('button', { name: 'Re-enable account' })).toBeVisible();
  });

  test('treats an ended Owner session during an action as signed out, and a network failure as retryable', async ({ page }) => {
    let failures = 0;
    await stub(
      page,
      ownerApi({
        'POST /api/owner/accounts/admin_active/sessions/revoke-all': () => {
          failures += 1;
          return failures === 1 ? { status: 401, body: { error: 'unauthorized' } } : undefined;
        },
      }),
    );
    await page.goto('/owner/accounts/admin_active');
    await page.getByRole('button', { name: 'Sign out everywhere' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Sign out everywhere' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Your session has ended. Sign in again as the Owner.');

    await page.route('**/api/owner/accounts/admin_active/sessions/revoke-all', (route) => route.abort('connectionreset'));
    await page.getByRole('dialog').getByRole('button', { name: 'Sign out everywhere' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('DROMEX could not be reached.');
  });

  test('keeps a long name, Arabic text, and a long address inside the screen, reading in their own direction', async ({ page }) => {
    await stub(
      page,
      ownerApi({
        'GET /api/owner/accounts/admin_long': {
          body: {
            account: detail({
              userId: 'admin_long',
              name: `${LONG_NAME} ${ARABIC_NAME}`,
              email: 'a.very.long.address.for.layout.testing.only@subdomain.example.test',
              lastStatusChange: { action: 'enabled', reason: `${ARABIC_NAME} — returned to Site 4 after a long period away from the project`, changedAt: '2026-09-29T09:00:00.000Z', changedByName: ARABIC_NAME },
            }),
          },
        },
      }),
    );
    await page.goto('/owner/accounts/admin_long');

    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toContainText(ARABIC_NAME);
    await expect(heading).toHaveAttribute('dir', 'auto');
    await expect(page.getByTestId('account-email')).toHaveAttribute('dir', 'ltr');
    expect(await noHorizontalOverflow(page)).toBe(true);

    await page.getByRole('button', { name: 'Disable account' }).click();
    expect(await noHorizontalOverflow(page)).toBe(true);
    const box = await page.getByRole('dialog').boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
  });

  test('offers a way back to every account and a clear not-found state', async ({ page }) => {
    await stub(page, ownerApi({ 'GET /api/owner/accounts/admin_gone': { status: 404, body: { error: 'not_found' } } }));
    await page.goto('/owner/accounts/admin_gone');

    await expect(page.getByRole('alert')).toContainText('This account is not in account management.');
    await page.getByRole('link', { name: 'All accounts' }).click();
    await expect(page).toHaveURL(/\/owner\/accounts$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Accounts' })).toBeVisible();
  });
});
