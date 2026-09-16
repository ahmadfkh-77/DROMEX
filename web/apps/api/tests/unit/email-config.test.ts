import { describe, expect, it } from 'vitest';

import type { AuthEnvironment } from '../../src/auth/config.ts';
import { loadEmailTransportConfig } from '../../src/email/config.ts';
import { EmailConfigurationError } from '../../src/email/errors.ts';
import { syntheticApiKey } from '../helpers/email.ts';

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
