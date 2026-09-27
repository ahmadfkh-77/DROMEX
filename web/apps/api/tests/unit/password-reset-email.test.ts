import { describe, expect, it } from 'vitest';

import { validateEmailMessage } from '../../src/email/message.ts';
import { renderPasswordChangedEmail, renderPasswordResetEmail } from '../../src/password-reset/reset-email.ts';
import { generateResetToken } from '../../src/password-reset/reset-token.ts';

// DEC-441, DEC-442: the reset link carries its token only in the fragment of
// a link on the configured origin; both emails are English, plain text plus
// HTML, state what matters, and carry no business or secret content.

const LINK_ORIGIN = 'https://app.example.test';
const DELIVERY_ID = '6a0c1f5e-2b7d-4c1a-9e3f-0123456789ab';
const SENDER = { address: 'no-reply@notify.example.test', name: 'DROMEX' };
const GUIDANCE = 'DROMEX never emails sign-in links and never asks users to send security codes.';
const BUSINESS = /\b(admin|administrator|owner|role|permission|recovery code|price|payment|project|invitation)\b/i;

function reset(token = generateResetToken().token) {
  return {
    token,
    message: renderPasswordResetEmail({
      to: 'person@example.test',
      token,
      deliveryId: DELIVERY_ID,
      linkOrigin: LINK_ORIGIN,
      from: SENDER,
      replyTo: 'support@example.test',
    }),
  };
}

function changed() {
  return renderPasswordChangedEmail({
    to: 'person@example.test',
    deliveryId: DELIVERY_ID,
    changedAt: new Date('2026-09-26T13:45:12.345Z'),
    linkOrigin: LINK_ORIGIN,
    from: SENDER,
    replyTo: 'support@example.test',
  });
}

describe('password reset email', () => {
  it('passes the approved message validation for its link origin', () => {
    const { message } = reset();
    expect(validateEmailMessage(message, { linkOrigin: LINK_ORIGIN })).toEqual({ ok: true, message });
  });

  it('puts the token only in the URL fragment of a link on the configured origin', () => {
    const { token, message } = reset();
    const link = `${LINK_ORIGIN}/reset-password#${token}`;
    expect(message.text).toContain(link);
    expect(message.html).toContain(`href="${link}"`);
    for (const url of `${message.text} ${message.html}`.match(/https?:\/\/[^\s"<]+/g) ?? []) {
      const parsed = new URL(url);
      expect(parsed.origin).toBe(LINK_ORIGIN);
      expect(parsed.search).toBe('');
    }
  });

  it('keeps the token out of every metadata field and uses a delivery-bound idempotency key', () => {
    const { token, message } = reset();
    expect(message.purpose).toBe('password_reset');
    expect(message.idempotencyKey).toBe(`password_reset/${DELIVERY_ID}`);
    for (const field of [message.idempotencyKey, message.subject, message.to, message.from.address, message.replyTo]) {
      expect(field).not.toContain(token);
    }
  });

  it('states the 30-minute expiry, single use, that nothing changed if ignored, and the phishing guidance', () => {
    const { message } = reset();
    for (const body of [message.text, message.html]) {
      expect(body).toMatch(/30 minutes/);
      expect(body).toMatch(/used once/);
      expect(body).toMatch(/password has not been changed/);
      expect(body).toMatch(/authenticator code/);
      expect(body).toContain(GUIDANCE);
      expect(body).not.toMatch(BUSINESS);
    }
  });

  it('refuses a malformed token or delivery id rather than rendering it', () => {
    const base = { to: 'person@example.test', token: generateResetToken().token, deliveryId: DELIVERY_ID, linkOrigin: LINK_ORIGIN, from: SENDER };
    expect(() => renderPasswordResetEmail({ ...base, token: 'short' })).toThrow();
    expect(() => renderPasswordResetEmail({ ...base, token: `${base.token}"><a href="https://evil.test` })).toThrow();
    expect(() => renderPasswordResetEmail({ ...base, deliveryId: 'not a uuid' })).toThrow();
  });

  it('omits Reply-To when none is configured', () => {
    const message = renderPasswordResetEmail({
      to: 'person@example.test',
      token: generateResetToken().token,
      deliveryId: DELIVERY_ID,
      linkOrigin: LINK_ORIGIN,
      from: SENDER,
    });
    expect('replyTo' in message).toBe(false);
  });
});

describe('password changed email', () => {
  it('passes the approved message validation and uses its own purpose and key', () => {
    const message = changed();
    expect(validateEmailMessage(message, { linkOrigin: LINK_ORIGIN })).toEqual({ ok: true, message });
    expect(message.purpose).toBe('password_changed');
    expect(message.idempotencyKey).toBe(`password_changed/${DELIVERY_ID}`);
  });

  it('states when the password changed, that every session ended, what to do, and the guidance', () => {
    const message = changed();
    for (const body of [message.text, message.html]) {
      expect(body).toContain('2026-09-26 13:45 UTC');
      expect(body).toMatch(/signed out/);
      expect(body).toMatch(/authenticator code/);
      expect(body).toMatch(/If you did not/);
      expect(body).toContain(`${LINK_ORIGIN}/forgot-password`);
      expect(body).toContain(GUIDANCE);
      expect(body).not.toMatch(BUSINESS);
      expect(body).not.toContain('#');
    }
  });
});
