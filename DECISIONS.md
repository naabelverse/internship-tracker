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

---

## The consolidation closes — checkpoints 2-4 of the structural fix

- **`brandPalette.mjs` stopped being a parser and became a mapping.** It read `src/index.css`
  through a `BLOCK_RE`/`CHANNELS_RE` pair of its own, because the stylesheet was the only place the
  values existed. It is not any more, so the regexes are gone and `themeTokens.mjs` — documented as
  "the one reader of the canonical palette" — is what reads. What is left in the file is
  `SOURCE_TOKENS`, the mapping from a drawn element to the token it takes its colour from, which
  was always its actual subject. This is the side of the line checkpoint 1 drew: a consumer that
  _derives_ a value reads `tokens.json`, a gate that _verifies a shipped artifact_ keeps reading
  the artifact.

- **The `readBrandPalette(css)` test case was rewritten to inject JSON, deliberately and not
  silently.** Checkpoint 1's entry flagged this as the one case that could not simply be carried
  over. The assertion is unchanged in every respect that matters — it still drives the reader with
  a palette missing `--color-primary`, and still requires a throw naming that token rather than a
  default. Only the injected source format moved, from a CSS block to the token file's shape,
  because that is what the reader now takes. Recorded here because a test whose input changes
  during a refactor is exactly where an assertion gets quietly weakened, and the way to stop that
  is to say what changed.

- **That test got stronger as a side effect, which is worth stating because it was not the goal.**
  It compares `readBrandPalette` against `readThemeTokens`, the contrast suite's independent CSS
  parser. Those two now read genuinely different files — the token file and the shipped stylesheet
  — where before they both read `index.css`. #7 records writing a drift check that was "close to
  worthless" because both sides read one file and always agreed; this comparison has stopped being
  that.

- **`generateMailPalette.mjs` did need an edit, and the honest answer is narrower than either "yes"
  or "no".** Checkpoint 1 recorded that it already imports the client's reader rather than defining
  one, and that is correct — confirmed by reading the file, not by trusting the note. Its _logic_
  therefore needed nothing: it already derived rather than copied. But it imported
  `readThemeChannels` **from `brandPalette.mjs`**, and checkpoint 2 moved that reader out, so the
  import had to be retargeted at `themeTokens.mjs`. Its documentation also claimed it generates
  from "the light theme block of `client/src/index.css`", which stopped being true.

- **A re-export shim was considered and rejected.** Leaving `brandPalette.mjs` re-exporting
  `readThemeChannels` would have made "the mail generator needs no change" literally true, at the
  cost of a module about brand assets exporting a reader it no longer owns, and a docstring in the
  server workspace describing a mechanism that no longer exists. That is optimising the report
  rather than the code. One import line moved instead.

- **The third copy of `toHex` went with it.** `themeTokens.mjs`, `brandPalette.mjs` and
  `generateMailPalette.mjs` each held the same six-line channels-to-hex function. Checkpoint 2
  removed the second by construction; leaving the third would have been the same unpinned-copies
  arrangement in code that this whole sequence exists to remove from colours. It is imported from
  the one reader now.

- **The nine committed brand assets are byte-identical, and `palette.ts` changed by three comment
  lines.** Both generators were re-run against the rewritten readers and checked with
  `sha256sum -c` against digests taken before any edit: `og-image.png`, `favicon.svg`,
  `favicon.ico`, `favicon-16`, `favicon-32`, `apple-touch-icon`, `icon-192`, `icon-512`,
  `icon-512-maskable`, plus `site.webmanifest` and `index.css`, all unchanged. `palette.ts` differs
  only in its generated header, which now names `tokens.json` as its source rather than
  `index.css`; every non-comment line — which is to say every colour — is identical. Leaving the
  header saying `index.css` would have preserved a clean byte-for-byte claim at the cost of the
  file documenting a mechanism it no longer uses, which is the trade the previous entry refused.

- **The no-raw-colour gate scans `index.css` rather than skipping it, and that is the deciding
  detail.** "Outside the token file and its generated output" could have meant excluding the
  stylesheet as an output. Only its two theme blocks are generated, though; roughly 62% of the file
  is hand-written `@layer` CSS that no palette can produce, and that is precisely where someone
  would type a colour by hand. The two blocks are blanked — keeping their length and their
  newlines, so reported line numbers stay true — and the rest is scanned.

- **Comments are stripped by a character walk, not a regex, and the file is not exempted.** The
  requirement was that the historical `#4f46e5` documented in `server/src/mail/layout.ts` stay
  readable while a _real_ hex in that same file still fails. A regex for `//` would eat the tail of
  any line holding an `https://` URL and could hide a colour after one, so the walk tracks string
  state instead. Demonstrated rather than assumed: a hex appended to `layout.ts` as code is
  reported at its line, while the one in the comment at line 60 is not.

- **The triplet pattern requires the literal to hold nothing but three integers.** A first attempt
  matched any three space-separated numbers in range and returned 26 false positives from
  `icons.tsx` alone — SVG path data and `viewBox="0 0 24 24"` are full of three-number runs.
  `tokens.json` stores colours as exactly three channels and nothing else, so that is the shape a
  hand-copy takes, and requiring the whole string to be it separates the two cleanly.

- **Two allowlist entries, both exact `(file, literal)` pairs, and the list must be fully
  consumed.** `chartTheme.ts`'s `FALLBACK = '148 163 184'` is allowlisted for the reason checkpoint
  1 logged: it is a "the stylesheet did not load" sentinel, and drawing it from the palette would
  make that failure paint in brand colours and become invisible. `index.css`'s `#000` is a second
  entry the scan itself surfaced — the opaque stop of a `mask-image` gradient, where only the alpha
  channel is read. Entries are pairs rather than whole-file exclusions, and a stale entry fails the
  suite, because an allowlist that can silently grow is the one way a gate like this dies.

- **The gate caught a real violation on its first run, which is the strongest evidence it works.**
  `main.tsx` set the toast icon glyph to `#fff` twice, four lines under a comment reading "Tokens
  rather than literals, so toasts follow the theme toggle". It was also a latent contrast bug
  rather than merely a style violation: `secondary` is the glyph punched out of the icon disc, and
  the dark theme's success and danger are a light green and a light red, on which a white tick is
  close to unreadable. `--color-surface` is used for both now — the card the disc sits on, so the
  glyph reads as a hole through it and follows the theme. Adding a `--color-success-fg` token to
  match the existing `--color-danger-fg` was considered and rejected as a palette change well
  outside this work.

- **The Tailwind parity check walks the whole config, not `theme.extend.colors`.** Three of the
  colour tokens are not in that block: `--color-ring` is surfaced through `ringColor`, and
  `--color-shadow` and the `--atmos-*` values appear inside `boxShadow` strings. A check scoped to
  `colors` would have reported all of them as unreferenced and been wrong about every one. It reads
  the imported config object rather than the file's text, so a token named only in a comment cannot
  count as a reference.

- **Its second direction is scoped to `color-*` deliberately.** Every colour token must be
  reachable from a class name, because a colour in the palette that no utility exposes is what
  invites the hand-written literal the other new gate rejects. The `--atmos-*` layer is not held to
  that: it is consumed by hand-written `@layer` CSS in `index.css` rather than by utilities, so
  requiring a Tailwind key for each would assert something that was never meant to be true.

- **Light/dark name parity is asserted here because nothing else asserted it.**
  `themeTokens.test.ts` checks that every token a theme declares reaches the stylesheet, which does
  not catch a token present in light and absent from dark. That is a utility that works until the
  user hits the theme toggle.

- **Both gates were shown failing on real breakage before either was trusted.** A hex and a channel
  triplet appended to `NotFoundPage.tsx` and a hex appended to `layout.ts` are reported together
  with file, line and literal; a `ghost: token('color-ghost')` key added to the Tailwind config
  fails both themes naming `--color-ghost`; a `color-ghost` token added to `tokens.json` with no
  Tailwind key fails the other direction. The comment stripper is separately unit-tested in both
  directions, because it decides what the scan can see and an over-reaching stripper would make
  every future run pass. All four files were restored from checksummed copies rather than with
  `git checkout`, which would have destroyed the untracked work beside them, and the digests match.

- **Four client tests fail under machine load and are not a regression.** A full `npm run verify`
  taken before any edit reported 16 failures; the same suite on a quieter machine reported 4, and
  each of those four passes in isolation — `deleteAccountFriction` runs in 6.9 s alone against the
  10 s async budget it exceeded under contention. Phase 15 already records this failure mode and
  the `maxWorkers` cap that addressed it. Recorded so the next session does not mistake a loaded
  machine for broken code, and does not "fix" it by widening a timeout.

---

## A structural polish pass, from the UI-UX Pro Max audit — category A

- **The audit existed because two redesigns had already been reverted without one.** Both prior
  attempts were explored and rolled back at real cost, and neither had a specific complaint to work
  from. This pass started from an itemised list with a file and a line against every item, split
  into what is safe (spacing, radius, motion), what touches colour, and what would need a new
  dependency. Only the first was implemented.

- **Category B was deliberately not touched, and that is the point of having categorised.** Two
  items would have changed a colour or a contrast ratio: `Button`'s `disabled:opacity-60`, which
  sits outside the 0.38-0.5 band the guidelines specify, and its `danger` variant dimming by
  `hover:opacity-90` where the other three swap a token. Both are real. Neither is worth
  re-opening a palette that went through several rounds of WCAG verification for a "looks nicer"
  argument. `tests/a11y/tokenContrast.test.ts` ran green — 116 assertions — after every one of the
  six changes, and nothing in this pass reads or writes a token value.

- **Category C was empty, and reporting it empty was the useful result.** The audit was run partly
  to decide whether 21st MCP was needed. It is not connected, it needs a paid membership and an
  API key, and no finding required it. The one thing that looked like a component dependency —
  a shared card — is ten lines wrapping classes the repo already had. Importing a third-party card
  to replace fifteen copies of one Tailwind string would have added a dependency to solve a
  problem a local component solves better.

- **The audit undercounted three of its own findings, and the corrections are recorded because the
  method that produced them is the point.** The card recipe was reported at 4 call sites and is 15.
  The missing-transition list was reported at 17 and is 10. The bare-`rounded` count was reported
  at 18 and is 10. The first came from generalising off six hand-picked files; the second from a
  line-based scan that could not see a `transition-colors` sitting in a `cn()` base string beside
  the `hover:` fragment it flagged; the third from a tabulation script that counted some lines
  twice. Every candidate was verified against the source before being touched, which is what
  turned up eight false positives — `Button`, `Sidebar:18`, `ThemeToggle:68`, `MonthGrid:64`,
  `TimelineChart:101` among them — that would otherwise have been "fixed" by adding a duplicate
  class.

- **Fifteen copies of the card surface, six padding values, one definition now.** `rounded-card
border border-border bg-surface` was written out at fifteen call sites carrying `p-2`, `p-3`,
  `p-4`, `p-4 sm:p-5`, `p-5`, `p-6` and, twice, nothing. This is the unpinned-copies arrangement
  the palette work spent four fixes closing, in surface styling rather than in colour: a change to
  one copy left the rest behind, and a new card started from whichever copy its author opened.

- **Twelve went onto `Card`; three kept the surface as a string, for structural reasons rather
  than stylistic ones.** `SettingsSection` applies it to a `<form>` it owns for submit handling,
  which a wrapper cannot take over without owning the form. `Popover` is a floating overlay with
  its own stacking context and `shadow-float`. `BoardCard` is draggable and swaps to a `ring-2`
  treatment mid-drag, so its surface is state-dependent in a way the padding scale does not
  describe. Forcing those three into `Card` would have made the count tidier while describing them
  wrongly — a false consolidation. Sharing `cardSurface` keeps one definition of the part that was
  actually drifting.

- **`p-4 sm:p-5` is the standard because three components had already converged on it
  independently.** `UpcomingPanel`, `ActivityHeatmap` and `ChartFrame` all used it without
  reference to each other, which is better evidence of the intended value than picking one.
  `StatCard` moved up to it, which was the original finding: on the same dashboard grid its cards
  sat at 16px while the panels beside them sat at 20px. `DetailHeader` moved down from a flat
  `p-5`, and `ErrorBoundary` from `p-6` — both joined the scale rather than sitting one step off
  it. `ApplicationCardList` keeps `p-4` as `compact`, because a repeated list row reads loose at
  the panel step-up, and the table and month grid take `none` so their rules meet both borders.

- **The missing transitions were not a pattern, which is why the guess about them was wrong.** The
  audit proposed that icon-buttons had been given `transition-colors` and text links missed. The
  verification pass disproved it: `Sidebar:67` and `Topbar:34` are icon-buttons without one. There
  was no rule, only ten places where it had not been typed. All ten now have it.

- **Bare `rounded` is byte-identical to `rounded-chip`, so ten call sites changed name and nothing
  else.** Tailwind's default `rounded` is `0.25rem` and the scale's `chip` tier is `0.25rem`. The
  scale had four tiers and `chip` was used by name zero times, while ten elements reached past the
  scale for a value identical to it. Nothing renders differently; the tier is no longer dead, and
  the config comment that says components "reach for one of these" is now true.

- **The two arbitrary radii were within half a pixel of a tier they could have named.**
  `rounded-[0.4rem]` against `rounded-control`'s `0.375rem` is a 0.4px difference — invisible, and
  therefore off-scale for nothing. The heatmap's `rounded-[3px]` moves 1px to `chip` on a 12px
  cell. No arbitrary radius remains anywhere in `client/src`.

- **Motion got a scale for the same reason the radii have one, and setting `DEFAULT` is what made
  it free.** Every transition was inheriting Tailwind's built-ins, so the timing was consistent by
  accident rather than by decision: 26 call sites took 150ms and `cubic-bezier(0.4, 0, 0.2, 1)`
  without naming either, while the two that wanted something else wrote bare numbers that recorded
  nothing about what they meant. In Tailwind v3 the `transition-*` utilities read
  `transitionDuration.DEFAULT` and `transitionTimingFunction.DEFAULT`, so naming those tokenised
  every existing call site without editing one of them.

- **The easing default changed, and it is the one change in this pass with a feel to it.** The
  default moved from Tailwind's symmetric `cubic-bezier(0.4, 0, 0.2, 1)` to
  `cubic-bezier(0.2, 0, 0, 1)`. A state change should leave immediately and settle at the end;
  easing into the start delays the feedback the user is waiting for, which is why both Material and
  the HIG specify decelerate for state transitions. It is one line rather than thirty-six, and it
  is timing rather than colour, so it stayed inside the safe category — but it was flagged before
  it was made rather than slipped in with the renames.

- **The tool that produced the audit is scoped to app UI, and most of its checklist did not
  apply.** UI-UX Pro Max states its stack as React Native and marks its own rules as "App UI, not
  desktop-web interaction patterns". Its safe-area, haptics, bottom-navigation and 44pt
  touch-target sections describe a platform this product is not on. What transferred was the
  general material: spacing rhythm, state clarity, motion timing and easing, icon and radius
  consistency. Recorded so the next person does not take the unfiltered checklist as a to-do list.

---

## Category B resolved, and the tokenised motion checked against the clock

- **The premise of the disabled-opacity item turned out to be backwards, and that is the finding.**
  The audit flagged `disabled:opacity-60` as outside the 0.38-0.5 band the guidelines specify, with
  the implication that moving into the band was a contrast improvement. It is the opposite. CSS
  opacity composites the label _and_ the fill toward whatever is behind them, so every value in the
  band measures worse than the 0.60 it replaces: on the light canvas the primary button's label
  goes from 3.26:1 at 0.6 to 2.60:1 at 0.5 and 2.04:1 at 0.38. Measured for both variants on both
  surfaces in both themes before choosing.

- **0.5 was chosen: the top of the band, so the smallest reduction that satisfies it.** The change
  is defensible because the requirement being served is not legibility. WCAG 2.2 exempts inactive
  components from contrast entirely — SC 1.4.3 excludes "text that is part of an inactive user
  interface component" — which is also why `tokenContrast.test.ts` never had an assertion here to
  break. What a disabled control owes the user is the unmistakable signal that it will not respond,
  and `disabled:cursor-not-allowed` already carries that a second way. Recorded rather than quietly
  applied, because a change that lowers a measured ratio should never look like an oversight later.

- **The danger hover derives from the step the primary already uses, measured rather than guessed.**
  `primary-fill` to `primary-fill-hover` is -8.24pp of HSL lightness in light and -8.04pp in dark —
  the same move in both themes. Applying that -8pp step to `danger` gives `133 23 14` in light and
  `255 94 78` in dark, which is what `--color-danger-hover` now holds.

- **The dark theme is why this had to be measured and not reasoned about.** In light, `danger` is a
  deep red under white text, so darkening it on hover can only raise contrast. In dark it is a
  _light_ red (`255 131 119`) carrying near-black text (`42 10 6`), so the same darkening step moves
  the fill toward its own foreground. It survives — `danger-fg` on `danger-hover` measures 6.08:1,
  against 9.88:1 in light — but the direction of the effect is opposite in the two themes, and
  assuming "darker is safer" would have been wrong reasoning that happened to reach a passing
  answer.

- **Both hover values beat the mechanism they replace.** `hover:opacity-90` composited over the
  canvas produced 6.16:1 in light and 6.42:1 in dark. The token swap gives 9.88:1 and 6.08:1 — and
  more to the point it is the same mechanism the other three variants use, so the danger button is
  no longer the one that dims the whole element while its siblings swap a colour.

- **The measurements were encoded as assertions rather than left in a commit message.**
  `tokenContrast.test.ts` goes from 116 to 124: `danger-fg` on `danger-hover` clears AA in both
  themes, and `danger-hover` clears the non-text ratio against every surface so the button stays
  visible as a shape while hovered. A ratio quoted in prose is a claim; a ratio in the suite is a
  gate.

- **The token went through `tokens.json`, not into a component.** Adding `--color-danger-hover` to
  the canonical palette and regenerating `index.css` is what the drift work exists for, and the
  Tailwind name-parity gate then _required_ the matching `danger-hover` key rather than leaving it
  optional. `server/src/mail/palette.ts` regenerated byte-identical, which confirms the new token
  reaches only the consumers that ask for it.

- **The goal ring was verified against the clock, and 700ms is not as slow as the number reads.**
  Sampling `stroke-dashoffset` through the transition with the shipped stylesheet: 23% complete at
  72ms, 58% at 155ms, 89% at 354ms, 97% at 504ms, settled at 704ms. Linear would be at 22% by
  155ms, so the curve is doing what `cubic-bezier(0.2, 0, 0, 1)` promises — it is ~87% at the
  halfway mark by construction, and the measurement matches. The perceptual result is that the arc
  arrives in about a third of a second and the remaining 300ms is a settle, which is why a duration
  that looks sluggish written down does not feel sluggish.

- **The sidebar drawer is still not visually verified, and is recorded as such.** Its computed style
  is confirmed correct — `0.2s`, `cubic-bezier(0.2, 0, 0, 1)`, on `transform` — so the tokens reach
  it. The motion itself was not observed: the Docker daemon is down so the app shell, which sits
  behind auth and therefore needs the API, could not be reached, and an isolated harness failed to
  drive the class toggle across three attempts. The arithmetic says it should be ~87% open at 100ms
  of its 200ms, but arithmetic is not observation and this entry does not claim otherwise.

- **A note on the local suite, repeating a warning already in this file.** `npm run verify` failed
  twice here with 13 and then 8 client failures, on a _different_ set of files each time, every one
  of them an "unable to find" timeout. All eight pass in isolation, no test references the classes
  that changed, and the client suite passes 470/470 when nothing else runs. The first of those runs
  was made worse by Playwright running concurrently with it, which was avoidable. A shifting failure
  set is the signature of contention; a regression from a class change would fail the same tests
  every time.

## The composition layer gets the treatment the palette already had

The request was a full redesign, driven by hallmark and the UI-UX Pro Max skill. It was not
taken, and the reason is measurement rather than reluctance. The tells that would justify a
redesign were counted first, and the colour layer does not have them: one hand-written hex in
`client/src` and it sits inside a comment explaining its own removal, no `console.log`, five
arbitrary values all in `rem` and all legitimate sizing, three inline styles all genuinely
dynamic, a three-size body scale, and five tests already refusing drift. What the count did
find was a different layer entirely, so that is what was fixed.

- **The page header was the real finding.** Nine call sites used the page-title type, and the
  five that were genuinely page headers assembled it five different ways. The lede carried
  `mt-0.5` on Dashboard and Settings and no top margin on Applications, Board and Calendar —
  one role at two spacings, settled by whichever file was opened last. Applications also
  carried `flex flex-wrap items-center justify-between gap-3` around a single child, copied
  from a page that has an action button, where `justify-between` has nothing to distribute.

- **`mt-0.5` is the resolved value, not the majority value.** It was on two of the five. It
  wins because `display-sm` sets a 1.18 line height, which is tight enough that the lede needs
  the optical gap, and because the two pages carrying it were the two most recently worked on.

- **`PageHeader` covers five pages and deliberately leaves four alone.** `ErrorBoundary`,
  `NotFoundPage`, `AuthSplitLayout` and `DetailHeader` all use the page-title type without
  being routed-page headers: two are centred crash screens with their own top margins, one is
  an auth panel title, one is a record title followed by a role rather than a lede. Pulling
  them in would be the false consolidation `Card` already declined to make for its own three
  exceptions — a tidier count that describes them wrongly.

- **Two composites became CSS, not components.** `.panel-title` (six `h2` sites) and
  `.marketing-shell` (seven container sites) are pure compositions of utilities with no
  behaviour and no structure, so they follow `.skeleton` into `@layer components` rather than
  becoming wrappers. `PageHeader` and `FormError` are components because they own structure
  and a conditional.

- **`accentColor.primary` went into the Tailwind theme.** Seven checkboxes spelled
  `accent-[rgb(var(--color-primary))]` by hand. That resolves the right colour, which is why
  `noRawColour` never saw it, but as an arbitrary value it sat outside the theme and therefore
  outside the name parity `tailwindTokens.test.ts` enforces. A token spelled by hand at seven
  sites is the same shape of drift the palette work spent four fixes closing.

- **`FormError` takes a message, not a react-hook-form error.** Four forms rendered
  `errors.root` through an identical `role="alert"` element behind an identical
  `{errors.root && ...}` guard, so the guard and the markup drifted as a pair. Taking a string
  and returning `null` on an absent one moves the guard inside the component and keeps it
  usable by anything with a message. `VerificationBanner` shares two of the same utilities for
  its expired state and was left alone: it is a banner in `text-content`, not a form error.

- **Two high-count patterns were deliberately not named.** `text-sm text-content-muted` (13
  sites) and `text-xs text-content-subtle` (12) were the two most repeated strings in the
  client, which is what made them look like the finding. Reading the call sites showed they
  are not one role: four of the muted ones are the page lede, now owned by `PageHeader`, and
  the rest are ordinary secondary copy in dialogs, panels and empty states. Naming the
  remainder would be abstraction with no role behind it.

- **`DESIGN_SYSTEM.md` is new, and every value in it was transcribed from source.** The colour
  tables come from `tokens.json`, the scales from `tailwind.config.ts`, and the gate thresholds
  from `tokenContrast.test.ts` rather than from the SPEC, so the document describes what the
  code does rather than what was once intended.

- **One of the four over-length files fixed itself.** `ApplicationFormModal` dropped under the
  250-line convention as a side effect of `FormError`. `ApplicationsToolbar` (261),
  `ApplicationsPage` (257) and `useApplicationMutations` (254) are still over it. All three are
  in the applications feature, which is the actual signal, and splitting them is a refactor
  with its own risk rather than something to attach to a styling pass.

## Blue-ground redesign (11 Sep 2026)

A supplied shadcn-style reference — `#a6c4e8` light background, `#141d2b` dark, neutral
near-black primary — replaced the violet "Dispatch" direction. What follows is what the
measurement changed about it, since almost none of the reference shipped verbatim.

- **The reference's page background is not the canvas.** This is the whole decision. A pill
  is `bg-<token>/15 text-<token>`, and the gate checks every semantic against its own 15%
  tint on `canvas`, `surface` and `surface-muted`. On `#a6c4e8` the tint sits so close to
  the token that clearing 4.5:1 forces `success` to `#004d00`, `warning` to `#6c3000`,
  `danger` to `#830003` and `info` to `#00399a` — 1.86:1 to 1.95:1 from body text, which
  stops the status system reading as colour on a product where status is the content.
  Sweeping canvas lightness showed vivid semantics only survive again at L≈0.94. So
  `--color-canvas` is `#d5edff` and the reference's blue became `--color-wash`.

- **`--color-wash` is painted on the auth split screen and nowhere else.** It is gated for
  body text but deliberately excluded from the pill-tint assertions, and that exclusion is
  structural rather than an exemption: neither call site renders a status pill.

- **The marketing hero was tried on the wash and reverted.** In dark mode the lamp at 0.2
  over a wash blue enough to read apart from the canvas lifts the ground to `rgb(36 60 102)`,
  where `text-subtle` measures 3.83:1. Clearing 4.5 there needs `text-subtle` lighter than
  `text-muted` — inverting the hierarchy — or lightening all dark secondary text on every
  screen to suit one decorative section. The hero kept its canvas-based atmosphere.

- **The reference is not a blue theme.** Its `--primary` is `#101723` light and `#d7dfe5`
  dark: neutral. The only saturated blue is the page ground and one `--sidebar-primary`.
  That is why it clears the hue-collision constraint the violet direction was built around —
  a neutral accent occupies no hue, so blue never competes with `info`/_Applied_.

- **The chart series was rebuilt, not adopted.** The reference supplies five entries at
  OKLCH hues 252–266 — a 14° sequential ramp with adjacent pairs at 1.31–1.37:1, and its
  lightest fails the gate at 1.75:1 on a card. The app needs eight mutually distinguishable
  categorical colours. The replacement spreads eight hues with the eighth a low-chroma
  slate, closest pair 64 rgb-units in light and 63 in dark.

- **Both CSS blocks supplied were byte-identical.** The "night version" and the "light
  theme" were the same file, each containing `:root` and `.dark`. Nothing was lost; there
  was simply only ever one theme to reconcile.

- **The reference's own light screenshot did not match its light CSS**, showing periwinkle
  inputs and secondary buttons where the CSS gives `#e7edf6` and `#d8dfe9`, both near-white,
  and `--accent` at alpha 0. The CSS was treated as authoritative.

- **`primary` and `primary-fill` now hold the same value per theme.** The split existed
  because a violet fill dark enough for white text was unreadable as text. A neutral accent
  has no such conflict. The tokens are kept apart because the gate measures `primary-fill`
  separately, and collapsing them would delete those assertions.

- **A comment inside a generated token block broke the mail palette.** `readToken` in the
  server suite splits a block on `;` then `:`, so an explanatory comment containing `1.9:1`,
  placed before the first declaration, hid `--color-canvas` from it. The comment moved to
  the hand-written section above `:root`, and `index.css` now records the trap. The parser
  was left alone: it fails loudly, which is how this was caught in the first place.

- **One pinned test literal was updated by hand, deliberately.** `chartTheme.test.ts` pins a
  concrete `color-primary` per theme so its "reads from the shipped tokens" assertion cannot
  pass with both sides equally wrong. Its own comment says it must be updated whenever the
  palette changes; it now pins `rgb(16 23 35)` and `rgb(215 223 229)`. No assertion was
  relaxed anywhere in this work — `tokenContrast.test.ts` gained six.

### Hero atmosphere retune (11 Sep 2026)

Follow-up to the blue-ground redesign, after the landing hero read too pale against the
presence the blue has on the auth split screen.

- **Lowering the lamp's peak alpha was the requested fix and would have done nothing.**
  `--atmos-light` was `233 244 255` against a canvas of `213 237 255` — 20/255 lighter.
  Dropping its alpha from 1 to 0 moved the hero top by 4/255. The white vertical grade at
  0.38 was doing the washing out, not the lamp. Measured before changing anything, which is
  what stopped a no-op shipping as a fix.

- **The lamp is tinted to the wash blue rather than dimmed.** `166 196 232` at 0.7, with the
  grade down to 0.05. The lamp now adds blue instead of removing it, resolving to
  `rgb(180 208 239)` at peak against the auth screen's `166 196 232`.

- **This reverses an invariant, deliberately and on the record.** The atmosphere could
  previously only lift a pale canvas toward white or deepen a near-black one toward black,
  so it could never reach a background the gate had not already checked — a property, not a
  coincidence. A blue lamp deepens the light canvas, so that no longer holds by
  construction. It holds by measurement: `content-subtle` is 5.33:1 on the lamp and 7.08:1
  on the grade, and `tokenContrast.test.ts` passes 130/130. The note is carried in both
  `tokens.json` and `DESIGN_SYSTEM.md` so the next editor of this layer meets it.

- **Dark was left alone because it is already at its ceiling.** There the lamp is the only
  thing putting blue on a near-black canvas, so lowering it removes what it gives. Raising
  it fails: `text-subtle` is 4.61:1 at the shipped 0.20 peak and 4.14:1 by 0.28. The dark
  hero is unchanged, and that is a measured limit rather than an oversight.

- **Scope was checked before editing.** `.atmos-field` is applied only to the hero section,
  and `--atmos-light` / `--atmos-deep` are consumed only inside its `::before`, so nothing
  else in the app moves. `.atmos-lit`, which the hero panel and `Modal` share, reads
  `--atmos-glaze` and was not touched.

### Hero grade seam (11 Sep 2026)

- **The hero and the section under it painted different colours in dark, and matched in
  light.** One declaration, opposite outcomes: the grade ran from full `--atmos-deep-peak`
  at the axis's first edge, and the two themes point that axis opposite ways. Light's
  `to bottom` put the grade at the top, away from the boundary. Dark's `to top` put it
  directly on it, so the hero ended at `#0c1119` against the next section's `#141d2b`.

- **The palette redesign did not cause it but doubled it.** The dark grade tokens are
  unchanged — `0 0 0`, `0.42`, `to top`. Only the canvas moved, and 42% black takes 9/255
  off the old near-black `#0b1315` against 18/255 off `#141d2b`, which is the difference
  between a seam nobody noticed and one visible across the page.

- **Fixed by fading the grade at both ends rather than by lowering the peak.** Lowering it
  would have shrunk one instance of the bug while leaving the mechanism; flipping dark's
  axis would only have relocated the seam to the header boundary. With both ends at zero
  alpha the element composites to exactly `--color-canvas` wherever it meets another
  section, for any axis and any peak. Dark keeps its full 0.42, now reached at 10% instead
  of 0%. Measured after: both edges 1.000:1, with the grade still reaching `#0c121b`.

- **The gate asserts the gradient's shape, not the seam's size.** A ratio assertion would go
  green the moment somebody lowered the peak to hide the symptom — the fix this deliberately
  declined. The three new cases check that the end stops are transparent and that
  `--atmos-deep-peak` is still referenced, so depth cannot be quietly traded for flatness.
  Confirmed non-vacuous: reverting the gradient to its previous form fails the suite.

- **Nothing else could have caught this.** Every other assertion in `tokenContrast.test.ts`
  measures a colour against another colour, and both sides of this defect were individually
  fine — the hero was legible, the next section was legible, they simply did not match.

### Theme toggle: sliding thumb and the radio-group keyboard pattern (11 Sep 2026)

- **Two of the four reported defects did not reproduce, and were not "fixed".** The report
  described an invisible active state and a heavier sun icon. Measured with the gate's own
  helpers, the selected thumb sits at 17.45:1 light / 11.48:1 dark against its container,
  and every version of the file ever on `main` painted a solid fill there. The three icons
  share one 1.75 stroke, and rasterised ink coverage is sun 15.6 %, moon 18.1 %, monitor
  21.4 % — the sun has the least. The likeliest reading is a downscaled screenshot in which
  the black block behind the white sun reads as a bold sun. Icons are untouched.

- **The container boundary stays under 3:1, on purpose.** `border` measured 1.11–1.39:1 on
  the three grounds the control sits on (surface, canvas, wash); `border-strong` — the
  checkbox precedent — measures 1.72–2.15:1. No existing token reaches 3:1 as a group outline
  on all three, and WCAG 1.4.11 does not require one when the members are identifiable on
  their own: idle icons 8.22 / 5.40, thumb 17 / 11. A new token chasing 3:1 on a group
  boundary was considered and declined.

- **The iOS-style raised thumb was disqualified before any code.** `surface` on
  `surface-muted` measures 1.14 / 1.11, well under the gate's 3:1 shape floor, so the solid
  `primary-fill` thumb stays and slides instead.

- **Hover is an opacity modifier, not a token.** `hover:bg-content/10` is the pattern the
  status pills already use (`bg-<token>/15`); it measures 1.24 / 1.32 against the container
  where `surface-muted` measured 1.14 / 1.11, and leaves the idle icon at 6.63 / 4.09.

- **The accessible names stay `Light theme` / `Dark theme` / `Match system theme`.** They are
  queried by three test files and the screenshot script, and "Match system theme" tells a
  screen-reader user more than "System" would.

- **Roving `tabIndex` and arrow keys complete the APG radio group.** Three separate Tab stops
  cost three presses to cross the header, and `role="radio"` promises arrow-key behaviour.
  Both cases are tested; a focused-but-unselected radio no longer exists, since focus and
  selection move together.

## Status legend palette — one token per status, Ghosted drawn hollow (21 Sep 2026)

- **Two status-colour maps existed and had drifted.** `STATUS_CONFIG` painted pills and dots;
  `chartTokens.ts` carried a second `STATUS_TOKENS` map for the doughnut. They agreed on six
  statuses and disagreed on Ghosted and Withdrawn: the dot was `border-strong` (pale grey-blue)
  while the chart read `chart-5` and `chart-6`. The split was deliberate — the earlier decision
  reads "separate chart tokens, because two identical slices would be unreadable" — and issue #4
  then changed `chart-5`/`chart-6` underneath it, so the doughnut painted Ghosted amber (ΔE 3.3
  from Interview in dark) and Withdrawn green (ΔE 0.9 from Offer under protan) while every pill
  stayed grey. Measured against `HEAD`: ΔE 25–46 between a status's dot and its slice. The second
  map is deleted; `readChartPalette().statusColor` reads `STATUS_CONFIG[status].token`, and
  `tests/config/statusConfig.test.ts` asserts each status's classes name that same token and that
  the token is in the chart's `TOKENS` list (an unknown token there falls back to a sentinel grey
  silently). The decision that the legend "paints its swatch inline so it cannot drift" is
  superseded: the swatch is the shared `StatusDot`.

- **Ghosted and Withdrawn were the same token, and both failed the non-text floor.** Both dots
  were `bg-border-strong` — rgb `159 176 198` light, `58 74 96` dark, ΔE 0.0 — a hairline colour
  doing duty as a filled disc at 1.83 / 2.15 / 1.88 : 1 on canvas / surface / surface-muted in
  light and 1.88 / 1.72 / 1.54 in dark, against a 3:1 floor. Saved, Ghosted and Withdrawn pills
  all sat on the same neutral `bg-surface-muted`, differing only by text token. Nothing compared
  one status with another, only each with its background — the gap that let the series duplicate
  ship in issue #4.

- **The report that "Saved and Ghosted are indistinguishable" needed a correction.** They were
  the same hue family — near-achromatic cool greys, OKLCH hue 251° and 255°, chroma 0.02–0.04 —
  but not close in colour distance: ΔE 33 light / 28 dark, a dark grey beside a light grey. What
  made them read as one was that Ghosted's dot failed 3:1 and barely registered as a mark, and
  that both were categorically grey, as were Assessment (`primary`, near-black since the
  blue-ground redesign) and Withdrawn. By raw ΔE the old greys were further apart than the new
  palette; the new palette wins on hue category, on the contrast floor, and on shape.

- **Four tokens, not eight.** Applied, Interview, Offer and Rejected keep `info`, `warning`,
  `success` and `danger`: those statuses mean the semantic, and `Hero.tsx` says so in copy —
  "Amber is the only colour that means hurry" — with urgent rows painted `text-warning`. Issue
  #4's rule against semantic reuse was for categorical series, whose only job is to differ;
  duplicating semantic values into `status-*` tokens would create exactly the drift this closes.
  Saved, Assessment, Ghosted and Withdrawn had nothing to borrow and get `color-status-*` tokens
  through `tokens.json` → `generate:theme` → `index.css` → `tailwind.config.ts`.

- **Values.** Light: saved `91 91 91`, assessment `119 61 161`, ghosted `43 78 122`, withdrawn
  `104 67 48`. Dark: `171 171 171`, `201 157 228`, `163 196 234`, `221 185 159`. Saved is a true
  neutral (equal channels, so the pin `R = G = B` cannot drift); Ghosted is a cool slate at
  OKLCH chroma 0.084 light / 0.065 dark, about twice a Tailwind slate, because a grey and a
  grey-blue at equal chroma read as one colour at six pixels. All eight sit in the family's
  lightness band (light L 0.42–0.48, dark 0.74–0.83). The values were re-checked in this session
  by a coordinate-descent search from them under the gate's own constraints, scoring the worst
  pair under normal, protan and deutan vision; Saved, Assessment and Ghosted did not move in
  light. Gate results, both themes: every dot ≥ 5.62:1 on the three surfaces and on the hero's
  lit and glazed grounds; every pill's text ≥ 4.53:1 against its own 15 % tint on every surface
  (the 4.53 is Rejected on dark surface-muted, pre-existing).

- **Withdrawn stays the clearer brown, deliberately.** A sweep of the brown/taupe window showed
  the value's weak neighbours under colour-vision deficiency are Offer under deutan (ΔE 2.3
  light) and Rejected under protan (3.5). A lower-chroma taupe (`91 65 55` / `226 195 183`)
  lifts those to 4.9 / 4.9 in light but stays below the 6.0 CVD floor, so it crosses no
  threshold, and at chroma 0.04 it reads as a warm grey — a fourth grey again. Kept at chroma
  0.06, in band. Brown is inherently squeezed between Rejected (h 30°), Interview (h 59°) and
  Offer-under-deutan; its one lever is chroma, which pulls it toward Saved.

- **Ghosted is the one hollow dot, and why that is enough.** Eight statuses pinned to one
  lightness band cannot all clear the categorical floor of ΔE 15: the closest new pairs are
  Saved/Withdrawn (7.8 light, 8.8 dark, normal vision), Withdrawn/Interview (7.1 light) and
  Ghosted/Applied (7.2 dark), and purple/blue collapses under deutan (Assessment/Applied 4.6
  dark). The weakest CVD pairs of all are among the fixed semantics — Interview/Rejected deutan
  1.6 light, Offer/Rejected deutan 2.6 dark — and were not touched. So the pair that was broken
  gets a signal a colour-blind reader keeps: `StatusDot` draws Ghosted as a ring, 2 px at
  8–10 px and 1 px at 6 px so the hole survives, and every other status as a disc; the component
  test pins that exactly one status is hollow. The doughnut slice stays solid — a slice cannot
  be hollow — with its label and the `sr-only` table as the text alternative. Every site pairs
  the dot with its label as text, and `StatusDot` is `aria-hidden`.

- **The hollow marker exposed a timeline defect.** `ApplicationTimeline` draws its markers over
  a 1 px rail, masked outside the dot by `ring-4 ring-canvas` and inside it by the dot's fill —
  so a transparent ring showed the rail through its hole. The marker now sits in a wrapper that
  paints `bg-surface` under whichever dot it holds. `StatusDot` itself keeps `bg-transparent`:
  on the hero's lit canvas a surface-coloured hole would be a visible pale spot.

- **Saved, Ghosted and Withdrawn pills are tinted now.** All eight are
  `bg-<token>/15 text-<token>`, so the status select in the table, the card list and the detail
  header, and the board's count badge, change from neutral to tinted for those three. Approved
  in review as the consistency "one status, one token" requires.

- **`tokenContrast.test.ts` went from 133 to 249 assertions.** The eight status tokens are read
  from `STATUS_CONFIG` rather than restated; each is gated as pill text (4.5:1 on the card, and
  against its own tint on all three surfaces) and as a dot (3:1 on the three surfaces, the
  glazed panel and the lit canvas); no two statuses may resolve to the same rgb in either theme;
  and Saved-neutral / Ghosted-cool is pinned. `SERIES_TOKENS` and `chart-1…8` are
  byte-identical: the categorical series is a separate system and is not affected.

- **The no-SMTP guard fix (`5973ab5`) is on this branch because `verify` was red on this
  machine first.** The guard asserted `SMTP_HOST` was `undefined` where the loader's own
  definition of unconfigured is unset-or-blank; a `server/.env` copied from the example carries
  `SMTP_HOST=`. Its own commit, before any of the above was touched.

- **Audited after merge (22 Sep 2026) and the residual pairs are accepted as known trade-offs.**
  An independent pass over `main @ 42e3934` recomputed everything from the shipped files: eight
  distinct values in each theme; 48/48 dot measurements at or above 3:1 against card, row and
  canvas (lowest 5.62); and, measured in a browser against the built stylesheet, every rendered
  channel — pill text, pill tint, dot or ring, and the custom property the doughnut reads — equal
  to its token in all sixteen status × theme cells, with the token equal to `tokens.json` and the
  generated `index.css`. Ghosted is the one hollow status at every size. The audit passed.

  Under a strict rule (OKLab ΔE ×100 below 15, or the same hue family at similar weight) 12 of
  28 pairs are flagged in light and 11 in dark. That count is structural — eight statuses held to
  one lightness band so each clears the text and tint gates cannot all be 15 apart — and the pairs
  that carry no signal but colour are, ranked: Interview/Withdrawn light 7.1 (5.8 protan /
  7.3 deutan), amber and brown 12° apart at the same weight; Saved/Withdrawn 7.8 light and
  8.8 dark, neutral against brown by chroma alone; Interview/Rejected light, deutan 1.6, and
  Offer/Withdrawn light, deutan 2.3; Applied/Assessment dark 9.5 (4.3 / 4.6 under CVD). Pairs
  involving Ghosted are flagged by colour but carry the ring, and every dot in the product sits
  beside its label as text.

  None is a regression: each pair is equal to or better than its state before PR #22, when four
  of the eight statuses were greys and two were the same token at 2.15:1, and the worst residual
  (7.1) is a different order of problem from the contrast failure that started the work.
  Withdrawn's clearer brown (`104 67 48` / `221 185 159`) was chosen over the lower-chroma taupe
  (`91 65 55` / `226 195 183`) deliberately: the taupe raises Interview/Withdrawn to 9.9 but reads
  as a fourth grey and crosses no CVD threshold. Moving any of these pairs further needs either
  a second shape cue beyond Ghosted's ring (Withdrawn is the candidate) or a change to the
  semantic tokens themselves, and both are separate design decisions to take in a future session
  only if one of these pairs becomes an actual reported problem.

## "Try the demo" answered 404 in production — the seed was never run against Atlas (22 Sep 2026)

- **The error was the unseeded-deployment path working as designed, not a gate.** `loginAsDemo`
  only ever finds, and `env.ts` defaults both `DEMO_EMAIL` and `DEMO_PASSWORD`, so an unset
  variable on Railway cannot produce `DEMO_UNAVAILABLE`; only an absent, non-demo or soft-deleted
  user document can. Three things pointed at the seed: the Phase 16 "seed against Atlas" item in
  `PROGRESS.md` was unchecked, the local `server/.env` targets `mongodb://127.0.0.1`, and the
  Railway CLI was not installed on the machine every seed was run from. `DEPLOYMENT.md` step 11
  also showed the seed command _without_ the `railway run` prefix that the migration step uses,
  so following it literally seeds localhost; that is fixed, and the go-live checklist gained a
  seed line beside its migrate line.

- **The API now announces the demo account at boot, the way `initMailer` announces the
  transport.** `announceDemoAccount` runs once the database connects and logs either
  `Demo account ready` or a `warn` naming the address and the seed command. It shares its lookup
  with `loginAsDemo` through `findDemoAccount`, so the boot log cannot say "ready" for an account
  the route would refuse, and it never rejects, so a failed lookup cannot turn a healthy boot
  into a shutdown. Chosen over enriching the 404 body because that message is shown verbatim in a
  visitor's toast: "which env var or seed step is missing" is for whoever reads the deploy log,
  not for the person who clicked. The nightly reset job's `info` line on the same condition was
  left as it was; 04:20 UTC at `info` is not where anyone looks first.

- **No production-facing action was taken from the session.** The seed against Atlas is the
  owner's to run (`railway link` then `railway run npm run seed -w server`); `dotenv` 16 does not
  override variables already in the environment, which is why that command reaches Atlas even
  with a local `server/.env` present.

- **Seeded 22 Sep 2026 — and on Windows the SRV string did not resolve.** `railway run` failed
  with `querySrv ECONNREFUSED` against the `mongodb+srv://` URI, so the seed was run through
  `railway shell` with Atlas's standard (non-SRV) connection string instead; anyone running seed
  or migrate commands from a Windows machine against an SRV record should expect the same and
  reach for the standard string. Confirmed: "Try the demo" signs in with 64 applications.

## The auth logo links home (22 Sep 2026)

- **The lockup in `AuthSplitLayout` is a `Link` to `paths.landing`, matching the marketing
  header's logo.** Reported as "the signup page has no way back to the landing page", and it
  held for every page that renders through the layout: the only links on them point at each
  other (`/login` ↔ `/register`, the legal pages from the register form). One `Link` wraps the
  mark and the wordmark rather than either alone, and it is `w-fit` so the target is the lockup,
  not the whole width of the aside the old stretched `<span>` covered.

- **Hover is a token swap to `content-muted` on both halves, not opacity.** Measured on the
  aside's `surface`: hovered text sits at 10.55:1 light / 6.25:1 dark, and the rest→hover step
  is 1.82:1 / 2.07:1. `hover:text-primary` was rejected because the neutral primary is 1.10:1
  from the text token, which is no visible change; `opacity-80` was rejected because
  `tailwind.config.ts` already says hovers swap a colour rather than dim the element, and its
  dark-theme step (1.48:1) is smaller anyway.

- **No `aria-label`.** The wordmark is always rendered wherever the aside is, and the mark is
  `aria-hidden`, so the link's accessible name is already "Internship Tracker" — the same name
  the marketing header's logo announces. A redundant label would only risk the two drifting.

- **The lockup is rendered twice, once per breakpoint, rather than moved.** The aside that
  carries it is `hidden lg:flex`, so the header fix alone left phones — most real visitors —
  with no route home. Flagged at the checkpoint and folded in on the owner's call: the same
  `BrandLink` sits in the form column's top bar opposite the theme toggle, `lg:hidden`, and the
  bar is `justify-between lg:justify-end` so the toggle does not slide left once the copy beside
  it is `display: none`. That column is on the wash, the one saturated ground, so the hover was
  measured there too: `content-muted` on wash is 6.04:1 light / 5.64:1 dark, above the 4.5:1
  the gate applies to body copy on it; the rest→hover step is the same 1.82:1 / 2.07:1 because
  it is between the two text tokens, not against the ground. Two copies over one repositioned
  element because the aside's copy is the top of a `justify-between` column and the bar's copy
  is the left of a row: no single element can occupy both without a portal or a grid the layout
  otherwise has no use for.

## The auth aside's horizontal inset (22 Sep 2026)

- **The imbalance predates the logo fix; it is one mechanism, not two.** Reported as the signup
  page's marketing copy sitting too close to the viewport edge, and raised against PR #24 because
  that PR had just touched the same aside. It did not cause it: the `p-10` on the aside is
  unchanged context in that diff and dates to the blue-palette work, and on the pre-change build
  the lockup, the heading, the list and the footer all began at exactly 40px from the panel edge.
  `BrandLink` shares their column rather than displacing them, so no second fix was needed.

- **`p-10` became `px-16 py-10 xl:px-24` — horizontal only.** The two halves were insetting by
  different mechanisms: the aside by a fixed padding, the form column by `mx-auto max-w-sm`
  centring a 384px block, whose effective inset grows with the viewport (64px at `lg`, 128px at
  1280, 168px at 1440, 288px at 1920) while the aside's stayed at 40px. `px-16` matches that 64px
  exactly where the split first appears, and `xl:px-24` keeps the inset growing. Stock Tailwind
  steps: the theme extends no `spacing` scale, and `xl:` is already in use in `StatCards.tsx`.

- **`py-10` was deliberately left alone, so the vertical rhythm is provably unchanged.** The
  aside is a `justify-between` column, so touching vertical padding would have recomposed the
  gaps between the lockup, the copy and the footer. Measured before against after across six
  routes, two themes and both split widths: every vertical delta is 0px, and the heading holds at
  three lines at every width (it re-breaks at different words at 1024).

- **No extra `max-width` was added.** The copy already had one: `max-w-[16ch]` on the heading
  (411px) and `max-w-sm` on the list (384px), so it never ran edge-to-edge. The gap to the
  divider was 61/88px at 1024 and is now 64/64; at 1440 it is 213/240.

- **The lockup's 20px-tall hit area is a known separate item, not fixed here.** The padding change
  leaves it byte-identical — 146x20 before and after in all 48 measured combinations, with the
  mark-to-wordmark gap and both hover swaps unchanged — but that height is under the 40px a
  comfortable target wants. Logged on its own so it can be prioritised against the rest of the
  polish backlog rather than folded into a spacing fix.

## The auth lockup's hit area, and a 40px minimum target (22 Sep 2026)

- **The 20px measurement was re-verified against current `main` before anything was changed.**
  Issue #26 reported 146x20, and a fresh sweep of the six auth routes at 375/768/1024/1440 in both
  themes agreed exactly: the painted box is 146.02x20 in all 48 combinations, and walking
  `elementFromPoint` outwards from the link's centre puts the real clickable extent at 146.5x20.
  The width was never the problem; only the height.

- **A pseudo-element, not padding, because the link's border box is load-bearing in four places.**
  The link becomes `relative` and gains an `after:` band: `after:absolute` and `after:inset-x-0`
  to span exactly the lockup's width, `after:h-10` for the 40px, `after:top-1/2` with
  `after:-translate-y-1/2` to centre it, and `after:content-['']` because Tailwind leaves
  `--tw-content` empty otherwise. That is 10px above the lockup and 10px below. Absolutely
  positioned generated content is outside flow, so it is not a flex item in either copy,
  contributes nothing to the aside's `justify-between` distribution or the phone bar's
  `items-center` cross-size, and is invisible to layout entirely. It only answers a hit test.

- **The padding alternative was built and measured rather than argued about.** `-my-2.5 py-2.5`
  does reach 40px and does keep the mark, the wordmark and the theme toggle at identical
  coordinates — the negative margin cancels the padding in flow. What it also does, in all 48
  combinations, is grow the link's own border box from 20px to 40px and move its top up 10px. That
  box is what `:focus-visible` in `index.css` draws its `ring-2 ring-offset-2` around, so the
  padding fix doubles the height of the focus ring. It is a visual regression that only a keyboard
  user ever sees, which is the kind this project should be least willing to ship.

- **40px is a new convention here, not an existing one.** Nothing in the repository defined a
  minimum target before this: there is no spacing token, no utility and no lint rule for it, and
  the only prior mention is the note at the Category B audit recording that UI-UX Pro Max's 44pt
  guidance was set aside as describing React Native rather than this product. 40px is taken from
  Issue #26's own framing — comfortably above WCAG 2.2's 24x24 Target Size (Minimum), below the
  44x44 Enhanced threshold, and a stock `h-10` rather than an invented step. Other interactive
  elements can now be checked against it.

- **The theme toggle is the first thing that convention does not clear, and it was left alone.**
  Measured beside the lockup in the same sweep: the group is 90x34 and each of its three radio
  buttons has a 28px hit height. That is a real finding, but it is a different control with a
  different fix — the buttons are exactly the sliding thumb's size, which is what lets the thumb
  travel in whole widths of itself, so growing them is a change to the control's mechanics rather
  than an overlay. Out of scope for a hit-area fix on the logo; worth its own issue.

- **What the expanded target cannot do is reach its neighbour.** `inset-x-0` pins the band to the
  lockup's own width, so it grows only vertically and the two ends of the phone bar stay as far
  apart as `justify-between` puts them — about 107px of clear space at 375px. The regression test
  asserts the non-overlap directly rather than trusting that reasoning.

## The landing hero's "Next up" panel and the dashboard's upcoming panel (23 Sep 2026)

An audit of the hero panel against the in-app list it depicts found it was hand-built markup that
shared only `StatusDot` and the theme tokens with the product, and that the two disagreed about
what a row's dot means.

- **The dot marks the event, not the application's status, and the hero was changed to match.**
  `UpcomingPanel` paints a deadline red and an interview blue; the hero painted each row with its
  application status, so an interview was amber on the landing page and blue on the dashboard.
  Event type is the more useful signal in a panel of upcoming things - the question is "is this a
  deadline or an interview" - so the real app kept its meaning and the hero's example rows now
  carry an event kind instead of a status.

- **The kind-to-colour mapping moved into `EVENT_KIND_CONFIG` in `statusConfig.ts`.** It was an
  inline ternary in `UpcomingPanel`; putting it beside `STATUS_CONFIG` gives the hero one source to
  read rather than a second copy of the ternary to drift from. The calendar's month grid already
  uses the same danger/info pair as pill tones in `monthModel.ts` and was left alone.

- **The caption was reworded, not the palette.** "Amber is the only colour that means hurry" was
  untrue: red marks overdue dates, High priority and every deadline dot, and in the light theme
  Withdrawn's brown sits closer to the amber than Rejected's red does. The rule Phase 17 actually
  recorded is that amber and red are the warm colours and warm means it wants attention, so the
  caption now says that: "Amber and red mean it needs attention." Moving Withdrawn or Rejected
  off the warm side of the wheel is a palette change with its own risk and was left out of scope;
  this supersedes the caption quoted in the status legend entry above.

- **The hero now renders the dashboard's own row.** `UpcomingRow` holds the dot, the text, the
  relative and absolute dates and `urgencyClass`; `UpcomingPanel` wraps it in a link to the
  application and the hero renders it plain, because an example has nowhere to go. The hero's
  frame - the "Next up" header, "12 open", the glaze, the 14px radius and the caption - stayed
  hero-only on purpose: it is presentation around the example, not part of what the example claims
  the product looks like.

- **The example dates are offsets from today, not fixed dates or strings.** The rows are stored
  as whole days from now and dated at render, rounded down to the hour so the absolute time reads
  like a booking. Losing under an hour from a whole number of days still rounds to the same
  "in N days", so the copy stays true on any day, and the amber on the first row is `urgencyClass`
  applied to a date two days out rather than a flag saying so.

- **The landing chunk grew from 114.2 KB to 122.4 KB gzip, inside its 150 KB budget.** The hero
  now reaches `lib/formatters`, and through it date-fns. Formatting the example with the product's
  own functions is the whole point of the change, so a hand-rolled "in N days" to save 8 KB would
  have reintroduced the copy this removes.

## Withdrawn moves out of the status lightness band (23 Sep 2026)

- **The pair.** Withdrawn `104 67 48` sat 7.1 (OKLab ΔE ×100) from Interview's amber in light,
  closer than Interview sits to Rejected's red (9.8), and 11.2 in dark, where its nearest
  status was in fact Saved at 8.8. PR #28's hero audit flagged it and left it out of scope.

- **Hue and chroma could not move it.** A sweep of OKLCH hue 38–62° and chroma 0.045–0.09 at
  every lightness the gates allow found nothing at L ≥ 0.43 in light that beats the shipped
  value. Each candidate ran through every `tokenContrast.test.ts` assertion a status gets, the
  glazed panel and lit canvas included, and only values that make no Withdrawn pair worse under
  protan or deutan were kept. Turning the hue toward red trades Interview for Rejected under
  protan; dropping chroma trades Interview for Saved. The unconstrained optimum was oxblood at
  25°, Rejected's own hue. The tint gate caps light Withdrawn at L 0.48 and dark at 0.74, so
  the one open direction is away from the ground — and lightness is also the axis that
  survives a red-green deficiency.

- **Values.** Light `79 47 30` (OKLCH 0.341 0.055 48.2°), dark `245 207 181` (0.880 0.055
  56.3°). Hue and chroma are unchanged within rounding; only lightness moves. The nearest
  status is now Interview in both themes, 14.0 light and 12.0 dark, and the lowest pair under
  colour-vision deficiency is 7.3 light (Rejected, protan) and 6.9 dark (Offer, protan). All
  fourteen of Withdrawn's pairs grew, under all three kinds of vision. Of the weak pairs the
  status legend audit listed: Interview/Withdrawn light 7.1 → 14.0 (protan 5.8 → 12.0);
  Saved/Withdrawn 7.8 → 14.2 light, 8.8 → 15.0 dark; Offer/Withdrawn deutan 2.3 → 10.4 light,
  3.9 → 10.5 dark; Rejected/Withdrawn protan 3.5 → 7.3 light, deutan 6.5 → 13.0 dark. Pairs
  that do not involve Withdrawn are untouched and are now the weakest in the palette, all
  between fixed semantics: Interview/Rejected deutan 1.6 light, Offer/Rejected deutan 2.6
  dark, Applied/Assessment 4.3 / 4.6 dark.

- **Gates.** Pill text on the card 8.38 → 11.60 light and 8.49 → 10.67 dark; text against its
  own tint on the least forgiving surface 5.70 → 7.64 and 5.50 → 6.58; dot on the least
  forgiving ground 5.43 → 7.51 (the lit canvas) and 7.25 → 9.11.

- **This supersedes "Withdrawn stays the clearer brown" in the status legend entry, in part.**
  That decision held Withdrawn inside the band the other seven share (light L 0.42–0.48, dark
  0.74–0.83), which is why it concluded that "its one lever is chroma". Its reason for keeping
  the brown — chroma 0.06 reads as brown, the lower-chroma taupe as a fourth grey — stands, and
  chroma stays at 0.055. What is given up is the band.

- **A correction to that entry's record of the taupe.** Re-measured on `main @ 4791a18`, the
  declined taupe (`91 65 55` / `226 195 183`) raises Interview/Withdrawn to 9.9 light and 13.0
  dark, but it also makes three more colour-blind pairs worse, in both themes: Ghosted (light
  12.1 → 11.1, dark 10.4 → 7.9), Assessment (17.5 → 16.5, 13.9 → 13.7) and Applied (25.5 → 24.3,
  15.0 → 13.7). PR #22's checkpoint reported only the two pairs the taupe improved. Keeping the
  brown over the taupe was right, for a stronger reason than was known when it was decided.

- **What it costs.** Withdrawn is now the heaviest mark in both themes — the darkest dot and
  slice in light, the palest in dark — so a closed status carries the most visual weight. It
  also sits nearer the body text: light against `text-muted` 10.0 → 7.7, dark against `text`
  14.4 → 8.8. Each is a warm colour beside a cool neutral, and the pill's tint frames the label.
  The hero rail, the doughnut and the board headers were captured in both themes and reviewed
  before the change was made.

- **The guard.** `tokenContrast.test.ts` now holds Withdrawn at least 12 from each of the other
  seven statuses, and at least 6 under protan and deutan, in both themes, through
  `tests/utils/colorDistance.ts` — OKLab with the Machado 2009 matrices at full severity, the
  method the audit used, so its figures reproduce. Against the old values 8 of the 14 cases
  fail, printing the audit's own numbers (7.12, 2.35, 3.53, 8.83, 11.22, 3.89 among them). Dark
  Interview sits at 12.02, so the floor is effectively a pin on that pair, which is intended.
  The floor covers Withdrawn's pairs rather than all 28: a palette-wide floor would fail on the
  semantic pairs above, which this change deliberately leaves alone.

## A dot key under the hero panel, not the status legend (23 Sep 2026)

The request was to move the eight-status legend from the foot of the hero to sit under the "Next
up" panel, on the premise that it explains the panel's dots and would fill the empty space under
the shorter right-hand column.

- **The premise stopped being true in PR #28.** The panel's dots mark the event kind from
  `EVENT_KIND_CONFIG` — deadline `bg-danger`, interview `bg-info` — not the application status.
  A prototype with the status legend under the panel put an interview row's blue dot directly
  above a legend that says blue is Applied and Interview is amber, and a deadline's red above
  "Rejected". That is the disagreement PR #28 removed, reintroduced by layout.
- **So the panel gets a key for what it does paint, and the status legend stays where it was.**
  `EventKindKey` sits between the card and the caption, reads `EVENT_KIND_CONFIG` so it cannot
  drift from the rows, and draws its dots at the rows' 8px rather than the legend's 6px. Key
  before caption because the caption's "red" then points at a colour the reader has just seen
  named. It uses `mt-3`, the spacing this hero already uses under the card and under the buttons.
- **The key does not balance the columns; centring the right column does.** At 1440 and 1024
  wide the right column's content grew from 306px to 334px against the left's 498px, which left
  8px above it and 156px below. The status-legend version would have reached 362px, still 136px
  short, and wrapped Withdrawn onto a line of its own. Nothing was added to fill the space:
  the right column swapped `lg:pt-2` for `lg:self-center`, so it now sits 82px from the top and
  82px from the bottom of the grid. `lg:pt-2` only nudged the card's top down to meet the
  headline's cap height, which stops meaning anything once the column is centred, and kept
  would have put the card 4px off centre. Below `lg` the grid is one column and nothing changes.
- **Two existing hero tests were narrowed, deliberately.** They counted every list item in the
  figure as a row; the key adds two that are not. They now count `[data-upcoming-row]` and the
  rows list respectively, which is what they meant.

## The landing page drops the status legend (23 Sep 2026)

A further step in the line PR #28 and PR #30 started. PR #30 kept the eight-status rail at the
foot of the hero while giving the "Next up" panel its own event-kind key; this removes the rail.

- **Nothing on the landing page shows a status any more.** Since PR #28 the panel's dots mark the
  event kind, and PR #30's key names those two colours in place. The rail was the only thing left
  on the page that used the status palette, so it keyed nothing the reader could see, and it said
  blue was Applied a few hundred pixels below a card that paints an interview blue. Removing it
  resolves that contradiction outright rather than managing it with distance, which is the part of
  PR #30's entry ("the status legend stays where it was") this supersedes.
- **The rail was hero-only markup, so it was deleted, not unlinked.** `PipelineRail` was a private
  function in `Hero.tsx`; its `mt-12 sm:mt-14 border-t pt-7` divider existed only to set it off and
  went with it. `StatusDot`, `STATUS_CONFIG` and `APPLICATION_STATUSES` are shared with the board,
  timeline and doughnut and are unchanged, bar one thing below.
- **`StatusDot`'s `xs` size was removed with its only caller.** The 6px size and its one-pixel
  ring existed for the rail; after it nothing in the app asked for them, and the only reference
  left was the unit test that pinned the thin ring. That test was deleted with the size it tested,
  not to make a build pass: `sm` and `md` both keep a two-pixel ring, which the remaining ghosted
  ring test still covers. A future 6px dot would need to reintroduce both.
- **The hero now closes on its own padding and is symmetric.** Measured on the built pages: at
  1440 and 1024 wide the section went from 824px to 723px, with 112px from its top to the headline
  and 113px from the last ink to its bottom border, against 214px below before. At 390 wide it went
  from 1097px to 980px, 64px above and 65px below, against 182px. Nothing was added to take up the
  space; the right column's `lg:self-center` still holds the card 82px from each end of the grid.
- **Tests.** The hero test that asserted the legend was _not beside_ the panel became one that
  asserts the page draws no `[data-status-dot]` and no Withdrawn or Ghosted label anywhere; run
  against the previous `Hero.tsx` it fails on the status dots. `tokenContrast.test.ts` keeps its
  "status dot on the glazed panel / at the peak of the hero light" gates: the key's dots now sit
  on the lit canvas where the rail did, and they paint `danger` and `info`, which are status tokens
  too. Only the comment naming the rail changed.

## The feature grid tiles evenly, and its copy claims only what ships (24 Sep 2026)

- **Six equal cells replace the 7/5, 4/4/4, 12 spans.** The spans stranded "Your data stays yours",
  the shortest blurb, alone in a full-width row. Six cells divide by both two and three, so the
  grid runs 2 x 3 from `sm` and 3 x 2 from `lg` with every row full, where before it was a single
  column all the way to 1023px. From `sm`, `auto-rows-fr` makes the rows equal and content stays
  top-aligned; a phone's single column keeps natural heights, because equal rows there would only
  pad the short cards. This gives up the old code comment's intent of making the board the widest
  cell. That intent was never recorded here, and the unbalanced last row cost more than it bought.
  Measured on the dev build: 368 x 220 per cell at 1440, 325 x 243 at 1024, 360 x 220 at 768, no
  horizontal overflow, and contrast of at least 6.25:1 for body text and 11.48:1 for icons in both
  themes.
- **The board card no longer promises stage durations.** "So you can see how long each stage
  really took" became "so you can see when each move happened". `statusHistory` records every
  move with a timestamp and the detail page's timeline lists them, but nothing computes or shows a
  duration. No other line on the page uses "how long" language.
- **The statistics card no longer claims per-source conversion.** Nothing computes it: the server
  only counts applications per source. "Which sources actually convert" became "where your
  applications come from", which is the "By source" chart's own description.
- **Interview rate and time to first reply are now dashboard cards.** The server already returned
  both on the summary, but no screen showed them, so the landing copy named two numbers a user
  could not find. The headline values are the server's `interviewRate` and
  `avgDaysToFirstResponse`, not a client recomputation. The funnel's "% of applied" at Interview
  counts differently: Interview only, where `interviewRate` counts Interview or Offer. Each card
  carries a period delta like Response rate. To make that possible, the cohort `$group` now also
  returns `interviewRate` and `avgDaysToFirstResponse`, using the same expressions as the
  all-time figures. `$avg` skips the null a non-responder yields, so a cohort nobody has heard
  back from reports `null`, and the card shows "—" and "No change" rather than a fake zero. Reply
  time is marked `lowerIsBetter`, so a fall is shown in green.
- **Eight cards tile 2 x 4 below `xl` and 4 x 2 from it.** The stat grid moved from
  `lg:grid-cols-3 xl:grid-cols-6` to `xl:grid-cols-4`, and `DashboardSkeleton` matches it, because
  eight cards in threes would leave a part-filled last row, the same defect the feature grid had.
  Four columns were tried from `lg` first and rejected on the signed-in build: at 1024 the sidebar
  leaves the grid about 700px, so cards were 167px wide, "Weekly goal" truncated and the deltas
  broke inside "32.3 pts" and "No change". Measured after the change: 271px cards at 1440, 231px at
  1280, 346px at 1024 and 173px at 390, with no clipped label or value in either theme.
- **A delta now wraps between the change and its period, never inside either.** `StatCard`'s delta
  line is `flex-wrap`, with the arrow and value and "No change" held `whitespace-nowrap`. On a 390px
  phone the old line already split "32.3" from "pts" and "No" from "change"; the two new cards made
  that more visible, so it was fixed here rather than left for later.
- **One dashboard test assertion changed, deliberately.** "Derives each delta" counted five
  "vs previous 30 days" labels. The two new cards carry that label by design, so it now counts
  seven. The cards themselves are covered by two new tests, and the cohort fields by two new
  server tests.

## A closed account can be restored by signing in within 30 days (24 Sep 2026)

The FAQ promised a 30-day grace period "in case you change your mind", but nothing could undo a
closure: `login` filtered `deletedAt: null` and there was no restore endpoint. This builds the
restore rather than withdrawing the promise.

- **Closing changes one field, so restoring clears one field.** `DELETE /auth/me` sets `deletedAt`
  and revokes every refresh token. Nothing is anonymised or moved, and the email stays reserved by
  the unique index. A restore therefore clears `deletedAt` and starts a session, and that is the
  whole reversal.
- **Login answers only a correct password differently.** A closed account is now looked up like any
  other, so a wrong password on it runs the same bcrypt comparison and returns the same 401 as a
  wrong password anywhere. It also counts towards the same lockout. A correct password gets
  `409 ACCOUNT_PENDING_DELETION` with `{ purgeAt, restoreToken }` inside the window, or
  `410 ACCOUNT_PURGED` after it but before the purge runs. Neither creates a session. The distinct
  answers only follow a verified password, so they reveal nothing a successful sign-in would not.
  A test compares a wrong password on a closed account with an unknown email byte for byte, apart
  from `requestId` and the development-only `stack`.
- **A restore token, not a second password submission.** The 409 carries a token from the existing
  `issueSingleUseToken`, valid for 10 minutes; only its SHA-256 digest is stored, as
  `restoreTokenHash` (select: false) with `restoreTokenExpires`. `POST /auth/restore` exchanges it.
  This keeps the password out of the client's memory while the dialog is open, and it means a
  restore always follows an explicit "Restore my account" rather than any successful sign-in. The
  claim is one conditional `findOneAndUpdate` that checks the token, its expiry and the window in
  the same write that clears them, so two racing requests cannot both restore. A failed claim
  clears the token, and a new sign-in issues a new one. The error handler logs no `details`, so the
  token never reaches a log.
- **The window is `deletedAt + 30 days`, exclusive, the same boundary the purge uses**, so there is
  no instant at which an account is both restorable and eligible for purge.
- **Reminders that came due while the account was closed are marked sent on restore**, rather than
  delivered in the next 8am digest. A backlog of deadlines already past is noise, not a reminder.
  The range is `dueAt` from `deletedAt` to the moment of restore; anything due before closure and
  still unsent was legitimately pending and goes out as normal. They are set `sent: true` without a
  `sentAt`, since nothing was actually delivered.
- **Old sessions stay revoked.** Only the session the restore creates is live, and presenting a
  pre-closure refresh cookie still fails. The "account restored" security email tells the owner, and
  says to change the password if it was not them. That makes five security emails, and privacy.md
  now says five.
- **Forgot-password stays disabled for closed accounts, on purpose.** It still filters
  `deletedAt: null` and answers identically for every address, so it cannot be used to probe for a
  closed account, consistent with the rest of this design. The cost is stated plainly rather than
  buried: a user who has forgotten their password cannot restore, and the account is deleted when
  the window ends. The closed page puts that in a bordered callout, and the FAQ, Settings and
  privacy.md say it in full.
- **"Contact support" is gone from every surface.** There is no support tool that can reopen an
  account, so the closed page, the Settings danger zone and the closure email no longer offer one.
  Signing in is the only route back. The privacy policy's "email us to delete sooner" line stays:
  that is a real, separate channel for early deletion, not a restore.
- **Resolved 25 Sep 2026, see "Deleting an application or purging an account erases its files".**
  **No surface claims uploaded files are deleted any more, until issue #34 is fixed.** Mapping the
  deletion found that the purge job, and deleting an application, remove documents but never call
  the storage adapter, so the files stay in storage unlinked. That is tracked as
  [issue #34](https://github.com/naabelverse/internship-tracker/issues/34), deliberately out of
  scope here. The FAQ drops "including uploaded files" and points to the privacy policy instead;
  privacy.md describes exactly what is and is not erased; the danger zone and the closure email say
  files are not yet removed and how to delete one individually, which does erase it. **When #34
  ships, restore the files claim in the FAQ, privacy.md (the "Deleted accounts" row and "Deleting
  your data"), `DangerZoneSection` and `accountDeletedTemplate`, and update this entry.**
- **Reverted 25 Sep 2026 with the #34 fix; the surfaces say "data" again.**
  **The deletion claim says "your account and its records", not "your data".** "Data" includes
  uploaded files, which #34 means are not erased, so "your data is kept until {date}, then
  permanently deleted" promised more than the purge does. "Your account and its records" names only
  what the purge removes: the user record, applications with their interviews and notes, reminders
  and sessions. The same term is used for the same claim on the closed page (both the status line
  and the forgotten-password callout), the FAQ, `DangerZoneSection`, `accountDeletedTemplate` and
  the privacy policy's "Deleted accounts" row. Where a surface lists the records in brackets, the
  separate files sentence follows it and adds the part "records" leaves out: files are not yet
  removed, and how to delete one. The two never state the same point twice. Sentences about
  _restoring_ ("files and reminders come back as you left them") are untouched, because files are
  intact during the window. **Optional cleanup once #34 ships:** "records" can revert to "data"
  in these same places. This is not required, since "records" stays accurate either way.
- **`DELETE /auth/me` now returns `purgeAt`**, which the client passes to `AccountClosedPage` in
  route state so the page can name the date. A reload loses route state, so every sentence on that
  page has a wording that holds without the date.
- **The login dialog is derived, not stored.** `LoginForm` reads the prompt from `login.error`
  rather than copying it into `useState`; "Keep it closed", Escape and the backdrop all call
  `login.reset()` and clear the password field. `useLogin` does not toast the 409, because it is a
  question for the user, not a failure.
- **Three existing tests were rewritten, deliberately.** `auth.softDelete.test.ts` asserted that the
  correct password on a closed account got 401; it now asserts 409 with no session, and the
  wrong-password half lives in `auth.restore.test.ts`. `deleteAccountFriction.test.tsx` asserted the
  closed page never offered restoring by signing in and did name support; it now asserts the
  opposite of both, with the date. The mail suites' per-kind fixtures and the "security kinds" list
  gained `account_restored`, and `account_deleted` fixtures take `purgeDate` instead of
  `purgeDays`. None of these loosens an assertion.
- **Verified in a browser** against the built client and a seeded in-memory API: closing through
  Settings, the closed page's date and callout, the 409 dialog in light and dark with focus inside
  it, "Keep it closed" clearing the password and leaving the account closed, a restore landing on
  the dashboard with the toast and `deletedAt` cleared, and the 410 shown inline.

## The deploy workflow deploys the commit CI passed, not Railway's last one (25 Sep 2026)

- **`deploy.yml` calls `serviceInstanceDeployV2` with `commitSha`, not `railway redeploy`.** The
  earlier entry said `redeploy` builds "the commit its GitHub connection already points at — the one
  CI just passed on". That was wrong. `redeploy` rebuilds the service's latest deployment, including
  its commit. On 24 Sep Railway's GitHub trigger stopped creating deployments after `f8cebb2` (PR
  #32). A redeploy that day rebuilt `f8cebb2` for the client and `8a519ad` for the server, so
  production looked freshly deployed while it still served the pre-#33 landing copy. With
  `DEPLOY_ENABLED` on, the workflow would have done the same thing after every green CI run.
- **The commit is `workflow_run.head_sha`, or `github.sha` for a manual dispatch.** Both are the
  exact commit the run is about, so what Railway builds is never inferred from Railway's own state.
- **The API is called with `curl` and `jq`, not the Railway CLI.** The CLI has no deploy-by-commit
  command. Both tools ship on the Ubuntu runner, so the step no longer installs anything. Railway
  returns GraphQL errors with HTTP 200, so the step checks the `errors` array itself, and it sets
  `pipefail` because the default Actions shell does not.
- **The project and environment ids come from the token.** A project token is bound to one of
  each, and the `projectToken` query returns both, so no new secret was added.
  `RAILWAY_API_SERVICE` and `RAILWAY_WEB_SERVICE` still accept a name or an id, as DEPLOYMENT.md
  already promised. They are resolved against the project's service list.
- **DEPLOYMENT.md no longer says to disconnect the repo.** Deploy-by-commit builds from the
  connected repo, so disconnecting it would break the workflow. The doc points to Railway's "Wait
  for CI" setting instead.
- **`DEPLOY_ENABLED` stays unset.** Turning it on waits until the Railway GitHub App connection is
  confirmed working again.

## The landing screenshot shows the dashboard as it ships, in the visitor's theme (25 Sep 2026)

- **The screenshot was recaptured because PR #33 left it stale.** Taken on 11 Sep, it showed six
  stat cards in a 3 x 2 grid. PR #33 added "Interview rate" and "Time to first reply" and changed
  the grid to 2 x 4 / 4 x 2, so no layout the app could produce matched it. The feature card
  beside it named both new metrics, and the section claims "the same view the demo account opens
  on". The capture was a real one; nothing re-ran it.
- **The capture viewport went from 1200 x 700 to 1280 x 760.** 1280 is Tailwind's `xl`, where the
  cards go 4 x 2. At 1200 the eight cards take four rows and push the chart and upcoming list out
  of frame. The extra 60px shows the chart's date axis, which the old frame cut off.
- **There is one capture per theme, swapped with `dark:`.** The paragraph says "Dark and light both
  ship", and the old frame showed dark only. `dark:` keys off `[data-theme="dark"]`, the attribute
  the theme control and the boot script set. The picture therefore follows the visitor's explicit
  choice. A `<picture>` with `prefers-color-scheme` would follow only the OS and ignore that choice.
- **Visitors fetch one image, not two.** Measured in Edge against a production build, for stored
  light, dark and system under both OS schemes: the page fetched only the shown image, because a
  lazy `<img>` with `display: none` is never loaded. Switching theme live fetches the other image
  on demand.
- **`dashboardScreenshot.json` records what was captured, and a test compares it with the app.**
  The capture script writes the image size and the stat-card labels it read off the page.
  `LandingSections` takes `width`/`height` from it, so the declared size cannot drift from the
  files. `tests/marketing/dashboardScreenshot.test.tsx` renders `StatCards` and fails if its labels
  differ from the record, naming the script to re-run. A manifest cut back to the old six cards
  made it fail, listing the two missing labels.
- **The test covers the stat cards only.** The upcoming list's dates are relative to the capture
  day and age regardless (26 Sep – 18 Oct in this capture); no test tries to catch that.
- **The alt text was corrected.** It described "a status funnel", which was never in frame. It now
  lists the eight cards' metrics, the applications-over-time chart and the upcoming list.
- **The feature card's copy was left as it is.** Response rate, interview rate and time to first
  reply are all in frame now. The funnel and sources are further down the same dashboard.

## deploy.yml is the only deploy path; Railway's push trigger stays deleted (25 Sep 2026)

- **Railway's deployment trigger must be deleted on both services and stay deleted while
  `DEPLOY_ENABLED` is on.** It is not harmless next to `deploy.yml`, even with Wait for CI on. Wait
  for CI only moves Railway's deploy to the moment CI passes, which is when `deploy.yml` deploys.
  PR #37 (`f95f30b`) proved it. The trigger's client deployment `50b00294` was created 2 s after the
  push, waited for CI, built a full image and started a container. The workflow's `87fe61ec` built
  the same commit at the same time. Railway then removed `50b00294`, and `87fe61ec` stayed live. The
  server trigger only logged `SKIPPED`, because #37 touched no server paths. It had the same config,
  so a server change would have double-deployed too.
- **The workflow was kept rather than the trigger because it fails loudly.** On 24 Sep the trigger
  dropped the pushes for `cfd9775` and `ef71371` without any record. The workflow logs the commit and
  the deployment id it queued, and turns red on any API error.
- **The repo connection stays.** `serviceInstanceDeployV2` builds from the service's connected repo,
  so DEPLOYMENT.md now separates "repo connection" (keep) from "deployment trigger" (delete). It
  also replaces the earlier advice to turn on Wait for CI, which did not prevent the duplicate.
- **A settings change can recreate the trigger.** The trigger ids changed when Wait for CI was
  turned on (client `9a871108` became `acaf7071`, server `be1ba518` became `045235a4`). A future
  change to a service's source settings should be followed by a check that
  `deploymentTriggers(projectId, environmentId, serviceId)` is empty.
- **Both triggers were deleted on 25 Sep 2026**, outside the repo. `deploymentTriggerDelete` was
  called for `acaf7071` and `045235a4` from Railway's GraphQL playground with a short-lived account
  token, which was deleted after use. A re-query then showed no triggers on either service, and
  both still had `source.repo` set to `naabelverse/internship-tracker`.
- **Known gap, not addressed here:** `deploy.yml` deploys both services on every green run, even
  when only one changed. #37 changed only client files and still rebuilt the server.

## Deploy checks live in `scripts/deploy-checks/` (25 Sep 2026)

- **The watcher that verified PRs #37 and #38 is now in the repo** as
  `scripts/deploy-checks/watch-deploy.sh`, with `railway-query.mjs` for the one query the Railway CLI
  cannot make (listing a service's deployment triggers). Before this it lived in a session's
  scratch folder and had to be rebuilt every time. DEPLOYMENT.md "Checking a deploy" documents it.
- **It is a shell script, not an npm script,** for the same reason as `scripts/backup.sh`: it is an
  operator tool that drives `git`, `gh` and the Railway CLI. It uses none of the app's dependencies.
- **This project's Railway ids are defaults in the script.** Project, environment and service ids
  are identifiers, not credentials. Every call still needs a logged-in CLI. Environment variables
  override them, so a fork can point the script at its own project.
- **Check 3 counts every record, `SKIPPED` included.** With the push triggers deleted, `deploy.yml`
  should be the only thing creating deployments. So any second record at the merge commit is a
  failure, not a note.

## The deploy watcher waits through a skipped Deploy run (25 Sep 2026)

- **A skipped Deploy run is no longer the watcher's final answer.** On the PR #39 merge (`3a9a2d0`)
  the e2e job hit the issue #31 toast flake, so CI was red and Deploy skipped itself.
  `watch-deploy.sh` took that skipped run as the result and reported three FAILs. A re-run of CI
  would have started a second Deploy run on the same commit, and the script would never have seen
  it. It now notes the skip and keeps polling for a Deploy run on that commit that was not skipped.
- **The wait after a skip is 6 hours by default (`RERUN_WAIT_MINUTES`).** A re-run waits on a person
  noticing the red CI, so it can come much later than the 60 minutes CI plus Deploy normally take.
  `RERUN_WAIT_MINUTES=0` reports the skip at once, which suits checking an old commit.
- **The regression test is a shell script with stubs,** `scripts/deploy-checks/test-watch-deploy.sh`.
  It replaces `gh`, `railway` and `sleep` on `PATH` and replays three histories: green, skip then
  re-run, and skip with no re-run. It runs by hand, not in `npm run test`. The watcher is a
  bash-only operator tool, and wiring bash stubs into the Node suites would couple CI to bash on
  every platform for a script CI never runs.
- **Issue #31 itself is untouched.** The flaky colour-contrast audit stays a separate open issue.

## Accessibility audits run on a settled frame (issue #31, 25 Sep 2026)

- **The flake was the toast's exit, not its entrance.** Issue #31 blamed the "Welcome back" toast's
  fade-in. Measured locally, the entrance cannot produce the failure. It starts at 0.5 opacity with
  the toast below the viewport, and axe skips off-screen elements. The #31 report also had about
  0.42 effective opacity, below where the entrance starts. The toast's fade-out can produce it.
  react-hot-toast dismisses a success toast after 2 s with a 0.4 s fade from 1 to 0, and on a slow
  runner the dashboard audit can land inside it. A violation also needs the toast fully on screen
  while half faded. That happens when it sits higher than its lowest slot, as it does when stacked.
  Why CI's toast sat higher is not known. The fix does not depend on it.
- **Reproduced before fixing.** A throwaway spec lifted the toaster 140 px and started the audit once
  the toast's exit had passed 0.5 opacity. Unfixed, 7 of 10 runs failed with the same rule on the
  same element (`color-contrast` on `.go3958317564`, 3.17:1). Freezing the animation clock mid-exit
  failed every time. With the fix, 10 of 10 passed started mid-exit and 10 of 10 on arrival.
- **The fix is in the audit helper, not in a longer wait.** `e2e/support/motion.ts`
  `withAnimationsSettled` first waits until no finite CSS animation has run for five consecutive
  frames. Several frames are needed because a toast mounts invisible and starts its entrance a frame
  or two later. It then stops Chromium's animation clock, through the DevTools Animation domain,
  while axe runs. A wait alone only moves the race, because the toast's dismiss timer can start the
  fade during the audit. With the clock stopped, an animation that starts mid-audit stays on its
  first frame, which for an exit is fully opaque and in place.
- **The toast is still audited.** Settling does not remove it. If the toast is at rest when the audit
  starts, axe checks it at full opacity. This is the colour pair a user actually reads, and the one
  the toast's icon-theme comment in `client/src/main.tsx` was about.
- **Scope: every audit in `axe.spec.ts`,** not only the dashboard. The create-application modal and
  any future toast would race the same way. Chromium-only, like the suite's one project.

## Deleting an application or purging an account erases its files (issue #34, 25 Sep 2026)

- **The cause was a missing call, not a swallowed error.** Neither the purge job nor application
  deletion ever called the storage adapter, and no version of them ever had. Only
  `removeAttachment` erased a file.
- **Four paths now erase files:** the purge, `DELETE /applications/:id`, the bulk `delete` action,
  and the demo reset's `wipeAccountData`. Each reads `attachments.filename` with its usual
  user-scoped query, deletes the documents, then passes the keys to `eraseStoredFiles` in
  `attachment.service.ts`. The single delete uses `findOneAndDelete`, so it reads and deletes in
  one step and nothing can be attached in between.
- **The demo reset goes beyond the issue.** #34 named only the purge and application deletion, but
  the demo account accepts uploads and is shared by every "Try the demo" visitor. Every nightly
  reset wiped its applications and left their files behind, which probably made it the busiest
  source of orphans. It uses the same helper, so it adds a few lines.
- **Documents first, files second, same as `removeAttachment`.** A crash or a storage outage between
  the two steps leaves an orphaned object, never a record pointing at bytes that are gone. The cost
  is that a failed file cannot be retried by the next purge run, because its key is no longer
  stored. That is why each failure is logged at error level with its key.
- **A storage failure never blocks the deletion.** `eraseStoredFiles` never throws. It logs each
  refused key and carries on. The HTTP delete still answers 200, and the purge still deletes every
  account in the run. The purge result gains `filesErased` and `filesFailed`, which appear in its
  daily log line. Deletes run in batches of 20, so an account with many files does not open
  hundreds of storage requests at once.
- **`removeAttachment` is unchanged.** It still lets a storage error reach the caller, because a
  user deleting one file is told when that delete fails. The two new helpers sit beside it rather
  than inside it.
- **The helpers take keys, not a `userId`.** The rule that user-data service functions take
  `userId` first is about scoping queries. `eraseStoredFiles` runs no query, and it only receives
  keys each caller has already read through its own user-scoped query. The purge covers many users
  at once, so a single `userId` would not fit it.
- **The wording is restored.** The FAQ, `DangerZoneSection`, `AccountClosedPage`,
  `accountDeletedTemplate` and privacy.md say "data" again and name uploaded files as deleted. The
  "not yet removed" sentences and their workarounds are gone. The `DELETE /auth/me` OpenAPI text
  also no longer cites #34, and the application delete and bulk endpoints now say they erase files.
  The copy describes deletions from this merge on, and those are now true.
- **The privacy policy's date moves to 25 September 2026.** Its "Changes" section says the date
  always reflects the current version, but the closure-wording edits of 24 and 25 September left it
  at 5 September. The new date covers those edits and this one. This change widens what is erased
  rather than narrowing it, so no advance email to users is needed for it.
- **Files orphaned before this fix are a separate problem.** They stay in storage until a one-off
  sweep removes them. The sweep needs a `list` method the adapter does not have, so it is tracked
  as [issue #42](https://github.com/naabelverse/internship-tracker/issues/42). It is not a live
  false promise: accounts closed before this merge were told at the time that files would stay.
- **The two #34 entries under the 24 Sep restore section are resolved** by this one. They are kept
  as the record of why the wording changed twice.

## The deploy watcher fails when it cannot check triggers (25 Sep 2026)

- **A trigger query with no `"data"` is an error, not an empty list.** On PR #43's check the server's
  query hit a network error (`ECONNRESET`), the script printed it as the trigger list, and it still
  said `DONE` and exited 0. `watch-deploy.sh` now reads each reply three ways: an empty `edges` list
  passes, a trigger present fails, and a failed query or a reply without `"data"` is an error. A
  failure or an error prints `FAILED` instead of `DONE` and exits 1.
- **The response is matched with whitespace removed and printed with it kept**, so an error such as
  "Not Authorized" stays readable in the output.
- **The test stubs `node` only for `railway-query.mjs`.** Every other `node` call runs for real, so the
  script needs no test hook. The three new cases fail against the old script (16 assertion failures)
  and pass against the new one.
- **Resolved by issue #45, below.** **Checks 1 to 3 still exit 0 when they fail.** That is unchanged and out of scope here. Read their
  PASS and FAIL lines as before.

## The deploy watcher fails when any check fails (issue #45, 25 Sep 2026)

- **Reproduced first.** New harness cases failed check 1 (Deploy skipped, no re-run), check 2 (the
  server's deployment `FAILED`) and check 3 (a second client record at the same commit), one at a
  time. On the old script each one printed its `CHECK n FAIL` line, then `DONE`, and exited 0. The
  cause: checks 1 to 3 only printed their failures. The trigger-problem exit from #44 and the usage
  errors (exit 2) were the only `exit` statements after argument parsing.
- **One `fail` helper for every check.** Every `CHECK n FAIL` and `TRIGGERS ... FAIL|ERROR` line goes
  through `fail`, which prints the line and counts it. A single summary at the end prints
  `FAILED: N check(s) did not pass` and exits 1, or prints `DONE`. #44's trigger-specific counter and
  message were folded into it, and its three test patterns were updated to the shared wording.
- **Every check still runs after a failure,** so a failed deploy is reported in full rather than
  stopping at the first problem.
- **The harness now prints each run's exit code** (`ran [...] exit=N`), and the stub `railway`
  takes `SERVER_STATUS` and `DUPLICATE` to fail checks 2 and 3. The all-green and re-run cases still
  end in `DONE` with exit 0. A real read-only run against `4b4fa06` (PR #43) did the same.

## Sweeping files orphaned before the #34 fix (issue #42, 25 Sep 2026)

- **`list(prefix)` joins the adapter contract, read-only and for operator scripts only.** No request
  path calls it. It returns an array rather than a stream: the free tier caps storage at 10 GB and
  each account at 100 MB, so a full listing is thousands of entries, not millions. S3 follows
  `ListObjectsV2` continuation tokens; the in-memory mock pages every two keys so the contract suite
  crosses a page boundary on both drivers.
- **Local disk matches the prefix as a string, like S3, not as a directory.** It walks the whole
  upload root and filters, and keys always use forward slashes, so the same key reads the same on
  Windows. `lastModified` is rebuilt from `mtimeMs` so it is an ordinary `Date` in every realm.
- **An object must pass three tests to be deleted:** no application references it, its key has the
  exact `attachments/<user>/<application>/<uuid-v4>.<allowed ext>` shape `buildStorageKey` makes,
  and it is more than 24 hours old. A reference wins over every other test. A key in any other shape
  is listed as unrecognised and never deleted, so a file put there by hand or by a future feature is
  safe. An application id of 12 characters, which `ObjectId.isValid` also accepts, falls into that
  group too: failing safe beats matching every shape the route could produce.
- **24 hours, not the 1 hour the issue suggested.** `addAttachment` stores bytes before it saves the
  document, so a live upload is briefly unreferenced. The orphans this is for are days to months old,
  so a longer margin costs nothing.
- **`--apply` re-plans and needs `--expect <N>` to match exactly.** There is no saved plan file: the
  count ties the apply to the dry run the operator read, and any change in between, such as a failed
  erasure creating a new orphan, refuses rather than deleting something unreviewed.
- **An empty database is refused outright; a majority needs `--allow-majority`.** This departs from
  the approved plan, where both guards were plain refusals. With no applications every file looks
  orphaned, which is exactly what a wrong `MONGO_URI` looks like, so there is no override. A majority,
  though, may be the truth: the nightly demo reset deleted a whole account's applications every day
  before #34 and probably left more files than every live account holds. Without an override the
  sweep could never run in that case.
- **The referenced-key read is across all users**, the one deliberate exception to "every service
  function takes `userId`", the same as the purge job and `stats`. It compares one whole bucket with
  one whole database and reads only `attachments.filename` through a cursor.
- **Deletion reuses `eraseStoredFiles`**, which now takes an optional adapter (it still defaults to
  `getStorage()`). The sweep inherits its batching and its per-key error log, and exits 1 when any
  file fails.
- **Proven against local disk and the S3 mock only.** No R2 test bucket exists, so `ListObjectsV2` has
  not been run against real R2. The production dry run is read-only, so it is also the first real
  check of the listing.
- **Issue #42 was closed as completed when PR #43 merged**, although that PR only mentioned it as a
  follow-up. This work is what the issue asked for.
- **Production run, 26 Sep 2026: 0 files before, 0 after; production had no attachments and an empty
  bucket.** The dry run listed nothing, so `--apply` was never needed. A listing of 0 could also have
  meant the script was looking in the wrong place, so it was checked read-only: all 128 applications
  have empty `attachments`, and a direct `ListObjectsV2` of the `internship-tracker` bucket with no
  prefix returned 0 objects. No test file was uploaded to production to exercise `list` against
  real R2; that belongs on a separate test bucket if it is ever needed.
- **The report now names the storage it listed** (`Storage: s3, internship-tracker`), through a new
  `location` on the adapter: the bucket name, or the local upload root. The zero result above took a
  separate check to trust because the report did not say which driver or bucket it had read.

## npm audit: qs patched, react-router v7 deferred (26 Sep 2026)

`npm audit --omit=dev` reported five moderate entries. They are four advisories: two in `qs` and two
in `react-router`. express, body-parser and react-router-dom were listed only because they depend on
those two. Each advisory was checked against how this app actually uses the code, not triaged by its
severity label.

- **`qs` array-limit bypass (GHSA-x5fp-wj9c-mxmx) was not reachable.** It needs `qs.parse` with
  `comma: true`. Express's extended query parser passes `{ allowPrototypes, arrayLimit: 1000 }`, and
  body-parser's `urlencoded({ extended: true })` (`app.ts`) passes depth and array limits. Neither
  sets `comma`, and the server never imports `qs` itself.
- **`qs` `isBuffer` crash (GHSA-4mjr-xmp4-gh2g) was not reachable.** It needs a parsed object with a
  `constructor` key to go back through `qs.stringify`. Express's `allowPrototypes: true` does keep
  such keys, so half the precondition holds, but nothing in the server calls `qs.stringify`, and
  Express does not call it internally.
- **Patched anyway, because the patch is lockfile-only.** `npm update express body-parser qs` moves
  express 4.22.2 → 4.22.3, body-parser 1.20.6 → 1.20.8 and qs 6.15.3 → 6.16.0, all inside the
  existing `^4.21.2` range. `npm audit fix` was rejected: its dry run also removed and re-resolved
  unrelated dev dependencies (vitest, typescript-eslint, `@vitejs/plugin-react`).
- **react-router open redirect via backslash (GHSA-wrjc-x8rr-h8h6) was not reachable.** Only three
  navigation targets are built from variables. `UpcomingRow` always gets
  `paths.applicationDetail(id)`, the sidebar maps a fixed list, and the post-login redirect is
  `location.pathname + search`, which `ProtectedRoute` stores in router state. A crafted link cannot
  write router state, and a browser turns `\` into `/` before `pathname` exists, so
  `/\evil.com` arrives as `//evil.com`, which `readRedirectTarget` already rejects.
- **react-router SSR constructor injection (GHSA-337j-9hxr-rhxg) does not apply.** The advisory
  excludes Declarative Mode. The app uses `<BrowserRouter>` and has no SSR.
- **The v7 upgrade is deferred.** The fix exists only in react-router 7.18.0, and the v6 line gets no
  patch. Both future flags that apply to `<BrowserRouter>` (`v7_startTransition`,
  `v7_relativeSplatPath`) are already on, so the upgrade should be modest. It is still a major
  version touching every route to fix nothing reachable today. Revisit it when there is another
  reason to touch the router's major version, or if the post-login redirect ever starts reading from
  somewhere an attacker controls, such as a `?next=` parameter.

## A demo session keeps the visitor's own theme (28 Sep 2026)

"Try the demo" opened the dashboard in dark for a visitor who had picked light on the landing page.

- **Root cause: `useAccountTheme` applied the stored theme of every signed-in account, the shared demo
  account included.** Once the demo session arrived, `adoptAccountPreference(user.theme)` repainted the
  page and wrote the account's value over the visitor's `internship-tracker.theme` in local storage,
  so the landing page stayed on it after signing out too. Two paths led to dark. A freshly reset
  account holds `system`, which replaced an explicit light choice and resolved to dark on a dark OS.
  And the theme toggle writes to the account while signed in, which `PATCH /auth/me` deliberately
  allows for the demo, so one visitor clicking Dark set dark for every later visitor until the reset.
- **Fix: `useAccountTheme` skips a user with `isDemo: true`.** The demo account's stored theme is the
  last visitor's choice, not this visitor's preference, so a demo session keeps whatever the device
  already had: light, dark, or `system` following the OS. The server already sends `isDemo` from both
  `POST /auth/demo` and `/auth/me`, so a refresh inside a demo session behaves the same. The client
  `User` type now declares it. A real account's stored theme still wins and is still written back.
- **Not changed: the toggle's server write for demo sessions.** It is harmless once the stored value
  is never read, and the demo intentionally shows theme changes working.
- **Ruled out: the nightly reset leaving a stale value.** `seedDemoAccount({ reset: true })` already
  restores `theme: 'system'` through `DEMO_PROFILE`. The reset test now asserts it. The screenshot
  capture script also leaves the demo account on dark, since its loop ends on the Dark control, but
  it has only run against local databases, so production needs no one-off data change. The stored
  value no longer matters after this fix.
- **`dashboardRoutes`, `bootThemeStoreFromStorage` and `stubMatchMedia` moved to `client/tests/utils`.**
  The new demo theme tests need all three, and copying them would have left two definitions of each.

## The logo moves to the top of the sidebar and links to the dashboard (29 Sep 2026)

The brief was to move the logo from the top header into the sidebar, above the nav items.

- **The header never held the logo.** `Topbar` renders only the drawer toggle, a spacer, the theme
  control, the user's initials and name, and sign out. The wordmark was already in `Sidebar`, as plain
  text in an `h-16` strip with `border-b`. Next to the topbar's own `h-16` and `border-b` on the same
  `surface` ground, the two joined into one band from `lg` up, with the wordmark at its left end. That
  was the "logo in the header" the brief described. The change is to the sidebar only. `Topbar` is
  untouched because its controls were already pushed right by the `flex-1` spacer.
- **The strip loses its border and keeps `h-16`.** Without the border it reads as the top of the rail.
  Keeping the height keeps the lockup level with the topbar's controls, and nav items start at the
  same y as before, 76px.
- **The spacing is the nav's, not new values.** The row is `px-3`, the nav's `p-3`, and the link is
  `px-3 py-2`, `navLinkClass`'s box. So the mark starts on the nav icons' 24px line (the text was at
  16px), the link's 36px box and focus ring match a nav item's, and the drawer's close button now lines
  up with the nav links' right edge. Its right inset goes from 16px to 12px.
- **The lockup's styling is the auth pages' `BrandLink`:** `BrandMark` at `h-4 w-4` in `text-primary`,
  `gap-2.5`, the wordmark in `stretch-wide`, and a hover that swaps both halves to `content-muted`
  rather than tinting a background. The auth link's `after:` hit-area band is not copied. That band
  exists because padding would have disturbed the aside's `justify-between`. Here the padding is the
  nav item's own box, which already gives a 36px target.
- **The link targets `paths.dashboard`, not `paths.landing` as the auth lockup does.** `MarketingRoute`
  redirects an authenticated visitor from `/` to `/dashboard`, so linking there directly lands in the
  same place without the hop. `BrandLink` stays on `/` because a signed-out visitor has no dashboard.
- **The link calls `onClose` on click**, as the nav links do. From the dashboard the pathname does not
  change, so `AppLayout`'s route effect would leave the drawer open over the page on a phone.
- **`BrandMark` is imported from `MarketingChrome`, not moved.** `AuthSplitLayout` already imports it
  from there, and the brief asked for the shared component to stay put.
- **Tests:** `client/tests/components/sidebarBrandLink.test.tsx` covers the target, both halves inside
  one link, the order before the nav, reaching the dashboard, a single lockup with none in the banner,
  and the drawer closing from the dashboard. All five fail against the old sidebar. The drawer test
  alone fails when only the link's `onClose` is removed. The "no `border-b`" assertion is a class
  contract, since jsdom applies no CSS. The rendered result was measured in a real browser for the PR.

## Every dropdown opens as a styled panel (29 Sep 2026)

The brief was to restyle the select menus app-wide: rounded, elevated, padded options, a soft
accent tint for the selected row, a distinct hover, no overlap with the fields below, and a small
gap under the field.

- **All 13 dropdowns were already native `<select>`s, drawn by two components.** `Select` renders
  ten: New application ×5, Add interview ×2, Settings ×2, and the bulk bar's "Set status…".
  `StatusSelect` is the inline pill in the other three: the table, the phone card list and the
  detail header. The filter and column menus are `Popover`s holding
  checkboxes, not selects. The implementation was consistent. The problem was that a native
  select's open list is drawn by the browser, and no CSS reaches it.
- **`appearance: base-select`, not a custom listbox.** It opts the same native element into a panel
  the page can style, so keyboard handling, screen-reader semantics, `react-hook-form`'s `register`
  and the plain `change` event all stay native, and no call site changed. A hand-built ARIA listbox
  would have looked identical in every browser, at the cost of a keyboard model, a portal, a
  `Controller` at every form field, and the mobile platform picker `StatusSelect` exists to keep.
  The user chose this option when offered both.
- **Two guards make it a pure enhancement.** `@supports (appearance: base-select)` leaves browsers
  without it (Firefox, and Safari unless it has shipped support since) on their classic picker.
  `@media (pointer: fine)` leaves phones and tablets on the platform picker. A touch-emulated
  context was measured at `appearance: auto`, and a desktop context at `base-select`.
- **Every value is an existing token.** The panel is the popover menus' card: `rounded-card`,
  `border-border`, `bg-surface`, `shadow-float`, `p-1`, and `my-1` for a 4px gap from the field.
  Rows are `rounded-control` (the card radius less the inset, so the corners stay concentric) and
  `px-2 py-2.5`, which puts each label on the field's own text line in a 40px row. Selected and
  hovered are the sidebar's `primary/10` and the board's `primary/5`. The accent is neutral, so the
  tint reads as a soft wash of the ink colour, not a hue. The panel is in the top layer, so it
  needs no z-index and no field can paint over it. `max-h-96` fits all eight statuses without a
  scrollbar, and longer lists (Timezone, 35 zones) scroll thinly.
- **Measured before building, in both themes.** Body text on the selected row is 15.68:1 light and
  9.98:1 dark, on the hovered row 17.44:1 and 11.52:1, and the checkmark is 14.22:1 and 8.83:1. The
  tint alone separates selected from hovered by only 1.11–1.15:1, so the selected row also carries
  the platform checkmark and medium weight and is not marked by colour alone.
- **Two side effects of the switch, fixed here.** Base-select stretches the field's label and arrow
  instead of centring them, so the rule sets `items-center`. Its arrow is a filled triangle, heavier
  than every other icon, so it is replaced by `ChevronDownIcon`'s path as a mask in `currentColor`,
  sized in `em` so it fits the smaller pill too.
- **Escape inside an open panel no longer closes the modal (regression found in verification).**
  The classic picker swallowed Escape. The base-select panel is part of the page, so its Escape
  reached `useFocusTrap`'s document listener and closed the dialog, discarding the form. While a
  panel is open, focus sits on an `<option>` (measured in Edge 154), and at no other time, so the
  trap now ignores an Escape whose target is an option and lets the browser close the panel.
- **Tests:** `tests/components/selectPanel.test.tsx` holds the class contract (both components opt
  in) and the stylesheet contract (guards, tokens, concentric radii). `tokenContrast.test.ts` reads
  the two tint alphas from `index.css` and gates text and checkmark contrast in both themes.
  `focusTrap.test.tsx` gains the Escape regression case, which fails without the guard. Removing
  the class from `Select`, or making the selected tint equal the hover tint, turns the new cases
  red. jsdom renders no panel, so the look was checked in a real browser (Edge 154) at every
  location in both themes, together with keyboard and click selection, form submission and the
  table pill's status change.

## Entered dates are bounded to 2000–2099, client and server (30 Sep 2026)

"11/11/111111" could be typed into Applied date. There was no validation anywhere: the three date
inputs (Applied date, Deadline, an interview's Scheduled at) had no `min` or `max`, the form schema
took any string, and the API's `z.coerce.date()` took anything `new Date` could read.

- **Bounds: 2000-01-01 to 2099-12-31, inclusive, in UTC on the server.** Nothing an internship
  search tracks predates 2000 or is due 70 years out. 2000 rather than the suggested 1970 because it
  also catches the likeliest typo: a two-digit year typed into a native date input is read as year 0026. `MIN_DATE_YEAR`/`MAX_DATE_YEAR` live in `server/src/models/Application.ts`, mirrored in
  `client/src/types/application.ts` like `MAX_NOTES_LENGTH`.
- **The API accepted and stored absurd years.** `+111111-11-11T…`, `11/11/111111`, `0001-01-01` and
  `9999-12-31` all saved, and `2026-02-30` was stored as 2 March. The form's own value happened to
  be refused, only because an unsigned year past 9999 does not parse, as a generic 400 at the top
  of the form. A shared `boundedDate` now covers create, update, interviews and CSV import, with
  "must be between 2000 and 2099" and "must be a real calendar date".
- **The interview form failed silently.** Its submit handler called `toISOString()` on an Invalid
  Date, which threw: no request, no message. The schema check now stops it first.
- **Every entry path meets one check.** Typing, pasting and calendar picks all end as the input's
  `value`, which the zod schema validates. `DateField` also sets `min`/`max`: measured in Chromium
  153, that caps a typed year at four digits and limits the calendar, but the input still reports
  `1111-11-11` as its value, flagged only by `validity.rangeUnderflow`. The schema check is the one
  that holds. `appliedDate` and `deadline` joined `SERVER_FIELDS` so an API date error lands on its
  field.
- **Existing out-of-range records** (none expected, prod unchecked) now fail on their next edit
  until the date is fixed. The error shows on the field, so the user can correct it.
- **The calendar stays native (user's call).** Unlike `<select>`, a date input has no
  `base-select` equivalent: the browser draws the popup outside the page, and only `color-scheme`,
  already set by the theme store, reaches it. So its radius, shadow, selected-day, hover and today
  styles are the browser's. A styleable calendar (`react-day-picker` in `Popover`) is a separate
  follow-up if wanted, not part of this fix.
- **What the page can style, and what it can't.** The calendar button is `CalendarIcon` as a mask
  in `text-content-muted`, matching the select chevron, verified in both themes. A hover rule darkens
  it to `text-content`. This is unverified: in this environment Playwright never set `:hover`, even
  on a plain text input. A `primary/10` tint for the focused day/month/year segment was built and
  removed: Chromium parses `::-webkit-datetime-edit-*-field:focus` but paints its system highlight
  over it, even from an id selector with `!important`.
- **Keyboard:** unchanged, because the input is still native. Measured in the app: ArrowUp on the
  day segment steps 2026-10-01 to 2026-10-02 in both themes. The popup's own arrow/Enter/Escape
  handling belongs to the browser, and headless Chromium does not render the popup.
- **Tests:** `server/tests/application.dateBounds.test.ts` (12) and
  `client/tests/applications/dateFieldBounds.test.tsx` (22). With the fix reverted, 10 of the 12
  server tests and 5 of the client ones fail. The others fail neither way (they check that valid
  dates pass, or cover values rejected before and after). The screenshot's scenario was also run
  end to end in the real app: type `11111111111` into Deadline, submit, see the message, and zero
  POSTs, in both themes.

## Date fields open the app's calendar (30 Sep 2026)

The follow-up the entry above deferred: the calendar that opens from Applied date, Deadline and an
interview's Scheduled at now matches the select panel (rounded card, elevation, a tinted selected
day, a hover wash, a today marker) instead of being drawn by the browser.

- **Those three are still the only date fields.** All go through `DateField`. Filters, Settings and
  CSV import take no typed date, so nothing else needed converting.
- **The input stays native; only the popup is replaced.** `react-day-picker` 10 renders the month
  inside `Popover`, and a pick is written into the same native input as if typed (the prototype's
  `value` setter plus an `input` event). So `register` needed no change at any call site: no
  `Controller`, no second value path. Typing into the dd/mm/yyyy segments still works, and every
  entry path still ends as the input's `value` checked by the same zod schema and the server's
  `boundedDate`. The calendar also cannot reach past 2000-01-01 or 2099-12-31
  (`CALENDAR_BOUNDS`), and a value the schema would refuse is never shown as selected.
- **Dependency:** `react-day-picker@10.0.1`. The locked stack names no picker, and a hand-built
  grid would need its own keyboard model and ARIA. Its only other dependency, `@date-fns/tz`, sits
  beside the `date-fns` 4.4 already shipped (deduped, one copy). Its stylesheet is not imported:
  `.date-calendar` in `index.css` styles its `rdp-*` classes with existing tokens only.
- **Bundle:** the library lands in the shared `ApplicationFormModal` chunk. Dashboard 220.0 →
  236.9 KB gzip (budget 300), applications 159.0 → 175.5, detail 181.2 → 198.1. Landing is
  unchanged at 122.3 KB and still isolated. Lazy-loading the calendar on first open would win the
  ~17 KB back, at the cost of a loading state inside a panel whose size the positioning measures.
  Not done: the budget has room, and the dashboard's chart vendor costs far more.
- **The select panel's two guards, restated for dates.** The app's trigger shows, and the
  platform button is hidden, only under `@supports selector(::-webkit-calendar-picker-indicator)`
  and `pointer: fine`. Firefox draws its own calendar button with no selector to hide it, so it
  keeps that one rather than showing two. Phones and tablets keep the platform picker. Measured:
  desktop Chromium shows one icon (ours), and a touch context shows one (the platform's), with the
  field's padding given back. Firefox and Safari are **unverified** (only Chromium is installed
  here). Safari may still open its own popover from a click in the field.
- **Look, and the numbers behind it.** Days are `rounded-control`, hover `primary/5` and selected
  `primary/10`, the select panel's two tints. Those differ by only 1.11:1 light and 1.15:1 dark,
  so the selected day also carries a semibold numeral and a 1px inset `primary` ring (the
  option's checkmark has no calendar equivalent). Today is a `primary` dot under the numeral, not
  the Calendar page's filled circle, which would outshout the selection. Numerals read 19.24 /
  17.44 / 15.68:1 (plain / hovered / selected) light and 12.98 / 11.52 / 9.98:1 dark. Out-of-month
  days read 7.46:1 light and 4.80:1 dark at worst (hovered). The ring reads 17.45:1 light and
  11.48:1 dark. The dot reads at least 14.22:1 light and 8.83:1 dark (on a selected day). Keyboard
  focus is a 2px inset ring, ordered after the selected rule so it wins on the selected day too.
- **Keyboard.** Tab reaches the trigger after the input's own segments (three Tabs for a date).
  Enter or Space opens the calendar with focus on the selected day, or today. Arrows, Home/End and
  PageUp/PageDown are the library's. Enter picks, closes, and returns focus to the trigger.
  Escape closes and returns focus. Tabbing out closes. Alt+ArrowDown in the input opens it, as it
  opens a select.
- **`Popover` changed for every user, deliberately.** Its Escape listener moved to the capture
  phase and stops there. On the bubble phase, the modal's focus trap (also on `document`,
  registered first) closed the dialog on the same press, discarding the form. It now also closes
  when focus tabs out, as it already did on an outside click. The filter and column menus gain
  both, and `tests/applications/toolbarMenus.test.tsx` holds them directly: Escape, tab-out,
  outside click and ticking a box, per menu. Against the previous `Popover`, only the two
  tab-out cases fail, so the other three behaviours are unchanged. The panel can float with fixed positioning under an anchor
  (`useAnchoredPosition`), because an absolute panel is clipped by the modal body's
  `overflow-y-auto`. It stays in the modal's DOM, so the focus trap still holds it, and it
  follows the field through scroll and flips above when there is no room below.
- **Date-time fields keep their time.** Picking a day for a Scheduled at of 14:30 keeps 14:30. An
  empty one starts at 09:00 (`DEFAULT_PICKED_TIME`), shown in the field for the user to change.
  Chromium's native date-time popup also had time columns. On desktop, time is now typed into the
  segments only.
- **Tests:** `tests/components/datePicker.test.tsx` covers the helpers, the named trigger and
  dialog, today/selected/refused values, click and keyboard picks through a real `register`,
  Alt+ArrowDown, tab-out, the preserved time, the 2000/2099 arrows, Escape inside a `Modal`, and
  the stylesheet contract. `tests/applications/datePickerForms.test.tsx` picks at all three
  locations and asserts what the API receives. `tests/a11y/calendarContrast.test.ts` reads both
  alphas from `index.css` and gates text, ring and dot in both themes. Two were proven
  non-vacuous: moving Escape back to the bubble phase fails the modal case, and assigning
  `input.value` directly fails all three submit cases. The first run also caught that v10 marks
  a dead month arrow with `aria-disabled`, not `disabled`, so the CSS keys on that. In a real
  browser (Chromium, both themes), axe found no violations in the open calendar. The keyboard
  path, Escape layering, scroll-following, the 11111111111 typed-year rejection with zero POSTs,
  Feb 30 yielding no value, and form submission all passed (24/24).

## The Tags and Notes hints show an example (30 Sep 2026)

- **Inline, not a tooltip.** Measured in the real modal (Chromium, both themes) at 375, 414, 640,
  768, 1024 and 1440px, both new hints render on one line with nothing clipped. The tightest point
  is 640px, not 375px: that is where the form turns two-column and the Tags column is 291px, and
  the Tags hint (250px) still has 41px to spare. At 375px, Tags has 83px spare and Notes 61px.
  The app has no tooltip or info-icon pattern, so there was nothing to follow and no reason to
  add one.
- **Tags ends with a full stop,** unlike the old "Comma separated". Every other hint in the app,
  Notes included, is a sentence ending in one, and the two hints now sit together.
- **Text only.** `parseTags` and `renderMarkdown` are untouched. The Tags example parses to the
  three tags it names, and the Notes example uses only syntax `marked` (GFM) renders and
  `DOMPurify` keeps: `strong`, `em`, `ul`/`li`.

## The deploy watcher retries a failed gh call once, then says "unknown" (30 Sep 2026)

- **Why:** on the check of PR #58's deploy, `gh run view --json conclusion` lost its connection to
  api.github.com, and the report printed `DEPLOY RUN 36737005121 conclusion=` with nothing after
  it. A failed call looked like an empty answer, the same class of gap as the trigger query in
  PR #43. Two more calls had it: a failed CI lookup printed `CI conclusion: not found`, which is a
  real result, and a failed log fetch reported `0 of 2 services queued`, which blamed the deploy
  for a network fault.
- **What:** `gh_retry` in `watch-deploy.sh` runs each of those three calls and retries once after
  `GH_RETRY_SECONDS` (default 10). On a second failure it prints
  `unknown (gh failed twice: <gh's last error line>)`. The run list polled while waiting for Deploy
  is left as it is, because that loop already re-polls every 30 seconds.
- **Which failures end in FAILED:** only the log. The two conclusions are informational, since
  checks 1 to 3 decide the result, so an unknown conclusion with every check passing still ends in
  DONE. Without the log, the queued ids are unknown, so check 1 is an ERROR, and check 3 fails for
  both services because there is no id to match.
- **Tests:** `test-watch-deploy.sh` gains `GH_FAIL=<call>:<n>`, which fails the first n attempts of
  one call with the connection error seen on 30 Sep. Four cases: `conclusion:1` (retried, same
  report as a clean run), `conclusion:2`, `ci:2` and `log:2`. All four failed against the old
  script, and `conclusion:1` reproduced the blank exactly. The eight earlier cases are unchanged
  and still pass.

## Malaysia-focused sources, with "Other" stored as `source` plus `sourceOther` (1 Oct 2026)

- **The list:** JobStreet, LinkedIn, Indeed, Hiredly, Maukerja, MYFutureJobs, Company site,
  Referral, Career fair, Other. Each platform was checked as active before it went in. WOBB is not
  listed because it rebranded to Hiredly in June 2021, and would have been the same platform twice.
  MYFutureJobs is SOCSO's (PERKESO's) government portal, with 96,700 live listings in June 2026,
  internships included. Glints was left out; it counts as Other. SPEC section 4's enum is updated to
  match.
- **Why a second field, not free text in `source`:** `source` stays a closed enum, so the filter,
  the URL state, CSV validation and the chart's `$group` keep working unchanged. One `other` bucket
  also stays one bar, instead of splitting into "Instagram", "instagram" and "IG". `sourceOther`
  holds up to 60 characters, and `applySourceRules` in the service clears it whenever `source` is
  not `other`, so stale text cannot outlive a switch to LinkedIn.
- **Required in the form only:** the form refuses Other without the text, because Other alone is
  the entry nobody can decode later. The API and CSV import accept Other without it, so imports and
  older clients are not blocked.
- **Existing Internshala rows:** production had 20 on 1 Oct 2026 (a read-only count): 10 on the
  demo account and 10 on one real account. No other value falls outside the new list. Migration
  002 rewrites them to `other` + `sourceOther: 'Internshala'`. It filters on the old value, so a
  re-run matches nothing, and it passes `timestamps: false` so no one's "recently updated" order
  moves. The result is a shape the previous release already reads, so the migration can run before
  the deploy. It is run by hand, like 001: the runner is not part of server boot (DEPLOYMENT.md
  4.4).
- **The model rejects `internshala` outright, so the migration is a hard prerequisite.** The first
  version of PR #60 kept the value in the Mongoose enum as a safety net. On the user's decision it
  was removed, leaving no backward-compatibility value in the model. Mongoose re-validates every
  path it loaded on `save()`, so a row the migration has not reached now returns 400 on any edit or
  board drag. A test pins that failure deliberately. **The order is fixed: run migration 002 on
  production, confirm 0 `source: "internshala"` rows remain, then merge.** `deploy.yml` deploys
  main as soon as CI passes, so merging is deploying. The migration keeps its own copy of the
  `internshala` → `Internshala` mapping, so it still means what it meant when it shipped. The CSV
  import keeps another copy, so an old export's Internshala rows import as Other: Internshala. That
  translates input and never stores the value.
- **Display safety net:** `formatSource`/`sourceLabel` show an unknown stored value as stored,
  rather than as a blank in the table and detail page or as "Unspecified" on the chart. The form
  opens such a row as Other with the old value as the specify text, so saving it moves the row onto
  the current shape.
- **"By source" is one colour** (`color-chart-1` at 0.85, the same as top companies). Each bar is
  named on the axis, so a colour per bar carried no information. Ten sources plus Unspecified is
  eleven bars against eight series tokens, which would have brought back the repeated-colour bug
  that `tokenContrast.test.ts` guards. With one colour, that cannot happen however long the list
  gets.
- **RESOLVED (issue #61): `sourceOther` is searchable.** Correction: this entry first said list
  search uses the text index, so adding the field would need the index rebuilt. It does not: list
  search is one escaped, case-insensitive regex per field, and `sourceOther` was simply missing
  from that list. It was added in the fix for #61, with no index change or migration.
- **Not changed:** `schemaVersion` stays at 1, because the field is additive and optional, and the
  migration's own filter makes it idempotent.

## The deploy watcher retries the Deploy run list too (1 Oct 2026)

- **Why:** PR #59 left the Deploy run list polled during the wait outside `gh_retry`, because the
  loop re-polls every 30 seconds anyway. That covers a short outage but not one that is still going
  when the wait ends: the last lookup came back empty, and the report said
  `no completed Deploy run for <sha>`, which blamed the deploy for a network fault.
- **What:** the lookup now goes through `gh_retry`. A lookup that fails twice prints
  `Deploy run list: unknown (gh failed twice: <error>)` and polling continues. Only the latest lookup
  counts, so the result is a check 1 ERROR naming gh's error only if lookups are still failing when
  the deadline passes. The error text is kept out of the run-id parser, which would otherwise read
  `unknown` as a run id.
- **Tests:** `GH_FAIL=deploy:<n>` in `test-watch-deploy.sh`, with three cases: `deploy:1` (retried
  without a word), `deploy:2` (reported, then the next poll is used) and `deploy:99` with
  `DEPLOY_WAIT_MINUTES=0` (ERROR, not "no completed Deploy run"). All three failed against the old
  script. The twelve earlier cases still pass.

## The Other-source field is labelled "Other source", and stays where it is (1 Oct 2026)

- **Why:** "Please specify" did not say what to specify. At `sm` and up the field takes the right
  column of the Source row, so Work mode sits directly above it and the label read as if it could
  belong to either.
- **What:** the label is now "Other source", a noun phrase like the form's other labels ("Company
  website", "Resume version"). The field name, validation, placeholder and payload are unchanged.
- **Not moved:** the field is already beside Source (same row, measured at y=418 for both at
  1440px) and directly under it in the one-column phone layout. Putting it under Source on wide
  screens would leave an empty cell beside Source or shift every later field by one cell.

## A scrolling dropdown panel is inset by its border, not its padding (1 Oct 2026)

- **What was wrong:** Source (eleven rows since the Malaysia sources) and Settings' Timezone are the
  dropdowns long enough to scroll. The panel is its own scroll container, and Chromium draws the
  scrollbar just inside the border, in front of the padding, so with `border p-1` it ran flush
  against the edge and its square grey track painted over both right-hand corners. Reproduced in
  Chromium 153 and Edge 154 with real scrollbars. Playwright's headless default hides scrollbars,
  which is why earlier captures looked fine. The CSS was identical for every select (same computed
  10px radius and shadow), so only a panel that overflows showed it.
- **Why "no shadow" too:** at a laptop height (1366×650 measured) the Source panel does not fit
  below the field, so it flips above it. `shadow-float`'s main cast falls downward, onto the field,
  so the top edge sits on the dimmed overlay with almost no shadow. The token is unchanged. That is
  how every flipped floating panel looks.
- **Fix:** the inset is a transparent `border-4` plus `p-px`, and the visible edge is a 1px outline
  over the border's outer pixel. The scrollbar (3px clear of the edge line) and the clipped rows now
  sit inside the rounded edge. `scrollbar-color` themes the thumb (`border-strong`) on a transparent
  track. Rows land exactly where `border p-1` put them: measured row positions at rest are
  identical before and after for all five New application selects in both themes.
- **Why not one 5px border (found in review):** the scroll area is clipped to the card radius less
  the border. At `border-[5px]` that curve is 5px with the rows touching it, so it cut the first
  row's own 6px corner: up to 13 pixels per corner at 2x changed, by up to 33/255, on the focused
  row in Employment type and Work mode. At `border-4` the curve is 6px with the rows 1px inside it.
  Re-diffed against main at 2x in both themes, no pixel on a row differs. The remaining differences
  are the redrawn lift (the 1px top band, Δ≤2, and its arc in the top corners, Δ≤16) and the edge's
  curve antialiasing now that it is an outline (bottom corners Δ≤13 and the half-pixel right edge
  Δ≤12). Both were accepted. The cast shadow outside the panel is pixel-identical, and main against
  itself differed by 0 pixels.
- **The lit edge moved, so it is redrawn:** `shadow-float` opens with an inset shadow, which is also
  painted inside the border and would have sat 4px below the edge (a visible double line in dark
  mode). `tailwind.config.ts` now builds `float` from two named parts, and the panel uses
  `shadow-float-cast` (everything but the lift). It draws the lift from the same `--atmos-lift`
  tokens as a 1px gradient band directly under the edge. `float` itself is byte-identical, and a test
  holds `float-cast` to `float` minus its first layer.
- **Forced colours:** a transparent border is painted in forced-colours mode (a 5px black frame was
  measured), so under `forced-colors: active` the border takes `Canvas` and the outline is the edge.
- **Not done:** the panel still flips above the field when it does not fit below. That is the
  browser's own position-try. Making it stay below and shrink instead would change every select,
  which is beyond this fix.

## The weekly goal ring draws its exact share on a visible track (1 Oct 2026)

- **What was wrong:** the fill was rendering as intended. `primary` is the neutral near-black
  chosen on 11 Sep, the same colour the timeline uses for applications. The track was
  `surface-muted`, which measures 1.14:1 on the card (1.11:1 dark), so the rest of the circle
  vanished and the arc read as a stray dark stroke. The arc also overshot. Round caps reach half the
  5-unit stroke past each end (7.16° on r=20), so 1 of 5 painted 86.29° instead of 72°, and it
  started before twelve o'clock. Measured by re-rendering the live markup at 600px.
- **Fix:** butt caps, and the track is `primary` at 20%, like the timeline's area fill: 1.54:1 on the
  card (1.72:1 dark), with the fill at 11.4:1 (6.7:1) against it. Measured after: 1 of 5 = 72.07°,
  1 of 3 = 120.00°, 0 of 5 = 0°, 5 of 5 = 360° (green, no seam), in both themes. The share comes
  from `completed / target` rather than the server's `percentage`, which is rounded to one decimal
  (1 of 3 would have drawn 119.88°). A goal of 0, which settings allow, draws an empty ring.
- **Why not `border-strong`:** it was built first, at 2.15:1 in light. The grey remainder then
  outweighed the progress it framed. In dark the two candidates are within a few channel values.
- **Why the track stays under 3:1:** the ring repeats "1/5", which is printed beside it, and its
  `aria-label` says the same, so the remainder is not the only carrier of the value. The part that
  shows the value, fill against track, is 11.4:1.
- **Layout:** the card was not taller than its siblings. The 48px ring added 0.7px (118 against
  117.3). It sat in a row with the label and value only, pinned to the top corner above an empty
  quarter of the card. `StatCard` now puts a graphic beside all three lines, centred on them, and
  the ring is 56px from `sm` (48px below). The card is now 117.3px like the rest, at 1440, 1024 and
  390px in both themes. Cards without a graphic keep a plain block. The only measured change to them
  is their figure's paragraph box spanning its column, with glyph positions unchanged.
- **Not changed:** Settings' usage meter has the same `bg-primary` on `bg-surface-muted` pairing.
  On a 6px bar anchored left it still reads, so it is left for its own decision.
- **Subtitle:** from `sm` the no-streak line is "Your applications, replies and interviews, and what's
  due next." It names what the page shows, as the page's meta description does. The user chose it
  from three options.
- **The line has a phone length too:** below `sm`, the header keeps "New application" beside the
  heading only while the line fits the room left over. Measured in the built app (Archivo is bundled,
  so the widths hold on any device), the room is 159.2px at 360 wide, 174.2px at 375 and
  189.2px at 390. The full line is 379.1px, so it pushed the button below and grew the header from
  48px to 124px. Four items cannot fit in 159px. "Applications and what's due." (176.4px) fits only from
  390, and "Replies, interviews, what's due." (193.2px) not until 414. Phones now get
  "Applications, what's due." (153.9px, the longest readable wording that fits at 360). Narrower
  than 360 the button still wraps, because 320 leaves 119px.
- **The streak line already wrapped on phones before this change:** "N day streak — keep it going."
  is 175.8px at 1 day, 183.7px at 12 and 191.7px at 100. It wrapped at 375 and 360 on `main`, and at
  390 from 100 days. "Keep going." variants are still 163px or more, so below `sm` it is just
  "12 day streak" (82.7px; 90.6px at 100). Checked in the browser at 360, 375, 390, 414, 639, 640,
  768, 1024 and 1440 for streaks of 0, 1, 12 and 100: one line, button beside the heading, header
  48px, in all 36 cases.
- **One string reaches assistive technology:** the two lengths are sibling spans, `sm:hidden` and
  `hidden sm:inline`. `display: none` takes the hidden one out of the accessibility tree, so the
  header's snapshot holds exactly the visible line at every width checked. jsdom applies no CSS, so
  `dashboard.test.tsx` can only hold the class contract. The browser check is the real evidence.

## The Upcoming row hovers with the select panel's inset ink wash (2 Oct 2026)

- **Before:** the dashboard's Upcoming row hovered with `bg-surface-muted`, the grey that buttons,
  icon buttons and the sidebar use. In light it paints `231 237 246` on the white card: OKLCH chroma
  0.0137 at hue 258, 2.7 times the card's own 0.0051, so a whole row of it reads as lavender. In dark
  it was already close to neutral.
- **After:** `bg-primary/5`, the hover of the select panel's options and the date calendar's days,
  which this file's entry on the select panel records as "a soft wash of the ink colour, not a hue".
  Painted: `237 240 244` light (chroma 0.0058, the card's own level), `35 46 60` dark. Against the
  card it is 1.110:1 light (was 1.143) and 1.126:1 dark (was 1.115). Text on the hovered row: body
  17.33:1 light / 11.52:1 dark, subtle 7.41:1 / 4.80:1 (was 4.85:1). Read from screenshot pixels,
  which matched the computed composites.
- **Why not the applications table:** its rows have no hover, only their icon buttons do.
- **Inset:** the tint used to run flush to the dot and the date, 0px on both sides, where the select
  panel's options sit `px-2` inside theirs. The linked row is now `-mx-2 px-2`. The tint clears the
  dot and the date by 8px, and the text does not move: the dot and the date's right edge still meet
  the panel heading and "Open calendar" exactly, at 1440 and 390 wide. The 8px comes out of the
  card's padding, leaving 12px outside the tint at 1440 (`sm:p-5`) and 8px at 390 (`p-4`). The tint
  is 8px wider than the row dividers on each side. That is the cost of keeping the text and the
  dividers where they were, rather than indenting the text or pulling the dividers out with it.
- **Scope:** only the `Link` variant hovers. The landing hero renders the same row without `to`, and
  that gets no hover class, which the new test holds. The tint still appears only under the pointer
  and clears on leave. Keyboard focus shows the global focus ring and no tint, as it did before.

## The Upcoming list's dividers span the row hover tint (2 Oct 2026)

- **Supersedes** the trade-off in the entry above: "The tint is 8px wider than the row dividers on
  each side." The dividers are `divide-y` borders on the list items, so they spanned the card's
  content box, while each row's `-mx-2` took its tint 8px past them. The brief described the reverse,
  with the dividers poking out past a narrower tint. Measured on `main`, the tint overhung the
  dividers by 8.0px on each side for the first, middle and last rows, in both themes, at 1440 and
  390 wide.
- **Fix:** the `-mx-2` moves from the row to `UpcomingPanel`'s list, and the row keeps `px-2`. The
  list, and with it every divider, widens to exactly the tint's edges. The tint, the text and the
  hover colour do not move. Measured after, in all 24 cases: divider and tint edges coincide (0.0px),
  the tint is 12px from the card's inner edge at 1440 and 8px at 390 as before, it still clears the
  dot by 8px, and the dot and the date still meet the heading and "Open calendar" exactly.
- **The other way was rejected:** narrowing the tint to the old dividers brings back the flush text
  that the entry above fixed, unless the text is indented and loses its line with the heading.
- **At rest the dividers are longer:** 16px longer in all, 8px past the text column on each side.
  Before, they ended level with the heading and the dates. That is the visible cost, and the review
  frames show it at rest.
- **The landing hero's copy is unchanged.** It has its own list and plain rows, with no hover.

## The Activity heatmap scales with its card, to a cap (2 Oct 2026)

- **Problem, measured on `main`:** twelve fixed 12px columns made a 188×108px grid at every width.
  The card spans the dashboard, so the grid used 20% of its content width at 1440, 18% at 1920, 33%
  at 1024, 23% at 1023 (where the sidebar collapses and the card widens) and 70% at 375.
- **Fix:** the cells are twelve equal `minmax(0, 1fr)` columns of `aspect-square` cells, so they grow
  with the card and stay square. The gap is 4px below `sm` and 6px from `sm` up. The weekday labels
  are now a seven-row grid on the same gap, stretched to the grid's height. The old `justify-between`
  column only lined up with 12px rows. Measured after: the label and row centres agree to within 1px
  at 375, 768, 1024 and 1440.
- **Cap:** `max-w-md` (448px) holds cells at 31.8px and the grid at 259px tall, level with the 256px
  `h-64` plots in the chart cards above. The card is 368px tall against their 352px. Uncapped, square
  cells would reach 82px at 1440 and the grid 600px tall.
- **What the cap leaves:** at 375 the grid fills the card (cells 19.75px). At 768 and 1024 it fills
  about 70%, at 1280 52%, at 1440 44% and at 1920 41%. Twelve columns of square cells are about 12:7,
  so a full-width card cannot be filled at a sensible height. That is a property of the grid's shape.
  More cell scaling cannot fix it.
- **Not taken:**
  - Showing more weeks to fill the width would contradict SPEC section 6's "last 12 weeks". It would
    also make the history depend on screen width, even though `1y` daily buckets exist.
  - Narrowing the card would move the empty space from inside the card to beside it. Nothing on the
    dashboard could share its row.
- **Unchanged:** the 84 cells, the level colours in both themes, the aria-label, "Last 12 weeks" at
  the card's top right like other cards' header actions, and the legend under the label column. The
  legend's top margin is 16px; it was 12px plus 4px of scrollbar padding. The grid no longer
  overflows at any width, so the horizontal scroll wrapper is gone.
- **Skeleton:** it was a fixed `h-32` (128px), so a 259px grid would have made the card jump on
  load. It now has the grid's 12:7 shape and cap, with `ml-7` for the label column and `mb-7` for the
  legend. The jump is 0.6px at 1440 and 1.5px at 375, measured with the day timeline held for 4s.
  On `main` it was about 10px.
- **Test:** `e2e/audits/heatmap.spec.ts` checks square cells, the grid width against `min(room, 448)`
  and label alignment at four widths. jsdom applies no CSS. The spec fails on `main` ("grid width @
  375px: expected 281, received 188") and passes on this branch.

## The Activity heatmap keys its days in the account's timezone (2 Oct 2026)

- **Bug:** the analytics pipeline buckets each day on the user's local midnight and returns that as
  a UTC instant, so local 2 Oct in Kuala Lumpur arrives as `2026-10-01T16:00:00Z`. The heatmap took
  the first ten characters (`2026-10-01`) and keyed its own cells by the browser clock's UTC date. For
  a UTC+8 account every count was drawn on the previous day's cell from 08:00 to midnight local, and
  only lined up before 08:00. West of UTC the counts were keyed correctly, but the grid's week
  alignment came from the browser's local weekday while its keys came from UTC, so the grid could
  slide a day.
- **Fix:** `features/dashboard/heatmapCells.ts` reads every bucket, and "today", back as a calendar
  date in the account's IANA zone (`Intl.DateTimeFormat` with `timeZone`). It steps between days with
  date-only arithmetic at UTC midnight, so a daylight saving change cannot skip or repeat a cell. The
  zone is `user.timezone`, the one the server bucketed on, not the browser's. The browser's zone is
  only a fallback for a session with no user, which the protected dashboard never renders. Cell titles
  format the date key itself.
- **Kept on the client:** the API contract is unchanged. The server's instant is correct, and the
  timeline chart formats the same instants in the browser's zone.
- **Test:** `client/tests/dashboard/heatmapCells.test.ts` pins local Friday 2 Oct 2026:
  - `Asia/Kuala_Lumpur` at 07:30, 13:00 and 23:59 local, on both sides of the UTC date change;
  - `America/Los_Angeles` at 01:00, 13:00 and 22:30 local;
  - `America/New_York` across the 1 Nov 2026 change back from daylight time.
    With the old algorithm swapped back in, 4 of the 8 cases fail under a UTC process zone and 6 fail
    under `Asia/Kuala_Lumpur`. The fix passes all 8 under UTC, `Asia/Kuala_Lumpur` and
    `America/Los_Angeles`.
- **Not covered:** a browser in a different zone from the account. The heatmap now follows the
  account, so it is right there too. Other date displays, such as the timeline chart's labels, still
  format in the browser's zone, and that is outside this fix.

## The Activity card shows weekly pace against the goal (2 Oct 2026)

- **What:** twelve bars, one per heatmap column, with a dashed line at the weekly goal and a line
  such as "Goal met in 2 of 12 weeks · 3.4 a week on average". It fills the space beside the grid,
  which was 602px of empty card at 1440.
- **No new request:** the bars sum the heatmap's own 84 cells seven at a time (`paceWeeks.ts`), and
  the goal is `summary.weeklyGoal.target`, which the page already waits on. The server counts the
  goal's `completed` on `createdAt` from the local Monday in the account's zone, and the timeline's
  `created` buckets use the same field and zone, so this week's bar always equals the stat card's
  "N/5".
- **Average over all twelve weeks, the one in progress included:** "of 12" and "a week" then
  describe the same twelve columns. Early in a week the figure reads slightly low, which is preferred
  to an inflated one. Confirmed with the user.
- **A goal of 0 reads "No weekly goal set"** with no goal line, rather than a dashed line on the
  baseline that every week "meets". Confirmed with the user.
- **Colours:** the bars take the heatmap's five `heat-*` levels, scaled to the busiest week by the
  same function the cells use (now `heatLevels.ts`), so the one "Less … More" legend covers both. The
  goal line is `content-subtle`, the card's small-label colour. No new tokens.
- **Beside or below is a container query on the card, not a viewport breakpoint.** The room beside
  the grid is not monotonic in the window width. The sidebar arrives at `lg` and takes 256px, so a
  1024 window leaves 186px beside the grid while 1023, with the sidebar in a drawer, leaves 457. The
  panel moves beside the grid from a 48rem card, where the grid keeps its full 28rem and the panel
  gets at least 260px. Measured: 1440, 1280, 1180 and 1023 put it beside; 1100, 1024, 768 and 375
  stack it under the legend, where each bar is centred on its week's column to within 0.5px.
  Tailwind 3.4's arbitrary `[@container_(…)]:` variant does this without the container-queries
  plugin.
- **One CSS grid for labels, cells, legend and panel.** Stacking puts the bars in the cells' own
  column, which is what lines them up. The legend spans the label column to keep its place, and is
  `contain: inline-size` so its text does not size that `auto` column. Without it the column grew to
  130px and the grid shrank from 281px to 179px at 375. The first capture caught that, and
  `e2e/audits/heatmap.spec.ts` now asserts the label column width; the existing grid-width test had
  passed against the broken build.
- **Cost:** where the panel stacks, the card grows by 144px. Where it sits beside the grid, the
  card's height is unchanged at 368px.

## Status updates leave out each application's opening entry (2 Oct 2026)

- **What:** the Activity card shows "Added" and "Status updates" over the grid's twelve weeks, with a
  line such as "1.3 updates for every application added", in the empty top of the column above
  Weekly pace. The demo account reads 41 added and 53 status updates.
- **The correction:** the timeline's `statusChanges` counts every `statusHistory` entry, and every
  application's history opens with a `from: null` entry written as it is created — by the form, the
  CSV import (which goes through `createApplication`) and the demo set alike. So each application
  added was also counted once as a status change. Shown raw, the demo account would have read
  "94 status updates, 2.3 per application": 41 of the 94 are the 41 applications themselves. The
  client now shows `max(0, statusChanges − created)` per bucket (`statusUpdates.ts`). That entry and
  `createdAt` are the same moment, so they always share a bucket and the subtraction removes exactly
  them.
- **Why it matters:** "status updates" is a claim about how often the user acts on applications
  they already have. The raw figure more than doubled it for this account, and for an account that
  only adds applications it reported one update per application where there were none. That is a
  wrong number, not a styling choice.
- **The Timeline chart had the same fault, and is corrected too.** Its "Status changes" line and its
  screen-reader table plotted the raw count. This was beyond the approved change (the stats block);
  it is included because the requirement was that the raw count is shown nowhere, and it uses the
  same helper.
- **Client-side rather than on the server:** filtering `from: null` out of the aggregation would be
  equally exact, but it changes what the documented `statusChanges` field means for every consumer.
  The subtraction keeps the API as it is and puts the correction in one function both charts use.
  `server/tests/analytics.statusUpdates.test.ts` holds the server to the premise: on the demo set,
  `statusChanges − created` equals the `from`-bearing entries counted straight off the documents in
  every bucket, and the grid's twelve weeks give 41, 94 and 53.
- **"For every application added", not "per application":** the twelve weeks' updates include moves
  on applications added before them, so the ratio compares two activity counts, not a per-record
  rate.
- **Placement:** above Weekly pace, not in the strip to its right, which only exists above a
  ~1320px window (0px at 1280) and would have needed its own breakpoint. Beside the grid (1023, 1180,
  1280, 1366, 1440) the side column spans the grid and legend rows with `justify-between`, so the
  figures sit level with the grid's top row, Weekly pace stays on the legend line, and the card keeps
  its 368px height. Stacked (1024, 1100, 768, 375) the figures sit above Weekly pace in the grid's
  column and the card grows by 87px.
- **Test fixtures changed deliberately:** `makeTimeline` had buckets with fewer status changes than
  applications added, which real data cannot produce. Its raw counts now include the openings, so the
  corrected figures are the same 3, 6 and 9 as before.

## Active days fills the strip right of the side column, or joins the figures row (3 Oct 2026)

- **What:** "Active days", a large count and "of N days" beneath: days in the grid's twelve weeks on
  which an application was added or moved between statuses, out of the days so far. The demo account
  on 2 Oct 2026 reads 52 of 82.
- **Added or moved, not added only (28):** the stat answers how consistently the search is worked,
  and follow-up is part of that. It sums the corrected per-day status updates from PR #72, so a
  new application's opening entry never makes a day count twice or count on its own.
- **Out of the days so far:** the grid runs to the end of the current week, and days that have not
  happened cannot be active, so the denominator is 78–84 rather than a fixed 84.
- **Rejected:** busiest day (a three-way tie at 3, with 54 of 82 days empty, and already implied by
  the darkest cell colour); current streak (already in the page header); longest gap (mostly
  restates Active days from the other side).
- **Two placements, one shown.** From a 66rem card the side column is full width and a sixth track
  opens to its right, behind a 1rem spacer. Labels, grid, side column, two spacers and five gaps
  take 988px, so a 1056px card leaves 68px, enough for the 61px stat. That switch happens between
  a 1416 and a 1418 window with the sidebar, and the strip is 90px at 1440 and 186px from 1536.
  Below it the strip is narrower than the label (48px at 1366, none at 1280), so the stat is the
  third figure in the Added/Status updates row instead. Hiding it would make a real number depend on
  screen size.
- **Rendered twice, not moved:** one element cannot be placed in the grid's sixth track and inside
  the side column's flex row by CSS alone. Each copy carries the opposite container-query class, and
  `display: none` removes the hidden copy from the accessibility tree as well as the layout.
  `e2e/audits/heatmap.spec.ts` reads the browser's own tree (`ariaSnapshot`) at seven widths and
  finds "Active days" once at each. jsdom applies no CSS, so the client suite only pins the classes.
- **Measured:** the three-figure row does not wrap at 375 (all three labels share a top edge, with
  39.5px to spare). Beside the grid the card keeps its 368px height at every width. Where the side
  column stacks, the card grows by 16px for the "of N days" line. The grid and Weekly pace have the
  same boxes as on `main`.
- **Legend pinned to row 2:** with six tracks, auto-placement put the loading skeleton's legend
  placeholder into the strip's free columns, dropping its row and making the skeleton 12.6px
  shorter than the loaded card. The legend and its placeholder now carry `row-start-2`.
- **Heatmap label wording:** its screen-reader label said "N active days" for days with an
  application added. It now says "across N days", so "active" has one meaning on the card.

## Activity card redesigned as heatmap left, one stretching column right (3 Oct 2026)

- **What:** the heatmap keeps its column (up to 28rem). Everything else, the three figures over
  Weekly pace, is one column that takes all the width left over, never under 15rem (240px), from
  a 40rem card. Below that the card stacks as before, each pace bar under its week. This replaces
  the 48rem beside rule, the 66rem strip, and the second, hidden copy of Active days. Calculations,
  labels, titles and screen-reader text are unchanged.
- **Why a redesign rather than another patch:** four PRs each fixed one gap at one width and left
  two container rules, a strip and a duplicated stat. Measured on the shipped card, the worst gap
  was not the one reported at 1440+: at 768 and 1024 (sidebar open) the card stacked and left a
  ~200 × 573px column empty down its whole right side.
- **Three directions, prototyped by rearranging the real card's DOM in a production build and
  measured at six widths.** Dead space is the share of the card body more than 24px from any text,
  cell or bar, so ordinary gaps do not count:

  | Window | Card   | Shipped | A (chosen) | B     | C     |
  | ------ | ------ | ------- | ---------- | ----- | ----- |
  | 375    | 309px  | 2.2%    | 3.3%       | 6.3%  | 2.2%  |
  | 768    | 678px  | 33.5%   | 1.0%       | 15.6% | 33.5% |
  | 1024   | 662px  | 31.9%   | 1.7%       | 15.8% | 31.9% |
  | 1280   | 918px  | 14.0%   | 5.1%       | 17.1% | 14.0% |
  | 1440   | 1078px | 23.7%   | 9.4%       | 18.4% | 24.1% |
  | 1920   | 1174px | 30.0%   | 11.4%      | 19.1% | 30.3% |

- **Rejected, B (figures across the top, heatmap and pace side by side below):** also one rule, but
  the card is about 100px taller at every width from 768 up (471px against 368 at 1280 and up),
  the figures row leaves a ~900 × 90px void to its right, and the pace chart grows to 674 × 242px
  and outweighs the heatmap.
- **Rejected, C (the shipped layout without the strip):** the smallest change, and Active days
  rejoins its row, but it fixes no gap: 768 and 1024 keep their empty column and 1440+ keeps a
  122–218px right margin.
- **The figures row is `grid-flow-col auto-cols-[minmax(max-content,1fr)]`:** equal columns, none
  narrower than its content. The prototype's `repeat(3, minmax(0, 1fr))` wrapped "Status updates" in
  a 240px column. The three figures need 177px plus two 16px gaps, inside the 240px floor and the
  226px grid of a 320px phone.
- **Pace summary: it wraps to two lines in the 240px column, rather than a 272px floor.** A 272px
  floor costs the heatmap 32px at 1024 (cells 24.7px → 22px) and still cannot promise one line:
  "Goal met in 10 of 12 weeks · 10.5 a week on average" is wider than 272px. With the grid that
  much shorter, the fixed 80px plot would no longer fit beside it either, so the card would grow.
- **40rem, not the prototype's ~38rem:** beside the grid the plot starts at 48px and grows into the
  column's spare height, so the column never sets the row height. Its floor, with "of N days" and a
  two-line pace summary, is 215px. The grid and legend rows are 227px at 40rem and 208px at 38rem,
  where the column would push the card 7px taller. At the 28rem cap the rows are 290px and the plot
  is 139px, against a fixed 80px before.
- **Cost, accepted:** once the column is wider than the grid (about 1300 and up), the pace bars are
  wider than the heatmap cells (about 50px against 32px at 1536+), so "each bar matches its week's
  cell pitch" holds only when stacked. At 768 and 1024 the cells are 26px and 24.7px rather than
  31.8px, and the card is about 330px tall rather than 615px.
- **Tests rewritten to the new rules, not loosened.** Four, one more than first flagged:
  - `heatmap.spec.ts` "pace beside the grid only when it has room" (48rem; grid at its 448px cap;
    a 260px panel floor) now pins: beside from 40rem at 768/1024/1280/1440/1536; the column ends at
    the card's content edge; it is at least 240px; the grid is `min(448, room − 32 − 240)`; the
    grid is exactly seven cells and six gaps tall, both measured across (the column did not grow
    the row); the pace panel ends level with the legend; the plot is at least 48px.
  - `heatmap.spec.ts` "Active days … in the strip when there is room" now pins one copy, read once
    in the accessibility tree, third in the row at seven widths, with "Status updates" and
    "Active days" each on one line.
  - `heatmap.spec.ts` "the activity grid scales with its card", not in the original list, expected
    `min(room, 448)` at every width. Beside the grid it now expects `min(room − 32 − 240, 448)`.
  - `followThroughStats.test.tsx` "places Active days twice and shows one" now pins a single copy,
    third in the row, carrying no placement class, and the row's column rule.
- **The rewritten e2e checks fail on what they guard.** Against `main`'s build the three rewritten
  tests fail (pace not beside at 768, two Active days copies, grid width at 768) and the unchanged
  one passes. A throwaway build with the prototype's `grid-cols-3` row and a fixed 80px plot fails
  "Status updates on one line @ 768px" (32px against 16) and "grid row no taller than the grid @
  1024px" (212.5px against 208.7). A first version of that last check compared the weekday labels'
  height with the grid's and passed on the broken build, because both stretch with the row; it was
  replaced before commit.

## The Activity card explains itself: a subtitle and three info tips (4 Oct 2026)

- **Subtitle replaces the right-aligned "Last 12 weeks".** The line under "Activity" now says it,
  so the label would repeat it. A 405px full line ("Your activity over the last 12 weeks, and how it
  compares to your weekly goal.") and a 210px short one, swapped by a 26rem container query, the
  Dashboard header's `Lede` pattern. The card's content box is 254–324px on phones and 662px or more
  from 768, so it is one line at every width measured (320 to 1920). With no goal set, the goal
  clause is dropped. Cost: the card is 18px taller at every width.
- **`InfoTip` is a new pattern, built on `Popover`, not a tooltip library.** The app had no tooltip
  or info icon. `title` text cannot be reached by keyboard or touch, and a hover tooltip cannot be
  opened on a phone, so the tip is a click/Enter disclosure: `Popover` with `role="dialog"`, an icon
  trigger named "About …", Escape and outside-click to close, and focus back on the icon. The panel
  is anchored to its own trigger, so `useAnchoredPosition` keeps it inside the 16px gutter at 320.
  The icon is 14px with a 26px pseudo-element target (WCAG 2.2's 24px minimum), measured by hit-walk.
- **The trigger is block `flex`.** `Popover` wraps it in a `div`. An `inline-flex` trigger gave that
  div a 24px line box, which grew the legend and pace title rows from 16px to 24px. Measured before
  and after: with `flex`, everything apart from the subtitle is pixel-identical at seven widths.
- **Tip copy follows the code, not the brief's example.** The brief suggested the heatmap's tip say
  shade is "applications/updates that day". Shade is applications added only (`heatLevel(cell.count)`),
  so the tip says that, and that a day of status updates alone looks empty but is an active day.
- **Accepted:** at 320 the "1.3 updates for every application added" line wraps to two lines (the
  column is 226px; text plus icon is wider), adding 16px there only. A panel opened near the
  viewport's bottom flips above its icon, as every anchored panel does, and can cover the figures it
  explains until the page is scrolled.
- **Open, found by the Task 1 data check and not changed here:**
  - The goal line is a 1px top border whose box ends at the goal value, so it is drawn just above
    it. A week at exactly the goal ends 1px under the line's top, and with rounded bar tops it reads
    as falling short. On the demo data, two of the three "Goal met" weeks are exactly 5, so the chart
    visibly shows one week reaching the line while the text says three.
  - The heatmap shades added applications only, while Active days counts added or moved. The demo
    account shows 55 active days against 30 shaded squares.

## The Activity figures get a title, their ratio becomes a caption, and a rule sets Weekly pace apart (6 Oct 2026)

- **Why:** "1.3 updates for every application added (?)" sat 16px above "Weekly pace (?)", in the
  same 12px subtle text with the same icon, so it read as a second section heading. It is the
  Added/Status updates summary and has nothing to do with Weekly pace.
- **What:** the three figures are a titled section, "Follow-through" with its (?) beside it, the
  label PR #76 proposed and the Weekly pace title's own style. The ratio line keeps its text and its
  style (12px, `text-content-subtle`, the same as "of N days", which it already was), loses its (?),
  and sits 4px under the figures row. Its explanation stays in "About these figures", moved to the
  end of the tip. Inside the figures the gaps are 8px under the title and 4px under the row.
- **A hairline rule rather than a wider gap.** Where the app splits two regions of one surface it
  uses a `border-t border-border` hairline (modal footers, settings sections, the filters popover's
  last row, the Upcoming list's rows). No surface uses a gap bigger than its usual 16px section
  rhythm to mark a boundary. The rule sits on Weekly pace's section with 8px either side: 17px
  between the groups, rule included, against at most 8px inside either one. A gap that separates on
  its own (24px) was prototyped too and works, but costs 7px more of the pace plot (36px against
  43px at a real 1024 window), and in the stacked layout it would be wider than the 16px between the
  heatmap and the figures.
- **The ratio is not a sub-line of Status updates.** Measured on the built card, that column is
  80px wide at 320, 83px at 375, 64px at 768 and 1024 and 179px at 1440, and only 211px at 1920, for
  a 207px sentence, so it would wrap at every width but the widest. It stays a full-width line,
  where without the icon it is now one line at every width, 320 included (PR #76 accepted a
  two-line wrap there).
- **Measured on the real build, both themes, at 320, 375, 768, 1024, 1440 and 1920:** no figure
  label or numeral wraps or overflows; the ratio line is one line, has no button, and computes to
  the same `12px 400` and colour as "of N days" in each theme; the gaps are 8px under the title, 4px
  under the figures row and 8px under the pace title, against 17px above Weekly pace with a 1px solid
  `border` rule in it. Beside the grid (768 to 1920) the card's height is unchanged from `main` and
  the grid row is not stretched; stacked, the card is 5px taller at 320 (the title and rule, less the
  ratio's lost second line) and 21px taller at 375.
- **Cost: the pace plot's floor beside the grid drops from 48px to 36px.** Beside the grid the
  column must never be taller than the grid and legend rows, and its spare height (plot minus
  floor), measured on `main`, is 11.6px at a 40rem card, 24.4px at a 1024 window's 662px card, and
  only 15.7px at 1024 with a classic Windows scrollbar (a 647px card; headless Chromium hides
  scrollbars, so the e2e suite sees 662). The title row and the rule cost 21px together, so at 48px
  the column would have set the card's height from 640px to 655px cards, real 1024 windows included.
  Moving the 40rem rule instead would have sent a real 1024 window to the stacked layout. At 36px the
  plot is 38.6px at a 40rem card, 42.7px at a real 1024 and 51.4px at a headless one, and unchanged
  wherever there was room (it grows to fill).
- **Tests:** `activityExplainers.test.tsx` pins the ratio line as a `p` directly after the figures
  with no button in its block and the same text utilities as "of N days", the figures' tip beside
  the "Follow-through" title, and the side column's two sections with only Weekly pace's ruled off
  and the ratio line the last thing before the rule. All three fail against `main`'s components. In
  `e2e/audits/heatmap.spec.ts` a new test measures, at 320, 375, 768, 1024, 1440 and 1920, that no
  figure wraps or overflows, that the ratio has no button and the computed style of "of N days", and
  that the gap above Weekly pace is at least twice every gap inside a group, with a 1px rule in it.
  Two existing assertions changed deliberately: the figures' section, not their `dl`, is level with
  the grid (the title is now its top edge), and the plot floor reads 36px, not 48px.

## The heatmap shades added or moved, the goal line sits on the goal, and the heatmap has a title (6 Oct 2026)

- **Why the heatmap's definition changed (the user's decision on PR #76's open question):** shade
  was applications added only, while Active days, beside it, counts days an application was added
  or moved. Both numbers were right, but the card showed 55 active days next to 30 shaded squares
  on the demo account, and no reader counting squares could get from one to the other. SPEC
  section 6 asks for "activity per day", which the wider definition fits better, and a day spent
  following up is a day spent on the search. Now a square's level is `dayActivity` (applications
  added plus the corrected status updates), and the same function decides an active day, so the
  shaded squares equal the Active days figure by construction. On the local demo seed: 30 shaded
  of 53 active days on `main`, 53 of 53 on this branch, at every width and in both themes.
- **Data:** the per-day `updates` `buildCells` already carries (PR #72's `statusChanges − created`,
  so an application's opening entry never shades a square on its own). No server query changed.
  Intensity is relative to the busiest day by the same measure. Cell titles read
  "1 Oct 2026: 0 added, 3 status updates", and the screen-reader summary gives both totals "on N
  active days". The heatmap's tip says shade counts both, and that the shaded squares add up to
  Active days.
- **Weekly pace stays additions only**, because the goal is applications added. Its tip now says so
  plainly ("Only applications added count here and toward your goal"), because a busy column above
  a short bar would otherwise look like a bug.
- **Goal line: built like a bar, not offset from one.** It was a 1px top border on a 1px box whose
  bottom sat at the goal, so the stroke filled the pixel row above a week of exactly the goal, which
  ended 1.000px under it and read as falling short. It is now a box standing on the plot's floor,
  `height: barPercent(target, scale)` with the bars' own scale and `min-h-1` floor, with the dashed
  stroke inside its top edge. The browser resolves and snaps that height exactly as it does a
  bar's, so a bar at the goal shares the stroke's pixel row at any plot height or zoom. With the
  goal set to 4 in the browser (three demo weeks sit on it), measured at 375, 1024, 1440 and 1024
  with a scrollbar: those bars ended 1.000px under the stroke on `main` and 0.000px on this branch,
  and the bars reaching the line went from 2 to 5, matching "Goal met in 5 of 12 weeks". A pixel zoom at device scale 1
  shows the stroke along those bars' top edge.
  `goalLinePercent` is removed; its two unit cases now assert the line's own height.
- **Accepted limits:** the shared `min-h-1` floor means that if a goal is under 4px of plot (a
  tiny goal against a very busy week), an empty week's 4px stub reaches the line too. Without the
  shared floor it would cross the line instead, which reads worse. A week one below the goal clears
  the 1px stroke only if one application is more than 2px of plot. The demo is at 6.7px or more at
  every width.
- **Heatmap title: "Daily activity", a new first row of the existing grid.** The labels, grid,
  legend and stacked side column are now placed by row as well as by column, because with the
  title in row 1 auto-placement would have put the weekday labels in the spacer track. The row gap
  is 8px (title to grid, as in the side sections). The legend and the stacked column take 8px of
  margin, so the spacing below the grid is unchanged. Beside the grid the side column spans the
  title row too, so "Follow-through" is level with "Daily activity" and the figures row with the
  grid's top row. The title is `contain: inline-size`, like the legend, so it cannot widen the
  label column. The (?) moved from the end of the legend to beside the title. No breakpoint, track
  or width changed.
- **Cost and the 1024 check:** the card is 24px taller at every width. Grid and cell sizes are
  unchanged at every width. Because the side column gains the same 24px, the pace plot grows: 42.7
  to 66.7px in a real 1024 window with a classic scrollbar, 51.4 to 75.4px at a headless 1024, 60.8
  to 84.8px at 768, and 117.6 to 141.6px at 1440. It stays 80px at 375.
- **Tests:** client tests pin shading equal to Active days in PR #70's zones and times
  (Kuala Lumpur 07:30 and 23:59, Los Angeles 01:00 and 22:30) with days of moves alone, the cell
  titles and summary, and the line's construction. All 12 new or changed client tests fail against
  `main`'s source. The PR #70 cases in `heatmapCells.test.ts` are unchanged and pass. A new
  `e2e/audits/demoFigures.spec.ts` test loads the real demo set into a fresh account
  (`POST /applications/demo-data`). At 375, 1024 and 1440 it checks that every week of exactly the
  goal touches the stroke, every week under it clears it, and the number of bars reaching the line
  equals "Goal met in N". It counts shaded squares by computed colour and checks they equal Active
  days. It then sets the goal to a week the data has, below the busiest, so the touching case
  always runs. Two assertions changed deliberately: "Follow-through" is level with "Daily
  activity" (it was level with the grid), and the explainer test lists three section titles.

## The Applications search field joins the toolbar: aligned, with its icon and one clear button (6 Oct 2026)

- **The 3px offset was a hidden label in a spaced stack.** `TextField` spaces its children with
  `space-y-1.5`, and a visually hidden label is still the first child, so the input got a 6px top
  margin with nothing above it. In the toolbar's centred row the field's box was 42px tall, so the
  input sat 3px below the buttons at both edges (161.95–197.95 against 158.95–194.95 at every
  width, both themes). A hidden label now renders inside the input's own box, so nothing in the
  spaced stack precedes the input. Visible-label markup is unchanged.
- **The toolbar is 6px shorter at every width (the user accepted this as the fix, not a
  regression):** 42→36 at 1440 and 768, 86→80 at 1024, 130→124 at 375, and the table or card list
  below moves up 6px. Rows and wrapping are unchanged: one row at 1440 and 768, New application
  alone on row 2 at 1024, three rows at 375. Every field and button is now 36px tall, with the same
  top and bottom edges on each row.
- **Other fields:** the toolbar search is the only `TextField` with `labelHidden`. `DateField` and
  `PasswordField` wrap `TextField`, but no caller hides their label. `Select` and `TextArea` have
  the same pattern (the bulk-action bar's status select and the notes editor) and were left alone
  on purpose. Measured before and after on the Settings page (11 fields) and the New application
  modal (9) at 1440 and 375: all 40 input, label and field-box readings are identical.
- **The icon was rendered but painted under the input.** It was an absolutely positioned sibling
  before the field, and the field's positioned wrapper, later in the DOM, painted over it with the
  input's opaque background. `TextField` has a `leading` slot rendered after the input. The 37px
  text inset is unchanged: 1 + 12 + 16 + 8, the same spacing as the buttons' own icons.
- **Clear button:** "Clear search", in `TextField`'s existing `trailing` slot, shown only while
  there is text. It writes through the same debounced path as typing and returns focus to the
  field. The native cancel button is hidden with `::-webkit-search-cancel-button { display: none }`.
  Chromium does not resolve `getComputedStyle` for that pseudo-element (it answers `inline-block`
  either way), so it was checked by pixels and the e2e test checks the stylesheet. `pr-11` keeps a
  long query 13px clear of the button.
- **Kept as they were, by decision:** the focus ring (the app's one `:focus-visible` convention, the
  same ring the buttons get, 12.56:1 against the page in dark and 14.88:1 in light) and the border
  and background tokens. The field already used the buttons' `border` and `surface`. The "fainter
  border" in the report is not in the styles: field and buttons both measure 1.39:1 against the
  page in dark and 1.11:1 in light. The field has no hover change, as before. Placeholder contrast
  was already 5.40:1 in dark and 8.22:1 in light.
- **Placeholder now names tags.** Search has always matched company, role, tags and notes
  (`buildFilter`), so "Search company, role or notes" undersold it. It now reads "Search company,
  role, tags or notes". Search behaviour is unchanged. Server tests for tag and notes matching
  are added, since the placeholder now promises them. They pass on `main`, because the behaviour
  was already there, and fail with tags and notes removed from the `$or`.
- **Tests:** four client tests on the toolbar (icon inside the field and after the input, clear
  button only with text, Tab, Enter and Space, name kept and placeholder) and three `TextField`
  tests. Six fail against `main`. The seventh, a visible label stays first, is a guard that passes
  on both. jsdom cannot see geometry, so `e2e/audits/searchField.spec.ts` (client address 14, one
  sign-up) checks edges against Filters at four widths, the icon on top by hit test, the native
  cancel hidden, and a long query clear of the button. It failed on `main` with a 3px top-edge
  difference and passes on this branch.

## Export CSV offers "Shown columns" or "All fields" (6 Oct 2026)

- **Behaviour.** Export CSV is a two-choice menu. **Shown columns** carries only the table's
  columns that are currently visible; **All fields** is the previous export, byte for byte. The
  JSON export in Settings → Your data is untouched and remains the complete backup.
- **Shown columns carries only table columns.** Each of the nine table columns maps to fixed CSV
  fields, and Source also brings `sourceOther` so "Other" never arrives without its text. Fields
  with no table column (work mode, employment type, links, notes, resume version, stipend, contact,
  archived, createdAt) are only in All fields. Headers and cell values are exactly All fields' own,
  in its order, whatever order the columns were asked in.
- **The server whitelists, it does not project.** `GET /applications/export` takes an optional
  `columns=company,status,…` checked against those nine ids. Anything else, an empty list, or
  `columns` with `format=json` is a 400 `VALIDATION_ERROR` naming `columns` and listing the allowed
  ids. Without the parameter the code path is the original one, so other callers keep the full file.
- **Same source as the table.** The client derives the list with the same `visibleColumns()` over
  the same stored choice the table renders from, so the file and the table cannot disagree. With
  only the locked Company and Status on, "Shown columns (2)" still works.
- **Phones.** Below 768px the list is cards, which ignore the column choice. Shown columns still
  follows the Columns menu there, not what the cards show. Recorded as a known limitation.
- **Rows are unchanged, on purpose.** Both choices still export every application on the account,
  archived ones included, whatever the search or filters. Changing that would break All fields'
  byte-identity and is its own decision: issue #83. A consequence worth stating: Shown columns has
  no `archived` column, so archived rows cannot be told apart in it.
- **No formula escaping, on purpose.** Neither path escapes cells beginning with `=`, `+`, `-`, `@`,
  tab or CR, as before. Escaping one path would make the two files disagree; escaping both would
  break All fields' byte-identity and needs import to strip the guard. Tracked in issue #82; a
  server test pins that both paths write such values identically until that fix lands.
- **Import.** A Shown columns file re-imports only if Role is shown (import requires company and
  role); archived rows come back active and unshown fields take their defaults. The menu says "May
  not import again if Role is hidden". "All fields … Can be imported again" is backed by a server
  test that round-trips a record with every field set, dates and archived included.
- **The menu is an opt-in `role="menu"` mode on `Popover`, not a new component.** It adds
  `aria-haspopup="menu"`, focus on the first item when opened, arrows (wrapping), Home and End;
  Escape and focus return were already there. Filters, Columns and the date picker pass neither
  `role="menu"` nor `busy`, and their tests are unchanged. The trigger keeps the old button's label,
  icon and classes with no chevron; while a download is prepared the icon becomes a same-size
  spinner and the trigger is `aria-busy`, where the old button swapped its label to "Preparing".
- **Panel width 240px, not 256px.** A 256px panel, right-aligned under the trigger, started at
  x = −1.1 at 375px. The menus' standard 240px panel starts at x = 14.9.
- **Measured on real builds, against the same 69-row in-memory account.** Toolbar on `main` and the
  branch, light and dark: 1440, 1024 and 768 are 1 row, 36px; 375 is 3 rows, 124px. Every child
  box is identical to `main` at all eight, and the trigger is 123.86px wide. Five real downloads
  returned 200 with `attachment; filename="applications-2026-10-06.csv"`, and all carry the same
  69 rows in the same order. All fields is byte-identical to `main`'s export (sha256 `0117ee81…`).
- **Tests.** 13 server tests (11 fail on `main`; the two that pass are the absent-parameter and
  round-trip guards), 8 client tests (all fail on `main`), and `e2e/flows/09.export-columns.spec.ts`
  (client address 15, one sign-up), which parses three real downloads. `06.export-csv.spec.ts` and
  `exportCsv.test.tsx` now pick "All fields", with their assertions unchanged.

## The scrolling Popover menus share the select's inset panel (7 Oct 2026)

- **What was wrong:** Filters (723px of checkboxes in a 318px window) scrolls at every width and
  height. `Popover`'s default menu panel was the plain card, `border p-2`, so, like the select
  before PR #64, its scrollbar was drawn just inside the 1px border: a 15px classic bar whose
  corner stood 3.73px past the curve of the edge, over both right-hand corners, in both themes.
  Its colours were the browser's (`scrollbar-color: auto`, following `color-scheme`). Columns
  (268px) and Export CSV (132px) use the same panel but do not scroll today. The calendar and
  InfoTip pass their own classes and never scroll.
- **Fix:** PR #64's construction moved into one class, `.scroll-panel` in `index.css`: a
  transparent `border-4`, the 1px outline edge, `shadow-float-cast` plus the redrawn lift, a thin
  `border-strong` scrollbar on a transparent track, and a `Canvas` border in forced colours. The
  select's picker applies it with its own `my-1 max-h-96 p-px text-content`. Popover's default
  menu panel applies it with `max-h-80 w-60 overflow-y-auto p-[5px]` (4 + 5 = the old 1 + 8). A
  panel given its own classes keeps `cardSurface shadow-float`, so the calendar and InfoTip are
  untouched.
- **Why `selectPanel.test.tsx` changed (decided with the user):** it read the picker rule's own
  text for its tokens, which now live in the shared class. Its three affected cases read the same
  tokens from `.scroll-panel`, and a new case holds the picker to applying it. No assertion was
  removed or loosened. Sharing the class and leaving that file untouched could not both hold.
  A selector list (`.scroll-panel, .select-control::picker(select)`) would have kept the text,
  but a browser without `::picker()` drops the whole list, so the menus would lose the fix there.
- **The select did not change:** the computed picker style and option boxes are identical in 28
  of 28 cases. Full-viewport frames of all five form selects, the table's status pill and
  Timezone, open and scrolled, in both themes, at 1440×900 and 1366×650, are byte-identical
  (36 of 36) between the branch and a second run on `main`. The first run on `main` differed from
  both in 8 frames, by at most 2 levels, on the closed field's edges only.
- **Measured** at 375, 768, 1024 and 1440 wide, 900 and 650 tall, in both themes, with real
  scrollbars (64 panel states): every panel's position and size is unchanged, and content starts
  9px in, as before. Filters' content width goes from 207 to 212px (the bar from 15 to 10px), and
  its scroll range is 421px both times. The bar's corner now sits 0.51px inside the edge's curve,
  and the right corners match the left ones again (top-corner difference 40 → 1 in light, 25 → 1
  in dark).
- **Columns and Export CSV:** their content and boxes are identical. Apart from compositing noise
  of at most 3 levels, which `main` shows between two identical Export frames (up to 42,852
  channels), only the corner arcs change: at most 13 levels at 768 to 1440. At 375 it is up to 63
  levels on 11 to 17 arc pixels, where the arc sits over a neighbouring button's dark focus ring.
  The date picker's 16 frames have 0 changed pixels.
- **Behaviour:** Tab walks Filters' 22 stops, and the panel follows focus to the end; Shift+Tab,
  Escape (focus returns to the button) and Tab-out (the panel closes) work as before. The wheel
  scrolls the panel, not the page. In forced colours the border is `Canvas` and the edge is the
  outline.
- **Tests:** `popoverPanel.test.tsx` (2 of 3 cases fail on `main`; the third guards the plain
  card) and `e2e/audits/popoverScrollbar.spec.ts` (client address 16, one sign-up). The spec
  launches with scrollbars shown and checks colour, geometry and the pixels on and outside the
  edge with and without the bar. On `main` all three fail (`auto`, 3.73px, 60 levels). It covers
  1440 and 768: at 375 a new account's toolbar wraps so Filters' panel runs off the screen,
  which is a positioning bug (issue #85).
- **Not done:** positioning. The Columns menu at 375 opens about 117px off the left edge (issue
  #85). This change was visual only and kept every panel where it was.

## "Clear filters" sits beside Filters, shows for filters only, and stops moving Filters at 1440 (7 Oct 2026)

- **What changed:** the toolbar's "Clear filters" now comes right after Filters, before Columns,
  in both the DOM and the tab order. It is `Button variant="secondary" size="sm"` with a 16px x
  (`CloseIcon`). That gives it the same box and tokens as Filters, Columns and Export CSV, so it
  is no louder than Filters, and New application stays the only filled button. It was a `ghost`
  button with no border or icon, placed between Columns and Export CSV.
- **When it shows (decided with the user):** for anything that narrows the list except search
  text (`hasFiltersBeyondSearch`). That covers the panel's boxes, Show archived, and the
  link-only `company`, `tags`, `workMode` and date filters, so a shared `?tags=` link can still
  be cleared from the toolbar. Search text has its own clear button in the field. Counting it made
  the field shrink about 300 ms into typing, and at 768 it added a toolbar row (+44px). When the
  button does show, it clears what it always did: every filter and the search text, plus sort and
  page size (`EMPTY_FILTERS`). The empty state's "Clear filters" still uses `hasActiveFilters` and
  still appears for a search with no results.
- **Focus:** clicking it moves focus to the Filters button first, then clears. On `main`, focus
  fell to the page body when the button disappeared.
- **Why the search field is capped (option B, decided with the user):** the field took all the
  spare width, so any button that appeared came out of it and pushed Filters left. That includes
  the panel open under Filters: on `main`, ticking the first box moved it 129.9px left at 1440 and 1024. Moving the button alone could not fix that. From `xl` the field now stops at 24rem
  (`xl:max-w-sm`) and Columns takes `xl:ml-auto`, so the button fills free space instead. To allow
  that, `Popover` gained an optional wrapper `className`. The cost is the field's width at rest
  at 1440: 604px becomes 384px. The placeholder needs 270.4px.
- **Measured** with real scrollbars at 1440, 1024, 768 and 375, with and without a filter, in both
  themes (identical): row count and height match `main` in every state (1/1, 2/2, 1→2 and 3/3
  rows; 36, 80, 36→80 and 124px), with no overlap, no clipped label and no sideways page scroll.
  The open panel's movement when the first box is ticked, `main` → branch:
  1440 −129.9 → 0, 1024 −129.9 → −24.1, 768 +26.8 → +0.8, 375 −26.6 → −26.6.
- **Known limitation (accepted with the user):** from 1280 to about 1375px the open panel still
  moves, by −96.1px at 1280. The 24rem field leaves 60px spare there, and showing the button needs
  about 156px: the badge +26.6, the button 121.4 and one 8px gap. `main` was not measured at 1280.
  It moves −129.9px at both 1440 and 1024. At 1024 and 375 the remaining movement is the Filters
  count badge widening the button, which `main` does as well. Tracked in #87.
- **Two-step cap, considered and not built:** 18rem (288px) from `xl` and 24rem from about 1376px
  would give 0 at 1280. Its cost is a 288px field at rest there instead of 384px. Correction to the
  estimate that 288px is narrower than the placeholder needs (about 320px): the placeholder
  measures 270.4px (220.4px of text in Archivo 14px, plus 36px left padding, 12px right and 2px of
  border), so it would fit with 17.6px to spare.
- **Found, not fixed:** a search that returns few rows can remove the page scrollbar. That widens
  the toolbar by 15px, and at 1024 it moves New application back to row 1. On `main` the old
  button hid this. `scrollbar-gutter: stable` is the usual fix (#88).
- **Tests:** `client/tests/applications/clearFilters.test.tsx` has 7 cases. 4 fail on `main`:
  search text alone, the position after Filters, and focus after Enter and after Space. "Show
  archived" and the link-only filter pass on `main`, which shows the button for both. They fail
  against a boxes-only rule, the alternative the user declined. "Shows for a status" is a sanity
  check that no version tried makes fail. `e2e/audits/clearFilters.spec.ts` (client address 17,
  one sign-up) runs at 1440 and checks three things: Filters does not move, Clear filters comes
  next in the DOM and on Tab, and focus lands on Filters after Enter. On `main` all of them fail
  (moved 129.94px, not next, not reached by Tab, focus not on Filters). It does not check the
  panel at 375, where its placement is #85.

## The Board fits the window, names its columns, and draws the dragged card in an overlay (7 Oct 2026)

- **What changed:** where the window is at least 768px wide and 560px tall (the new `board-fit`
  screen in `tailwind.config.ts`), the board takes the height left under the top bar, any banner
  and its header. Each column's list scrolls under the column's name and count, which stay put.
  A row of buttons above the board ("Jump to column", `BoardJumpStrip`) names every column with its
  count and scrolls the board to the one clicked. A dragged card is drawn in dnd-kit's
  `DragOverlay` (`BoardDragLayer`) instead of being moved in place.
- **The height rule (decided with the user):** both bounds or nothing. Below either one, on
  phones in portrait and on a landscape phone (844×390), the board stays in the page's normal flow
  as before, so there is no scroll inside a column that could trap the page. The height comes from
  a flex column from `AppLayout` down, on the board route only, not from a `calc()`. The
  verification banner and the "Showing 100 of N" line come and go, and a fixed offset would clip
  the board by their height. The shell is `100svh`, the height with the browser's toolbars
  showing, so nothing is cut off under them.
- **Measured** on the built app with real scrollbars, in both themes (identical). This is the
  vertical scroll needed before the sideways scrollbar is on screen, `main` → branch, with the
  demo data:
  - 1440×900: 1591 → 0
  - 1024×768: 1723 → 0
  - 768×1024: 1467 → 0

  On the branch the page doesn't scroll at those sizes. The scrollbar sits 24px above the window's
  bottom, and with Saved scrolled to its end its header is still hit-tested on top and its last
  card is not cut off. At 375×812 and 844×390 the board matches `main`: 2335px tall, columns
  2312px, cards 270px wide. It sits lower by the strip, 54px at 375 and 44px at 844.

- **Costs:**
  - Cards are 268px wide in the fitted layout, not 270. A column's list reaches 8px into the
    column's right padding and keeps a stable 10px gutter for the thin scrollbar. So every
    column's cards are the same width whether or not its list scrolls; otherwise they'd be 260px
    in scrolling columns and 270px in the rest.
  - The page's own scrollbar goes on the board route, so the content area there is 15px wider
    than on other routes.
  - The board and its lists use the scroll panel's themed scrollbar (`.scrollbar-themed`, the
    same `border-strong` thumb). It is 10px thick rather than the browser's 15px.
- **The strip (decided with the user):** one row that scrolls sideways itself rather than wrapping.
  It is 40px tall and fits on one row from 768px up (712 of 712px at 1024). At 375 it shows 3 of
  its 8 buttons, plus a 10px scrollbar where scrollbars are classic. Wrapped, it would have been 3
  rows and 120px, a fifth of the board. Focus stays on the button after a jump. Moving it into the
  column would give keyboard users a shortcut past every card's two buttons, but that's new focus
  handling, which this change was asked not to alter. It remains a possible follow-up.
- **A side effect fixed on the way:** each card's `DeadlineChip` has `sr-only` text, which is
  `position: absolute` and was placed against the board (`relative`). Once the lists scrolled,
  those boxes sat where an unscrolled list would put them and gave the board about 2,300px of
  vertical scroll of its own. Each list is now `relative` as well. The board's vertical overflow
  is 0 at every size.
- **DragOverlay (the user's rule: add it only if columns made clipping worse):** measured as the
  share of the dragged card actually painted (hit-tested on a 9×5 grid) for three fixed gestures at
  1440×900:

  | Gesture               | `main` | columns only | with the overlay |
  | --------------------- | ------ | ------------ | ---------------- |
  | sideways onto Applied | 0%     | 0%           | 100%             |
  | down inside Saved     | 100%   | **60%**      | 100%             |
  | onto Assessment, low  | 0%     | 0%           | 100%             |

  It was worse, so the overlay went in. It also fixes the sideways case, which was already broken on
  `main`: the column's `overflow-y-auto` list clipped a card as soon as it left. The card stays in
  its slot at `opacity-0`, leaving the gap it always left. The copy has the moving card's old look
  (`opacity-60`, primary ring), and `dropAnimation={null}` keeps drops instant. Collision detection
  and `onDragEnd` are untouched. `BoardCardFace` holds what a card shows, so the card and its copy
  cannot drift apart. `@dnd-kit/utilities` is no longer used and has been removed from the client's
  dependencies (`@dnd-kit/core` still pulls it in).

- **Auto-scroll inside a tall column:** dnd-kit scrolls only the scroll containers around the
  droppable being hovered (`useScrollableAncestors(overNode)`). A column's droppable is the whole
  `<section>`, and its scrolling list is a child of it, so dnd-kit never scrolls a list. On `main`
  the window scrolled instead. `useColumnAutoScroll` scrolls the list under the pointer within 56px
  of its top or bottom edge, up to 14px a frame. It works for pointer drags only: a keyboard drag
  steps a whole column and a drop lands anywhere on the column. Measured: holding a card at the
  bottom of Saved scrolls it 17 → 1213px in 1.5s, and the same for a tall target column. Sideways
  auto-scroll is dnd-kit's own and unchanged: Saved to Withdrawn took about 1s.
- **Unchanged, and checked:** keyboard moves step one column per arrow press. Seven ArrowLefts from
  Withdrawn land in Saved, and the board scrolls 300px per press. Enter starts a move like Space.
  Escape cancels and returns focus to the same Move button. After a keyboard drop, focus is on
  `<body>` on both `main` and the branch.
- **Test utility changed on purpose:** `mockBoardLayout` in `client/tests/utils/dnd.ts` now measures
  the overlay's copy as the card it copies. A browser opens the overlay exactly there, and dnd-kit
  measures that copy in place of its wrapper (`getMeasurableNode`). Without it jsdom reported a box
  at the origin, the keyboard getter started from column 0, and the two keyboard cases in
  `dragAndDrop.test.tsx` failed. No assertion changed.
- **Found, not fixed:** dnd-kit's default announcements read the card's database id and the raw
  status key ("Draggable item 6ac6… was moved over droppable area withdrawn"). Tracked in #90.
- **Tests:** `client/tests/board/jumpStrip.test.tsx` has 3 cases: names and counts in order, a
  smooth scroll of the board to the column with focus left on the button, and no smooth scroll under
  reduced motion. All 3 fail on `main` (no strip). `e2e/audits/boardScroll.spec.ts` (client address
  18, one sign-up) covers the following:
  - At 1440×900 and 768×1024: no page scroll, the board's bottom edge on screen, the tall column
    scrolling, and no vertical scroll on the board.
  - The header staying put with the list scrolled to its end, and the last card not cut off.
  - The strip reaching Withdrawn.
  - The dragged copy hit-tested over the next column, and a held card scrolling the list.
  - At 844×390 and 375×812: no scroll inside a column, and the page scrolling.

  Headless Chromium hides scrollbars, so it finds the scrollbar by the edge it is drawn on. Locally
  it passes on the branch. On `main`'s build it fails: the page scrolls 503px, the edge is at
  1379px of 900, the column does not scroll, and there is no strip.

## Cards without a deadline show no chip instead of a bare "—" (8 Oct 2026)

- **What changed:** `BoardCard` and `ApplicationCardList` render `DeadlineChip` only when
  `toDate(application.deadline)` is not null, the same test the chip uses before it falls back to
  "—". On the board the chip row renders only when there is a chip or a tag, so a card with
  neither has no empty row. `DeadlineChip` is unchanged: the table's Deadline column keeps its
  "—", which reads as "none" under the column header. Nowhere else does the dash appear without a
  label. The detail page's "Deadline" fact sits under a `<dt>`, the stat card has a title, and
  Upcoming events always have a date.
- **Why the board cards were uneven:** the dash was bare text in the flex row, so the row took the
  body's 24px line box, against 20px for a row of badges. Every no-deadline card was 4px taller,
  tags or not. Measured on the real build with real scrollbars, the same in light and dark and at
  1440, 768 and 375 (cards are 288px wide at every size), using demo cards:

  | Kind                 | Demo card            | Before         | After                         |
  | -------------------- | -------------------- | -------------- | ----------------------------- |
  | a. deadline and tags | AirAsia MOVE, Saved  | 128            | 128                           |
  | b. deadline only     | Datadog, Saved       | 128            | 128                           |
  | c. tags only         | Shopee, Saved        | 132 (24px row) | 128 (20px row)                |
  | d. neither           | Razer, Saved         | 132            | 98 (no 10px gap, no 24px row) |
  | "— react"            | Sea Group, Interview | 132            | 128, "react" at offset 0      |

  After the change no dash is left on the board's 62 demo cards, and 11 cards render no chip row.

- **The card list was added after the original brief, at the user's request.** It shows only
  below 768px (`max-width: 767px`), so it was measured at 767, its widest width, and at 375. The
  status select does not move: it is at x 97, y 73 on every card, before and after.
  - **767:** every card is 114px before and after. On cards without a deadline the priority badge
    moves 24px left into the dash's place (16px dash + 8px gap), for example Shopee 203.2 → 179.2.
  - **375:** cards with a deadline are unchanged at 142 (one at 170, whose long overdue chip
    wraps). Cards without a deadline were 142 or 114 and are now all 114. On four of them
    (Shopee, Grab ×2, Sea Group) the priority badge moves from line 2 up to line 1.
- **Accessibility:** the dash had no accessible name. The react card's tree read `text: — react`
  and now reads `text: react`. A screen reader spoke it as a dash or skipped it, never as "no
  deadline". A card with a deadline still says "Deadline 16 Nov 2026, in 39d", so the absence of
  that phrase still means no deadline, and the detail page lists the deadline under its label.
- **Unchanged, and checked on the branch build:**
  - The board fits the window: the bottom edge is at 876 of 900, 744 of 768 and 536 of 560, with no
    page scroll, and the horizontal scrollbar (10px) is on screen.
  - The jump strip brings Withdrawn into view.
  - A pointer drag from Saved to Withdrawn and a keyboard drag (Space, six ArrowRights, Space) to
    Ghosted both land.
  - Holding a card at the Saved list's bottom scrolls it 17 → 1213px in 1.5s.
  - The drag preview is the card's own size: 268×98 for the short card, 268×128 for the others.
- **Found, not changed:** the drag preview sits 60px right and 60px down of the card after the
  pointer moves (+60, +40). `main` gives the same 60/60 at 132px and 128px, so the extra 20px is
  pre-existing and unrelated to card height.
- **Tests:** `client/tests/applications/noDeadlineChip.test.tsx` has 6 cases. On the board: no dash
  without a deadline, the chip still shown with one, a tags-only row starting with the tag, and no
  row with neither. In the card list: no dash, and the chip still shown. The four dash cases fail
  on `main`; the two chip cases are guards and pass on both. `e2e/audits/boardScroll.spec.ts` is
  unchanged and runs in CI. It was not run locally because it signs up and signs in, and the
  capture session was limited to one sign-in.

## The Board's Move bar wears a grip mark and the subtitle names it (8 Oct 2026)

Users pressed the card body to drag and concluded dragging was broken. Only the Move button
carries dnd-kit's listeners. The handle-only design stays, because dragging a whole card fights
scrolling on touch. The handle is made obvious instead.

- **Handle:** a decorative `GripIcon` (six dots, added to the hand-drawn set in `icons.tsx`, since
  the app has no icon library) sits before the "Move" label. It is `aria-hidden` and
  `focusable="false"`. The accessible name stays `Move {company} from {column}`, which
  `board.test.tsx` already checks, untouched. The button keeps `cursor-grab`, its existing hover
  (`surface-muted` fill, `content` text) and the global `:focus-visible` ring. The icon takes
  `currentColor`, which against the card measures 8.22:1 (light) and 5.4:1 (dark) at rest, and
  16.83:1 and 11.64:1 on hover.
- **Grabbing cursor:** one base-layer rule in `index.css` sets `cursor: grabbing !important` on
  `:root` and every descendant while a `[data-drag-preview]` exists, because mid-drag the pointer
  is over the preview, not the handle. The drag preview component is untouched. The preview
  unmounts on every ending, so the rule clears itself. Checked in a real browser after Escape, a
  release over the page heading, a drop in Applied and a drop in Withdrawn: the body, the page
  heading and a sidebar link went back to `auto`, `auto` and `pointer`.
- **Subtitle:** "Drag a card by its Move bar to move it between columns." The old sentence was
  never an accessible description or dnd-kit's instructions: the handle's `aria-describedby`
  points to dnd-kit's built-in text ("To pick up a draggable item, press the space bar…"),
  which is unchanged, so screen-reader users lose nothing. Sighted keyboard users lose the visible
  "press space" hint, which was accepted.
- **Layout:** card heights are unchanged from `main` (128 / 128 / 128 / 98) and the Move button is
  unchanged (242×26 at 1440 and 768, 244×26 at 414 and 375), in both themes. The shorter subtitle
  fits on one line at 414 (two before), so the header there is 20px shorter (67.95 → 47.95) and the
  board starts 20px higher. At 375 it still wraps to two lines. At 1440 and 768 it was already one
  line.
- **Found, not changed:**
  - A plain click on the Move button does nothing: no menu, no dialog, focus stays on it. The label
    "Move" suggests more than the button does.
  - On touch (CDP emulation at 375px only, not a real phone), the handle never starts a drag: a
    sideways swipe neither drags nor scrolls. The handle's `touch-action` is `auto`. Filed as #95,
    because the fix changes drag behaviour.
  - Releasing a dragged card over the page heading, outside every column, does not cancel. The
    collision detection falls back to `closestCenter`, and the card lands in the nearest column
    (Applied, from Saved). Reproduced on `main`'s build.
  - The drag announcements read raw ids ("Draggable item 6ac7aa97… was moved over droppable area
    applied."). Added to #90.
- **Tests:** `client/tests/board/moveHandle.test.tsx` checks:
  - the new subtitle is shown and the old one is not;
  - the handle holds an `aria-hidden`, non-focusable `svg`, has the visible text "Move" and keeps
    the name `Move Stripe from Applied`;
  - dnd-kit's keyboard instructions are still the handle's accessible description.

  The first two fail on `main`; the third is a guard. `e2e/audits/moveHandle.spec.ts` (client 19,
  one sign-up) checks the computed cursors: `grab` on the handle and not on the card,
  `grabbing` everywhere mid-drag, and the resting cursors back after Escape, a release over the
  heading and a drop. It deliberately does not assert that dragging the card body does nothing, so
  widening the drag area later is not blocked. It runs in CI only, because it signs up and signs
  in, and the capture session was limited to one sign-in.

## Calendar day cards show the time alone (9 Oct 2026)

- **What changed:** the line under each card in the day panel reads "Technical · Video · 21:20"
  and "Application deadline · 22:45", not "… · 24 Sep 2026, 22:45". The heading above already
  names the day. A new `formatTime` sits next to `formatDateTime` in `lib/formatters.ts` and uses
  the same date-fns `format` (`HH:mm`, so 00 to 23, never 24). `formatDateTime` is untouched, so
  the Upcoming panel, the detail timeline and the version-conflict dialog look exactly as before.
- **Timezone: the browser's, as before (user's call).** The brief assumed the cards used the
  account timezone. They never did: the whole Calendar page (grid grouping, heading, panel filter,
  card time) uses the browser's, through date-fns. The cards keep doing so, which means a card's
  time and the day it sits under always agree. Moving the page to the account timezone is a
  separate issue.
- **Date-only deadlines show no time.** `isDateOnly` treats a deadline stored at exactly
  00:00:00.000 UTC as a date with no time. The card then reads "Application deadline" alone,
  where it used to show an invented time: "08:00" in Kuala Lumpur, "00:00" in UTC, and "17:00" on
  the previous day in Los Angeles. The trade-off: a deadline really set for 00:00:00.000 UTC
  loses its time too. It applies to deadlines only, so an interview at UTC midnight keeps its
  time. Which writers produce that exact value:
  - **The form:** always. A deadline is a date input, saved as `YYYY-MM-DDT00:00:00.000Z`.
  - **The API:** when sent a date alone (`2026-07-05`, which `z.coerce.date()` reads as UTC
    midnight) or that instant spelled out. Any other time is kept.
  - **CSV import:** the same schema, so a `2026-07-05` cell is date-only. A file exported by the
    app round-trips exactly, because the export writes `toISOString()`.
  - **The demo seed:** practically never. A deadline is `now` minus whole days and hours, plus
    whole days, so it keeps the seed moment's minutes, seconds and milliseconds (local runs gave
    times like 22:45:04.417).
- **Accessibility:** the time sits in `<time dateTime={at}>` with the date as screen-reader-only
  text before it, so Chromium's accessible name for a card is unchanged:
  "Sea Group Site Reliability Intern Online assessment · Video · 24 Sep 2026, 09:45". A date-only
  card's name ends "Application deadline , 24 Sep 2026", and that date uses the same local-day logic
  as the grouping, so it always matches the heading.
- **Heading year (user's call, an exception to "leave the heading").** The year is added when the
  day's year differs from today's **or** from the shown month's. The brief said "not in the
  current year". Read as today's year alone, picking a greyed 28 December 2026 cell while viewing
  January 2027 would still read "Monday 28 December" under a "January 2027" title, which is the
  case the change was meant to cover. So the panel takes the shown month as a prop. "Thursday
  24 September" (this year, this month) is unchanged.
- **Layout, measured on the real build with real scrollbars, the same in light and dark,
  using the demo day 24 September 2026 (4 events):** at 1440 the panel is 320px wide, so the two
  interview lines wrapped to two rows. Those cards drop from 90px to 74px, and the deadline cards
  stay at 74px. The panel itself stays 495px, because it stretches to the month grid's height. At
  768 and 375 every line was already one row: cards stay at 74px and the panels at 394px and
  386px. At 375 the month title sits 573px above the panel heading.
- **Tests:** `client/tests/calendar/calendar.test.tsx` adds 9 cases:
  - the card's visible text is the time alone, its `<time>` carries the instant, and its name
    keeps the date;
  - a date-only deadline shows no time and keeps its grid day for screen readers;
  - a deadline with a time keeps it;
  - near-midnight instants sit under the day they name in the runner's timezone, with three
    different account timezones, which must change nothing;
  - the heading's year in three cases.

  The suite was run under `TZ=UTC`, `Asia/Kuala_Lumpur` and `America/Los_Angeles`. In Git Bash a
  `TZ` value with a slash never reaches Node, so the zones were set from PowerShell, and Node
  confirmed each one. On `main`, 8 of the 9 fail in all three zones. The ninth ("Sunday 5 July",
  no year) is a guard. No existing assertion changed. The old cases matched only
  `/Application deadline/` and `/Technical/`.

## Calendar day-panel dots go solid and its cards take `border-strong` (9 Oct 2026)

Refs #100, #103.

- **Dots:** the day panel's dot now takes `EVENT_KIND_CONFIG[kind].dot`, the Upcoming panel's
  solid `bg-danger` or `bg-info`, instead of the grid's chip tint `EVENT_TONE`. On a chip the
  coloured text carries the colour and the 15% fill is a background. On a dot only the 15% fill
  paints, which measured 1.27 to 1.35:1. Solid dots measure 7.02 (deadline) and 6.79
  (interview) in light, and 6.46 and 7.31 in dark, against the card at rest. Against the hover
  fill they measure 6.14 / 5.94 and 5.80 / 6.55. `EVENT_TONE` and the grid's chips are untouched.
  The dot stays `aria-hidden`, because the card's third line already names the kind. It gains
  `data-event-dot`, matching `UpcomingRow`, so tests can find it. Red and blue differ in hue,
  not lightness (1.03 / 1.13:1 against each other), as they already do in the Upcoming panel.
- **Card box (option A, user's choice):** `border-border` became `border-border-strong` on the
  day-panel cards only. The card paints no fill, so it sits on the panel's `surface` with a
  fill step of 1.00 and the border is its whole boundary. Measured on the real build, the
  border against the panel went from 1.30 to 2.15 in light and from 1.27 to 1.72 in dark.
  **No existing token reaches 3:1**, and `border-strong` is the strongest; adding a token was
  out of scope. Two other options were measured and declined:
  - A `canvas` fill (1.17 / 1.09) leaves hover only 1.03:1 from rest in light.
  - A `surface-muted/40` tint (1.06 / 1.04) also weakens hover.

  `shadow-card` was ruled out because `tailwind.config.ts` reserves it for things that float.

- **Trade-off:** these cards' border now differs from the app's other cards, which keep
  `border-border`. They are buttons in a list inside a card, not cards on the page, and
  `border-strong` is what the ThemeToggle, attachment drop zone and empty states already use on
  a surface. Whether the app-wide token should be stronger is issue #103. The token itself is
  unchanged.
- **States, from pixels:**
  - Hover is unchanged at 1.14 (light) / 1.11 (dark) between the rest and hover fills.
  - The keyboard focus ring is unchanged at 17.45 / 11.48 against the panel.
  - There is no pressed style (`:active` looks like hover) and no open state, since a click
    navigates to the application.

  In dark the card box is still subtle (1.72 border, no fill step), only less so.

- **Layout and other surfaces, measured on the real build with real scrollbars, using the demo
  day 25 September 2026 (2 deadlines, 2 interviews):**
  - The panel and every card have identical positions and sizes before and after, at 1440, 768
    and 375, in both themes. Cards are 74px tall.
  - All six Upcoming panel frames are byte-identical.
  - Five of six month-grid frames are byte-identical. The sixth (1440 light) differs in 2 pixels
    at its bottom-left rounded corner, each by one channel value: anti-aliasing, not a change.
- **Tests:** `client/tests/calendar/dayEventsPanel.test.tsx` adds 10 cases:
  - solid dot classes;
  - dot `aria-hidden`;
  - two distinct dots;
  - dot contrast of 3:1 or more, computed from the class the panel renders and the theme
    tokens, against rest and hover fills in both themes;
  - card border class.

  Against the old styling, 7 of the 10 fail. The `aria-hidden` and distinct-dots cases are
  guards: the old dot was already hidden and distinct. No existing assertion changed. No e2e
  spec was added, because the unit tests cover the colours from the tokens.

## CSV export escapes formula-like cells, and import removes exactly that guard (18 Oct 2026)

Fixes #82 (CSV formula injection).

- **The rule lives in `server/src/utils/csv.ts`, the one serialiser both CSV choices and the
  importer share.** A text cell matching `^'*[=+\-@\t\r]` gets one leading apostrophe on export,
  and import removes one apostrophe from any cell that starts with one and matches the same
  pattern. Counting the apostrophe run as part of the trigger is what makes the pair exactly
  reversible: a note the user really wrote as `'=x` is exported as `''=x` and imports back as
  `'=x`. Papa's `escapeFormulae` was not used, because it does not handle that case and the
  trigger set should be ours and tested.
- **Numbers and booleans are never escaped** (`stipendAmount`, `archived`), because only string
  cells go through the guard. ISO dates never start with a trigger.
- **Legitimate leading `-` and `+` are escaped too** (`-remote`, `+60 …`). That is the cost of the
  standard mitigation: a spreadsheet shows the apostrophe only in the formula bar, and the
  round trip through import is unchanged.
- **Assumption: a hand-made CSV with a cell like `'-remote` imports as `-remote`.** The importer
  cannot tell our guard from a user's own apostrophe in a file we did not write. A spreadsheet
  hides that apostrophe anyway, so this is the reading the user saw.
- **Tests:** `application.exportColumns.test.ts`'s pinned "written raw" case was changed on
  purpose to expect the guard on both paths. `application.transfer.test.ts` adds an
  export → import round trip covering `=`, `+`, `@`, `-`, an apostrophe before a trigger, a
  plain leading apostrophe, and a numeric stipend. Against the old `csv.ts`, both cases fail.

## Date-only deadlines read as calendar dates; the Calendar reads the account timezone (18 Oct 2026)

Fixes #99, #98 and #102.

- **A date-only deadline is a calendar date, still stored at 00:00 UTC.** That is what the
  form, a date-only CSV cell and a date-only API value already write, so nothing changed in
  storage and no migration was needed. The reading changed: `formatDate`, `formatRelative`
  and `daysUntil` in `client/src/lib/formatters.ts` turn such a value into local midnight of
  the date it names, rather than converting the instant. Every caller gets the fix at once:
  the board and table chips, the detail page, the Upcoming panel and `appliedDate`, which is
  stored the same way. West of UTC, 5 July no longer shows as 4 July.
- **The alternatives were weighed and not taken.** A `YYYY-MM-DD` string field means a
  schema change, a migration and every consumer at once, for the same result on screen.
  "End of day in the account timezone" invents 23:59 instead of 08:00, and needs the user's
  zone on every write path.
- **Existing timed deadlines are left alone.** A deadline with a real time (API callers, the
  old demo seed) still shows its time on its local day, and `isDateOnly`'s documented
  trade-off stands: a deadline set for exactly 00:00:00.000 UTC reads as date-only.
- **The Upcoming row shows the date alone for a date-only deadline**, so it no longer
  invents 08:00 in UTC+8. Interviews keep `formatDateTime`.
- **The demo seed writes date-only deadlines**, so the demo stops showing seed-moment times
  such as 22:45.
- **`nextActionDate` keeps a date-only deadline through the day it names.** Before this, it
  dropped today's deadline at 00:00 UTC. The day ends at UTC midnight, not the account's,
  which is marked as a `ponytail:` ceiling in `application.service.ts`. The field only sorts
  and filters, and it is recomputed only on writes anyway.
- **The whole Calendar page moved to the account timezone together (option c in #98)**:
  grouping, today, the panel filter, and the interview card's time and screen-reader date
  (`formatDateIn` / `formatTimeIn`). Moving only the card time would let it disagree with the
  day it sits under. Grid cells stay plain calendar days, and events are matched to them by a
  `YYYY-MM-DD` key (`eventDayKey`). A date-only deadline keys on its own date in every zone.
- **The fetch window grew by two days on each side**, because the account's zone can sit up
  to 26 hours from the browser's. The grid drops what falls outside it.
- **`localDayKey` moved from `heatmapCells.ts` to `lib/formatters.ts`**, now that two
  features use it.
- **Tests:**
  - `calendar.test.tsx` no longer depends on the runner's zone. Its fixtures are fixed UTC
    instants under an explicit account zone, and the near-midnight table runs UTC,
    Kuala Lumpur, Los Angeles and Kiritimati on every runner. This closes #102 without
    setting `TZ` in CI.
  - The old "browser timezone, whatever the account says" case was replaced on purpose,
    because it pinned the behaviour #98 changes.
  - `client/tests/lib/deadlineDates.test.tsx` sets `TZ=America/Los_Angeles` for its own
    worker, so #99 is proven west of UTC in CI too.
  - Against the old source, 9 client cases and 1 server case fail.

## A Board drag released outside every column cancels (18 Oct 2026)

Fixes #97.

- **Pointer drags now resolve by `pointerWithin` alone**, so a release over no column is no
  drop, and the card and its status stay put, as they do on Escape. The `closestCenter`
  fallback had always found some column, so a release over the page heading silently changed
  the status.
- **Keyboard drags keep `closestCenter`.** dnd-kit gives them `pointerCoordinates: null`, which
  is what the collision function switches on, rather than on an empty `pointerWithin` result.
- **Test:** `dragAndDrop.test.tsx` releases 200px above the Interview column. Against the old
  code it sends the PATCH and fails; the keyboard cases are unchanged and pass.

## Export CSV carries the rows the list shows, and says how many (18 Oct 2026)

Fixes #83. The owner chose both behaviours on 18 Oct 2026.

- **Both choices follow the view.** Shown columns and All fields both apply the list's search,
  filters, "Show archived" and sort, and never its paging. `exportQuerySchema` is now the list
  schema without `page` and `limit`, plus `format` and `columns`, and the service reuses the
  list's `buildFilter`, so the two cannot drift apart.
- **The complete backup is Settings → Export all my data**, a separate endpoint this change
  does not touch. An `/applications/export` call with no parameters now hides archived rows,
  exactly as `GET /applications` does. This changes the API, and the OpenAPI entry says so.
- **Each menu choice states the row count** from the list's own `meta.total` ("18
  applications, as listed."), so it costs no extra request. The count sits in each item's
  description rather than in a caption, because a `role="menu"` may only hold menu items.
- **Tests:**
  - `application.exportColumns.test.ts`: the default row count changed from 3 to 2 on
    purpose, since the archived row is now hidden. The full-field round trip exports with
    `archived=true`, as a user would from the archived view. A new table covers search,
    status, Show archived and sort on both choices.
  - `exportMenu.test.tsx`: the descriptions now carry the count, and a new case checks that
    the request sends the view without `page`.
  - Against the old source, 7 server cases and 2 client cases fail.

## Search matches the "Other: please specify" text (19 Oct 2026)

Fixes issue #61.

- `buildFilter` adds `{ sourceOther: pattern }` to the search `$or`, so "Glints" finds a row the
  table shows as "Other: Glints". No index or migration is involved; see the corrected entry
  under "Malaysia-focused sources".
- **Placeholder unchanged:** it still reads "Search company, role, tags or notes". Adding
  "source" would lengthen the text the toolbar's search width is sized around (issue #87), and
  the free-text source is a niche field; matching it silently is enough.
- **Test:** `server/tests/application.list.test.ts` searches `glint` and expects only the row
  whose `sourceOther` is "Glints". It fails without the fix.

## The search field ignores the late echo of its own URL write (19 Oct 2026)

Fixes issue #91, which was filed as a possible test timing weakness. It is a real race in the
component, which the test only exposed under load.

- **Cause:** the router runs with `v7_startTransition`, so the search field's debounced URL write
  commits in a transition. When typing is slow enough for the 300 ms timer to fire before Clear
  search is clicked, the click empties the field first and the transition commits afterwards.
  The re-seed effect then saw `filters.search` change to "stri", put it back in the field and
  cancelled the queued write of the empty value. The field and the URL both kept the old term.
  That matches the failure in #91 exactly (the field held "stri", and the test took 1200 ms
  instead of its usual 400 ms).
- **Fix:** the toolbar remembers the last value it wrote (`lastWriteRef`), and the effect skips a
  `filters.search` equal to it. A change from anywhere else (Clear filters, a link, back and
  forward) still re-seeds the field and drops a pending write. The one case it no longer re-seeds
  is an outside change to exactly the term the field last wrote, where the URL already says what
  the field wrote.
- **Not changed:** the existing searchField test. It was right; the component was wrong.
- **Test:** `client/tests/applications/searchField.test.tsx` renders the toolbar directly, types,
  lets the write happen, clicks Clear and then delivers the late echo. Without the fix it fails
  with the field holding "stri", as in #91. A second case holds that an outside change still
  re-seeds the field.

## Dashboard cards shrink with the window, and Total says it counts archived rows (19 Oct 2026)

Fixes issues #79 and #80.

- **#79, confirmed before fixing.** On a real build with real scrollbars, loading the dashboard at
  1440 and narrowing to 375 without a reload left the document 713 to 749px wide (749 in the e2e
  run, as in the issue). Loading at 375 was fine. Chart.js pins each canvas to its last width in
  pixels, and every chart card is a grid item with the default `min-width: auto`, so the canvas
  held its card wide. The issue named only the timeline; measuring every card showed the four
  charts in the two-column grid stuck at 537px too, once the timeline was fixed.
- **Fix:** `min-w-0` on `ChartFrame`'s card, which is the grid item for four charts, and on the
  timeline's `lg:col-span-2` wrapper, which is the grid item for the fifth. After it, 1440 then
  375 gives 360/360 (scrollbar shown) and every card is 328px, the same as a page loaded at 375.
- **#80, option 2 from the issue:** the Total card gets an "About Total" `InfoTip` saying it
  includes archived applications, that the Applications list hides them until Show archived is
  ticked, and that the rates use this total. Option 1 (an archived count in the list header) needs
  a new `meta` field from the list query; the tip explains the gap with no API change. What Total
  counts is unchanged, because the rates are built on it.
- **Layout:** `StatCard` takes an optional `tip`, shown after the label in a flex row. Measured at
  1440 and 375: the Total card's label row stays 16px, the card is the same height as Active
  (117.3 / 127.3px), and the tip's panel stays inside the viewport (64 to 320 of 360 at 375).
- **Tests:** `e2e/audits/overflow.spec.ts` adds a case that loads the dashboard at 1440 and
  resizes to 375. Run locally against both builds, it fails on `main` (document 749/375) and
  passes on the branch. It runs in CI's e2e job, not in `npm run verify`.
  `client/tests/dashboard/dashboard.test.tsx` opens "About Total" and reads the archived sentence.

## Toolbar menus stay on screen, the toolbar stops re-flowing, and Filters holds still at 1280 (19 Oct 2026)

Fixes issues #85, #87 and #88. All numbers are from a real build with real scrollbars (Chromium,
demo account), read from `getBoundingClientRect()` on `main` and on the branch with one script.

- **#85, cause:** `Popover`'s default menu panel was placed with CSS alone (`absolute` plus
  `right-0` or `left-0`), and only panels given an `anchorRef` went through `useAnchoredPosition`,
  which clamps to the gutter. At 375 on `main`: Columns at x = -116.9, Export CSV at 14.9 (1px into
  the gutter), and Filters from 254.6 to 494.6 with the page 495px wide. That last one is bug 2 of
  the issue, and it happened on the demo account too, not only on a new one.
- **#85, fix:** every `Popover` panel is now `fixed` and placed by the hook. Without an `anchorRef`
  it anchors to its own trigger with an 8px gap (the old `mt-2`). At 375 the three panels are now
  16-256, 16-256 and 104-344 of a 360px page. At 768, 1024 and 1440 every panel's left and top are
  identical to `main` (Columns 200.4 / 605.1 / 864.4, as in the issue).
- **Two changes to the shared hook, found while measuring:**
  - The right-hand clamp used `window.innerWidth`, which counts a classic scrollbar, so a panel
    clamped at the right could sit up to 15px under it. It now uses the root's own width.
  - A fixed panel did not follow its trigger when a re-render moved it. At 1024 the Filters count
    badge moves the trigger 24px left, and the panel stayed behind. The hook now places again after
    every render of its owner. It keeps the old object when the coordinates are unchanged, so that
    pass settles instead of looping. Measured after the change: the panel's left edge equals the
    trigger's before and after ticking a filter at every width.
- **#87:** the search field's cap is 18rem from `xl` and 24rem from 1376px, the two-step option in
  the issue. `min-[1376px]:` is not generated here, because the `board-fit` screen is a `raw`
  query, which turns Tailwind's `min-*` variants off. So it is `[@media(min-width:1376px)]:`, and
  the built CSS puts that rule after the `xl` one. Filters' shift when the first filter is ticked:
  1280 -96.1 → -0.1, 1375 -1.1 → 0, 1440 0 → 0. 1024 stays at -24, which is the count badge, as
  the issue noted. The field at rest is 288px at 1280 to 1375, which still fits the 270.4px
  placeholder.
- **#88:** `scrollbar-gutter: stable` on the root, but only while the Applications toolbar is
  mounted (`html:has([data-stable-gutter])`). With the gutter app-wide, the reserved strip showed
  the canvas 15px wide beside the auth screen's right-hand panel and the Board's top bar, on pages
  that never scroll. Searching "go" on `main`: 768 toolbar 705 → 720px, 1024 two rows → one row
  (field 344.6 → 202.9px), 1440 1105 → 1120px. On the branch all three are unchanged. The cost:
  when the list is short enough not to scroll, the empty 15px gutter shows the canvas beside the top
  bar, where the scrollbar track was. `overflow-y: scroll` was not used, because it would stop the
  modal's `body { overflow: hidden }` reaching the viewport, so the page behind a modal would
  scroll.
- **Tests:**
  - `client/tests/components/popoverPanel.test.tsx` stubs a 360px page and checks three things: a
    right-aligned menu is clamped to 16px, a left-aligned one to 104px, and a panel follows a
    re-render that moves its trigger. All three fail against the old `Popover` and hook.
  - `client/tests/applications/toolbarMenus.test.tsx` holds the gutter rule and that the toolbar
    carries its marker. That is a contract check, since jsdom has no scrollbars.
  - `e2e/audits/clearFilters.spec.ts` adds the 1280 check and a 375 check that each menu's panel
    sits inside the gutter. Run locally against both builds, it fails on `main` with -116.9 for
    Columns, 14.9 for Export CSV, a 509.6 right edge for Filters, and a 1280 shift. It passes on
    the branch.

## Board drags: named announcements, a preview on the pointer, and a handle that takes a finger (19 Oct 2026)

Fixes issues #90 and #94. Addresses #95, which still needs a check on a real phone.

- **#90:** `DndContext` gets `accessibility` with the board's own announcements
  (`boardAnnouncements.ts`), built from `CardDragData.company`, the card's starting status and
  `STATUS_CONFIG[...].label`. For example: "Picked up Shopee, in Saved.", "Shopee is over Applied.",
  "Shopee dropped in Applied." and "Move cancelled. Shopee is back in Saved." No message carries
  the database id or a raw status key. The hidden instructions now say "application" and name the
  keys the board uses (Space or Enter, left and right arrows, Escape).
- **#90, found while testing:** dnd-kit reports the card's own column as the first "over" right
  after pick-up, which replaced "Picked up…" in the assertive live region in the same tick, so it
  could never be read. That was already true of the defaults. The first report is skipped when it
  is the starting column, and a later move back to that column is still announced. That needs a
  little state per board, so the announcements come from `createBoardAnnouncements()`, memoised in
  `KanbanBoard`.
- **#90, test changed deliberately:** `moveHandle.test.tsx` pinned dnd-kit's default instruction
  wording ("press the space bar"). The wording was what #90 asked to change, so the assertion now
  matches the board's own sentence. It still checks that the instructions are the handle's
  description.
- **#94, cause:** the `DragOverlay` wrapper rendered inside `BoardPage`'s `space-y-5`, which gives
  it `margin-top: 20px`. A fixed box still takes its margin, so the copy sat 20px below the pointer
  at every card height. It was measured on the real build: the wrapper had `top: 236.95px` and
  `translate(60px, 40px)` but drew at y = 296.95, and its `margin-top` read 20px. No ancestor made
  a containing block.
- **#94, fix:** `BoardDragLayer` portals the overlay to `body`. The copy now lands at exactly +60,
  +40 for a +60, +40 pointer move.
- **#95:** the Move button gets `touch-none`, dnd-kit's documented requirement for a
  `PointerSensor` handle. No `TouchSensor` was added. Under Chrome DevTools touch emulation at 375,
  a 160px finger drag from the handle went like this:
  - On `main`: the preview appeared for a moment, then the browser cancelled the pointer stream,
    so there was no drag and no scroll.
  - On the branch: the drag stays active, and the board auto-scrolls as the finger nears its edge.

  This is emulation, not a phone. #95 stays open until it is checked on a real device. The cost is
  that a swipe that starts on the Move bar no longer scrolls the page. That bar is the only thing
  on the card that drags.

- **Tests:**
  - `client/tests/board/announcements.test.tsx` reads the live region after a keyboard pick-up,
    move, drop and cancel. All three cases fail without the `accessibility` prop.
  - `e2e/audits/moveHandle.spec.ts` checks `touch-action: none` on the handle, and that the
    preview sits at the card's box plus the pointer's travel. Run locally, it passes on the branch
    and fails on `main` at the touch-action check.

## The app-wide border token stays as it is (19 Oct 2026)

Closes issue #103 without a change, by the owner's choice after the candidates were measured.

- **Where it stands:** `--color-border` measures 1.11 against the canvas and 1.30 against the
  surface in light, and 1.39 / 1.27 in dark. In light, a card's white fill (1.17 against the
  canvas) draws its edge more than the border does. In dark, the border carries the edge.
- **Candidates measured,** as steps along the line from `border` to `border-strong`:
  - halfway: 1.40 / 1.65 light, 1.61 / 1.47 dark;
  - `border-strong`: 1.83 / 2.15 light, 1.88 / 1.72 dark;
  - 3:1 on both surfaces needs 111 136 168 in light and 86 111 144 in dark. Both are darker than
    `border-strong`, on every card, input and divider, since `*` defaults to `border-border`.
- **Why kept:** none of the steps short of that reaches 3:1, and the one that does is a heavy
  outline everywhere. Cards are identified by their content and, in light, by the fill step, so
  this is a visibility observation rather than a 1.4.11 failure, as the issue itself recorded.
  Surfaces with no fill step move to `border-strong` locally, as the Calendar day panel did for
  #100.

## DMARC moves to `p=quarantine` on day one rather than after 2–4 weeks (19 Oct 2026)

- **What the docs say:** DEPLOYMENT.md §7.2 "DMARC rollout" holds `p=none` for 2–4 weeks and
  tightens only once aggregate reports show clean mail.
- **What was done:** `_dmarc.naabel.com` went from `v=DMARC1; p=none;` to
  `v=DMARC1; p=quarantine; pct=100;` on the day the domain was verified.
- **Why:** the wait exists to find senders you did not know about. `naabel.com` was bought that
  day through Railway, and its only sender is Resend on `tracker.naabel.com`, which passes DMARC
  through an aligned DKIM signature. There were no other senders to find, and the record also
  publishes no `rua`, so waiting would not have produced any reports to read.
- **Checked:** after the change, a reset email still reached the Gmail Inbox with SPF, DKIM and
  DMARC all PASS.
- **Not done:** `p=reject` waits. Add an `rua` address before it if a second sender ever appears.

## The Definition of Done's one-pass journey becomes its own E2E flow (20 Oct 2026)

- **What:** `e2e/flows/10.full-journey.spec.ts` walks SPEC §17 item 4 (register → login →
  create → filter → drag → interview → status → charts → export → logout) as one user, through
  the UI only, one `test.step` per step.
- **Why one test, not ten:** flows 01–08 already prove each step alone from a fresh, API-seeded
  account. What they cannot see is a seam between steps, so this flow reads each step's result
  in the next: the dragged card is the one the chart counts, the changed status is the one the
  CSV exports.
- **`dragCardTo`** moved from flow 03 into `e2e/support/ui.ts` so both flows share one pointer
  sequence rather than two copies.
- **Checked locally** against the compose E2E stack with `TRUST_PROXY=0`, so the rate limiters
  saw one real client: it costs one sign-up and one sign-in. Passed twice, alongside flow 03.

### Follow-up: `dragCardTo` lands where it aims when the board auto-scrolls

- **Failure:** CI run 39348336975 (PR #121, docs only) failed flow 03: Cloudflare landed in Offer,
  not Interview. At 1280 px the Interview column starts off-screen; the helper aimed the pointer
  at its centre, dnd-kit auto-scrolled the board while the pointer sat in its 20% edge band, and
  `pointerWithin` resolved the drop against whatever had slid under it by release. Timing decided
  the column, so it passed most runs.
- **Fix:** the helper holds the pointer at the board's edge until the target column's centre is
  clear of the band (or the board can scroll no further), then moves onto it and releases. It
  also scrolls the handle into view first, since a card in an off-screen column has none.
- **Regression:** flow 03 now also drags to Rejected, which starts far off-screen. Against the
  old helper it failed ("column-rejected … not found"); with the fix, flow 03 and flow 10 passed
  three consecutive runs.

## Phase 17: "Continue with Google" through Passport, with no server sessions (21 Oct 2026)

- **Passport only for the OAuth leg.** `passport-google-oauth20` handles the redirect, the code
  exchange and the profile, with `session: false`. The session is the app's own refresh cookie,
  set by the callback exactly as a password sign-in sets it, so refresh, rotation, reuse
  detection, "sign out everywhere" and the session list all apply to a Google session unchanged.
- **State and PKCE in a cookie, not `express-session`.** A custom state store keeps the state
  handle and the PKCE verifier in a 10-minute httpOnly `SameSite=Lax` cookie, path
  `/api/v1/auth/google`. The API stays stateless, and the handle check ties each callback to the
  browser that started it, which closes login CSRF. `Lax` is enough because Google returns with a
  top-level GET.
- **No token in a URL.** The callback redirects to `/dashboard`, and the client's existing
  cold-start refresh turns the cookie into a session. No client callback page was needed.
- **Linking by email requires both sides verified.** Google's `email_verified` and our
  `emailVerified`. Without the second, someone could register a victim's address with their own
  password and keep access after the victim later linked Google. An unverified local account is
  refused (`ACCOUNT_UNVERIFIED`); the owner confirms the email or resets the password first.
- **Only the register page creates accounts.** `intent` defaults to `login`, which answers an
  unknown Google address with `NO_ACCOUNT`. The register page's link is held until the terms box
  is ticked, so `acceptedTermsAt` still means someone accepted the terms.
- **Created accounts get a random password.** `password` stays required, so no password flow
  changes; "Forgot password" sets a real one.
- **A locked account can still use Google.** The lock defends against password guessing; a
  Google sign-in proves ownership another way. A closed account is refused (`ACCOUNT_CLOSED`):
  restoring stays on the password path.
- **Rate limit on the callback only**, 5 per 15 minutes per IP like the other sign-in routes.
  The start route mints nothing.
- **`Express.User` now extends `UserDocument`.** `@types/passport` declares `Request.user`, so the
  existing declaration became a widening of that interface. The strategy's verify callback is the
  one place that puts something else in Passport's user slot, with a commented cast.
- **No migration.** `googleId` is optional with a sparse unique index, which Mongoose builds on
  boot. No existing document changes shape, so `schemaVersion` stays 1.
- **The Google "G" is `client/public/google-g.svg`,** so its brand colours stay outside `src`,
  where the no-raw-colour rule applies.
- **Not built:** disconnecting Google in Settings, an email when Google is linked, and an E2E flow
  through Google, since CI cannot reach Google. The server tests stub the code exchange and the
  profile fetch and run every other part for real. Add the first two if users ask for them.

## The sidebar ends with a credit, a feedback link and the app version (21 Oct 2026)

- **"Built by Naabel" links to the maintainer's LinkedIn**, chosen by the maintainer. It lives
  in `siteMeta` as `AUTHOR_URL` beside the other shared links.
- **"Send feedback" is a `mailto:` to `CONTACT_EMAIL`**, the same address as the landing footer's
  Contact link, so it needs no form, no endpoint and no new inbox.
- **The version comes from `client/package.json`.** `client/tsconfig.json` gains
  `resolveJsonModule` for the import, and Vite inlines only the `version` string, not the file.
  The three `package.json` files share one version, so the client's speaks for the release.

## The sidebar footer is redesigned, and feedback becomes an in-app form (23 Oct 2026)

- **"Send feedback" is a nav-styled button that opens a modal,** chosen by the maintainer over a
  one-line footer and a card. It has the same 36px box and icon line as the nav items. Below a
  divider, "Built by Naabel" sits on the left and the version on the right, with no underlines.
- **Feedback is emailed, not stored.** `POST /api/v1/email/feedback` mails `FEEDBACK_INBOX`, the
  same public project alias as the client's `CONTACT_EMAIL`, through the existing queue and
  Resend transport. A new collection would need export and deletion handling for no gain.
- **A new mail category, `operator`,** for mail read by the maintainer rather than a user. It
  skips the preference gate and the unsubscribe footer like security mail does, but it greets
  nobody, so the per-kind greeting test now covers user-facing kinds only.
- **`replyTo` is an explicit field from `sendMail` through the queue to both transports.** Resend
  takes it as `reply_to` and nodemailer as `replyTo`. Passing a `Reply-To` header was rejected
  because whether Resend honours it was not verified.
- **The reply address starts as the account email.** Clearing it sends feedback with no way to
  answer; the server treats `''` as no reply.
- **Mounted on the email router,** so the OpenAPI mount table needed no change. It runs
  `requireAuth`, then `feedbackLimiter` (5 an hour per account; the demo account shares one
  budget), then zod validation.
- **The sidebar closes the drawer before opening the modal,** so two focus traps never run at
  once on a phone.
- **The `0 / 5,000` counter uses `TextArea`'s left-aligned hint,** not the right-aligned counter
  in the reference image, to avoid a one-off variant of the field.

## Feedback replies go to the account email, and emails show the real logo (23 Oct 2026)

- **The feedback form no longer asks for an email.** This reverses the pre-filled field from the
  previous entry, at the maintainer's request. Every sender is signed in with an email already,
  so the server sets Reply-To to that address. `feedbackSchema` now rejects a `replyTo` field.
- **The shared demo account gets no Reply-To.** `demo@tracker.dev` is nobody's inbox, and a
  reply could reach whoever owns that domain. The email says there is no one to reply to.
- **The email masthead shows the brand mark as an image.** It loads `/apple-touch-icon.png` from
  `APP_URL`; production serves it as a 200 PNG. Gmail shows remote images by default. A client
  that blocks them shows the `IT` alt text on the same dark cell, so nothing looks broken. This
  replaces the earlier choice to draw the mark with type only.

## Settings: section navigation, a visible avatar, and an empty avatar that saves (23 Oct 2026)

- **Saving the profile with an empty Avatar URL returned 400.** The form sends every profile field,
  with an empty box as `''` meaning "no picture", but `updateMeSchema` validated `avatarUrl` as a
  URL, so every account without an avatar could not save its profile. The client unit tests mock
  the API and never saw it. The schema now accepts `''` as well as a URL, the same treatment
  `university` already gets, and a server test covers both the clear and a non-URL refusal.
- **`avatarUrl` is now shown.** It was editable but rendered nowhere, and the hint promised an
  upload "with the storage work". `UserAvatar` draws the picture in the top bar and beside the
  field, falling back to initials when it is empty or fails to load. The preview uses the saved
  value, not the field, so typing does not request every half-typed URL.
- **Avatar upload was not built.** SPEC section 4 has `avatarUrl` as a plain optional string, and
  uploads are served as `Content-Disposition: attachment` (section 12), which an `<img>` cannot use.
  Uploading would need a separate inline-served image path; the stale promise was removed instead.
- **"On this page" beside the cards from `xl` up.** The single 48rem column left the right half of
  a wide screen empty. The page is now a centred two-column grid (cards, then a sticky 11rem nav),
  and below `xl` the column is centred alone. The section ids live once in `SettingsPage`.
- **The scroll spy reads positions on scroll, not with IntersectionObserver.** The active section
  is the last whose top passed the 96px line under the top bar. The short sections at the end can
  never reach that line, so at the bottom the linked section wins while it is on screen, else the
  last one. A page that has not scrolled is never at the bottom; without that guard a page that
  fits the window marked its last card, which is how the first version failed in jsdom.

## Deploys only from pushes to this repository, before going public (23 Oct 2026)

- **The repository is being made public, because GitHub Actions minutes ran out on the private
  plan.** Public repositories get standard runners for free.
- **`deploy.yml` now requires the CI run to be a `push` from this repository.** `workflow_run`'s
  `branches: [main]` matches the head branch _name_, so in a public repository a fork's pull
  request from its own branch called `main` would pass, run with the Railway secrets, and deploy
  the fork's `head_sha`. The `DEPLOY_ENABLED` gate does not stop this: it protects a fork's own
  copy, not a run in this repository. A manual dispatch is also limited to `main`.
- **Checked before the switch:** gitleaks 8.21.2 over every commit on all 66 branches (199 commits
  with a text diff; the rest are merges or screenshot-only) found nothing, and an independent grep
  for connection strings, API keys and private keys found only documentation placeholders.
  `ci.yml` uses no secrets, the default workflow token is read-only, and the only email address in
  file content is the public contact alias. Commit metadata carries the maintainer's own address,
  which going public exposes; rewriting history was rejected because it would break every pinned
  screenshot SHA in past pull requests.

## The demo account's profile is fixed, and its university is UTHM (24 Oct 2026)

- **The demo's university is Universiti Tun Hussein Onn Malaysia,** at the maintainer's request.
  `DEMO_PROFILE` in `seed.ts` held Universiti Malaya, and the nightly reset re-applies that
  object, so a value set by hand on production would have been reverted every night.
- **Visitors can no longer change the demo's profile card.** `changesEmail` became
  `changesSharedProfile`: a `PATCH /auth/me` from the demo account that carries email, name,
  university, gradYear, avatarUrl or targetRoles is refused with `DEMO_ACCOUNT_READONLY`, like
  the password and email changes already were. Every visitor shares that card, and since the
  avatar is now drawn in the top bar, an open profile would let one visitor show the next an
  image of their choosing. Theme, timezone, weekly goal and the email toggles stay open so the
  demo still demonstrates them.

## Avatar upload: resized in the browser, stored as a data URL (24 Oct 2026)

- **The picture is cropped to a centred square, scaled to 128 px and re-encoded as WebP in the
  browser, then saved in `avatarUrl` as a data URL** (about 3.5 KB for the 1200×630 OG image).
  Re-encoding through a canvas drops EXIF, a phone photo's GPS position included, and anything else
  the file carried. A browser that cannot encode WebP returns PNG, which is still inside the cap.
- **Not the storage adapter.** Uploads are served with `Content-Disposition: attachment` (SPEC
  section 12), which an `<img>` cannot display, so a picture there would need a second, inline
  serving path, deletion on purge and its own quota. A few kilobytes in the user document needs
  none of that. It does not count towards the 100 MB upload cap, and `/auth/me` grows by the same
  few kilobytes. If larger pictures are ever wanted, that is the point to move them to storage.
- **The server accepts `''`, an `http(s)` link up to 2048 characters, or
  `data:image/(png|jpeg|webp);base64,…` up to 200,000 characters.** SVG, other `data:` types,
  `javascript:` and other schemes are refused. Before this, any string `URL` could parse was
  accepted, `javascript:` included.
- **Upload and Remove save at once, outside "Save profile".** A picked file cannot be shown back
  in a text box. The link box is empty while an uploaded picture is saved, and the profile save
  sends `avatarUrl` only when that box changed, so saving a name cannot clear the picture.
- **`UserAvatar` takes `size` rather than a `className` override.** `cn` joins classes without
  merging them, so the earlier `h-11 w-11` sat beside the default `h-8 w-8` and lost. The Settings
  preview rendered at 32 px instead of the intended size. Measured after the fix: 32 px in the top
  bar, 56 px in Settings.
- **Target roles: Backspace no longer removes a chip, and Add sits inside the field.** Holding
  Backspace to clear a draft ran on into the saved roles and deleted them one by one, so chips now
  leave only through their own labelled remove buttons. Add moved into the input's trailing slot
  because beside the field it lined up with the hint line rather than the input.
- **Avatar: a picked file waits for "Save picture", and a pasted link previews live.** Saving on
  pick gave no chance to see the crop first. The upload still saves on its own rather than with
  "Save profile", for the reason the field was built that way. The link previews only once it
  starts with `http(s)://`, so half-typed text does not fire an image request per keystroke.
- **Avatar: upload only, no link box.** A pasted page link (a gallery or search result) is HTML
  rather than an image, so the preview fell back to initials with no clear reason, and the user
  asked for upload alone. `avatarUrl` stays in SPEC section 6 as stored data, set only by the
  upload, and the profile form no longer carries it. The server still accepts a URL there, so a
  link saved before this keeps showing.
- **Settings "On this page": 2 px of slack on the active line.** A jump to `#usage` snaps the
  scroll offset to a device pixel and could stop at 96.25 px, a quarter-pixel short of the 96 px
  line, so "Storage and limits" marked "Signed in devices". Reproduced in Edge at 125-175% with a
  fractional card height; sections sit 16 px apart, so the slack cannot mark a neighbour.
