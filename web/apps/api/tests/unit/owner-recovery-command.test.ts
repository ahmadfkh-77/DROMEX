import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client, Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runOwnerRecoveryCommand } from '../../src/provisioning/owner-recovery-command.ts';

const COMMAND = fileURLToPath(new URL('../../src/provisioning/owner-recovery-command.ts', import.meta.url));

// Synthetic values that must never be echoed anywhere.
const ARG_PASSWORD = 'synthetic recovery argument phrase';
const ENV_PASSWORD = 'synthetic recovery environment phrase';
const ARG_URL = 'postgresql://synthetic_user:synthetic_url_secret@127.0.0.1:1/synthetic_db';
const FILE_CANARY = 'synthetic-config-file-canary-value';

function run(argv: string[]) {
  const out = { stdout: '', stderr: '' };
  const code = runOwnerRecoveryCommand(argv, {
    stdout: { write: (chunk: string) => ((out.stdout += chunk), true) },
    stderr: { write: (chunk: string) => ((out.stderr += chunk), true) },
  });
  return { code, ...out, all: `${out.stdout}${out.stderr}` };
}

const directories: string[] = [];

async function syntheticFiles() {
  const directory = await mkdtemp(join(tmpdir(), 'dromex-recovery-command-'));
  directories.push(directory);
  const configFile = join(directory, 'config.json');
  const databaseUrlFile = join(directory, 'database-url');
  await writeFile(configFile, JSON.stringify({ canary: FILE_CANARY }), { mode: 0o600 });
  await writeFile(databaseUrlFile, `${ARG_URL}\n`, { mode: 0o600 });
  return { configFile, databaseUrlFile };
}

describe('terminal Owner recovery command (not enabled)', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    while (directories.length > 0) await rm(directories.pop()!, { recursive: true, force: true });
  });

  it('refuses every real run, exits non-zero, reads nothing it prints, and opens no connection', async () => {
    const poolConnect = vi.spyOn(Pool.prototype, 'connect');
    const clientConnect = vi.spyOn(Client.prototype, 'connect');
    const files = await syntheticFiles();

    const result = run(['--config-file', files.configFile, '--database-url-file', files.databaseUrlFile]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/not enabled/i);
    expect(result.all).toMatch(/nothing was read or changed/i);
    for (const leak of [FILE_CANARY, 'synthetic_url_secret', files.configFile, files.databaseUrlFile]) {
      expect(result.all).not.toContain(leak);
    }
    expect(poolConnect).not.toHaveBeenCalled();
    expect(clientConnect).not.toHaveBeenCalled();
  });

  it('refuses with no arguments, the same way', () => {
    const result = run([]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/not enabled/i);
  });

  it('states in its help that it is not enabled and names only file-path inputs', () => {
    const result = run(['--help']);

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/not enabled/i);
    expect(result.stdout).toMatch(/separate reviewed decision/i);
    expect(result.stdout).toMatch(/--config-file/);
    expect(result.stdout).toMatch(/--database-url-file/);
    expect(result.stdout).not.toMatch(/--password|--email|--user-id/);
  });

  it.each([
    [['--password', ARG_PASSWORD]],
    [[`--password=${ARG_PASSWORD}`]],
    [['--totp', '123456']],
    [['--recovery-code', 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01']],
    [['--secret', ARG_PASSWORD]],
    [['--database-url', ARG_URL]],
    [[`--database-url=${ARG_URL}`]],
    [[ARG_URL]],
  ])('refuses a secret-bearing argument without echoing it: %j', (argv) => {
    const result = run(argv);

    expect(result.code).not.toBe(0);
    for (const leak of [ARG_PASSWORD, ARG_URL, 'synthetic_url_secret', 'synthetic_user', '123456', 'ABCD-EFGH']) {
      expect(result.all).not.toContain(leak);
    }
    expect(result.all).not.toMatch(/not enabled/i);
  });

  it.each([
    [['--email', 'owner@synthetic.invalid']],
    [['--user-id', 'user_synthetic_target']],
    [['--synthetic-unknown-flag']],
  ])('accepts no target argument and echoes nothing: %j', (argv) => {
    const result = run(argv);

    expect(result.code).not.toBe(0);
    for (const leak of ['owner@synthetic.invalid', 'user_synthetic_target', 'synthetic-unknown-flag']) {
      expect(result.all).not.toContain(leak);
    }
  });

  it('refuses a repeated or valueless file argument', () => {
    expect(run(['--config-file']).code).not.toBe(0);
    expect(run(['--database-url-file']).code).not.toBe(0);
    expect(run(['--config-file', 'a', '--config-file', 'b']).code).not.toBe(0);
    expect(run(['--database-url-file', 'a', '--database-url-file', 'b']).code).not.toBe(0);
  });

  it('ignores password and connection values in the environment entirely', () => {
    vi.stubEnv('DROMEX_OWNER_PASSWORD', ENV_PASSWORD);
    vi.stubEnv('DATABASE_URL', ARG_URL);
    const poolConnect = vi.spyOn(Pool.prototype, 'connect');

    const result = run([]);

    expect(result.code).not.toBe(0);
    expect(result.all).not.toContain(ENV_PASSWORD);
    expect(result.all).not.toContain('synthetic_url_secret');
    expect(poolConnect).not.toHaveBeenCalled();
  });

  it('fails closed as a real process, printing no stack and no secret', async () => {
    const files = await syntheticFiles();

    const child = spawnSync(
      process.execPath,
      [COMMAND, '--config-file', files.configFile, '--database-url-file', files.databaseUrlFile],
      {
        encoding: 'utf8',
        env: { PATH: process.env['PATH'] ?? '', DROMEX_OWNER_PASSWORD: ENV_PASSWORD, DATABASE_URL: ARG_URL },
        input: `${ENV_PASSWORD}\n`,
        timeout: 20_000,
      },
    );

    const output = `${child.stdout}${child.stderr}`;
    expect(child.status).not.toBe(0);
    expect(child.status).not.toBeNull();
    expect(output).toMatch(/not enabled/i);
    for (const leak of [ENV_PASSWORD, 'synthetic_url_secret', FILE_CANARY]) expect(output).not.toContain(leak);
    expect(output).not.toMatch(/\n\s+at /);
  });
});
