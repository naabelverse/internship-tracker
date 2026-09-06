import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRepoFile, resolveRepoDir } from './repoFile';

/**
 * Vite inlines `import.meta.env.VITE_*` at *build* time: whatever is in the
 * environment when `vite build` runs is substituted into the bundle as a string
 * literal, and nothing reads it again afterwards. A container's runtime
 * environment therefore cannot influence it at all.
 *
 * Railway makes every service variable available to the build step, but Docker
 * is the half that isolates: a build stage sees only what it declares with
 * `ARG`. An undeclared variable is simply absent, with no warning from either
 * side, so Vite falls back to the defaults in `src/lib/env.ts` and the deployed
 * bundle ships `http://localhost:5000` as its API origin. That is exactly what
 * happened, and it surfaced only as a CORS failure in the browser.
 *
 * This walks the client source for the variables it actually reads and requires
 * each to be declared and exported in the stage that builds, so one added later
 * cannot quietly go missing the same way.
 */
function readClientSourceFiles(): string[] {
  const root = resolveRepoDir('client/src');
  const contents: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);

      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }

      if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
        contents.push(readFileSync(full, 'utf8'));
      }
    }
  };

  walk(root);

  return contents;
}

/** Every `import.meta.env.VITE_*` name the client source actually reads. */
function viteVariablesReadBySource(): string[] {
  const names = new Set<string>();

  for (const source of readClientSourceFiles()) {
    for (const match of source.matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) {
      names.add(match[1]);
    }
  }

  return [...names].sort();
}

/** The lines of a single named build stage, up to the next `FROM`. */
function stageLines(dockerfile: string, stage: string): string[] {
  const lines = dockerfile.split('\n').map((line) => line.trim());
  const start = lines.findIndex(
    (line) => line.startsWith('FROM ') && line.endsWith(` AS ${stage}`),
  );

  if (start === -1) throw new Error(`No stage named ${stage}`);

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('FROM '));

  return end === -1 ? rest : rest.slice(0, end);
}

const VARIABLES = viteVariablesReadBySource();

describe('client/Dockerfile forwards the build-time Vite variables', () => {
  const lines = stageLines(readRepoFile('client/Dockerfile'), 'build');

  it('finds the variables the client reads, so the rest of this suite means something', () => {
    expect(VARIABLES).toContain('VITE_API_URL');
    expect(VARIABLES.length).toBeGreaterThan(1);
  });

  it.each(VARIABLES)('declares ARG %s in the build stage', (name) => {
    expect(lines).toContain(`ARG ${name}`);
  });

  /*
    ARG alone is not enough, and this is the part that is easy to get wrong. An
    ARG is visible to the Dockerfile's own instructions but is not exported into
    the environment of a `RUN`, so `vite build` would still not see it. Assigning
    it to an ENV of the same name is what actually puts it in front of the build.
  */
  it.each(VARIABLES)('exports %s as an ENV so the build process sees it', (name) => {
    const assignment = `${name}=$${name}`;

    expect(lines.some((line) => line.includes(assignment))).toBe(true);
  });

  it('sets the environment before running the build, not after', () => {
    const lastAssignment = lines.reduce(
      (last, line, index) => (VARIABLES.some((n) => line.includes(`${n}=$${n}`)) ? index : last),
      -1,
    );
    const buildRun = lines.findIndex((line) => line.startsWith('RUN npm run build:deploy'));

    expect(lastAssignment).toBeGreaterThanOrEqual(0);
    expect(buildRun).toBeGreaterThan(lastAssignment);
  });
});
