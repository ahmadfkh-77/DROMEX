import { pathToFileURL } from 'node:url';

/**
 * The local administrative command for creating the DROMEX Owner.
 *
 * **Not approved for real use.** Production Owner provisioning is forbidden
 * until mandatory MFA and recovery are implemented and separately approved
 * (DEC-421, DEC-423). Until then this entry point fails closed on every
 * invocation except `--help`: it reads no file, opens no database connection,
 * prompts for nothing, and creates nothing. There is deliberately no flag,
 * environment variable, or other switch that enables it; enabling it is a
 * reviewed code change in a later checkpoint.
 *
 * What already exists and is tested, against disposable databases only: the
 * argument rules below, the hidden terminal prompt (`terminal-prompt.ts`),
 * and the resumable provisioning service (`owner-provisioning.ts`).
 *
 * Argument rules, which hold now and after enabling:
 *
 * - no HTTP surface of any kind;
 * - a password is never accepted as an argument, and neither is a database
 *   connection string; the only accepted input is `--database-url-file`, the
 *   path to a file holding the connection string, never the string itself;
 * - the environment is never read, so it cannot supply a password or a
 *   connection;
 * - a refused argument is never echoed, because it may be the secret.
 */

export interface CommandOutput {
  write(chunk: string): unknown;
}

export interface CommandIO {
  stdout: CommandOutput;
  stderr: CommandOutput;
}

export const EXIT_REFUSED = 1;
export const EXIT_USAGE = 2;

const PRE_MFA_REFUSAL =
  'Production Owner provisioning is unavailable until mandatory MFA and recovery are implemented and approved. No account was created.\n';

const HELP = `DROMEX Owner provisioning (local administrative command)

NOT APPROVED FOR REAL USE. Production Owner provisioning is unavailable until
mandatory MFA and recovery are implemented and separately approved. Every run
is refused and no account is created.

Usage:
  node apps/api/src/provisioning/owner-command.ts --database-url-file <path>
  node apps/api/src/provisioning/owner-command.ts --help

Options:
  --database-url-file <path>  Path to a file containing the database connection
                              string. The connection string itself is never
                              accepted as an argument or read from the
                              environment.
  --help, -h                  Show this help.

When enabled in a later checkpoint, the command will ask for the Owner name and
email, and for the password and its confirmation through a hidden prompt in an
interactive terminal. A password is never accepted as an argument, from the
environment, from a file, or from piped input.
`;

type Parsed =
  | { kind: 'help' }
  | { kind: 'run'; databaseUrlFile: string | null }
  | { kind: 'usage'; message: string };

/** Anything that looks like it carries a password or a connection string. */
const SECRET_BEARING = /password|passwd|secret|token|database-url(?!-file)|:\/\/|@/i;

function parseArguments(argv: readonly string[]): Parsed {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) return { kind: 'help' };

  let databaseUrlFile: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';

    if (argument === '--database-url-file') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) {
        return { kind: 'usage', message: '--database-url-file requires a path.' };
      }
      if (databaseUrlFile !== null) {
        return { kind: 'usage', message: '--database-url-file may be given only once.' };
      }
      databaseUrlFile = value;
      index += 1;
      continue;
    }

    if (SECRET_BEARING.test(argument)) {
      return {
        kind: 'usage',
        message:
          'Passwords and connection strings are never accepted as arguments. The argument was not echoed.',
      };
    }

    return {
      kind: 'usage',
      message: `Unrecognised argument at position ${index + 1}. Arguments are not echoed.`,
    };
  }

  return { kind: 'run', databaseUrlFile };
}

export function runOwnerCommand(argv: readonly string[], io: CommandIO): number {
  const parsed = parseArguments(argv);

  if (parsed.kind === 'help') {
    io.stdout.write(HELP);
    return 0;
  }

  if (parsed.kind === 'usage') {
    io.stderr.write(`${parsed.message} Run with --help for usage.\n`);
    return EXIT_USAGE;
  }

  // Pre-MFA gate. Deliberately unconditional: no input can pass it.
  io.stderr.write(PRE_MFA_REFUSAL);
  return EXIT_REFUSED;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = runOwnerCommand(process.argv.slice(2), {
      stdout: process.stdout,
      stderr: process.stderr,
    });
  } catch {
    process.stderr.write('Owner provisioning failed. No details are shown.\n');
    process.exitCode = EXIT_REFUSED;
  }
}
