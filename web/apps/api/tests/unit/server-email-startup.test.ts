import { spawn } from 'node:child_process';
import { chmod, mkdtemp, open as openFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeConfig } from '../../src/config/runtime.ts';
import type { EmailSettings } from '../../src/email/config.ts';
import type { SecretFileOpener } from '../../src/email/secret-file.ts';
import { buildServer, buildServerFromConfig } from '../../src/server.ts';
import {
  TEST_BASE_URL,
  TEST_TRUSTED_ORIGIN,
  UNREACHABLE_DATABASE_URL,
  settle,
  syntheticAuthSettings,
  syntheticSecret,
} from '../helpers/auth-settings.ts';
import { LINK_ORIGIN, fakeResendEnvironment, syntheticApiKey } from '../helpers/email.ts';

/**
 * Checkpoint 4D (DEC-489): the running server builds its email delivery once,
 * at startup, from validated configuration. Startup only validates local
 * configuration: it never sends a message, never contacts the provider, and
 * exposes no route that reveals whether email is configured. Every key, file,
 * and address here is synthetic; no test reaches the network.
 */

const POSIX = process.platform !== 'win32';
const SERVER_ENTRY = fileURLToPath(new URL('../../src/server.ts', import.meta.url));
// Node 24 strips types by default, as the container runs it. Node 22 (the
// Windows development host) needs the flag, or every child fails before
// reaching DROMEX code.
const STRIP_TYPES = Number(process.versions.node.split('.')[0]) < 23 ? ['--experimental-strip-types'] : [];
const FROM = { address: 'no-reply@notify.example.test', name: 'DROMEX' };
const REPLY_TO = 'support@example.test';

const servers: FastifyInstance[] = [];
let directory: string | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await settle(50);
  while (servers.length > 0) await servers.pop()!.close();
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

function config(email: EmailSettings): RuntimeConfig {
  return {
    databaseUrl: UNREACHABLE_DATABASE_URL,
    host: '127.0.0.1',
    port: 3000,
    auth: syntheticAuthSettings({ trustedOrigins: [TEST_TRUSTED_ORIGIN, LINK_ORIGIN] }),
    email,
  };
}

function logCollector() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  return { stream, text: () => lines.join('') };
}

function recordingOpener(delegate?: SecretFileOpener) {
  const paths: string[] = [];
  const open: SecretFileOpener = async (path, flags) => {
    paths.push(path);
    if (delegate === undefined) throw new Error('must not open');
    return delegate(path, flags);
  };
  return { open, paths };
}

function watchNetwork() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('network must not be used');
  });
}

async function syntheticKeyFile(key: string, mode = 0o600): Promise<string> {
  directory ??= await mkdtemp(join(tmpdir(), 'dromex-server-email-'));
  const path = join(directory, 'resend-key');
  await writeFile(path, `${key}\n`, { mode });
  await chmod(path, mode);
  return path;
}

function routesOf(app: FastifyInstance) {
  return [...app.routeAccess.entries()].sort(([a], [b]) => a.localeCompare(b));
}

describe('server startup with email disabled', () => {
  it('starts without opening a secret file, building a transport, or touching the network', async () => {
    const network = watchNetwork();
    const opener = recordingOpener();
    const logs = logCollector();

    const app = await buildServerFromConfig(config({ kind: 'disabled' }), {
      logStream: logs.stream,
      secretFile: { open: opener.open },
    });
    servers.push(app);
    await app.ready();

    expect(opener.paths).toEqual([]);
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });
    expect(network).not.toHaveBeenCalled();

    const text = logs.text();
    expect(text).toContain('"emailDelivery":"disabled"');
    expect(text).not.toMatch(/\b(?:was|were|has been|have been) sent\b|\bdelivered\b|provider accepted/i);
  });

  it('exposes exactly the same route surface as a server built without any email option', async () => {
    const plain = await buildServer({ databaseUrl: UNREACHABLE_DATABASE_URL, auth: config({ kind: 'disabled' }).auth });
    servers.push(plain);
    const disabled = await buildServerFromConfig(config({ kind: 'disabled' }));
    servers.push(disabled);
    await Promise.all([plain.ready(), disabled.ready()]);

    expect(routesOf(disabled)).toEqual(routesOf(plain));
  });
});

describe.runIf(POSIX)('server startup with Resend configured (synthetic key file)', () => {
  it('loads the key once, sends nothing, and keeps /health, /ready, and the route surface independent of email', async () => {
    const network = watchNetwork();
    const key = syntheticApiKey();
    const path = await syntheticKeyFile(key);
    const opener = recordingOpener((file, flags) => openFile(file, flags));
    const provider = fakeResendEnvironment([]);
    const logs = logCollector();

    const app = await buildServerFromConfig(
      config({ kind: 'resend', apiKeyFile: path, from: FROM, replyTo: REPLY_TO, linkOrigin: LINK_ORIGIN }),
      { logStream: logs.stream, secretFile: { open: opener.open }, resend: provider.dependencies },
    );
    servers.push(app);
    await app.ready();
    expect(opener.paths).toEqual([path]);

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });

    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ status: 'not_ready' });
    expect(ready.body).not.toMatch(/email|resend|provider|notify|support@|no-reply/i);

    expect(provider.calls).toEqual([]);
    expect(network).not.toHaveBeenCalled();

    const plain = await buildServerFromConfig(config({ kind: 'disabled' }));
    servers.push(plain);
    await plain.ready();
    expect(routesOf(app)).toEqual(routesOf(plain));

    const text = logs.text();
    expect(text).toContain('"emailDelivery":"resend"');
    expect(text).not.toContain(key);
    expect(text).not.toContain(path);
    expect(text).not.toMatch(/\b(?:was|were|has been|have been) sent\b|\bdelivered\b/i);
  });

  it('fails closed at startup on an insecure key file, naming neither the path nor the key', async () => {
    const key = syntheticApiKey();
    const path = await syntheticKeyFile(key, 0o644);

    let caught: unknown;
    try {
      servers.push(
        await buildServerFromConfig(
          config({ kind: 'resend', apiKeyFile: path, from: FROM, replyTo: REPLY_TO, linkOrigin: LINK_ORIGIN }),
        ),
      );
    } catch (error) {
      caught = error;
    }
    expect((caught as { code?: string }).code).toBe('api_key_file_permissions');
    const text = `${String(caught)}\n${(caught as Error).stack ?? ''}`;
    expect(text).not.toContain(key);
    expect(text).not.toContain(path);
  });
});

/**
 * Runtime compatibility (checkpoint 4D). The container runs the API with plain
 * Node, which strips types but refuses syntax that needs transformation, such
 * as TypeScript parameter properties. Vitest transpiles sources, so only a
 * real Node process can prove the production import path loads. These two
 * modules are on that path and once used parameter properties.
 */
describe('runtime compatibility of the production import path', { timeout: 60_000 }, () => {
  const MODULES = ['src/server.ts', 'src/invitations/admin-invitations.ts', 'src/auth/owner-recovery.ts'];

  it.each(MODULES)('%s loads under plain Node type stripping', async (module) => {
    const target = fileURLToPath(new URL(`../../${module}`, import.meta.url));
    const script = `import(${JSON.stringify(pathToFileURL(target).href)}).then(() => console.log('LOADS'), (error) => console.log('REFUSED ' + error.code))`;
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [...STRIP_TYPES, '--input-type=module', '-e', script], {
        env: { PATH: process.env['PATH'] ?? '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let text = '';
      child.stdout.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
      child.stderr.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
      child.once('error', reject);
      child.once('exit', () => resolve(text));
    });
    expect(output).toContain('LOADS');
    expect(output).not.toContain('ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX');
  });
});

/**
 * The real entry point, as the container runs it. The child receives only the
 * variables listed here (never this process's environment), so an ambient
 * setting on the test machine cannot change the result.
 */
describe('the API process entry point', { timeout: 120_000 }, () => {
  async function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address();
        probe.close(() => resolve(typeof address === 'object' && address !== null ? address.port : 0));
      });
    });
  }

  function environment(port: number, extra: Record<string, string> = {}): Record<string, string> {
    return {
      PATH: process.env['PATH'] ?? '',
      ...(process.platform === 'win32' ? { SystemRoot: process.env['SystemRoot'] ?? 'C:\\Windows' } : {}),
      DATABASE_URL: UNREACHABLE_DATABASE_URL,
      API_HOST: '127.0.0.1',
      API_PORT: String(port),
      DROMEX_ENVIRONMENT: 'test',
      DROMEX_AUTH_SECRETS: `1:${syntheticSecret()}`,
      DROMEX_AUTH_BASE_URL: TEST_BASE_URL,
      DROMEX_AUTH_TRUSTED_ORIGINS: `${TEST_TRUSTED_ORIGIN},${LINK_ORIGIN}`,
      ...extra,
    };
  }

  interface EntryResult {
    code: number | null;
    output: string;
    health: number | null;
  }

  /** Runs the entry point until it exits or listens; a listening server is probed once and stopped. */
  async function runEntry(env: Record<string, string>, port: number): Promise<EntryResult> {
    const child = spawn(process.execPath, [...STRIP_TYPES, SERVER_ENTRY], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let health: number | null = null;

    return new Promise<EntryResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`the API process neither exited nor listened in time:\n${output}`));
      }, 60_000);
      let probing = false;

      const onData = (chunk: Buffer) => {
        output += chunk.toString('utf8');
        if (!probing && output.includes('Server listening')) {
          probing = true;
          void fetch(`http://127.0.0.1:${port}/health`)
            .then((response) => {
              health = response.status;
            })
            .catch(() => {
              health = -1;
            })
            .finally(() => child.kill('SIGTERM'));
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        resolve({ code, output, health });
      });
    });
  }

  function expectRefused(result: EntryResult, secrets: string[]): void {
    expect(result.health, result.output).toBeNull();
    expect(result.code, result.output).toBe(1);
    expect(result.output).toMatch(/^The API cannot start: /m);
    expect(result.output).not.toMatch(/\n\s+at /);
    expect(result.output).not.toContain('Server listening');
    for (const secret of secrets) expect(result.output).not.toContain(secret);
  }

  it('starts with email disabled by default, answers /health, and says nothing was sent', async () => {
    const port = await freePort();
    const result = await runEntry(environment(port), port);

    expect(result.health, result.output).toBe(200);
    expect(result.output).toContain('"emailDelivery":"disabled"');
    expect(result.output).not.toMatch(/\b(?:was|were|has been|have been) sent\b|\bdelivered\b/i);
  });

  it('refuses to start on partial email configuration, naming the setting only', async () => {
    const port = await freePort();
    const result = await runEntry(
      environment(port, {
        DROMEX_EMAIL_TRANSPORT: 'resend',
        DROMEX_EMAIL_RESEND_API_KEY_FILE: '/run/secrets/dromex_resend_api_key',
        DROMEX_EMAIL_LINK_ORIGIN: LINK_ORIGIN,
      }),
      port,
    );
    expectRefused(result, ['/run/secrets/dromex_resend_api_key']);
    expect(result.output).toContain('DROMEX_EMAIL_FROM_ADDRESS');
  });

  it('refuses to start when email settings are present but no provider is selected', async () => {
    const port = await freePort();
    const result = await runEntry(environment(port, { DROMEX_EMAIL_REPLY_TO: REPLY_TO }), port);
    expectRefused(result, [REPLY_TO]);
  });

  it('refuses a provider key supplied directly in the environment, without printing it', async () => {
    const key = syntheticApiKey();
    for (const name of ['RESEND_API_KEY', 'DROMEX_EMAIL_RESEND_API_KEY']) {
      const port = await freePort();
      expectRefused(await runEntry(environment(port, { [name]: key }), port), [key]);
    }
  });

  it('refuses the capture transport in the running server', async () => {
    const port = await freePort();
    expectRefused(await runEntry(environment(port, { DROMEX_EMAIL_TRANSPORT: 'capture' }), port), []);
  });

  it('refuses a key file it cannot open safely, without printing the path', async () => {
    const port = await freePort();
    const path = '/nonexistent-dromex-synthetic/resend-key';
    const result = await runEntry(
      environment(port, {
        DROMEX_EMAIL_TRANSPORT: 'resend',
        DROMEX_EMAIL_RESEND_API_KEY_FILE: path,
        DROMEX_EMAIL_FROM_ADDRESS: FROM.address,
        DROMEX_EMAIL_REPLY_TO: REPLY_TO,
        DROMEX_EMAIL_LINK_ORIGIN: LINK_ORIGIN,
      }),
      port,
    );
    expectRefused(result, [path, 'nonexistent-dromex-synthetic']);
  });

  it.runIf(POSIX)('starts with a valid synthetic key file and never prints the key or its path', async () => {
    const key = syntheticApiKey();
    const path = await syntheticKeyFile(key);
    const port = await freePort();
    const result = await runEntry(
      environment(port, {
        DROMEX_EMAIL_TRANSPORT: 'resend',
        DROMEX_EMAIL_RESEND_API_KEY_FILE: path,
        DROMEX_EMAIL_FROM_ADDRESS: FROM.address,
        DROMEX_EMAIL_FROM_NAME: FROM.name,
        DROMEX_EMAIL_REPLY_TO: REPLY_TO,
        DROMEX_EMAIL_LINK_ORIGIN: LINK_ORIGIN,
      }),
      port,
    );

    expect(result.health, result.output).toBe(200);
    expect(result.output).toContain('"emailDelivery":"resend"');
    expect(result.output).not.toContain(key);
    expect(result.output).not.toContain(path);
  });

  it.runIf(POSIX)('refuses a group- or world-readable key file without printing the key or its path', async () => {
    const key = syntheticApiKey();
    const path = await syntheticKeyFile(key, 0o644);
    const port = await freePort();
    const result = await runEntry(
      environment(port, {
        DROMEX_EMAIL_TRANSPORT: 'resend',
        DROMEX_EMAIL_RESEND_API_KEY_FILE: path,
        DROMEX_EMAIL_FROM_ADDRESS: FROM.address,
        DROMEX_EMAIL_REPLY_TO: REPLY_TO,
        DROMEX_EMAIL_LINK_ORIGIN: LINK_ORIGIN,
      }),
      port,
    );
    expectRefused(result, [key, path]);
    expect(result.output).toMatch(/group or others/);
  });
});
