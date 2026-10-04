import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';

import {
  USER_ID,
  accountPath,
  getJson,
  isAccountDetail,
  isAccountList,
  postJson,
  type AccountDetail,
  type AccountState,
  type AccountSummary,
  type ApiResult,
  type InvitationEntry,
  type InvitationSnapshot,
} from './api.ts';
import { ConfirmDialog, type ConfirmRequest } from './ConfirmDialog.tsx';
import { BackIcon, ChevronIcon, StateIcon } from './icons.tsx';
import { ACCOUNT_STYLES } from './styles.ts';
import { DELIVERY_LABEL, ERRORS, STATE_HINT, STATE_LABEL, T, UNAVAILABLE } from './strings.ts';

/**
 * Owner account management (checkpoint 4E): the Accounts list at
 * `/owner/accounts` and one account at `/owner/accounts/<id>`.
 *
 * Nothing here is an authorization boundary (DEC-428): the page asks the API,
 * which admits only the MFA-complete Owner and re-checks inside every action.
 * The page only avoids asking for what the session cannot have, and shows
 * what the API returned: no token, session identifier, address, device
 * detail, or invented activity time ever reaches it.
 */

const LIST_PATH = '/owner/accounts';

type Session = { kind: 'checking' } | { kind: 'signed_out' } | { kind: 'not_owner' } | { kind: 'failed' } | { kind: 'owner' };

function routeOf(pathname: string): { kind: 'list' } | { kind: 'detail'; userId: string } {
  const rest = pathname.replace(/\/+$/, '').slice(LIST_PATH.length);
  if (rest === '') return { kind: 'list' };
  let userId = '';
  try {
    userId = decodeURIComponent(rest.slice(1));
  } catch {
    userId = '';
  }
  return { kind: 'detail', userId };
}

const DATE_TIME = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

function When({ iso }: { iso: string }) {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? <time dateTime={iso}>{DATE_TIME.format(date)}</time> : <>{T.notRecorded}</>;
}

/** The message for a failed request; `code` is the API's fixed error code. A failed read changed nothing. */
function messageFor(result: ApiResult, read = false): string {
  if (result.status === 0) return ERRORS.network!;
  if (read && result.status >= 500) return ERRORS.load_failed!;
  if (result.status === 401) return ERRORS.unauthorized!;
  if (result.status === 403) return ERRORS.forbidden!;
  if (result.status === 429) return ERRORS.too_many_requests!;
  const code = typeof result.data.error === 'string' ? result.data.error : '';
  return ERRORS[code] ?? ERRORS.unexpected!;
}

function StateBadge({ state }: { state: AccountState }) {
  return (
    <span className={`badge badge-${state}`} data-testid="state-badge">
      <StateIcon state={state} />
      {STATE_LABEL[state]}
    </span>
  );
}

function Notice({ tone, title, children, action }: { tone: 'info' | 'error'; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`notice notice-${tone === 'error' ? 'error' : 'info'}`} role={tone === 'error' ? 'alert' : undefined}>
      <p className="notice-title">{title}</p>
      {children}
      {action}
    </div>
  );
}

export function AccountsPage() {
  const [pathname, setPathname] = useState(window.location.pathname);
  const [session, setSession] = useState<Session>({ kind: 'checking' });
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    let live = true;
    void getJson('/api/session').then((result) => {
      if (!live) return;
      if (result.status === 200) setSession(result.data.isOwner === true ? { kind: 'owner' } : { kind: 'not_owner' });
      else if (result.status === 401) setSession({ kind: 'signed_out' });
      else setSession({ kind: 'failed' });
    });
    return () => {
      live = false;
    };
  }, []);

  const navigate = useCallback((to: string) => {
    window.history.pushState(null, '', to);
    setAnnouncement('');
    setPathname(to);
  }, []);

  const route = routeOf(pathname);

  let content: ReactNode;
  if (session.kind === 'checking') {
    content = <ListSkeleton label={T.loading} />;
  } else if (session.kind === 'signed_out') {
    content = <Gate title={T.signInTitle} text={T.signIn} />;
  } else if (session.kind === 'not_owner') {
    content = <Gate title={T.notOwnerTitle} text={T.notOwner} />;
  } else if (session.kind === 'failed') {
    content = <Gate title={T.loadFailedTitle} text={ERRORS.load_failed!} />;
  } else if (route.kind === 'list') {
    content = <AccountList navigate={navigate} announce={setAnnouncement} />;
  } else {
    content = <AccountView key={route.userId} userId={route.userId} navigate={navigate} announce={setAnnouncement} />;
  }

  return (
    <>
      <style>{ACCOUNT_STYLES}</style>
      <main className="accounts">
        <span className="banner" data-testid="environment-banner">
          Development preview
        </span>
        <p className="live" role="status" aria-live="polite">
          {announcement}
        </p>
        {content}
      </main>
    </>
  );
}

function Gate({ title, text }: { title: string; text: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section className="gate">
      <h1 ref={heading} tabIndex={-1}>
        {title}
      </h1>
      <p className="lede">{text}</p>
      <a className="text-link" href="/">
        DROMEX Web home
      </a>
    </section>
  );
}

function ListSkeleton({ label }: { label: string }) {
  return (
    <div className="skeleton" aria-busy="true">
      <span className="visually-hidden">{label}</span>
      {[0, 1, 2].map((row) => (
        <div className="skeleton-row" key={row} aria-hidden="true">
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

type ListData = { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ready'; accounts: AccountSummary[]; invitations: InvitationEntry[] };

function AccountList({ navigate, announce }: { navigate: (to: string) => void; announce: (text: string) => void }) {
  const [data, setData] = useState<ListData>({ kind: 'loading' });
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    const result = await getJson('/api/owner/accounts');
    if (result.status === 200 && isAccountList(result.data)) {
      setData({ kind: 'ready', accounts: result.data.accounts, invitations: result.data.invitations });
    } else {
      setData({ kind: 'failed', message: messageFor(result, true) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function invitationAction(entry: InvitationEntry, action: 'resend' | 'cancel'): Promise<string | null> {
    setActionError(null);
    const result = await postJson(`/api/owner/invitations/${encodeURIComponent(entry.invitationId)}/${action}`, {});
    if (result.status !== 200) {
      await load();
      return messageFor(result);
    }
    announce(action === 'resend' ? T.done.resent(entry.email) : T.done.cancelled(entry.email));
    await load();
    return null;
  }

  async function resend(entry: InvitationEntry) {
    const failure = await invitationAction(entry, 'resend');
    if (failure !== null) setActionError(failure);
  }

  return (
    <>
      <header className="page-head">
        <h1 ref={heading} tabIndex={-1}>
          {T.title}
        </h1>
        <p className="lede">{T.lede}</p>
      </header>

      {data.kind === 'loading' && <ListSkeleton label={T.loading} />}

      {data.kind === 'failed' && (
        <Notice
          tone="error"
          title={T.loadFailedTitle}
          action={
            <button type="button" className="button button-quiet" onClick={() => void (setData({ kind: 'loading' }), load())}>
              {T.retry}
            </button>
          }
        >
          <p>{data.message}</p>
        </Notice>
      )}

      {data.kind === 'ready' && (
        <>
          {actionError !== null && (
            <p className="notice notice-error" role="alert">
              {actionError}
            </p>
          )}

          <section className="ledger-section" aria-labelledby="admins-heading">
            <h2 id="admins-heading">{T.adminsHeading}</h2>
            {data.accounts.length === 0 ? (
              <p className="empty">{T.adminsEmpty}</p>
            ) : (
              <ul className="ledger">
                {data.accounts.map((account) => (
                  <li key={account.userId} className="ledger-row">
                    <a
                      className="row-link"
                      href={`${LIST_PATH}/${encodeURIComponent(account.userId)}`}
                      aria-label={T.openAccount(account.name)}
                      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                        event.preventDefault();
                        navigate(`${LIST_PATH}/${encodeURIComponent(account.userId)}`);
                      }}
                    >
                      <span className="row-main">
                        <span className="row-name" dir="auto">
                          {account.name}
                        </span>
                        <span className="row-email" dir="ltr">
                          {account.email}
                        </span>
                      </span>
                      <span className="row-meta">
                        <StateBadge state={account.state} />
                        <span className="row-note">
                          {account.activeSessions === null ? STATE_HINT[account.state] : T.sessionsCount(account.activeSessions)}
                        </span>
                      </span>
                      <ChevronIcon />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="ledger-section" aria-labelledby="invitations-heading">
            <h2 id="invitations-heading">{T.invitationsHeading}</h2>
            {data.invitations.length === 0 ? (
              <p className="empty">{T.invitationsEmpty}</p>
            ) : (
              <ul className="ledger">
                {data.invitations.map((entry) => {
                  const open = entry.state === 'invitation_pending' || entry.state === 'enrolment_in_progress';
                  return (
                    <li key={entry.invitationId} className="ledger-row invitation-row">
                      <span className="row-main">
                        <span className="row-name" dir="ltr">
                          {entry.email}
                        </span>
                        <span className="row-note">
                          {DELIVERY_LABEL[entry.delivery.status]} · {open ? 'Expires' : 'Ended'}{' '}
                          <When iso={open ? entry.expiresAt : (entry.endedAt ?? entry.expiresAt)} />
                        </span>
                      </span>
                      <span className="row-meta">
                        <StateBadge state={entry.state} />
                      </span>
                      <span className="row-actions">
                        {open ? (
                          <>
                            <button type="button" className="button button-quiet button-small" onClick={() => void resend(entry)}>
                              {T.resend}
                            </button>
                            <button
                              type="button"
                              className="button button-quiet button-small"
                              onClick={() =>
                                setConfirm({
                                  title: T.cancelInvitationTitle(entry.email),
                                  consequences: T.cancelInvitationConsequences,
                                  confirmLabel: T.cancelInvitationConfirm,
                                  tone: 'danger',
                                  requireReason: false,
                                  onConfirm: () => invitationAction(entry, 'cancel'),
                                })
                              }
                            >
                              {T.cancelInvitation}
                            </button>
                          </>
                        ) : (
                          <InviteAgain email={entry.email} announce={announce} reload={load} onError={setActionError} />
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <InviteForm announce={announce} reload={load} />
        </>
      )}

      {confirm !== null && (
        <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} fallbackFocus={() => heading.current} />
      )}
    </>
  );
}

async function createInvitation(email: string, announce: (text: string) => void, reload: () => Promise<void>): Promise<string | null> {
  const result = await postJson('/api/owner/invitations', { email });
  if (result.status !== 201) return messageFor(result);
  const invitation = result.data.invitation as { delivery?: { status?: keyof typeof DELIVERY_LABEL } } | undefined;
  const delivery = invitation?.delivery?.status;
  announce(`${T.done.invited(email)}${delivery !== undefined && delivery in DELIVERY_LABEL ? ` ${DELIVERY_LABEL[delivery]}.` : ''}`);
  await reload();
  return null;
}

function InviteAgain({ email, announce, reload, onError }: {
  email: string;
  announce: (text: string) => void;
  reload: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="button button-quiet button-small"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        onError(null);
        const failure = await createInvitation(email, announce, reload);
        setBusy(false);
        if (failure !== null) onError(failure);
      }}
    >
      {busy ? T.inviteSending : T.inviteAgain}
    </button>
  );
}

const EMAIL = /^[^@\s,;<>]+@[^@\s,;<>]+$/;

function InviteForm({ announce, reload }: { announce: (text: string) => void; reload: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const email = String(new FormData(form).get('email') ?? '').trim();
    if (!EMAIL.test(email) || email.length > 254) {
      setError(ERRORS.invalid_email!);
      field.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    const failure = await createInvitation(email, announce, reload);
    setBusy(false);
    if (failure === null) form.reset();
    else setError(failure);
  }

  return (
    <section className="ledger-section invite" aria-labelledby="invite-heading">
      <h2 id="invite-heading">{T.inviteHeading}</h2>
      <p className="section-intro">{T.inviteIntro}</p>
      <form className="invite-form" onSubmit={onSubmit} aria-busy={busy} noValidate>
        <div className="field">
          <label htmlFor="invite-email">{T.inviteEmail}</label>
          <input
            id="invite-email"
            ref={field}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="off"
            dir="ltr"
            maxLength={254}
            aria-invalid={error !== null}
            aria-describedby={error !== null ? 'invite-error' : undefined}
          />
        </div>
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? T.inviteSending : T.inviteSubmit}
        </button>
      </form>
      {error !== null && (
        <p className="notice notice-error" role="alert" id="invite-error">
          {error}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// One account
// ---------------------------------------------------------------------------

type ViewData = { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ready'; account: AccountDetail };

function invitationText(invitation: InvitationSnapshot): ReactNode {
  switch (invitation.status) {
    case 'pending':
      return (
        <>
          Pending, expires <When iso={invitation.expiresAt} />
        </>
      );
    case 'accepted':
      return (
        <>
          Accepted {invitation.endedAt === null ? '' : <When iso={invitation.endedAt} />}
        </>
      );
    case 'superseded':
      return 'Replaced by a newer invitation';
    case 'cancelled':
      return (
        <>
          Cancelled {invitation.endedAt === null ? '' : <When iso={invitation.endedAt} />}
        </>
      );
    default:
      return (
        <>
          Expired <When iso={invitation.expiresAt} />
        </>
      );
  }
}

function AccountView({ userId, navigate, announce }: { userId: string; navigate: (to: string) => void; announce: (text: string) => void }) {
  const [data, setData] = useState<ViewData>({ kind: 'loading' });
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const focused = useRef(false);

  const load = useCallback(async () => {
    if (!USER_ID.test(userId)) {
      setData({ kind: 'failed', message: ERRORS.not_found! });
      return;
    }
    const result = await getJson(accountPath(userId));
    if (result.status === 200 && isAccountDetail(result.data.account)) setData({ kind: 'ready', account: result.data.account });
    else setData({ kind: 'failed', message: messageFor(result, true) });
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The name takes focus once, when the account first appears.
  useEffect(() => {
    if (data.kind === 'ready' && !focused.current) {
      focused.current = true;
      heading.current?.focus();
    }
  }, [data.kind]);

  /** Runs one action; on success shows the returned account, otherwise refreshes where the state moved on. */
  async function act(path: string, body: unknown, done: string): Promise<string | null> {
    const result = await postJson(path, body);
    if (result.status === 200 && isAccountDetail(result.data.account)) {
      setData({ kind: 'ready', account: result.data.account });
      announce(done);
      return null;
    }
    if (result.status === 404 || result.status === 409) await load();
    return messageFor(result);
  }

  const back = (
    <a
      className="text-link back-link"
      href={LIST_PATH}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(LIST_PATH);
      }}
    >
      <BackIcon />
      {T.back}
    </a>
  );

  if (data.kind === 'loading') {
    return (
      <>
        {back}
        <ListSkeleton label={T.detailLoading} />
      </>
    );
  }
  if (data.kind === 'failed') {
    return (
      <>
        {back}
        <Notice tone="error" title={data.message} />
      </>
    );
  }

  const account = data.account;
  const base = accountPath(account.userId);
  const active = account.state === 'active';
  const { disable, enable, revokeAllSessions } = account.actions;

  return (
    <>
      {back}
      <header className="page-head account-head">
        <h1 ref={heading} tabIndex={-1} dir="auto">
          {account.name}
        </h1>
        <p className="account-email" data-testid="account-email" dir="ltr">
          {account.email}
        </p>
        <StateBadge state={account.state} />
      </header>

      <div className="account-layout">
        <div className="account-main">
          <section className="panel" aria-labelledby="facts-heading">
            <h2 id="facts-heading">{T.factsHeading}</h2>
            <dl className="facts">
              <div>
                <dt>{T.stateLabel}</dt>
                <dd>
                  <span>
                    <strong>{STATE_LABEL[account.state]}.</strong> {STATE_HINT[account.state]}
                  </span>
                </dd>
              </div>
              <div>
                <dt>{T.createdLabel}</dt>
                <dd>
                  <When iso={account.identityCreatedAt} />
                </dd>
              </div>
              <div>
                <dt>{T.setupLabel}</dt>
                <dd>{account.setupCompletedAt === null ? T.notRecorded : <When iso={account.setupCompletedAt} />}</dd>
              </div>
              <div>
                <dt>{T.invitationLabel}</dt>
                <dd>
                  <span>{account.invitation === null ? T.noInvitation : invitationText(account.invitation)}</span>
                </dd>
              </div>
              <div>
                <dt>{T.lastChangeLabel}</dt>
                <dd>
                  {account.lastStatusChange === null ? (
                    T.noChange
                  ) : (
                    <>
                      <span>
                        {account.lastStatusChange.action === 'disabled' ? T.changeDisabled : T.changeEnabled}{' '}
                        <When iso={account.lastStatusChange.changedAt} /> {T.by}{' '}
                        <bdi>{account.lastStatusChange.changedByName}</bdi>
                      </span>
                      <span className="fact-reason">
                        {T.reasonPrefix} <bdi>{account.lastStatusChange.reason}</bdi>
                      </span>
                    </>
                  )}
                </dd>
              </div>
            </dl>
          </section>

          <section className="panel" aria-labelledby="sessions-heading">
            <h2 id="sessions-heading">{T.sessionsHeading}</h2>
            <p className="section-intro">{T.sessionsNote}</p>
            {!active ? (
              <p className="empty">{T.sessionsInactive}</p>
            ) : account.sessions.length === 0 ? (
              <p className="empty">{T.sessionsEmpty}</p>
            ) : (
              <ul className="sessions">
                {account.sessions.map((entry, index) => (
                  <li key={entry.ref} className="session-row">
                    <span className="session-name">{T.sessionLabel(index + 1)}</span>
                    <span className="session-times">
                      <span>
                        {T.signedIn} <When iso={entry.signedInAt} />
                      </span>
                      <span>
                        {T.expires} <When iso={entry.expiresAt} />
                      </span>
                    </span>
                    <button
                      type="button"
                      className="button button-quiet button-small"
                      onClick={() =>
                        setConfirm({
                          title: T.revokeOneTitle(account.name),
                          consequences: T.revokeOneConsequences,
                          confirmLabel: T.revokeOneConfirm,
                          tone: 'danger',
                          requireReason: false,
                          onConfirm: () => act(`${base}/sessions/${encodeURIComponent(entry.ref)}/revoke`, {}, T.done.revokedOne),
                        })
                      }
                    >
                      {T.revokeOne}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="panel actions-panel" aria-labelledby="actions-heading">
          <h2 id="actions-heading">{T.actionsHeading}</h2>

          <div className="action-group">
            {revokeAllSessions.available ? (
              <button
                type="button"
                className="button button-quiet"
                onClick={() =>
                  setConfirm({
                    title: T.revokeAllTitle(account.name),
                    consequences: T.revokeAllConsequences,
                    confirmLabel: T.revokeAllConfirm,
                    tone: 'danger',
                    requireReason: false,
                    onConfirm: () => act(`${base}/sessions/revoke-all`, {}, T.done.revokedAll(account.name)),
                  })
                }
              >
                {T.revokeAll}
              </button>
            ) : (
              <p className="unavailable">
                <span className="unavailable-name">{T.revokeAll}</span>
                {UNAVAILABLE[revokeAllSessions.reason ?? 'account_not_active'].revokeAllSessions}
              </p>
            )}
          </div>

          <div className="action-group action-separated">
            {enable.available && (
              <button
                type="button"
                className="button button-navy"
                onClick={() =>
                  setConfirm({
                    title: T.enableTitle(account.name),
                    consequences: T.enableConsequences,
                    confirmLabel: T.enableConfirm,
                    tone: 'navy',
                    requireReason: true,
                    onConfirm: (reason) => act(`${base}/enable`, { reason }, T.done.enabled(account.name)),
                  })
                }
              >
                {T.enable}
              </button>
            )}
            {disable.available && (
              <button
                type="button"
                className="button button-danger-outline"
                onClick={() =>
                  setConfirm({
                    title: T.disableTitle(account.name),
                    consequences: T.disableConsequences,
                    confirmLabel: T.disableConfirm,
                    tone: 'danger',
                    requireReason: true,
                    onConfirm: (reason) => act(`${base}/disable`, { reason }, T.done.disabled(account.name)),
                  })
                }
              >
                {T.disable}
              </button>
            )}
            {!enable.available && (
              <p className="unavailable">
                <span className="unavailable-name">{T.enable}</span>
                {UNAVAILABLE[enable.reason ?? 'account_not_disabled'].enable}
              </p>
            )}
            {!disable.available && (
              <p className="unavailable">
                <span className="unavailable-name">{T.disable}</span>
                {UNAVAILABLE[disable.reason ?? 'account_not_active'].disable}
              </p>
            )}
          </div>
        </section>
      </div>

      {confirm !== null && (
        <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} fallbackFocus={() => heading.current} />
      )}
    </>
  );
}
