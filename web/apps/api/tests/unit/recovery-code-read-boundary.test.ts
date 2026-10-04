import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildServer } from '../../src/server.ts';
import { settle, syntheticAuthSettings } from '../helpers/auth-settings.ts';

/**
 * SEC-1a: Better Auth's server-only `viewBackupCodes` reads any user's stored
 * recovery codes and checks no session of its own. DROMEX may therefore call
 * it only from the listed wrappers, each passing its own `userId` parameter,
 * and each wrapper may be reached only with a server-derived user: the
 * verified recovery session's Owner, the invited user whose TOTP-verified
 * session matches the enrolment, or the Owner of a terminal run that passed
 * the password check. Never a value taken from a request.
 *
 * The allowlists are exact on purpose: a new caller, a new wrapper caller, or
 * a changed argument fails this test and needs a deliberate, reviewed update.
 * Architectural and behavioural tests; none needs a database.
 */

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

// Port 1 is reserved and closed: the route check runs with Docker stopped.
const UNREACHABLE_DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/unused';

/** File -> the functions in it that call `viewBackupCodes`, in source order. */
const DIRECT_CALLERS: Record<string, string[]> = {
  'server.ts': ['viewRecoveryCodes'],
  'invitations/enrolment-identity.ts': ['viewRecoveryCodes'],
  'provisioning/terminal-recovery-identity.ts': ['storedCodeState', 'retrieveOneCode'],
};

const WRAPPERS = ['viewRecoveryCodes', 'storedCodeState', 'retrieveOneCode'];

/** Every call of a wrapper: where, inside which function, with which user. */
const WRAPPER_CALLS = [
  { file: 'auth/recovery-http.ts', within: 'verifyReplacement', wrapper: 'viewRecoveryCodes', argument: 'context.actor.userId' },
  { file: 'invitations/invitation-acceptance.ts', within: 'verifyEnrolmentCode', wrapper: 'viewRecoveryCodes', argument: 'actor.userId' },
  { file: 'provisioning/terminal-recovery.ts', within: 'recoverVerifiedOwner', wrapper: 'storedCodeState', argument: 'run.owner.userId' },
  { file: 'provisioning/terminal-recovery.ts', within: 'retrieveOneCode', wrapper: 'retrieveOneCode', argument: 'run.owner.userId' },
];

const REQUEST_INPUT = /\b(request|req|reply|body|query|params|headers|cookies?)\b/;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return Promise.resolve(entry.name.endsWith('.ts') ? [path] : []);
    }),
  );
  return nested.flat();
}

interface SourceFile {
  path: string;
  text: string;
  /** The text with comments removed. */
  code: string;
  headers: FunctionHeader[];
}

// Every source file is read and parsed once per run. Re-reading and re-parsing
// per assertion made these scans slow enough to exceed Vitest's per-test
// timeout on a heavily loaded machine.
let sourceCache: Promise<SourceFile[]> | undefined;

function sources(): Promise<SourceFile[]> {
  sourceCache ??= (async () => {
    const files = await sourceFiles(SRC);
    return Promise.all(
      files.map(async (path) => {
        const text = await readFile(path, 'utf8');
        const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
        return { path, text, code, headers: headersOf(code) };
      }),
    );
  })();
  return sourceCache;
}

async function source(path: string): Promise<SourceFile> {
  const found = (await sources()).find((file) => file.path === path);
  if (found === undefined) throw new Error(`No source file ${label(path)}.`);
  return found;
}

function importsOf(file: SourceFile): string[] {
  return [...file.text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1]!)
    .filter((specifier) => specifier.startsWith('.'))
    .map((specifier) => resolve(dirname(file.path), specifier));
}

const label = (file: string) => relative(SRC, file).replaceAll('\\', '/');
const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The text between the bracket at `open` and its partner. */
function enclosed(code: string, open: number): string {
  const pair: Record<string, string> = { '(': ')', '{': '}' };
  const opener = code[open]!;
  const closer = pair[opener];
  if (closer === undefined) throw new Error(`No bracket at ${open}.`);
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    if (code[index] === opener) depth += 1;
    else if (code[index] === closer && (depth -= 1) === 0) return code.slice(open + 1, index);
  }
  throw new Error('Unbalanced brackets.');
}

interface FunctionHeader {
  name: string;
  params: string;
  index: number;
  /** Index of the body's opening brace, when the function has a block body. */
  bodyOpen: number | null;
}

/** First `{` after `from` that is outside any `<...>` type argument list. */
function blockStart(code: string, from: number): number {
  let angle = 0;
  for (let index = from; index < code.length; index += 1) {
    const char = code[index];
    if (char === '<') angle += 1;
    else if (char === '>' && code[index - 1] !== '=') angle -= 1;
    else if (char === '{' && angle === 0) return index;
  }
  throw new Error('No function body.');
}

// `async function name(`, `async name(params) {`, and `name: async (params) =>`.
const HEADER = /async\s+function\s+(\w+)\s*\(|async\s+(\w+)\s*\(([^)]*)\)\s*(?::[^{]*)?\{|(\w+)\s*:\s*async\s*\(([^)]*)\)\s*=>/g;

function headersOf(code: string): FunctionHeader[] {
  return [...code.matchAll(HEADER)].map((match) => {
    if (match[1] !== undefined) {
      const open = code.indexOf('(', match.index! + match[0].length - 1);
      const params = enclosed(code, open);
      return { name: match[1], params: squash(params), index: match.index!, bodyOpen: blockStart(code, open + params.length + 2) };
    }
    if (match[2] !== undefined) {
      return { name: match[2], params: squash(match[3]!), index: match.index!, bodyOpen: match.index! + match[0].length - 1 };
    }
    return { name: match[4]!, params: squash(match[5]!), index: match.index!, bodyOpen: null };
  });
}

function enclosingFunction(file: SourceFile, index: number): FunctionHeader {
  const before = file.headers.filter((header) => header.index < index);
  // A call outside any recognised function is reported, not ignored, so it
  // fails the allowlist like any other unlisted caller.
  return before[before.length - 1] ?? { name: '(no async function)', params: '', index: -1, bodyOpen: null };
}

function bodyOf(file: SourceFile, functionName: string): string {
  const header = file.headers.find((candidate) => candidate.name === functionName);
  if (header?.bodyOpen == null) throw new Error(`No function ${functionName} with a block body.`);
  return enclosed(file.code, header.bodyOpen);
}

interface MemberCall {
  file: string;
  within: string;
  withinParams: string;
  argument: string;
}

/** Every `<something>.name(...)` call in non-test source. */
async function memberCalls(name: string): Promise<MemberCall[]> {
  const calls: MemberCall[] = [];
  for (const file of await sources()) {
    for (const match of file.code.matchAll(new RegExp(`\\.${name}\\s*\\(`, 'g'))) {
      const open = match.index! + match[0].length - 1;
      const within = enclosingFunction(file, match.index!);
      calls.push({ file: label(file.path), within: within.name, withinParams: within.params, argument: squash(enclosed(file.code, open)) });
    }
  }
  return calls.sort((a, b) => a.file.localeCompare(b.file));
}

describe('recovery-code read boundary: Better Auth viewBackupCodes (SEC-1a)', () => {
  let app: FastifyInstance | undefined;

  // Reading and parsing the sources is setup, not an assertion.
  beforeAll(async () => {
    await sources();
  });

  afterEach(async () => {
    await settle();
    await app?.close();
    app = undefined;
  });

  it('is called only by the listed wrappers, each passing its own userId parameter and nothing else', async () => {
    const calls = await memberCalls('viewBackupCodes');
    const byFile: Record<string, string[]> = {};
    for (const call of calls) (byFile[call.file] ??= []).push(call.within);
    expect(byFile).toEqual(DIRECT_CALLERS);

    for (const call of calls) {
      expect(call.argument, `${call.file} ${call.within}`).toBe('{ body: { userId } }');
      expect(call.withinParams, `${call.file} ${call.within}`).toBe('userId');
    }
  });

  it('is not named anywhere else, and is reached by no string or computed access', async () => {
    const naming: string[] = [];
    const literal: string[] = [];
    for (const file of await sources()) {
      if (/\bviewBackupCodes\b/.test(file.code)) naming.push(label(file.path));
      for (const _ of file.code.matchAll(/['"`]viewBackupCodes['"`]/g)) literal.push(label(file.path));
    }
    expect(naming.sort()).toEqual(Object.keys(DIRECT_CALLERS).sort());
    // The one literal is the server's startup capability check, which only
    // tests that the function exists.
    expect(literal).toEqual(['server.ts']);
    const server = (await source(join(SRC, 'server.ts'))).code;
    expect(server).toMatch(/typeof \(recoveryApi as unknown as Record<string, unknown>\)\[name\] !== 'function'/);
    expect(server.match(/\bviewBackupCodes\b/g)).toHaveLength(3);
  });

  it('has its wrappers called only with a server-derived user, never request input', async () => {
    const found = [];
    for (const wrapper of WRAPPERS) {
      for (const call of await memberCalls(wrapper)) found.push({ file: call.file, within: call.within, wrapper, argument: call.argument });
    }
    const order = (a: { file: string; wrapper: string }, b: { file: string; wrapper: string }) =>
      `${a.file} ${a.wrapper}`.localeCompare(`${b.file} ${b.wrapper}`);
    expect(found.sort(order)).toEqual([...WRAPPER_CALLS].sort(order));
    for (const call of found) expect(call.argument, `${call.file} ${call.within}`).not.toMatch(REQUEST_INPUT);
  });

  it('web recovery reads the codes only for the Owner of the verified recovery session', async () => {
    const file = await source(join(SRC, 'auth', 'recovery-http.ts'));
    const { code } = file;
    expect(bodyOf(file, 'verifyReplacement')).toMatch(/const context = request\.dromexRecovery;/);

    // The recovery context is set in exactly two places: cleared, then filled
    // from Better Auth's verified session once every check has passed.
    expect(code.match(/request\.dromexRecovery\s*=(?!=)/g)).toHaveLength(2);
    expect(code).toMatch(/request\.dromexRecovery = null;/);
    expect(code).toMatch(/request\.dromexRecovery = \{ recovery: found, actor, sessionPair \};/);
    expect(code).toMatch(/const view = await sessionViewOf\(deps, sessionPair\);/);
    expect(code).toMatch(/const actor: RecoveryActor = \{ userId: view\.user\.id, name: view\.user\.name \};/);
    expect(code).toMatch(/found\.userId !== view\.user\.id/);
    expect(code).toMatch(/principal\.isOwner !== true/);
    expect(code).not.toMatch(/\.actor\s*=(?!=)|actor\.userId\s*=(?!=)/);
  });

  it('invitation setup reads the codes only for the invited user whose TOTP-verified session matches', async () => {
    const file = await source(join(SRC, 'invitations', 'invitation-acceptance.ts'));
    const { code } = file;
    const verify = bodyOf(file, 'verifyEnrolmentCode');
    expect(verify).toMatch(/const setup = await setupSession\(sessionCookie\);/);
    expect(verify).toMatch(/const \{ enrolment, actor \} = setup;/);
    expect(verify).toMatch(/verified\.userId !== actor\.userId/);
    expect(verify).toMatch(/session\.userId !== actor\.userId/);
    expect(verify.indexOf('verified.userId !== actor.userId')).toBeLessThan(verify.indexOf('viewRecoveryCodes'));

    const setup = bodyOf(file, 'setupSession');
    expect(setup).toMatch(/const session = await identity\.session\(pair\);/);
    expect(setup).toMatch(/row\.user_id !== session\.userId/);
    expect(setup).toMatch(/actor: \{ userId: session\.userId, name: session\.name \}/);
    expect(code).not.toMatch(/\.actor\s*=(?!=)|actor\.userId\s*=(?!=)/);
  });

  it('terminal recovery reads the codes only after the password check, and no HTTP module can reach it', async () => {
    const recoveryFile = join(SRC, 'provisioning', 'terminal-recovery.ts');
    const { code } = await source(recoveryFile);
    const refusal = code.indexOf("if (signedIn.kind === 'invalid') {");
    const run = code.indexOf('const run: Run = {');
    expect(refusal).toBeGreaterThan(code.indexOf('await deps.terminal.readPassword()'));
    expect(run).toBeGreaterThan(refusal);
    expect(squash(enclosed(code, code.indexOf('{', refusal)))).toMatch(/throw new TerminalRecoveryError\('verification_failed'\);$/);
    expect(code).not.toMatch(/\.owner\s*=(?!=)|owner\.userId\s*=(?!=)/);

    const terminalOnly = [recoveryFile, join(SRC, 'provisioning', 'terminal-recovery-identity.ts')];
    for (const file of await sources()) {
      if (!/from 'fastify'/.test(file.text)) continue;
      const reaching = importsOf(file).filter((target) => terminalOnly.includes(target));
      expect(reaching, label(file.path)).toEqual([]);
    }
    for (const path of terminalOnly) expect((await source(path)).text).not.toMatch(/from 'fastify'/);
  });

  it('exposes no HTTP route for it', async () => {
    app = await buildServer({ databaseUrl: UNREACHABLE_DATABASE_URL, auth: syntheticAuthSettings() });
    for (const method of ['GET', 'POST'] as const) {
      const response = await app.inject({ method, url: '/api/auth/two-factor/view-backup-codes', payload: method === 'POST' ? {} : undefined });
      expect(response.statusCode, method).toBe(404);
    }
  });
});
