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
