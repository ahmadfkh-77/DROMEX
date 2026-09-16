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
