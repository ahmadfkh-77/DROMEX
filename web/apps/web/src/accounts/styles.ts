/**
 * Accounts screens (checkpoint 4E), in the DROMEX "Foreman's Field Ledger"
 * system (DESIGN.md): Structural Navy for structure, one Signal Orange action,
 * Ledger Cream paper, and red only where an action ends something. Status
 * pills pair text with a drawn shape, and every pairing here meets WCAG AA;
 * the 4.49:1 warning-on-cream pairing DESIGN.md records is not used.
 */
export const ACCOUNT_STYLES = `
  .accounts {
    --navy: #173f67;
    --navy-deep: #082d61;
    --orange: #c84b31;
    --orange-deep: #8e2e1b;
    --cream: #f5f2ec;
    --paper: #fffcf6;
    --surface: #ffffff;
    --ink: #17212b;
    --muted: #56626d;
    --line: #ddd7cc;
    --line-strong: #c9c1b3;
    --danger: #b3261e;
    --danger-deep: #8c1d17;
    --radius-control: 13px;
    --radius-panel: 16px;
    max-width: 72rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 4rem;
    font-size: 1rem;
  }
  .accounts ::selection { background: rgba(200, 75, 49, 0.22); color: var(--ink); }
  .accounts h1 {
    font-size: 1.875rem;
    line-height: 1.15;
    font-weight: 850;
    letter-spacing: -0.01em;
    color: var(--navy);
    margin: 1rem 0 0.35rem;
    overflow-wrap: anywhere;
    text-wrap: balance;
  }
  /* Headings take focus only to give screen readers context; they are not controls. */
  .accounts h1[tabindex='-1']:focus { outline: none; }
  /* A name keeps its own direction but lines up with the ledger column. */
  .accounts h1[dir='auto'], .accounts .row-name[dir='auto'] { text-align: left; }
  .accounts h2 {
    font-size: 1.1875rem;
    line-height: 1.25;
    font-weight: 850;
    color: var(--navy);
    margin: 0 0 0.25rem;
  }
  .accounts .lede { margin: 0; max-width: 40rem; color: var(--ink); }
  .accounts time { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .accounts bdi { unicode-bidi: isolate; }

  .accounts a:focus-visible,
  .accounts button:focus-visible,
  .accounts input:focus-visible,
  .accounts textarea:focus-visible {
    outline: 3px solid var(--orange);
    outline-offset: 2px;
  }

  .visually-hidden {
    position: absolute !important;
    width: 1px; height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
  }

  /* Live announcements read as one calm confirmation line; empty, it takes no space. */
  .accounts .live {
    margin: 1rem 0 0;
    padding: 0.75rem 1rem;
    border: 1px solid #b9d6c7;
    border-radius: var(--radius-control);
    background: #eef6f1;
    color: #1d5a3f;
    font-weight: 650;
    overflow-wrap: anywhere;
  }
  .accounts .live:empty { padding: 0; border: 0; margin: 0; }

  .page-head { margin: 0 0 1.75rem; }
  .account-head { display: grid; gap: 0.5rem; justify-items: start; }
  .account-head h1 { margin-bottom: 0; }
  .account-email { margin: 0; color: var(--muted); overflow-wrap: anywhere; }

  .text-link {
    color: var(--navy);
    font-weight: 750;
    text-decoration: underline;
    text-underline-offset: 0.22em;
    text-decoration-thickness: 1px;
  }
  .text-link:hover { color: var(--navy-deep); text-decoration-thickness: 2px; }
  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    min-height: 2.75rem;
    margin-top: 0.5rem;
    text-decoration: none;
  }
  .back-link:hover { text-decoration: underline; }

  /* Sections of the ledger. Space separates groups; a hairline separates rows. */
  .ledger-section { margin: 0 0 2.5rem; }
  .ledger-section > h2 { margin-bottom: 0.75rem; }
  .section-intro { margin: 0 0 1rem; color: var(--muted); max-width: 44rem; font-size: 0.9375rem; }
  .empty {
    margin: 0;
    padding: 1.25rem;
    border: 1px dashed var(--line-strong);
    border-radius: var(--radius-panel);
    color: var(--muted);
    background: var(--paper);
    max-width: 44rem;
  }

  .ledger {
    list-style: none;
    margin: 0;
    padding: 0;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-panel);
    overflow: hidden;
  }
  .ledger-row + .ledger-row { border-top: 1px solid var(--line); }
  .row-link {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.75rem 1rem;
    padding: 1rem 1.125rem;
    min-height: 4.5rem;
    color: inherit;
    text-decoration: none;
  }
  .row-link:hover { background: #fbf8f2; }
  .row-link:hover .row-name { text-decoration: underline; text-underline-offset: 0.2em; }
  .row-link:focus-visible { outline-offset: -3px; }
  .row-link .chevron { color: var(--muted); grid-column: 2; grid-row: 1; }
  .row-main { display: grid; gap: 0.15rem; min-width: 0; }
  .row-name { font-weight: 800; color: var(--ink); overflow-wrap: anywhere; }
  .row-email { color: var(--muted); font-size: 0.9375rem; overflow-wrap: anywhere; }
  .row-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; grid-column: 1 / -1; }
  .row-note { color: var(--muted); font-size: 0.875rem; }
  .invitation-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.75rem;
    padding: 1rem 1.125rem;
  }
  .row-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }

  @media (min-width: 48rem) {
    .accounts { padding: 2rem 1.5rem 4rem; }
    .row-link { grid-template-columns: minmax(0, 1fr) minmax(12rem, 18rem) auto; }
    .row-link .chevron { grid-column: 3; }
    .row-meta { grid-column: 2; grid-row: 1; justify-content: flex-start; }
    .invitation-row { grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; }
  }

  /* State pills: text and a shape, with AA contrast on their own tint. */
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.2rem 0.65rem 0.2rem 0.5rem;
    border-radius: 999px;
    font-size: 0.8125rem;
    font-weight: 750;
    line-height: 1.4;
    white-space: nowrap;
    border: 1px solid transparent;
  }
  .badge .state-icon { flex: none; }
  .badge-active { color: #1d5a3f; background: #e7f3ec; border-color: #b9d6c7; }
  .badge-disabled { color: #3b4651; background: #ece8e1; border-color: #cfc8bc; }
  .badge-enrolment_in_progress,
  .badge-invitation_pending { color: var(--navy); background: #e6edf5; border-color: #bfd0e2; }
  .badge-invitation_expired { color: #6e4a0c; background: #fbf1dc; border-color: #e6cf9f; }
  .badge-invitation_cancelled { color: #4a545e; background: #f1eee8; border-color: #d6cfc3; }

  /* Buttons: 48px controls (44px when small), one filled primary per view. */
  .button {
    font: inherit;
    font-weight: 800;
    font-size: 0.9375rem;
    min-height: 3rem;
    padding: 0.625rem 1rem;
    border-radius: var(--radius-control);
    border: 1px solid transparent;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    transition: background-color 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out;
  }
  .button:disabled { cursor: progress; opacity: 0.65; }
  .button-small { min-height: 2.75rem; padding: 0.5rem 0.875rem; font-size: 0.875rem; }
  .button-primary { background: var(--orange); color: #fff; }
  .button-primary:hover:not(:disabled) { background: var(--orange-deep); }
  .button-navy { background: var(--navy); color: #fff; }
  .button-navy:hover:not(:disabled) { background: var(--navy-deep); }
  .button-quiet { background: var(--surface); color: var(--navy); border-color: var(--line-strong); }
  .button-quiet:hover:not(:disabled) { background: #f4f1eb; border-color: var(--navy); }
  .button-danger { background: var(--danger); color: #fff; }
  .button-danger:hover:not(:disabled) { background: var(--danger-deep); }
  .button-danger-outline { background: var(--surface); color: var(--danger); border: 1.5px solid var(--danger); }
  .button-danger-outline:hover:not(:disabled) { background: #fcefed; }
  @media (prefers-reduced-motion: reduce) { .button { transition: none; } }

  /* One account: facts and sessions on the left, actions set apart on the right. */
  .account-layout { display: grid; gap: 1.25rem; margin-top: 1.5rem; }
  .account-main { display: grid; gap: 1.25rem; min-width: 0; }
  @media (min-width: 60rem) {
    .account-layout { grid-template-columns: minmax(0, 1fr) 19rem; align-items: start; }
    .actions-panel { position: sticky; top: 1rem; }
  }
  .panel {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-panel);
    padding: 1.25rem;
    min-width: 0;
  }
  .panel > h2 { margin-bottom: 0.75rem; }
  .facts { margin: 0; display: grid; }
  .facts > div {
    display: grid;
    gap: 0.25rem;
    padding: 0.75rem 0;
    border-top: 1px solid var(--line);
  }
  .facts > div:first-child { border-top: 0; padding-top: 0; }
  @media (min-width: 40rem) {
    .facts > div { grid-template-columns: 11rem minmax(0, 1fr); gap: 1rem; }
  }
  .facts dt { font-size: 0.8125rem; font-weight: 800; color: var(--muted); }
  .facts dd { margin: 0; display: grid; gap: 0.35rem; justify-items: start; overflow-wrap: anywhere; }
  .fact-note { color: var(--muted); font-size: 0.875rem; }
  .fact-reason {
    padding: 0.5rem 0.75rem;
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 10px;
    max-width: 40rem;
  }

  .sessions { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
  .session-row {
    display: grid;
    gap: 0.5rem 1rem;
    padding: 0.875rem 1rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-control);
    background: var(--paper);
  }
  @media (min-width: 40rem) {
    .session-row { grid-template-columns: 6.5rem minmax(0, 1fr) auto; align-items: center; }
  }
  .session-name { font-weight: 800; }
  .session-times { display: flex; flex-wrap: wrap; gap: 0.25rem 1.25rem; color: var(--muted); font-size: 0.9375rem; }

  .actions-panel .action-group { display: grid; gap: 0.75rem; }
  .actions-panel .action-separated {
    margin-top: 1.25rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--line);
  }
  .unavailable { margin: 0; color: var(--muted); font-size: 0.875rem; display: grid; gap: 0.1rem; }
  .unavailable-name { font-weight: 800; color: var(--ink); }

  /* Forms. */
  .invite-form { display: flex; flex-wrap: wrap; align-items: end; gap: 0.75rem; max-width: 44rem; }
  .invite-form .field { flex: 1 1 16rem; }
  .field { display: grid; gap: 0.35rem; }
  .field label { font-weight: 750; font-size: 0.9375rem; }
  .field input,
  .field textarea {
    font: inherit;
    width: 100%;
    min-height: 3rem;
    padding: 0.625rem 0.8rem;
    border: 1px solid var(--line-strong);
    border-radius: 11px;
    background: #fcfbf8;
    color: var(--ink);
  }
  .field textarea { resize: vertical; min-height: 5.5rem; line-height: 1.45; }
  .field input[aria-invalid='true'],
  .field textarea[aria-invalid='true'] { border-color: var(--danger); border-width: 2px; }
  .field-hint, .field-count { margin: 0; font-size: 0.8125rem; color: var(--muted); }
  .field-count.over { color: var(--danger); font-weight: 750; }

  /* Notices. */
  .notice {
    margin: 0 0 1.25rem;
    padding: 0.875rem 1rem;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-control);
    background: var(--surface);
    display: grid;
    gap: 0.5rem;
    justify-items: start;
    overflow-wrap: anywhere;
  }
  .notice p { margin: 0; }
  .notice-title { font-weight: 800; }
  .notice-error { border-color: var(--danger); background: #fdf3f2; color: var(--ink); }
  .invite .notice { margin-top: 0.75rem; max-width: 44rem; }

  .gate { margin-top: 1rem; display: grid; gap: 1rem; justify-items: start; }

  .skeleton { display: grid; gap: 0.5rem; max-width: 44rem; margin-top: 1rem; }
  .skeleton-row {
    display: grid;
    gap: 0.5rem;
    padding: 1rem 1.125rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-panel);
    background: var(--surface);
  }
  .skeleton-row span { height: 0.75rem; border-radius: 6px; background: #ebe6dc; }
  .skeleton-row span:first-child { width: 45%; height: 0.9rem; }
  .skeleton-row span:last-child { width: 70%; }

  /* The confirmation. */
  dialog.confirm {
    width: min(34rem, calc(100vw - 2rem));
    max-height: calc(100dvh - 2rem);
    overflow: auto;
    padding: 1.5rem;
    border: 0;
    border-radius: 19px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 18px 48px rgba(23, 33, 43, 0.28), 0 2px 6px rgba(23, 33, 43, 0.12);
  }
  dialog.confirm::backdrop { background: rgba(23, 33, 43, 0.5); }
  dialog.confirm form { display: grid; gap: 1rem; }
  dialog.confirm h2 { font-size: 1.25rem; margin: 0; overflow-wrap: anywhere; }
  .consequences { margin: 0; padding-inline-start: 1.25rem; display: grid; gap: 0.35rem; }
  .dialog-actions { display: flex; flex-wrap: wrap-reverse; justify-content: flex-end; gap: 0.75rem; }
  .dialog-actions .button { flex: 1 1 10rem; }
  dialog.confirm .notice { margin: 0; }
`;
