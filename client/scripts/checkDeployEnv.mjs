import { pathToFileURL } from 'node:url';

/**
 * Refuses a deploy build whose browser-visible configuration is missing.
 *
 * `src/lib/env.ts` falls back to `http://localhost:5000` and
 * `http://localhost:5173` when the variables are unset. That fallback is right
 * for `npm run dev`, where it means a checkout runs with no `.env` at all — but
 * Vite inlines these values at build time, so the same fallback in a deploy
 * build produces a bundle that asks a stranger's browser for localhost. Nothing
 * fails at build, nothing fails at boot, and the first sign of it is a CORS
 * error in the console of whoever opened the site.
 *
 * So the fallback stays and this check makes it unreachable from a deploy: only
 * `build:deploy` runs it, and `npm run build` is left alone so that `verify`,
 * CI and a plain local build need no configuration.
 *
 * Localhost is rejected rather than merely absence, because "present but not
 * visible to the build" is the failure that actually shipped: the variables were
 * set on the Railway service, and the Docker build still could not see them.
 */

/** Variables the browser cannot work without once the app is deployed. */
const REQUIRED = ['VITE_API_URL', 'VITE_APP_URL'];

/** Hostnames that cannot mean anything in someone else's browser. */
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

/**
 * Returns one message per problem found, empty when the environment is fit to
 * build a deploy from. Takes the environment as an argument rather than reading
 * `process.env`, so it stays a pure function the test suite can drive directly.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function checkDeployEnv(env) {
  const problems = [];

  for (const name of REQUIRED) {
    const raw = env[name]?.trim();

    if (!raw) {
      problems.push(
        `${name} is not set. Vite inlines it at build time, so a container's ` +
          `runtime environment cannot supply it later.`,
      );
      continue;
    }

    let url;
    try {
      url = new URL(raw);
    } catch {
      problems.push(`${name} must be an absolute URL, received "${raw}".`);
      continue;
    }

    if (LOCAL_HOSTNAMES.has(url.hostname)) {
      problems.push(
        `${name} is "${raw}", which points at this machine. A deployed bundle ` +
          `carrying it would ask the visitor's own browser for ${url.hostname}.`,
      );
    }
  }

  return problems;
}

/**
 * Docker declares build arguments per stage, so the usual cause of a missing
 * variable here is an `ARG` that was never added to the stage that builds.
 *
 * @param {string[]} problems
 * @returns {string}
 */
export function formatFailure(problems) {
  return [
    'Refusing to build a deploy bundle with unusable configuration:',
    '',
    ...problems.map((problem) => `  - ${problem}`),
    '',
    'These are build-time values. On Railway the service variables are available',
    'to the build, but `client/Dockerfile` must declare each one with ARG in its',
    '`build` stage and export it as ENV before the build runs. See DEPLOYMENT.md.',
  ].join('\n');
}

/* Only when run as a script: importing this from a test must not exit. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = checkDeployEnv(process.env);

  if (problems.length > 0) {
    process.stderr.write(`${formatFailure(problems)}\n`);
    process.exit(1);
  }
}
