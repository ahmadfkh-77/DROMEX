import { describe, expect, it } from 'vitest';

import type { AuthEnvironment } from '../../src/auth/config.ts';
import { loadEmailSettings, loadEmailTransportConfig } from '../../src/email/config.ts';
import { EmailConfigurationError } from '../../src/email/errors.ts';
import { LINK_ORIGIN, syntheticApiKey } from '../helpers/email.ts';

const KEY_FILE = '/run/secrets/synthetic_email_api_key';
const ENVIRONMENTS: AuthEnvironment[] = ['development', 'test', 'production'];

function codeOf(run: () => unknown): string {
  try {
    run();
    return 'returned';
  } catch (error) {
    expect(error).toBeInstanceOf(EmailConfigurationError);
    return (error as EmailConfigurationError).code;
  }
}

describe('email transport configuration', () => {
  it('defaults to the disabled transport when nothing is configured', () => {
    for (const environment of ENVIRONMENTS) {
      expect(loadEmailTransportConfig({}, environment)).toEqual({ kind: 'disabled' });
      expect(loadEmailTransportConfig({ DROMEX_EMAIL_TRANSPORT: '' }, environment)).toEqual({ kind: 'disabled' });
      expect(loadEmailTransportConfig({ DROMEX_EMAIL_TRANSPORT: 'disabled' }, environment)).toEqual({
        kind: 'disabled',
      });
    }
  });

  it('allows the capture transport outside production only', () => {
    expect(loadEmailTransportConfig({ DROMEX_EMAIL_TRANSPORT: 'capture' }, 'test')).toEqual({ kind: 'capture' });
    expect(loadEmailTransportConfig({ DROMEX_EMAIL_TRANSPORT: 'capture' }, 'development')).toEqual({
      kind: 'capture',
    });
    expect(codeOf(() => loadEmailTransportConfig({ DROMEX_EMAIL_TRANSPORT: 'capture' }, 'production'))).toBe(
      'capture_not_allowed_in_production',
    );
  });

  it('refuses an unsupported transport name', () => {
    for (const value of ['smtp', 'postmark', 'RESEND', 'Resend', ' resend', 'ses', 'console']) {
      expect(codeOf(() => loadEmailTransportConfig({ DROMEX_EMAIL_TRANSPORT: value }, 'test')), value).toBe(
        'transport_unsupported',
      );
    }
  });

  it('requires a key file path for Resend and returns only the path', () => {
    for (const environment of ENVIRONMENTS) {
      expect(codeOf(() => loadEmailTransportConfig({ DROMEX_EMAIL_TRANSPORT: 'resend' }, environment))).toBe(
        'api_key_file_required',
      );
      expect(
        codeOf(() =>
          loadEmailTransportConfig({ DROMEX_EMAIL_TRANSPORT: 'resend', DROMEX_EMAIL_RESEND_API_KEY_FILE: '  ' }, environment),
        ),
      ).toBe('api_key_file_required');

      const config = loadEmailTransportConfig(
        { DROMEX_EMAIL_TRANSPORT: 'resend', DROMEX_EMAIL_RESEND_API_KEY_FILE: KEY_FILE },
        environment,
      );
      expect(config).toEqual({ kind: 'resend', apiKeyFile: KEY_FILE });
    }
  });

  it('refuses a relative key file path', () => {
    for (const environment of ENVIRONMENTS) {
      expect(
        codeOf(() =>
          loadEmailTransportConfig(
            { DROMEX_EMAIL_TRANSPORT: 'resend', DROMEX_EMAIL_RESEND_API_KEY_FILE: 'secrets/resend' },
            environment,
          ),
        ),
      ).toBe('api_key_path_not_absolute');
    }
  });

  it('refuses a key file path when Resend is not selected', () => {
    for (const transport of [undefined, 'disabled', 'capture']) {
      expect(
        codeOf(() =>
          loadEmailTransportConfig(
            { DROMEX_EMAIL_TRANSPORT: transport, DROMEX_EMAIL_RESEND_API_KEY_FILE: KEY_FILE },
            'test',
          ),
        ),
      ).toBe('api_key_file_unexpected');
    }
  });

  it('refuses any ambient provider key instead of falling back to it, without repeating the value', () => {
    const key = syntheticApiKey();
    for (const name of ['RESEND_API_KEY', 'DROMEX_EMAIL_RESEND_API_KEY', 'DROMEX_EMAIL_API_KEY', 'POSTMARK_SERVER_TOKEN']) {
      for (const transport of [undefined, 'disabled', 'resend']) {
        let caught: unknown;
        try {
          loadEmailTransportConfig(
            {
              DROMEX_EMAIL_TRANSPORT: transport,
              ...(transport === 'resend' ? { DROMEX_EMAIL_RESEND_API_KEY_FILE: KEY_FILE } : {}),
              [name]: key,
            },
            'production',
          );
        } catch (error) {
          caught = error;
        }
        expect((caught as EmailConfigurationError).code, `${name}/${transport}`).toBe('ambient_secret_refused');
        expect(String(caught)).not.toContain(key);
        expect((caught as Error).stack ?? '').not.toContain(key);
      }
    }
  });

  it('reads only the environment object it is given', () => {
    const env = new Proxy<Record<string, string | undefined>>(
      { DROMEX_EMAIL_TRANSPORT: 'resend', DROMEX_EMAIL_RESEND_API_KEY_FILE: KEY_FILE },
      {
        get(target, property) {
          if (typeof property !== 'string') return undefined;
          expect(property).toMatch(/^(DROMEX_EMAIL_[A-Z_]+|RESEND_API_KEY|POSTMARK_SERVER_TOKEN)$/);
          return target[property];
        },
      },
    );
    expect(loadEmailTransportConfig(env, 'production')).toEqual({ kind: 'resend', apiKeyFile: KEY_FILE });
  });
});

/**
 * The running server's email settings (checkpoint 4D, DEC-489): exactly two
 * modes, disabled or Resend, with the public sending identity and link origin
 * validated before any file is opened. Every value here is synthetic.
 */
describe('running-server email settings', () => {
  const SENDER = 'no-reply@notify.example.test';
  const REPLY_TO = 'support@example.test';
  const IDENTITY_NAMES = [
    'DROMEX_EMAIL_FROM_ADDRESS',
    'DROMEX_EMAIL_FROM_NAME',
    'DROMEX_EMAIL_REPLY_TO',
    'DROMEX_EMAIL_LINK_ORIGIN',
  ] as const;

  function auth(environment: AuthEnvironment = 'production', trustedOrigins: string[] = [LINK_ORIGIN]) {
    return { environment, trustedOrigins };
  }

  function enabled(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
    return {
      DROMEX_EMAIL_TRANSPORT: 'resend',
      DROMEX_EMAIL_RESEND_API_KEY_FILE: KEY_FILE,
      DROMEX_EMAIL_FROM_ADDRESS: SENDER,
      DROMEX_EMAIL_FROM_NAME: 'DROMEX',
      DROMEX_EMAIL_REPLY_TO: REPLY_TO,
      DROMEX_EMAIL_LINK_ORIGIN: LINK_ORIGIN,
      ...overrides,
    };
  }

  /** The refusal code, after proving the message and stack repeat none of the given values. */
  function refusal(env: Record<string, string | undefined>, context = auth(), hidden: string[] = []): string {
    let caught: unknown;
    try {
      loadEmailSettings(env, context);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EmailConfigurationError);
    const text = `${String(caught)}\n${(caught as Error).stack ?? ''}`;
    for (const value of hidden) expect(text, value).not.toContain(value);
    return (caught as EmailConfigurationError).code;
  }

  it('is disabled when nothing is configured, in every environment, and opens nothing', () => {
    for (const environment of ENVIRONMENTS) {
      for (const env of [{}, { DROMEX_EMAIL_TRANSPORT: '' }, { DROMEX_EMAIL_TRANSPORT: 'disabled' }]) {
        expect(loadEmailSettings(env, auth(environment))).toEqual({ kind: 'disabled' });
      }
    }
  });

  it('returns the complete Resend settings, and only the key file path, when every setting is valid', () => {
    expect(loadEmailSettings(enabled(), auth())).toEqual({
      kind: 'resend',
      apiKeyFile: KEY_FILE,
      from: { address: SENDER, name: 'DROMEX' },
      replyTo: REPLY_TO,
      linkOrigin: LINK_ORIGIN,
    });
  });

  it('treats the sender display name as optional', () => {
    for (const name of [undefined, '']) {
      expect(loadEmailSettings(enabled({ DROMEX_EMAIL_FROM_NAME: name }), auth())).toEqual({
        kind: 'resend',
        apiKeyFile: KEY_FILE,
        from: { address: SENDER },
        replyTo: REPLY_TO,
        linkOrigin: LINK_ORIGIN,
      });
    }
  });

  it('fails closed on partial Resend configuration, naming the missing setting', () => {
    const cases = [
      ['DROMEX_EMAIL_FROM_ADDRESS', 'sender_required'],
      ['DROMEX_EMAIL_REPLY_TO', 'reply_to_required'],
      ['DROMEX_EMAIL_LINK_ORIGIN', 'link_origin_required'],
      ['DROMEX_EMAIL_RESEND_API_KEY_FILE', 'api_key_file_required'],
    ] as const;
    for (const [name, code] of cases) {
      for (const absent of [undefined, '', '   ']) {
        let caught: unknown;
        try {
          loadEmailSettings(enabled({ [name]: absent }), auth());
        } catch (error) {
          caught = error;
        }
        expect((caught as EmailConfigurationError).code, `${name}=${String(absent)}`).toBe(code);
        expect((caught as Error).message).toContain(name);
      }
    }
  });

  it('never falls back to disabled when email settings are present without a provider', () => {
    for (const transport of [undefined, '', 'disabled']) {
      for (const name of IDENTITY_NAMES) {
        // A distinctive name, since the fixed messages themselves contain the word DROMEX.
        const value = name === 'DROMEX_EMAIL_FROM_NAME' ? 'Synthetic Sender' : enabled()[name]!;
        expect(
          refusal({ DROMEX_EMAIL_TRANSPORT: transport, [name]: value }, auth(), [value]),
          `${name} with ${String(transport)}`,
        ).toBe('email_settings_unexpected');
      }
    }
  });

  it('refuses the capture transport in the running server, which accepts only disabled or resend', () => {
    for (const environment of ['development', 'test'] as const) {
      expect(refusal({ DROMEX_EMAIL_TRANSPORT: 'capture' }, auth(environment))).toBe('capture_not_allowed_in_server');
    }
    expect(refusal({ DROMEX_EMAIL_TRANSPORT: 'capture' }, auth('production'))).toBe('capture_not_allowed_in_production');
  });

  it('refuses an unsupported provider or enabled flag', () => {
    for (const value of ['true', 'enabled', 'yes', '1', 'postmark', 'smtp', 'RESEND', ' resend']) {
      expect(refusal({ DROMEX_EMAIL_TRANSPORT: value }, auth()), value).toBe(
        'transport_unsupported',
      );
    }
  });

  it('refuses an invalid sender address without repeating it', () => {
    for (const value of [
      'No-Reply@notify.example.test',
      'no-reply',
      'no-reply@localhost',
      'DROMEX <no-reply@notify.example.test>',
      ' no-reply@notify.example.test',
      'no-reply@notify.example.test\r\nBcc: someone@example.test',
      'first@example.test,second@example.test',
    ]) {
      expect(refusal(enabled({ DROMEX_EMAIL_FROM_ADDRESS: value }), auth(), [value]), value).toBe('sender_invalid');
    }
  });

  it('refuses an invalid sender display name without repeating it', () => {
    for (const value of ['Sender\r\nBcc: someone', ' Sender', 'Sender ', 'Sen<der>', '"Sender"', 'S'.repeat(65), 'Sender; x']) {
      expect(refusal(enabled({ DROMEX_EMAIL_FROM_NAME: value }), auth(), [value]), JSON.stringify(value)).toBe(
        'sender_name_invalid',
      );
    }
  });

  it('refuses an invalid Reply-To address without repeating it', () => {
    for (const value of ['Support@Example.test', 'support', 'Support <support@example.test>', 'support@example.test\nX: y']) {
      expect(refusal(enabled({ DROMEX_EMAIL_REPLY_TO: value }), auth(), [value]), value).toBe('reply_to_invalid');
    }
  });

  it('refuses a link origin that is not one exact origin', () => {
    for (const value of [
      `${LINK_ORIGIN}/`,
      `${LINK_ORIGIN}/invitation`,
      `${LINK_ORIGIN}?x=1`,
      'app.example.test',
      'https://user@app.example.test',
      'javascript:alert(1)',
      'https://*.example.test',
      'HTTPS://APP.EXAMPLE.TEST',
    ]) {
      expect(refusal(enabled({ DROMEX_EMAIL_LINK_ORIGIN: value }), auth('production', [LINK_ORIGIN, value])), value).toBe(
        'link_origin_invalid',
      );
    }
  });

  it('requires HTTPS in production and allows plain HTTP only for a trusted loopback origin elsewhere', () => {
    for (const value of ['http://app.example.test', 'http://127.0.0.1:5173', 'http://localhost:5173']) {
      expect(refusal(enabled({ DROMEX_EMAIL_LINK_ORIGIN: value }), auth('production', [value])), value).toBe(
        'link_origin_invalid',
      );
    }
    expect(refusal(enabled({ DROMEX_EMAIL_LINK_ORIGIN: 'http://app.example.test' }), auth('development', ['http://app.example.test']))).toBe(
      'link_origin_invalid',
    );
    const loopback = 'http://127.0.0.1:5173';
    expect(loadEmailSettings(enabled({ DROMEX_EMAIL_LINK_ORIGIN: loopback }), auth('development', [loopback]))).toMatchObject({
      kind: 'resend',
      linkOrigin: loopback,
    });
  });

  it('requires the link origin to be one of the trusted browser origins, so every link can reach the API', () => {
    expect(refusal(enabled(), auth('production', ['https://other.example.test']), [LINK_ORIGIN])).toBe(
      'link_origin_not_trusted',
    );
    expect(refusal(enabled(), auth('production', []))).toBe('link_origin_not_trusted');
    expect(refusal(enabled(), auth('production', [`${LINK_ORIGIN}.evil.example`]))).toBe('link_origin_not_trusted');
  });

  it('refuses a provider key pasted into any public setting, without repeating it', () => {
    const key = syntheticApiKey();
    const cases: Array<[string, string]> = [
      ['DROMEX_EMAIL_FROM_NAME', key],
      ['DROMEX_EMAIL_FROM_ADDRESS', `${key.toLowerCase()}@notify.example.test`],
      ['DROMEX_EMAIL_REPLY_TO', `${key.toLowerCase()}@example.test`],
    ];
    for (const [name, value] of cases) {
      expect(refusal(enabled({ [name]: value }), auth(), [key, key.toLowerCase(), value]), name).toBe('secret_like_setting');
    }
  });

  it('refuses a directly supplied provider key in either mode, without repeating it', () => {
    const key = syntheticApiKey();
    for (const name of ['RESEND_API_KEY', 'DROMEX_EMAIL_RESEND_API_KEY', 'DROMEX_EMAIL_API_KEY', 'POSTMARK_SERVER_TOKEN']) {
      expect(refusal({ [name]: key }, auth(), [key]), name).toBe('ambient_secret_refused');
      expect(refusal(enabled({ [name]: key }), auth(), [key]), name).toBe('ambient_secret_refused');
    }
  });

  it('reads only the environment object and settings it is given', () => {
    const env = new Proxy<Record<string, string | undefined>>(enabled(), {
      get(target, property) {
        if (typeof property !== 'string') return undefined;
        expect(property).toMatch(/^(DROMEX_EMAIL_[A-Z_]+|RESEND_API_KEY|POSTMARK_SERVER_TOKEN)$/);
        return target[property];
      },
    });
    expect(loadEmailSettings(env, auth())).toMatchObject({ kind: 'resend' });
  });
});
