import type { EmailMessage, EmailValidationIssue } from './message.ts';

/**
 * The closed result of one logical send (DEC-439). No variant carries a raw
 * provider response, a header, an address, or message content.
 *
 * - `accepted`: the provider accepted the message; its id passed validation.
 * - `retryable_failure`: a temporary failure outlasted the approved retries.
 * - `permanent_failure`: the send will not succeed without a correction.
 * - `disabled`: no transport is configured; nothing was sent.
 */

export type EmailRetryableReason =
  | 'rate_limited'
  | 'provider_unavailable'
  | 'timeout'
  | 'network_unavailable'
  | 'idempotency_in_progress'
  | 'deadline_exhausted';

export type EmailPermanentReason =
  | 'invalid_message'
  | 'provider_rejected'
  | 'provider_authentication'
  | 'provider_response_invalid'
  | 'idempotency_conflict'
  | 'unexpected_failure';

export type EmailSendResult =
  | { status: 'accepted'; providerMessageId: string; attempts: number }
  | { status: 'retryable_failure'; reason: EmailRetryableReason; attempts: number }
  | { status: 'permanent_failure'; reason: EmailPermanentReason; attempts: number; issue?: EmailValidationIssue }
  | { status: 'disabled' };

export type EmailTransportKind = 'disabled' | 'capture' | 'resend';

export interface EmailTransport {
  readonly kind: EmailTransportKind;
  send(message: EmailMessage): Promise<EmailSendResult>;
}
