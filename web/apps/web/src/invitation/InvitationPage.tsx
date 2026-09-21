import { useEffect, useRef, useState, type FormEvent } from 'react';

import { takeInvitationToken } from './fragment.ts';

/**
 * Admin invitation acceptance (DEC-440, DEC-442, DEC-444). A development
 * preview of the restricted enrolment flow: plain, functional forms only. The
 * designed authentication screens belong to the later UX phase.
 *
 * Secrets are held in memory only, in refs that are cleared when setup ends:
 * the token from the fragment and the password the invitee typed (needed once
 * more only when resuming an already verified authenticator). Nothing is
 * written to browser storage, and every request is a same-origin JSON POST.
 */

type Step =
  | { kind: 'checking' }
  | { kind: 'invalid' }
  | { kind: 'create_password' }
  | { kind: 'confirm_password' }
  | { kind: 'verify_totp'; totpUri: string; manualEntrySecret: string }
  | { kind: 'verify_existing_totp' }
  | { kind: 'recovery_codes'; codes: string[] }
  | { kind: 'done' };

const MESSAGES: Record<string, string> = {
  invitation_invalid: 'This invitation link is no longer valid. Ask the Owner for a new invitation.',
  invalid_name: 'Enter your name, without an email address.',
  password_rejected: 'Choose a password of 15 to 128 characters.',
  invalid_password: 'That password is not correct.',
  invalid_code: 'That code is not correct. Wait for a new code and try again.',
  too_many_requests: 'Too many attempts. Wait a few minutes and try again.',
  setup_in_progress: 'Setup is already running in another window. Try again shortly.',
  setup_incomplete: 'Setup is not finished yet.',
  acknowledgement_required: 'Confirm that you saved your recovery codes.',
  unauthorized: 'Your setup session ended. Open your invitation link again.',
};

async function post(path: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, data };
}

export function InvitationPage() {
  const token = useRef<string | null>(null);
  const password = useRef<string | null>(null);
  const started = useRef(false);
  const [step, setStep] = useState<Step>({ kind: 'checking' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function forget() {
    token.current = null;
    password.current = null;
  }

  function fail(data: Record<string, unknown>) {
    const code = typeof data.error === 'string' ? data.error : '';
    if (code === 'invitation_invalid') {
      forget();
      setStep({ kind: 'invalid' });
    }
    setError(MESSAGES[code] ?? 'Something went wrong. Try again.');
  }

  useEffect(() => {
    // React's development double effect must not read the fragment twice.
    if (started.current) return;
    started.current = true;
    token.current = takeInvitationToken(window.location, window.history);
    if (token.current === null) {
      setStep({ kind: 'invalid' });
      return;
    }
    void post('/api/invitation/inspect', { token: token.current }).then(({ status, data }) => {
      if (status === 200 && (data.next === 'create_password' || data.next === 'confirm_password')) setStep({ kind: data.next });
      else fail(data);
    });
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>, work: (form: FormData) => Promise<void>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work(new FormData(event.currentTarget));
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const onPassword = (event: FormEvent<HTMLFormElement>) =>
    submit(event, async (form) => {
      const typed = String(form.get('password') ?? '');
      if (step.kind === 'create_password' && typed !== String(form.get('confirmation') ?? '')) {
        setError('The two passwords do not match.');
        return;
      }
      const body =
        step.kind === 'create_password'
          ? { token: token.current, name: String(form.get('name') ?? ''), password: typed }
          : { token: token.current, password: typed };
      const { status, data } = await post('/api/invitation/password', body);
      if (status !== 200) return fail(data);
      password.current = typed;
      if (data.next === 'verify_totp' && typeof data.totpUri === 'string' && typeof data.manualEntrySecret === 'string') {
        setStep({ kind: 'verify_totp', totpUri: data.totpUri, manualEntrySecret: data.manualEntrySecret });
      } else if (data.next === 'verify_existing_totp') {
        setStep({ kind: 'verify_existing_totp' });
      } else {
        fail({});
      }
    });

  const onCode = (event: FormEvent<HTMLFormElement>) =>
    submit(event, async (form) => {
      const code = String(form.get('code') ?? '').trim();
      const body = step.kind === 'verify_existing_totp' ? { code, password: password.current, token: token.current } : { code };
      const { status, data } = await post('/api/invitation/totp', body);
      if (status !== 200 || !Array.isArray(data.recoveryCodes)) return fail(data);
      token.current = null;
      password.current = null;
      setStep({ kind: 'recovery_codes', codes: data.recoveryCodes.map(String) });
    });

  const onComplete = (event: FormEvent<HTMLFormElement>) =>
    submit(event, async (form) => {
      if (form.get('saved') !== 'yes') {
        setError(MESSAGES.acknowledgement_required!);
        return;
      }
      const { status, data } = await post('/api/invitation/complete', { recoveryCodesSaved: true });
      if (status !== 200) return fail(data);
      forget();
      setStep({ kind: 'done' });
    });

  return (
    <main className="shell">
      <span className="banner" data-testid="environment-banner">
        Development preview
      </span>
      <h1>Set up your DROMEX account</h1>

      {error !== null && step.kind !== 'invalid' && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}

      {step.kind === 'checking' && <p className="lede">Checking your invitation…</p>}

      {step.kind === 'invalid' && (
        <p className="lede" role="alert">
          {MESSAGES.invitation_invalid}
        </p>
      )}

      {(step.kind === 'create_password' || step.kind === 'confirm_password') && (
        <form className="card form" onSubmit={onPassword}>
          {step.kind === 'create_password' ? (
            <>
              <label>
                Your name
                <input name="name" autoComplete="name" required maxLength={100} />
              </label>
              <label>
                Password (15 to 128 characters)
                <input name="password" type="password" autoComplete="new-password" required minLength={15} maxLength={128} />
              </label>
              <label>
                Confirm password
                <input name="confirmation" type="password" autoComplete="new-password" required minLength={15} maxLength={128} />
              </label>
            </>
          ) : (
            <>
              <p>You started setting up this account earlier. Enter the password you created then.</p>
              <label>
                Password
                <input name="password" type="password" autoComplete="current-password" required maxLength={128} />
              </label>
            </>
          )}
          <button type="submit" disabled={busy}>
            Continue
          </button>
        </form>
      )}

      {(step.kind === 'verify_totp' || step.kind === 'verify_existing_totp') && (
        <form className="card form" onSubmit={onCode}>
          {step.kind === 'verify_totp' ? (
            <>
              <p>Add DROMEX to your authenticator app with this setup key, then enter the six-digit code it shows.</p>
              <p>
                <code data-testid="manual-entry-secret">{step.manualEntrySecret}</code>
              </p>
            </>
          ) : (
            <p>Enter the six-digit code from the authenticator you already added for DROMEX.</p>
          )}
          <label>
            Authenticator code
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required maxLength={6} />
          </label>
          <button type="submit" disabled={busy}>
            Verify
          </button>
        </form>
      )}

      {step.kind === 'recovery_codes' && (
        <form className="card form" onSubmit={onComplete}>
          <p>These recovery codes are shown once. Save them somewhere safe, away from your phone.</p>
          <ol className="codes" data-testid="recovery-codes">
            {step.codes.map((code) => (
              <li key={code}>
                <code>{code}</code>
              </li>
            ))}
          </ol>
          <label className="check">
            <input name="saved" type="checkbox" value="yes" required /> I saved these recovery codes
          </label>
          <button type="submit" disabled={busy}>
            Finish setup
          </button>
        </form>
      )}

      {step.kind === 'done' && (
        <p className="lede" role="status">
          Setup is complete. Sign in with your email, your password, and a code from your authenticator.
        </p>
      )}
    </main>
  );
}
