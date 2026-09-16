import { EmailConfigurationError } from './errors.ts';

/**
 * Security-email message model and validation (DEC-439, DEC-442).
 *
 * The model is deliberately the smallest one later checkpoints need: one
 * recipient, a sender, an optional Reply-To, a subject, and both a plain-text
 * and an HTML body, tagged with an approved purpose and a stable idempotency
 * key. Anything else (copies, custom headers, attachments, scheduling) is
 * refused, so it cannot reach a provider by accident.
 *
 * The HTML checks are a strict guard for DROMEX-authored static templates,
 * not a general HTML sanitizer: they refuse whole classes of markup (images,
 * scripts, frames, styles, forms, event handlers, comments, character
 * references, non-double-quoted links) rather than trying to clean them.
 *
 * A validation result names only an issue code. It never repeats an address,
 * subject, body, or key.
 */

export const EMAIL_PURPOSES = ['admin_invitation', 'password_reset', 'password_changed', 'delivery_test'] as const;
export type EmailPurpose = (typeof EMAIL_PURPOSES)[number];

export interface EmailSender {
  address: string;
  name?: string;
}

export interface EmailMessage {
  purpose: EmailPurpose;
  /**
   * `<purpose>/<logical id>`, identical for every attempt at the same logical
   * email. It must never be derived from an invitation or reset token.
   */
  idempotencyKey: string;
  from: EmailSender;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
}

export type EmailValidationIssue =
  | 'message_malformed'
  | 'unexpected_field'
  | 'purpose_unsupported'
  | 'idempotency_key_invalid'
  | 'sender_invalid'
  | 'recipient_invalid'
  | 'reply_to_invalid'
  | 'subject_invalid'
  | 'text_invalid'
  | 'html_invalid'
  | 'unsafe_content'
  | 'link_not_allowed'
  | 'secret_like_value';

export type EmailValidation = { ok: true; message: EmailMessage } | { ok: false; issue: EmailValidationIssue };

export interface EmailContentPolicy {
  /** The one approved application origin every link must use. */
  linkOrigin: string;
}

export const EMAIL_LIMITS = {
  addressLength: 254,
  localPartLength: 64,
  labelLength: 63,
  nameLength: 64,
  subjectLength: 150,
  textLength: 20_000,
  htmlLength: 100_000,
} as const;

const MESSAGE_FIELDS = new Set(['purpose', 'idempotencyKey', 'from', 'to', 'replyTo', 'subject', 'text', 'html']);
const SENDER_FIELDS = new Set(['address', 'name']);

/** C0 and C1 controls, DEL, and the Unicode line and paragraph separators. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
/** Controls except tab, LF, and CR, which a body may contain. */
const BODY_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/;

const LOCAL_PART = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const TOP_LEVEL_LABEL = /^[a-z]{2,63}$/;
const DISPLAY_NAME = /^[\p{L}\p{N} .'&()_-]+$/u;
const IDEMPOTENCY_KEY = /^([a-z_]+)\/([A-Za-z0-9-]{8,128})$/;

const SECRET_LIKE: readonly RegExp[] = [
  /\bre_[A-Za-z0-9_-]{8,}/,
  /\bwhsec_[A-Za-z0-9+/=_-]{8,}/i,
  /\bbearer\s+\S{8,}/i,
  /-----BEGIN [A-Z ]*(?:KEY|CERTIFICATE)-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:sk|pk|rk)_(?:live|test)_/,
];

const UNSAFE_HTML: readonly RegExp[] = [
  /<\s*\/?\s*(?:script|style|iframe|frame|frameset|object|embed|applet|img|image|picture|source|video|audio|track|svg|math|link|meta|base|form|input|button|select|textarea|template|portal)\b/i,
  /<!--|<!\[CDATA\[/i,
  /\son[a-z]+\s*=/i,
  /\s(?:src|srcset|action|formaction|background|poster|data|xlink:href|lowsrc|dynsrc|ping)\s*=/i,
  /\b(?:javascript|vbscript)\s*:/i,
  /=\s*["']?\s*data\s*:/i,
  /url\s*\(|expression\s*\(|@import/i,
  /&#|&colon;|&tab;|&newline;/i,
];

/** Every `href` must be double-quoted, so its value can be checked exactly. */
const HREF_ATTRIBUTE = /\shref\s*=\s*(.)/gi;
const HREF_VALUE = /\shref\s*=\s*"([^"]*)"/gi;
const ABSOLUTE_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

export function isValidEmailAddress(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > EMAIL_LIMITS.addressLength) return false;
  if (CONTROL.test(value)) return false;

  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@')) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length > EMAIL_LIMITS.localPartLength || !LOCAL_PART.test(local)) return false;

  const labels = domain.split('.');
  if (labels.length < 2) return false;
  if (!labels.every((label) => label.length <= EMAIL_LIMITS.labelLength && DOMAIN_LABEL.test(label))) return false;
  return TOP_LEVEL_LABEL.test(labels[labels.length - 1]!);
}

function isValidSender(value: unknown): value is EmailSender {
  if (!isPlainObject(value)) return false;
  if (Object.keys(value).some((key) => !SENDER_FIELDS.has(key))) return false;
  if (!isValidEmailAddress(value['address'])) return false;

  const name = value['name'];
  if (name === undefined) return true;
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= EMAIL_LIMITS.nameLength &&
    name.trim() === name &&
    !CONTROL.test(name) &&
    DISPLAY_NAME.test(name)
  );
}

function isValidSubject(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= EMAIL_LIMITS.subjectLength &&
    !CONTROL.test(value)
  );
}

function isValidBody(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength && !BODY_CONTROL.test(value);
}

function isAllowedLink(url: string, origin: string): boolean {
  if (url !== origin && !url.startsWith(`${origin}/`)) return false;
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

function hasUnsafeHtml(html: string): boolean {
  if (UNSAFE_HTML.some((pattern) => pattern.test(html))) return true;
  for (const match of html.matchAll(HREF_ATTRIBUTE)) {
    if (match[1] !== '"') return true;
  }
  return false;
}

function linksAllowed(message: EmailMessage, origin: string): boolean {
  for (const match of message.html.matchAll(HREF_VALUE)) {
    if (!isAllowedLink(match[1]!, origin)) return false;
  }
  for (const body of [message.text, message.html]) {
    for (const match of body.matchAll(ABSOLUTE_URL)) {
      if (!isAllowedLink(match[0], origin)) return false;
    }
  }
  return true;
}

function metadataOf(message: EmailMessage): string[] {
  return [
    message.idempotencyKey,
    message.from.address,
    message.from.name ?? '',
    message.to,
    message.replyTo ?? '',
    message.subject,
  ];
}

/**
 * Parses the approved link origin. HTTPS is required; plain HTTP is accepted
 * only for a loopback host outside production, for disposable development.
 */
export function parseLinkOrigin(value: string, environment: string): string {
  const invalid = () => new EmailConfigurationError('link_origin_invalid');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  if (url.origin !== value || url.username !== '' || url.password !== '') throw invalid();

  if (url.protocol === 'https:') return url.origin;
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  if (url.protocol === 'http:' && loopback && environment !== 'production') return url.origin;
  throw invalid();
}

export function validateEmailMessage(value: unknown, policy: EmailContentPolicy): EmailValidation {
  const fail = (issue: EmailValidationIssue): EmailValidation => ({ ok: false, issue });

  if (!isPlainObject(value)) return fail('message_malformed');
  if (Object.keys(value).some((key) => !MESSAGE_FIELDS.has(key))) return fail('unexpected_field');

  const purpose = value['purpose'];
  if (typeof purpose !== 'string' || !(EMAIL_PURPOSES as readonly string[]).includes(purpose)) {
    return fail('purpose_unsupported');
  }

  const key = value['idempotencyKey'];
  const keyMatch = typeof key === 'string' ? IDEMPOTENCY_KEY.exec(key) : null;
  if (keyMatch === null || keyMatch[1] !== purpose) return fail('idempotency_key_invalid');

  if (!isValidSender(value['from'])) return fail('sender_invalid');
  if (!isValidEmailAddress(value['to'])) return fail('recipient_invalid');
  if (value['replyTo'] !== undefined && !isValidEmailAddress(value['replyTo'])) return fail('reply_to_invalid');
  if (!isValidSubject(value['subject'])) return fail('subject_invalid');
  if (!isValidBody(value['text'], EMAIL_LIMITS.textLength)) return fail('text_invalid');
  if (!isValidBody(value['html'], EMAIL_LIMITS.htmlLength)) return fail('html_invalid');

  const message = value as unknown as EmailMessage;
  if (hasUnsafeHtml(message.html)) return fail('unsafe_content');
  if (!linksAllowed(message, policy.linkOrigin)) return fail('link_not_allowed');
  if (metadataOf(message).some((field) => SECRET_LIKE.some((pattern) => pattern.test(field)))) {
    return fail('secret_like_value');
  }

  return { ok: true, message };
}
