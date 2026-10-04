/**
 * Every word the password-reset pages show, in one place, so a later Arabic
 * translation (a separate decision, DEC-442 (3)) changes this file only.
 * Expired, used, superseded, and unknown links deliberately share one message
 * (DEC-442 (2)).
 */
export const RESET_STRINGS = {
  forgotTitle: 'Reset your password',
  forgotIntro: 'Enter the email address for your DROMEX account. If password reset is available for it, we will email a link.',
  emailLabel: 'Email address',
  sendLink: 'Send reset link',
  sending: 'Sending…',
  sentTitle: 'Check your email',
  sent: 'If password reset is available for that address, an email is on its way. The link works once, for 30 minutes.',
  sentNote: 'If nothing arrives, check your spam folder or ask again in a few minutes.',
  invalidEmail: 'Enter an email address.',

  resetTitle: 'Choose a new password',
  checking: 'Checking your link…',
  missing: 'This page needs the link from your reset email. Open the link from the email again.',
  invalidLink: 'This reset link can no longer be used. It may have expired, been used, or been replaced by a newer one.',
  requestAnother: 'Request a new reset link',
  passwordLabel: 'New password',
  passwordHint: '15 to 128 characters. A long phrase you do not use anywhere else works well.',
  confirmLabel: 'Confirm new password',
  save: 'Set new password',
  saving: 'Saving…',
  mismatch: 'The two passwords do not match.',
  tooShort: 'Use at least 15 characters.',
  tooLong: 'Use at most 128 characters.',
  common: 'That password is too common. Choose a longer, less predictable phrase.',
  doneTitle: 'Password changed',
  done: 'You have been signed out everywhere. Sign in with your new password and a code from your authenticator app.',
  failed: 'Your password could not be changed. Request a new reset link and try again.',

  rateLimited: 'Too many attempts. Wait a few minutes and try again.',
  network: 'The connection failed. Check your connection and try again.',
  unexpected: 'Something went wrong. Try again.',
  guidance: 'DROMEX never emails sign-in links and never asks you to send security codes.',
} as const;
