# Decisions

Every assumption made while building against `SPEC.md`, with the reason. Newest phase last.

## Phase 1 - Scaffold

### Repository location and setup

- **The repo lives at `C:\Users\naabe\internship-tracker`.** `SPEC.md`, `CLAUDE.md` and `PROGRESS.md`
  were sitting in `Downloads/` with no project folder, so the folder described in the SPEC header
  was created, the three documents copied in, and `git init` run there.
- **`core.autocrlf=false` plus `.gitattributes` with `* text=auto eol=lf`.** The stack is developed
  on Windows and runs in Linux containers and CI; forcing LF keeps shell scripts and Docker files
  executable and stops whole-file diffs.

### Toolchain versions

- **Node 20 in Docker and CI, Node 24 on this machine.** The SPEC locks Node 20, so every image and
  the CI matrix pin `node:20-alpine`. The local runtime is v24.16.0 and is only used for `npm run
verify`; nothing in the stack depends on a version-specific API.
- **ESLint 9 flat config (`eslint.config.mjs`), not `.eslintrc`.** ESLint 9 is the current major and
  the legacy config format is deprecated; a single flat config covers both workspaces, which is what
  "shared config" in the SPEC asks for.
- **zod 3, not zod 4.** `@hookform/resolvers` and the rest of the form stack the SPEC locks in are
  built against zod 3; staying on 3 avoids a resolver mismatch in Phase 5.
- **Express 4, not 5.** Locked by the SPEC. `@types/express@4` is pinned to match.

### TypeScript configuration

- **`strict: true` plus `noUnusedLocals` / `noUnusedParameters`, but not
  `noUncheckedIndexedAccess`.** The SPEC requires strict mode; the two unused-symbol flags directly
  enforce the "no dead code" rule. `noUncheckedIndexedAccess` was left off because it forces
  non-null assertions through the analytics and CSV code in later phases, and the CLAUDE.md rules
  ban both `any` and unexplained assertions.
- **`@/*` path alias in both workspaces.** Resolved by `tsx` in dev, `tsc-alias` after the server
  build, `moduleNameMapper` in Jest, and a Vite `resolve.alias` on the client.
- **Split client tsconfigs.** `tsconfig.json` type-checks app code with DOM libs; `tsconfig.node.json`
  type-checks `vite.config.ts` with Node types, so Node globals never leak into browser code.

### Runtime behaviour

- **Health probes are registered at the root _and_ under `/api/v1`.** SPEC section 5 lists `/health`
  under a base path of `/api/v1`, while section 14 wants probes a platform health check can hit. One
  router mounted twice satisfies both without duplicating handlers.
- **`/health` never fails on a database outage; `/ready` does.** Liveness that fails during a
  recoverable Mongo blip would have the platform restart a healthy process. `/ready` issues a real
  `admin().ping()` rather than trusting `readyState`, which only reports what the driver last saw.
- **The API listens first, then connects to MongoDB in the background.** Probes answer immediately
  during startup. If the retry budget (8 attempts, exponential backoff to 15 s) is exhausted the
  process shuts down gracefully with exit code 1 so the platform restarts it.
- **The env loader validates production hardening beyond secret length.** As well as the required
  minimum 32 characters and placeholder rejection, production also refuses two identical JWT secrets
  and a `localhost` `CLIENT_ORIGIN`/`APP_URL`, both of which produce a silently broken deployment.
- **`APP_VERSION` is a constant in `config/app-info.ts`, not an import of `package.json`.** Importing
  the manifest would pull a file outside `rootDir` into the build output. A test asserts the constant
  matches `server/package.json`, so the two cannot drift.
- **The env schema grows one phase at a time.** SPEC section 8 lists variables for features that do
  not exist yet (S3, SMTP, Sentry, demo account). Adding them now would mean documenting settings
  nothing reads, so each variable lands in `.env.example` in the phase that consumes it.

### Docker

- **Dockerfiles ship a `dev` target only for now.** `docker compose` runs the development stack,
  which is what Phase 1 has to prove. Production images and the split-host deployment configuration
  are Phase 16 work, so building unused production stages now would be dead configuration.
- **Development secrets appear inline in `docker-compose.yml`.** They are local-only strings that the
  production env loader would reject outright, clearly labelled as such. No real secret is committed.

### Tooling problems hit during install

- **vitest 3, not vitest 2.** vitest 2.1 bundles its own Vite 5, which collided with the Vite 6 the
  client uses and made `tsc` reject `defineConfig` from `vitest/config` with two incompatible
  `UserConfig` types. Upgrading to vitest 3 (which supports Vite 6) resolved it without downgrading
  Vite, per SPEC section 0.8.
- **Playwright browsers are not installed on this machine.** A real-browser check of the client was
  attempted and failed with "chrome executable not found". Phase 1 was verified with HTTP-level
  checks against the compose stack instead; Phase 15 owns the Playwright suite and will install the
  browsers.

### Formatting

- **`prettier --check .` runs as part of `npm run lint`.** `npm run verify` keeps the four stages
  CLAUDE.md documents, but folding the check into lint means formatting drift fails CI instead of
  being quietly rewritten by the pre-commit hook.
- **`SPEC.md`, `CLAUDE.md` and `PROGRESS.md` are prettier-ignored.** They were delivered by the
  project owner; reformatting them would produce noisy diffs on documents that are the source of truth.

## Phase 2 - Auth backend

### Refresh token design

- **`RefreshToken` has a `family` field the SPEC did not list.** SPEC section 4 lists
  `user, tokenHash, expiresAt, revokedAt, replacedBy, userAgent, ip` and asks for whole-family
  revocation on reuse. Those fields only give a forward-linked list, so revoking a family would mean
  walking `replacedBy` one query at a time and would still miss ancestors. A `family` id minted at
  login and inherited by every rotation turns it into one indexed
  `updateMany({ user, family, revokedAt: null })`.
- **Refresh tokens are opaque random strings, not JWTs.** They have to be revocable server-side,
  which a self-contained JWT is not.
- **Stored as an HMAC-SHA256 keyed with `JWT_REFRESH_SECRET`, not a bare SHA-256.** A leaked database
  alone then cannot be used to match stolen cookies, because an attacker also needs the secret. This
  also gives `JWT_REFRESH_SECRET` a real job now that refresh tokens are not signed.
- **A 10 second reuse grace window.** Rotation claims the token atomically, so of N concurrent
  requests exactly one wins. The losers have to be told apart from a genuine replay: a token revoked
  by rotation inside the window is a concurrent duplicate (401, family untouched), anything older is
  replay (401, family revoked). Without this, two browser tabs refreshing at once would log the
  account out of every device.
- **No MongoDB transactions.** The single-document `findOneAndUpdate` is already atomic, and avoiding
  transactions keeps the suite runnable on a standalone `mongodb-memory-server` with no replica set.

### Access tokens

- **Access tokens carry a custom millisecond `iatMs` claim.** The standard `iat` claim is whole
  seconds, so a token minted in the same second as a password change compared equal and survived
  invalidation. Comparing `passwordChangedAt` against `iatMs` closes that window and removed the need
  to backdate `passwordChangedAt`, which was the earlier workaround.

### Endpoint behaviour

- **`PATCH /auth/me/password` revokes every refresh token, then issues a fresh session.** The SPEC
  says "revokes all other sessions". Revoking all and re-issuing to the caller is simpler than
  exempting one token, and leaves the calling device signed in as intended.
- **`PATCH /auth/me` uses a strict schema and rejects `email`.** Changing an email needs the pending
  email plus re-verification flow, which is Phase 11. Rejecting loudly beats ignoring the field.
- **A locked account returns 423, not 429.** 429 means "slow down and retry"; the lock is a state of
  the account, and the distinct code `ACCOUNT_LOCKED` lets the client explain it properly.
- **Registration does not send a verification email yet.** There is no mail transport until Phase 12.
  Every User field the verification flow needs already exists, so the schema will not change under it.
- **A soft-deleted account keeps its email reserved.** The unique index still holds the row, so
  re-registering that address returns 409 until the Phase 11 purge job removes it.
- **The refresh cookie is scoped to `Path=/api/v1/auth` with `SameSite=Strict`.** It is never attached
  to ordinary API calls, which shrinks the surface for theft.
- **Password policy: 8 to 128 characters with upper, lower and a digit.** The SPEC does not specify
  one; this is the common baseline and is enforced by zod at the route boundary.

### Testing

- **Auth rate limiters run during tests instead of being skipped.** Each limiter owns a `MemoryStore`
  and `resetAuthRateLimiters()` clears them between cases, so "5 attempts then 429" is proven rather
  than assumed. The global 200-per-window limiter stays skipped in tests.
- **Tests set `TRUST_PROXY=1`.** That lets a test vary the client address with `X-Forwarded-For` and
  trip the IP-keyed and email-keyed limiters independently, and it matches how the API runs behind
  Render or Railway.
- **The sequential-replay test explicitly ages the revocation past the grace window.** Replaying
  immediately is by design a concurrent duplicate, so the test moves `revokedAt` into the past to
  simulate the real threat, which is a token replayed later.
- **`@types/bcryptjs` was removed.** bcryptjs 3 ships its own type declarations and the DefinitelyTyped
  package shadowed them.
