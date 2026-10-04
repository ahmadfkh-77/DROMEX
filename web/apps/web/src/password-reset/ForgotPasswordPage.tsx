import { useEffect, useRef, useState, type FormEvent } from 'react';

import { postJson } from './api.ts';
import { RESET_STRINGS as T } from './strings.ts';

/**
 * Password reset request (DEC-441, DEC-487 (5)). A development preview of the
 * flow: plain and functional; the designed screens belong to the later UX
 * phase. The response is the same for every address, so the page shows one
 * neutral confirmation and never says whether an account exists.
 */

type State = { kind: 'form'; error: string | null } | { kind: 'sent' };

export function ForgotPasswordPage() {
  const [state, setState] = useState<State>({ kind: 'form', error: null });
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  // Move focus to the heading when the page's state changes, for screen readers.
  useEffect(() => {
    if (state.kind === 'sent') heading.current?.focus();
  }, [state.kind]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
    if (email === '') {
      setState({ kind: 'form', error: T.invalidEmail });
      return;
    }
    setBusy(true);
    setState({ kind: 'form', error: null });
    const { status } = await postJson('/api/password-reset/request', { email });
    setBusy(false);
    if (status === 202) setState({ kind: 'sent' });
    else if (status === 429) setState({ kind: 'form', error: T.rateLimited });
    else if (status === 0) setState({ kind: 'form', error: T.network });
    else if (status === 400) setState({ kind: 'form', error: T.invalidEmail });
    else setState({ kind: 'form', error: T.unexpected });
  }

  return (
    <main className="shell">
      <span className="banner" data-testid="environment-banner">
        Development preview
      </span>
      <h1 ref={heading} tabIndex={-1}>
        {state.kind === 'sent' ? T.sentTitle : T.forgotTitle}
      </h1>

      {state.kind === 'sent' ? (
        <div role="status">
          <p className="lede">{T.sent}</p>
          <p className="hint">{T.sentNote}</p>
        </div>
      ) : (
        <form className="card form" onSubmit={onSubmit} aria-busy={busy} noValidate>
          <p>{T.forgotIntro}</p>
          {state.error !== null && (
            <p className="alert" role="alert" id="forgot-error">
              {state.error}
            </p>
          )}
          <label>
            {T.emailLabel}
            <input
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              dir="ltr"
              required
              maxLength={320}
              aria-invalid={state.error === T.invalidEmail}
              aria-describedby={state.error !== null ? 'forgot-error' : undefined}
            />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? T.sending : T.sendLink}
          </button>
        </form>
      )}

      <p className="note">{T.guidance}</p>
    </main>
  );
}
