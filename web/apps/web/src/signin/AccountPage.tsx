import { useEffect, useRef, useState } from 'react';

import { getSession, signOut } from './api.ts';
import { sessionOutcome, signOutOutcome, type FailureKey } from './machine.ts';
import { SIGNIN_STRINGS as T } from './strings.ts';

/**
 * The minimal account and security page (SI-1a). It shows only what
 * `GET /api/session` returns: name, email, and whether the server says the
 * account is the Owner. It never presents a role the server did not state.
 * A signed-out visitor is sent to sign-in; a session that ends while the page
 * is open is shown as ended; sign-out is shown only after the server confirms.
 */

type State =
  | { kind: 'loading' }
  | { kind: 'active'; name: string; email: string; isOwner: boolean }
  | { kind: 'ended' }
  | { kind: 'signedOut' }
  | { kind: 'error'; key: FailureKey };

export function AccountPage() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let cancelled = false;
    void getSession().then((result) => {
      if (cancelled) return;
      const outcome = sessionOutcome(result);
      if (outcome.kind === 'ended') window.location.replace('/sign-in');
      else if (outcome.kind === 'active') setState(outcome);
      else setState({ kind: 'error', key: outcome.key });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-check when the tab regains focus, so an ended session is not left looking signed in.
  const active = state.kind === 'active';
  useEffect(() => {
    if (!active) return;
    function recheck() {
      void getSession().then((result) => {
        const outcome = sessionOutcome(result);
        if (outcome.kind === 'ended') setState({ kind: 'ended' });
        else if (outcome.kind === 'active') setState(outcome);
      });
    }
    window.addEventListener('focus', recheck);
    return () => window.removeEventListener('focus', recheck);
  }, [active]);

  useEffect(() => {
    if (state.kind === 'signedOut' || state.kind === 'ended') heading.current?.focus();
  }, [state.kind]);

  async function onSignOut() {
    if (busy) return;
    setBusy(true);
    setSignOutError(false);
    const outcome = signOutOutcome(await signOut());
    setBusy(false);
    if (outcome.kind === 'signedOut') setState({ kind: 'signedOut' });
    else setSignOutError(true);
  }

  const title =
    state.kind === 'signedOut' ? T.signedOutTitle : state.kind === 'ended' ? T.endedTitle : T.accountTitle;

  return (
    <main className="shell">
      <span className="banner" data-testid="environment-banner">
        Development preview
      </span>
      <h1 ref={heading} tabIndex={-1}>
        {title}
      </h1>

      {state.kind === 'loading' && (
        <p role="status" className="lede">
          {T.loading}
        </p>
      )}

      {state.kind === 'error' && (
        <p className="alert" role="alert">
          {T.failures[state.key]}
        </p>
      )}

      {state.kind === 'active' && (
        <section className="card form">
          <dl className="facts">
            <div>
              <dt>{T.nameLabel}</dt>
              <dd className="wrap">{state.name}</dd>
            </div>
            <div>
              <dt>{T.emailRowLabel}</dt>
              <dd className="wrap" dir="ltr">
                {state.email}
              </dd>
            </div>
            <div>
              <dt>{T.roleLabel}</dt>
              <dd>{state.isOwner ? T.roleOwner : T.roleAdmin}</dd>
            </div>
          </dl>
          {state.isOwner && (
            <p>
              <a className="link" href="/owner/accounts">
                {T.manageAccounts}
              </a>
            </p>
          )}
          {signOutError && (
            <p className="alert" role="alert">
              {T.signOutFailed}
            </p>
          )}
          <button type="button" onClick={onSignOut} disabled={busy} aria-busy={busy}>
            {busy ? T.signingOut : T.signOut}
          </button>
        </section>
      )}

      {(state.kind === 'signedOut' || state.kind === 'ended') && (
        <div role="status">
          <p className="lede">{state.kind === 'signedOut' ? T.signedOutBody : T.endedBody}</p>
          <p>
            <a className="link" href="/sign-in">
              {T.signInAgain}
            </a>
          </p>
        </div>
      )}

      <p className="note">{T.guidance}</p>
    </main>
  );
}
