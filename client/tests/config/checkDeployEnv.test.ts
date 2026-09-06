import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a build script, deliberately plain .mjs with JSDoc types
// rather than part of either TypeScript project: it runs from npm before Vite
// or tsc are involved, and giving it a tsconfig would mean compiling it first.
import { checkDeployEnv, formatFailure } from '../../scripts/checkDeployEnv.mjs';

const check = checkDeployEnv as (env: Record<string, string | undefined>) => string[];
const format = formatFailure as (problems: string[]) => string;

const DEPLOYED = {
  VITE_API_URL: 'https://api.tracker.example.com',
  VITE_APP_URL: 'https://tracker.example.com',
};

describe('the deploy build refuses unusable browser configuration', () => {
  it('accepts a pair of real deployed origins', () => {
    expect(check(DEPLOYED)).toEqual([]);
  });

  /*
    The case that shipped. Railway's service variables were set correctly, but
    `client/Dockerfile` declared no matching ARG, so the build saw nothing and
    Vite inlined the localhost defaults from `src/lib/env.ts`.
  */
  it('rejects an unset API URL, which is how the localhost default gets inlined', () => {
    const problems = check({ ...DEPLOYED, VITE_API_URL: undefined });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('VITE_API_URL is not set');
  });

  it.each(['', '   '])('treats %o as unset rather than as a value', (value) => {
    expect(check({ ...DEPLOYED, VITE_API_URL: value })[0]).toContain('is not set');
  });

  /*
    Rejected as well as absence: a variable that is set but still points at this
    machine produces exactly the bundle this check exists to prevent.
  */
  it.each([
    'http://localhost:5000',
    'http://127.0.0.1:5000',
    'http://0.0.0.0:5000',
    'https://localhost',
  ])('rejects %s, which cannot mean anything in a visitor browser', (value) => {
    const problems = check({ ...DEPLOYED, VITE_API_URL: value });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('points at this machine');
  });

  it('rejects a value that is not an absolute URL', () => {
    expect(check({ ...DEPLOYED, VITE_APP_URL: 'tracker.example.com' })[0]).toContain(
      'must be an absolute URL',
    );
  });

  it('reports every problem at once rather than one per build attempt', () => {
    expect(check({})).toHaveLength(2);
  });

  it('does not object to a hostname that merely contains "localhost"', () => {
    expect(check({ ...DEPLOYED, VITE_API_URL: 'https://localhost.example.com' })).toEqual([]);
  });

  it('names the Dockerfile ARG cause in the failure it prints', () => {
    const message = format(check({}));

    expect(message).toContain('ARG');
    expect(message).toContain('VITE_API_URL');
  });
});
