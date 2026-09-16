import { isAbsolute } from 'node:path';

import type { AuthEnvironment } from '../auth/config.ts';
import { EmailConfigurationError } from './errors.ts';

/**
 * Email transport configuration (DEC-439).
 *
 * The environment arrives as a parameter, as with the API's runtime
 * configuration, and no environment file is ever loaded here. The only accepted
 * provider credential is a path to a secret file; the key itself is read later
 * by the secure loader and is never part of this configuration. A key found
 * directly in the environment is refused rather than used, so there is no
 * ambient fallback. With nothing configured the transport is disabled.
 *
 * Not yet wired to the server: no route or workflow sends email in this
 * checkpoint.
 */

export type EmailTransportConfig =
  | { kind: 'disabled' }
  | { kind: 'capture' }
  | { kind: 'resend'; apiKeyFile: string };

type Environment = Readonly<Record<string, string | undefined>>;

const TRANSPORT = 'DROMEX_EMAIL_TRANSPORT';
const API_KEY_FILE = 'DROMEX_EMAIL_RESEND_API_KEY_FILE';

/** Names under which a provider key might be supplied directly. Each is refused. */
const AMBIENT_KEY_NAMES = [
  'RESEND_API_KEY',
  'DROMEX_EMAIL_RESEND_API_KEY',
  'DROMEX_EMAIL_API_KEY',
  'POSTMARK_SERVER_TOKEN',
] as const;

function present(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

export function loadEmailTransportConfig(env: Environment, environment: AuthEnvironment): EmailTransportConfig {
  for (const name of AMBIENT_KEY_NAMES) {
    if (present(env[name])) throw new EmailConfigurationError('ambient_secret_refused');
  }

  const transport = env[TRANSPORT];
  const apiKeyFile = env[API_KEY_FILE];
  const kind = transport === undefined || transport === '' ? 'disabled' : transport;

  if (kind !== 'resend' && present(apiKeyFile)) throw new EmailConfigurationError('api_key_file_unexpected');

  switch (kind) {
    case 'disabled':
      return { kind: 'disabled' };
    case 'capture':
      if (environment === 'production') throw new EmailConfigurationError('capture_not_allowed_in_production');
      return { kind: 'capture' };
    case 'resend':
      if (!present(apiKeyFile)) throw new EmailConfigurationError('api_key_file_required');
      if (!isAbsolute(apiKeyFile)) throw new EmailConfigurationError('api_key_path_not_absolute');
      return { kind: 'resend', apiKeyFile };
    default:
      throw new EmailConfigurationError('transport_unsupported');
  }
}
