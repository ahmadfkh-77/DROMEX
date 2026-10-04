/**
 * Every word the sign-in and account pages show, in one place, so a later
 * Arabic translation (and right-to-left layout) changes this file only.
 * The credential and code failures are deliberately generic: they never say
 * which part was wrong or what state an account is in.
 */
export const SIGNIN_STRINGS = {
  signInTitle: 'Sign in to DROMEX',
  signInIntro: 'Use your email address and password. You will then be asked for a code from your authenticator app.',
  emailLabel: 'Email address',
  passwordLabel: 'Password',
  continue: 'Continue',
  checking: 'Checking…',
  forgotPassword: 'Forgot password?',

  codeTitle: 'Enter your code',
  codeIntro: (email: string) => `Open your authenticator app and enter the 6-digit code for ${email}.`,
  codeLabel: 'Authenticator code',
  verify: 'Verify',
  verifying: 'Verifying…',
  startOver: 'Start over',

  failures: {
    missingFields: 'Enter your email address and password.',
    invalidCredentials: 'The email address or password is not correct.',
    invalidCode: 'That code was not accepted. Check the code and try again, or start over.',
    codeFormat: 'Enter the 6-digit code from your authenticator app.',
    alreadySignedIn: 'This browser is already signed in.',
    refused: 'The request was refused. Reload the page and try again.',
    rateLimited: 'Too many attempts. Wait before trying again.',
    network: 'The connection failed. Check your connection and try again.',
    unexpected: 'Something went wrong. Try again.',
  },
  goToAccount: 'Go to your account',
  retryIn: (seconds: number) => (seconds === 1 ? 'Try again in 1 second.' : `Try again in ${seconds} seconds.`),

  accountTitle: 'Your account',
  loading: 'Checking your session…',
  nameLabel: 'Name',
  emailRowLabel: 'Email address',
  roleLabel: 'Role',
  roleOwner: 'Owner',
  roleAdmin: 'Admin',
  manageAccounts: 'Manage Admin accounts',
  signOut: 'Sign out',
  signingOut: 'Signing out…',
  signOutFailed: 'Sign-out could not be confirmed. You may still be signed in. Try again.',
  signedOutTitle: 'You are signed out',
  signedOutBody: 'Your session on this browser has ended.',
  endedTitle: 'Your session has ended',
  endedBody: 'Sign in again to continue.',
  signInAgain: 'Sign in again',
  guidance: 'DROMEX never emails sign-in links and never asks you to send security codes.',
} as const;
