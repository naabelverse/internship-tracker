import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Railway's config-as-code can pin the builder to a Dockerfile and name its path,
 * but it has no key for a multi-stage `--target`. A Docker build with no target
 * builds the *last* stage, so which stage comes last is load-bearing production
 * configuration that nothing else in the repository enforces.
 *
 * This is not hypothetical. `client/Dockerfile` previously ended at its `dev`
 * stage, so the deployed container ran `vite dev`: unminified, served from source,
 * carrying the source maps `build:deploy` exists to strip. It failed silently —
 * the site loaded — and was noticed only when Vite's host check rejected the
 * deployed domain.
 *
 * Reading the Dockerfile as text rather than building it keeps this a
 * millisecond check that runs in the normal suite.
 */
function lastStageOf(dockerfile: string): string | undefined {
  const stages = [...dockerfile.matchAll(/^FROM\s+\S+\s+AS\s+(\S+)/gim)].map((match) => match[1]);

  return stages.at(-1);
}

/**
 * Walks up from the working directory to find a repository-relative file, so the
 * suite behaves the same whether vitest is invoked from `client/` or the root.
 * `import.meta.url` is not usable here: it is undefined under this jsdom
 * environment, which resolves the path to a literal "undefined".
 */
function readDockerfile(relative: string): string {
  let dir = process.cwd();

  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = path.join(dir, relative);
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
    dir = path.dirname(dir);
  }

  throw new Error(`Could not find ${relative} above ${process.cwd()}`);
}

describe('client/Dockerfile ends at the production stage', () => {
  const dockerfile = readDockerfile('client/Dockerfile');

  it('builds the production stage when no target is given', () => {
    expect(lastStageOf(dockerfile)).toBe('prod');
  });

  it('serves the built output rather than running the dev server', () => {
    const lastCmd = [...dockerfile.matchAll(/^CMD\s+(.+)$/gim)].at(-1)?.[1] ?? '';

    expect(lastCmd).toContain('preview');
    expect(lastCmd).not.toContain('dev');
  });

  it('builds with build:deploy, so source maps are stripped from the image', () => {
    expect(dockerfile).toContain('build:deploy');
  });
});

describe('server/Dockerfile is development-only, which is why Railpack builds the API', () => {
  const dockerfile = readDockerfile('server/Dockerfile');

  /*
    Pinning the API service to `DOCKERFILE` would hand it this file's last stage,
    which runs `tsx watch`. `railway.server.json` pins RAILPACK deliberately, and
    this case records the reason so the pin is not "simplified" away later.
  */
  it('has no production stage, so a Dockerfile build would serve tsx watch', () => {
    expect(lastStageOf(dockerfile)).toBe('dev');
  });
});
