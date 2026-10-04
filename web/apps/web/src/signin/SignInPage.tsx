import { useEffect, useRef, useState, type FormEvent } from 'react';

import { signInWithPassword, verifyCode } from './api.ts';
import { codeOutcome, normalizeCode, passwordOutcome, type FailureKey } from './machine.ts';
import { SIGNIN_STRINGS as T } from './strings.ts';

/**
 * Sign-in (SI-1a): a password step, then the authenticator-code step. The
 * server decides every outcome; nothing here shows "signed in" until it
 * answers `authenticated: true`. Passwords and codes live only in the
 * uncontrolled inputs and are cleared on submit, on error and on leaving the
 * step. Nothing is written to storage or the address bar.
 */

type Step = 'password' | 'code';
type PageError = FailureKey | 'missingFields';
type FocusTarget = 'email' | 'password' | 'code' | null;

export function SignInPage() {
  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<PageError | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ target: FocusTarget; nonce: number }>({ target: null, nonce: 0 });
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const limited = secondsLeft !== null && secondsLeft > 0;

  function focus(target: FocusTarget) {
    setFocusRequest((current) => ({ target, nonce: current.nonce + 1 }));
  }

  // Focus after the render that shows the new step or error, so it lands on a mounted field.
  useEffect(() => {
    const { target } = focusRequest;
    if (target === 'email') emailRef.current?.focus();
    if (target === 'password') passwordRef.current?.focus();
    if (target === 'code') codeRef.current?.focus();
  }, [focusRequest]);

  useEffect(() => {
    if (secondsLeft === null) return;
    if (secondsLeft <= 0) {
      setSecondsLeft(null);
      return;
    }
    const timer = window.setTimeout(() => setSecondsLeft(secondsLeft - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [secondsLeft]);

  function fail(key: PageError, retryAfterSeconds: number | null, target: FocusTarget) {
    setError(key);
    setSecondsLeft(retryAfterSeconds);
    focus(target);
  }

  async function onPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || limited) return;
    const typedEmail = (emailRef.current?.value ?? '').trim();
    const password = passwordRef.current?.value ?? '';
    if (typedEmail === '' || password === '') {
      fail('missingFields', null, typedEmail === '' ? 'email' : 'password');
      return;
    }
    setEmail(typedEmail);
    setError(null);
    setBusy(true);
    const outcome = passwordOutcome(await signInWithPassword(typedEmail, password));
    setBusy(false);
    if (passwordRef.current) passwordRef.current.value = '';
    if (outcome.kind === 'mfa') {
      setStep('code');
      focus('code');
    } else {
      fail(outcome.key, outcome.retryAfterSeconds, 'password');
    }
  }

  async function onCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || limited) return;
    const code = normalizeCode(codeRef.current?.value ?? '');
    if (code === null) {
      fail('codeFormat', null, 'code');
      return;
    }
    setError(null);
    setBusy(true);
    const outcome = codeOutcome(await verifyCode(code));
    if (codeRef.current) codeRef.current.value = '';
    if (outcome.kind === 'signedIn') {
      // The server has confirmed. A full navigation drops all page state, and
      // `replace` keeps the sign-in form out of the back-button history.
      window.location.replace('/account');
      return;
    }
    setBusy(false);
    fail(outcome.key, outcome.retryAfterSeconds, 'code');
  }

  function startOver() {
    setStep('password');
    setError(null);
    setSecondsLeft(null);
    focus('password');
  }

  const errorText = error === null ? null : T.failures[error];

  return (
    <main className="shell">
      <span className="banner" data-testid="environment-banner">
        Development preview
      </span>
      <h1>{step === 'password' ? T.signInTitle : T.codeTitle}</h1>

      {step === 'password' ? (
        <form key="password-step" className="card form" onSubmit={onPassword} aria-busy={busy} noValidate>
          <p>{T.signInIntro}</p>
          {errorText !== null && (
            <div className="alert" role="alert" id="signin-error">
              <p>{errorText}</p>
              {error === 'alreadySignedIn' && (
                <p>
                  <a className="link" href="/account">
                    {T.goToAccount}
                  </a>
                </p>
              )}
            </div>
          )}
          {limited && (
            <p className="hint" role="timer">
              {T.retryIn(secondsLeft)}
            </p>
          )}
          <label>
            {T.emailLabel}
            <input
              ref={emailRef}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              dir="ltr"
              maxLength={320}
              defaultValue={email}
              aria-describedby={errorText !== null ? 'signin-error' : undefined}
            />
          </label>
          <label>
            {T.passwordLabel}
            <input
              ref={passwordRef}
              name="password"
              type="password"
              autoComplete="current-password"
              dir="ltr"
              maxLength={1024}
              aria-invalid={error === 'invalidCredentials'}
              aria-describedby={errorText !== null ? 'signin-error' : undefined}
            />
          </label>
          <button type="submit" disabled={busy || limited}>
            {busy ? T.checking : T.continue}
          </button>
          <p>
            <a className="link" href="/forgot-password">
              {T.forgotPassword}
            </a>
          </p>
        </form>
      ) : (
        <form key="code-step" className="card form" onSubmit={onCode} aria-busy={busy} noValidate>
          <p className="wrap">{T.codeIntro(email)}</p>
          {errorText !== null && (
            <div className="alert" role="alert" id="signin-error">
              <p>{errorText}</p>
            </div>
          )}
          {limited && (
            <p className="hint" role="timer">
              {T.retryIn(secondsLeft)}
            </p>
          )}
          <label>
            {T.codeLabel}
            <input
              ref={codeRef}
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={16}
              aria-invalid={error === 'invalidCode' || error === 'codeFormat'}
              aria-describedby={errorText !== null ? 'signin-error' : undefined}
            />
          </label>
          <button type="submit" disabled={busy || limited}>
            {busy ? T.verifying : T.verify}
          </button>
          <button type="button" className="secondary" onClick={startOver} disabled={busy}>
            {T.startOver}
          </button>
        </form>
      )}

      <p className="note">{T.guidance}</p>
    </main>
  );
}
