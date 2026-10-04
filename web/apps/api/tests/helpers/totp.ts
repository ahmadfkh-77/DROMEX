import { createHmac } from 'node:crypto';

/**
 * TEST-ONLY RFC 6238 TOTP generator, written independently of Better Auth so
 * that a test derives the expected code without using the code under test.
 * HMAC-SHA-1, six digits, thirty-second steps: the parameters DROMEX pins.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_MS = 30_000;

export function base32Decode(input: string): Buffer {
  const cleaned = input.replaceAll('-', '').replaceAll('=', '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of cleaned) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) throw new Error('invalid base32 input');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function totpAt(secretBase32: string, timeMs: number): string {
  const counter = Math.floor(timeMs / TOTP_STEP_MS);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secretBase32)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(binary % 1_000_000).padStart(6, '0');
}

export function totpCode(secretBase32: string, stepOffset = 0, now = Date.now()): string {
  return totpAt(secretBase32, now + stepOffset * TOTP_STEP_MS);
}

export function msUntilNextStep(now = Date.now()): number {
  return TOTP_STEP_MS - (now % TOTP_STEP_MS);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits for a new step when too little of the current one remains. */
export async function waitForFreshStep(minRemainingMs = 5_000): Promise<void> {
  const remaining = msUntilNextStep();
  if (remaining < minRemainingMs) await sleep(remaining + 50);
}

/**
 * Hands out distinct codes that Better Auth will still accept, so a test can
 * sign in more than once without tripping DROMEX's replay protection.
 */
export class TotpSequence {
  readonly secret: string;
  private readonly used = new Set<string>();

  constructor(secret: string) {
    this.secret = secret;
  }

  async next(): Promise<string> {
    for (;;) {
      await waitForFreshStep();
      for (const offset of [0, 1, -1]) {
        const code = totpCode(this.secret, offset);
        if (!this.used.has(code)) {
          this.used.add(code);
          return code;
        }
      }
      await sleep(msUntilNextStep() + 50);
    }
  }
}

/** A six-digit code that no step near now produces for this secret. */
export function wrongCode(secretBase32: string): string {
  const nearby = new Set([-2, -1, 0, 1, 2].map((offset) => totpCode(secretBase32, offset)));
  for (let candidate = 0; ; candidate += 1) {
    const code = String(candidate).padStart(6, '0');
    if (!nearby.has(code)) return code;
  }
}
