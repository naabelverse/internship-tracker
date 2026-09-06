import { describe, expect, it } from 'vitest';
import { readRepoFile } from './repoFile';

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

/** The final CMD's argument text, which is the one a targetless build inherits. */
function lastCmdOf(dockerfile: string): string {
  return [...dockerfile.matchAll(/^CMD\s+(.+)$/gim)].at(-1)?.[1] ?? '';
}

describe('client/Dockerfile ends at the production stage', () => {
  const dockerfile = readRepoFile('client/Dockerfile');

  it('builds the production stage when no target is given', () => {
    expect(lastStageOf(dockerfile)).toBe('prod');
  });

  it('serves the built output rather than running the dev server', () => {
    expect(lastCmdOf(dockerfile)).toContain('preview');
    expect(lastCmdOf(dockerfile)).not.toContain('dev');
  });

  /*
    The port a container listens on is its contract with the platform: Railway
    ignores EXPOSE, injects PORT, and routes to whatever the process bound. A
    literal port in the start command is therefore unreachable the moment the
    platform picks a different one, and the failure is a 502 at the edge rather
    than anything visible in the build.
  */
  it('takes its port from the environment rather than a literal', () => {
    const lastCmd = lastCmdOf(dockerfile);

    expect(lastCmd).toMatch(/--port\s+\$\{?PORT/);
    expect(lastCmd).not.toMatch(/--port\s+\d/);
  });

  /*
    The trap this guards is specific. An exec-form CMD is handed straight to
    execve with no shell between, so `["npm", "run", "...", "$PORT"]` passes the
    four literal characters `$PORT` to Vite, which rejects them as a port. The
    expansion only happens because the command runs under `sh -c`.
  */
  it('runs under a shell, so the port variable is actually expanded', () => {
    expect(lastCmdOf(dockerfile)).toMatch(/^\[\s*"sh"\s*,\s*"-c"/);
  });

  /*
    `--host` with no value is Vite's `host: true`, which binds the dual-stack
    wildcard and answers on every interface. Spelling it `--host 0.0.0.0` would
    be narrower, not safer: that is IPv4 only, and Railway's private network
    resolves to both families.
  */
  it('binds every interface rather than loopback', () => {
    const lastCmd = lastCmdOf(dockerfile);

    expect(lastCmd).toMatch(/--host(?!\s+\S)|--host\s+--/);
    expect(lastCmd).not.toContain('0.0.0.0');
  });

  /*
    EXPOSE is inert on Railway, so it only documents a plain `docker run`. It
    earns its place by matching the fallback, and drifting from it would
    document a port nothing listens on.
  */
  it('documents the same fallback port it EXPOSEs', () => {
    const fallback = /--port\s+\$\{PORT:-(\d+)\}/.exec(lastCmdOf(dockerfile))?.[1];
    const exposed = [...dockerfile.matchAll(/^EXPOSE\s+(\d+)/gim)].at(-1)?.[1];

    expect(fallback).toBeDefined();
    expect(fallback).toBe(exposed);
  });

  it('builds with build:deploy, so source maps are stripped from the image', () => {
    expect(dockerfile).toContain('build:deploy');
  });
});

/*
  Railway's `deploy.startCommand` replaces the image's CMD outright, so the
  Dockerfile's is dead configuration on Railway whenever this key is set. The
  two drifting apart is how a correct CMD ends up never running, which is worth
  a check of its own rather than trust that whoever edits one edits the other.
*/
describe('railway.client.json does not override the Dockerfile with a worse command', () => {
  const config = JSON.parse(readRepoFile('railway.client.json')) as {
    deploy?: { startCommand?: string };
  };
  const startCommand = config.deploy?.startCommand;

  it('either defers to the image CMD or repeats its port and host handling', () => {
    if (startCommand === undefined) return;

    expect(startCommand).toMatch(/--port\s+\$\{?PORT/);
    expect(startCommand).toMatch(/--host/);
  });

  /*
    Railway runs a start command in exec form for a `DOCKERFILE` build -- unlike
    Railpack, which gets a shell -- so a bare `${PORT:-4173}` here reaches Vite
    as a literal string and the deploy dies with "not a valid port number". The
    documented fix is to wrap the command in a shell explicitly. This is the same
    trap as the CMD's, in the one place where the Dockerfile's own `sh -c` does
    not apply, because the start command replaces the CMD rather than joining it.
  */
  it('wraps the command in a shell, since a Dockerfile build gets no shell', () => {
    if (startCommand === undefined) return;

    expect(startCommand).toMatch(/^\/bin\/sh\s+-c\s+/);
  });
});

describe('server/Dockerfile is development-only, which is why Railpack builds the API', () => {
  const dockerfile = readRepoFile('server/Dockerfile');

  /*
    Pinning the API service to `DOCKERFILE` would hand it this file's last stage,
    which runs `tsx watch`. `railway.server.json` pins RAILPACK deliberately, and
    this case records the reason so the pin is not "simplified" away later.
  */
  it('has no production stage, so a Dockerfile build would serve tsx watch', () => {
    expect(lastStageOf(dockerfile)).toBe('dev');
  });
});
