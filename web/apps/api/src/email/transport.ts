import type { AuthEnvironment } from '../auth/config.ts';
import type { EmailTransportConfig } from './config.ts';
import { EmailConfigurationError } from './errors.ts';
import { parseLinkOrigin, validateEmailMessage, type EmailContentPolicy, type EmailMessage } from './message.ts';
import { createResendTransport, type ResendDependencies } from './resend.ts';
import type { EmailSendResult, EmailTransport } from './result.ts';
import { loadResendApiKey, type SecretFileOptions } from './secret-file.ts';

/**
 * The three approved email transports (DEC-439) and the factory that selects
 * one from validated configuration.
 *
 * - Disabled: the default. It sends nothing, never reports success, and
 *   still refuses an invalid message.
 * - Capture: an in-memory, per-instance store for tests and disposable
 *   development. It is refused in production at construction, independently
 *   of the configuration loader's own refusal.
 * - Resend: the production transport; the factory reads its key through the
 *   secure secret-file loader.
 *
 * No transport writes to the console or exposes message content outside its
 * result, and the capture store is reachable only through its own instance.
 */

export interface TransportOptions {
  environment: AuthEnvironment;
  linkOrigin: string;
}

export interface CapturedEmail extends Readonly<Omit<EmailMessage, 'from'>> {
  readonly from: Readonly<EmailMessage['from']>;
  readonly providerMessageId: string;
}

export interface CaptureTransport extends EmailTransport {
  readonly kind: 'capture';
  captured(): readonly CapturedEmail[];
  clear(): void;
}

function policyFor(options: TransportOptions): EmailContentPolicy {
  return { linkOrigin: parseLinkOrigin(options.linkOrigin, options.environment) };
}

function invalid(issue: Exclude<ReturnType<typeof validateEmailMessage>, { ok: true }>['issue']): EmailSendResult {
  return { status: 'permanent_failure', reason: 'invalid_message', issue, attempts: 0 };
}

export function createDisabledTransport(options: TransportOptions): EmailTransport {
  const policy = policyFor(options);

  async function send(message: EmailMessage): Promise<EmailSendResult> {
    const validation = validateEmailMessage(message, policy);
    if (!validation.ok) return invalid(validation.issue);
    return { status: 'disabled' };
  }

  return Object.freeze({ kind: 'disabled' as const, send });
}

function snapshot(message: EmailMessage, providerMessageId: string): CapturedEmail {
  const from = Object.freeze({
    address: message.from.address,
    ...(message.from.name === undefined ? {} : { name: message.from.name }),
  });
  return Object.freeze({
    purpose: message.purpose,
    idempotencyKey: message.idempotencyKey,
    from,
    to: message.to,
    ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
    subject: message.subject,
    text: message.text,
    html: message.html,
    providerMessageId,
  });
}

/** A canonical form for comparing two payloads under one idempotency key. */
function payloadOf(message: EmailMessage): string {
  return JSON.stringify([
    message.purpose,
    message.from.address,
    message.from.name ?? null,
    message.to,
    message.replyTo ?? null,
    message.subject,
    message.text,
    message.html,
  ]);
}

export function createCaptureTransport(options: TransportOptions): CaptureTransport {
  if (options.environment === 'production') throw new EmailConfigurationError('capture_not_allowed_in_production');
  const policy = policyFor(options);

  let messages: CapturedEmail[] = [];
  let byKey = new Map<string, { payload: string; result: EmailSendResult }>();

  async function send(message: EmailMessage): Promise<EmailSendResult> {
    const validation = validateEmailMessage(message, policy);
    if (!validation.ok) return invalid(validation.issue);

    const payload = payloadOf(message);
    const previous = byKey.get(message.idempotencyKey);
    if (previous !== undefined) {
      return previous.payload === payload
        ? previous.result
        : { status: 'permanent_failure', reason: 'idempotency_conflict', attempts: 1 };
    }

    const providerMessageId = `capture-${String(messages.length + 1).padStart(6, '0')}`;
    messages = [...messages, snapshot(message, providerMessageId)];
    const result: EmailSendResult = { status: 'accepted', providerMessageId, attempts: 1 };
    byKey.set(message.idempotencyKey, { payload, result });
    return result;
  }

  return Object.freeze({
    kind: 'capture' as const,
    send,
    captured: () => Object.freeze([...messages]),
    clear: () => {
      messages = [];
      byKey = new Map();
    },
  });
}

export interface EmailTransportFactoryOptions extends TransportOptions {
  secretFile?: SecretFileOptions;
  resend?: Partial<ResendDependencies>;
}

export async function createEmailTransport(
  config: EmailTransportConfig,
  options: EmailTransportFactoryOptions,
): Promise<EmailTransport> {
  switch (config.kind) {
    case 'disabled':
      return createDisabledTransport(options);
    case 'capture':
      return createCaptureTransport(options);
    case 'resend': {
      const policy = policyFor(options);
      const apiKey = await loadResendApiKey(config.apiKeyFile, options.secretFile);
      return createResendTransport({
        apiKey,
        policy,
        ...(options.resend === undefined ? {} : { dependencies: options.resend }),
      });
    }
    default:
      throw new EmailConfigurationError('transport_unsupported');
  }
}
