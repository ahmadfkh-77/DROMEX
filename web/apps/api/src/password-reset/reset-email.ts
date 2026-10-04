import type { EmailMessage, EmailSender } from '../email/message.ts';
import { isWellFormedResetToken } from './reset-token.ts';

/**
 * The two password-reset emails (DEC-441, DEC-442).
 *
 * The reset link carries its token only in the URL fragment, on the one
 * configured application origin, so it never reaches a server log, a proxy,
 * or a `Referer` header. Neither email puts a token in its subject, recipient,
 * or idempotency key. Both are English, plain text plus HTML, state what the
 * reader needs, repeat the phishing guidance, and name no role, permission,
 * or business data.
 */

const DELIVERY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const RESET_PAGE_PATH = '/reset-password';
export const FORGOT_PAGE_PATH = '/forgot-password';

const GUIDANCE = 'DROMEX never emails sign-in links and never asks users to send security codes.';

interface CommonInput {
  to: string;
  /** The reset's delivery id; the idempotency key is derived from it. */
  deliveryId: string;
  linkOrigin: string;
  from: EmailSender;
  replyTo?: string;
}

export interface PasswordResetEmailInput extends CommonInput {
  token: string;
}

export interface PasswordChangedEmailInput extends CommonInput {
  changedAt: Date;
}

function envelope(input: CommonInput): Pick<EmailMessage, 'from' | 'to' | 'replyTo'> {
  if (!DELIVERY_ID.test(input.deliveryId)) throw new Error('A password email needs a well-formed delivery id.');
  return {
    from: input.from.name === undefined ? { address: input.from.address } : { address: input.from.address, name: input.from.name },
    to: input.to,
    ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
  };
}

export function renderPasswordResetEmail(input: PasswordResetEmailInput): EmailMessage {
  if (!isWellFormedResetToken(input.token)) throw new Error('A password reset email needs a well-formed token.');
  const addressing = envelope(input);
  const link = `${input.linkOrigin}${RESET_PAGE_PATH}#${input.token}`;

  const text = [
    'Someone asked to reset the password for your DROMEX account.',
    '',
    'To choose a new password, open this link within 30 minutes:',
    link,
    '',
    'The link can be used once. It stops working after 30 minutes, or sooner if another reset is requested.',
    'Signing in afterwards still needs your authenticator code.',
    '',
    'If you did not ask for this, you can ignore this email. Your password has not been changed.',
    '',
    GUIDANCE,
  ].join('\n');

  const html = [
    '<p>Someone asked to reset the password for your DROMEX account.</p>',
    `<p><a href="${link}">Choose a new password</a></p>`,
    '<p>The link can be used once. It stops working after 30 minutes, or sooner if another reset is requested. Signing in afterwards still needs your authenticator code.</p>',
    '<p>If you did not ask for this, you can ignore this email. Your password has not been changed.</p>',
    `<p>${GUIDANCE}</p>`,
  ].join('\n');

  return {
    purpose: 'password_reset',
    idempotencyKey: `password_reset/${input.deliveryId}`,
    ...addressing,
    subject: 'Reset your DROMEX password',
    text,
    html,
  };
}

/** `2026-09-26 13:45 UTC`: minutes are enough, and UTC avoids guessing a zone. */
function formatUtcMinute(value: Date): string {
  if (!Number.isFinite(value.getTime())) throw new Error('A password changed email needs a valid time.');
  return `${value.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function renderPasswordChangedEmail(input: PasswordChangedEmailInput): EmailMessage {
  const addressing = envelope(input);
  const when = formatUtcMinute(input.changedAt);
  const forgot = `${input.linkOrigin}${FORGOT_PAGE_PATH}`;

  const text = [
    `The password for your DROMEX account was changed on ${when}.`,
    '',
    'You have been signed out everywhere. Signing in needs the new password and your authenticator code.',
    '',
    `If you did not change it, reset your password again at ${forgot} and reply to this email so the account can be checked.`,
    '',
    GUIDANCE,
  ].join('\n');

  const html = [
    `<p>The password for your DROMEX account was changed on ${when}.</p>`,
    '<p>You have been signed out everywhere. Signing in needs the new password and your authenticator code.</p>',
    `<p>If you did not change it, <a href="${forgot}">reset your password again</a> and reply to this email so the account can be checked.</p>`,
    `<p>${GUIDANCE}</p>`,
  ].join('\n');

  return {
    purpose: 'password_changed',
    idempotencyKey: `password_changed/${input.deliveryId}`,
    ...addressing,
    subject: 'Your DROMEX password was changed',
    text,
    html,
  };
}
