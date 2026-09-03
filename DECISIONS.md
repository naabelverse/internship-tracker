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
