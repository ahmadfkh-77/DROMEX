import { useEffect, useRef, useState, type FormEvent } from 'react';

import { signInWithPassword, startReplacement, verifyRecoveryCode, verifyReplacement } from '../signin/api.ts';
import { normalizeCode, passwordOutcome } from '../signin/machine.ts';
import { RECOVERY_STRINGS as T, SIGNIN_STRINGS as S } from '../signin/strings.ts';
import {
  enrolmentOutcome,
  normalizeRecoveryCodeInput,
  recoveryCodeOutcome,
  replacementOutcome,
  type RecoveryFailureKey,
} from './machine.ts';

/**
 * Owner recovery (batch 4c, DEC-436): password, one recovery code, the
 * password again, a new authenticator, then the new recovery codes. The server
 * decides every outcome and ends the recovery on its own failures; nothing
 * here shows progress the server did not confirm. Passwords and codes live
 * only in uncontrolled inputs and are cleared on submit. The setup key and
 * the new recovery codes are held in memory only, shown once, and dropped
 * when the step ends. Nothing is written to storage or the address bar.
 * Only the Owner has a recovery-code path: any other account's attempt ends
 * at the same generic failure.
 */

type Step =
  | { kind: 'password' }
  | { kind: 'code' }
  | { kind: 'replace' }
  | { kind: 'enrol'; manualEntrySecret: string }
  | { kind: 'codes'; recoveryCodes: string[] }
  | { kind: 'done' };

type PageError = { key: RecoveryFailureKey; text: string };

const TOTAL_STEPS = 5;
const POSITION: Record<Step['kind'], number> = { password: 1, code: 2, replace: 3, enrol: 4, codes: 5, done: 5 };

export function OwnerRecoveryPage() {
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [error, setError] = useState<PageError | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const recoveryCodeRef = useRef<HTMLInputElement>(null);
  const totpRef = useRef<HTMLInputElement>(null);

  const limited = secondsLeft !== null && secondsLeft > 0;

  // Each new step takes focus on its own heading, so a keyboard or screen-reader user lands on it.
  useEffect(() => {
    heading.current?.focus();
  }, [step.kind]);

  useEffect(() => {
    if (secondsLeft === null) return;
    if (secondsLeft <= 0) {
      setSecondsLeft(null);
      return;
    }
    const timer = window.setTimeout(() => setSecondsLeft(secondsLeft - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [secondsLeft]);

  function fail(key: RecoveryFailureKey, retryAfterSeconds: number | null, text: string = T.failures[key]) {
    setError({ key, text });
    setSecondsLeft(retryAfterSeconds);
  }

  function startOver() {
    setStep({ kind: 'password' });
    setError(null);
    setSecondsLeft(null);
  }

  /** A failure that ends the server's recovery: back to the first step with the reason shown. */
  function endRecovery(key: RecoveryFailureKey) {
    setStep({ kind: 'password' });
    fail(key, null);
  }

  async function onPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || limited) return;
    const email = (emailRef.current?.value ?? '').trim();
    const password = passwordRef.current?.value ?? '';
    if (email === '' || password === '') return fail('missingFields', null);
    setError(null);
    setBusy(true);
    const outcome = passwordOutcome(await signInWithPassword(email, password));
    setBusy(false);
    if (passwordRef.current) passwordRef.current.value = '';
    if (outcome.kind === 'mfa') {
      setStep({ kind: 'code' });
    } else {
      // The sign-in screen's own wording for a password failure, which is generic by design.
      const key: RecoveryFailureKey = outcome.key === 'rateLimited' ? 'rateLimited' : 'unexpected';
      fail(key, outcome.retryAfterSeconds, outcome.key === 'rateLimited' ? T.failures.rateLimited : S.failures[outcome.key]);
    }
  }

  async function onRecoveryCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || limited) return;
    const code = normalizeRecoveryCodeInput(recoveryCodeRef.current?.value ?? '');
    if (code === null) return fail('recoveryCodeFormat', null);
    setError(null);
    setBusy(true);
    const outcome = recoveryCodeOutcome(await verifyRecoveryCode(code));
    setBusy(false);
    if (recoveryCodeRef.current) recoveryCodeRef.current.value = '';
    if (outcome.kind === 'accepted') setStep({ kind: 'replace' });
    else if (outcome.key === 'codeMayBeUsed') endRecovery(outcome.key);
    else fail(outcome.key, outcome.retryAfterSeconds);
  }

  async function onReplace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || limited) return;
    const password = passwordRef.current?.value ?? '';
    if (password === '') return fail('missingFields', null);
    setError(null);
    setBusy(true);
    const outcome = enrolmentOutcome(await startReplacement(password));
    setBusy(false);
    if (passwordRef.current) passwordRef.current.value = '';
    if (outcome.kind === 'enrol') setStep({ kind: 'enrol', manualEntrySecret: outcome.manualEntrySecret });
    else if (outcome.key === 'recoveryEnded') endRecovery(outcome.key);
    else fail(outcome.key, outcome.retryAfterSeconds);
  }

  async function onTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || limited) return;
    const code = normalizeCode(totpRef.current?.value ?? '');
    if (code === null) return fail('codeFormat', null);
    setError(null);
    setBusy(true);
    const outcome = replacementOutcome(await verifyReplacement(code));
    setBusy(false);
    if (totpRef.current) totpRef.current.value = '';
    if (outcome.kind === 'completed') setStep({ kind: 'codes', recoveryCodes: outcome.recoveryCodes });
    else if (outcome.key === 'recoveryEnded') endRecovery(outcome.key);
    else fail(outcome.key, outcome.retryAfterSeconds);
  }

  function onFinish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = (event.currentTarget.elements.namedItem('saved') as HTMLInputElement | null)?.checked === true;
    if (!saved) return setError({ key: 'unexpected', text: T.codesSavedRequired });
    setError(null);
    setStep({ kind: 'done' });
  }

  const titles: Record<Step['kind'], string> = {
    password: T.passwordStepTitle,
    code: T.codeStepTitle,
    replace: T.replaceTitle,
    enrol: T.enrolTitle,
    codes: T.codesTitle,
    done: T.finishedTitle,
  };

  const alert =
    error === null ? null : (
      <div className="alert" role="alert" id="recovery-error">
        <p>{error.text}</p>
      </div>
    );
  const timer = limited ? (
    <p className="hint" role="timer">
      {T.retryIn(secondsLeft)}
    </p>
  ) : null;
  const describedBy = error === null ? undefined : 'recovery-error';

  return (
    <main className="shell">
      <span className="banner" data-testid="environment-banner">
        Development preview
      </span>
      <h1>{T.recoverTitle}</h1>
      <p className="lede">{T.recoverIntro}</p>
      {step.kind !== 'done' && <p className="hint">{T.recoverStepLabel(POSITION[step.kind], TOTAL_STEPS)}</p>}
      <h2 ref={heading} tabIndex={-1}>
        {titles[step.kind]}
      </h2>

      {step.kind === 'password' && (
        <form key="password" className="card form" onSubmit={onPassword} aria-busy={busy} noValidate>
          {alert}
          {timer}
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
              aria-describedby={describedBy}
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
              aria-describedby={describedBy}
            />
          </label>
          <button type="submit" disabled={busy || limited}>
            {busy ? T.checking : T.continue}
          </button>
          <p className="hint">{T.timeLimit}</p>
        </form>
      )}

      {step.kind === 'code' && (
        <form key="code" className="card form" onSubmit={onRecoveryCode} aria-busy={busy} noValidate>
          <p>{T.codeStepIntro}</p>
          {alert}
          {timer}
          <label>
            {T.recoveryCodeLabel}
            <input
              ref={recoveryCodeRef}
              name="recoveryCode"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              dir="ltr"
              maxLength={64}
              aria-describedby={describedBy ?? 'recovery-code-hint'}
            />
          </label>
          <p className="hint" id="recovery-code-hint">
            {T.recoveryCodeHint}
          </p>
          <button type="submit" disabled={busy || limited}>
            {busy ? T.checking : T.continue}
          </button>
          <button type="button" className="secondary" onClick={startOver} disabled={busy}>
            {T.startOver}
          </button>
        </form>
      )}

      {step.kind === 'replace' && (
        <form key="replace" className="card form" onSubmit={onReplace} aria-busy={busy} noValidate>
          <p>{T.replaceIntro}</p>
          {alert}
          {timer}
          <label>
            {T.passwordLabel}
            <input
              ref={passwordRef}
              name="password"
              type="password"
              autoComplete="current-password"
              dir="ltr"
              maxLength={128}
              aria-describedby={describedBy}
            />
          </label>
          <button type="submit" disabled={busy || limited}>
            {busy ? T.checking : T.setUpAuthenticator}
          </button>
        </form>
      )}

      {step.kind === 'enrol' && (
        <form key="enrol" className="card form" onSubmit={onTotp} aria-busy={busy} noValidate>
          <p>{T.enrolIntro}</p>
          <p>
            {T.setupKeyLabel}: <code data-testid="manual-entry-secret">{step.manualEntrySecret}</code>
          </p>
          {alert}
          {timer}
          <label>
            {T.authenticatorCodeLabel}
            <input
              ref={totpRef}
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={16}
              aria-describedby={describedBy}
            />
          </label>
          <button type="submit" disabled={busy || limited}>
            {busy ? T.verifying : T.verify}
          </button>
        </form>
      )}

      {step.kind === 'codes' && (
        <form key="codes" className="card form" onSubmit={onFinish} noValidate>
          <p>{T.codesIntro}</p>
          {alert}
          <ol className="codes" data-testid="recovery-codes">
            {step.recoveryCodes.map((code) => (
              <li key={code}>
                <code>{code}</code>
              </li>
            ))}
          </ol>
          <label className="check">
            <input name="saved" type="checkbox" /> {T.codesSavedLabel}
          </label>
          <button type="submit">{T.finish}</button>
        </form>
      )}

      {step.kind === 'done' && (
        <div className="card form" role="status">
          <p>{T.finished}</p>
          <p>
            <a className="link" href="/sign-in">
              {T.signIn}
            </a>
          </p>
        </div>
      )}
    </main>
  );
}
