import { RECOVERY_STRINGS as T } from '../signin/strings.ts';

/**
 * Lost-authenticator guidance (batch 4c, OQ-168). Static: it makes no request
 * and shows the same text to everyone, so it cannot reveal whether an account
 * exists or what role it holds. An Admin has no self-service path; the Owner
 * has the recovery-code path.
 */
export function LostAuthenticatorPage() {
  return (
    <main className="shell">
      <span className="banner" data-testid="environment-banner">
        Development preview
      </span>
      <h1>{T.chooserTitle}</h1>
      <p className="lede">{T.chooserIntro}</p>
      <div className="grid">
        <section className="card" aria-labelledby="owner-heading">
          <h2 id="owner-heading">{T.ownerHeading}</h2>
          <p>{T.ownerBody}</p>
          <p>
            <a className="link" href="/recover-authenticator">
              {T.ownerAction}
            </a>
          </p>
        </section>
        <section className="card" aria-labelledby="admin-heading">
          <h2 id="admin-heading">{T.adminHeading}</h2>
          <p>{T.adminBody}</p>
        </section>
      </div>
      <p className="note">
        <a className="link" href="/sign-in">
          {T.backToSignIn}
        </a>
      </p>
    </main>
  );
}
