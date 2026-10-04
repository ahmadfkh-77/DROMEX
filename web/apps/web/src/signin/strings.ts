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

/**
 * The lost-authenticator screens (batch 4c). Same rule as above: every word in
 * this module. The recovery-code failure is deliberately generic, and the Admin
 * guidance is the same text for everyone, so the page never confirms whether an
 * account exists or what role it holds.
 */
export const RECOVERY_STRINGS = {
  lostLink: 'Lost your authenticator?',

  chooserTitle: 'Lost your authenticator?',
  chooserIntro: 'What to do depends on your role. This page does not check who you are and shows the same text to everyone.',
  ownerHeading: 'If you are the Owner',
  ownerBody: 'Use one of the recovery codes you saved when you set up your account to replace your authenticator.',
  ownerAction: 'Recover as the Owner',
  adminHeading: 'If you are an Admin',
  adminBody: 'Admins cannot replace an authenticator themselves. Ask the Owner to reset your authenticator.',
  backToSignIn: 'Back to sign in',

  recoverTitle: 'Recover the Owner account',
  recoverIntro:
    'You will confirm your password, use one unused recovery code, and then set up a new authenticator. Every other session of this account ends.',
  recoverStepLabel: (step: number, total: number) => `Step ${step} of ${total}`,

  passwordStepTitle: 'Confirm it is you',
  emailLabel: 'Email address',
  passwordLabel: 'Password',

  codeStepTitle: 'Enter a recovery code',
  codeStepIntro: 'Enter one unused recovery code. It is used up once it is accepted.',
  recoveryCodeLabel: 'Recovery code',
  recoveryCodeHint: 'Letters and digits, in groups of four. Spaces and hyphens are optional.',

  replaceTitle: 'Confirm your password',
  replaceIntro:
    'Your recovery code was accepted. Enter your password again to replace your authenticator. Until you finish, this account cannot sign in normally.',
  setUpAuthenticator: 'Set up new authenticator',

  enrolTitle: 'Add your new authenticator',
  enrolIntro:
    'Add DROMEX to your authenticator app with this setup key, then enter the 6-digit code it shows. The setup key is shown only on this screen.',
  setupKeyLabel: 'Setup key',
  authenticatorCodeLabel: 'Authenticator code',

  codesTitle: 'Save your new recovery codes',
  codesIntro: 'These replace your old recovery codes. They are shown once. Save them somewhere safe, away from your phone.',
  codesSavedLabel: 'I saved these recovery codes',
  codesSavedRequired: 'Confirm that you saved the recovery codes before continuing.',
  finish: 'Finish',

  finishedTitle: 'Authenticator replaced',
  finished:
    'Your authenticator was replaced. Sign in with your password and a code from your new authenticator.',
  signIn: 'Go to sign in',

  continue: 'Continue',
  checking: 'Checking…',
  verify: 'Verify',
  verifying: 'Verifying…',
  startOver: 'Start over',
  timeLimit: 'This recovery expires after a short time. Finish it in one sitting.',
  retryIn: (seconds: number) => (seconds === 1 ? 'Try again in 1 second.' : `Try again in ${seconds} seconds.`),

  failures: {
    missingFields: 'Enter your email address and password.',
    invalidRecoveryCode: 'That recovery code was not accepted. Check it and try again, or start over.',
    recoveryCodeFormat: 'Enter a recovery code: 24 letters and digits, in groups of four.',
    invalidCode: 'That code was not accepted. Wait for a new code from your new authenticator and try again.',
    codeFormat: 'Enter the 6-digit code from your new authenticator.',
    recoveryEnded: 'The recovery could not continue and has ended. Start over.',
    codeMayBeUsed: 'The server could not finish this step and the recovery code may already be used. Start over, and use a different recovery code if the same one is refused.',
    refused: 'The request was refused. Reload the page and try again.',
    rateLimited: 'Too many attempts. Wait before trying again.',
    network: 'The connection failed. Check your connection and try again.',
    unexpected: 'Something went wrong. Try again.',
  },
} as const;
