import { randomBytes, randomUUID } from 'node:crypto';

import { vi } from 'vitest';

import type { EmailMessage } from '../../src/email/message.ts';
import type { ResendDependencies } from '../../src/email/resend.ts';

/**
 * Synthetic email fixtures. Nothing here is a real address, key, or message:
 * every domain uses the reserved `.test` TLD, every key is generated in memory
 * and labelled SYNTHETIC, and no test ever reaches the network.
 */

export const LINK_ORIGIN = 'https://app.example.test';

export function syntheticApiKey(): string {
  return `re_SYNTHETIC_TEST_ONLY_${randomBytes(16).toString('hex')}`;
}

export function syntheticMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    purpose: 'delivery_test',
    idempotencyKey: `delivery_test/${randomUUID()}`,
    from: { address: 'no-reply@notify.example.test', name: 'DROMEX Test' },
    to: 'recipient@example.test',
    replyTo: 'support@example.test',
    subject: 'SYNTHETIC TEST ONLY - DROMEX delivery check',
    text: `SYNTHETIC TEST MESSAGE - NOT FOR PRODUCTION.\nOpen ${LINK_ORIGIN}/synthetic-check to continue.`,
    html: `<p>SYNTHETIC TEST MESSAGE - NOT FOR PRODUCTION.</p><p><a href="${LINK_ORIGIN}/synthetic-check">Continue</a></p>`,
    ...overrides,
  };
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function acceptedResponse(id: string = randomUUID()): Response {
  return jsonResponse(200, { id });
}

export function networkError(code: string): TypeError {
  return Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error(`synthetic socket failure ${code}`), { code }),
  });
}

export function timeoutError(): DOMException {
  return new DOMException('The operation was aborted due to timeout', 'TimeoutError');
}

export interface RecordedCall {
  url: string;
  init: RequestInit;
}

type Step = Response | Error | ((init: RequestInit, env: FakeResendEnvironment) => Promise<Response>);

export interface FakeResendEnvironment {
  dependencies: ResendDependencies;
  calls: RecordedCall[];
  sleeps: number[];
  timeouts: number[];
  readonly start: number;
  now(): number;
  advance(ms: number): void;
}

/**
 * A deterministic clock, sleep, randomness, scheduler, and fetch. Each fetch
 * call consumes the next scripted step; an unscripted call fails the test.
 */
export function fakeResendEnvironment(
  steps: Step[],
  options: { random?: number; fireTimeouts?: boolean } = {},
): FakeResendEnvironment {
  const start = 1_700_000_000_000;
  let clock = start;
  const queue = [...steps];
  const calls: RecordedCall[] = [];
  const sleeps: number[] = [];
  const timeouts: number[] = [];

  const env: FakeResendEnvironment = {
    calls,
    sleeps,
    timeouts,
    start,
    now: () => clock,
    advance: (ms) => {
      clock += ms;
    },
    dependencies: {
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), init: init ?? {} });
        const step = queue.shift();
        if (step === undefined) throw new Error('unscripted request');
        if (step instanceof Error) throw step;
        if (typeof step === 'function') return step(init ?? {}, env);
        return step;
      }) as typeof fetch,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
      random: () => options.random ?? 0,
      schedule: (callback, ms) => {
        timeouts.push(ms);
        if (options.fireTimeouts) queueMicrotask(callback);
        return () => undefined;
      },
    },
  };
  return env;
}

/** Spies on every console method; returns a function reporting all calls. */
export function watchConsole(): () => unknown[][] {
  const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => undefined),
  );
  return () => spies.flatMap((spy) => spy.mock.calls);
}
