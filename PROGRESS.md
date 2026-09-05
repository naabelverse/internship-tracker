# PROGRESS

Update this after every phase. A phase is only done when `npm run verify` passes and every box below it is ticked.

**Status:** Phase 14 complete
**Current phase:** 15
**Last updated:** 2026-09-05

---

## Phase 1 — Scaffold
- [x] Monorepo with npm workspaces, TS configs, path aliases
- [x] ESLint + Prettier + husky + lint-staged, `npm run verify` script wired
- [x] `docker-compose.yml` boots mongo + api + client
- [x] zod env loader, fails loudly on missing/weak secrets in production
- [x] Mongo connection with retry, winston logger, morgan with request IDs
- [x] `/health` and `/ready` return 200
- [x] Central error handler + 404 handler + graceful shutdown

Notes:
- `npm run lint` also runs `prettier --check .`, so formatting drift fails `verify` rather than
  being silently fixed at commit time. `SPEC.md`, `CLAUDE.md` and `PROGRESS.md` are prettier-ignored
  so the delivered documents stay byte-identical.
- Verified against the running compose stack: `/health` 200, `/ready` 200 with a real `admin().ping()`
  reporting `connected`, `/api/v1/health` 200, unknown route 404 with the standard envelope,
  client served on :5173, and CORS locked to `http://localhost:5173`.
- Dockerfiles carry a `dev` target only; production image stages are Phase 16 work.
- The client currently renders a live API health readout. It is real, tested behaviour, replaced by
  the application shell in Phase 5.

## Phase 2 — Auth backend
- [x] User model with hashing, `toJSON` strips password
- [x] register, login, refresh (with rotation + reuse detection), logout, logout-all
- [x] `GET/PATCH /auth/me`, password change revokes other sessions
- [x] `requireAuth` middleware, `passwordChangedAt` invalidates old access tokens
- [x] Rate limits on auth routes, keyed on IP and email
- [x] Tests green

Notes:
- `RefreshToken` gained a `family` field beyond the SPEC list. The listed fields only support
  walking `replacedBy` one document at a time; `family` makes revocation a single indexed
  `updateMany`. `replacedBy` is kept for audit and to tell rotation apart from outright revocation.
- Rotation claims a token with one conditional `findOneAndUpdate`, so concurrent requests cannot
  both win. A 10 s grace window separates a benign concurrent duplicate (401, family intact) from a
  genuine replay (401, whole family revoked).
- Access tokens carry a millisecond `iatMs` claim. The standard `iat` is whole seconds, which let a
  token minted in the same second as a password change survive it. Found via a flaky test, fixed in
  the mechanism rather than the assertion, and covered by a same-second regression test.
- Email verification is not sent at registration: there is no mail transport until Phase 12 and the
  verification flow is Phase 11. The User fields for both already exist, so no later migration.
- `PATCH /auth/me` deliberately rejects `email`; the change-email flow needs verification (Phase 11).
- Auth rate limiters stay active during tests, with `resetAuthRateLimiters()` clearing counters
  between cases, so the 5-per-15-minutes behaviour is proven rather than skipped.

## Phase 3 — Applications backend
- [x] Application model + indexes + optimistic concurrency
- [x] Full CRUD, filtering, search, sort, pagination with `meta`
- [x] `PATCH /:id/status` appends to `statusHistory`
- [x] Interviews subresource CRUD
- [x] Bulk actions
- [x] Ownership isolation test (user A cannot see user B, returns 404)
- [x] Tests green

Notes:
- `statusHistory` is appended explicitly by a single `applyStatusChange` helper, not by a pre-save
  hook. A hook cannot see the `note` that `PATCH /:id/status` accepts, and running both mechanisms
  would append two rows per change.
- `optimisticConcurrency: true` makes Mongoose use `__v` as a real lock, exposed to clients as
  `version`. Two guards produce the same 409: a stale `version` in the body, and a lost race at
  `save()`. The response says which via `errors.conflictSource`.
- CSV import and export were pulled forward from Phase 4 at your request. Uploads still go through
  in-memory multer only; the storage adapter and attachment endpoints remain Phase 4.
- `search` uses an escaped case-insensitive regex rather than `$text`, so type-ahead matches
  partial words. The text index the SPEC asks for is still created.
- Test isolation now truncates every collection between cases. The old helper cleared only User and
  RefreshToken, so applications leaked between tests and briefly masked a real assertion.

## Phase 4 — Analytics, calendar, reminders backend
- [x] All six analytics endpoints via aggregation pipelines
- [x] Calendar merge endpoint, reminders CRUD
- [x] Reminder cron job
- [x] CSV import (with per-row errors) and export
- [x] Upload endpoints behind the storage adapter
- [x] OpenAPI spec covers every endpoint, `/api/docs` renders
- [x] Tests green

Notes:
- CSV import and export were delivered in Phase 3; the box is ticked here for the record rather
  than rebuilt. See the Phase 3 notes.
- Every analytics pipeline opens with `$match` on the user, which is the aggregation equivalent of
  the ownership rule the query layer follows.
- Day, week and streak boundaries come from the timezone stored on the account. Two fixture users
  in Asia/Kuala_Lumpur and America/Los_Angeles get different streaks and different weekly windows
  from the same rows.
- The cron ticks hourly in UTC and delivers only to accounts whose own clock reads the digest hour,
  resolved through Intl so daylight saving moves the UTC hour automatically.
- Uploads go through a StorageAdapter. One contract suite runs against LocalDiskStorage and
  S3Storage, so swapping STORAGE_DRIVER changes where bytes live and nothing else. Production
  refuses the local driver outright.
- `/api/docs` renders the OpenAPI 3 document, and a test walks the router stack in both directions:
  no registered route may be undocumented, and no documented path may be stale.

## Phase 5 — Frontend foundation
- [x] Vite + Tailwind theme tokens (light + dark), no flash of wrong theme
- [x] Layout shell, router, protected routes, 404 page
- [x] TanStack Query setup, axios client with silent-refresh interceptor + request queue
- [x] Login and register pages with validation
- [x] Toast system + error boundary

Notes:
- Every colour is a CSS custom property holding space-separated RGB channels, exposed to Tailwind as
  `rgb(var(--token) / <alpha-value>)`. One definition serves the utility, the opacity modifier and
  Phase 8's charts, which will read the same variables off `document.documentElement`.
- `data-theme` on `<html>` is the only theme switch; `darkMode` is `['selector', '[data-theme="dark"]']`
  so the `dark:` variant and the variable block cannot disagree.
- The no-flash guarantee is an inline classic script in `<head>`. It is verified without a browser by
  parsing the shipped `index.html` in jsdom with scripts enabled and asserting the resolved theme for
  seven input cases, plus index-of assertions proving the script precedes the bundle and `#root`.
  Phase 15 closes the remaining parse-then-paint link in Playwright.
- The 401 interceptor collapses concurrent failures onto one shared promise; a replayed request is
  marked, and a request whose token has already been rotated is replayed without a second refresh.
  The concurrent test fires three 401s and asserts `/auth/refresh` was called exactly once.
- The access token is a memory-only zustand slice with no `persist`; a test asserts both browser
  storages stay empty across a full refresh-and-replay cycle.
- `pending` is a real third session state. On a hard refresh the only evidence of a session is the
  cookie, so protected routes show a shell skeleton rather than bouncing the user to /login.
- Dashboard, Applications, Detail, Board, Calendar and Settings are real modules at their final paths
  rendering a shared `PhasePlaceholder` with `data-phase`. Phases 6, 7, 8 and 9 replace one file body
  each; the route table, guards and routing tests do not move.
- Found and fixed while wiring the router: `PublicOnlyRoute` raced the post-login navigate and could
  drop the user on the dashboard instead of the page they were bounced from. Both now read one
  `readRedirectTarget`, which also refuses a protocol-relative `from` value. Covered by tests.
- `tests/App.test.tsx` was deleted: it covered the Phase 1 health-check boot screen, which the Phase 1
  notes already recorded as being replaced by this shell.
- Deferred to later phases as planned: `react-helmet-async` and per-route head tags (Phase 13), the
  account theme preference syncing to `/auth/me` (Phase 9), and Terms and Privacy links behind the
  registration checkbox, which is plain text for now so it links nowhere broken (Phase 13).

## Phase 6 — Applications UI
- [x] Table with server-side pagination, sorting, filters synced to URL
- [x] Debounced search, column visibility, row selection, bulk actions bar
- [x] Create/edit modal with optimistic update and rollback
- [x] Detail page: timeline, markdown notes with autosave, attachments

Notes:
- All eleven list filters live in the URL and nowhere else, through `useSearchParams` plus a codec
  that mirrors the server's query schema. The query key is built from the parsed filters, so a fresh
  mount at a filtered link and a client-side navigation take the same path. Unknown values are
  dropped rather than rejected, so a stale link opens on a sane view.
- One `useOptimisticApplicationMutation` backs create, update, status change, delete and bulk. It
  cancels in-flight queries before snapshotting, sweeps the whole `applications` cache prefix rather
  than one key, and hands back a restore closure the error path calls. Rollback is proven for the
  inline status dropdown and for the edit modal, against a 400, a 500 and a transport failure.
- A 409 renders the reload/overwrite prompt with the server's document rather than a toast.
  "Overwrite" resends the same body with `version` omitted, which is exactly what the server treats
  as "stop checking the read I started from"; a test asserts the second request carries no version.
- Notes autosave compares the debounced draft against the last server-acknowledged text held in a
  ref, so typing a character and deleting it saves nothing and a success write does not echo.
- Attachments are checked against the 5 MB and pdf/doc/docx/png/jpg limits before the request, as a
  fast fail; the server stays the authority. The markdown preview is sanitised after parsing, with a
  test proving a `javascript:` link and an `onerror` image are stripped.
- Two real bugs were found by the tests and fixed with them: the edit form reset itself on every
  background refetch and discarded in-progress typing, and clearing the filters wrote the old search
  term back into the URL. Both are described in `DECISIONS.md`.
- The table becomes stacked cards below `md`, a genuinely different layout rather than a table that
  scrolls sideways. Verification at 375/768/1440 px in a real browser is still Phase 9/15.
- `marked` and `dompurify` were added for the notes preview; the locked stack names no markdown
  renderer and hand-rolling sanitisation is not worth the risk.
- Bundle after this phase: 531 kB raw / 169 kB gzip across four chunks, up from 387 kB / 124 kB.
  Vendor chunks are now split manually; route-level lazy loading and the budget stay Phase 15.
- Deferred: editing and deleting an existing interview from the timeline (add is wired; the endpoints
  exist), and the attachment download signing route, which the detail list links to directly for now.

## Phase 7 — Board + calendar UI
- [x] dnd-kit Kanban, per-column counts, optimistic status change with rollback
- [x] Deadline chips (amber ≤3 days, red overdue)
- [x] Calendar month view with deadline and interview events

Notes:
- A drop goes through `PATCH /applications/:id`, not `/status`. Only the general update accepts
  `version`, which a drop must carry so a stale drag hits the optimistic lock; that endpoint still
  appends to `statusHistory` through the same `applyStatusChange` helper. No Phase 6 hook changed
  shape — the board picks the hook whose endpoint can carry a version, and `useChangeStatus`,
  `DeadlineChip` and `STATUS_CONFIG` are reused as they are.
- Rollback reuses Phase 6's snapshot wholesale: a card's column is derived from `application.status`,
  so `restore()` moves it back with no board-local origin state to drift. A 409 opens the same
  `VersionConflictDialog` the edit modal uses, with the card left in its origin column while the
  prompt is open.
- The keyboard sensor is wired with a custom coordinate getter that steps one column per arrow press
  rather than dnd-kit's default 25 px nudge. Pointer and keyboard drags are each tested with a
  success and a rollback case.
- dnd-kit needs layout, which jsdom has none of, so the tests supply a synthetic one and the setup
  shims `ResizeObserver` and `PointerEvent`. Two inert `data-*` attributes on columns and cards give
  that mock something to lay out against.
- The calendar's visible window is part of the query key, so changing month issues a request for the
  new range. The range covers the whole grid rather than the month, since February 2026 opens on a
  Sunday and those borrowed cells hold real events. The month lives in the URL as `?month=YYYY-MM`.
- Clicking an event opens the Phase 6 detail page rather than a second summary surface.
- Bundle after this phase: 565 kB raw / 178 kB gzip across five chunks, up from 531 kB / 169 kB.
  dnd-kit is its own 39 kB chunk, so it stays off the dashboard's path.
- Deferred: dragging to reorder within a column (SPEC asks only for moves between columns), and a
  week or day calendar view. Real-browser verification at 375 px stays Phase 9/15.

## Phase 8 — Dashboard + charts
- [x] Stat cards with period deltas
- [x] Line, doughnut, source bar, funnel, top-companies charts
- [x] Activity heatmap grid
- [x] Charts re-theme correctly on dark/light toggle
- [x] Upcoming panel, empty states, skeletons

Notes:
- SPEC section 6 wants a delta on every stat card and Phase 4's `/analytics/summary` could not
  supply one: it reported all-time standing, and `/timeline` aggregates status changes across every
  status at once. The endpoint gained an additive `period` block and an optional `periodDays`
  (default 30). Both windows are measured on the cohort of applications *created* inside them, so
  the two are comparable, and it costs no extra round trip — three branches were added to the
  `$facet` that already existed.
- "Load demo data" needed a real endpoint, `POST /applications/demo-data`, because SPEC section 9's
  seed is a CLI script a browser cannot run. It refuses any account that already holds an
  application with 409 `DEMO_DATA_NOT_EMPTY`, so it can never mix fixture rows into real data.
  **Phase 10 should import `buildDemoApplications` from `demoData.service.ts` for `npm run seed`
  rather than writing a second generator.**
- Theme reactivity: `useChartPalette` re-reads the tokens off the document element with
  `getComputedStyle`, keyed on the theme store's `resolved` value, and react-chartjs-2 pushes the
  new options into the live instance via `update()`. No remount, so the mount animation and any open
  tooltip survive a toggle. Every colour in a chart option is a token, tooltip background, border,
  title and body included.
- The theme test runs real Chart.js against a stubbed 2D context and asserts on
  `Chart.getChart(canvas).options` and `.data` — the object Chart.js paints from — after toggling.
  It compares against the `:root` and `[data-theme='dark']` blocks read out of `src/index.css`, not
  a copy of the palette. Checked against a deliberately broken build: caching the palette at module
  scope fails the two repaint cases and passes the rest.
- Three bugs the tests found and fixed: the upcoming panel rebuilt its query key from `new Date()`
  every render and refetched forever; every application write invalidated only the applications
  lists, leaving the dashboard stale; and `?? []` fallbacks meant the chart data memos never held.
- `chart.js/auto` is never imported. Measured both ways: the hand-written registry gives a 174.86 kB
  raw / 61.39 kB gzip vendor chunk against 209.07 kB / 71.90 kB for `chart.js/auto`. `Legend` is not
  registered at all, since every legend on the page is our own markup.
- Bundle after this phase, with the dashboard behind `React.lazy`: **260.90 kB gzip on the dashboard
  route against SPEC section 12's 300 kB budget — passing, with 39.10 kB of headroom.** That is
  index 68.57 + react-vendor 51.90 + query-vendor 35.61 + chart-vendor 61.39 + DashboardPage 6.88 +
  markdown 23.37 + dnd 13.18. Non-dashboard routes are 192.63 kB gzip; `chart-vendor` appears in the
  entry chunk only inside Vite's preload table, never as a static import.
- Correction to the Phase 7 note: dnd-kit does **not** stay off the dashboard's path. Being a
  separate chunk is not the same as being off the path — `App.tsx` imports the board and detail
  pages eagerly, so the entry chunk statically imports both `dnd` and `markdown` and every route
  pays for them. They are counted in the figure above. Lazy-loading the remaining routes is Phase
  15's code-splitting item.
- Six categorical `--color-chart-*` tokens and five `--color-heat-*` tokens were added to
  `index.css` and exposed through Tailwind, because the semantic tokens cannot carry a by-source or
  top-companies chart on their own.
- Accessibility: every chart renders its data a second time as a visually hidden table, the
  doughnut's centre total is markup rather than a canvas plugin, and a stat card's direction is
  carried by an arrow plus hidden "Up"/"Down" text rather than by colour alone.
- Two existing tests were rewritten deliberately, not weakened: `routing.test.tsx` and
  `RegisterForm.test.tsx` used the Phase 8 placeholder as their "landed on the dashboard" signal.
  Both now assert the real dashboard heading, and the routing case additionally proves the lazy
  chunk resolves.
- Deferred: the timeline range is fixed at 90 days (SPEC asks for the day/week/month granularity
  switch, which is built, not a range switch), and real-browser verification at 375/768/1440 px in
  both themes stays Phase 9/15.

## Phase 9 — Settings, polish, a11y, responsive
- [x] Settings: profile, password, preferences, timezone
- [x] Theme toggle persisted
- [x] Keyboard nav, focus traps, aria labels, contrast pass
- [x] Verified at 375 / 768 / 1440 px in both themes

Notes:
- No server changes were needed: `PATCH /auth/me` already accepted every field the
  settings page edits, and `PATCH /auth/me/password` already existed.
- Theme precedence: local storage wins until the account value loads, then the account wins
  and is written back to local storage. Local has to win first because it is the only value
  that exists before `/auth/me` answers, and it is what the inline boot script reads to avoid
  the flash. The account then takes over because it is the durable cross-device preference;
  without the write-back, changing the theme on one device would never reach another. Covered
  by a test that boots with a stale local value and asserts the account value wins.
- The timezone was previously set once, at registration, from the browser. Editing it here is
  safe: the reminder sweep re-reads every distinct timezone each hour and the analytics
  pipelines take it per request, so nothing derived is cached.
- Data export and account deletion are rendered as disabled affordances with the reason
  stated, not hidden. Full account export needs a document containing everything the system
  holds (Phase 14); deletion needs the soft delete, purge job and typed confirmation
  (Phases 11 and 14). Neither destructive path was half-built.
- `PhasePlaceholder` was deleted. Phase 9 replaced the last page that used it, so it became
  dead code.

**Real-browser verification happened this phase — it is no longer deferred.** A Chromium
build already sits in the Playwright cache and was driven via `executablePath`, against the
running compose stack, at 375/768/1440 in both themes across all five routes. Two blockers
had to be cleared first, both worth recording: the Playwright MCP tool insists on Chrome,
which is not installed, and **both the api and web container images were stale** — the api
was in a crash loop against a missing `swagger-ui-express` and the web image predated axios,
date-fns and dnd-kit. Both were rebuilt. No Playwright dependency was added to the repo; the
committed E2E suite remains Phase 15.

Accessibility findings — three real defects from earlier phases, all fixed:
- The nav drawer was keyboard reachable while closed. Below `lg` it was only translated
  off screen, which moves pixels but leaves its six links and close button in the tab order.
  It is `invisible` now, which is what actually removes a subtree from the tab order.
- The token palette failed 4.5:1 in seven places, six of them in the light theme:
  `text-subtle` on `surface-muted` in both themes, `info` as text, and the info, warning,
  success and danger status pills against their own 15% tint. Fixed at the token level.
- The dark theme put white text on the danger button's light red at 2.77:1. A `danger-fg`
  token now mirrors `primary-fg`.
- Also found in the real browser: tapping the nav entry for the page you are already on left
  the drawer open, because it only closed on a pathname *change*.
Already compliant, verified in the components rather than taken on trust: all four modals use
the `Modal` primitive (four focus-trap and four Escape cases now prove it), every button and
link has an accessible name, all five Phase 8 charts ship a real `sr-only` data table, and the
skip link targets a `main` landmark that exists.

Responsive results, measured in Chromium (body scroll width against the viewport, plus an
actual attempted scroll):
- 375: applications, calendar and settings clean; table renders as stacked cards; board
  scrolls inside itself.
- 768: dashboard, calendar and settings clean; the applications table scrolls inside its own
  container.
- 1440: every route clean; sidebar rail visible and reachable.
- Both themes behave identically at every breakpoint.

Deferred / open:
- **FIXED in Phase 15 — the document scrolling horizontally.** Root cause: Tailwind's `sr-only` is
  `position: absolute`, and the scroll containers were `position: static`, so an ancestor's
  `overflow` could not clip them — a static box is never in an absolutely positioned descendant's
  containing block chain. The table's "Actions" header label and `DeadlineChip`'s label therefore
  escaped their scroll containers and extended the document whenever the content was wider than the
  container. That is why `body.scrollWidth` read clean (an out-of-flow box contributes to
  `documentElement`, not to body) and why `overflow-x-clip` on `main` did nothing (`main` is static
  too). Fixed by making all four horizontal scroll containers `relative`. Regression test:
  `e2e/audits/overflow.spec.ts`, which asserts by actually scrolling the document.
- `sr-only` on a `<table>` does not constrain its width, because a `display: table` box treats
  `width: 1px` as a minimum. The chart summaries now wrap the table in an `sr-only` div.

## Phase 10 — Seed, tests, docs, CI
- [x] Seed: demo user + 60+ realistic applications, every chart populated
- [x] Coverage target met on services and controllers
- [x] README complete (setup, env table, endpoints, mermaid ERD, demo creds)
- [x] CI workflow green — reliably, as of run 33874058196. Two fixes were needed after the workflow
      itself was written: the Phase 6/7 board defect the first real CI run exposed, and the drag
      helper flake that outlived it. Both are recorded below and in `DECISIONS.md`.

Notes:
- `npm run seed` imports `buildDemoApplications` from `demoData.service.ts`, as Phase 8 asked. The
  generator was measured against SPEC section 9's bar before being wired up rather than assumed to
  meet it: 64 rows over 182 days across 7 calendar months, all 8 statuses, 7 sources, 15 companies,
  10 tags on 45 rows, 23 interviews on 12 applications, 30 deadlines split 24 past / 6 upcoming, and
  146 status-history entries over 100 distinct days. It clears the bar unchanged, so **nothing was
  bolted on from a second source and nothing in the generator was edited**. One caveat left standing
  rather than engineered around: no deadline lands inside the 3-day amber-chip window, which is a
  Phase 7 affordance and not one of SPEC section 9's requirements.
- The seed script lives in `src/scripts/`, not `src/services/`: the "every service function takes
  `userId` first" rule cannot apply to an operation whose job is to create the user. Seeding a second
  time is refused with a message pointing at `seed:reset`, so the dashboard's numbers cannot silently
  double. `DEMO_EMAIL` and `DEMO_PASSWORD` became real env vars, as SPEC section 8 lists them.
- **A real defect was found by running the documented setup instead of assuming it.** Copying
  `server/.env.example` to `server/.env` made the server refuse to boot: dotenv reads a bare `KEY=` as
  an empty string, and zod's `.optional()` only skips `undefined`, so all five blank `S3_*` keys
  failed validation even with `STORAGE_DRIVER=local`. With that file present, **13 of 30 test suites
  also failed**. `parseEnv` now treats blank as unset. The regression test parses the shipped
  `.env.example` itself, so a later phase adding another blank optional key (`SMTP_*`, `SENTRY_DSN`)
  cannot reintroduce it.

**Coverage: the SPEC section 10 target was already met before this phase began.** The report was run
first, as instructed: `src/services` 97.79% statements and `src/controllers` 99.09%, against a 70%
target — no gap to close, so no tests were written to move a number. Tests were still added for
behaviour that was genuinely unproven, each traceable to an uncovered line: weekly/monthly timeline
bucketing (`analytics.service.ts:466`), CSV import of the stipend and contact columns our own export
writes, the 1000-row import cap, an attachment upload with no file, and `/ready` returning 200 against
a live database rather than only the 503 path. The Monday-bucket test was checked against a
deliberately broken build — removing `startOfWeek` makes Mongo default to Sunday and the test fails —
and the source was restored byte-identical. A seventh planned test was **dropped** once it turned out
not to be a gap: `auth.service.ts`'s `USER_NOT_FOUND` throws are unreachable because `requireAuth`
already filters `deletedAt: null`, and a test already proves that. Remaining uncovered lines are stated
in `DECISIONS.md` rather than padded — defensive rethrows, a branch the zod refine makes unreachable,
default parameters. The target is now enforced by a `coverageThreshold` in `jest.config.js` rather than
observed once.

**Dashboard verified in a real browser against the seeded database, with screenshots.** Chromium from
the Playwright cache was driven via `executablePath` against the compose stack, signed in as the demo
user at 1440 px in both themes. All five Chart.js canvases painted — checked for non-transparent
pixels, not merely for the element existing — five populated `sr-only` data tables (14, 8, 7, 4, 10
rows), the activity heatmap reporting "35 applications added across 31 active days in the last 12
weeks", five real events in the upcoming panel, no empty-state copy, and no horizontal document scroll.
Dark mode had to be driven through `prefers-color-scheme` rather than local storage, because Phase 9
made the account preference win and the demo account is set to `system`; it then resolved
`data-theme="dark"` with every chart repainted. No Playwright dependency was added; the committed suite
stays Phase 15.

**Docker path corrected, not just confirmed.** `docker compose exec api npm run seed -w server` first
failed with "Missing script", because compose mounts only `server/src` and the image still held the
pre-Phase-10 `package.json`. Rebuilt with `docker compose up --build`; the seed then worked, and the
README documents that a manifest change needs a rebuild. Also recorded in the README: seeding from the
host can reach a *different* MongoDB than the containers when one is installed natively, which presents
as "the seed succeeded but the dashboard is empty".

- No API drift to flag: `openapi.test.ts` already fails if a route is undocumented or a documented path
  is stale, so the README table, the OpenAPI document and the router agree by construction.
- The README env table documents what exists, not everything SPEC section 8 lists, and names the phase
  each missing variable arrives in (mail 12, demo toggle and analytics 13, Sentry 14, `COOKIE_DOMAIN`
  16). That follows the Phase 1 convention that a variable lands in `.env.example` when something
  reads it.
- The Phase 9 horizontal-scroll defect on the board route was left where it is, still carried to
  Phase 15. It was not investigated this phase.

**CI is now reliably green — run 33874058196.**
https://github.com/naabelverse/internship-tracker/actions/runs/33874058196

Three fixes were needed in total. The first two got CI green; the third closed the second
instance of the first one's defect class, which the audit had found and reported.

1. **A real Phase 6/7 board defect**, described below and in `DECISIONS.md`: the conflict dialog and
   the pending drop lived in a subtree the board's loading state could unmount, so a 409 prompt could
   vanish before the user answered it and "Overwrite with my changes" could silently discard the move.
   Fixed by hoisting the mutation, both pieces of state and the dialog into `BoardPage`.
2. **A flake in the test helper, not in the product.** `@dnd-kit/core`'s `AbstractPointerSensor` keeps
   a capture-phase `click` listener on the document that calls `stopPropagation` for 50 ms after a
   drag ends, so the click a pointer device emits on release cannot also activate whatever is under
   the cursor. `pointerDrag` returned synchronously at `pointerUp`, so a test clicking inside that
   window had the event stopped at the document — an attached, enabled, correctly labelled button and
   no handler running. `pointerDrag` is now async and waits for the suppressor to lift.
   `dragAndDrop.test.tsx` then ran 20 consecutive times with 20 passes and 0 failures.
   `client/tests/board/dragClickSuppression.test.tsx` pins it deterministically.

The account below is left standing as written, because the first diagnosis in it was also wrong and
the correction matters more than a tidy record. Note that its closing reading — a node belonging to an
already-unmounted tree — was itself wrong: nothing was left mounted, and `document.body` is provably
empty after `resetClientState`. `DECISIONS.md` carries the evidence.

Every step this phase owns passes every time: install, lint, typecheck, server tests with coverage,
build. What fails intermittently is one **pre-existing Phase 6/7 client test**, and it fails because
it is catching a real product defect.

The case is the board's version conflict: drag a card, the server answers 409, the "This was changed
elsewhere" dialog opens, the user clicks "Overwrite with my changes", and the move is reissued without
a version. On CI it intermittently sees only the first PATCH.

**The first diagnosis was wrong and is recorded here as wrong.** It looked like Testing Library's
1000 ms `waitFor` budget being too tight for a loaded runner, so the budget was raised. The next run
failed at 5158 ms — the full new budget — which disproved it: more time never helps.

What is actually happening, established by instrumenting the components and reproducing locally (2
failures in 6 runs):

- At failure the dialog is **absent from the DOM** and `onOverwrite` **never ran at all**. The click
  found the button, but the node was detached before the event dispatched.
- `BoardPage` renders `KanbanBoard` only under `query.isSuccess && applications.length > 0`. A probe
  on the query shows it repeatedly flipping to `isPending=true, isSuccess=false, data=undefined`
  during the optimistic write and its rollback.
- So the board is torn down and rebuilt mid-interaction. `conflict` is re-set on the new instance by
  the mutation's error handler, which is why the dialog appears at all, but `pendingDrop` — the only
  record of what the user was trying to do — is lost with the old instance.

**That is a user-facing defect, not a test artefact:** the conflict dialog can vanish on its own
before the user can act on it, and even when it survives, `onOverwrite` silently does nothing when
`pendingDrop` is null — the dialog closes and the move is discarded with no error and no toast.

`placeholderData: (previous) => previous` on the board query was tried: it cuts the failure rate from
2-in-6 to 1-in-15 but does not eliminate it, so **it was reverted rather than left in place claiming a
fix it does not deliver** — the same call Phase 9 made on `overflow-x-clip`. The two timing changes
from the wrong diagnosis were reverted too. The test was left exactly as written: it is correct, and
it is the only thing that found this.

3. **The same defect class in `ApplicationsPage`'s edit modal**, which the board fix's audit found
   and reported without fixing. `editing = applications.find(...)` with `isOpen={editing !== undefined}`
   made the modal's existence depend on a value any refetch could take away: the modal closed
   mid-edit, the reset effect wiped the typed values when the row returned, and while the row was
   missing `isEdit` was false, so Save and Overwrite silently POSTed a duplicate instead of PATCHing.
   Fixed by snapshotting the row when Edit is clicked rather than re-deriving it every render.
   `client/tests/applications/editModalSurvival.test.tsx` covers all three, and the applications
   suite ran 20 consecutive times with 20 passes and 0 failures. The third audit item,
   `ApplicationDetailPage`, was re-checked and is safe today rather than merely less likely; the
   reasoning and what would break it are in `DECISIONS.md`.

Both were fixed before any Phase 11 feature work, in the order listed at the top of this section.
The hoist into `BoardPage` was the shape chosen, for a third reason not visible above: the
`useUpdateApplication` observer lived in `KanbanBoard` too, so an unmount mid-PATCH could stop the
conflict being raised at all. Carrying the payload on the conflict object would not have fixed that.

## Phase 11 — Account lifecycle
- [x] Email verification (hashed single-use token, 24 h, resend limited)
- [x] Forgot + reset password pages and endpoints
- [x] No user enumeration on forgot-password (test proves it)
- [x] Email change with pending-email confirmation
- [x] Session list + revoke, account lock after repeated failures
- [x] Soft delete + 30-day purge job
- [x] Tests green

Notes:
- **This phase was built in two passes at your instruction, backend then UI. Both have landed and
  nothing is deferred.** The client half added `/forgot-password`, `/reset-password`,
  `/verify-email` and `/account-closed`, an app-wide verification banner that escalates as the
  seven day window closes, and Settings sections for the email change, the signed in devices and
  closing the account.
- **Account lockout was already built.** Phase 2 implemented `failedLoginAttempts` and
  `lockedUntil` in `auth.service.ts`. This phase proved it rather than rebuilding it, and added
  the interaction test that separates it from the rate limiter.
- **The purge job is here, not Phase 14.** SPEC section 16 phase 11 says "soft delete + purge
  job" outright; section 14 has no job list at all.
- The `deletedAt` audit found the applications, analytics, calendar and reminder services need no
  filter — `requireAuth` already refuses a deleted user and every query is scoped to its own
  caller. Proven from the outside by `auth.softDelete.test.ts` rather than by adding filters.
  Registration's uniqueness check stays unfiltered on purpose, so a closed account's address is
  reserved until the purge releases it.
- Email sending is a seam, not a system: `mailer.service.ts` is a bounded queue plus a console
  transport, which is the shape Phase 12 fills in with the real transport and templates.
- A Phase 2 test that asserted `PATCH /auth/me` rejects an email change was rewritten, not
  deleted — it was an explicit placeholder for this phase's flow. Recorded in `DECISIONS.md`.
- The banner reads `emailVerified` and `createdAt`, which `/auth/me` really returns; the seven day
  constant is duplicated client-side and marked advisory, since the server's 403 is the real gate.
- The closed-account page says what the API actually does: `login` filters `deletedAt: null`, so a
  closed account gets the same answer as a wrong password and cannot be recovered from the app. A
  test asserts the page never implies otherwise.
- Two ordering bugs surfaced while testing and were fixed in the code rather than the assertions:
  the delete flow cleared the session before navigating, so `ProtectedRoute` beat it to `/login`;
  and the typed-confirmation label and its error message were identical text.

## Phase 12 — Email system
- [x] Provider-agnostic transport + console fallback (app boots with no SMTP)
- [x] All six templates, HTML + plain text
- [x] Retry queue; a failed send never fails the HTTP request
- [x] Preferences respected except for security mail
- [x] Unsubscribe link on the two non-transactional emails
- [x] Tests green

Notes:
- **Phase 11's `mailer.service.ts` was a seam, not a mail system, and was rewritten.** It had no
  transport at all — `nodemailer` was not a dependency before this phase — no HTML, no shared
  layout, no retry, and no preference check. Its two real properties were kept: a send never
  throws into the request, and bodies print only outside production. `queuedMail`,
  `clearMailQueue` and `MailKind` kept their names and fields so all six Phase 11 test files still
  compile and still assert what they did before.
- **Templates 1–4 existed as bare `text` strings and were upgraded, not accepted.** Each is now
  responsive HTML plus a plain-text alternative through the shared layout. Templates 5 and 6 are
  new.
- **A missing send was found and fixed: `changePassword` mailed nothing.** Phase 11 sent
  "password changed" only after a *reset*, so the deliberate change from Settings was silent.
- **The digest is delivered from inside Phase 4's existing sweep**, after the same
  `selectDueReminders` that Phase 4's timezone test already covers — not on a new path.
  `mail.digestTimezone.test.ts` reuses that test's two-zone fixture and proves the same instant
  renders as `1 Jan, 08:00` in Kuala Lumpur and `31 Dec, 16:00` in Los Angeles.
- **The weekly summary is a second task on the same cron**, on the same `'0 * * * *'` UTC
  expression and registered by the same `startScheduledJobs`. It imports `isDigestHourIn` from
  `reminderJob` rather than copying it, and adds only a local-weekday predicate. Cadence: Monday
  (`WEEKLY_SUMMARY_WEEKDAY`) at `REMINDER_DIGEST_HOUR` local, de-duplicated by
  `lastWeeklySummaryAt`.
- **The unsubscribe link is a signed endpoint, slightly beyond the "link" SPEC asked for.** A link
  to `/settings` sits behind a sign-in wall. `GET|POST /api/v1/email/unsubscribe` takes an
  HMAC-signed token, needs no session, and can only switch a preference off. Recorded in
  `DECISIONS.md`.
- **New user fields:** `weeklySummaryEnabled` (opt-in, defaults false) and `lastWeeklySummaryAt`.
  Both additive with defaults, so no migration. The Settings preferences section gained the
  opt-in checkbox.
- Nothing is deferred. `MAIL_FROM`, `MAIL_TRANSPORT`, `SMTP_*` and `WEEKLY_SUMMARY_WEEKDAY` are
  documented in `server/.env.example`; all are optional, and the app boots and registers with
  none of them set.

## Phase 13 — Public surface
- [x] Landing page (hero, features, screenshots, FAQ, footer)
- [x] Demo login into the sandboxed account, destructive actions blocked
- [x] Terms + Privacy pages, terms checkbox at registration
- [x] SEO: meta, OG, sitemap, robots, manifest, favicons, og-image
- [x] Lighthouse scores recorded and meeting targets
- [x] Landing bundle isolated from Chart.js, dnd-kit and the markdown pair
- [x] Tests green

Notes:
- **`react-helmet-async` was not in the stack.** Phase 5 landed the router, React Query and
  axios but no Helmet, and `main.tsx` had no provider. It was installed this phase, along with
  `sharp` as a client devDependency for the generated brand assets.
- **The dashboard moved from `/` to `/dashboard`.** `/` is the landing page, and a signed-in
  visitor is redirected — which is what "logged-in users hitting `/` go straight to the
  dashboard" means once the two are different pages. The decision lives only in
  `routes/MarketingRoute.tsx`. It is a separate guard from `PublicOnlyRoute` because it must
  render the page during `pending` rather than a skeleton: that is the largest paint a crawler
  and a first-time visitor both see.
- **The demo reuses `seedDemoAccount` from Phase 10**, which itself calls Phase 8's
  `buildDemoApplications`. No third generator was written. The nightly reset job *is*
  `npm run seed:reset`.
- **The demo login is `POST /auth/demo`, and it takes no request body at all.** That is the
  security property, not a convenience: there is no parameter to aim it at another account, and
  it only ever looks the account up — it never creates one.
- **Phase 12's email-link mirror test caught a real bug during this phase**: the "Open my
  dashboard" button in the weekly summary still pointed at `/`, which had just become the
  landing page. Fixed in `server/src/mail/links.ts`.
- **Only 7 routes are lazy, not all of them.** An earlier pass made every route lazy, which met
  the budget but introduced timing flakiness across 25 previously-green tests. The final set is
  the routes isolation actually requires — Landing, Terms, Privacy, Dashboard, Board,
  Applications, Calendar, ApplicationDetail — and the suite is stable over repeated runs.
- Client test timeouts were separated: `asyncUtilTimeout` 10 s against a `testTimeout` of 20 s.
  Equal values made a slow lazy chunk report "test timed out" instead of the real assertion.
- **robots.txt no longer blocks the app routes**, only the two that carry a single-use token in
  the query string. Blocking `/dashboard` failed Lighthouse's `is-crawlable` audit while
  protecting nothing — those routes need a session, so a crawler gets an empty shell.

## Phase 14 — Hardening
- [x] Resource caps, disposable email blocklist, honeypot
- [x] Upload validation, EXIF stripping, S3/R2 adapter working in production mode
- [x] Timezone pass: UTC storage, user-tz rendering and aggregations, two-timezone tests
- [x] Optimistic concurrency 409 handled in UI, migration runner + example migration
- [x] Data export, account deletion UI
- [x] Request IDs, structured logs, optional Sentry, backup script

Notes:
- **Roughly half of this phase already existed and was verified rather than built.** Real before
  this phase, and confirmed by reading the code: `middleware/requestId.ts` (mounted first in
  `app.ts`, validates the inbound header rather than echoing it), `/ready` pinging Mongo,
  `LocalDiskStorage`/`S3Storage` genuinely wired through `getStorage()` in `attachment.service.ts`
  with the env loader refusing to boot on `STORAGE_DRIVER=local` in production, EXIF stripping
  really going through `sharp` in `utils/images.ts`, `Content-Disposition: attachment` plus
  `randomUUID()` storage keys, `optimisticConcurrency: true` with the 409-and-current-document UI
  from Phase 6, and the delete-account flow from Phase 11. None of it was a stub.
- **Built this phase:** resource caps, the disposable-email blocklist, honeypot and timing check,
  the account data export, the migration runner, optional Sentry, and `scripts/backup.sh`.
- **The honeypot and timing fields are both optional on the server.** Requiring `elapsedMs` buys
  nothing — anything that can strip an unrecognised field can also send `elapsedMs: 9999` — while
  breaking every non-browser client. Threshold is 2500 ms; see DECISIONS.
- **`DataSection.tsx` was a stale Phase 9 stub telling users deletion was "not available yet"**,
  which stopped being true when Phase 11 shipped `DangerZoneSection`. Rewritten: it owns the export,
  deletion lives only in the danger zone. The test pinning the old placeholder was deliberately
  rewritten, not deleted — it was asserting a placeholder rather than the product.
- **Usage is surfaced in a new Settings section, "Storage and limits"**, above "Your data".
- **Timezone and concurrency were re-run, not assumed.** 55/55 timezone tests across five suites
  (`dates`, `analytics.timezone`, `reminderJob.timezone`, `mail.digestTimezone`,
  `weeklySummaryJob.timezone`) and 5/5 server plus 11/11 client concurrency tests. No regression
  from Phases 11-13.
- **The observability audit found two real defects, both fixed with regression tests.**
  `redactSecrets` flattened an `Error` to `{}` because `message` and `stack` are non-enumerable, so
  `purgeDeletedUsersJob`'s `logger.error('Purge job failed', { error })` had been recording every
  failure as `error: {}`. And `seed.ts` interpolated `DEMO_PASSWORD` into a log message, where
  redaction cannot reach it.
- **Sentry is behind a dynamic import on the client**, so the SDK is a separate chunk and the
  landing route's static closure is unchanged. Landing is 140.0 KB gzipped against the 150 KB
  budget, with Chart.js, dnd-kit and the markdown pair still provably absent.
- Deferred: `npm run stats` (SPEC section 14) is not part of section 16's Phase 14 definition and
  is not built. Sentry source-map upload needs an auth token and belongs with the rest of the
  production configuration in Phase 16.

## Phase 15 — E2E, performance, repo hygiene
- [x] All eight Playwright flows pass in CI
- [x] axe checks: zero critical/serious violations
- [x] Code splitting, bundle budgets met, sizes reported
- [x] LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, CHANGELOG, GitHub templates
- [x] Git history scanned, no secrets

Notes:
- **The suite is 13 tests: the eight flows, two axe cases and three responsive cases.** It runs
  against its own compose project on shifted ports (web 5174, api 5001, mongo 27018) so it never
  competes with a development stack. `retries` is 0 deliberately — a retry hides the intermittency
  the suite exists to catch — and the bar was three clean consecutive runs, met at 13/13 each.
- **Playwright found three real defects, none of them test problems.**
  1. **`Content-Disposition` was invisible to the client across origins.** The server named every
     download but never sent `Access-Control-Expose-Headers`, so a browser hid the header from
     JavaScript and both exports fell back to a generic filename. Production deploys the client and
     API to separate hosts (SPEC §15), so this was live in every deployed build; same-origin
     development cannot show it. Fixed in `app.ts`; `server/tests/cors.exposedHeaders.test.ts`
     fails against the old code and passes against the new.
  2. **The CSV export had no UI at all.** `GET /applications/export` shipped in Phase 4 and nothing
     ever called it, so SPEC §17's manual pass and §10's sixth flow could not be walked. Added an
     Export CSV control to the applications toolbar, plus `client/src/lib/download.ts` shared with
     the account export rather than a second copy of the same blob-saving code.
  3. **Five nameless `role="img"` canvases on the dashboard**, a serious axe violation.
     react-chartjs-2 labels the canvas `role="img"`; the charts already ship an `sr-only` data
     table, so the canvases are now `aria-hidden` and the table is the single text alternative.
- **The Phase 9 horizontal-scroll bug was real, and is fixed: an absolutely positioned `sr-only`
  label escaping its scroll container.** Tailwind's `sr-only` is `position: absolute`, and an
  absolutely positioned box is only clipped by an ancestor's `overflow` when that ancestor is in
  its containing block chain — which a `position: static` box never is. The applications table's
  wrapper was `overflow-x-auto` but static, so the "Actions" header label escaped it, landed past
  the viewport whenever the table was wider than the wrapper, and extended the *document*. Fixed by
  making the four horizontal scroll containers `relative`. Full mechanism in DECISIONS, including
  why `body.scrollWidth` read clean and why Phase 9's `overflow-x-clip` on `main` could not have
  worked.
- **This phase got that wrong once before getting it right, which is worth recording.** With the
  box scan filtered sensibly the bug stopped reproducing locally and was written up as "a
  measurement error, no bug exists". That was wrong: the local table happened to fit at 768 while
  CI's fonts made it overflow. **CI caught it on the first run of the new suite.** What settled it
  was asking the browser rather than reading the markup a third time — bisect by hiding one element
  at a time and re-measuring `documentElement`, then print every ancestor's containment. The audit
  now seeds long names across five statuses so the condition holds by construction, not by font
  luck: `scrolled 29px` against the unfixed component, clean against the fixed one.
- **Full lazy loading was safe all along.** Phase 13's belief that it destabilised 25 tests was
  wrong: with `asyncUtilTimeout` at RTL's 1 s default the *same 13 tests* fail whether 9 routes are
  lazy or all 16 — byte-identical lists, and two of them exercise routes that are eager in the
  baseline. The timeout raise Phase 13 made at the same time was the whole fix. All 16 routes are
  lazy now and the landing route dropped from 139.8 KB to **111.4 KB**.
- **`maxWorkers: '50%'` on the client suite.** Four tests failed during a `verify` run that shared
  the machine with the E2E containers. The cause was measured, not guessed: the first test in a file
  absorbs its lazy chunk's first transform at 3.4-4.4 s against ~0.7 s for every later test in the
  same file, and an uncapped worker pool oversubscribes the box until that crosses the 10 s async
  budget. Capping halves the CPU work at no wall-time cost (collect 105 s -> 48 s, 44.5 s -> 44.9 s
  wall) and the contended run then passes. The budget itself was left alone.
- **Bundle sizes are now reported for every route**, not just the two with budgets, by
  `client/scripts/checkBundle.mjs`. Landing 111.4 KB against 150, dashboard 215.4 KB against 300;
  the heaviest unbudgeted route is the application detail page at 177.4 KB.
- **Secret scan: gitleaks over all 22 commits, `no leaks found`.** The first run reported 9
  findings, all of them synthetic literals in test files — deliberately wrong passwords and a forged
  unsubscribe token — now recorded in `.gitleaks.toml` as the only exceptions rather than silently
  ignored. No `.env`, credential or personal email has ever been committed: the only env files in
  the history are the two `.env.example` placeholders, and the author address appears solely in
  commit metadata, never in file content. Repeatable with `scripts/scan-secrets.sh`.
- Deferred: nothing from this phase. The `{{CONTACT_EMAIL}}` placeholder now also sits in
  SECURITY.md and CODE_OF_CONDUCT.md, fed from the same Phase 13 constant, so filling it in stays a
  one-line change.

## Phase 16 — Ship
- [x] `DEPLOYMENT.md` complete (Atlas + Render + Vercel, env vars, cross-origin cookies, trust proxy)
- [x] SPF/DKIM/DMARC documented — records, syntax, DMARC rollout, warm-up, unsubscribe headers
- [ ] **Test email reached a real Gmail inbox, not spam** — needs a live domain. Manual, below.
- [x] Deploy workflow (`.github/workflows/deploy.yml`, off by default behind `DEPLOY_ENABLED`)
- [x] Uptime monitor documented (UptimeRobot on `/health` every 5 min, doubling as the keep-warm)
- [ ] **Uptime monitor actually created** — needs the deployed URL. Manual, below.
- [x] Cross-origin cookie configuration implemented in code, not only documented
- [x] `npm run stats` (SPEC §14, deferred by Phase 14) built
- [x] Source maps no longer published with the client build
- [x] Definition of Done (SPEC.md Section 17) walked item by item — table below

Notes:
- **The refresh cookie was `SameSite=Strict`, which cannot work in the deployment this phase
  documents. That is a production bug, found and fixed here.** A browser omits a `Strict` cookie
  from every request a page on another *site* initiates, and SPEC §15 puts the client on Vercel and
  the API on Render. `POST /auth/refresh` would have carried no cookie at all: sign-in appears to
  work, then the next reload — or the first access-token expiry 15 minutes later — logs the user
  out. `server/tests/cookies.crossSite.test.ts` fails two cases against the old policy and passes
  against the new one.
- **Neither the test suite nor the Phase 15 end-to-end stack could have caught it, and the reason is
  worth keeping.** The E2E stack exists precisely to test a cross-origin boundary — it is what
  surfaced the missing `Access-Control-Expose-Headers`. But its web container is `localhost:5174`
  and its API is `localhost:5001`: different *origins*, the same *site*, because a port is not part
  of a site. `Access-Control-Expose-Headers` is governed by origin, so CI catches it; `SameSite` is
  governed by site, so CI cannot. Two different scopes, and the suite varies only one of them. The
  fix derives the value from the `CLIENT_ORIGIN` and `API_URL` hostnames rather than adding a switch,
  so there is nothing new to set wrong.
- **The `Access-Control-Expose-Headers` fix was re-confirmed against the live stack, not assumed from
  the test.** `curl -X OPTIONS` with `Origin: http://localhost:5173` against the running API returns
  `Access-Control-Allow-Origin: http://localhost:5173`, `Access-Control-Allow-Credentials: true` and
  `Access-Control-Expose-Headers: Content-Disposition` — the real preflight a browser performs before
  it will reveal the filename. That mechanism is identical in production because it is origin-scoped,
  and CI's stack is genuinely cross-origin. What CI cannot reach is the browser-side half on two real
  domains, which is why DEPLOYMENT.md §6.4 makes it an explicit post-deploy check rather than an
  assumption.
- **Lighthouse was re-run rather than trusted, and the re-run caught two ways to measure the wrong
  page.** Phase 13 ticked the box but no number survived anywhere in the repository. Auditing
  `/dashboard` through a Playwright `browser.newPage()` puts Lighthouse's CDP tab in a different
  browser context with no cookies, so it silently measures `/login` and reports a perfect score for a
  page nobody asked about; auditing `/` while signed in redirects to the dashboard, because that
  redirect is the specified behaviour. Both were caught by asserting on `finalDisplayedUrl` rather
  than the requested URL. Final numbers, now in the README: landing 100 / 100 / 96 / 100, dashboard
  98 / 100 / 100 / 100, against targets of 90 / 95 / 95 / 95.
- **Source maps were being published.** `sourcemap: true` in the Vite config puts 43 `.map` files
  into `client/dist`, which is exactly the directory a static host serves, so the whole readable
  source sat one predictable `.js.map` fetch away. Turning maps off would lose the thing they are
  for, so `npm run build:deploy` builds and then strips: 43 maps and 43 `sourceMappingURL` comments
  removed, zero remaining, verified on a real build.
- **`npm run stats` was built here rather than left deferred.** Phase 14 skipped it accurately —
  §16's Phase 14 definition does not list it and neither does the definition of done — but SPEC §14
  requires it and nothing later would have picked it up. Verified against the live database:
  1 active user, 0 soft-deleted, 64 applications, 1 signup in the last 7 days.
- **API latency is now recorded**, which SPEC §10 asked for and no phase had done: sequential p95
  30.5 ms on `GET /applications` against the 200 ms threshold, so no index was added. The run is
  capped at 150-180 requests because SPEC §7's limiter allows 200 per 15 minutes, and that limiter is
  part of the configuration being measured.
- **Coverage was re-measured, and the number this repository had been carrying was stale.**
  `server/coverage/coverage-summary.json` on disk dated from 2026-09-04 and does not match the
  current run — the `--coverageReporters` flag does not forward through the workspace script, so a
  fresh summary has to come from the lcov HTML report rather than that file. Today's real figures,
  581 tests across 53 suites: `src/controllers` 100% statements / 93.75% branches,
  `src/services` 97.03% / 86.85%, whole server 92.33% / 74.27%. Against a 70% statement and 60%
  branch threshold. The README table now carries these instead of "near 98%".
- Deferred: nothing. Every SPEC §8 variable now exists; `CONTACT_EMAIL` stays a client build-time
  constant by decision rather than by omission, recorded in DECISIONS.

### Definition of Done (SPEC §17), item by item

`verified` = checked in this repository, with the evidence named. `pending deploy` = cannot be true
until the app is actually deployed to a domain, and is listed under manual steps below.

| #   | Item                                                            | State                                      | Evidence                                                                                                                                             |
| --- | --------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | lint, typecheck, test, build pass, zero warnings                 | verified                                   | `npm run verify` exit 0; `lint` is `eslint . --max-warnings 0 && prettier --check .`                                                                   |
| 2   | `docker compose up` runs mongo + api + web; app usable           | verified                                   | All three Up, mongo healthy; `web /` 200, `api /health` 200, `api /ready` 200                                                                          |
| 3   | `npm run seed` populates the demo account, charts have data      | verified                                   | `npm run stats`: 64 applications; Lighthouse audited the dashboard signed in through "Try the demo"                                                     |
| 4   | Register → … → export → logout in one manual pass                | verified (automated) / **pending deploy**  | All ten steps are covered by the eight Playwright flows; a single continuous human pass on the live site is still yours                                 |
| 5   | Refresh keeps you logged in; token expiry refreshes silently     | verified locally / **pending deploy**      | E2E flow 8 + `client/tests/api/refreshInterceptor.test.ts`; the cross-site half is the cookie fix, unprovable without two real domains — §6.4           |
| 6   | User A cannot reach user B's data, proven by a test              | verified                                   | `server/tests/application.ownership.test.ts`, 7 cases across single-record, list, bulk, interviews and export                                           |
| 7   | No TODO/FIXME/console.log/hardcoded secret/unused file in `src`  | verified                                   | grep over `server/src` and `client/src` is empty; the only `console.log` is in `e2e/audits/*.spec.ts`, the report SPEC §10 asks to print, and not `src` |
| 8   | Usable at 375, 768, 1440 px, dark and light                      | verified                                   | `e2e/audits/overflow.spec.ts`: 7 routes × 3 widths every CI run; `client/tests/theme/`                                                                  |
| 9   | Every mutation has loading, success toast, error path            | verified (Phase 9)                         | Not re-audited this phase; unchanged since                                                                                                             |
| 10  | README complete; `/api/docs` documents every endpoint            | verified                                   | `server/tests/openapi.test.ts` asserts parity both ways — every mounted route documented, and no documented route that no longer exists                 |
| 11  | Coverage report printed, meets target                            | verified                                   | 581 tests, 53 suites: controllers 100% stmts / 93.75% branches, services 97.03% / 86.85%, server 92.33% / 74.27%, against 70% / 60%                     |
| 12  | Account lifecycle end to end                                     | verified                                   | E2E flows 1 and 5 + `server/tests/accountLifecycle.tokens.test.ts`                                                                                     |
| 13  | forgot-password identical for a real and a fake email            | verified                                   | `server/tests/auth.noEnumeration.test.ts` — status, body, headers, order of magnitude of timing, and soft-deleted accounts                              |
| 14  | Reset/verification tokens single-use, expiring, stored hashed    | verified                                   | `accountLifecycle.tokens.test.ts` — "once", "past its window", "stores only the hash", for both token types                                             |
| 15  | Six emails render HTML + text; app boots with no SMTP            | verified                                   | `server/tests/mail.templates.test.ts` (prints a rendered email) + `server/tests/mail.noSmtpBoot.test.ts`                                                |
| 16  | Landing, /terms, /privacy real and linked; terms required        | verified                                   | `client/tests/marketing/legal.test.tsx` asserts substance, not merely that the page rendered                                                            |
| 17  | "Try the demo" works; destructive actions blocked there          | verified                                   | `server/tests/demoSandbox.test.ts`; also exercised live this phase — the Lighthouse run signed in through the real button                               |
| 18  | Export returns everything; deletion removes it all               | verified                                   | `server/tests/dataExport.test.ts` (a record from every model, no credentials, scoped to the account) + `auth.softDelete.test.ts`                        |
| 19  | Lighthouse reported for landing + dashboard, meets targets       | verified                                   | Measured this phase: landing 100/100/96/100, dashboard 98/100/100/100 against 90/95/95/95. README → Performance                                         |
| 20  | Resource caps, rate limits, upload validation each proven        | verified                                   | `resourceCaps.test.ts`, `auth.rateLimit.test.ts`, `attachment.test.ts`                                                                                  |
| 21  | `DEPLOYMENT.md` complete; cross-origin cookies explicit          | verified (written) / **pending deploy**    | 17 sections, every production variable, §6 is entirely cross-origin; its accuracy against a real deploy is unproven until you run it                    |
| 22  | No secret, real email or personal data committed, ever           | verified                                   | gitleaks over every commit: `no leaks found`; the history contains only the two `.env.example` files                                                    |
| 23  | Uploads survive a restart and a redeploy                         | verified (adapter) / **pending deploy**    | `server/tests/storage.contract.test.ts` runs one contract against both drivers; production is forced to `s3` by the env loader                          |
| 24  | Dates correct in two distant timezones                           | verified                                   | `analytics.timezone`, `reminderJob.timezone`, `weeklySummaryJob.timezone`, `mail.digestTimezone`, `dates` — Asia/Kuala_Lumpur and America/Los_Angeles    |
| 25  | Playwright suite and axe pass in CI against a real stack         | verified                                   | 13 tests, `retries: 0`, its own compose project; the CI run for this commit                                                                             |
| 26  | Bundle sizes within budget; Chart.js not on landing              | verified                                   | `check:bundle`: landing 111.4 KB/150 printing "excludes Chart.js", dashboard 215.4 KB/300                                                                |
| 27  | Stale edit returns 409, UI handles it; `migrate` runs clean      | verified                                   | `application.concurrency.test.ts`, `client/tests/board/conflictDialogSurvival.test.tsx`, `migrations.test.ts`                                            |
| 28  | LICENSE, CONTRIBUTING, CoC, SECURITY, CHANGELOG, templates       | verified                                   | All nine files present                                                                                                                                  |
| 29  | SPF/DKIM/DMARC documented **and** a test email reached Gmail     | verified (documented) / **pending deploy** | Records, syntax and rollout in DEPLOYMENT.md §7.2; inbox placement needs a live domain                                                                   |

Five items carry a `pending deploy` half — 4, 5, 21, 23 and 29 — plus the uptime monitor, Sentry
receiving live events, and backups being enabled. Every one of them needs infrastructure that does
not exist yet. **None of them is blocked by code.**

## Phase 17 — Optional
- [ ] Google OAuth (only if phases 1–16 are green and nothing regresses)

---

## Manual steps waiting on me (the human)
_The agent appends anything it cannot do itself here — DNS records, account signups, secrets to generate._

- [ ] **Fill `{{CONTACT_EMAIL}}`.** It now appears in four places, all fed from one constant:
      set `CONTACT_EMAIL` in `client/src/lib/siteMeta.ts` and the landing footer's mailto, the
      Terms contact line and the Privacy contact line all follow. The literal placeholder also
      sits in `client/content/terms.md` and `client/content/privacy.md` for anyone reading the
      markdown directly, and in SECURITY.md. A test asserts the placeholder is still present,
      so it will start failing once you replace it — update
      `client/tests/marketing/legal.test.tsx` in the same commit.
- [ ] **Set `VITE_APP_URL` before deploying.** `sitemap.xml` and `robots.txt` are generated
      from it (`npm run assets -w client`), and they currently carry `http://localhost:5173`.
- [ ] **Re-run `npm run screenshot -w client` after any dashboard redesign.** The landing page
      shows a real capture of the demo account, not a mock-up, so it goes stale when the
      dashboard changes.

### Phase 16 — everything that needs a real deployment

`DEPLOYMENT.md` is the walkthrough for all of this; the pointers below are so nothing is lost.

- [ ] **Create the four accounts.** MongoDB Atlas, Render, Vercel, and an email provider
      (Resend is the documented default). DEPLOYMENT.md steps 1, 4, 5 and 7.
- [ ] **Buy a domain.** Optional for the app, required for email: no consumer address can pass
      DMARC for mail you send, so verification emails from a `@gmail.com` sender land in spam.
- [ ] **Generate two fresh JWT secrets** with `openssl rand -base64 48` and never reuse the
      development ones. The env loader refuses to boot in production if you do.
- [ ] **Publish the SPF, DKIM and DMARC records** your provider shows you, then confirm with
      `dig` and wait for the dashboard to say Verified. DEPLOYMENT.md §7.2.
- [ ] **Send a verification email to a real Gmail, Outlook and Yahoo address** and confirm it
      lands in the Inbox with `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS` under Gmail's Show
      original. This is Definition-of-Done item 29 and nothing in this repository can prove it.
- [ ] **Walk DEPLOYMENT.md §6.4 in a browser once the two domains are live.** Confirm the
      `refresh_token` cookie reads `SameSite=None; Secure`, that a hard reload keeps you signed
      in, and that Export CSV saves the dated filename. This is the one part of the deployment
      that fails silently, and it is the half of the cookie fix that CI structurally cannot
      reach.
- [ ] **Create the UptimeRobot monitor** on `https://<api>/health` at 5-minute intervals. It is
      both the availability alert and the keep-warm that stops Render's free tier sleeping.
- [ ] **Run `npm run seed -w server` against Atlas** so "Try the demo" has an account.
- [ ] **Run `scripts/backup.sh` once and test a restore.** Atlas M0 has no automated backup —
      that is a real gap in the free tier, not a setting to find.
- [ ] **Optional: enable Sentry**, then trigger one deliberate 500 and confirm it arrives. An
      error tracker nobody has tested is an error tracker that is not working.
- [ ] **Enable the deploy workflow** by setting the `DEPLOY_ENABLED` repository secret to
      `true` plus the two deploy-hook URLs. It is inert until you do.

## Deferred / known issues
_Anything intentionally postponed, with the reason._

- **RESOLVED in Phase 15.** Real-browser verification is no longer deferred: `@playwright/test` and
  Chromium are installed, and `e2e/audits/overflow.spec.ts` drives all seven routes at 375, 768 and
  1440 px on every run, in CI as well as locally.
- Production Docker image stages and the split-host deployment configuration are Phase 16 work.
- **FIXED before Phase 11 began — the board's version-conflict dialog vanishing mid-interaction.**
  The mutation, the conflict state, the pending drop and the dialog were hoisted out of
  `KanbanBoard` into `BoardPage`, which owns the query and so cannot be unmounted by it;
  `KanbanBoard` is now presentational with an `onMove` callback.
  `client/tests/board/conflictDialogSurvival.test.tsx` reproduces the failure deterministically —
  a gated list responder plus `resetQueries` while the prompt is open — and all three of its cases
  fail against the pre-fix components with "Unable to find role=dialog" and pass against the fixed
  ones. The audit found the same pattern in `ApplicationsPage`'s edit modal (`editing` derived from
  the list, so a blink closes it mid-edit) and in `ApplicationDetailPage`'s early return above its
  three modals; both are reported, neither is fixed. **`dragAndDrop.test.tsx`'s overwrite case is
  still intermittent and the required 20-run clean loop was not achieved** — it passes 8/8 alone and
  fails ~3-in-4 when the two cases before it run first, which is test isolation, not this defect.
  Details in `DECISIONS.md`. The original description follows.
- **The board's version-conflict dialog can vanish mid-interaction, discarding the user's move.**
  Found by the first real CI run in Phase 10. `BoardPage` renders `KanbanBoard` only while the query
  has data, and the optimistic write plus rollback leaves that query briefly with none, so the board
  is unmounted and rebuilt while the 409 dialog is open. `pendingDrop` dies with the old instance and
  `onOverwrite` then silently does nothing. Reproduces locally about twice in six runs and makes CI
  intermittently red. A partial fix (`placeholderData` on the board query) was tried and reverted for
  only reducing it. **Fix this before starting Phase 11 feature work.**
