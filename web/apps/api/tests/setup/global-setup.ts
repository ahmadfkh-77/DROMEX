import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  interface ProvidedContext {
    testDatabaseUri: string;
  }
}

/** The local development service. Tests must never touch it. */
const DEVELOPMENT_PORT = '5433';
const DEVELOPMENT_DATABASE = 'dromex_dev';

/**
 * Fails loudly rather than letting a misconfiguration write into development
 * data. A test suite that silently runs against the development database is
 * far worse than one that refuses to start.
 */
export function assertNotDevelopmentDatabase(uri: string): void {
  const parsed = new URL(uri);

  if (parsed.port === DEVELOPMENT_PORT) {
    throw new Error(
      `Refusing to run tests against port ${DEVELOPMENT_PORT}: that is the development database.`,
    );
  }

  if (parsed.pathname.replace(/^\//, '') === DEVELOPMENT_DATABASE) {
    throw new Error(
      `Refusing to run tests against database "${DEVELOPMENT_DATABASE}": that is the development database.`,
    );
  }
}

let container: StartedPostgreSqlContainer | undefined;

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  container = await new PostgreSqlContainer('postgres:18.6-trixie')
    .withDatabase('dromex_test')
    .withUsername('dromex_test')
    .withPassword('dromex_test_local_only')
    .start();

  const uri = container.getConnectionUri();
  assertNotDevelopmentDatabase(uri);

  project.provide('testDatabaseUri', uri);

  return async () => {
    await container?.stop();
  };
}
