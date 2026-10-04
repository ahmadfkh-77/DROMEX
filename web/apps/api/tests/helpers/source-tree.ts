import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * A read-once view of a source tree for the architectural boundary tests.
 *
 * Those tests scan every file under `src/` for forbidden patterns. Reading the
 * whole tree again for every assertion made them slow enough to approach
 * Vitest's 5-second per-test limit on a heavily loaded machine. This reads each
 * file once, in parallel, and serves every later request from memory. It
 * changes no assertion: a file that was not scanned (for example an import
 * that resolves outside the tree) is still read from disk on demand, as before.
 */
export interface SourceTree {
  /** Every `.ts` file under `directory` (default: the whole tree), depth-first. */
  files(directory?: string): Promise<string[]>;
  /** A file's text. */
  text(path: string): Promise<string>;
  /** A file's text with comments removed, so documentation never counts as use. */
  code(path: string): Promise<string>;
  /** The resolved relative import targets of a file. */
  importsOf(path: string): Promise<string[]>;
}

async function listTypeScript(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return listTypeScript(path);
      return Promise.resolve(entry.name.endsWith('.ts') ? [path] : []);
    }),
  );
  return nested.flat();
}

const withoutComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

export function createSourceTree(root: string): SourceTree {
  let loaded: Promise<{ paths: string[]; texts: Map<string, string> }> | undefined;
  const codes = new Map<string, string>();

  const load = () =>
    (loaded ??= (async () => {
      const paths = await listTypeScript(root);
      const texts = new Map(
        await Promise.all(paths.map(async (path) => [path, await readFile(path, 'utf8')] as const)),
      );
      return { paths, texts };
    })());

  const text = async (path: string): Promise<string> => (await load()).texts.get(path) ?? readFile(path, 'utf8');

  return {
    async files(directory = root) {
      const { paths } = await load();
      return directory === root ? [...paths] : paths.filter((path) => path.startsWith(directory + sep));
    },
    text,
    async code(path) {
      const cached = codes.get(path);
      if (cached !== undefined) return cached;
      const stripped = withoutComments(await text(path));
      codes.set(path, stripped);
      return stripped;
    },
    async importsOf(path) {
      return [...(await text(path)).matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)]
        .map((match) => match[1]!)
        .filter((specifier) => specifier.startsWith('.'))
        .map((specifier) => resolve(dirname(path), specifier));
    },
  };
}
