import { isValidEmailAddress, type EmailMessage, type EmailSender } from '../email/message.ts';
import { isWellFormedInvitationToken } from './invitation-token.ts';

/**
 * Admin invitation email: address normalization and the one message template
 * (DEC-440, DEC-442).
 *
 * The link carries the token only in the URL fragment, on the one configured
 * application origin, so it never reaches a server log, a proxy, or a
 * `Referer` header. The subject, recipient, and idempotency key never contain
 * the token. The content is English, plain text plus HTML, states the expiry
 * and the phishing guidance, and names no role, permission, or business data.
 */

const DELIVERY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const INVITATION_PAGE_PATH = '/invitation';

/** Trims and lower-cases exactly one valid address; `null` for anything else. */
export function normalizeInvitationEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return isValidEmailAddress(normalized) ? normalized : null;
}

export interface AdminInvitationEmailInput {
  to: string;
  token: string;
  /** The invitation's delivery id; the idempotency key is derived from it. */
  deliveryId: string;
  linkOrigin: string;
  from: EmailSender;
  replyTo?: string;
}

export function renderAdminInvitationEmail(input: AdminInvitationEmailInput): EmailMessage {
  if (!isWellFormedInvitationToken(input.token)) throw new Error('An invitation email needs a well-formed token.');
  if (!DELIVERY_ID.test(input.deliveryId)) throw new Error('An invitation email needs a well-formed delivery id.');

  const link = `${input.linkOrigin}${INVITATION_PAGE_PATH}#${input.token}`;
  const guidance = 'DROMEX never emails sign-in links and never asks users to send security codes.';

  const text = [
    'You have been invited to set up an account for the private DROMEX web application.',
    '',
    'To accept, open this link within 24 hours:',
    link,
    '',
    'The link can be used once. It stops working 24 hours after this email was issued, or sooner if a newer invitation is sent or this one is cancelled.',
    '',
    'If you did not expect this invitation, you can ignore this email. No account is created unless the link is used.',
    '',
    guidance,
  ].join('\n');

  const html = [
    '<p>You have been invited to set up an account for the private DROMEX web application.</p>',
    `<p><a href="${link}">Accept the invitation</a></p>`,
    '<p>The link can be used once. It stops working 24 hours after this email was issued, or sooner if a newer invitation is sent or this one is cancelled.</p>',
    '<p>If you did not expect this invitation, you can ignore this email. No account is created unless the link is used.</p>',
    `<p>${guidance}</p>`,
  ].join('\n');

  return {
    purpose: 'admin_invitation',
    idempotencyKey: `admin_invitation/${input.deliveryId}`,
    from: input.from.name === undefined ? { address: input.from.address } : { address: input.from.address, name: input.from.name },
    to: input.to,
    ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
    subject: 'Your DROMEX account invitation',
    text,
    html,
  };
}
