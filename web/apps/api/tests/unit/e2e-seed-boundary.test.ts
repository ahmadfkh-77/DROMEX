import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { assertDisposableCiDatabase } from '../e2e-support/guard.ts';
import { createSourceTree } from '../helpers/source-tree.ts';

/**
 * The end-to-end seed (batch 4b-2, decision D5) creates synthetic accounts, so
 * it must stay in the test tree, refuse anything but a disposable CI database,
 * and never be reachable from production code.
 */

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const SUPPORT = new URL('../e2e-support/', import.meta.url);
const WORKFLOW = new URL('../../../../../.github/workflows/web-tests.yml', import.meta.url);
const E2E_CONFIG = new URL('../../../web/playwright.e2e.config.ts', import.meta.url);

const tree = createSourceTree(SRC);

const GOOD_ENV = {
  GITHUB_ACTIONS: 'true',
  DROMEX_E2E: 'disposable-ci-database',
  DATABASE_URL: 'postgresql://postgres:placeholder@127.0.0.1:55432/dromex_e2e_0123456789abcdef',
  GITHUB_ENV: '/home/runner/work/_temp/_runner_file_commands/set_env_x',
};

describe('the disposable-database guard', () => {
  it('accepts exactly a CI run pointed at a disposable loopback database', () => {
    expect(() => assertDisposableCiDatabase(GOOD_ENV)).not.toThrow();
  });

  it.each([
    ['not in GitHub Actions', { GITHUB_ACTIONS: undefined }],
    ['the explicit flag is absent', { DROMEX_E2E: undefined }],
    ['the explicit flag has another value', { DROMEX_E2E: 'true' }],
    ['no environment file to write to', { GITHUB_ENV: undefined }],
    ['no database URL', { DATABASE_URL: undefined }],
    ['a database name without the disposable pattern', { DATABASE_URL: 'postgresql://u:p@127.0.0.1:55432/dromex' }],
    ['the development database name', { DATABASE_URL: 'postgresql://u:p@127.0.0.1:55432/dromex_dev' }],
    ['a short disposable-looking name', { DATABASE_URL: 'postgresql://u:p@127.0.0.1:55432/dromex_e2e_01' }],
    ['the development port', { DATABASE_URL: 'postgresql://u:p@127.0.0.1:5433/dromex_e2e_0123456789abcdef' }],
    ['any other port', { DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/dromex_e2e_0123456789abcdef' }],
    ['a missing port', { DATABASE_URL: 'postgresql://u:p@127.0.0.1/dromex_e2e_0123456789abcdef' }],
    ['a host override in the query string', { DATABASE_URL: 'postgresql://u:p@127.0.0.1:55432/dromex_e2e_0123456789abcdef?host=prod.example&port=5433' }],
    ['a database override in the query string', { DATABASE_URL: 'postgresql://u:p@127.0.0.1:55432/dromex_e2e_0123456789abcdef?dbname=production' }],
    ['any query string', { DATABASE_URL: 'postgresql://u:p@127.0.0.1:55432/dromex_e2e_0123456789abcdef?sslmode=disable' }],
    ['a fragment', { DATABASE_URL: 'postgresql://u:p@127.0.0.1:55432/dromex_e2e_0123456789abcdef#x' }],
    ['another scheme', { DATABASE_URL: 'mysql://u:p@127.0.0.1:55432/dromex_e2e_0123456789abcdef' }],
    ['a remote host', { DATABASE_URL: 'postgresql://u:p@db.example.com:55432/dromex_e2e_0123456789abcdef' }],
    ['an unparsable URL', { DATABASE_URL: 'not a url' }],
  ])('refuses %s', (_label, override) => {
    expect(() => assertDisposableCiDatabase({ ...GOOD_ENV, ...override })).toThrow();
  });

  it('never puts the connection string in its error', () => {
    try {
      assertDisposableCiDatabase({ ...GOOD_ENV, DATABASE_URL: 'postgresql://u:topsecret@db.example.com:5432/prod' });
      throw new Error('expected a refusal');
    } catch (error) {
      expect(String((error as Error).message)).not.toMatch(/topsecret|db\.example\.com|prod/);
    }
  });
});

describe('the end-to-end seed boundary', () => {
  it('is not referenced from any production file', async () => {
    const files = await tree.files();
    expect(files.length).toBeGreaterThan(20);
    const offenders: string[] = [];
    for (const file of files) {
      if (/e2e-support|tests\/helpers|seed\.ts/.test(await tree.code(file))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('calls the guard before it opens any database connection', async () => {
    const seed = await readFile(new URL('seed.ts', SUPPORT), 'utf8');
    const guard = seed.indexOf('assertDisposableCiDatabase(');
    const pool = seed.indexOf('new Pool(');
    expect(guard).toBeGreaterThan(-1);
    expect(pool).toBeGreaterThan(guard);
  });

  it('never uses the Owner activation code, a route, or a server', async () => {
    for (const name of ['seed.ts', 'guard.ts']) {
      const text = (await readFile(new URL(name, SUPPORT), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(text).not.toMatch(/provisioning|owner-command|owner-activation|owner-recovery|terminal/i);
      expect(text).not.toMatch(/\bfastify\b|\.listen\(|app\.(get|post|put|delete)\(|buildServer/i);
    }
  });

  it('masks every secret before it writes it to the environment file', async () => {
    const seed = await readFile(new URL('seed.ts', SUPPORT), 'utf8');
    expect(seed.indexOf('::add-mask::')).toBeGreaterThan(-1);
    expect(seed.indexOf('::add-mask::')).toBeLessThan(seed.indexOf('appendFileSync('));
  });
});

describe('the end-to-end workflow and configuration', () => {
  it('does not trace, record, upload artifacts, or echo commands', async () => {
    const workflow = await readFile(WORKFLOW, 'utf8');
    expect(workflow).not.toMatch(/upload-artifact/);
    expect(workflow).not.toMatch(/set -[a-z]*x/);
    expect(workflow).not.toMatch(/actions\/cache@/);

    const config = await readFile(E2E_CONFIG, 'utf8');
    expect(config).toMatch(/retries:\s*0/);
    expect(config).toMatch(/workers:\s*1/);
    expect(config).toMatch(/trace:\s*'off'/);
    expect(config).toMatch(/video:\s*'off'/);
    expect(config).toMatch(/screenshot:\s*'off'/);
    expect(config).toMatch(/reporter:\s*\[\['line'\], \['json', \{ outputFile:/);
  });

  it('masks each generated secret before it is written to the environment file', async () => {
    const workflow = await readFile(WORKFLOW, 'utf8');
    const database = workflow.indexOf('E2E database');
    expect(database).toBeGreaterThan(-1);
    const step = workflow.slice(database);
    for (const secret of ['db_password', 'auth_secret']) {
      expect(step.indexOf(`::add-mask::$${secret}`)).toBeGreaterThan(-1);
      expect(step.indexOf(`::add-mask::$${secret}`)).toBeLessThan(step.indexOf('>> "$GITHUB_ENV"'));
    }
  });
});
