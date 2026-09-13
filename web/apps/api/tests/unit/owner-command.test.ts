import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { Client, Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runOwnerCommand } from '../../src/provisioning/owner-command.ts';

const COMMAND = fileURLToPath(new URL('../../src/provisioning/owner-command.ts', import.meta.url));

// Synthetic values that must never be echoed anywhere.
const ARG_PASSWORD = 'synthetic argument phrase';
const ENV_PASSWORD = 'synthetic environment phrase';
const ARG_URL = 'postgresql://synthetic_user:synthetic_url_secret@127.0.0.1:1/synthetic_db';

function capture() {
  const out = { stdout: '', stderr: '' };
  return {
    out,
    io: {
      stdout: { write: (chunk: string) => ((out.stdout += chunk), true) },
      stderr: { write: (chunk: string) => ((out.stderr += chunk), true) },
    },
  };
}

function run(argv: string[]) {
  const { out, io } = capture();
  const code = runOwnerCommand(argv, io);
  return { code, ...out, all: `${out.stdout}${out.stderr}` };
}

describe('Owner provisioning command (pre-MFA)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('refuses real execution before MFA exists, exits non-zero, and creates nothing', () => {
    const poolConnect = vi.spyOn(Pool.prototype, 'connect');
    const clientConnect = vi.spyOn(Client.prototype, 'connect');

    const result = run(['--database-url-file', '/nonexistent/synthetic-database-url']);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/unavailable until .*MFA/i);
    expect(result.all).toMatch(/no account was created/i);
    expect(poolConnect).not.toHaveBeenCalled();
    expect(clientConnect).not.toHaveBeenCalled();
  });

  it('refuses with no arguments, the same way', () => {
    const result = run([]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/unavailable until .*MFA/i);
  });

  it('states in its help that it is not approved for real use before MFA', () => {
    const result = run(['--help']);

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/not approved for real use/i);
    expect(result.stdout).toMatch(/MFA/);
    expect(result.stdout).toMatch(/--database-url-file/);
  });

  it.each([
    [['--password', ARG_PASSWORD]],
    [[`--password=${ARG_PASSWORD}`]],
    [['--owner-password', ARG_PASSWORD]],
    [['--database-url', ARG_URL]],
    [[`--database-url=${ARG_URL}`]],
    [[ARG_URL]],
  ])('refuses a secret-bearing argument without echoing it: %j', (argv) => {
    const result = run(argv);

    expect(result.code).not.toBe(0);
    for (const leak of [ARG_PASSWORD, ARG_URL, 'synthetic_url_secret', 'synthetic_user']) {
      expect(result.all).not.toContain(leak);
    }
    expect(result.all).not.toMatch(/unavailable until/i);
  });

  it('refuses an unknown argument without echoing it', () => {
    const result = run(['--synthetic-unknown-flag']);

    expect(result.code).not.toBe(0);
    expect(result.all).not.toContain('synthetic-unknown-flag');
  });

  it('refuses a repeated or valueless --database-url-file', () => {
    expect(run(['--database-url-file']).code).not.toBe(0);
    expect(run(['--database-url-file', 'a', '--database-url-file', 'b']).code).not.toBe(0);
  });

  it('ignores password and connection values in the environment entirely', () => {
    vi.stubEnv('DROMEX_OWNER_PASSWORD', ENV_PASSWORD);
    vi.stubEnv('OWNER_PASSWORD', ENV_PASSWORD);
    vi.stubEnv('DATABASE_URL', ARG_URL);

    const poolConnect = vi.spyOn(Pool.prototype, 'connect');
    const result = run([]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/unavailable until .*MFA/i);
    expect(result.all).not.toContain(ENV_PASSWORD);
    expect(result.all).not.toContain('synthetic_url_secret');
    expect(poolConnect).not.toHaveBeenCalled();
  });

  it('fails closed as a real process, printing no stack and no secret', () => {
    const child = spawnSync(
      process.execPath,
      [COMMAND, '--database-url-file', '/nonexistent/synthetic-database-url'],
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
    expect(output).toMatch(/unavailable until .*MFA/i);
    expect(output).not.toContain(ENV_PASSWORD);
    expect(output).not.toContain('synthetic_url_secret');
    expect(output).not.toMatch(/\n\s+at /);
  });
});
