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

## Phase 5 - Frontend foundation

### Theme tokens

- **Tailwind 3.4, and every colour is a CSS custom property holding space-separated RGB channels.**
  `rgb(var(--color-surface) / <alpha-value>)` makes one definition serve three consumers: the
  utility (`bg-surface`), the opacity modifier (`bg-surface/60`), and Phase 8's charts, which read
  the same variable off `document.documentElement` and wrap it themselves. A hex value satisfies the
  first but neither of the other two.
- **`data-theme` on `<html>` is the only theme switch.** `darkMode` is configured as
  `['selector', '[data-theme="dark"]']`, so the `dark:` variant and the variable block key off the
  same attribute. Also setting a `dark` class would be a second source of truth that can disagree
  with the first.
- **Dark is the default when nothing is stored**, per SPEC section 6, even though `User.theme`
  defaults to `system` on the server. The account preference is a separate thing, applied on top of
  the boot default once `/auth/me` answers; that wiring is Phase 9.
- **The inline boot script duplicates about fifteen lines of the theme store, deliberately.** It
  cannot import the store: a module script is deferred, and running after the first paint is the
  exact flash being avoided. The drift that would actually hurt is a renamed storage key, so a test
  asserts the literal in `index.html` equals `THEME_STORAGE_KEY`.

### Verifying "no flash of wrong theme" without a browser

- **The shipped `index.html` is parsed by jsdom with `runScripts: 'dangerously'`, and the assertions
  read `documentElement` afterwards.** No browser is installed on this machine (see the Phase 1
  note), so the property is split into its two halves and each is checked directly. The logic half
  runs the real script source from the real file: stored light, stored dark, nothing stored, an
  unrecognised value, `system` against both OS preferences, and storage that throws. The position
  half asserts the script is a classic, non-deferred, non-module `<script>` inside `<head>` that
  appears before both the bundle and `#root`, which the HTML spec requires the parser to run before
  it reaches `<body>`.
- **What that leaves untested is the browser's own parse-then-paint ordering**, which is a spec
  guarantee rather than application code. Phase 15 closes it end to end in Playwright. The built
  `dist/index.html` was checked by hand this phase: the script survives at byte 806, ahead of the
  injected module script at 1811 and `#root` at 1981.

### API client and the refresh interceptor

- **One shared promise is the request queue.** `ensureFreshToken()` assigns the in-flight refresh to
  a module-level slot synchronously before returning it, so every concurrent 401 handler awaits the
  same promise and the settlement of a single `POST /auth/refresh` releases them all. An explicit
  array of deferreds carries the same semantics with more bookkeeping and one extra failure mode: a
  subscriber that is enqueued and never drained if the refresh throws somewhere unexpected.
- **A replayed request is marked, and the token it used is compared.** The mark stops a genuinely
  revoked session from looping. The comparison covers the 401 that lands just after the slot was
  cleared: that request already has a valid token in hand, so it is replayed directly instead of
  starting a redundant second refresh.
- **Register, login, refresh and logout go through a second, interceptor-free axios instance.** A
  401 from any of them is the answer, not a signal to refresh, and routing the refresh call itself
  through the refreshing interceptor would recurse.
- **The access token lives in a zustand store with no `persist` middleware**, which is memory-only by
  construction. A test asserts `localStorage` and `sessionStorage` are still empty after a full
  refresh-and-replay cycle, so the requirement is proven rather than assumed.
- **The hard redirect after a failed refresh sits behind a `browserNavigation` object.** Tests spy on
  it instead of stubbing `window.location`, and the interceptor skips it when already on `/login` so
  a dead cookie cannot produce a reload loop.
- **Clearing the session on a failed refresh happens in the coordinator; redirecting happens in the
  interceptor.** The cold-start bootstrap and a mid-session expiry both need the state cleared, but
  only the second should throw the user out of the SPA: the first simply means nobody is signed in.

### Routing

- **`pending` is a real third session state, not "anonymous until proven otherwise".** The access
  token is memory-only, so after a hard refresh the only evidence of a session is the httpOnly
  cookie. Treating "not yet known" as signed out would eject a signed-in user on every reload, so
  protected routes render a shell-shaped skeleton until the silent refresh answers.
- **Not-yet-built pages are real modules at their final paths** rendering a shared `PhasePlaceholder`
  that carries `data-phase`. Phase 6, 7, 8 and 9 replace the body of one file each; the route table,
  the guards and the routing tests do not move.
- **`PublicOnlyRoute` keeps a signed-in user off `/login` and `/register`.** It waits out `pending`
  for the same reason, so the form is never flashed to someone who does not need it.
- **The intended path is carried to `/login` in router state and consumed after a successful sign
  in.** A test signs in from a `/settings` bounce and asserts it lands back on `/settings`.

### Testing

- **The axios adapter is mocked by hand rather than with MSW.** The subject under test is the
  interceptor chain itself; swapping the adapter exercises all of it (request interceptor,
  transport, response interceptor, replay) and yields an exact, ordered record of every call, which
  is what the "exactly one refresh" assertion needs. MSW intercepts a layer below that, at XHR, and
  would support the same assertions with more setup. It stays available if a later phase needs to
  mock at the network boundary instead.
- **`resetClientState()` unmounts before it resets.** The store, the axios adapter and the refresh
  slot are module-level and shared within a test file; resetting them under a live tree schedules
  renders outside `act` and let one case perturb the next. Four routing cases failed that way before
  the ordering was fixed.
- **`tests/App.test.tsx` was deleted, not weakened.** It covered the Phase 1 health-check boot
  screen, which the Phase 1 notes already recorded as being replaced by the application shell in
  this phase. Its subject no longer exists.
- **`index.html` is loaded into the theme test with Vite's `?raw` import.** `import.meta.url` is an
  http URL under Vitest, so `fileURLToPath` cannot be used, and `?raw` reads the shipped file rather
  than a copy kept in the test.

### Client tooling

- **`eslint-plugin-react-hooks` was added for the client glob.** A missing dependency in the session
  and theme hooks is a stale-closure bug, not a style problem, and nothing else in the toolchain
  catches it.
- **The client has its own two-function logger with a single `eslint-disable` for `console`.**
  `no-console` stays on repo-wide, and there is one place to swap in Sentry in Phase 14. It is quiet
  under Vitest so a deliberately thrown error in a test does not print a misleading stack.
- **Icons are hand-drawn inline SVG rather than an icon package.** The locked stack names no icon
  library, fourteen paths are not worth a dependency, and they inherit `currentColor`, so they
  follow the theme tokens for free.

## Phase 6 - Applications UI

### List state in the URL

- **`useSearchParams` with a hand-written codec, not a URL-state library.** react-router is already
  the locked router and `useSearchParams` is its native API. The parse and serialise step has to
  exist regardless, because the server accepts arrays as repeated keys or comma-separated values and
  something has to choose; a library would add a dependency and still leave that shaping to us.
- **The URL is the only store for list state.** The query key is built from the parsed filters, so
  changing the address is what triggers the refetch. Nothing is duplicated in component state, which
  is why a fresh mount at a filtered URL and a client-side navigation take the identical path.
- **Arrays are written comma-separated.** The server's `toStringArray` preprocessor accepts both
  encodings; this is the shorter one, and shareable links are the point of the requirement.
- **Unrecognised values are dropped, not rejected.** A hand-edited or stale link should open on a
  sane view rather than an error screen, so an unknown status or a malformed sort falls back to the
  default instead of failing the page.
- **Every filter change resets to page 1, except an explicit page move.** Holding page 7 while
  narrowing a filter lands on an empty result the user did not ask for.

### Optimistic updates and rollback

- **One `useOptimisticApplicationMutation` shape backs every write.** Create, update, status change,
  delete and bulk all get the same four hooks, so there is a single rollback path to reason about
  rather than five hand-rolled ones.
- **`cancelQueries` runs before the snapshot.** Without it a refetch resolving mid-mutation would
  overwrite the cache after the snapshot was taken, and the state a rollback restores would be
  whatever that refetch happened to return rather than what the user was looking at.
- **The snapshot sweeps the whole `applications` prefix, not one key.** The same row is cached under
  every filter combination the user has visited plus its own detail entry; patching only the active
  page would leave stale copies that reappear on a back navigation.
- **Create inserts a `temp-` row and swaps it for the server document on success.** It is the one
  variant with no existing row to patch, but it keeps the same three-hook shape, so the rollback
  proof is the same proof.

### Version conflicts

- **A 409 is routed to a dialog instead of the shared error toast.** `onFailure` returns true for
  `VERSION_CONFLICT`, which suppresses the toast; the prompt then renders the `current` document
  from the error payload so the user can compare rather than guess.
- **"Overwrite" resends the same body with `version` omitted.** That is exactly what the server's
  `assertVersion` treats as "do not check the read I started from", so the second attempt is a
  deliberate, explicit choice rather than a retry that happens to win a race.
- **The optimistic patch is rolled back before the prompt appears.** The table shows the truth while
  the user decides, not a change that has not been accepted.

### Detail view

- **Autosave compares against the last server-acknowledged text, held in a ref, not a dirty flag.**
  Three cases fall out of that: typing a character and deleting it returns to the saved text and
  saves nothing; the success write that lands in `savedNotes` re-syncs the ref, so the editor does
  not try to save what it just saved; and a refetch carrying someone else's edit becomes the new
  baseline instead of looking like a local change.
- **`marked` and `dompurify` were added for the notes preview.** The locked stack names no markdown
  renderer, and hand-rolling parsing plus sanitisation is how XSS holes get written. Sanitising
  happens after parsing, with an allowlist and a URI scheme filter, because a payload can be
  harmless as markdown and dangerous once expanded to HTML. A test asserts a `javascript:` link and
  an `onerror` image are both stripped.
- **Attachments are validated client-side against the same 5 MB and mimetype rules the server
  enforces.** This is a fast-fail for the user, not a security boundary; the server remains the
  authority, and the client check exists so an obviously invalid pick does not cost an upload.
- **The timeline merges `statusHistory` and `interviews` into one normalised list.** They are two
  shapes on the document but one story to the user, so they are merged and sorted rather than
  stacked as two lists.

### Bugs found while building this phase

- **The edit form reset itself on every background refetch.** The reset effect depended on the whole
  `application` object, so a refetch producing a new identity for the same row wiped whatever the
  user was typing — visible as the overwrite retry sending the server's role rather than the typed
  one. It now keys on the row id plus the open state and reads the row through a ref.
- **Clearing the filters wrote the search term straight back.** The input's re-seed effect and the
  debounce effect ran in the same commit, where the debounced value still held the old term. The
  debounce is now an explicit timer started by the change handler and cancelled whenever the URL
  changes from elsewhere, so a pending write is only ever the user's own typing.
- Both are covered by the tests that caught them.

### Build

- **Vendor chunks are split manually.** Adding the table, modal and detail view pushed the single
  bundle past Vite's 500 kB warning. Dependencies change far less often than application code, so
  react, the query layer and the markdown pair are separated, which also stops a deploy from
  invalidating everything. Route-level lazy loading and the formal size budget remain Phase 15.

## Phase 7 - Board and calendar UI

### A drop goes through the general PATCH, not the status route

- **The board calls `PATCH /applications/:id`, not `PATCH /applications/:id/status`.** A drop has to
  carry the version the card was rendered with, so a stale drag hits the optimistic lock instead of
  quietly overwriting. `statusChangeSchema` is `.strict()` and permits only `{ status, note? }`, so a
  version sent there is a 400, not a 409. `updateApplicationSchema` accepts `version` and runs
  `assertVersion`, and `updateApplication` calls the same `applyStatusChange` helper when `status` is
  present, so `statusHistory` is still appended. The alternative, widening the Phase 3 status schema,
  would have meant editing a shipped contract and its tests to gain something the general update
  already does.
- **`useChangeStatus`, `DeadlineChip` and `STATUS_CONFIG` are reused unchanged.** The board picks the
  hook whose endpoint can carry a version rather than reshaping a hook. The table's inline dropdown
  keeps `useChangeStatus` and stays unversioned, exactly as Phase 6 shipped it.
- **The origin column for a rollback is the cache snapshot, not board state.** A card's column is
  derived from `application.status`, and `onMutate` already snapshots every cached entry under the
  applications prefix, so `restore()` puts the card back with no board-local "where did this come
  from" value that could drift. The drag data carries `{ status, version, company }` only for the
  version to send and to short-circuit a drop onto the column the card started in.
- **The board's query reuses the applications list key shape.** A status change made from the table
  patches the board's cached copy and the reverse, with no board-specific cache handling.
- **The board shows the 100 most recently updated live applications**, which is the server's `limit`
  cap, and says so when there are more. A board is a working view, not an archive; the table view
  filters the rest.

### Keyboard dragging

- **A custom `coordinateGetter` steps one column per arrow press.** dnd-kit's default nudges by
  25 px, which on a 320 px column means a dozen presses to cross one. Stepping through the declared
  column index makes the keyboard path as direct as the pointer one and does not depend on how wide
  the columns happen to be.
- **Collision detection is `pointerWithin` with a `closestCenter` fallback.** A keyboard drag has no
  pointer, so `pointerWithin` returns nothing and the centre-based pass resolves the drop.
- **The drag listeners live on a real button inside the card, not on the card body.** The keyboard
  sensor needs something focusable to activate, and a button gives it that with a label naming the
  card and the column it is leaving.

### Testing dnd-kit under jsdom

- **jsdom reports every element as a zero-sized box, so the board is given a synthetic layout.**
  `mockBoardLayout` lays columns out left to right by `data-column-index` and stacks cards inside
  them by `data-card-index`, which is the geometry a browser would produce. Without it dnd-kit has
  nothing to resolve a drop against. `ResizeObserver` and `PointerEvent` are shimmed in the test
  setup for the same reason: they are platform gaps, not application behaviour.
- **The two `data-*` attributes exist for that layout mock.** They are inert in production and are
  the same kind of hook as the `data-testid` values used elsewhere.
- **Both drag paths are tested end to end**, pointer and keyboard, each with a success case and a
  rollback case, so "the library supports keyboard" is not taken on trust.

### Calendar

- **The visible window is part of the query key, so changing month issues a request.** The key is
  `['calendar', from, to]`; there is no single fetched window being re-filtered.
- **The range covers the whole grid, not the month.** February 2026 opens on a Sunday, so the grid
  starts in late January; fetching only the month would leave those cells looking empty when they
  are not.
- **The month lives in the URL as `?month=YYYY-MM`,** for the same reason the table's filters do: the
  view someone is looking at should survive a refresh and be shareable.
- **Clicking an event navigates to the Phase 6 detail page** rather than opening a second summary
  surface, so a deadline or an interview is edited in exactly one place.
- **Days are bucketed by local calendar day**, which is what a month grid means. The tests build
  their fixtures from local components rather than fixed UTC instants, because an instant near
  midnight lands on a different day depending on the runner's timezone.
- **`monthGrid.ts` was renamed `monthModel.ts`.** It collided with `MonthGrid.tsx` on a
  case-insensitive filesystem, which TypeScript reports as two files differing only in casing.

### Build

- **dnd-kit is its own chunk.** Only the board needs it, so it stays off the dashboard's path, the
  same reasoning that separated the markdown pair in Phase 6.

## Phase 8 - Dashboard and charts

### Extending Phase 4's summary endpoint

- **`GET /analytics/summary` gained a `period` block, because the stat card deltas SPEC section 6
  asks for cannot be derived from what Phase 4 returned.** The endpoint reported all-time standing
  only, and `/timeline` aggregates status changes across every status at once, so neither carries
  "interviews this month against last month". The alternative was computing deltas in the browser,
  which is not possible from either payload.
- **The change is additive.** Every field Phase 4 returned is untouched and `periodDays` defaults to
  30, so existing callers, tests and the OpenAPI round-trip check see the same response they did.
- **Both windows are measured on the cohort of applications created inside them,** not on events
  that happened inside them. One population, asked the same question twice, is comparable; mixing an
  all-time total with a windowed event count is not. The known cost is cohort maturity: the previous
  window's applications have had longer to progress, so a rate delta flatters the older cohort
  slightly. That is a smaller distortion than the alternatives and is the standard way these cards
  are built.
- **It costs no extra database round trip.** Three branches were added to the `$facet` that already
  existed, after `withMilestones`, so "ever reached interview" is a boolean test on a field the
  pipeline had already computed.
- **The previous week is resolved by stepping back a day and re-running `startOfLocalWeek`,** not by
  subtracting seven times 86,400,000. Across a daylight saving change the fixed subtraction lands in
  the wrong week for the accounts that observe it.

### Load demo data

- **"Load demo data" needed a real endpoint: `POST /applications/demo-data`.** SPEC section 9's seed
  is a CLI script, which a browser cannot run. Generating rows client side and posting them one at a
  time would be sixty-odd requests and would ship the fixture generator in the client bundle.
- **It refuses any account that already holds an application, with 409 `DEMO_DATA_NOT_EMPTY`.** The
  button only renders in the zero-application empty state, but the server is the authority: this is
  reachable by any signed-in caller and must never be able to mix fixture rows into real data. A
  test asserts the refusal leaves the account exactly as it was.
- **The generator lives in `demoData.service.ts` and is deterministic.** Phase 10's `npm run seed`
  imports `buildDemoApplications` rather than growing a second definition of "realistic data". A
  seeded PRNG rather than `Math.random` means an assertion about the generated spread is
  reproducible instead of flaky.
- **`insertMany` is called with `{ timestamps: false }`, cast to `InsertManyOptions`.** Mongoose
  honours the option at runtime but has never listed it on the published type. Without it the
  back-dated `createdAt` values are overwritten with the insert time and every chart collapses onto
  a single day.

### Theme-reactive charts

- **The palette is re-read from `getComputedStyle` on every theme change, keyed on the theme store's
  `resolved` value.** Chart.js resolves colours once, when it is handed an options object, and has
  no idea a CSS variable exists. `setPreference` writes `data-theme` onto the document element and
  sets `resolved` in the same action, so keying the memo on it guarantees the read happens after the
  attribute flip and returns the incoming palette rather than the outgoing one.
- **The new colours are pushed into the live chart rather than remounting it.** react-chartjs-2
  assigns changed `data` and `options` onto the existing instance and calls `update()`. Keying the
  components to force a remount would work too, but it throws away the mount animation and any open
  tooltip on every toggle.
- **Every colour in a chart option is a token, tooltips included.** Chart.js defaults the tooltip to
  an opaque near-black box with white text, which is a fixed pixel colour and unreadable on a light
  canvas. Background, border, title and body all come from the same tokens the rest of the app uses.
- **Six categorical `--color-chart-*` tokens and five `--color-heat-*` tokens were added.** The
  semantic tokens cannot carry a by-source or top-companies chart on their own: those need colours
  that are distinguishable from one another rather than colours that mean something.
- **The doughnut keeps each status on the colour its pill already has,** so a slice and a badge for
  the same status never disagree. Ghosted and withdrawn share a grey pill but get separate chart
  tokens, because two identical slices would be unreadable. The custom legend paints its swatch from
  the palette inline rather than from a Tailwind class, so the swatch and its slice cannot drift.
- **`useChartPalette` carries a targeted `react-hooks/exhaustive-deps` disable.** The factory does
  not reference `resolved`, but `resolved` is genuinely its input: the values read off the document
  are decided entirely by the attribute the store writes alongside it. The rule only sees
  identifiers. The alternative, recomputing the palette on every render, would push a pointless
  Chart.js update on each one.

### Chart.js weight

- **Components are registered by hand; `chart.js/auto` is never imported,** as SPEC section 12
  requires. Measured both ways on this build: explicit registration produces a 174.86 kB raw /
  61.39 kB gzip vendor chunk against 209.07 kB / 71.90 kB for `chart.js/auto`, so the hand-written
  registry saves 10.5 kB gzip. `Legend` is deliberately not registered — every legend on the page is
  our own markup, which SPEC section 6 asks for on the doughnut anyway and which keeps legends
  themeable and keyboard reachable.
- **The weekly goal ring is hand-drawn SVG, not a sixth Chart.js instance.** A single-value ring
  needs no scales, tooltip or legend, and one arc costs a few bytes against a whole doughnut
  controller. It reads the same token palette, so it re-themes with the charts.
- **The dashboard route is the only lazy route so far.** `React.lazy` on the page module puts the
  whole chart subtree in its own chunk, so the applications, board, calendar and settings routes
  never download Chart.js.
- **Phase 7's note that dnd-kit "stays off the dashboard's path" was wrong, and this build shows it.**
  Being a separate chunk is not the same as being off the path: `App.tsx` imports the board and
  detail pages eagerly, so the entry chunk statically imports both `dnd` and `markdown` and every
  route pays for them. Correcting that means lazy-loading the other routes too, which is Phase 15's
  code-splitting item; the dashboard budget below is reported with those two chunks counted in.

### Accessibility

- **Every chart ships its data twice: once on the canvas and once as a visually hidden table.** A
  canvas has no DOM inside it, so without the table the dashboard is silent to a screen reader.
  `sr-only` rather than `aria-hidden` or `display: none` keeps the table in the accessibility tree
  while keeping it out of the layout.
- **The doughnut's centre total is markup, not a canvas plugin,** so it is real text that a reader
  announces and a text zoom scales.
- **A stat card's direction is carried by an arrow plus the word "Up" or "Down" in hidden text,**
  never by the red or green alone.

### Bugs found by the tests

- **The upcoming panel refetched forever.** `useUpcomingQuery` built its window from `new Date()` on
  every render, and since the window is part of the query key, the key changed on every render and
  the request never settled. The window is now truncated to the top of the hour, which makes the key
  stable between renders while still moving forward on its own.
- **Every application write left the dashboard stale.** The shared optimistic mutation invalidated
  only the applications lists, so adding a row moved no number and no chart. It now invalidates the
  analytics and calendar trees as well; neither is patched optimistically, because both are
  server-side aggregates rather than copies of a row the client is holding.
- **The chart data memos never held.** `sources ?? []` allocates a fresh array on every render, so
  the `useMemo` that builds the chart data saw a new dependency each time and pushed a redundant
  update into Chart.js. The fallbacks are memoised on the query result instead.

### Testing charts under jsdom

- **The tests run real Chart.js and real react-chartjs-2 against a stubbed 2D context.** jsdom has no
  canvas, so `getContext` returns nothing and the `update()` a theme change goes through would fail
  on a null context. A proxy that answers any drawing call with a no-op is enough for Chart.js to
  run its layout, scale and update passes headlessly. Nothing about the chart's configuration is
  faked: the assertions read `Chart.getChart(canvas).options` and `.data`, which is the object
  Chart.js paints from.
- **The theme test asserts against the shipped palette, not a copy of it.** `installThemeTokens`
  reads the `:root` and `[data-theme='dark']` blocks out of `src/index.css` and injects them, so a
  chart colour is compared against the value the app actually ships. Restating the palette in the
  test would let it pass against colours the app no longer uses.
- **The token blocks are read off disk rather than imported.** Vitest runs with `css: false`, which
  stubs every stylesheet import to an empty string, `?raw` included.
- **The theme test was checked against a deliberately broken implementation.** Caching the palette at
  module scope, which is the exact bug this phase is meant to prevent, fails the two repaint cases
  and passes the rest, which is what it should do.

### Two existing tests were rewritten, deliberately

- **`routing.test.tsx` and `RegisterForm.test.tsx` used the Phase 8 placeholder as their "landed on
  the dashboard" signal.** That placeholder no longer exists. Both now assert the real dashboard
  heading and answer its requests, which is a stronger check than before: the routing case also
  proves the lazy chunk resolves and the Suspense fallback gives way.

## Phase 9 - Settings, polish, accessibility, responsive

### Theme precedence between the device and the account

- **Local storage wins until the account value loads, then the account wins and is written
  back to local storage.** Local has to win first because it is the only value that exists
  before `/auth/me` answers, and it is what the inline boot script reads to paint the right
  theme before React mounts. The account then takes over because it is the durable
  cross-device preference and the cached copy is only a stand-in for it. Writing it back is
  what makes the _next_ cold load paint the account's choice with no flash.
- **A toggle made while signed in applies locally first, then PATCHes.** Waiting for a round
  trip before repainting makes the control feel broken on a slow connection. The mutation
  rolls the local value back if the write fails, so the screen and the account cannot end up
  disagreeing, which is the whole failure this sync exists to prevent.
- **A toggle made while signed out is local only** and is overridden by the account at the
  next sign in. Signing in as somebody else therefore lands on their theme rather than on
  whatever the previous person left on the machine.
- `adoptAccountPreference` is a no-op when the values already agree, so a refetch cannot loop.

### Settings

- **No server work was required.** `updateMeSchema` already accepted name, avatarUrl,
  university, gradYear, targetRoles, weeklyGoal, theme, timezone and emailRemindersEnabled,
  and the password endpoint already existed. Phase 9 is a client phase in full.
- **The password section states the consequence before the button, and again in the toast.**
  SPEC section 5 has the server revoke every other refresh token, and silently signing
  somebody out of their phone while they sit on their laptop is a support complaint waiting to
  happen. The wording is "you will stay signed in on this device".
- **Editing the timezone is safe and needed no coordination with phase 4.** The reminder sweep
  re-reads every distinct timezone each hour and the analytics pipelines take it per request,
  so nothing derived is cached and a change simply applies from the next tick. Before this
  page the field was write-once at registration.
- **Export and delete are disabled affordances, not hidden ones.** A full account export needs
  a document containing everything the system holds; `GET /applications/export` covers only
  the applications, so shipping it under that label would under-deliver on a promise the
  privacy page will make (Phase 14). Deletion needs the soft delete, the purge job and the
  typed confirmation (Phases 11 and 14). Both are rendered with the reason stated, because
  somebody looking for "how do I get my data out" needs to find the answer here even while
  the answer is "not yet".
- **Forms re-seed from the account only while untouched**, reusing the guard Phase 6 arrived
  at after a background refetch discarded in-progress typing.
- **`PhasePlaceholder` was deleted.** Phase 9 replaced the last page using it, so it became
  dead code.

### Accessibility defects found in phases 5 to 8

- **The nav drawer was keyboard reachable while closed.** Below `lg` it was only translated
  off screen. A transform moves pixels but leaves everything inside focusable, so Tab from
  the topbar walked through six invisible links. `visibility: hidden` is what actually removes
  a subtree from the tab order; `inert` would need a polyfill and JavaScript breakpoint
  tracking to achieve the same thing.
- **Tapping the nav entry for the current page left the drawer open**, because it only closed
  on a pathname change and clicking the active route changes nothing. Found in a real browser.
  It now closes on click as well.
- **The token palette failed 4.5:1 in seven places.** Six were in the light theme:
  `text-subtle` on `surface-muted`, `info` as body text, and the info, warning, success and
  danger pills measured against their own 15% tint rather than against the plain surface. The
  tint is the subtle one: a token can pass on a white card and still fail inside its own pill,
  because the tint lifts the background towards the text. Fixed by darkening four light
  semantics and nudging `text-subtle` in both themes.
- **The dark theme put white on the danger button's lighter red at 2.77:1.** `danger` now has
  a `danger-fg` token mirroring `primary-fg`, rather than the button hardcoding white.
- Contrast is now asserted by a test that reads the ratios out of `src/index.css`, so a future
  palette edit that breaks one fails the build instead of shipping.

### What was already compliant

Verified in the components rather than taken from PROGRESS.md: all four modals use the `Modal`
primitive, every `<button>`, `Button`, `Link` and `<a>` has an accessible name, all five
phase 8 charts render a real `sr-only` data table with a caption, the skip link targets a
`main` landmark that exists, the board scrolls sideways at 375, the table becomes stacked
cards below 768, calendar days are `role="gridcell"` buttons and the popover closes on Escape.

### Real-browser verification

- **It happened this phase; it is not deferred again.** A Chromium build already sits in the
  Playwright cache and was driven through `executablePath` against the running compose stack,
  at 375, 768 and 1440 in both themes across all five routes.
- **Two blockers had to be cleared, both worth recording.** The Playwright MCP tool insists on
  Chrome, which is not installed on this machine. And both container images were stale: the
  api had been in a crash loop for hours against a missing `swagger-ui-express`, and the web
  image predated axios, date-fns and dnd-kit. Both were rebuilt, so the compose stack actually
  works again.
- **No Playwright dependency was added to the repository.** The browser was driven from a
  throwaway script outside the repo. The committed suite, its fixtures and CI wiring stay
  Phase 15; this phase borrowed a browser, it did not build the harness.
- **The first metric used was wrong and was corrected.** `documentElement.scrollWidth` counts
  descendants a scroll container has already clipped, so it reported large overflows on the
  board that no user could reach. The honest test is `body.scrollWidth` against the viewport
  plus actually attempting to scroll, which is what the final pass used.

### Known open defect

- **The document scrolls horizontally on the board route at every width**, and on applications
  at 768, even though `body.scrollWidth` equals the viewport and the board's own strip scrolls
  correctly. `overflow-x-clip` on `main` did not fix it and was reverted rather than left in
  place with a comment claiming a fix it did not deliver. The root cause is not isolated; it
  is carried to Phase 15 alongside the rest of the responsive and E2E work.

## Phase 10 - Seed, tests, documentation, CI

### Seed data

- **`npm run seed` imports `buildDemoApplications` from `demoData.service.ts` and adds no rows of its
  own.** Phase 8 asked for this explicitly. Before wiring it up the generator was measured against
  SPEC section 9's bar rather than assumed to meet it: 64 rows spread from 3 to 182 days ago across 7
  calendar months, all 8 statuses, 7 sources, 15 companies, 10 roles, 10 tags on 45 rows, 23
  interviews on 12 applications, 30 deadlines split 24 past and 6 upcoming, and 146 status-history
  entries over 100 distinct days. It clears the bar unchanged, so nothing in it was touched.
- **One caveat recorded rather than papered over: no generated deadline falls inside the 3-day
  amber-chip window.** That chip is a Phase 7 affordance, not one of SPEC section 9's requirements,
  and the upcoming panel still shows five real events, so the generator was left alone rather than
  bent to light up one component.
- **The script lives in `src/scripts/`, not `src/services/`.** The convention that every service
  function takes `userId` first does not fit an operation whose job is to create the user. Keeping it
  out of `services/` keeps that rule absolute. The logic is exported and tested; only the
  `require.main` bootstrap is untested, the same shape as `index.ts`.
- **Seeding twice is refused; `seed:reset` is the way to reseed.** Re-running the plain seed would
  silently double every number on the dashboard, which looks like data rather than an error.
- **`DEMO_EMAIL` and `DEMO_PASSWORD` became real env vars.** SPEC section 8 lists both and SPEC
  section 12 signs the "Try the demo" visitor into the same account, so they are configuration, not
  constants buried in a script. They are published in the README deliberately.
- **Reset restores the profile and password as well as the rows.** An account left in an odd state by
  manual poking comes back to a known one, which is what a reset is for.

### The .env.example boot failure

- **Copying `server/.env.example` to `server/.env` - the documented setup step - made the server
  refuse to boot, and this phase fixed it.** dotenv reads a bare `KEY=` as an empty string, and zod's
  `.optional()` only skips `undefined`, so all five blank `S3_*` keys failed validation even with
  `STORAGE_DRIVER=local`. Nothing had caught it because the tests set env vars programmatically and
  compose sets them inline, so nobody had run the npm path from the example file. `parseEnv` now
  drops empty-string values before validating.
- **The blast radius was wider than the seed script.** With `server/.env` present, 13 of 30 test
  suites failed on the same error, so a developer following the documented setup got a broken test
  run as well as a dead server.
- **Blank means unset, which is also what a reader expects `KEY=` to mean.** A defaulted key falls
  back to its default instead of failing coercion, and a required one reports "Required" rather than
  a confusing length error.
- **The regression test parses the shipped `.env.example` itself, not a copy of its contents.** A
  later phase adding another blank optional key - `SMTP_*` in 12, `SENTRY_DSN` in 14 - cannot
  reintroduce this without failing the test.

### Test coverage

- **The SPEC section 10 target was already met before this phase started: 97.79% statements on
  `src/services` and 99.09% on `src/controllers`, against a 70% target.** The coverage report was run
  first, as instructed, and it showed no gap to close. No tests were written to move a number.
- **Tests were still added, for behaviour that was genuinely unproven**, each traceable to an
  uncovered line: weekly and monthly timeline bucketing (`analytics.service.ts:466`), CSV import of
  the stipend and contact columns our own export writes, the 1000-row import cap, an attachment
  upload with no file, and `/ready` returning 200 against a live database rather than only the 503
  path.
- **The weekly-bucket test was checked against a deliberately broken build.** Removing
  `startOfWeek: 'monday'` makes MongoDB default to Sunday, and the test fails with `getUTCDay()` 0
  instead of 1. The source was restored byte-identical afterwards.
- **A planned test was dropped after it turned out not to be a gap.** The `USER_NOT_FOUND` throws in
  `auth.service.ts` looked uncovered, but `requireAuth` already filters `deletedAt: null` and returns
  401 before any service runs, and a test already proves that. Those throws are unreachable
  defence-in-depth, so an HTTP test for them was impossible and a service-level one would have
  asserted only that Mongoose returns null.
- **Other uncovered lines are stated rather than padded.** `application.service.ts:127` and
  `applicationTransfer.service.ts:217` are defensive rethrows; `application.service.ts:317` is
  unreachable through HTTP because `bulkActionSchema.refine()` rejects it at the route boundary; the
  rest are default parameters and nullish fallbacks.
- **The target is now enforced instead of observed once.** `server/jest.config.js` carries a
  `coverageThreshold` on both directories, so a later phase adding an untested service fails CI.
  Directory keys aggregate, which is the number the SPEC asks for; glob keys would apply per file.

### Documentation

- **The env var table documents what exists, not what SPEC section 8 lists.** Phase 1 set the
  convention that a variable lands in `.env.example` in the phase that consumes it. The README states
  which SPEC variables are still unimplemented and which phase each one arrives in, so the gap is
  visible rather than silent.
- **The API table has no drift to flag.** `openapi.test.ts` already walks the Express stack in both
  directions and fails if a route is undocumented or a documented path is stale, so the table, the
  OpenAPI document and the router agree by construction.
- **The Docker path was corrected, not just confirmed.** `docker compose exec api npm run seed -w server`
  initially failed with "Missing script", because compose mounts only `server/src` and the image
  still held the pre-Phase-10 `package.json`. The stack was rebuilt with `docker compose up --build`
  and the seed then worked; the README says the rebuild is needed after a manifest change.
- **The README warns about the two-MongoDB trap.** This machine runs a native MongoDB on
  `127.0.0.1:27017` alongside the container bound to `0.0.0.0:27017`. Seeding from the host wrote to
  the native one while the app read the containerised one, which presents as "the seed succeeded but
  the dashboard is empty".

### Dashboard verification

- **The dashboard was checked in a real browser against the seeded database, not by counting rows.**
  Chromium from the Playwright cache was driven through `executablePath`, signed in as the demo user,
  and every panel inspected: five Chart.js canvases each with at least one non-transparent pixel,
  five populated screen-reader tables (14, 8, 7, 4 and 10 rows), an activity heatmap reporting 35
  applications across 31 active days, and five real events in the upcoming panel. Screenshots were
  taken in both themes.
- **Dark mode had to be driven through `prefers-color-scheme`, not local storage.** Writing
  `theme: dark` to local storage did nothing, because Phase 9 made the account preference win once
  `/auth/me` resolves and the demo account is set to `system`. Emulating the OS preference is the
  honest way to exercise that path, and it resolved `data-theme="dark"` with every chart repainted.
- **No Playwright dependency was added to the repository**, exactly as in Phase 9. The committed
  suite stays Phase 15.

### CI

- **The workflow runs `test:coverage` rather than `test` for the server.** SPEC section 10 asks for
  the report to be printed, and it is what makes the coverage threshold a gate.
- **The mongod binary that `mongodb-memory-server` downloads is cached.** Uncached it dominates the
  run, and a flaky download would turn CI red for a reason unrelated to the code.
- **CI supplies its environment inline and leaves `NODE_ENV` unset.** Jest sets it to `test` itself,
  and setting it in the workflow would have masked that.

### The first real CI run

- **CI went red on its first run, on a pre-existing Phase 6/7 client test rather than anything this
  phase added.** The board's version-conflict case asserts that "Overwrite with my changes" reissues
  the PATCH without a version. It had always passed locally, so nine phases of green local runs had
  never exposed it. The workflow itself has since gone green once, run 33854468800, all ten steps
  passing: https://github.com/naabelverse/internship-tracker/actions/runs/33854468800
- **The first diagnosis was wrong, and is recorded here as wrong rather than quietly replaced.** It
  looked like Testing Library's 1000 ms `waitFor` budget being too tight for a loaded runner, and
  forcing `asyncUtilTimeout: 1` locally did reproduce the failure — which is weak evidence, because a
  short enough timeout reproduces _any_ async failure. The budget was raised to 5 s. The next run
  failed at 5158 ms, the full new budget, which disproved it outright: more time never helps. Both
  timing changes were reverted.
- **The real cause, from instrumenting the components and reproducing locally at 2 failures in 6
  runs.** At failure the dialog is absent from the DOM and `onOverwrite` never ran at all, so the
  click found the button but the node was detached before the event dispatched. `BoardPage` renders
  `KanbanBoard` only under `query.isSuccess && applications.length > 0`, and a probe on the query
  shows it repeatedly flipping to `isPending=true, data=undefined` during the optimistic write and its
  rollback. The board is therefore torn down and rebuilt mid-interaction: `conflict` is re-set on the
  new instance by the mutation's error handler, which is why the dialog appears at all, but
  `pendingDrop` is lost with the old one.
- **This is a user-facing defect, not a test artefact.** The conflict dialog can vanish before the
  user can act on it, and `onOverwrite` silently does nothing when `pendingDrop` is null — the dialog
  closes and the move is discarded with no error and no toast.
- **A partial fix was tried and reverted.** `placeholderData: (previous) => previous` on the board
  query cuts the failure rate from 2-in-6 to 1-in-15 but does not eliminate it, so it was taken back
  out rather than left in place claiming a fix it does not deliver — the same call Phase 9 made on
  `overflow-x-clip`.
- **The test was left exactly as written.** It is correct, it is the only thing that found this, and
  making it wait for the UI to settle would have hidden a real bug. CLAUDE.md forbids weakening a test
  to make a build pass, and that applies just as much to a test that is right about something
  inconvenient.
- **Carried to the top of Phase 11, before any feature work.** The likely shape of the fix is to stop
  `pendingDrop` living in a subtree the loading state can unmount: hoist it and the dialog into
  `BoardPage`, or carry the attempted payload on the conflict object so the retry does not depend on
  separate state surviving a remount.

## Blocking fix - board conflict dialog lost on remount

Not a phase. A data-loss defect in Phase 7's drag and drop, found by the first real CI run
at the end of Phase 10 and fixed before Phase 11 started.

### Root cause

`BoardPage` renders `KanbanBoard` only under `query.isSuccess && applications.length > 0`.
An optimistic write cancels every application query and its rollback restores them, which
leaves the board's query briefly with no data at all: `isPending` flips back to true and the
skeleton replaces the board. Everything `KanbanBoard` owned was destroyed at that moment,
and it owned the version-conflict state, the pending drop and the dialog itself. So a drag
that hit a 409 could have its prompt vanish before the user answered it, and because
`pendingDrop` died with the old instance, "Overwrite with my changes" then did nothing at
all - the prompt closed and the drag was discarded with no error and no toast.

### The fix, and why this shape

- **The mutation, both pieces of state and the dialog moved up into `BoardPage`.**
  `KanbanBoard` is now presentational and takes an `onMove` callback. `BoardPage` owns the
  query, so nothing that query does can unmount it, and the dialog renders outside every one
  of the branches that toggle.
- **Carrying the payload on the conflict object was rejected as the primary fix.** It would
  have saved the payload but not the dialog, which is rendered by the component that
  unmounts. The requirement was that both survive.
- **A third reason decided it.** The `useUpdateApplication` observer lived in `KanbanBoard`
  too, and `onError` - the callback that raises the conflict - belongs to that observer. If
  the board unmounted while the PATCH was in flight the conflict could never be raised at
  all, so no dialog would appear in the first place. Only hoisting fixes that.

### The regression test

`client/tests/board/conflictDialogSurvival.test.tsx` constructs the failure rather than
waiting for it. The list responder is gated so every refetch after the first hangs, then
`resetQueries` empties the board's query while the 409 prompt is open. The board is
therefore unmounted for exactly as long as the test wants, with no reliance on scheduling.
It asserts the skeleton is showing and the board is gone - so the reproduction cannot
silently stop reproducing - then that the dialog is still present with the right document,
and that overwrite still sends the original `{ status: 'interview' }`.

- **`resetQueries`, not `removeQueries`.** Removing a query that still has a mounted observer
  drops the cache entry but leaves that observer rendering its last result, so the component
  never reaches its loading branch and the test would have quietly proved nothing. Found by
  probing the cache directly rather than assuming.
- **Checked against the unfixed code.** All three cases fail on the pre-fix components with
  "Unable to find role=dialog": the prompt is simply gone. They pass on the fixed ones.

### Audit of the same pattern elsewhere

- `ApplicationsPage` inline status dropdown and bulk bar: **safe.** `useChangeStatus` and
  `useBulkAction` are called at page level, above the conditional, and neither owns a dialog
  - failures go to a toast rendered globally.
- `ApplicationsPage` edit modal: **same class, real.** `const editing = applications.find(...)`
  with `isOpen={editing !== undefined}`, so if the list blinks empty the modal closes
  mid-edit, taking the in-progress form and its own `VersionConflictDialog` with it.
- `ApplicationDetailPage`: **same class, lower likelihood.** `if (query.isPending) return
<DetailSkeleton/>` sits above `ApplicationFormModal`, `InterviewFormModal` and the delete
  `ConfirmDialog`, so all three unmount if that query ever returns to pending.

Both were reported rather than fixed, to keep this change to the defect it was scoped to.

### Still open

`dragAndDrop.test.tsx`'s overwrite case remains intermittent, and the required twenty-run
clean loop was **not** achieved. It is not this defect: the case passes 8 runs out of 8 on
its own and fails about three in four when the two cases before it run first - both of which
end with the modal still open. At the failure the clicked button is attached, enabled and
correctly labelled, yet no React handler runs and no dialog callback fires, which is the
signature of a node belonging to a tree React has already unmounted. Sweeping
`document.body` in `resetClientState` did not help and was reverted rather than left in place
claiming a fix it did not deliver.

Closed by the section below. The unmounted-tree reading above turned out to be wrong: nothing
was left mounted, and the two preceding cases were a coincidence rather than a cause.

## Blocking fix - the board overwrite case's twenty-run flake

Not a phase. The last item standing between Phase 10's CI gate and Phase 11.

### Root cause

`@dnd-kit/core`'s `AbstractPointerSensor` installs a **capture-phase `click` listener on the
document that calls `stopPropagation`**, in `handleStart`, so that the click a pointer device
emits when a drag is released cannot also activate whatever sits under the cursor. It removes
that listener from `detach()` on a `setTimeout(..., 50)` - so the suppressor outlives the
release by 50 ms of real time. `pointerDrag` returned synchronously at `pointerUp`, so any
click a test made in the following 50 ms was stopped at the document before it reached its
target or React at all.

That is the whole of it. The button really is attached, enabled and correctly labelled; the
event really is dispatched; it simply never descends past the document.

### The evidence, because the previous reading was wrong

- **Nothing is left over between cases.** Instrumenting `document.body` at the end of the two
  preceding cases and again after `resetClientState` shows two children before and **zero**
  after, with no `role="dialog"` surviving. RTL's `cleanup` was doing its job the whole time.
  There is no cleanup gap, no missing `unmount`, no unflushed timer.
- **The click dies above `<body>`.** Counting the click at three points - `document` capture,
  `document.body` capture, and the button itself - gives `1 / 0 / 0` on a failing run and
  `1 / 1 / 1` on a passing one. Only a capture listener on the document itself can produce
  that, and dnd-kit's is the only one.
- **The two preceding cases are a red herring, and the mechanism is timing.** Measuring the
  gap between the release and the click: **28-36 ms with those cases running first, 45-74 ms
  with the case run on its own.** They do not leak anything into it - they warm the module
  graph, so the third case reaches its click sooner and lands inside the 50 ms window. That is
  exactly why it passed 8 out of 8 alone and failed about three in four in file order.

### The fix

`pointerDrag` is now `async` and does not resolve until dnd-kit has stopped swallowing clicks;
its ten call sites await it. Detection is by probe rather than by sleeping on the constant: a
non-bubbling click dispatched at `<html>`, whose event path is therefore `document` then
`<html>` only, which is off the path of both React roots since they live inside `<body>`. If
the suppressor is installed the probe is stopped at the document and never reaches the target
phase, and `waitFor` polls again.

- **The probe mutates nothing, deliberately.** The first attempt appended and removed a scratch
  node per poll. `waitFor` re-runs its callback from a MutationObserver, and those callbacks
  are microtasks, so the probe re-armed itself faster than the event loop could ever reach the
  50 ms macrotask it was waiting on: the suite hung outright rather than failing. Dispatching
  at an element that is already there fixed it.
- **Fixed in the helper, not at the one call site that hurt.** Any future test that clicks
  after a drag would hit the identical trap, and it fails silently - a live, enabled, correctly
  labelled node and no handler. Making the helper's contract honest ("the drag is over when
  dnd-kit says it is") is what stops it recurring.
- **Not a `document.body` sweep in shared setup.** That was tried in the previous session,
  did not work, and would have hidden genuine unmount bugs in later tests. The evidence above
  says why it could not have worked: nothing was left in the body to sweep.
- **No product code changed and no test was weakened.** The dnd-kit behaviour is correct in a
  browser - a hand cannot reach a button within 50 ms of letting go of a card - and the
  overwrite case still asserts exactly what it asserted before.

### The regression test

`client/tests/board/dragClickSuppression.test.tsx` performs a real drag and then dispatches a
click with no `await` in between, asserting it is delivered. It fails deterministically
against the unfixed helper (`expected +0 to be 1`), not intermittently, so a future change that
drops the wait is caught on the first run rather than three runs in four.

### Verification

`dragAndDrop.test.tsx` run 20 times consecutively: **20 passed, 0 failed.** Full client suite
after: 25 files, 234 tests, all green.

## Blocking fix - the edit modal closing when its row leaves the list

Not a phase. The second instance the board fix's audit found and reported without fixing,
and the last thing standing before Phase 11.

### Root cause

`ApplicationsPage` re-derived the edit modal's open state from the live list on every
render: `const editing = applications.find(...)` with `isOpen={editing !== undefined}` and
`application={editing}`. So the modal's existence depended on a value any refetch could take
away for a moment.

Three failures follow from that one cause, and the third is the worst:

- **The modal closes mid-edit.** `editing` goes undefined, `isOpen` goes false, the `Modal`
  unmounts and the user's half-written form is off the screen.
- **The typed values are wiped when the row comes back.** `ApplicationFormModal` keys its
  reset effect on `formIdentity`, which is `${application?.id ?? 'new'}:${String(isOpen)}`.
  A round trip takes that from `app-1:true` to `new:false` and back, so the effect fires and
  resets the form to the server's copy. The machinery that exists precisely to stop a
  background refetch wiping the form was defeated by the prop going undefined underneath it.
- **Saving creates a duplicate instead of updating.** `isEdit` is `application !== undefined`.
  While the row is missing it is false, so both Save and "Overwrite with my changes" take the
  create branch: a silent `POST /applications` making a second copy, rather than the
  `PATCH /applications/app-1` the user asked for. No error, no toast.

Reachable through ordinary use: an optimistic delete or bulk delete removes the row from
every cached list through `removeCachedApplications`; a refetch after a status change can
return a page that no longer matches the active filter; a page or filter change swaps the
query key for one with no data at all.

### The fix, and why not the board's shape

**The row is snapshotted when Edit is clicked and held in state** - `editing: Application | null`
instead of `editingId: string | null` plus a `find`. `isOpen={editing !== null}`.

- **There was nothing to hoist.** Unlike `BoardPage`, this modal is already rendered
  unconditionally at page level, outside every query branch, and never unmounts. The board's
  defect was an unmounting subtree; this one is prop re-derivation on a component that stays
  mounted. Copying the board's mechanism would have been the wrong tool for a different bug.
- **The snapshot is the more correct value, not just the more robust one.** `version` in the
  save payload has to be the version the user read - that is the whole basis of the 409.
  Re-deriving from the live list silently advanced it on every background refetch, which
  quietly disarmed the conflict check that `VersionConflictDialog` exists to handle. The
  snapshot fixes that second, quieter bug at the same time.
- **No child changed.** `onEdit` still takes an id; the page resolves it once, against the
  list the user is actually looking at, and keeps the result.

### The regression test

`client/tests/applications/editModalSurvival.test.tsx` removes the row with
`removeCachedApplications` - the production helper an optimistic delete uses - and puts it
back with the restore closure that same helper returns, so the reproduction is the real code
path rather than a synthetic one and never depends on scheduling. The list responder is gated
so no refetch can refill the list before the assertions run. All three cases fail against the
unfixed page, each with its own signature: "Unable to find role=dialog and name Edit
application", a Role field reset to the server's value, and one PATCH where two were expected.

- **A test that passed before the fix was treated as a broken test, not a green one.** The
  round-trip case originally dropped and restored the row back to back and passed on the
  unfixed page. TanStack notifies observers through a scheduler, so the two writes coalesced
  into no render at all and the round trip never happened. It now waits for the row to
  actually leave the DOM before restoring it, and fails against the unfixed page as it should.

### Audit item three, re-checked properly

`ApplicationDetailPage` was reported as "same class, lower likelihood". Checked rather than
re-hedged: it is **safe today, but only by the behaviour of three separate things**, none of
which is a guarantee the page itself makes.

- Nothing in `src/` calls `resetQueries` or `removeQueries` at all.
- `onSettled` invalidates `lists()`, `analytics` and `calendar` - never `details()` - and
  invalidation retains data anyway.
- `mapCachedApplication` ends its details branch with `return map(data) ?? data`, so even an
  optimistic delete cannot blank a cached detail entry.
- `refetchOnWindowFocus` is false, so there is no background refetch to fail and flip the
  query to `isError`.

So `query.isPending` cannot become true again, and `!application` cannot become true, while
the id is unchanged - the early returns above the three modals are unreachable after the
first success. **Left as it is, deliberately**, because there is no reachable defect to fix
and restructuring it would be a change with no failing test behind it. The hazard is latent
rather than live: adding a `resetQueries` on details, or changing that `?? data`, would
reintroduce the board's defect on this page with nothing to catch it.

## Phase 11 - account lifecycle (backend)

Split from the phase's UI at your instruction: the server side and its tests land here, the
`/forgot-password` and `/reset-password` pages SPEC section 16 also lists are a follow-up.

### Two premises in the brief that the code disagreed with

- **The lifecycle fields were not all unused.** They are all present as SPEC section 4 lists
  them, but `failedLoginAttempts` and `lockedUntil` were already fully implemented in
  `auth.service.ts` - Phase 2 built the ten failure, fifteen minute soft lock. Account lockout
  was therefore a verify-and-test item this phase, not a build item, and no lockout logic was
  written. `emailVerified` was half wired: set by the seed and exposed in the OpenAPI schema,
  never enforced. Only the five token and `pendingEmail` fields were genuinely untouched.
- **The purge job belongs to this phase, not Phase 14.** SPEC section 16 phase 11 reads "soft
  delete + purge job" in as many words. Section 14 has no job list at all - it is Observability
  and operations, covering logs, Sentry, the health probes, the backup script and `npm run
stats`. Phase 14 lists the account deletion _UI_ and data export, not the purge.

### Forgot-password: how the responses are identical

- **One path, no branch.** The handler never asks whether the account exists. It writes a fixed
  literal message with `{ requested: true }` and only then hands the address to the service,
  which does the token work for a real account and returns immediately for anything else. The
  responses cannot disagree because there is only one of them. The test asserts equal status,
  equal body, equal key ordering, and equal `content-type` and `content-length`.
- **On the timing channel, the honest answer is that it is small here and it was closed anyway.**
  There is **no bcrypt on this path**. Unlike login, nothing on forgot-password derives a key, so
  the asymmetry is not "fast miss versus slow hash" - it is one indexed lookup that misses versus
  a lookup that hits plus a `randomBytes`, a SHA-256 and one `save`. That is microseconds of CPU
  and a millisecond of round trip, inside network noise. It is closed regardless by sending the
  response before the divergent work starts, so the difference is outside anything a client can
  measure, and the route's latency stops depending on the mail queue as a side benefit. The
  test measures five samples each way and compares medians rather than means, so one scheduling
  hiccup cannot decide it.
- **The consequence for tests is stated rather than hidden.** Because the write happens after
  the response, a test cannot assume the token exists the moment the request returns. The reset
  tests poll the mail queue for it instead of guessing a number of ticks.

### The deletedAt audit, and why almost nothing needed changing

Already filtered before this phase: `requireAuth`, `login`, `getMe`, `updateMe`,
`changePassword`, and both queries in the reminder job.

**The applications, analytics, calendar and reminder services need no `deletedAt` filter, and
none was added.** Not an oversight - a structural argument. Every one of them is scoped
`user: userId`, and the only route to them is `requireAuth`, which already refuses a user with
`deletedAt` set. Another account's query cannot surface a deleted user's rows because it is
scoped to its own id. Adding filters there would be defensive noise that implies a threat the
architecture has already closed. `auth.softDelete.test.ts` proves the property from the outside
instead: a closed account's applications stay out of a second account's list and its analytics.

**One site was left deliberately unfiltered.** `auth.service.ts`'s registration uniqueness check
still matches soft deleted users, so a closed account's address stays reserved for its 30 day
window and is released by the purge. Filtering it would let a stranger register an address whose
data is still recoverable, and would collide with the unique index on the retained document.
Your call, recorded here with the reason, and covered by a test.

### Assumptions and judgement calls

- **A mail seam, not a mail system.** Phase 11 has to send four messages and Phase 12 owns the
  transport, templates and retry queue. `mailer.service.ts` is the shape Phase 12 fills in: a
  bounded queue plus a console transport. Two rules it already keeps because they are security
  properties rather than delivery details - a send never throws into the request that triggered
  it, and the body is printed only outside production, since these bodies carry tokens and
  section 14 forbids logging tokens or full email bodies. Section 13's "print the full email in
  development" and section 14's prohibition are reconciled by environment rather than ignored.
- **SPEC section 5 and section 4 disagree about `DELETE /auth/me`.** Section 5 says it
  "cascade-deletes all user data and uploaded files"; section 4 and section 16 say soft delete
  with a purge after 30 days. Resolved as soft delete now, cascade at purge, which satisfies both
  in sequence and is the only reading in which a 30 day window means anything.
- **`verify-email` distinguishes an unknown token from an expired one.** `INVALID_TOKEN` and
  `TOKEN_EXPIRED` are different codes, deliberately, so the UI can offer "send me a new link"
  rather than a dead end. It leaks nothing: holding the token is already proof of access to the
  mailbox, so there is no third party to protect the distinction from.
- **The verification gate is a router level middleware on writes only.** Applied to the
  applications and reminders routers, which own every write; analytics and calendar are read
  only and take no gate. Safe methods pass unconditionally, so an unverified user past the grace
  period can always still read their own data, and login is never gated at all.
- **Three new `RevokedReason` values** - `password_reset`, `session_revoked`, `account_deleted`.
  Overloading `logout_all` would have worked and destroyed the audit trail that makes the
  sessions list worth showing.
- **Sessions expose the existing mechanism rather than a second one.** "Active" in
  `GET /auth/sessions` means exactly what it means to `rotateSession`: unrevoked and unexpired.
  Revocation is scoped by `user` as well as `_id`, so another account's session id is reported
  as not found rather than forbidden, matching the applications rule.
- **Lockout and rate limiting are kept separate and report differently.** The limiter is per IP
  and per email at five attempts in fifteen minutes and trips first; the account lock is ten
  consecutive _credential_ failures and answers `423 ACCOUNT_LOCKED` with a `lockedUntil`, where
  the limiter answers `429 RATE_LIMITED_*`. A throttled request never reaches the credential
  check, so the limiter cannot lock an account by proxy - proven by a test. Attempts below the
  threshold return an ordinary `INVALID_CREDENTIALS`, so the response never counts down for an
  attacker.

### A Phase 2 test was rewritten, deliberately

`auth.session.test.ts` asserted that `PATCH /auth/me` _rejects_ an email change. That was a
Phase 2 placeholder for a flow that did not exist yet, recorded as such in PROGRESS at the time.
Phase 11 is chartered to build it, so the case was rewritten rather than deleted: it now asserts
the address is accepted, parked on `pendingEmail`, and does not take effect until confirmed.
Saying so here because CLAUDE.md forbids weakening a test to make a build pass, and the
difference between that and correcting a superseded one is worth being explicit about.

## Phase 11 - account lifecycle (client)

The half deferred when the phase was split. Closes Phase 11.

### The three questions answered against shipped code rather than assumed

- **Grace window detection uses `emailVerified` and `createdAt`, both of which the API really
  returns.** `User.toJSON` strips only `PRIVATE_FIELDS`, which does not include either, and the
  client's `User` type already declared them. `pendingEmail` is returned too and was simply
  missing from the client type, so it was added rather than invented. The seven day constant is
  duplicated in `verificationWindow.ts` and marked advisory in a comment: the server's 403 is the
  real gate, and if the two ever disagree the API wins.
- **A soft deleted user gets `401 INVALID_CREDENTIALS` on login, identical to a wrong password.**
  `login` queries `deletedAt: null`, so the account never matches and falls into the no-user
  branch. `forgot-password` filters the same way. There is no un-delete endpoint anywhere in the
  API. So `AccountClosedPage` says the address will no longer sign them in and names support
  inside the 30 days as the only route back - it does not imply a recovery the server cannot do.
  A test asserts that page never says "sign back in to restore".
- **The file list held**, with one addition found while building: `AccountClosedPage`, because
  redirecting a just-deleted user to `/login` would have shown them a form that cannot work.

### Assumptions and judgement calls

- **Forgot-password renders its confirmation even when the request fails.** No branch on the
  response at all, and the `catch` is deliberately empty. A chatty version would undo the
  backend's whole guarantee: if a network error rendered differently, an attacker learns nothing
  from the happy path and everything from the failure path. The cost is that a genuine outage is
  silent on this one form, which is the trade being made knowingly. The test asserts the success
  and failure renders are identical with the address factored out.
- **Email change got its own Settings section rather than joining the profile form.** The profile
  form saves several fields at once; folding an address change into it would fire a verification
  email as a side effect of editing a graduation year. The section shows the current address and
  the pending one together, so the display never swaps to an address that is not live yet.
- **The banner escalates in three steps** - informative, a countdown in the last three days, then
  a plain statement that editing has stopped - and switches from `role="status"` to `role="alert"`
  at expiry, so a screen reader is interrupted only once it is actually actionable.
- **`INVALID_TOKEN` is reported to the user as "already used".** The server clears a token off the
  document the moment it is spent, so a spent token and a fictional one are the same lookup and
  cannot be told apart. "Already used" is the true statement in the overwhelmingly common case and
  points somewhere useful; "invalid" would leave someone re-clicking a dead link.
- **The verify-email effect guards against a second run with a ref.** Strict mode runs effects
  twice in development and this one spends a single-use token: without the guard the second run
  would report the first as already used, on a link that had just worked.
- **Two ordering bugs were found by the tests and fixed in the code, not the assertions.** The
  delete flow cleared the auth store before navigating, so `ProtectedRoute` saw `anonymous` while
  the location was still `/settings` and redirected to `/login`, beating the redirect to the
  closed-account page. `AccountClosedPage` now clears the store on mount instead, which cannot
  race the navigation it is the destination of. Separately, the typed-confirmation field's label
  and its validation message were word for word identical, which is ambiguous for a screen reader
  as much as for a query; the message now reads differently from the label.
- **`current` is never inferred client-side.** The server decides it by hashing the refresh cookie
  the request arrived with, so revoking "this device" acts on the server's answer rather than a
  guess. When that row is revoked the store is cleared and the user is sent to `/login`, because
  the access token in memory can no longer be refreshed.
- **Device labels are matched crudely on purpose.** A UA parsing dependency for a decoration
  nobody makes a decision on is not worth the bundle; the IP and last-used time are what identify
  a device to its owner, and "this device" is authoritative.

## Phase 12 - email system

- **Phase 11's mailer was a seam, not a system, and was rewritten rather than extended.** It had
  no transport at all - `nodemailer` was not a dependency until this phase - no HTML, no layout,
  no retry, no attempt count, and no preference check. What it did have, and what was kept, are
  the two properties that were already security-shaped: a send never throws into the request, and
  bodies are printed only outside production. `queuedMail`, `clearMailQueue` and `MailKind` kept
  their names and their fields specifically so the six Phase 11 test files still compile and still
  assert what they always asserted.
- **`changePassword` was sending nothing.** SPEC lists "password changed" as a template, and
  Phase 11 sent it only after a _reset_. The deliberate change from Settings - the one an attacker
  holding a live session would make - was silent. That is now sent too, with `via: 'settings'`
  wording that differs from the reset wording, because the two are different events to the reader.
- **Account closure is treated as security-critical.** SPEC section 13's parenthetical names
  "verification, reset, password changed"; the template list a line above it includes account
  deletion among the transactional four. Suppressing the only notice that an account was destroyed
  because a _reminder_ preference was off would hide precisely the event a person whose account was
  taken over most needs to see. It always sends.
- **One block model renders both bodies.** Templates emit `MailBlock[]`; the layout projects that
  list to HTML and to text. The plain-text alternative therefore cannot drift from the HTML,
  because it is not written separately - a test asserts every link and every digest line appears
  in both. Only the registry calls `renderHtml`, so no template can grow its own masthead.
- **The logo is type, not an image.** There is no hosted logo asset, and mail clients block remote
  images by default; a broken image in the masthead is worse than none. `APP_LOGO_MARK` draws a
  two-letter badge with a background colour instead. `APP_PRODUCT_NAME` was added beside the
  existing `APP_NAME`, which is the service identifier used in logs and OpenAPI, not a product name.
- **`MAIL_TRANSPORT` is optional rather than defaulted.** Unset means "decide from whether
  `SMTP_HOST` is present", which is what makes zero email configuration a working state instead of
  a boot failure. The one combination that fails validation is `MAIL_TRANSPORT=smtp` with no host,
  because that is someone believing mail is being delivered when none of it can be.
- **The console transport still builds the real message.** It is nodemailer's `jsonTransport`, not
  a `console.log`, so the MIME build - both alternatives, the headers, the encoding - runs on the
  no-SMTP path exactly as it does on the SMTP one. A message that would fail to build fails in
  development rather than only once there is a production relay to discover it on.
- **The retry backoff is an injected seam, and the tests assert the delays rather than measure
  them.** `MailQueue` takes `delay`, so `mail.queue.test.ts` asserts it _asked_ to wait 1000ms then
  2000ms. Given this project's history with timing-sensitive tests, there is deliberately no wall
  clock to run slow and no timer to fire late under load.
- **A reminder batch is claimed before it is mailed, and the weekly summary is stamped before it is
  sent.** Both are at-most-once on purpose: the queue already gives a transient failure three
  attempts, and a duplicated deadline reminder is worse than a missed one. `lastWeeklySummaryAt`
  exists so a redeploy inside the send hour cannot mail everyone in that zone twice; six days
  rather than seven, so the gap survives a daylight saving shift without skipping a week.
- **The weekly summary is a second task on Phase 4's cron, not a second scheduler.** Same
  `'0 * * * *'` UTC expression, same `startScheduledJobs`, and it imports `isDigestHourIn` from
  `reminderJob` rather than copying it - that function is the one place daylight saving is handled,
  and a second copy is a second chance to get it wrong. It is a separate task because the two
  select on different things: the sweep on `Reminder` documents and `emailRemindersEnabled`, the
  summary on the calendar and `weeklySummaryEnabled`.
- **The summary reports the week that ended, by shifting `now` back one millisecond.** Passing
  `startOfLocalWeek(now) - 1ms` to Phase 8's `getSummary` puts the 7-day period, the weekly goal
  window and the streak all inside the reported week at once, with no per-figure special case. The
  numbers come from the same pipeline the dashboard reads; a summary that disagreed with the
  dashboard would be worse than no summary.
- **Templates never see an instant.** Every `dueAt` is rendered to a label in the recipient's zone
  by the job that builds the payload, so there is no second place for a UTC assumption to reappear.
  The test proves it with one shared instant read as `1 Jan, 08:00` in Kuala Lumpur and
  `31 Dec, 16:00` in Los Angeles - a different hour and a different day.
- **The unsubscribe link is a real endpoint, which is slightly more than SPEC asked for.** SPEC
  section 13 says "unsubscribe/preferences link". A link to `/settings` sits behind a sign-in wall,
  and the person most wanting out is the one least willing to log in, so that would be a
  preferences link wearing an unsubscribe label. `GET|POST /api/v1/email/unsubscribe` takes an
  HMAC-signed token instead. It is the only unauthenticated write in the API, and it is safe to be:
  the token is the credential, and the single field it reaches can only be set to false.
- **The unsubscribe token never expires and is keyed separately from the JWTs.** An unsubscribe
  link has to work for as long as the message carrying it exists, and there is nothing to protect
  by ageing it out. Its key is derived from `JWT_ACCESS_SECRET` through a fixed label rather than
  being that secret, so an unsubscribe token can never be confused with one that grants access.
- **The confirmation page is served by the API, not the client.** The whole point is that it works
  with no session; redirecting to a protected route would bounce the reader into a sign-in form
  immediately after they asked to stop hearing from us. It is a small self-contained page, so
  Phase 13 needs no new client route for it.
- **A well-formed token for an account that is gone answers 200, same as a real one.** Reporting
  404 would turn the unsubscribe link into an account-existence oracle. The log records the truth
  via `matchedCount`.
- **`weeklySummaryEnabled` defaults to false.** SPEC calls the weekly summary opt-in, and a default
  of true would opt in every account that already exists. The two optional streams are independent
  preferences, so turning off reminders does not silently also cancel the summary - proved both
  ways in `mail.preferences.test.ts`.
- **The server mirrors three client route paths rather than importing them.** The workspaces share
  no code and the server build has its own `rootDir`. `MAIL_LINK_PATHS` holds the three paths email
  links at, and a test reads `client/src/routes/paths.ts` as text to assert the mirror still
  matches - the same technique `app-info.test.ts` already uses against `package.json`. A client
  route rename cannot quietly turn every button in every email into a 404.

## Phase 13 - public surface

- **`react-helmet-async` was not in the stack, contrary to the brief.** Phase 5 landed the
  router, React Query and axios; there was no Helmet dependency and no provider in `main.tsx`.
  It was installed here, together with `sharp` as a client devDependency for generating the
  brand assets.
- **The dashboard moved from `/` to `/dashboard`.** Two pages cannot both own one path, and
  SPEC section 12's "logged-in users hitting `/` go straight to the dashboard" only means
  something once they are different locations. The redirect lives in exactly one component,
  `MarketingRoute`.
- **`MarketingRoute` is a separate guard from `PublicOnlyRoute`, and the difference is the
  `pending` branch.** `PublicOnlyRoute` renders a skeleton while the silent refresh is in
  flight, which is right for `/login`. On a marketing page it would be the largest paint a
  crawler and a first-time visitor both see, so `MarketingRoute` renders the page immediately
  and redirects only once the session is actually known to be authenticated.
- **`POST /auth/demo` takes no request body.** Three properties make it safe to expose
  unauthenticated, and all three are structural rather than checks that could be forgotten: it
  has no parameter to aim at another account; it only ever _finds_ a user, never creates one,
  so it cannot mint accounts or bypass registration; and `isDemo: true` is part of the query,
  so somebody who registered the demo address before seeding cannot be logged into through it.
  An unseeded deployment answers 404 rather than helpfully creating an account.
- **The sandbox guard is server-side and keyed on `isDemo`, not on the endpoint.** The demo
  credentials are published and the demo route hands a session to anyone, so a hidden button
  would protect nothing. `rejectDemoAccount` refuses `DELETE /auth/me`, `PATCH /auth/me/password`
  and an email change on `PATCH /auth/me`. The profile patch is _not_ blocked wholesale: theme
  and timezone are what the demo exists to show, and they destroy nothing.
- **The nightly reset is `npm run seed:reset`, not a new code path.** `runDemoReset` calls
  `seedDemoAccount({ reset: true })`, which calls Phase 8's `buildDemoApplications`. It is
  registered by the same `startScheduledJobs` as the reminder, weekly-summary and purge crons,
  at 04:20 UTC — off the purge's 03:15 and off the hour boundary the digests tick on. A
  deployment with no demo account skips quietly rather than erroring nightly about an optional
  fixture.
- **Only the routes isolation requires are lazy.** An intermediate version made all fifteen
  routes lazy: it met the budget at 111 KB but destabilised 25 previously-green tests, because
  mounting `<App />` then resolved a chunk mid-test. The final set is eight — Landing, Terms,
  Privacy, Dashboard, Board, Applications, Calendar, ApplicationDetail — which lands at 139.8 KB
  and leaves the suite stable across repeated runs. A budget met by a flaky suite is not met.
- **`manualChunks` was never the isolation mechanism, and believing it was would have been the
  bug.** It puts Chart.js and dnd-kit in their own _chunks_, but `App.tsx` statically imported
  `BoardPage`, `CalendarPage` and `ApplicationDetailPage`, so the browser fetched those chunks on
  every route including `/`. The dynamic import is what severs them; `scripts/checkBundle.mjs`
  walks the built manifest's transitive static-import closure and fails the build if any of them
  reappears, and greps the emitted JavaScript for library fingerprints as a second check.
  Size alone would prove nothing: a chunk can be under budget and still drag Chart.js behind it.
- **robots.txt blocks only the two token-bearing routes.** Disallowing `/dashboard` and friends
  failed Lighthouse's `is-crawlable` audit (dashboard SEO 63) while protecting nothing: those
  routes need a session, so a crawler gets an empty shell, and Google is explicit that robots.txt
  is the wrong tool for keeping a page out of an index. `/verify-email` and `/reset-password`
  stay blocked because their query strings carry single-use tokens.
- **Authenticated route titles live in one table in `AppLayout`, not a `<Seo>` per page.** Every
  one of those routes renders into that shell, so a longest-prefix table gives each its own
  title and description without five near-identical edits.
- **The landing screenshot is a real capture, not a mock-up.** `scripts/captureScreenshot.mjs`
  drives a production build through "Try the demo" and photographs the actual dashboard. The
  landing copy claims it is "the same view the demo account opens on", and a drawn
  approximation would make that false the moment the UI changed.
- **Client async timeouts were separated: `asyncUtilTimeout` 10 s under a 20 s `testTimeout`.**
  Equal values meant a slow lazy chunk consumed the whole test budget and reported "test timed
  out" instead of the assertion that actually failed.
- **The legal pages are checked for substance, not for rendering.** `legal.test.tsx` asserts the
  privacy policy names bcrypt, the IP address, the user agent, the timezone, the terms stamp, the
  30-day purge, the export route and the delete route — the things this app really stores. A test
  that only checked the page rendered would pass on lorem ipsum.
- **The `{{CONTACT_EMAIL}}` placeholder is fed from one constant.** `CONTACT_EMAIL` in
  `siteMeta.ts` supplies the footer mailto and is substituted into both markdown documents at
  render time, so filling it in is a one-line change rather than a hunt through prose.

## Phase 14 — Hardening

- **The honeypot and timing fields are optional, not required.** Requiring `elapsedMs` would buy
  nothing: anything sophisticated enough to strip a field it does not recognise is also
  sophisticated enough to send `elapsedMs: 9999`, while a required field breaks every non-browser
  client and every existing test's registration path. What these two actually catch is the naive
  form-replay bot, which resends whatever the form contained — honeypot included — and posts
  immediately. The real gates on an open signup are the per-IP and per-email rate limiters already
  on `/auth/register`, and email verification.
- **The timing threshold is 2500 ms.** A person has to read the label, type a name, an address, a
  password satisfying three character-class rules, and tick the terms box. Even with a password
  manager filling every field that is several seconds. 2.5 s sits below the plausible human floor,
  so nobody real is turned away, and far above the milliseconds a script spends between GET and
  POST.
- **A rejected signup gets one message that does not name the check that tripped**, and stays
  recoverable: "That sign-up looked automated. Wait a moment and try again." Naming the failing
  check would tell a bot exactly what to change; a permanent rejection would punish the rare human
  who trips it.
- **The disposable-domain list is 207 hand-picked domains, not a mirror of a 100k-entry list.** The
  long lists are mostly dead domains plus a steady trickle of false positives against small real
  providers, and it is the false positives that cost a real user their account. Adding a domain is
  a one-line change to `server/data/disposable-email-domains.txt`.
- **The blocklist loads synchronously and fails open, and there is a test for each half.** A
  missing or unreadable file yields an empty set, so every address is allowed — including a
  disposable one, which `signupGuard.test.ts` asserts explicitly. Allowing a throwaway signup is a
  nuisance; refusing every signup because a text file is missing is an outage. Synchronous because
  the set must exist before the first registration is answered, and one small read on first use is
  cheaper than the coordination an async cache would need.
- **Caps return 403, not 429.** The account is not going too fast, it is full, and waiting will not
  help. 429 is used for the stricter per-account limiters SPEC section 12 also asks for on the
  upload and export routes — 30 uploads per 15 minutes and 5 exports per hour, keyed by account so
  one user on a shared network cannot spend everyone else's budget.
- **The caps are constants in `config/limits.ts`, not environment variables.** They are a product
  decision about what one free account may consume, not a per-deployment knob. A deployment that
  wants different numbers is forking the policy and should do it where the reasoning lives.
- **A CSV import is checked against the ceiling as a whole, before any row is written.** Filling
  the last few slots and then reporting hundreds of identical "limit reached" row errors is a worse
  answer than one refusal.
- **Uploads are charged at their stored size, not their posted size.** `assertAttachmentCapacity`
  runs after `stripImageMetadata` and before the `put`, so the account is billed for the bytes that
  actually reach the bucket and a refused upload never leaves an orphan behind.
- **The export omits attachment bytes and every credential.** Base64-inlining up to 100 MB of
  uploads would turn "what do you know about me" into a memory spike that can take the process
  down, so the records are exported and the files stay behind their signed URLs. Password hashes,
  refresh-token hashes and single-use email-token hashes are excluded because they are credentials
  rather than the user's data — `dataExport.test.ts` asserts they are absent from the bytes, not
  merely from the expected keys.
- **The export is written against the model list rather than the screens**, and its test seeds a
  row in every model then asserts the count of each collection is non-zero, so an omission fails
  here instead of shipping as a gap.
- **The migration ledger is one row per migration, not a version counter.** A counter cannot say
  when a migration ran or how long it took, and it hides a gap if migrations are applied out of
  order by hand. `version` is unique, which is what makes two instances racing during a rolling
  restart safe: the second insert fails rather than the migration running twice.
- **`npm run migrate` is a separate command, not something the server runs at boot.** A migration
  that has to finish before the new code is correct must not compete with that code for the same
  documents.
- **`redactSecrets` was fixed to keep an `Error` readable.** It walked Errors with the generic
  object branch, which yields `{}` because `name`, `message` and `stack` are non-enumerable — so
  `purgeDeletedUsersJob`'s `logger.error('Purge job failed', { error })` had been recording every
  failure it ever had as `error: {}`. Found by auditing every call site rather than by a failure,
  which is exactly what the "confirm it still holds" instruction was for.
- **`seed.ts` no longer prints `DEMO_PASSWORD`.** It is a published fixture rather than a secret,
  but it is still a password, and interpolating one into a log _message_ puts it somewhere the
  logger's key-based redaction cannot reach. The line now names the address and points at the env
  var.
- **The client Sentry SDK is behind a dynamic import.** `scripts/checkBundle.mjs` enforces the
  landing budget by walking the static import closure, so a statically imported `@sentry/react`
  would be roughly 30 KB gzipped on the critical path of the page most visitors bounce off. Behind
  a dynamic import it is its own chunk, and with no DSN it is never requested at all. Client init
  failure is swallowed: a blocked CDN or an ad blocker must not stop the app rendering.
- **Sentry reports only 5xx on the server.** 4xx are answers, not faults; reporting them would bury
  real failures under every mistyped password and every 404. `tracesSampleRate` defaults to 0
  because traces are billed per event and this is a free-tier deployment.
- **Sentry's automatic HTTP instrumentation is not wired.** It wants to load before the modules it
  patches, which a static import graph cannot guarantee; that affects tracing only, which is off,
  and the preload flag belongs with the rest of the production configuration in Phase 16. Error
  capture, which is what this integration is for, does not depend on it.
- **`DataSection.tsx` was rewritten and its test with it, deliberately.** The section had rendered
  two disabled buttons captioned "not available yet" since Phase 9; that had already stopped being
  true for deletion when Phase 11 shipped `DangerZoneSection`, and it was the only place in the UI
  still claiming a shipped feature did not exist. Deletion now lives only in the danger zone — one
  affordance for one action — and this section owns the export. The test that pinned the
  placeholder was rewritten rather than deleted: it was asserting a placeholder, not the product,
  and the replacement includes a case that fails if "not available yet" copy ever returns.
- **Usage went into a new Settings section, "Storage and limits", rather than into "Your data".**
  The limits are the reason a write can be refused, so a user needs to find them before the
  refusal, not after a 403 on the form they just filled in.
- **`scripts/backup.sh` is a shell script rather than an npm script.** A backup has to be runnable
  from cron on a host that has never installed this project's dependencies; `mongodump` is the only
  thing it needs. It prunes only after a successful dump, so a failed run never destroys the last
  good copy, and it deletes an empty archive rather than reporting success.
- **`npm run stats` (SPEC section 14) was not built.** Section 16's Phase 14 definition does not
  list it and neither does the definition of done; it is noted here so it is not silently lost.

## Phase 15 — E2E, performance, repo hygiene

- **The Phase 9 horizontal-scroll bug: an absolutely positioned `sr-only` label escaping its
  scroll container.** Real, now fixed, and worth recording in full because the first two attempts
  at diagnosing it both went wrong.

  **The mechanism.** An absolutely positioned box is clipped by an ancestor's `overflow` only if
  that ancestor is in its _containing block chain_, and a `position: static` ancestor never is.
  Tailwind's `sr-only` is `position: absolute`. The applications table's last header cell contains
  `<span class="sr-only">Actions</span>`, and the wrapper around the table — `overflow-x-auto`, but
  `position: static` — was therefore **not** that span's containing block. Its containing block was
  the initial one, so the wrapper neither clipped nor contained it: the 1px box sat wherever the
  table's last column fell, and when the table was wider than the wrapper that was past the
  viewport. It extended the **document's** scrollable overflow, and the whole page scrolled
  sideways.

  **Why the original symptoms looked contradictory.** Every one of Phase 9's observations follows
  from that and only from that:

  - _"`body.scrollWidth` equals the viewport" while the document scrolls._ An absolutely positioned
    box whose containing block is the initial one is out of body's flow, so it contributes to
    `documentElement`'s scrollable overflow and not to body's. Measured directly: `body` 768,
    `html` 781, document scrolls 13px. The reading that looked like the anomaly was correct; it was
    the box scan that was wrong.
  - _"`overflow-x-clip` on `main` did not resolve it."_ Of course not — `main` is `position: static`
    too, so it is equally absent from the span's containing block chain. Confirmed by measurement:
    `overflow-x: clip` on `main`, on `body`, and on `html` all leave the overflow at 781.
  - _Board at every width, applications only at 768._ The condition is "the content is wider than
    its scroll container", which for the board's strip is true at every width, and for the table is
    true at 768 but not at 375 (stacked cards) or 1440 (it fits).

  **The fix.** `position: relative` on the scroll container. That makes it the containing block for
  its absolutely positioned descendants, so its `overflow-x: auto` finally contains what it appears
  to contain, and the table still scrolls inside itself exactly as before — verified: wrapper
  `clientWidth` 718 against `scrollWidth` 800, document back to 768 and immovable. Applied to all
  four horizontal scroll containers, not just the one that was caught: `DeadlineChip` renders an
  `sr-only` span too, so the board strip had the same latent defect and would have shown it as soon
  as a card with a deadline sat in a right-hand column.

  `contain: paint` and `contain: layout` also fix it, for the same reason, and were rejected as
  heavier: both bring paint or layout containment and a stacking context along with the containing
  block, which is more behaviour than this needs.

  **How it was actually found, after two failures.** Phase 9 guessed from the markup and reverted a
  plausible CSS property that did nothing. This phase's first attempt was no better: with the box
  scan filtered down to something sensible, the bug stopped reproducing locally and it was written
  up as "a measurement error, no bug exists" — a conclusion that was wrong, and that only survived
  because the local table happened to fit at 768 while CI's fonts made it overflow. CI caught it on
  the first run. What settled it was refusing to reason from the markup a third time and asking the
  browser instead: bisect by hiding one element at a time and re-measuring `documentElement`, then
  print the computed overflow and containing block of every ancestor. That named the `sr-only` span
  in one pass. `e2e/support/overflow.ts` keeps both instruments.

  **The regression test does not depend on luck.** `e2e/audits/overflow.spec.ts` now seeds
  deliberately long company and role names spread across five statuses, so the table exceeds its
  wrapper at 768 and the board's right-hand columns are populated, by construction rather than by
  the font the runner happens to have. Verified both ways: it reports `scrolled 29px` against the
  unfixed component and passes against the fixed one.

- **Full route lazy loading was safe all along; Phase 13's diagnosis was wrong.** Phase 13 recorded
  that making all routes lazy "destabilised 25 previously-green tests, because mounting `<App />`
  then resolved a chunk mid-test", and retreated to nine lazy routes. Re-running the experiment
  showed that reasoning does not hold. With `asyncUtilTimeout` at RTL's 1 s default, **the same 13
  tests fail whether nine routes are lazy or all sixteen — byte-identical failure lists** — and two
  of them (`LoginForm`, `RegisterForm`) drive routes that are _eager_ in the nine-route baseline.
  Lazy breadth is not the variable. The variable is the async budget under Vite's on-demand
  transform, and the `asyncUtilTimeout` raise Phase 13 made in the same change was the entire fix.
  The retreat was unnecessary and cost 28 KB on the landing route: all sixteen routes are lazy now
  and landing fell from 139.8 KB to 111.4 KB gzipped. Two changes were made at once and the wrong
  one was credited.

- **`Content-Disposition` is exposed through CORS, and this was a live production defect.** A
  cross-origin response only hands JavaScript the CORS-safelisted headers unless the server names
  the rest in `Access-Control-Expose-Headers`. `Content-Disposition` is not safelisted, so
  `response.headers['content-disposition']` was `undefined` in the browser and both downloads — the
  applications CSV and the account JSON export — fell back to a generic filename instead of the
  dated one the server had chosen. SPEC section 15 deploys the client and the API to separate
  hosts, so every deployed build had this; local development is same-origin and cannot show it.
  Found by the first end-to-end run against a real cross-origin stack, which is precisely the class
  of bug SPEC section 10 says end-to-end tests exist for.

- **The chart canvases are `aria-hidden`, not `aria-label`led.** react-chartjs-2 puts `role="img"`
  on the canvas, and a `role="img"` with no accessible name is a serious axe violation — five of
  them on the dashboard. Naming each canvas would have cleared the rule while making the page
  worse: the charts already ship an `sr-only` data table with a caption, so a label would announce
  every chart twice, once as an unreadable image and once as the table. Hiding the canvas leaves
  the table as the single text alternative. Zero violations at _any_ impact level now, on all five
  audited surfaces.

- **The CSV export got a UI, because it never had one.** `GET /applications/export?format=csv|json`
  shipped in Phase 4 and nothing in the client ever called it, so SPEC section 17's manual pass
  ("… view charts → export CSV → logout") and section 10's sixth flow could not be walked by a user
  at all. The toolbar control was added rather than the flow being written against the API, since
  a flow that bypasses the UI would have proved nothing about the gap. `client/src/lib/download.ts`
  holds the blob-saving and `Content-Disposition` parsing that the account export already did, so
  there is one copy rather than two.

- **The end-to-end stack is a separate compose project, not the development one.** Same base file,
  overridden onto ports 5174 / 5001 / 27018 with renamed containers and its own volume, so the
  suite can run while a development stack is up and neither disturbs the other's data. The
  `!override` tags on `ports` are load-bearing: Compose _appends_ port lists when merging, so
  without them the E2E mongo would also try to claim 27017 and collide with the very stack the
  shift exists to avoid.

- **Mail tokens are read from the API's console transport, not from a test-only endpoint.** SPEC
  section 10 asks for the token to come "from the console/mail transport in test mode", and the
  alternative — a route that hands out verification tokens — would be a real security hole kept
  alive by a test. `MAIL_TRANSPORT=console` prints the rendered body, and `e2e/support/mailLog.ts`
  scans `docker compose logs api` in reverse, matching on the recipient as well as the path so a
  run that registers several accounts cannot attribute one account's link to another.

- **Each end-to-end test presents its own synthetic client address.** Every limiter the API mounts
  keys on `req.ip` — credentials at 5 per 15 minutes, the blanket one at 200 — and all the suite's
  traffic leaves one machine, so on a single address the sixth sign-in of a run is a 429 and a
  route-sweeping audit exhausts the global budget alone. Worse, the window is fifteen minutes and
  the counters are in-process, so the _second_ consecutive run would start already spent, and three
  clean consecutive runs is this phase's bar. The E2E API therefore runs `TRUST_PROXY=1` and each
  test sends `X-Forwarded-For: 10.<run>.<file>.<test>`, with the run octet randomised per
  invocation. The limiters stay fully enforced, per synthetic client rather than collapsed onto
  one, and the limiting behaviour itself is covered by the server suite rather than here. No
  production code was changed to accommodate the tests.

- **Flow 8 invalidates the token on the wire rather than deleting it.** SPEC section 10 says
  "delete the access token", but the token is a memory-only zustand slice with no `persist` —
  SPEC section 7 requires that — so there is no storage entry to delete and no handle to reach it
  without shipping a test seam in production code. Rewriting one request's `Authorization` header
  produces exactly the condition the flow is about: the server genuinely returns 401, the axios
  interceptor genuinely refreshes, and the replay genuinely succeeds. Only the first request is
  broken, so the replay carries the real token.

- **`retries: 0`, deliberately.** A retry would hide precisely the intermittency this suite exists
  to catch. The stability bar was three clean consecutive runs of all 13 tests, which is what was
  recorded, rather than a green run obtained on a second attempt.

- **Flow 1 waits out the sign-up timing check instead of bypassing it.** Phase 14 rejects a
  registration completed in under `MIN_SIGNUP_FILL_MS` (2.5 s) as automated, and Playwright fills a
  form far faster than that, so the first run failed on "That sign-up looked automated". The test
  waits, because a human would: the guard is behaving correctly and this is the flow representing a
  human. Its firing on the first run is the only end-to-end proof that guard works.

- **Flow 4 uses `click()` and a retrying assertion, not `check()`.** The filter checkboxes are
  controlled inputs whose state round-trips through the URL: the change handler navigates, and the
  box only re-renders as checked once React commits the new query string. `check()` clicks and then
  reads `input.checked` synchronously, landing inside the window where React has reset the DOM
  property to match a render that has not happened yet, and reports "Clicking the checkbox did not
  change its state" — while the URL, the checked state and the filtered rows all settle correctly a
  moment later. Verified directly in a browser before changing the test, rather than assumed:
  `click()` and `check()` leave identical end states, and only `check()`'s inline assertion fails.

- **The client suite is capped at `maxWorkers: '50%'`.** Four tests failed during a `verify` run
  that shared the machine with the E2E containers, and the cause was measured rather than guessed:
  with every route lazy, the first test in a file absorbs its chunk's first transform at 3.4-4.4 s
  while every later test in the same file runs in about 0.7 s, and an uncapped worker pool
  oversubscribes the machine until that first figure crosses the 10 s async budget. Capping halves
  the CPU work at no wall-time cost — collection 105 s to 48 s, wall clock 44.5 s to 44.9 s on a
  12-core box — and the contended run then passes. The async budget itself was left alone: padding
  it would have hidden the oversubscription rather than removed it, and a two-core CI runner is the
  case that needs the cap most.

- **Bundle sizes are reported for every route, gated on two.** SPEC section 12 sets a number only
  for landing and dashboard, so only those fail the build; the other fourteen are printed because a
  route that doubles is worth seeing even when nothing fails. Landing 111.4 KB against 150,
  dashboard 215.4 KB against 300, and the heaviest unbudgeted route is the application detail page
  at 177.4 KB.

- **The secret scan is gitleaks over the whole history, with a checked-in allowlist.** "We were
  careful" is not a verification, and a scan of the working tree would miss a secret that was
  committed and later deleted. The first run reported nine findings, every one a synthetic literal
  in a test file — the deliberately wrong passwords the lockout and rate-limit suites send, and a
  forged unsubscribe token asserted to be rejected. They are recorded in `.gitleaks.toml` as named
  exceptions rather than suppressed wholesale, so a real secret in those same files would still be
  caught. Result across all 22 commits: `no leaks found`.

- **`{{CONTACT_EMAIL}}` reuses Phase 13's mechanism rather than adding a second one.** SECURITY.md
  and CODE_OF_CONDUCT.md carry the same literal placeholder the two legal markdown documents do,
  fed from `CONTACT_EMAIL` in `client/src/lib/siteMeta.ts`, so filling it in stays the one-line
  change Phase 13 designed it to be.

## Phase 16 - Ship

- **The refresh cookie was `SameSite=Strict`, which cannot work in the deployment SPEC section 15
  describes, and that is a production bug rather than a documentation gap.** A browser omits a
  `Strict` cookie from every request a page on another _site_ initiates, and the split-host deploy
  puts the client on Vercel and the API on Render. `POST /auth/refresh` from one to the other would
  therefore have carried no cookie at all: the silent refresh 401s, the axios interceptor reads that
  as a dead session, and the user is bounced to login on every reload and every access-token expiry.
  Login would have appeared to work and then dropped the user thirty seconds later.

  **Nothing in the project could have caught it.** SPEC section 7 asks for `sameSite=strict` and
  section 15 asks for `sameSite: 'none'`; the two are describing different topologies and only the
  second one ships. Every test passes under `Strict` because the whole suite is same-host, and — the
  part worth recording — **the Phase 15 end-to-end stack cannot catch it either**, despite existing
  precisely to test a cross-origin boundary. Its web container is `localhost:5174` and its API is
  `localhost:5001`: different _origins_, which is what surfaced the missing
  `Access-Control-Expose-Headers`, but the same _site_, because a port is not part of a site. Origin
  and site are different scopes, and the cookie is governed by the one CI does not vary.

  The fix derives the value from configuration rather than adding a switch to set wrong:
  `refreshCookieSitePolicy` in `server/src/utils/cookies.ts` compares the `CLIENT_ORIGIN` hostname
  with the `API_URL` hostname and relaxes to `SameSite=None; Secure` when they differ. The rule is
  deliberately conservative in one direction only: subdomain siblings get `None` where `Strict` would
  technically have worked, but it never picks a value that silently drops the cookie. It also refuses
  to relax over plain HTTP, where `Secure` would drop the cookie instead — a cross-site cookie is
  impossible there under any setting, so the existing behaviour stands and fails visibly.
  `server/tests/cookies.crossSite.test.ts` fails on two cases against the old policy and passes
  against the new one.

  The cost is recorded rather than hidden: `SameSite=None` lets another site cause the browser to
  fire `POST /auth/refresh` with the cookie attached. CORS still blocks reading the response, so no
  token leaks; the reachable consequence is a rotation the user did not ask for, which reuse
  detection may turn into a logout. DEPLOYMENT.md section 6.2 states this and names the alternative
  (one registrable domain for both halves).

- **`COOKIE_DOMAIN` is optional and unset by default, which makes the cookie host-only.** SPEC
  section 8 lists it and the README deferred it to this phase. The temptation is to set it to the
  parent domain "so the cookie is available", but the client never reads this cookie — only the API
  does — so a host-only cookie is both sufficient and tighter. It exists for the one real case: an
  API and a client on subdomains of a single parent that need to share it.

- **Lighthouse was re-run rather than trusted.** Phase 13 ticked "scores recorded and meeting
  targets" but no number survives anywhere in the repository, so the claim was unverifiable. The
  re-run is now in the README with the method, and it caught two ways to measure the wrong page:
  auditing `/dashboard` through a Playwright `browser.newPage()` puts Lighthouse's CDP tab in a
  different browser context with no cookies, so it silently measures `/login` and reports a perfect
  score for a page nobody asked about; and auditing `/` while signed in redirects to the dashboard,
  because that redirect is the specified behaviour. Both were caught by asserting on
  `lhr.finalDisplayedUrl` instead of the requested one. The audit now uses a persistent context per
  route, signed in for the dashboard and signed out for the landing page.

- **`npm run stats` was built here rather than left deferred.** Phase 14 skipped it on the accurate
  grounds that section 16's Phase 14 definition does not list it and neither does the definition of
  done. But SPEC section 14 requires it, CLAUDE.md makes SPEC the source of truth for scope, and this
  is the last non-optional phase — nothing later would pick it up. It is thirty lines and reuses the
  existing connect/disconnect helpers. Soft-deleted accounts are counted separately rather than
  folded into the total: they are still on disk until the purge job reaches them, so a single number
  would misreport both the live user base and the storage in use.

- **Source maps are generated and then deleted from the deployed output, rather than not generated.**
  The definition of done asks for maps that are not publicly exposed, and `sourcemap: true` in the
  Vite config means `client/dist` — the exact directory a static host publishes — contains the whole
  readable source one predictable `.js.map` fetch away. Turning maps off would satisfy the letter and
  lose the thing they are for: an error tracker cannot symbolicate a minified stack without them. So
  `npm run build:deploy` builds, then `client/scripts/stripSourcemaps.mjs` removes every `.map` and
  every `sourceMappingURL` comment; DEPLOYMENT.md shows where a Sentry upload slots in between the
  two. Verified on a real build: 43 maps and 43 comments removed, zero remaining.

- **`CONTACT_EMAIL` stays a client build-time constant instead of becoming the server env var SPEC
  section 8 lists.** Everything that consumes it is client-rendered — the landing footer, the Terms
  and Privacy contact lines — plus `SECURITY.md` and `CODE_OF_CONDUCT.md`, which are static markdown
  read on GitHub and never served by the API. A server variable nothing reads is dead configuration
  that drifts from the value actually displayed. The README now states this exception rather than
  leaving the SPEC list looking unimplemented.

- **`deploy.yml` consumes CI's verdict through `workflow_run` rather than repeating its steps.** The
  instruction was to reuse Phase 10's workflow, and `workflow_run` is the only trigger that waits for
  another workflow's _conclusion_. Two consequences worth stating: the conclusion has to be checked
  explicitly in an `if:`, because `workflow_run` also fires on failure and cancellation and a red
  suite would otherwise still deploy; and the `DEPLOY_ENABLED` gate lives in the first _step_, not on
  the job, because GitHub does not expose secrets to a job-level `if:`. The resting state is a green
  skip rather than a red failure, so a fork cannot deploy anything and does not look broken either.

- **The load-sanity run is capped at 150-180 requests, and that is a measurement decision.** SPEC
  section 7 caps the API at 200 requests per 15 minutes, and that limiter is part of the
  configuration being measured — a longer run would report the latency of 429s. Sequential p95 is
  30.5 ms against the 200 ms threshold, so no index was added; `Application` already carries compound
  indexes on `user + status`, `user + deadline` and `user + createdAt`.

- **Atlas M0 has no automated backup, and DEPLOYMENT.md says so instead of inventing a setting.**
  SPEC section 14 asks for "the free-tier Atlas backup setting to enable"; there is not one below the
  paid tiers. The honest answer is `scripts/backup.sh` on a cron plus a tested restore, which is what
  the document prescribes.

## Post-Phase 16 — retarget the deployment to Railway

- **Both halves now deploy to Railway, at the owner's direction, for one dashboard and one bill.**
  SPEC section 15 names "Render (or Railway) for the API + Vercel (or Netlify) for the client", so a
  single-platform layout is inside what the spec allows rather than a departure from it. The
  Render + Vercel walkthrough is kept as an alternative at the end of the document rather than
  deleted, because it is genuinely the cheaper arrangement and someone may want it back.

- **The cross-origin section did not change, and the document now says loudly why.** The intuition
  that two services on one platform are somehow same-origin is wrong and expensive: an origin is
  scheme + host + port, so `web-production-….up.railway.app` and `api-production-….up.railway.app`
  are as cross-origin as two unrelated companies. CORS with credentials, the exact origin allowlist
  and `SameSite=None; Secure` are all still required, and Railway's private network does not apply
  because every request in this app starts in a browser on the public internet. Step 6 opens with a
  callout making that explicit so a future reader does not "simplify" it away.

- **No application code changed, and that was checked rather than assumed.** `TRUST_PROXY=1` is
  correct on Railway for the same reason it was on Render — the value counts proxy hops, not
  vendors, and both terminate TLS one hop in front of the container. The cookie policy keys on
  `CLIENT_ORIGIN` vs `API_URL` _hostname inequality_, so two distinct Railway hostnames resolve to
  `SameSite=None; Secure` regardless of whether the Public Suffix List treats `up.railway.app` as a
  suffix. The conservative rule written in Phase 16 lands correctly here with no edit.

- **Root Directory is deliberately left at `/`.** Railway distinguishes isolated monorepos, which are
  configured with a per-service root directory, from shared monorepos, which are configured with
  per-service build and start commands. This repository is the second kind: one `package-lock.json`
  at the root and two workspaces resolving through it. Pointing a service at `server/` or `client/`
  gives it a `package.json` whose dependencies it cannot install.

- **The client is a container running Caddy, because Railway has no static-hosting product.** On
  Vercel the SPA fallback was three lines of `vercel.json`; on Railway there is no rewrite setting to
  fill in at all, so the service ships a Dockerfile that builds with Node and serves `client/dist`
  with Caddy's `try_files {path} /index.html`. Railpack's static-site support with `index_fallback`
  would be fewer lines but expects the build output somewhere awkward for a workspace root, so the
  explicit Dockerfile is documented as the primary path.

- **The Caddyfile and Dockerfile are documented as copy-paste blocks rather than committed.** This
  matches how `vercel.json` was handled in Phase 16 and keeps the repository free of config for a
  platform the owner has not signed up to yet. They move into the repository the moment the first
  deploy happens, and DEPLOYMENT.md says so.

- **Railway's free tier is documented as what it is, not as a free lunch.** Trial is a one-time $5
  over 30 days; the Free plan is $1 of non-rolling credit a month on one project, 1 vCPU and 0.5 GB.
  Two always-on containers do not fit in $1, so the document says plainly to expect the $5/month
  Hobby plan or to enable sleeping. Writing "free tier" without that would have been the kind of
  cheerful omission that turns into a surprise bill.

- **Sleeping is opt-in on Railway and the trade is inverted from Render's.** Render forces a
  spin-down and gives a slow but successful wake; Railway stays up by default and, if you opt into
  serverless, the first request to a slept service **may return 502**. The idle timer also watches
  _outbound_ traffic, which a Mongoose connection pool and an hourly cron keep alive, so sleeping may
  never trigger and the credit saving may not materialise. Both facts are in Step 9 because either
  one alone would mislead.

- **`deploy.yml` drives the Railway CLI because Railway publishes no deploy-hook URL.** Render and
  Vercel both hand out a secret address to POST to; Railway authenticates a CLI with a project token
  instead. `railway redeploy` is used rather than `railway up` so the deployment stays tied to the
  commit its GitHub connection already points at — the one CI just passed on — instead of an ad-hoc
  upload of the runner's working directory. The CI gate, the `DEPLOY_ENABLED` switch and the
  green-skip resting state are unchanged. The document also warns to disable Railway's own
  auto-deploy, which would otherwise deploy on push before CI has finished and make the gate
  decorative.

## Post-Phase 16 — Vite host allowlist, and what it exposed

- **The reported symptom was `allowedHosts`; the actual finding was that production was serving the
  app with `vite dev`.** Vite's own rejection message names the option it consulted, and its source
  builds that string as `${isPreview ? "preview" : "server"}.allowedHosts`. The deployed error said
  **`server`**, so the request had reached the development server, not the preview server. Nothing in
  the repository could serve a built client at the time: there was no `start` script in either
  workspace, and `client/Dockerfile` had exactly one stage after `deps` — `dev`, running
  `npm run dev --workspace client`. A builder handed that Dockerfile with no target builds the last
  stage, so the deployed container was a development server: unminified, transformed on demand from
  source, HMR attached, and carrying the source maps `build:deploy` exists to strip.

- **The allowlist is derived from the environment, with a platform suffix as a fallback.** Two
  mechanisms rather than one, because they fail in different ways. `VITE_APP_URL` is already required
  to be the deployed client origin, so a custom domain needs no new configuration and the allowlist
  cannot drift from the canonical URLs. The `.up.railway.app` leading-dot suffix — Vite's documented
  subdomain-wildcard syntax, confirmed in 6.4.3's matcher as
  `allowedHost[0] === "." && (allowedHost.slice(1) === hostname || hostname.endsWith(allowedHost))` —
  keeps a platform-assigned name working before a domain exists and survives reassignment. An
  optional comma-separated `ALLOWED_HOSTS` covers the rest. No single domain appears in source.

- **`localhost` is deliberately absent from the list.** Reading Vite's matcher rather than assuming
  showed that any IPv4 literal, `localhost` and `*.localhost` are allowed unconditionally _before_
  the configured list is consulted. Adding them would be dead configuration, and worse, it would
  imply local development depends on this list. It does not, which is also the reason this change
  cannot weaken development or CI.

- **`buildAllowedHosts` takes the environment as an argument instead of reading `process.env`.** It
  is compiled by two TypeScript projects — `tsconfig.node.json`, which has Node types, and
  `tsconfig.json`, which does not, because the test imports it. A pure function of its input needs
  neither, and is directly testable without stubbing globals.

- **The test asserts the decision, not the list.** It reimplements Vite 6's matcher and drives it, so
  a case like `tracker.example.com.evil.org` — which _contains_ an allowed host — is proven to be
  refused rather than merely absent from an array. Half the cases exist only to prove hosts are still
  blocked, because a change that allowed everything would satisfy every positive case and destroy the
  protection. Confirmed against a real `vite preview` as well: three hosts answered 200 and five
  answered 403.

- **The server workspace has no equivalent exposure, for a concrete reason rather than an absence of
  findings.** Express ships no host check, and this API never reads the `Host` header — every public
  link is built from `env.APP_URL` or `env.API_URL`. Host-header injection matters when a server
  derives URLs from the request, and this one derives them from configuration, which is what makes
  the poisoned-password-reset-link class of attack unreachable here.

- **A production stage was added to `client/Dockerfile`, last on purpose.** It builds with
  `build:deploy` and serves with `vite preview`, so the platform default of "build the final stage"
  now yields a production server rather than a development one. `docker-compose.yml` pins
  `target: dev` explicitly and is unaffected. Verified by building the image and probing it: it
  serves the hashed production bundle, ships zero `.map` files, binds the injected `PORT`, and still
  returns 403 for an unrelated host. `vite preview` is not a hardened static server and Vite says so;
  DEPLOYMENT.md keeps the Caddy setup as the alternative for anyone who wants one.

## Post-Phase 16 — Railway builder pinned in config-as-code

- **The dashboard build command was not the wrong-package-name bug it looked like.**
  `npm run build --workspace=@internship-tracker/client` is valid: npm accepts a package name as
  well as a directory path, and running it locally builds the client and exits 0. It was still the
  wrong command, for a worse reason — it runs `build` rather than `build:deploy`, so the source maps
  are left in `dist/` and the protection added in Phase 16 was silently undone. Checking the premise
  rather than accepting it changed what needed fixing.

- **The real defect was the Builder, not the command.** Railpack ignores `client/Dockerfile`
  entirely, generating its own build and start commands, so the production stage added for the
  `allowedHosts` fix was never used and the container ran Vite's development server. `railway.client.json`
  pins `"builder": "DOCKERFILE"` with `dockerfilePath`, so the correct behaviour is version-controlled
  rather than a dashboard setting somebody has to remember to set again.

- **Two files, because Railway's config-as-code is per service.** One `railway.json` describes one
  service, so `railway.client.json` and `railway.server.json` sit at the repository root and each
  service is pointed at its own. Pointing a service at its file is the one step that cannot itself be
  version-controlled — it is what tells Railway where the versioned file is.

- **`startCommand` is set in the file precisely because config overrides the dashboard.** A stale
  `npm run dev -w client` typed into the Start Command box during an earlier attempt would otherwise
  keep winning over the image's own `CMD`. Setting it in config neutralises the dashboard value
  without needing to know what it currently says, which matters because the dashboard is not
  visible from here.

- **The API is pinned to RAILPACK deliberately, not left unpinned.** `server/Dockerfile` has only
  `deps` and `dev` stages, so a `DOCKERFILE` builder would run `tsx watch` in production — the same
  failure just fixed on the client. Writing the pin down stops a later tidy-up from "making the two
  services consistent" and reintroducing it.

- **Stage order is load-bearing and is now asserted by a test.** Railway's schema has no key for a
  multi-stage `--target`, so a build with no target takes the last stage, and the client's
  correctness depends on `prod` being last in `client/Dockerfile`. Nothing on the platform enforces
  that, so `client/tests/config/dockerfileStages.test.ts` does: it fails if a stage is appended after
  `prod`, if the final `CMD` stops being `preview`, or if `build:deploy` disappears. It also pins
  `server/Dockerfile`'s last stage as `dev`, which is the documented reason the API stays on Railpack.

- **`import.meta.url` is unusable in this test environment.** The first version resolved a path
  through it and read `tests/config/undefined`, because the jsdom environment leaves it undefined.
  The test walks up from `process.cwd()` instead, which also makes it indifferent to whether vitest
  was invoked from `client/` or the repository root.

- **`railway.json` is deprecated with a hard date, and the document says so.** Railway is moving to
  Infrastructure as Code (`.railway/railway.ts`, one file per project rather than per service);
  `railway.json` keeps working until 2026-12-01 and `railway config migrate --apply` converts it.
  The migration changes how the whole project is provisioned, so it belongs in its own deliberate
  change rather than folded into a bug fix — but shipping a file with an expiry date without saying
  so would have been the kind of omission that surprises someone in three months.

- **The `VITE_APP_URL` failure mode is spelled out rather than left as an ordering rule.** "Set this
  before attaching a domain" does not tell anyone what breaks. The allowlist is built from a
  `.up.railway.app` suffix plus the hostname parsed out of `VITE_APP_URL`; a custom domain is not
  covered by the suffix, so attaching one without setting the variable makes the new domain answer
  `403 Blocked request` for every request while the Railway URL keeps working — which reads as a DNS
  problem and sends you looking in the wrong place.

- **The reported "hardcoded port" was not a defect, and the fix was made anyway.** `vite.config.ts`
  already set `preview.host: true` and `preview.port: Number(process.env.PORT) || 4173`; building the
  `prod` stage and running it with `PORT=8080` showed `:::8080` in `netstat` and returned 200 through
  a published port, so `8080` in the Railway log was the injected `PORT` being read correctly and
  `localhost:8080` was Vite's convenience line printed above its `Network:` line. The start command
  was still made explicit, because a container's port and interface are its contract with the
  platform and should not depend on a config file loading.

- **`--host` with no value, not `--host 0.0.0.0`.** Bare `--host` is Vite's `host: true`, which binds
  the dual-stack wildcard and answers on both address families. `0.0.0.0` is IPv4 only, so it would
  have narrowed the binding the deployment already had, and Railway's private network resolves to
  both IPv4 and IPv6.

- **Shell form for the production `CMD`.** Exec form is otherwise preferable, but it has no shell, so
  `$PORT` would reach Vite as a literal string. `sh -c` is the only reason the expansion happens, and
  the test asserts the form rather than just the presence of `$PORT` because a correct-looking
  exec-form `CMD` fails in exactly this way.

- **The `railway.client.json` start command is wrapped in `/bin/sh -c` explicitly.** Railway runs a
  start command in exec form for a `DOCKERFILE` build and only gives it a shell under Railpack, so
  the first version of this fix — the same flags, unwrapped — would have shipped `${PORT:-4173}` to
  Vite as a literal string and broken the deploy outright rather than fixing it. The Dockerfile's own
  `sh -c` does not cover this, because the start command replaces the `CMD` rather than running
  inside it. A test asserts the wrapper, since the failure is invisible until deploy.

- **`railway.client.json` repeats the start command instead of dropping the key.** Railway's
  `deploy.startCommand` overrides the image `CMD` outright, so the Dockerfile's was dead
  configuration on Railway. Removing the key would let the `CMD` through, but would also leave any
  start command already set in the dashboard in force; setting it explicitly keeps config-as-code
  authoritative. A test fails if the two spellings diverge.

- **`EXPOSE 4173` is kept although Railway ignores it.** It documents a plain `docker run`, and it is
  tied by test to the start command's fallback so it cannot come to advertise a port nothing binds.

- **The localhost fallbacks in `client/src/lib/env.ts` stay.** They are what lets a fresh checkout run
  `npm run dev` with no `.env` at all, which is worth keeping. What was wrong was not the fallback but
  that a deploy build could reach it silently: Vite inlines `VITE_*` at build time, so the fallback
  became a permanent string in the shipped bundle and surfaced only as a CORS failure in a visitor's
  browser. `build:deploy` now runs `scripts/checkDeployEnv.mjs` first and refuses to build when
  `VITE_API_URL` or `VITE_APP_URL` is unset or points at localhost, which makes the fallback
  unreachable from a deploy without removing it from development.

- **The check rejects localhost, not just absence.** The failure that actually shipped had the
  variables set correctly on the Railway service; the Docker build simply could not see them. A check
  for presence alone would have passed in exactly the case that broke.

- **It is wired into `build:deploy` rather than `build`.** `npm run verify`, CI and a plain local
  build use `build`, and none of them have or need a deployed API URL. Putting the assertion on the
  deploy path only keeps the build that must be configured strict and the build that must not be
  configured quiet.

- **`ARG` is declared in the `build` stage specifically, and promoted to `ENV`.** ARGs do not cross
  stage boundaries, and an ARG is not exported into a `RUN`'s environment on its own, so either
  mistake reproduces the original bug exactly. `client/tests/config/dockerfileBuildArgs.test.ts`
  derives the required list by scanning the client source for `import.meta.env.VITE_*` rather than
  hardcoding it, so a variable added later is covered without anyone remembering to update the test.

- **DEPLOYMENT.md already documented the `ARG` pattern — for the wrong Dockerfile.** The Caddy
  alternative in section 5.4 carried it; the Dockerfile actually in use did not, and the surrounding
  prose said Railway "handles" build-time variables, which is half true and was the misleading half.
  Corrected in place rather than appended to, since the wrong sentence was the one being read.

- **`resend-api` is a third `MailTransport`, not a mail rewrite.** Phase 12 already had the right
  seam: `MailTransport` is `{ mode, send(message) }` and the queue owns retrying, so an HTTP sender
  is a new implementation behind it rather than a parallel system. Nothing above the seam changed —
  the queue, the three-attempt backoff, the preference gate, the request-isolation guarantee and all
  six templates are shared code, and the test suite drives the real queue and real templates through
  the new transport rather than doubling them.

- **Raw `fetch`, not the `resend` npm package.** Node 20 ships `fetch`, the call is one POST, and
  `transport.ts` states the module's design as "no provider SDK to swap and no code path per vendor".
  A dependency for a single documented endpoint would cut against that for no gain, and it keeps the
  provider swappable if Resend is ever replaced.

- **SMTP remains the default and is untouched.** `resolveTransportMode` still falls back to
  `SMTP_HOST` and then console; `RESEND_API_KEY` is only consulted ahead of `SMTP_HOST` when no
  explicit `MAIL_TRANSPORT` is set, on the reasoning that someone with both has just moved off a
  blocked SMTP port and left the old values behind.

- **Permanent errors are retried like transient ones.** `isRetryableStatus` classifies 429 and 5xx
  as retryable and 401/403/422 as not, but the classification only enriches the log line: the queue
  retries every rejection three times. Short-circuiting permanent failures would be a
  transport-specific rule in shared code, and SMTP already retries a bad password the same way.
  Consistency beat the small saving.

- **No real send was made.** There is no Resend account or API key in this environment, and using a
  real key or sending to a real address was not something to improvise. The suite stubs `fetch` at
  the transport boundary and asserts the exact request Resend documents — endpoint, bearer header,
  content type and body shape — so the first real send is the first thing the credential is used for.

## Phase 17 — the "Dispatch" visual redesign

- **The direction is "Dispatch": an operations board, not a marketing site.** The product is
  used by a student holding forty to eighty live applications under deadline pressure, and its
  two jobs are making sure nothing slips and making months of effort visible. That argued for
  dense and information-forward over warm and friendly. It also ruled out the obvious
  alternative — "technical, like Linear" — because dark grey with a faint violet accent is
  what the app already looked like and is now itself the template.

- **Palette: cool by default, heat means it needs you.** A desaturated petrol base with a jade
  primary, and amber and red as the only warm colours anywhere in the interface. That is a rule
  rather than a decoration: if something on screen is warm, it wants attention. It also replaced
  the slate-plus-indigo combination, which is the single most recognisable "generated app" tell.

- **Primary could not be amber, which was the first idea.** `warning` is already amber, and
  `assessment` and `interview` sit next to each other as slices in the status doughnut, so two
  ambers would have been two indistinguishable slices. Jade keeps the five semantics spread
  across the wheel at roughly 2°, 40°, 142°, 176° and 222°.

- **One typeface, two voices, via the width axis.** Archivo Variable, self-hosted, using the
  build that carries both the weight and the width axes in a single file: headings are set at
  118% width like lettering on a departure board, body text stays at 100%. Two roles for one
  request, and no second family to keep in tune. Tabular figures are the default because
  nearly every number in this app sits in a column. Not Inter — Inter is the default that
  makes an interface look like every other interface, and the app had in any case been naming a
  font it never loaded and rendering in the system stack.

- **Radii encode hierarchy rather than being one value.** chip 4px, control 6px, card 10px,
  panel 14px. A single radius on everything regardless of weight is a tell, and the landing
  page had `rounded-xl` on every element.

- **Flat panels lost their shadow.** An identical soft shadow under every card is the SaaS-card
  default; grouping now comes from rules and alignment, which also makes the app agree with the
  landing page. Modal, Popover and the error boundary keep a shadow, because those genuinely
  float above the page.

- **The theme control now appears on the logged-out surface.** It was only in the app shell and
  on the auth pages, so a visitor got dark with no way out. It is the same `ThemeToggle`
  component driving the same store and the same storage key the inline boot script reads —
  deliberately not a second mechanism, so Phase 5's no-flash behaviour is untouched.

- **The token contrast gate was widened, and it had to be.** It composited each pill tint over
  `surface` only — the lightest of the three grounds. axe found a 4.48:1 badge on the board,
  which is painted on `surface-muted`; checking all three surfaces showed all five light
  semantics failing over two of them. The gate now checks every surface a tint is painted on,
  and the light semantics were darkened to clear it. A gate that only checks the easiest case
  is not a gate.

- **The dark warning amber was resaturated, not brightened.** It read muddy against petrol, but
  measurement showed it was already at 9.7:1 — higher than the light theme's 6.5:1 — so the
  problem was saturation, not contrast. It went to 100% saturation and the light amber shifted
  hue slightly so both themes sit in the same family. They cannot match exactly: an
  AA-compliant amber on a near-white surface has to be dark enough to read brownish.

- **The calendar's ARIA rows are a fix, not a redesign.** `role="grid"` may not own gridcells
  directly, and this one did — two critical axe violations on all 42 cells. Pre-existing:
  Phase 15's axe spec never visited `/calendar`. Weeks are wrapped in `display: contents`, so
  no box is generated, the seven-column layout is identical and the DOM order is unchanged.
  Recorded here because it is a DOM change made on a redesign branch.

- **The dashboard screenshot capture was made deterministic.** It asked for a light context,
  but `colorScheme` only decides what `system` resolves to and the demo account's stored
  preference wins once the session loads, so the theme it captured depended on account state.
  It now drives the theme control explicitly.

## Phase 17b — the primary colour moved from jade to violet

- **The jade primary was replaced outright, not retuned.** Review found it read neon in dark
  mode. Measurement showed why, and it was not saturation: at `rgb(51 201 182)` it cleared the
  dark gate at 8.48:1 where 4.5 is asked, nearly double the floor. Jade was never pushed there
  by the contrast requirement — a near-grey at chroma 0.02 passes the same gate — so the glare
  was a tuning choice. Replacing it was cheaper than defending it.

- **The replacement is violet, not the cobalt that was asked for.** The brief was a deep cobalt
  or blue-violet. Cobalt is unavailable: `--color-info` already sits at OKLCH hue 264, and it is
  the `applied` status and `chart-2`. A cobalt primary at hue 265 landed 1.2 degrees from it,
  which would have made Applied and Assessment the same colour in both themes. Mapping the hue
  occupancy of the tokens that could not move left one wide gap, between info at 264 and
  `chart-5`'s pink at 352. The primary sits at hue 298, 36 degrees from each.

- **`--color-primary` was split into an accent token and a fill token.** One value cannot do
  both jobs in dark mode. The pill shape `bg-primary/15 text-primary` forces the token to be
  readable as text on a near-black card, which pins it to about OKLCH L 0.72 — and a fill that
  light with dark text is the pastel button the first attempt produced. The fill is now its own
  token at L 0.565 carrying white text. Light mode does not have this conflict and its two
  values are deliberately identical; the split exists for dark and is defined in both themes so
  they cannot drift apart silently. `--color-primary-hover` and `--color-primary-fg` were
  deleted: after the nine solid-fill sites moved, nothing referenced them.

- **The rule for which sites moved is mechanical.** Wherever `bg-primary` was paired with
  `text-primary-fg` — nine places — both moved to the fill pair. Every tinted use kept the
  accent value: the status pills and dots, the `/5` drag-target grounds, the sidebar and topbar
  chips, the usage bar. The distinction is whether the token is carrying text on top of itself.

- **Hover deepens in both themes rather than lightening in dark.** Lightening the dark fill past
  `#8858d6` drops white label contrast below 4.5:1, so the only direction that keeps the label
  readable and the two states distinct was down. "Hover deepens the button" is now one rule for
  both themes instead of two opposite ones.

- **The fill token is gated separately, and the new gate immediately caught a real miss.** The
  first dark fill was checked against `canvas` and shipped into the test at 2.75:1 against
  `surface-muted` — the same audit-one-background error the Phase 17 gate was widened to stop.
  The assertions added here check the fill's shape contrast against all three grounds, plus the
  label on both the fill and its hover. The gate is 41 assertions per theme, up from 37.

- **Final values.** Light: primary and fill both `104 46 179` (`oklch(0.458 0.196 298)`), fill
  hover `86 32 151`, label white. Dark: primary `178 151 234` (`oklch(0.732 0.120 298)`), fill
  `133 85 210` (`oklch(0.565 0.185 298)`), fill hover `115 63 191`, label white. The dark
  accent's chroma is 0.121, marginally below the jade it replaces (0.124) — the calmer result
  came from dropping luminance, not saturation.

- **`--color-success` was deliberately left green.** It is the `offer` status: a positive-outcome
  semantic that is conventionally green and independent of the brand colour. Amber and red were
  untouched for the same reason. `chart-1` and both heat ramps were re-derived from the violet,
  because those are primary-derived and would otherwise have been visibly leftover jade.

## Contact address

- **`CONTACT_EMAIL` is `naabel.workspace@gmail.com`, chosen deliberately by the maintainer.**
  CLAUDE.md says never to commit a real email address. That rule exists to stop personal addresses
  leaking into code, fixtures and seeds — but Terms, Privacy, `SECURITY.md` and the footer all
  need a reachable contact by definition, so a public deployment cannot satisfy both readings at
  once.

  The conflict was surfaced before anything was written, with the alternatives laid out: leave the
  placeholder, use a GitHub noreply address, supply a dedicated alias, or publish the personal
  address. The maintainer picked the dedicated alias and **accepted the public-exposure trade-off**
  that comes with putting any address in a public repository — it will be scraped. This is a
  considered decision about which address to expose, not an oversight, not a default, and not the
  agent inferring intent from an ambiguous answer.

  The alias is deliberately separate from the maintainer's personal inbox, which is what keeps the
  spirit of the CLAUDE.md rule intact while still giving the legal pages a contact that works. Any
  future change to this value is a decision at the same level: it belongs here, not in a commit
  message.

- **Only three files changed, and the markdown keeps its placeholder.** `siteMeta.ts` is the one
  constant; `LegalPage` substitutes `{{CONTACT_EMAIL}}` into `terms.md` and `privacy.md` at render,
  so those sources still carry the token and `legal.test.tsx` still asserts it. `SECURITY.md` and
  `CODE_OF_CONDUCT.md` are read on GitHub rather than through the app, so nothing substitutes for
  them and they were edited directly. Phase 13's note that the test "will start failing once you
  replace it" assumed the markdown would be edited too; via the constant, it does not.

## Chart series palette — issue #4

- **Positions 7 and 8 became real tokens rather than semantic reuse.** `SERIES_TOKENS` ended with
  `color-info` and `color-success`, which are byte-identical to `color-chart-2` and
  `color-chart-4`, so the seven-category "By source" chart painted two categories the same blue in
  both themes. Option 1 from the issue was taken. The deeper reason to prefer it over capping the
  series at six: a semantic token's value is owned by what it _means_, so any future change to
  `info` or `success` would silently re-collide. Categorical colour needs tokens whose only job is
  to differ from one another.

- **The hues were chosen against the whole palette, not just the two they replace.** Occupancy
  across both themes, chromatic tokens only: 27/30 danger, 59/79 warning, 151/153
  success and `chart-4`, 264 info and `chart-2`, 298 primary and `chart-1`, 352/355 `chart-5`.
  `chart-6` is near-neutral at C 0.03 and holds no hue in practice. That leaves two wide arcs —
  153→264 (111 degrees) and 79→151 (72 degrees).

- **`chart-7` is hue 239 and `chart-8` is hue 110.** Not the arc midpoints. The midpoint of the
  larger arc is 209, which is exactly where `chart-6`'s grey sits: a saturated colour there is
  separated from it only by chroma. Searching hue and lightness together, and scoring by the
  minimum OKLab distance to every other series colour in both themes, put `chart-7` at 239
  instead. `chart-8` at 110 sits between warning and success with 31 and 41 degrees of clearance.
  Distance from the primary at 298 is 59 degrees for `chart-7` and 172 for `chart-8`, so neither
  is near what the violet redesign introduced.

- **Values.** `chart-7`: light `10 88 129`, dark `131 204 252`. `chart-8`: light `109 110 10`,
  dark `165 165 14`. Both were constrained to the lightness band the other six already occupy
  (light L 0.44-0.52, dark L 0.70-0.82) rather than taking the mathematically optimal values,
  which sat at the edges of the range and would have read as darker and out of family.

- **The result is better separated than what already shipped.** The closest pair among all eight is
  `chart-1`/`chart-2` in dark at OKLab 0.077 — pre-existing, from the violet redesign. The new
  tokens' nearest neighbours are 0.096 and 0.108, so neither is the binding constraint.

- **The missing assertion was the real defect.** Every existing assertion compared a token to a
  _background_; nothing compared series entries with each other, which is how identical values
  shipped. `tokenContrast.test.ts` now asserts every entry resolves to a distinct colour in both
  themes, and it imports `SERIES_TOKENS` rather than restating it, so a ninth entry is covered the
  day it is added. Verified by reintroducing the original list: it fails in both themes with
  "color-info duplicates color-chart-2".

- **The constants moved to `chartTokens.ts`.** `chartTheme.ts` imports React and the theme store,
  which a token test reading CSS off disk should not have to load to learn what the series is.

- **`chart-7` and `chart-8` were added to `tailwind.config.ts` even though no `chart-*` utility is
  used anywhere.** The config is a complete mirror of the token file for every other colour, and a
  partial mirror is a worse trap than an unused key — Tailwind emits nothing for classes no one
  writes. That the existing `chart-1`..`chart-6` keys are equally unused is noted, not acted on:
  the charts read the custom properties directly through `getComputedStyle`.

## robots.txt and sitemap.xml are build-generated, not committed

- **The localhost URL in production was a committed artifact, not a broken variable read.** Both
  files were tracked in `client/public/`, and `generateBrandAssets.mjs` — which reads
  `process.env.VITE_APP_URL` perfectly correctly — was wired only to the manual `npm run assets`.
  Someone ran it once with the variable unset, the `?? 'http://localhost:5173'` fallback won
  silently, and the output was committed. Vite copies `public/` byte-for-byte with no
  substitution, so setting `VITE_APP_URL` on the host could never change those bytes. The defect
  was the commit, not the code.

- **They moved to `generateSeoFiles.mjs`, run by both `build` and `build:deploy`, and are now
  gitignored.** The split is along a real line: an asset that depends on the _brand_ (favicons, the
  OG image, the manifest) is the same file wherever it is served from and is worth committing, but
  an asset that embeds the _deployment origin_ cannot be. Keeping both kinds in one script is what
  let the second inherit the first's "generate once and commit" treatment.

- **The dev fallback now announces itself.** A silent fallback is what made this invisible for a
  whole phase, so an unset `VITE_APP_URL` prints a warning naming the localhost URL it used.
  `checkDeployEnv.mjs` still refuses a deploy build outright, so the warning only ever appears on
  a local build.

- **`Seo.tsx` was never affected.** Its canonical, `og:url` and `og:image` come from
  `import.meta.env.VITE_APP_URL`, which Vite does substitute at build time. Confirmed by grepping
  the proof-domain build: the string appears in the emitted JS bundle. `site.webmanifest` is also
  unaffected — it holds only relative paths.

- **The og-image and favicons have the same _class_ of defect on a different axis, and were left
  alone deliberately.** `BRAND` in `generateBrandAssets.mjs` is still `#33c9b6`, the jade that two
  redesigns ago replaced, so every generated brand asset ships a colour the app no longer uses.
  That is palette staleness rather than domain staleness, and it is unrelated to this bug, so it
  was raised separately rather than folded in.

## Brand assets are drawn from the tokens, and the committed copies are checked

- **The four brand colours are parsed out of `src/index.css` instead of being hex literals.**
  `BRAND`, `INK`, `CANVAS` and `MUTED` were hand-copied from the dark theme block, so nothing tied
  them to the palette. Only `BRAND` had actually gone wrong — it was still `#33c9b6`, the jade two
  redesigns had removed — but all four carried the same exposure, one palette change away from the
  identical bug. `brandPalette.mjs` now resolves all four from `--color-primary`, `--color-text`,
  `--color-canvas` and `--color-text-muted`.

- **`brand` maps to `--color-primary`, not `--color-primary-fill`.** The mark bars, the top rule
  and the footer line are graphical marks on a dark ground, which is the accent's job; the fill
  token exists for solid buttons carrying white text.

- **Regex parsing, not a CSS parser.** The same two patterns `tests/utils/contrast.ts` already
  uses, and `src/index.css` documents the constraint they depend on: every declaration in those
  blocks is a flat `--name: value;`, because a nested rule would truncate a match bounded by
  `[^}]*`. The value grammar is three integers, with no `calc()`, `var()` or colour functions in
  play. A full parser would be more machinery against a file whose shape is already contractual
  and enforced by the contrast suite.

- **A missing token throws.** No fallback. The silent `??` fallback in the SEO script is what kept
  `http://localhost:5173` in production for a whole phase, and a brand asset quietly drawn in a
  default colour would fail the same invisible way.

- **The first version of the drift check was close to worthless, and that is worth recording.**
  Asserting the generator's resolved colours equal the tokens cannot fail once the generator reads
  those tokens — both sides read one file and always agree. It looks like a check and tests
  nothing. The failure that actually happened was different: the palette changed, nobody re-ran
  `npm run assets`, and the _committed assets_ kept the old colour. So the real assertion reads
  `public/favicon.svg` — the one committed asset that is text, written by the same run as the PNGs
  — and fails if it carries a colour the palette no longer contains. Verified by restoring the
  jade `favicon.svg` from git: it fails with "run `npm run assets -w client` — the committed
  assets are stale".

- **This commit contains regenerated binaries.** Nine files under `client/public/` — the OG image,
  both favicon PNGs, the ICO, the SVG, all three app icons and the Apple touch icon. Unlike the
  last few fixes, the asset change _is_ the fix; the code change only stops it recurring.

## Phase 17c — depth and atmosphere on the landing hero

- **This reverses a Phase 17 decision on purpose, and the earlier entry should be read through
  this one.** Phase 17 ruled out "technical, like Linear" on the grounds that dark grey with a
  faint violet accent was what the app already looked like. The objection to the result was that
  it read flat, and the direction asked for was explicitly Linear's sense of depth. The palette
  and the typeface are untouched; what changed is that the page now has a light source. The
  Phase 17 reasoning still holds for colour and type, which is why neither moved.

- **One lamp, anchored on the product's own content.** The glow sits over the "Next up" panel
  rather than floating somewhere decorative, and everything falls away from it. A gradient wash
  placed for its own sake is the generic tell; a light source with a position that means
  something is not. That is also why there is one and not three.

- **The atmosphere can only ever lift a pale canvas towards white or deepen a near-black one
  towards black.** That is a property, not a set of lucky numbers, and it exists because the
  first attempt failed. A violet lamp that tinted the light canvas _darker_ dropped
  `text-subtle` to 4.27:1 — that token clears the plain canvas by only 4.90:1 and has nowhere to
  go. The mistake was treating light mode as dark mode with the numbers flipped, when the
  physical rule is that light adds light. Both themes now add light at the lamp and fall back to
  their own canvas, so no background can be pushed past a value the gate already checks.

- **The contrast gate was widened rather than argued around.** "Decorative" is not on its own a
  reason a layer under text is safe, so the hero lamp, the vertical grade and the panel glaze are
  each composited at their _peak_ alpha and re-checked against every body token, plus the five
  semantics on the glazed panel because the hero's amber "in 2 days" sits there. The alphas are
  read out of `index.css` by a second parser rather than restated in the test, for the same
  reason the colours already were.

- **No `backdrop-filter` anywhere in this layer, deliberately.** Nothing on this page scrolls
  under a translucent surface, so the blur would cost compositing and be indistinguishable from
  an opaque fill — and a translucent panel puts text on a background whose value depends on
  whatever is behind it, which is exactly what the gate cannot check. Every atmosphere surface is
  opaque at every stop. If the marketing header ever becomes sticky, that is where blur earns it.

- **The cast under a floating panel is coloured, not black.** A black shadow on an 11 19 21
  canvas is invisible, which is the actual reason dark interfaces read flat. `--atmos-cast` is
  lighter than the dark canvas and darker than the light one, so one declaration reads as a glow
  in dark mode and a shadow in light mode.

- **The light bloom was strengthened after review, and the fix was the white lift, not the
  lamp.** `--atmos-deep-peak` at 0.55 brightened the whole top band, so the lamp had nothing but
  white to read against and the two washed together. Pulled back to 0.38, with the lamp given
  real chroma at `238 227 255`. Chroma costs luminance — green carries 0.72 of it — so the value
  is the most saturated lavender that still leaves margin: `text-subtle` lands at 4.72:1 against
  a 4.5 floor and a 4.91:1 plain-canvas baseline.

- **The bundle claim was measured, not assumed.** `checkBundle.mjs` filters the manifest closure
  with `.endsWith('.js')`, so CSS is not counted in the landing budget at all and the 113.3 KB
  figure did not move. The real cost is the stylesheet: 7,170 to 7,613 bytes gzipped, +443 B,
  measured by stashing the change and rebuilding rather than estimating.

- **Hero only.** `atmos-field`, `atmos-lit` and `shadow-float` are applied to one surface so the
  treatment could be approved before it spread. Propagating them to the remaining landing
  sections and the app panels is deliberately left as separate work.

## Phase 17c propagation — the two floating overlays

- **Executed 2026-09-08. This is a new decision, not the execution of a previously approved
  list.** The Phase 17c entry above closed with "Hero only" and deferred propagation to "the
  remaining landing sections and the app panels". No surface list was ever recorded anywhere in
  this repo — the deferral is the only text on the subject. This pass deliberately takes neither
  of the two groups that deferral named; it takes the two shared overlay primitives instead, and
  the landing sections and the app panels stay deferred exactly as they were.

- **`Modal` gets `shadow-float` and `atmos-lit`. `Popover` gets `shadow-float` only.** Two class
  changes, both replacing `shadow-card`, and nothing else in the tree was touched.

- **These two were already singled out, which is why they go first.** Phase 17's "flat panels lost
  their shadow" bullet stripped the shadow from every card and kept one on Modal, Popover and the
  error boundary, "because those genuinely float above the page". `shadow-float` is the
  atmosphere-aware form of that same judgement — a lit top edge, a contact shadow, and a coloured
  cast that reads as a glow on the dark canvas — so on those two surfaces it replaces `shadow-card`
  rather than introducing a new idea.

- **`Popover` does not get the glaze, and that asymmetry is the point.** `.atmos-lit` fades its
  glaze out by 38% of the element's height, which on a 20rem panel is a soft top band and on a
  menu 15rem wide with 0.5rem of padding would tint the first row or two and stop — a gradient
  artifact sitting behind text, not a lit surface. The lit top edge Popover does get comes from
  `shadow-float`'s inset highlight, which is a 1px line and therefore height-independent.

- **The contrast gate needed no widening, and that was checked rather than assumed.** The gate's
  `glazed` case composites `--atmos-glaze` over `--color-surface` at peak alpha and asserts all
  three body tokens and all five semantics against it. Modal is `bg-surface` plus `atmos-lit` —
  the identical composition to the hero panel already covered — so the existing assertions cover
  the new surface as written. Popover changes no background at all and is contrast-neutral.
  116 assertions pass in both themes.

- **Everything else was left alone on purpose.** ScreenshotSection, FeatureCards, HowItWorks,
  FaqAccordion, the dashboard, the auth pages, the error boundary, the sidebar drawer, the toasts
  and every card and table keep what they have. The error boundary is the third surface Phase 17
  named as genuinely floating and is the most obvious candidate to follow; it is still out of
  scope here. Spreading a treatment one approved surface at a time is the whole reason the hero
  entry held it to one.

- **No bundle movement.** The landing closure stays at 113.3 KB gzip, and neither class adds a
  declaration to the stylesheet — both already exist for the hero.

---

## The logo mark replaced by an angular fold

- **The geometry now has one definition, `scripts/brandMark.mjs`.** The three-bar funnel was
  written out three separate times — in `BrandMark`, in `markSvg`, and inline in the OG masthead —
  which is the identical arrangement that let every favicon keep the jade primary two redesigns
  after the app dropped it, in geometry rather than colour. It had never gone wrong only because
  the mark had never changed; replacing it is precisely the event that would have exposed it.
  `MARK_PATH` is the single source, the generator imports it, and `BrandMark` restates it under a
  test that fails if the two diverge.

- **`BrandMark` restates the path rather than importing it, and that is a limitation, not a
  preference.** `brandMark.mjs` runs from npm before Vite or tsc exist to resolve it, the same
  reason `brandPalette.mjs` is plain `.mjs`. A component importing across that boundary would mean
  compiling the build scripts first. The copy is tied down by `tests/config/brandMark.test.tsx`,
  which renders the component and compares the `d` it actually paints against the module — the
  same tactic the palette test uses, where a second independent reader checks the first.

- **No hex was hand-copied, and none needed to be.** The brief offered the option of a static SVG
  with the two brand hex values commented as needing to stay in sync. That would have recreated the
  bug this repo already paid to fix. The generated tiles take `BRAND` and `CANVAS` from
  `readBrandPalette()`, and `BrandMark` paints in `currentColor` under `text-primary`, so both ends
  resolve `--color-primary` from `src/index.css` — `#682eb3` in light, `#b297ea` in dark — and the
  component carries no colour at all. A test asserts no hex appears in its markup.

- **Two viewBoxes off the one path.** The icon tiles take the padded `0 0 512 512`, because an app
  icon needs air between the glyph and the rounded corners. Everywhere the mark is set beside type
  it takes `96 96 320 320`, the glyph's own bounds squared off. Rendered at the padded box, a
  16 px inline mark reads visibly smaller than the wordmark next to it — the glyph fills only 62%
  of that box — and the tight frame restores the weight the three-bar mark had at the same
  `h-4 w-4`.

- **The supplied path was shifted 16 units right, and its left arm thickened from 16 to 32.** The
  shape arrived off-centre, with an 80-unit left margin against 112 on the right; the shift centres
  it and changes nothing else. The arm is the legibility decision: at 16 units it is half a pixel
  at favicon size, and rendered as a grey tint rather than a stroke. At 32 it is a whole pixel. The
  mark was checked at 512, 32, 16, 12, 10 and 8 px in both themes before either change was kept.

- **The authenticated shell was left alone.** The brief asked for the mark in "the navbar/header,
  both the app shell and the marketing header". The app shell has no mark: `Topbar` renders no
  brand, and `Sidebar` sets the wordmark as bare text. Adding one there is a lockup change rather
  than a mark replacement, so it was reported instead of done.

- **The email masthead keeps its two-letter type mark.** `server/src/mail/layout.ts` draws "IT" in
  a tinted box, deliberately: email clients block remote images and `app-info.ts` records that a
  broken image is worse than none. An SVG mark cannot go there. Its `BRAND = '#4f46e5'` is a stale
  indigo of exactly the drift class described above, but the server workspace cannot read
  `src/index.css`, so fixing it in place would swap one hand-copied literal for another. Filed
  rather than patched.

---

## The email palette is generated from the tokens — issue #10

- **The deployment chose the mechanism, not taste.** The issue offered three options and preferred
  a generated-and-committed palette. In the code the choice turned out to be forced:
  `server/Dockerfile` copies `package.json`, `tsconfig.base.json` and `server/`, and never
  `client/src`. The stylesheet is not in the server's build context at all, so a palette resolved
  during the server build cannot work — not merely awkwardly, but at all. Generating ahead of time
  and committing the result is the same answer, for the same reason, that the favicons are
  committed rather than built.

- **`server/scripts/generateMailPalette.mjs` reuses the client's reader rather than writing a
  second one.** It imports `readThemeChannels` from `client/scripts/brandPalette.mjs`, which was
  already parameterised by theme. A cross-workspace relative import is acceptable here precisely
  because it runs at generation time, by hand, in a checkout that has both workspaces — the same
  place `npm run assets -w client` runs. Nothing at server build or runtime reaches across.

- **The light block, because email renders one fixed document.** There is no
  `prefers-color-scheme` worth relying on in a message body, and the shell was already a light
  design. The server therefore ships one theme rather than guessing at two.

- **All six literals were replaced, not just the broken one.** Only `BRAND` was visibly wrong, but
  `INK`, `MUTED`, `BORDER`, `CANVAS` and `SURFACE` were the rest of the same slate template and
  carried the identical exposure — exactly the reasoning that took #7 from one stale colour to
  four. Contrast is preserved by construction rather than by inspection: text-on-surface,
  muted-on-surface and white-on-primary-fill are the pairs `tests/a11y/tokenContrast.test.ts`
  already measures in the light theme, which the hand-picked greys never were.

- **`brand` and `brandFill` are separate entries even though they hold the same value today.** The
  masthead tile and the button are solid blocks carrying white text, which is what
  `--color-primary-fill` exists for; the detail line in a list is an accent on the surface, which
  is `--color-primary`'s job. They are equal in the light theme and different in the dark, so
  mapping them by role is what keeps this correct if they ever diverge here too. The button's
  hardcoded `#ffffff` became `--color-primary-fill-fg` for the same reason.

- **The unsubscribe confirmation page was in scope even though the issue did not name it.** An
  audit of every hex in `server/src` found `email.controller.ts` carrying the same templated set,
  including `#4f46e5`, on the page a reader lands on immediately after clicking unsubscribe. It
  imports the same generated palette; leaving it would have meant shipping the fix and the bug one
  file apart. No hex literal now remains anywhere in `server/src` outside the generated file.

- **The drift test throws rather than asserts, and that is deliberate.** Jest's `expect` takes no
  message argument, so a bare "expected undefined to be defined" would not say which token moved
  or what to run. Both failure directions were demonstrated rather than assumed: a stale committed
  palette reports `palette.ts is stale: brand is #4f46e5, but --color-primary is now #682eb3`, and
  a token deleted from the stylesheet reports that it is missing rather than resolving to nothing.
  Both files were restored from checksummed backups, not `git checkout`, which would have destroyed
  the new untracked work.

- **Verified by rendering, not by reading the constant.** The palette could be correct and the
  layout still paint a literal, which is the state this started from. The verification email was
  rendered through `renderMail`, loaded in a real browser, and the masthead tile sampled: computed
  style and painted pixel both `rgb(104, 46, 179)`. The rendered HTML contains the seven derived
  colours and none of the five replaced ones.

---

## The palette has a home outside the stylesheet — checkpoint 1 of the structural fix

- **This is the first prospective fix in a class that had been fixed three times retrospectively.**
  Jade favicons (#7), a localhost sitemap, and an indigo email palette (#10) were each found after a
  stale value had already reached a real consumer. Each fix taught its own consumer to derive rather
  than copy, and each left the arrangement that produced it in place: the values existed only in
  `client/src/index.css`, so anything needing a colour had to either parse CSS or hold a copy.
  `src/theme/tokens.json` is now the source and the stylesheet is written from it, which is the
  inversion those three fixes each worked around.

- **The premise that a prior entry had diagnosed this was checked and is not correct.** The sentence
  quoted in the brief — "index.css is the source of truth by convention rather than by construction"
  — appears nowhere in this file, and neither does any flag that a fourth instance was coming. The
  most recent entry before this one is #10, which ends on its rendering verification. The nearest
  real statements are #7's "nothing tied them to the palette" and #10's "the server workspace cannot
  read `src/index.css`, so fixing it in place would swap one hand-copied literal for another".
  Recorded because a decision log that cites itself inaccurately is worth less than one that does
  not.

- **`tokens.json`, not `tokens.ts`, and read by plain `.mjs`.** The constraint is the one already
  recorded twice: `brandPalette.mjs` and `brandMark.mjs` are plain `.mjs` because they run from npm
  before Vite or tsc exist, and that boundary is why `BrandMark` restates its path rather than
  importing it. A TypeScript canonical source would have to be compiled before the brand-asset
  generator could read it. `readFileSync` + `JSON.parse` works unchanged from a build script, from
  vitest and from jest.

- **Values are stored as opaque strings, because not all of them are colours.** The same blocks
  carry bare alphas (`--atmos-light-peak: 1`) and a keyword (`--atmos-grade-axis: to bottom`).
  `readThemeChannels` filters to three-integer values, preserving the contract the old regex reader
  had, where the channel pattern rejected anything that was not a colour. A consumer asking for a
  colour cannot be handed a gradient direction.

- **Comments inside the blocks are stored verbatim, as raw lines.** The stylesheet uses both a
  single-line form and a multi-line one, and the atmosphere comment is twenty lines of load-bearing
  reasoning. Re-wrapping prose from structured data would have been a second thing that could drift;
  storing the lines as written cannot, and it is what makes the output provably byte-identical.

- **The blocks are located by their selector, not by inserted marker comments.** Markers would have
  been new syntax in the stylesheet for a later edit to break, and — the deciding point — adding
  them would itself have changed `index.css`, making the byte-identical proof impossible to state
  cleanly. The selector is the anchor `brandPalette.mjs`, `tests/utils/contrast.ts`,
  `tests/utils/themeTokens.ts` and `server/tests/mail.palette.test.ts` already match on, and the
  stylesheet's own header documents the flat-declaration constraint that makes it correct.

- **`index.css` stays committed with a generation check, rather than becoming generated and
  gitignored.** Both patterns already exist here and the choice was made against them rather than by
  default. The SEO entry draws the line itself: an asset that depends on the _brand_ is the same
  file wherever it is served and is worth committing; one that embeds the _deployment origin_ cannot
  be. `index.css` has no origin in it — it is identical bytes on every machine, so the reason
  `robots.txt` had to stop being committed does not apply. Two further reasons: it is a source file
  Vite and Tailwind consume, so gitignoring it would leave a fresh clone unable to run `npm run dev`
  before a generate step; and roughly 62% of it is hand-written `@layer` CSS that is not derivable
  from a palette, so generating the whole file would mean moving that CSS into a template. Only the
  two token blocks are generated.

- **The inversion was proved to change nothing before anything was built on it.** Running the
  generator against the committed stylesheet left `git diff --exit-code` clean. That proof was then
  checked for vacuity, because a generator that silently matched nothing would pass it forever: a
  perturbed token value does reach the CSS, and a light-theme edit leaves the dark block untouched.

- **The gate was demonstrated failing in both directions, not assumed to work.** A colour
  hand-edited in `index.css`, and a `tokens.json` edit left un-regenerated, both produce the same
  message naming `npm run generate:theme -w client`. The stylesheet was restored from a checksummed
  copy rather than with `git checkout`, which would have destroyed the untracked work beside it; the
  restored file matches its pre-test digest exactly.

- **The chart theme-reactivity mechanism is unaffected, and the reason is structural rather than
  lucky.** `readChartPalette` reads custom properties off the document element with
  `getComputedStyle`, so the browser resolves whatever CSS it was served and the provenance of those
  bytes is invisible to it. What could have broken it is byte-level, in the tests:
  `tests/utils/themeTokens.ts` injects the raw matched blocks into jsdom, so a change to the
  selector quoting or the flat-declaration shape would have silently handed the chart suite the
  wrong palette. The byte-identical requirement is what protects that, which is its real job.

- **A correction to the scope, which matters for whoever picks up the rest.** The brief described
  three consumers "each independently parsing index.css with its own regex reader". On inspection
  that is not the arrangement. `brandMark.mjs` holds geometry and no colour at all — its own header
  says so — and `generateMailPalette.mjs` imports `readThemeChannels` from `brandPalette.mjs` rather
  than defining a reader, which #10 records deliberately. There was one reader feeding both
  generators, not three. The real parser count is four, and three of them are test-side:
  `brandPalette.mjs`, `tests/utils/contrast.ts`, `tests/utils/themeTokens.ts` and
  `server/tests/mail.palette.test.ts`. Consolidating them is therefore a smaller job than the brief
  assumed, and migrating `generateMailPalette.mjs` may be a no-op that only needs confirming.

- **Not every parser should collapse onto the token file, and that is deliberate.** #7 records
  writing a drift check that was "close to worthless" because both sides read one file and always
  agreed. Pointing the contrast gate at `tokens.json` would recreate exactly that: the gate exists
  to measure the colours the browser actually paints, which means it has to read the shipped
  stylesheet. The line drawn here is that parsers which _derive_ values read the token file, and
  parsers which _verify a shipped artifact_ keep reading the artifact.

- **Found on the way and left in place, deliberately:** `chartTheme.ts` holds
  `FALLBACK = '148 163 184'`, a slate matching no current token, used when a token resolves to an
  empty string. It is a "the stylesheet did not load" sentinel rather than a brand colour, and
  drawing it from the palette would make that failure paint in brand colours and become invisible —
  the opposite of what it is for. It should be allowlisted as a sentinel, with that reason stated,
  by the no-raw-colour test in checkpoint 4.

- **Checkpoints 2-4 are deferred as consolidation on top of a working inversion, not as part of the
  core fix.** What landed is what makes the class structurally closed: the values have a home
  outside the stylesheet, the CSS is generated from it, and hand-editing a colour in `index.css` now
  fails the suite with a message naming the fix. What remains is narrower — pointing
  `brandPalette.mjs` at the token file (its `readBrandPalette(css)` test injects a CSS string, so
  that one case needs a deliberate rewrite to inject JSON, preserving the assertion and changing
  only the source format), confirming the mail generator needs no change, and adding the
  no-raw-colour and Tailwind name-parity tests. None of it is required for the inversion to hold.
