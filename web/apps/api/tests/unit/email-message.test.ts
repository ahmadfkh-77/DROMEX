import { describe, expect, it } from 'vitest';

import { EmailConfigurationError } from '../../src/email/errors.ts';
import { parseLinkOrigin, validateEmailMessage, type EmailValidationIssue } from '../../src/email/message.ts';
import { LINK_ORIGIN, syntheticApiKey, syntheticMessage } from '../helpers/email.ts';

const POLICY = { linkOrigin: LINK_ORIGIN };

function issueOf(message: unknown): EmailValidationIssue | 'ok' {
  const result = validateEmailMessage(message, POLICY);
  return result.ok ? 'ok' : result.issue;
}

describe('email message validation', () => {
  it('accepts a well-formed synthetic security message', () => {
    const message = syntheticMessage();
    const result = validateEmailMessage(message, POLICY);

    expect(result).toEqual({ ok: true, message });
  });

  it('accepts every approved purpose and a message without Reply-To', () => {
    for (const purpose of ['admin_invitation', 'password_reset', 'password_changed', 'delivery_test'] as const) {
      const message = syntheticMessage({ purpose, idempotencyKey: `${purpose}/0123456789abcdef` });
      delete message.replyTo;
      expect(issueOf(message), purpose).toBe('ok');
    }
  });

  it('refuses anything that is not a plain message object', () => {
    for (const value of [null, undefined, 'text', 42, [], [syntheticMessage()]]) {
      expect(issueOf(value)).toBe('message_malformed');
    }
  });

  it('refuses an unsupported purpose', () => {
    for (const purpose of ['marketing', 'newsletter', '', 'DELIVERY_TEST']) {
      expect(issueOf({ ...syntheticMessage(), purpose, idempotencyKey: 'delivery_test/0123456789abcdef' })).toBe(
        'purpose_unsupported',
      );
    }
  });

  it('refuses fields beyond the approved model, including extra recipients and headers', () => {
    for (const extra of [
      { cc: 'other@example.test' },
      { bcc: 'other@example.test' },
      { headers: { 'X-Test': '1' } },
      { attachments: [] },
      { tags: [] },
      { scheduledAt: 'tomorrow' },
    ]) {
      expect(issueOf({ ...syntheticMessage(), ...extra }), JSON.stringify(extra)).toBe('unexpected_field');
    }
    expect(issueOf(syntheticMessage({ from: { address: 'no-reply@notify.example.test', extra: 'x' } as never }))).toBe(
      'sender_invalid',
    );
  });

  it('requires a stable idempotency key prefixed by the purpose', () => {
    for (const idempotencyKey of [
      '',
      'delivery_test/',
      'delivery_test/short',
      'password_reset/0123456789abcdef',
      'delivery_test/0123456789abcdef/extra',
      'delivery_test/0123456789abcdef\r\n',
      `delivery_test/${'a'.repeat(129)}`,
      'delivery_test/0123456789 abcdef',
    ]) {
      expect(issueOf(syntheticMessage({ idempotencyKey })), JSON.stringify(idempotencyKey)).toBe(
        'idempotency_key_invalid',
      );
    }
    expect(issueOf(syntheticMessage({ idempotencyKey: `delivery_test/${'a'.repeat(128)}` }))).toBe('ok');
  });

  it('refuses malformed, non-normalised, and multiple recipients', () => {
    for (const to of [
      '',
      'not-an-address',
      'a@b',
      'Recipient@example.test',
      ' recipient@example.test',
      'recipient@example.test ',
      'recipient@@example.test',
      '.recipient@example.test',
      'recip..ient@example.test',
      'recipient@-example.test',
      'recipient@example.test,other@example.test',
      'recipient@example.test; other@example.test',
      'Recipient Name <recipient@example.test>',
      'récipient@example.test',
    ]) {
      expect(issueOf(syntheticMessage({ to })), JSON.stringify(to)).toBe('recipient_invalid');
    }
    expect(issueOf({ ...syntheticMessage(), to: ['recipient@example.test'] })).toBe('recipient_invalid');
    expect(issueOf({ ...syntheticMessage(), to: ['recipient@example.test', 'other@example.test'] })).toBe(
      'recipient_invalid',
    );
  });

  it('enforces address length limits', () => {
    const local64 = 'a'.repeat(64);
    expect(issueOf(syntheticMessage({ to: `${local64}@example.test` }))).toBe('ok');
    expect(issueOf(syntheticMessage({ to: `${'a'.repeat(65)}@example.test` }))).toBe('recipient_invalid');

    const longDomain = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.${'e'.repeat(50)}.test`;
    expect(`${local64}@${longDomain}`.length).toBeGreaterThan(254);
    expect(issueOf(syntheticMessage({ to: `${local64}@${longDomain}` }))).toBe('recipient_invalid');
  });

  it('refuses CR, LF, and other header-injection characters in every header field', () => {
    const injection = '\r\nBcc: other@example.test';
    expect(issueOf(syntheticMessage({ to: `recipient@example.test${injection}` }))).toBe('recipient_invalid');
    expect(issueOf(syntheticMessage({ replyTo: `support@example.test${injection}` }))).toBe('reply_to_invalid');
    expect(issueOf(syntheticMessage({ subject: `Subject${injection}` }))).toBe('subject_invalid');
    expect(issueOf(syntheticMessage({ subject: 'Subject\u2028line' }))).toBe('subject_invalid');
    expect(issueOf(syntheticMessage({ subject: 'Subject\u0000' }))).toBe('subject_invalid');
    expect(
      issueOf(syntheticMessage({ from: { address: `no-reply@notify.example.test${injection}`, name: 'DROMEX' } })),
    ).toBe('sender_invalid');
    for (const name of [`DROMEX${injection}`, 'DROMEX <x@example.test>', 'DROMEX "quoted"', 'DROMEX, Team', 'a'.repeat(65), '']) {
      expect(issueOf(syntheticMessage({ from: { address: 'no-reply@notify.example.test', name } })), name).toBe(
        'sender_invalid',
      );
    }
    expect(issueOf(syntheticMessage({ replyTo: 'not-an-address' }))).toBe('reply_to_invalid');
  });

  it('enforces subject and body length boundaries', () => {
    expect(issueOf(syntheticMessage({ subject: 's'.repeat(150) }))).toBe('ok');
    expect(issueOf(syntheticMessage({ subject: 's'.repeat(151) }))).toBe('subject_invalid');
    expect(issueOf(syntheticMessage({ subject: '' }))).toBe('subject_invalid');
    expect(issueOf(syntheticMessage({ subject: '   ' }))).toBe('subject_invalid');

    expect(issueOf(syntheticMessage({ text: 't'.repeat(20_000) }))).toBe('ok');
    expect(issueOf(syntheticMessage({ text: 't'.repeat(20_001) }))).toBe('text_invalid');

    const paragraph = '<p>SYNTHETIC</p>';
    const html100k = paragraph + 'h'.repeat(100_000 - paragraph.length);
    expect(issueOf(syntheticMessage({ html: html100k }))).toBe('ok');
    expect(issueOf(syntheticMessage({ html: `${html100k}h` }))).toBe('html_invalid');
  });

  it('requires both a plain-text and an HTML alternative', () => {
    const noText = syntheticMessage() as Partial<ReturnType<typeof syntheticMessage>>;
    delete noText.text;
    expect(issueOf(noText)).toBe('text_invalid');

    const noHtml = syntheticMessage() as Partial<ReturnType<typeof syntheticMessage>>;
    delete noHtml.html;
    expect(issueOf(noHtml)).toBe('html_invalid');

    expect(issueOf(syntheticMessage({ text: '' }))).toBe('text_invalid');
    expect(issueOf(syntheticMessage({ text: ' \n ' }))).toBe('text_invalid');
    expect(issueOf(syntheticMessage({ html: '' }))).toBe('html_invalid');
    expect(issueOf(syntheticMessage({ text: 'body\u0000' }))).toBe('text_invalid');
  });

  it('refuses remote images, scripts, frames, styles, forms, event handlers, and other unsafe markup', () => {
    for (const html of [
      '<p>x</p><img src="https://app.example.test/pixel.gif">',
      '<p>x</p><img alt="">',
      '<p>x</p><script>alert(1)</script>',
      '<p>x</p><SCRIPT src="https://app.example.test/a.js"></SCRIPT>',
      '<p>x</p><iframe src="https://app.example.test/"></iframe>',
      '<p>x</p><link rel="stylesheet" href="https://app.example.test/s.css">',
      '<p>x</p><style>@import url(https://app.example.test/s.css);</style>',
      '<p style="background:url(https://app.example.test/t.gif)">x</p>',
      '<p onclick="steal()">x</p>',
      '<p ONMOUSEOVER = "steal()">x</p>',
      '<a href="javascript:steal()">x</a>',
      '<a href="data:text/html,x">x</a>',
      '<p>x</p><svg><circle r="1"/></svg>',
      '<p>x</p><object data="https://app.example.test/"></object>',
      '<p>x</p><embed src="https://app.example.test/">',
      '<form action="https://app.example.test/"><input></form>',
      '<p>x</p><meta http-equiv="refresh" content="0">',
      '<p>x</p><base href="https://app.example.test/">',
      '<p>x</p><video poster="https://app.example.test/p.png"></video>',
      '<p>x</p><!-- hidden -->',
      '<a href="&#106;avascript:steal()">x</a>',
      "<a href='https://app.example.test/x'>x</a>",
      '<a href=https://app.example.test/x>x</a>',
      '<p srcset="https://app.example.test/a.png 1x">x</p>',
    ]) {
      expect(issueOf(syntheticMessage({ html })), html).toBe('unsafe_content');
    }
  });

  it('allows links only to the one approved HTTPS application origin', () => {
    expect(issueOf(syntheticMessage({ html: `<a href="${LINK_ORIGIN}/invite#synthetic">Open</a>` }))).toBe('ok');

    for (const href of [
      'https://elsewhere.example.test/x',
      'http://app.example.test/x',
      'https://app.example.test.elsewhere.example.test/x',
      'https://app.example.test@elsewhere.example.test/x',
      'https://app.example.test:8443/x',
      '//elsewhere.example.test/x',
      '/relative/path',
      'mailto:someone@example.test',
    ]) {
      expect(issueOf(syntheticMessage({ html: `<a href="${href}">x</a>` })), href).toBe('link_not_allowed');
    }

    for (const text of [
      'Visit https://elsewhere.example.test/x now.',
      'Visit http://app.example.test/x now.',
      'Visit https://app.example.test.elsewhere.example.test/x now.',
    ]) {
      expect(issueOf(syntheticMessage({ text })), text).toBe('link_not_allowed');
    }
    expect(issueOf(syntheticMessage({ html: '<p>See https://elsewhere.example.test/x</p>' }))).toBe('link_not_allowed');
  });

  it('refuses provider credentials and other secret-like values in message metadata', () => {
    const key = syntheticApiKey();
    expect(issueOf(syntheticMessage({ subject: `Key ${key}` }))).toBe('secret_like_value');
    expect(issueOf(syntheticMessage({ subject: 'Authorization Bearer abcdefghijklmnop' }))).toBe('secret_like_value');
    expect(issueOf(syntheticMessage({ subject: '-----BEGIN PRIVATE KEY-----' }))).toBe('secret_like_value');
    expect(issueOf(syntheticMessage({ subject: 'whsec_abcdefghijklmnop' }))).toBe('secret_like_value');
    expect(
      issueOf(syntheticMessage({ from: { address: 'no-reply@notify.example.test', name: 'Bearer abcdefghijkl' } })),
    ).toBe('secret_like_value');
  });

  it('never repeats message content in a validation result', () => {
    const message = syntheticMessage({ to: 'NOT-NORMALISED@example.test' });
    const serialised = JSON.stringify(validateEmailMessage(message, POLICY));

    expect(serialised).not.toContain('NOT-NORMALISED');
    expect(serialised).not.toContain(message.subject);
    expect(serialised).not.toContain('SYNTHETIC TEST MESSAGE');
  });
});

describe('email link origin', () => {
  it('accepts one exact HTTPS origin', () => {
    expect(parseLinkOrigin('https://app.example.test', 'production')).toBe('https://app.example.test');
  });

  it('accepts plain HTTP only for a loopback host outside production', () => {
    expect(parseLinkOrigin('http://127.0.0.1:5173', 'test')).toBe('http://127.0.0.1:5173');
    expect(parseLinkOrigin('http://localhost:5173', 'development')).toBe('http://localhost:5173');
    expect(() => parseLinkOrigin('http://127.0.0.1:5173', 'production')).toThrow(EmailConfigurationError);
    expect(() => parseLinkOrigin('http://app.example.test', 'test')).toThrow(EmailConfigurationError);
  });

  it('refuses paths, credentials, queries, fragments, other schemes, and malformed values', () => {
    for (const value of [
      'https://app.example.test/',
      'https://app.example.test/path',
      'https://user:pass@app.example.test',
      'https://app.example.test?x=1',
      'https://app.example.test#x',
      'ftp://app.example.test',
      'app.example.test',
      '',
      ' https://app.example.test',
    ]) {
      expect(() => parseLinkOrigin(value, 'production'), value).toThrow(
        expect.objectContaining({ code: 'link_origin_invalid' }),
      );
    }
  });
});
