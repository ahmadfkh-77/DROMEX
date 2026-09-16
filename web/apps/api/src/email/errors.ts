/**
 * Email configuration errors (DEC-439). Every message is fixed text: no path,
 * key, address, or underlying error is ever repeated, because any of them may
 * carry a secret or personal data.
 */

export type EmailConfigurationCode =
  | 'transport_unsupported'
  | 'ambient_secret_refused'
  | 'api_key_file_required'
  | 'api_key_file_unexpected'
  | 'capture_not_allowed_in_production'
  | 'link_origin_invalid'
  | 'platform_unsupported'
  | 'api_key_path_not_absolute'
  | 'api_key_file_unavailable'
  | 'api_key_file_symlink'
  | 'api_key_file_not_regular'
  | 'api_key_file_permissions'
  | 'api_key_file_size'
  | 'api_key_malformed';

const MESSAGES: Record<EmailConfigurationCode, string> = {
  transport_unsupported: 'DROMEX_EMAIL_TRANSPORT must be one of: disabled, capture, resend.',
  ambient_secret_refused:
    'An email provider key was found in the environment. DROMEX accepts the key only through a secret file named by DROMEX_EMAIL_RESEND_API_KEY_FILE. The value itself is not shown.',
  api_key_file_required: 'DROMEX_EMAIL_RESEND_API_KEY_FILE is required when DROMEX_EMAIL_TRANSPORT is resend.',
  api_key_file_unexpected: 'DROMEX_EMAIL_RESEND_API_KEY_FILE is set, but DROMEX_EMAIL_TRANSPORT is not resend.',
  capture_not_allowed_in_production: 'The capture email transport is refused in production.',
  link_origin_invalid:
    'The email link origin must be one exact HTTPS origin; plain HTTP is accepted only for a loopback host outside production.',
  platform_unsupported:
    'The email provider key file cannot be protected on this platform, so the Resend transport is refused. The file is not read.',
  api_key_path_not_absolute: 'DROMEX_EMAIL_RESEND_API_KEY_FILE must be an absolute path.',
  api_key_file_unavailable: 'The email provider key file could not be opened. Its path and contents are not shown.',
  api_key_file_symlink: 'The email provider key file must not be a symbolic link. Its path and contents are not shown.',
  api_key_file_not_regular: 'The email provider key file must be a regular file. Its path and contents are not shown.',
  api_key_file_permissions:
    'The email provider key file must not grant any permission to group or others. Its path and contents are not shown.',
  api_key_file_size: 'The email provider key file is empty or larger than allowed. Its contents are not shown.',
  api_key_malformed: 'The email provider key file does not hold one well-formed key. Its contents are not shown.',
};

export class EmailConfigurationError extends Error {
  readonly code: EmailConfigurationCode;

  constructor(code: EmailConfigurationCode) {
    super(MESSAGES[code]);
    this.name = 'EmailConfigurationError';
    this.code = code;
  }
}
