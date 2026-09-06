import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Walks up from the working directory to find a repository-relative file, so the
 * suite behaves the same whether vitest is invoked from `client/` or the root.
 * `import.meta.url` is not usable here: it is undefined under this jsdom
 * environment, which resolves the path to a literal "undefined".
 */
export function readRepoFile(relative: string): string {
  let dir = process.cwd();

  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = path.join(dir, relative);
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
    dir = path.dirname(dir);
  }

  throw new Error(`Could not find ${relative} above ${process.cwd()}`);
}

/** Absolute path to a repository-relative directory, found the same way. */
export function resolveRepoDir(relative: string): string {
  let dir = process.cwd();

  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = path.join(dir, relative);
    if (existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }

  throw new Error(`Could not find ${relative} above ${process.cwd()}`);
}
