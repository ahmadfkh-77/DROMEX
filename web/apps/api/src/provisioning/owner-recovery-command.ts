import { pathToFileURL } from 'node:url';

import type { CommandIO } from './owner-command.ts';

/**
 * The local administrative command for terminal emergency Owner recovery
 * (DEC-437).
 *
 * **Not enabled.** Every invocation except `--help` fails closed: it reads no
 * file, opens no database connection, prompts for nothing, and changes
 * nothing. There is deliberately no flag, environment variable, or other
 * switch that enables it; enabling it is a separate reviewed decision after
 * production secret delivery is approved.
 *
 * What already exists and is tested, against disposable databases only: the
 * argument rules below, the configuration-file loader (`recovery-config.ts`),
 * the recovery prompts (`terminal-recovery-prompt.ts`), and the recovery
 * service (`terminal-recovery.ts`).
 *
 * Argument rules, which hold now and after enabling:
 *
 * - no HTTP surface of any kind;
 * - the only inputs are two file paths, `--config-file` and
 *   `--database-url-file`; a password, code, secret, or connection string is
 *   never accepted as an argument;
 * - no account is ever named on the command line: the target is the single
 *   active Owner recorded in DROMEX;
 * - the environment is never read;
 * - a refused argument is never echoed, because it may be the secret.
 */

export const EXIT_REFUSED = 1;
export const EXIT_USAGE = 2;

const NOT_ENABLED =
  'Terminal Owner recovery is not enabled. Enabling it requires a separate reviewed decision after production secret delivery is approved (DEC-437). Nothing was read or changed.\n';

const HELP = `DROMEX terminal emergency Owner recovery (local administrative command)

NOT ENABLED. Every run is refused: nothing is read, no database is opened, and
nothing is changed. Enabling it requires a separate reviewed decision after
production secret delivery is approved (DEC-437).

Usage:
  node apps/api/src/provisioning/owner-recovery-command.ts --config-file <path> --database-url-file <path>
  node apps/api/src/provisioning/owner-recovery-command.ts --help

Options:
  --config-file <path>        File holding the authentication configuration.
  --database-url-file <path>  File holding the database connection string.
  --help, -h                  Show this help.

Both files must be readable only by their owner. The command targets the single
active Owner recorded in DROMEX and accepts no account argument. The password,
authenticator codes, and confirmations are entered only at the interactive
terminal, never on the command line, in the environment, or in a file.
`;

type Parsed =
  | { kind: 'help' }
  | { kind: 'run'; configFile: string | null; databaseUrlFile: string | null }
  | { kind: 'usage'; message: string };

const FILE_FLAGS = { '--config-file': 'configFile', '--database-url-file': 'databaseUrlFile' } as const;

/** Anything that looks like it carries a password, code, secret, or connection string. */
const SECRET_BEARING = /password|passwd|secret|token|totp|code|database-url(?!-file)|:\/\/|@/i;

function parseArguments(argv: readonly string[]): Parsed {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) return { kind: 'help' };

  const files: { configFile: string | null; databaseUrlFile: string | null } = { configFile: null, databaseUrlFile: null };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';

    if (argument === '--config-file' || argument === '--database-url-file') {
      const key = FILE_FLAGS[argument];
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) {
        return { kind: 'usage', message: `${argument} requires a path.` };
      }
      if (files[key] !== null) return { kind: 'usage', message: `${argument} may be given only once.` };
      files[key] = value;
      index += 1;
      continue;
    }

    if (SECRET_BEARING.test(argument)) {
      return {
        kind: 'usage',
        message: 'Passwords, codes, secrets, and connection strings are never accepted as arguments. The argument was not echoed.',
      };
    }

    return { kind: 'usage', message: `Unrecognised argument at position ${index + 1}. Arguments are not echoed.` };
  }

  return { kind: 'run', ...files };
}

export function runOwnerRecoveryCommand(argv: readonly string[], io: CommandIO): number {
  const parsed = parseArguments(argv);

  if (parsed.kind === 'help') {
    io.stdout.write(HELP);
    return 0;
  }

  if (parsed.kind === 'usage') {
    io.stderr.write(`${parsed.message} Run with --help for usage.\n`);
    return EXIT_USAGE;
  }

  // Not enabled. Deliberately unconditional: no input can pass this gate.
  io.stderr.write(NOT_ENABLED);
  return EXIT_REFUSED;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = runOwnerRecoveryCommand(process.argv.slice(2), {
      stdout: process.stdout,
      stderr: process.stderr,
    });
  } catch {
    process.stderr.write('Terminal Owner recovery failed. No details are shown.\n');
    process.exitCode = EXIT_REFUSED;
  }
}
