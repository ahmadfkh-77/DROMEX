import type { ComponentType } from 'react';

import { AccountsPage } from './accounts/AccountsPage.tsx';
import { InvitationPage } from './invitation/InvitationPage.tsx';
import { ForgotPasswordPage } from './password-reset/ForgotPasswordPage.tsx';
import { ResetPasswordPage } from './password-reset/ResetPasswordPage.tsx';
import { AccountPage as SessionAccountPage } from './signin/AccountPage.tsx';
import { SignInPage } from './signin/SignInPage.tsx';

const STYLES = `
  :root {
    --signal-orange: #c84b31;
    --structural-navy: #173f67;
    --ledger-cream: #f5f2ec;
    --surface: #ffffff;
    --ink: #17212b;
    --line: #ddd7cc;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--ledger-cream);
    color: var(--ink);
    font-family: system-ui, -apple-system, 'Segoe UI', Arial, sans-serif;
    line-height: 1.5;
  }
  .shell { max-width: 52rem; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; }
  .banner {
    display: inline-block;
    background: var(--signal-orange);
    color: #fff;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 0.35rem 0.75rem;
    border-radius: 999px;
  }
  h1 {
    font-size: clamp(1.75rem, 5vw, 2.5rem);
    line-height: 1.15;
    margin: 1rem 0 0.5rem;
    color: var(--structural-navy);
  }
  .lede { margin: 0 0 2rem; font-size: 1.0625rem; max-width: 42rem; }
  .grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr)); }
  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-left: 3px solid var(--structural-navy);
    border-radius: 0.25rem;
    padding: 1rem 1.1rem;
    min-width: 0;
  }
  .card h2 { font-size: 0.75rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--structural-navy); margin: 0 0 0.5rem; }
  .card p { margin: 0; font-size: 0.9375rem; }
  code {
    font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
    background: var(--ledger-cream);
    border: 1px solid var(--line);
    border-radius: 0.2rem;
    padding: 0.1rem 0.35rem;
    font-size: 0.875em;
    overflow-wrap: anywhere;
  }
  .note {
    margin-top: 2rem;
    border-top: 1px solid var(--line);
    padding-top: 1rem;
    font-size: 0.875rem;
  }
  .form { display: grid; gap: 1rem; max-width: 32rem; }
  .form p { margin: 0; }
  .form label { display: grid; gap: 0.35rem; font-weight: 600; font-size: 0.9375rem; }
  .form input:not([type='checkbox']) {
    font: inherit;
    min-height: 2.75rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--line);
    border-radius: 0.25rem;
    background: var(--surface);
    color: var(--ink);
    width: 100%;
  }
  .form .check { display: flex; gap: 0.5rem; align-items: center; font-weight: 400; }
  .form .check input { width: 1.25rem; height: 1.25rem; }
  .form button {
    font: inherit;
    font-weight: 700;
    min-height: 2.75rem;
    border: 0;
    border-radius: 0.25rem;
    background: var(--structural-navy);
    color: #fff;
    cursor: pointer;
  }
  .form button:disabled { opacity: 0.6; cursor: progress; }
  .codes { margin: 0; padding-inline-start: 1.5rem; display: grid; gap: 0.35rem; }
  .hint { margin: 0; font-size: 0.875rem; color: var(--ink); opacity: 0.8; }
  .link { color: var(--structural-navy); font-weight: 700; text-underline-offset: 0.2em; }
  .link:focus-visible, .form button:focus-visible, .form input:focus-visible, h1:focus-visible {
    outline: 3px solid var(--signal-orange);
    outline-offset: 2px;
  }
  h1:focus { outline: none; }
  .alert {
    border-left: 3px solid var(--signal-orange);
    background: var(--surface);
    padding: 0.75rem 1rem;
    margin: 0 0 1rem;
  }
  .alert p { margin: 0; }
  .alert p + p { margin-top: 0.5rem; }
  .wrap { overflow-wrap: anywhere; }
  .form button.secondary { background: var(--surface); color: var(--structural-navy); border: 2px solid var(--structural-navy); }
  .facts { display: grid; gap: 0.75rem; margin: 0; }
  .facts div { min-width: 0; }
  .facts dt { font-size: 0.75rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--structural-navy); }
  .facts dd { margin: 0; }
`;

/** The other paths the preview serves: invitation and password reset (DEC-442). */
const PAGES: Record<string, ComponentType> = {
  '/sign-in': SignInPage,
  '/account': SessionAccountPage,
  '/invitation': InvitationPage,
  '/forgot-password': ForgotPasswordPage,
  '/reset-password': ResetPasswordPage,
};

/** Owner account management (checkpoint 4E): the list and one account per path. */
function isAccountsPath(pathname: string): boolean {
  return pathname === '/owner/accounts' || pathname === '/owner/accounts/' || pathname.startsWith('/owner/accounts/');
}

export function App() {
  const Page = isAccountsPath(window.location.pathname) ? AccountsPage : PAGES[window.location.pathname];
  if (Page !== undefined) {
    return (
      <>
        <style>{STYLES}</style>
        <Page />
      </>
    );
  }

  return (
    <>
      <style>{STYLES}</style>
      <main className="shell">
        <span className="banner" data-testid="environment-banner">
          Development preview
        </span>
        <h1>DROMEX Web</h1>
        <p className="lede">
          This page confirms the local web foundation runs. It is not the product, and
          nothing here reads or writes real business records.
        </p>

        <div className="grid">
          <section className="card">
            <h2>Liveness</h2>
            <p>
              <code>GET /health</code> reports whether the process is running. It never
              consults the database.
            </p>
          </section>
          <section className="card">
            <h2>Readiness</h2>
            <p>
              <code>GET /ready</code> verifies PostgreSQL answers, and returns 503 with a
              generic body when it does not.
            </p>
          </section>
          <section className="card">
            <h2>Sign-in</h2>
            <p>
              Email, password, and a code from your authenticator app. No real account
              exists yet.{' '}
              <a className="link" href="/sign-in">
                Sign in
              </a>{' '}
              <a className="link" href="/forgot-password">
                Forgot password?
              </a>
            </p>
          </section>
          <section className="card">
            <h2>Accounts</h2>
            <p>
              For the Owner: Admin accounts, invitations, and sessions.{' '}
              <a className="link" href="/owner/accounts">
                Open accounts
              </a>
            </p>
          </section>
        </div>

        <p className="note">
          Android remains the working application and is unaffected by anything here.
        </p>
      </main>
    </>
  );
}
