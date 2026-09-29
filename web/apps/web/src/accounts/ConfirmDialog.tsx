import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import { ERRORS, T } from './strings.ts';

/**
 * The one confirmation used by account management (checkpoint 4E), on the
 * native modal `<dialog>`: the browser contains focus and closes it on
 * Escape. It names the person and the consequences, can require a reason, and
 * shows the server's refusal in place. Focus starts on the reason when one is
 * required and otherwise on the safe choice, and returns to whatever opened
 * it, or to the page heading if that control no longer exists.
 */

/** Mirrors the API rule: one line, 3 to 500 characters, no control or bidirectional formatting character. */
const REFUSED = /[\p{Cc}\u202A-\u202E\u2066-\u2069\p{Cs}]/u;

export function checkReason(value: string): string | null {
  if (REFUSED.test(value)) return null;
  const reason = value.trim();
  const length = Array.from(reason).length;
  return length >= 3 && length <= 500 ? reason : null;
}

export interface ConfirmRequest {
  title: string;
  consequences: readonly string[];
  confirmLabel: string;
  tone: 'danger' | 'navy';
  requireReason: boolean;
  /** Resolves to an error message to show, or `null` once the action succeeded. */
  onConfirm: (reason: string | null) => Promise<string | null>;
}

export function ConfirmDialog({ request, onClose, fallbackFocus }: {
  request: ConfirmRequest;
  onClose: () => void;
  fallbackFocus: () => HTMLElement | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const reasonField = useRef<HTMLTextAreaElement>(null);
  const safeChoice = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reasonInvalid, setReasonInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = useId();

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    // Recorded once: React's development double effect must not record the
    // reason field, which the first run focused, as the opener.
    if (opener.current === null) opener.current = document.activeElement;
    if (!element.open) element.showModal();
    (request.requireReason ? reasonField.current : safeChoice.current)?.focus();
  }, [request]);

  /** Closes, then returns focus to the opener, or to the page heading if the opener is gone. */
  function finish() {
    dialog.current?.close();
    onClose();
    const target = opener.current instanceof HTMLElement ? opener.current : null;
    // After React has re-rendered, so a control the action removed is known to be gone.
    requestAnimationFrame(() => (target !== null && target.isConnected ? target : fallbackFocus())?.focus());
  }

  function close() {
    if (busy) return;
    finish();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    let checked: string | null = null;
    if (request.requireReason) {
      checked = checkReason(reason);
      if (checked === null) {
        setReasonInvalid(true);
        setError(ERRORS.invalid_reason!);
        reasonField.current?.focus();
        return;
      }
    }
    setReasonInvalid(false);
    setError(null);
    setBusy(true);
    const failure = await request.onConfirm(checked);
    setBusy(false);
    if (failure === null) {
      finish();
      return;
    }
    setError(failure);
  }

  /** A reason is one line: Enter confirms instead of adding a line. */
  function onReasonKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  const count = Array.from(reason.trim()).length;

  return (
    <dialog
      ref={dialog}
      className="confirm"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-consequences`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <form method="dialog" onSubmit={onSubmit} aria-busy={busy} noValidate>
        <h2 id={`${id}-title`} dir="auto">
          {request.title}
        </h2>
        <ul id={`${id}-consequences`} className="consequences">
          {request.consequences.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        {request.requireReason && (
          <div className="field">
            <label htmlFor={`${id}-reason`}>{T.reasonLabel}</label>
            <textarea
              id={`${id}-reason`}
              ref={reasonField}
              rows={3}
              dir="auto"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              onKeyDown={onReasonKey}
              aria-invalid={reasonInvalid}
              aria-describedby={`${id}-hint ${id}-count${error !== null ? ` ${id}-error` : ''}`}
              autoComplete="off"
              spellCheck
            />
            <p className="field-hint" id={`${id}-hint`}>
              {T.reasonHint}
            </p>
            <p className={`field-count${count > 500 ? ' over' : ''}`} id={`${id}-count`}>
              {T.reasonCount(count)}
            </p>
          </div>
        )}

        {error !== null && (
          <p className="notice notice-error" role="alert" id={`${id}-error`}>
            {error}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" className="button button-quiet" ref={safeChoice} onClick={close} disabled={busy}>
            {T.cancel}
          </button>
          <button type="submit" className={`button button-${request.tone}`} disabled={busy}>
            {busy ? T.working : request.confirmLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
