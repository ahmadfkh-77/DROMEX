import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const EMAIL = join(SRC, 'email');
const PACKAGE_JSON = fileURLToPath(new URL('../../package.json', import.meta.url));

async function emailSources(): Promise<Array<{ file: string; text: string }>> {
  const names = (await readdir(EMAIL)).filter((name) => name.endsWith('.ts')).sort();
  return Promise.all(names.map(async (name) => ({ file: name, text: await readFile(join(EMAIL, name), 'utf8') })));
}

describe('email transport foundation boundaries (DEC-439)', () => {
  it('contains exactly the approved modules', async () => {
    expect((await emailSources()).map((source) => source.file)).toEqual([
      'config.ts',
      'errors.ts',
      'message.ts',
      'resend.ts',
      'result.ts',
      'secret-file.ts',
      'transport.ts',
    ]);
  });

  it('never logs, reads the process environment, or loads a .env file', async () => {
    for (const { file, text } of await emailSources()) {
      expect(text, file).not.toMatch(/\bconsole\s*\./);
      expect(text, file).not.toMatch(/process\.env|--env-file|dotenv|['"`]\.env['"`]/);
      expect(text, file).not.toMatch(/\bdebugger\b/);
      expect(text, file).not.toMatch(/child_process/);
    }
  });

  it('imports only Node built-ins and its own modules, with no provider SDK', async () => {
    for (const { file, text } of await emailSources()) {
      expect(text, file).not.toMatch(/\brequire\s*\(/);
      const specifiers = [
        ...text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm),
        ...text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
        ...text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g),
      ].map((match) => match[1]!);
      if (file !== 'errors.ts') expect(specifiers.length, file).toBeGreaterThan(0);
      for (const specifier of specifiers) {
        const allowed =
          specifier.startsWith('node:') ||
          (specifier.startsWith('.') && resolve(dirname(join(EMAIL, file)), specifier).startsWith(SRC));
        expect(allowed, `${file} imports ${specifier}`).toBe(true);
      }
    }
    const manifest = JSON.parse(await readFile(PACKAGE_JSON, 'utf8')) as Record<string, Record<string, string>>;
    const dependencies = Object.keys({ ...manifest['dependencies'], ...manifest['devDependencies'] });
    expect(
      dependencies.filter((name) => /^(resend|postmark|mailgun\.js|nodemailer|@sendgrid\/|@aws-sdk\/|svix)/i.test(name)),
    ).toEqual([]);
  });

  it('names exactly one network endpoint, used only by the Resend transport', async () => {
    const urls = new Map<string, string[]>();
    for (const { file, text } of await emailSources()) {
      const found = [...text.matchAll(/\bhttps?:\/\/[^\s'"`)]+/g)].map((match) => match[0]);
      if (found.length > 0) urls.set(file, found);
      if (file !== 'resend.ts') expect(text, file).not.toMatch(/\bfetch\s*\(/);
    }
    expect([...urls.entries()]).toEqual([['resend.ts', ['https://api.resend.com/emails']]]);
  });

  it('adds no webhook handling', async () => {
    for (const { file, text } of await emailSources()) {
      expect(text, file).not.toMatch(/webhook|svix/i);
    }
  });
});

async function sourcesUnder(directory: string): Promise<Array<{ file: string; text: string }>> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  return Promise.all(files.map(async (file) => ({ file, text: await readFile(file, 'utf8') })));
}

function importsOf(text: string): string[] {
  return [
    ...text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm),
    ...text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
    ...text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g),
  ].map((match) => match[1]!);
}

describe('running-server email wiring boundaries (checkpoint 4D, DEC-489)', () => {
  it('keeps business services behind the provider-neutral interface', async () => {
    for (const folder of ['invitations', 'password-reset']) {
      for (const { file, text } of await sourcesUnder(join(SRC, folder))) {
        const email = importsOf(text)
          .map((specifier) => resolve(dirname(file), specifier))
          .filter((target) => target.startsWith(EMAIL))
          .map((target) => target.slice(EMAIL.length + 1));
        for (const target of email) {
          expect(['message.ts', 'result.ts'], `${file} imports email/${target}`).toContain(target);
        }
        expect(text, file).not.toMatch(
          /process\.env|api\.resend\.com|createResendTransport|loadResendApiKey|createEmailTransport|createEmailDelivery|loadEmail(?:Settings|TransportConfig)/,
        );
      }
    }
  });

  it('reads the process environment only in the server entry block and the offline schema tool', async () => {
    const readers = (await sourcesUnder(SRC)).filter(({ text }) => /process\.env\b/.test(text.replace(/^\s*(?:\*|\/\/).*$/gm, '')));
    expect(readers.map(({ file }) => file.slice(SRC.length).replaceAll('\\', '/')).sort()).toEqual([
      'auth/schema-generation.config.ts',
      'server.ts',
    ]);

    const server = readers.find(({ file }) => file.endsWith('server.ts'))!.text;
    const entry = server.indexOf('if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {');
    expect(entry).toBeGreaterThan(0);
    const before = server.slice(0, entry).replace(/^\s*(?:\*|\/\/).*$/gm, '');
    expect(before).not.toMatch(/process\.env\b/);
    expect(server.slice(entry).match(/process\.env\b/g)).toEqual(['process.env']);
  });

  it('adds no email testing, debug, status, or webhook route', async () => {
    for (const { file, text } of await sourcesUnder(SRC)) {
      for (const match of text.matchAll(/\bapp\.(?:get|post|put|patch|delete|head|all|route)\s*\(\s*['"`]([^'"`]+)/g)) {
        expect(match[1], file).not.toMatch(/email|mail|debug|webhook|provider|resend|delivery/i);
      }
    }
  });
});
