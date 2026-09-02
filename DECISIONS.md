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

## Phase 3 - Applications backend

### Status history

- **Appended explicitly in the service, never by a hook.** `PATCH /:id/status` carries a `note`, and
  a `pre('save')` hook cannot see it; recovering the previous status inside a hook also means
  reaching into Mongoose internals. Every write path funnels through one `applyStatusChange` helper,
  so exactly one row is appended per transition and a duplicate is structurally impossible.
- **Creation writes an opening entry with `from: null`.** The SPEC only requires an append on change,
  but the detail page renders its timeline from this array, and a record with no history would show
  an empty timeline on day one.
- **A no-op transition appends nothing.** Setting a record to the status it already has is not a
  change and would otherwise pad the timeline with noise.

### Optimistic concurrency

- **`optimisticConcurrency: true` uses the existing `__v` version key**, surfaced to clients as
  `version` by the `toJSON` transform. It only applies to `document.save()`, so the update path loads
  and saves rather than using `findOneAndUpdate`.
- **Two guards, one status code.** An explicit comparison catches a client that read an older
  version; the Mongoose `VersionError` catches a genuine race where both writers read the same
  version. Both return 409 with the current document attached.
- **The 409 body carries `conflictSource`, either `stale_read` or `concurrent_write`.** Without it
  the two paths are indistinguishable, which makes the race untestable and production conflicts
  harder to diagnose.
- **Omitting `version` skips the check.** The notes editor autosaves on a debounce and has no useful
  version to send; the endpoint is unsafe by omission, never unsafe by default.

### Querying

- **`search` uses an escaped case-insensitive regex, not `$text`.** The SPEC mandates the text index
  and the index is created, but `$text` matches whole words only, so a debounced search box would
  return nothing while the user is still typing. Input is escaped through `utils/regex` per SPEC
  section 7, and a test proves metacharacters are treated literally.
- **`dateFrom` and `dateTo` filter on `createdAt`.** The SPEC does not say which date. Every record
  has `createdAt`, whereas a saved-but-not-applied row has no `appliedDate`, and it matches the
  analytics timeline definition of applications created over time.
- **`tags` matches any of the given tags (`$in`), not all of them.** It behaves like the other
  multi-select filters, which is what the filter bar in Phase 6 needs.
- **`archived` defaults to false.** The table and board both want live records; passing
  `archived=true` returns only archived ones.
- **Pagination adds `_id` as a tiebreaker to every sort**, so paging cannot show a row twice when the
  sorted field has duplicates.

### Derived fields

- **`nextActionDate` and `companyLogoUrl` are computed server-side and rejected in request bodies.**
  Accepting them would let the two drift from the data they summarise.
- **`companyLogoUrl` is a constructed Clearbit-style URL, with no network call at write time.** The
  client falls back to an initials avatar when the image fails. Note that loading it discloses the
  company domain to a third party, which the privacy page in Phase 13 has to mention.

### Bulk actions

- **Ownership is re-checked per id.** The ids are re-queried scoped to the caller, so an id owned by
  someone else never matches and comes back in `notFound`, exactly like a deleted row.
- **`archive` and `unarchive` use `updateMany`, which bypasses optimistic concurrency.** They toggle
  one boolean and carry no history, so a lost update is not meaningful. `setStatus` instead loops
  document by document because every transition owes a `statusHistory` entry.

### Import and export

- **CSV handled by papaparse.** Correct quoting and embedded separators are not worth hand-rolling;
  `utils/csv` is a thin wrapper that keeps the column order stable.
- **Import is multipart via multer memory storage, capped at 2 MB and 1000 rows.** Nothing touches
  disk, so the storage adapter is not involved and the Phase 4 upload work is unaffected.
- **A bad row never aborts the batch.** Each row is validated on its own and every skipped row is
  reported with its 1-based spreadsheet row number, the offending field, and the reason.
- **Export returns the raw file rather than the JSON envelope**, because it is a download with a
  `Content-Disposition` attachment header.

### Testing

- **The test database helper now truncates every collection between cases.** It previously cleared
  only User and RefreshToken, so applications leaked across tests and hid a real assertion failure.
  Clearing all collections generically also covers models added in later phases.
- **Suites share `useCleanAuthRateLimits()`.** Every case registers a fresh account and registration
  is limited to 5 per address, so without a reset the sixth test in a file would be throttled.

## Phase 4 - Analytics, calendar, reminders, uploads

### Analytics

- **Every pipeline opens with `$match` on the user.** Scoping in the first stage is the aggregation
  equivalent of the query-level ownership rule, and it means no later stage can see another account.
- **"Applied" and the rates are derived from `statusHistory`, not the current status.** A record that
  reached interview and was later rejected still counts as applied, responded and interviewed. The
  history is collapsed into a set with `$setUnion` and each milestone is a `$setIntersection`.
- **`ghosted` counts as applied but never as a response.** That is the whole point of the status:
  the application was sent and nothing came back.
- **The streak is grouped in the pipeline and walked in JavaScript.** `$dateToString` with the
  account timezone produces the distinct local day keys; only the consecutive-day walk over that
  small reduced list happens in memory. Filtering still happens in the database.
- **The weekly goal window starts on Monday** in the account timezone. The SPEC does not specify a
  first day; Monday matches how a working week is usually counted.
- **The timeline returns only buckets that have activity.** Filling a year of empty days server side
  would bloat the payload for no benefit; the chart fills the gaps.
- **The timeline is bounded at both ends.** An open-ended `$gte` let rows dated after the window
  leak into a range that was supposed to end at now; found by the timezone test.

### Timezone handling

- **All conversions go through `Intl`.** It is the authoritative tzdata implementation, so daylight
  saving is handled rather than approximated by a stored offset. The consequence is visible in the
  cron: 08:00 local in Los Angeles is 15:00 UTC in summer and 16:00 UTC in winter.
- **`startOfLocalDay` solves by probing, not by adding an offset**, because the offset itself depends
  on the date being resolved. Two correction passes converge for every zone, including the half-hour
  and quarter-hour ones, which the tests cover.

### Reminder cron

- **Hourly UTC tick, per-account local hour.** Each tick resolves the small set of distinct account
  timezones, keeps those whose clock reads the digest hour, and only then queries reminders. A daily
  UTC job would fire at the wrong local time for most of the world.
- **Only email reminders have a delivery window.** In-app reminders become visible the moment
  `dueAt` passes, through the `GET /reminders` query, so they never wait for a tick.
- **`unreadOnly=true` means due and unacknowledged.** That is what a notification bell is asking for;
  returning future reminders under that flag would be noise.
- **The sweep marks the batch sent and logs it.** Delivery is Phase 12. Selection and claiming are
  genuinely this phase, and they are what the timezone tests exercise.

### Storage

- **A `StorageAdapter` interface with two implementations, chosen by `STORAGE_DRIVER`.** Production
  refuses the local driver in the env loader and again in the factory: a free tier host wipes local
  disk on redeploy, so it must not be reachable by accident.
- **`signedUrl` is part of the contract.** S3 returns a real presigned GET; the local driver returns
  an app URL carrying an HMAC and an expiry, served by a route that always sets
  `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`. Same expiry semantics
  either way, so swapping drivers does not change client behaviour.
- **S3 is tested with `aws-sdk-client-mock` over an in-memory bucket, not MinIO.** It needs no Docker
  daemon or network in CI and lets one contract suite run against both drivers. The limitation is
  stated in the helper: it proves the adapter issues the right commands and honours the contract, it
  does not exercise real S3 durability, IAM or consistency.
- **Objects are keyed `attachments/{userId}/{applicationId}/{uuid}.{ext}`.** The uploaded filename is
  never used on disk or in the bucket, so a crafted name cannot traverse paths or collide.
- **The storage key is stripped from JSON.** The client downloads through a signed URL minted on
  demand and has no use for the key.
- **EXIF is stripped by re-encoding with sharp.** sharp drops metadata unless asked to keep it, and
  `rotate()` bakes in the orientation first so the image does not end up sideways once the tag goes.
- **An attachment row is removed before its object is deleted.** An orphaned object is recoverable;
  a row pointing at bytes that no longer exist is not.

### API documentation

- **The OpenAPI document is hand written and split by area** under `docs/`, rather than generated
  from decorators, which would mean annotating every route for a tool that is not in the locked
  stack.
- **A test walks the router stack in both directions.** No registered route may be undocumented and
  no documented path may be stale, which is what stops the document drifting behind the code.
- **Swagger UI gets a relaxed Content Security Policy scoped to `/api/docs`.** It needs inline script
  and style; nothing else on the API is relaxed.
- **`API_URL` was added to the environment.** Signed download links have to point at the API, and
  `APP_URL` is the client origin.
