/**
 * TEST-ONLY guard for the end-to-end seed (batch 4b-2, decision D5).
 *
 * The seed creates synthetic accounts, so it must refuse to run against
 * anything but a disposable database created inside a GitHub Actions job. Every
 * condition below must hold; a refusal names the failed condition and never
 * includes the connection string, host, or database name.
 */

export const E2E_FLAG_NAME = 'DROMEX_E2E';
export const E2E_FLAG_VALUE = 'disposable-ci-database';

/** A database created for one CI job: the prefix and sixteen hex characters. */
const DISPOSABLE_DATABASE = /^dromex_e2e_[0-9a-f]{16}$/;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
/** The one port the workflow publishes the disposable container on. */
const DISPOSABLE_PORT = '55432';

type Environment = Readonly<Record<string, string | undefined>>;

function refuse(reason: string): never {
  throw new Error(`The end-to-end seed refuses to run: ${reason}.`);
}

export function assertDisposableCiDatabase(env: Environment): void {
  if (env['GITHUB_ACTIONS'] !== 'true') refuse('it only runs inside a GitHub Actions job');
  if (env[E2E_FLAG_NAME] !== E2E_FLAG_VALUE) refuse(`${E2E_FLAG_NAME} is not set to the disposable-database value`);
  if (typeof env['GITHUB_ENV'] !== 'string' || env['GITHUB_ENV'] === '') refuse('there is no job environment file to write to');

  const raw = env['DATABASE_URL'];
  if (typeof raw !== 'string' || raw === '') refuse('DATABASE_URL is not set');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return refuse('DATABASE_URL is not a valid URL');
  }

  // The pg driver lets query parameters (host, port, dbname, ...) override the
  // URL's own parts, so a URL that looks like loopback could connect elsewhere.
  // A disposable URL therefore carries no query string or fragment at all.
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') refuse('the database URL does not use the postgres scheme');
  if (url.search !== '' || url.hash !== '') refuse('the database URL carries query parameters');
  if (!LOOPBACK_HOSTS.has(url.hostname)) refuse('the database host is not a loopback address');
  if (url.port !== DISPOSABLE_PORT) refuse('the database port is not the disposable container port');
  if (!DISPOSABLE_DATABASE.test(url.pathname.replace(/^\//, ''))) {
    refuse('the database name does not match the disposable pattern');
  }
}
