import type { AccountState, DeliveryStatus } from './api.ts';

/**
 * Every word the Owner reads on the Accounts screens (checkpoint 4E), in one
 * place. Plain language, the product's own terms, and no value that the API
 * does not actually record: an unknown fact reads "Not recorded".
 */

export const STATE_LABEL: Record<AccountState, string> = {
  active: 'Active',
  disabled: 'Disabled',
  enrolment_in_progress: 'Enrolment in progress',
  invitation_pending: 'Invitation pending',
  invitation_expired: 'Invitation expired',
  invitation_cancelled: 'Invitation cancelled',
};

export const STATE_HINT: Record<AccountState, string> = {
  active: 'Can sign in with a password and authenticator code.',
  disabled: 'Cannot sign in or use any session. History keeps their name.',
  enrolment_in_progress: 'Setup started from an invitation and is not finished.',
  invitation_pending: 'Invitation sent. Setup has not started.',
  invitation_expired: 'The invitation ended before setup finished. Resend to continue.',
  invitation_cancelled: 'The invitation was cancelled. Invite again to continue.',
};

export const DELIVERY_LABEL: Record<DeliveryStatus, string> = {
  sending: 'Email outcome not yet known',
  provider_accepted: 'Email accepted for delivery',
  failed: 'Email could not be sent',
  not_sent: 'Email not sent: email delivery is not configured',
};

export const UNAVAILABLE: Record<'account_not_active' | 'account_not_disabled', Record<'disable' | 'enable' | 'revokeAllSessions', string>> = {
  account_not_active: {
    disable: 'Only an active account can be disabled.',
    enable: 'Only a disabled account can be re-enabled.',
    revokeAllSessions: 'This account has not finished setup, so it has no sessions to end.',
  },
  account_not_disabled: {
    disable: 'Only an active account can be disabled.',
    enable: 'Only a disabled account can be re-enabled.',
    revokeAllSessions: 'This account has no sessions to end.',
  },
};

export const ERRORS: Record<string, string> = {
  invalid_reason: 'Enter a reason of 3 to 500 characters on a single line.',
  owner_protected: 'The Owner account cannot be changed here.',
  account_not_active: 'This account is no longer active. The latest details are shown.',
  account_not_disabled: 'This account is not disabled. The latest details are shown.',
  session_not_found: 'That session has already ended. The latest details are shown.',
  not_found: 'This account is not in account management.',
  invalid_email: 'Enter a valid email address.',
  account_exists: 'That address already belongs to an account.',
  invitation_pending: 'An invitation to that address is already pending.',
  invitation_not_pending: 'That invitation has already ended. The latest details are shown.',
  too_many_requests: 'Too many invitations to that address. Wait a little and try again.',
  unauthorized: 'Your session has ended. Sign in again as the Owner.',
  forbidden: 'Only the Owner can manage accounts.',
  network: 'DROMEX could not be reached. Check the connection and try again.',
  unexpected: 'The action could not be confirmed. Refresh to see the current state.',
  load_failed: 'Nothing was changed. Try again; if it keeps failing, DROMEX may be unavailable.',
};

export const T = {
  title: 'Accounts',
  lede: 'Admin accounts, their invitations, and their sessions. Only the Owner sees this page.',
  loading: 'Loading accounts',
  signInTitle: 'Sign in required',
  signIn: 'Sign in as the Owner to manage accounts. Your session may have ended.',
  notOwnerTitle: 'Owner only',
  notOwner: 'Only the Owner can manage accounts. Nothing here is available to Admin accounts.',
  loadFailedTitle: 'Accounts could not be loaded',
  retry: 'Try again',
  adminsHeading: 'Admin accounts',
  adminsEmpty: 'No Admin account has finished setup yet. Invite an Admin below; they appear here once their setup begins.',
  invitationsHeading: 'Invitations without an account',
  invitationsEmpty: 'No open or recently ended invitations.',
  inviteHeading: 'Invite an Admin',
  inviteIntro:
    'The invitation link is emailed to the person and is never shown here. It works once, for 24 hours, and they set their own password and authenticator.',
  inviteEmail: 'Email address',
  inviteSubmit: 'Send invitation',
  inviteSending: 'Sending invitation',
  sessionsCount: (count: number) => (count === 1 ? '1 active session' : `${count} active sessions`),
  noSessionInfo: 'No sessions',
  openAccount: (name: string) => `Open ${name}`,
  back: 'All accounts',
  detailLoading: 'Loading account',
  factsHeading: 'Account',
  stateLabel: 'State',
  emailLabel: 'Email',
  createdLabel: 'Account created',
  setupLabel: 'Setup completed',
  invitationLabel: 'Invitation',
  lastChangeLabel: 'Last status change',
  notRecorded: 'Not recorded',
  noInvitation: 'No invitation recorded',
  noChange: 'Never disabled or re-enabled',
  changeDisabled: 'Disabled',
  changeEnabled: 'Re-enabled',
  by: 'by',
  reasonPrefix: 'Reason:',
  sessionsHeading: 'Sessions',
  sessionsNote: 'Only sessions that can be used right now are listed. DROMEX does not record device details or last activity here.',
  sessionsEmpty: 'No active sessions. This person is signed out everywhere.',
  sessionsInactive: 'Sessions are listed only for active accounts.',
  signedIn: 'Signed in',
  expires: 'Expires',
  sessionLabel: (index: number) => `Session ${index}`,
  revokeOne: 'Sign out this session',
  actionsHeading: 'Actions',
  disable: 'Disable account',
  enable: 'Re-enable account',
  revokeAll: 'Sign out everywhere',
  resend: 'Resend invitation',
  cancelInvitation: 'Cancel invitation',
  inviteAgain: 'Invite again',
  cancel: 'Keep as is',
  reasonLabel: 'Reason (required)',
  reasonHint: 'One line, 3 to 500 characters. Never include a password or code.',
  reasonCount: (count: number) => `${count} of 500 characters`,
  working: 'Working',
  disableTitle: (name: string) => `Disable ${name}?`,
  disableConsequences: [
    'Every session ends immediately, on every device.',
    'They cannot sign in, reset their password into access, or be invited again while disabled.',
    'Nothing is deleted. Their name stays on every record they created.',
  ],
  disableConfirm: 'Disable account',
  enableTitle: (name: string) => `Re-enable ${name}?`,
  enableConsequences: [
    'They can sign in again with their password and authenticator code.',
    'No earlier session comes back. They must sign in again.',
  ],
  enableConfirm: 'Re-enable account',
  revokeAllTitle: (name: string) => `Sign ${name} out everywhere?`,
  revokeAllConsequences: ['Every session of this account ends immediately.', 'The account stays active; they can sign in again.'],
  revokeAllConfirm: 'Sign out everywhere',
  revokeOneTitle: (name: string) => `End this session of ${name}?`,
  revokeOneConsequences: ['Only this session ends. Their other sessions stay signed in.'],
  revokeOneConfirm: 'Sign out this session',
  cancelInvitationTitle: (email: string) => `Cancel the invitation to ${email}?`,
  cancelInvitationConsequences: ['The link in the email stops working immediately.', 'You can invite the same address again later.'],
  cancelInvitationConfirm: 'Cancel invitation',
  done: {
    disabled: (name: string) => `${name} is disabled and signed out everywhere.`,
    enabled: (name: string) => `${name} is re-enabled. They must sign in again.`,
    revokedAll: (name: string) => `${name} is signed out everywhere.`,
    revokedOne: 'The session has ended.',
    invited: (email: string) => `Invitation created for ${email}.`,
    resent: (email: string) => `A new invitation replaced the earlier one for ${email}.`,
    cancelled: (email: string) => `The invitation to ${email} is cancelled.`,
  },
} as const;
