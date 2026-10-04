import { useEffect, useRef, useState, type FormEvent } from 'react';

import { takeFragmentToken } from '../security/fragment-token.ts';
import { postJson } from './api.ts';
import { RESET_STRINGS as T } from './strings.ts';

/**
 * Choosing a new password from a reset link (DEC-441, DEC-442, DEC-487).
 *
 * The token is read from the fragment once, removed from the address bar and
 * history before any request, kept only in a ref, and sent only in a
 * same-origin POST body. It survives a network error, so the user can retry,
 * and is forgotten as soon as the link is known to be unusable or the reset
 * completes. Nothing is written to browser storage. Success never signs the
 * user in: the page says to sign in with the new password and an
 * authenticator code.
 */

type Step =
  | { kind: 'checking' }
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'choose'; error: string | null }
  | { kind: 'failed' }
  | { kind: 'done' };

const REJECTED: Record<string, string> = { too_short: T.tooShort, too_long: T.tooLong, common: T.common };

export function ResetPasswordPage() {
  const token = useRef<string | null>(null);
  const started = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState<Step>({ kind: 'checking' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // React's development double effect must not read the fragment twice.
    if (started.current) return;
    started.current = true;
    token.current = takeFragmentToken(window.location, window.history);
    if (token.current === null) {
      setStep({ kind: 'missing' });
      return;
    }
    void postJson('/api/password-reset/inspect', { token: token.current }).then(({ status, data }) => {
      if (status === 200 && data.next === 'choose_password') setStep({ kind: 'choose', error: null });
      else if (status === 429) setStep({ kind: 'choose', error: T.rateLimited });
      else if (status === 0) setStep({ kind: 'choose', error: T.network });
      else {
        token.current = null;
        setStep({ kind: 'invalid' });
      }
    });
  }, []);

  // Move focus to the heading whenever the step changes, for screen readers.
  useEffect(() => {
    if (step.kind !== 'checking' && step.kind !== 'choose') heading.current?.focus();
  }, [step.kind]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || token.current === null) return;
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get('password') ?? '');
    if (newPassword !== String(form.get('confirmation') ?? '')) return setStep({ kind: 'choose', error: T.mismatch });
    if (newPassword.length < 15) return setStep({ kind: 'choose', error: T.tooShort });
    if (newPassword.length > 128) return setStep({ kind: 'choose', error: T.tooLong });

    setBusy(true);
    setStep({ kind: 'choose', error: null });
    const { status, data } = await postJson('/api/password-reset/complete', { token: token.current, newPassword });
    setBusy(false);

    if (status === 200 && data.signInRequired === true) {
      token.current = null;
      setStep({ kind: 'done' });
    } else if (status === 400 && data.error === 'password_rejected') {
      setStep({ kind: 'choose', error: REJECTED[String(data.reason)] ?? T.unexpected });
    } else if (status === 400 && data.error === 'reset_link_invalid') {
      token.current = null;
      setStep({ kind: 'invalid' });
    } else if (status === 500 && data.error === 'reset_failed') {
      token.current = null;
      setStep({ kind: 'failed' });
    } else if (status === 429) {
      setStep({ kind: 'choose', error: T.rateLimited });
    } else if (status === 0) {
      setStep({ kind: 'choose', error: T.network });
    } else {
      setStep({ kind: 'choose', error: T.unexpected });
    }
  }

  const title = step.kind === 'done' ? T.doneTitle : T.resetTitle;

  return (
    <main className="shell">
      <span className="banner" data-testid="environment-banner">
        Development preview
      </span>
      <h1 ref={heading} tabIndex={-1}>
        {title}
      </h1>

      {step.kind === 'checking' && (
        <p className="lede" role="status">
          {T.checking}
        </p>
      )}

      {(step.kind === 'missing' || step.kind === 'invalid' || step.kind === 'failed') && (
        <div role="alert">
          <p className="lede">{step.kind === 'missing' ? T.missing : step.kind === 'invalid' ? T.invalidLink : T.failed}</p>
          <p>
            <a className="link" href="/forgot-password">
              {T.requestAnother}
            </a>
          </p>
        </div>
      )}

      {step.kind === 'choose' && (
        <form className="card form" onSubmit={onSubmit} aria-busy={busy} noValidate>
          {step.error !== null && (
            <p className="alert" role="alert" id="reset-error">
              {step.error}
            </p>
          )}
          <label>
            {T.passwordLabel}
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              dir="auto"
              required
              minLength={15}
              maxLength={128}
              aria-describedby={step.error !== null ? 'reset-hint reset-error' : 'reset-hint'}
            />
          </label>
          <p className="hint" id="reset-hint">
            {T.passwordHint}
          </p>
          <label>
            {T.confirmLabel}
            <input name="confirmation" type="password" autoComplete="new-password" dir="auto" required minLength={15} maxLength={128} />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? T.saving : T.save}
          </button>
        </form>
      )}

      {step.kind === 'done' && (
        <p className="lede" role="status">
          {T.done}
        </p>
      )}

      <p className="note">{T.guidance}</p>
    </main>
  );
}
