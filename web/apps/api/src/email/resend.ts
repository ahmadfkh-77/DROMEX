import { validateEmailMessage, type EmailContentPolicy, type EmailMessage } from './message.ts';
import type { EmailPermanentReason, EmailRetryableReason, EmailSendResult, EmailTransport } from './result.ts';

/**
 * Resend HTTPS transport (DEC-439), using Node's built-in `fetch` and no SDK.
 *
 * Request shape, verified against Resend's official API reference on
 * 2026-09-16: `POST` to the fixed endpoint below, `Authorization: Bearer
 * <key>`, a JSON body of `from`, `to`, `subject`, `text`, `html`, and optional
 * `reply_to`, an `Idempotency-Key` header (at most 256 characters, retained
 * by Resend for 24 hours), and a required `User-Agent` header. A success body
 * is `{ "id": "<message id>" }`.
 *
 * Retries follow DEC-439 exactly: at most three attempts, all inside a
 * two-minute deadline, every attempt carrying the same idempotency key and
 * the byte-identical body, so a request whose response was lost cannot become
 * a second email. Only HTTP 429, HTTP 5xx, a timeout, a known transient
 * network failure, and Resend's documented in-progress 409 are retried. A
 * redirect is never followed, so the key cannot be forwarded to another host.
 *
 * HTTP 409, verified on 2026-09-16 against Resend's official error reference
 * and idempotency guide, with the error body's `name` field taken from the
 * error type in Resend's official Node SDK: `concurrent_idempotent_requests`
 * means another request with the same key is still in progress and is safe
 * to retry later, so it is retried like a temporary failure;
 * `invalid_idempotent_request` means the key was already used with a
 * different body, which retrying cannot fix, so it is a permanent
 * `idempotency_conflict`. Any other 409, including `resource_locked`, and any
 * body that is not a small JSON object whose `name` is exactly one of those
 * two strings, is a permanent `provider_rejected`: an unclassifiable conflict
 * is never retried.
 *
 * The key lives only in this closure. It is never placed in a URL, a body, a
 * result, or an error. Only a success body and a bounded 409 body are ever
 * read, and from a 409 body only `name` is compared with the two documented
 * strings; nothing from it is kept or returned. Nothing is logged.
 */

export const RESEND_EMAILS_ENDPOINT = 'https://api.resend.com/emails';

const USER_AGENT = 'dromex-api/0.1.0';

export const RESEND_RETRY_POLICY = {
  maxAttempts: 3,
  deadlineMs: 120_000,
  attemptTimeoutMs: 30_000,
  minimumAttemptMs: 1_000,
  maxRetryAfterMs: 30_000,
  backoffMs: [1_000, 2_000],
  jitterMs: 250,
  maxResponseBytes: 16_384,
  maxErrorResponseBytes: 4_096,
} as const;

/** Resend's documented HTTP 409 error names, read from the error body's `name`. */
const RESEND_IDEMPOTENCY_IN_PROGRESS = 'concurrent_idempotent_requests';
const RESEND_IDEMPOTENCY_CONFLICT = 'invalid_idempotent_request';

export interface ResendDependencies {
  fetch: typeof fetch;
  now(): number;
  sleep(ms: number): Promise<void>;
  random(): number;
  /** Runs `callback` after `ms`; returns a function that cancels it. */
  schedule(callback: () => void, ms: number): () => void;
}

export interface ResendTransportOptions {
  apiKey: string;
  policy: EmailContentPolicy;
  dependencies?: Partial<ResendDependencies>;
}

const defaultDependencies: ResendDependencies = {
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: () => Math.random(),
  schedule: (callback, ms) => {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
};

/** A Resend message id: short, and letters, digits, `_`, and `-` only. */
const PROVIDER_MESSAGE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const RETRY_AFTER_SECONDS = /^\d{1,6}$/;

/** Network error codes that describe a temporary condition worth one more attempt. */
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'ENETDOWN',
  'EHOSTUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CLOSED',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

type AttemptOutcome =
  | { kind: 'accepted'; providerMessageId: string }
  | { kind: 'retryable'; reason: EmailRetryableReason; retryAfterMs?: number }
  | { kind: 'permanent'; reason: EmailPermanentReason };

function errorCode(error: unknown): string | undefined {
  for (const candidate of [error, (error as { cause?: unknown } | null)?.cause]) {
    if (typeof candidate === 'object' && candidate !== null && 'code' in candidate) {
      return String((candidate as { code: unknown }).code);
    }
  }
  return undefined;
}

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

function parseRetryAfter(response: Response): number | undefined {
  const value = response.headers.get('retry-after');
  if (value === null || !RETRY_AFTER_SECONDS.test(value)) return undefined;
  return Number(value) * 1_000;
}

async function discardBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/** Reads at most `limit` bytes; returns undefined when the body is larger. */
async function readBounded(response: Response, limit: number): Promise<string | undefined> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Reads a bounded JSON object body; undefined for anything else. */
async function boundedJsonObject(response: Response, limit: number): Promise<Record<string, unknown> | undefined> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!/^application\/json\b/i.test(contentType)) {
    await discardBody(response);
    return undefined;
  }
  const text = await readBounded(response, limit);
  if (text === undefined) return undefined;

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  return body as Record<string, unknown>;
}

async function acceptedId(response: Response): Promise<string | undefined> {
  const body = await boundedJsonObject(response, RESEND_RETRY_POLICY.maxResponseBytes);
  const id = body?.id;
  return typeof id === 'string' && PROVIDER_MESSAGE_ID.test(id) ? id : undefined;
}

/** Classifies a 409 by its documented `name` alone; nothing else in the body is used. */
async function conflictOutcome(response: Response, retryAfterMs: number | undefined): Promise<AttemptOutcome> {
  const body = await boundedJsonObject(response, RESEND_RETRY_POLICY.maxErrorResponseBytes);
  const name = body?.name;
  if (name === RESEND_IDEMPOTENCY_IN_PROGRESS) return { kind: 'retryable', reason: 'idempotency_in_progress', retryAfterMs };
  if (name === RESEND_IDEMPOTENCY_CONFLICT) return { kind: 'permanent', reason: 'idempotency_conflict' };
  return { kind: 'permanent', reason: 'provider_rejected' };
}

function requestBody(message: EmailMessage): string {
  const from = message.from.name === undefined ? message.from.address : `${message.from.name} <${message.from.address}>`;
  return JSON.stringify({
    from,
    to: message.to,
    ...(message.replyTo === undefined ? {} : { reply_to: message.replyTo }),
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}

function containsKey(message: EmailMessage, apiKey: string): boolean {
  return [
    message.idempotencyKey,
    message.from.address,
    message.from.name ?? '',
    message.to,
    message.replyTo ?? '',
    message.subject,
    message.text,
    message.html,
  ].some((field) => field.includes(apiKey));
}

export function createResendTransport(options: ResendTransportOptions): EmailTransport {
  const apiKey = options.apiKey;
  const policy = { linkOrigin: options.policy.linkOrigin };
  const deps: ResendDependencies = { ...defaultDependencies, ...options.dependencies };

  async function attempt(body: string, idempotencyKey: string, timeoutMs: number): Promise<AttemptOutcome> {
    const controller = new AbortController();
    const cancelTimer = deps.schedule(() => controller.abort(), timeoutMs);
    try {
      const response = await deps.fetch(RESEND_EMAILS_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Idempotency-Key': idempotencyKey,
          'User-Agent': USER_AGENT,
        },
        body,
        redirect: 'error',
        signal: controller.signal,
      });

      if (response.status >= 200 && response.status < 300) {
        const id = await acceptedId(response);
        return id === undefined
          ? { kind: 'permanent', reason: 'provider_response_invalid' }
          : { kind: 'accepted', providerMessageId: id };
      }

      const retryAfterMs = parseRetryAfter(response);
      if (response.status === 409) return await conflictOutcome(response, retryAfterMs);
      await discardBody(response);
      if (response.status === 429) return { kind: 'retryable', reason: 'rate_limited', retryAfterMs };
      if (response.status >= 500 && response.status < 600) {
        return { kind: 'retryable', reason: 'provider_unavailable', retryAfterMs };
      }
      if (response.status === 401 || response.status === 403) return { kind: 'permanent', reason: 'provider_authentication' };
      if (response.status >= 400 && response.status < 500) return { kind: 'permanent', reason: 'provider_rejected' };
      return { kind: 'permanent', reason: 'unexpected_failure' };
    } catch (error) {
      if (controller.signal.aborted || isTimeout(error)) return { kind: 'retryable', reason: 'timeout' };
      const code = errorCode(error);
      if (code !== undefined && TRANSIENT_NETWORK_CODES.has(code)) return { kind: 'retryable', reason: 'network_unavailable' };
      return { kind: 'permanent', reason: 'unexpected_failure' };
    } finally {
      cancelTimer();
    }
  }

  async function send(message: EmailMessage): Promise<EmailSendResult> {
    const validation = validateEmailMessage(message, policy);
    if (!validation.ok) {
      return { status: 'permanent_failure', reason: 'invalid_message', issue: validation.issue, attempts: 0 };
    }
    if (containsKey(message, apiKey)) {
      return { status: 'permanent_failure', reason: 'invalid_message', issue: 'secret_like_value', attempts: 0 };
    }

    const body = requestBody(message);
    const idempotencyKey = message.idempotencyKey;
    const deadline = deps.now() + RESEND_RETRY_POLICY.deadlineMs;

    for (let attemptNumber = 1; attemptNumber <= RESEND_RETRY_POLICY.maxAttempts; attemptNumber += 1) {
      const remaining = deadline - deps.now();
      if (remaining < RESEND_RETRY_POLICY.minimumAttemptMs) {
        return { status: 'retryable_failure', reason: 'deadline_exhausted', attempts: attemptNumber - 1 };
      }

      const outcome = await attempt(body, idempotencyKey, Math.min(RESEND_RETRY_POLICY.attemptTimeoutMs, remaining));
      if (outcome.kind === 'accepted') {
        return { status: 'accepted', providerMessageId: outcome.providerMessageId, attempts: attemptNumber };
      }
      if (outcome.kind === 'permanent') {
        return { status: 'permanent_failure', reason: outcome.reason, attempts: attemptNumber };
      }
      if (attemptNumber === RESEND_RETRY_POLICY.maxAttempts) {
        return { status: 'retryable_failure', reason: outcome.reason, attempts: attemptNumber };
      }

      if (outcome.retryAfterMs !== undefined && outcome.retryAfterMs > RESEND_RETRY_POLICY.maxRetryAfterMs) {
        return { status: 'retryable_failure', reason: outcome.reason, attempts: attemptNumber };
      }
      const jitter = Math.floor(Math.min(Math.max(deps.random(), 0), 0.999_999) * RESEND_RETRY_POLICY.jitterMs);
      const backoff = RESEND_RETRY_POLICY.backoffMs[attemptNumber - 1]! + jitter;
      const delay = Math.max(backoff, outcome.retryAfterMs ?? 0);
      if (deps.now() + delay + RESEND_RETRY_POLICY.minimumAttemptMs > deadline) {
        return { status: 'retryable_failure', reason: 'deadline_exhausted', attempts: attemptNumber };
      }
      await deps.sleep(delay);
    }

    // Unreachable: the final attempt always returns above.
    return { status: 'retryable_failure', reason: 'deadline_exhausted', attempts: RESEND_RETRY_POLICY.maxAttempts };
  }

  return Object.freeze({ kind: 'resend' as const, send });
}
