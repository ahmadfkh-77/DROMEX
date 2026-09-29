import type { AccountState } from './api.ts';

/**
 * State shapes for the Accounts screens: one 1.75px stroke on a 20px grid,
 * drawn here rather than borrowed, so a state is never carried by colour
 * alone. Each is decorative; the adjacent text names the state.
 */

const PATHS: Record<AccountState, string> = {
  // A check inside a circle.
  active: 'M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM6.75 10.25l2.25 2.25 4.25-4.75',
  // A circle crossed by one bar: no entry.
  disabled: 'M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM4.75 15.25l10.5-10.5',
  // A half-filled progress arc with a hand.
  enrolment_in_progress: 'M10 2.5a7.5 7.5 0 1 1-7.5 7.5M10 6v4l2.75 1.75',
  // An envelope.
  invitation_pending: 'M3 5.5h14v9H3zM3.5 6l6.5 5 6.5-5',
  // An hourglass.
  invitation_expired: 'M6 3h8M6 17h8M6.5 3c0 4 7 5 7 7s-7 3-7 7M13.5 3c0 4-7 5-7 7s7 3 7 7',
  // A cross inside a square.
  invitation_cancelled: 'M3.5 3.5h13v13h-13zM7.25 7.25l5.5 5.5M12.75 7.25l-5.5 5.5',
};

export function StateIcon({ state }: { state: AccountState }) {
  return (
    <svg
      className="state-icon"
      viewBox="0 0 20 20"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[state]} />
    </svg>
  );
}

export function ChevronIcon() {
  return (
    <svg className="chevron" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 5l5 5-5 5" />
    </svg>
  );
}

export function BackIcon() {
  return (
    <svg className="back-icon" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5l-5 5 5 5" />
    </svg>
  );
}
