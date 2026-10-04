import { isAbsolute } from 'node:path';

import type { AuthEnvironment, AuthSettings } from '../auth/config.ts';
import { EmailConfigurationError } from './errors.ts';
import { isSecretLike, isValidEmailAddress, isValidSender, parseLinkOrigin, type EmailSender } from './message.ts';

/**
 * Email configuration (DEC-439, DEC-489).
 *
 * The environment arrives as a parameter, as with the API's runtime
 * configuration, and no environment file is ever loaded here. The only accepted
 * provider credential is a path to a secret file; the key itself is read later
 * by the secure loader and is never part of this configuration. A key found
 * directly in the environment is refused rather than used, so there is no
 * ambient fallback. With nothing configured the transport is disabled.
 *
 * `loadEmailTransportConfig` selects a transport. `loadEmailSettings` is what
 * the running server reads (checkpoint 4D): exactly two modes, disabled or
 * Resend, with the public sending identity and link origin validated here, so
 * a partial or invalid configuration stops startup instead of quietly
 * disabling email. Nothing in this module opens a file or a connection.
 */

export type EmailTransportConfig =
  | { kind: 'disabled' }
  | { kind: 'capture' }
  | { kind: 'resend'; apiKeyFile: string };

/** The running server's email settings. Holds only the key file's path, never the key. */
export type EmailSettings =
  | { kind: 'disabled' }
  | { kind: 'resend'; apiKeyFile: string; from: EmailSender; replyTo: string; linkOrigin: string };

type Environment = Readonly<Record<string, string | undefined>>;

const TRANSPORT = 'DROMEX_EMAIL_TRANSPORT';
const API_KEY_FILE = 'DROMEX_EMAIL_RESEND_API_KEY_FILE';
const FROM_ADDRESS = 'DROMEX_EMAIL_FROM_ADDRESS';
const FROM_NAME = 'DROMEX_EMAIL_FROM_NAME';
const REPLY_TO = 'DROMEX_EMAIL_REPLY_TO';
const LINK_ORIGIN = 'DROMEX_EMAIL_LINK_ORIGIN';

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

/**
 * The running server's email settings (DEC-489). The link origin must be one
 * of the trusted browser origins, because the invitation and reset pages post
 * back to the API from it and every such route requires an exact trusted
 * `Origin`; any other origin would make every emailed link fail.
 */
export function loadEmailSettings(
  env: Environment,
  auth: Pick<AuthSettings, 'environment' | 'trustedOrigins'>,
): EmailSettings {
  const transport = loadEmailTransportConfig(env, auth.environment);
  if (transport.kind === 'capture') throw new EmailConfigurationError('capture_not_allowed_in_server');

  const address = env[FROM_ADDRESS];
  const name = env[FROM_NAME];
  const replyTo = env[REPLY_TO];
  const linkOrigin = env[LINK_ORIGIN];
  const supplied = [address, name, replyTo, linkOrigin].filter(present);

  if (transport.kind === 'disabled') {
    if (supplied.length > 0) throw new EmailConfigurationError('email_settings_unexpected');
    return { kind: 'disabled' };
  }

  if (supplied.some(isSecretLike)) throw new EmailConfigurationError('secret_like_setting');
  if (!present(address)) throw new EmailConfigurationError('sender_required');
  if (!present(replyTo)) throw new EmailConfigurationError('reply_to_required');
  if (!present(linkOrigin)) throw new EmailConfigurationError('link_origin_required');

  if (!isValidEmailAddress(address)) throw new EmailConfigurationError('sender_invalid');
  const from: EmailSender = present(name) ? { address, name } : { address };
  if (!isValidSender(from)) throw new EmailConfigurationError('sender_name_invalid');
  if (!isValidEmailAddress(replyTo)) throw new EmailConfigurationError('reply_to_invalid');
  const origin = parseLinkOrigin(linkOrigin, auth.environment);
  if (!auth.trustedOrigins.includes(origin)) throw new EmailConfigurationError('link_origin_not_trusted');

  return { kind: 'resend', apiKeyFile: transport.apiKeyFile, from, replyTo, linkOrigin: origin };
}
