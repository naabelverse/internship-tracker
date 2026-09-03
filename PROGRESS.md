# PROGRESS

Update this after every phase. A phase is only done when `npm run verify` passes and every box below it is ticked.

**Status:** Phase 6 complete
**Current phase:** 7
**Last updated:** 2026-09-04

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
- [ ] dnd-kit Kanban, per-column counts, optimistic status change with rollback
- [ ] Deadline chips (amber ≤3 days, red overdue)
- [ ] Calendar month view with deadline and interview events

## Phase 8 — Dashboard + charts
- [ ] Stat cards with period deltas
- [ ] Line, doughnut, source bar, funnel, top-companies charts
- [ ] Activity heatmap grid
- [ ] Charts re-theme correctly on dark/light toggle
- [ ] Upcoming panel, empty states, skeletons

## Phase 9 — Settings, polish, a11y, responsive
- [ ] Settings: profile, password, preferences, timezone
- [ ] Theme toggle persisted
- [ ] Keyboard nav, focus traps, aria labels, contrast pass
- [ ] Verified at 375 / 768 / 1440 px in both themes

## Phase 10 — Seed, tests, docs, CI
- [ ] Seed: demo user + 60+ realistic applications, every chart populated
- [ ] Coverage target met on services and controllers
- [ ] README complete (setup, env table, endpoints, mermaid ERD, demo creds)
- [ ] CI workflow green

## Phase 11 — Account lifecycle
- [ ] Email verification (hashed single-use token, 24 h, resend limited)
- [ ] Forgot + reset password pages and endpoints
- [ ] No user enumeration on forgot-password (test proves it)
- [ ] Email change with pending-email confirmation
- [ ] Session list + revoke, account lock after repeated failures
- [ ] Soft delete + 30-day purge job
- [ ] Tests green

## Phase 12 — Email system
- [ ] Provider-agnostic transport + console fallback (app boots with no SMTP)
- [ ] All six templates, HTML + plain text
- [ ] Retry queue; a failed send never fails the HTTP request
- [ ] Preferences respected except for security mail

## Phase 13 — Public surface
- [ ] Landing page (hero, features, screenshots, FAQ, footer)
- [ ] Demo login into the sandboxed account, destructive actions blocked
- [ ] Terms + Privacy pages, terms checkbox at registration
- [ ] SEO: meta, OG, sitemap, robots, manifest, favicons, og-image
- [ ] Lighthouse scores recorded and meeting targets

## Phase 14 — Hardening
- [ ] Resource caps, disposable email blocklist, honeypot
- [ ] Upload validation, EXIF stripping, S3/R2 adapter working in production mode
- [ ] Timezone pass: UTC storage, user-tz rendering and aggregations, two-timezone tests
- [ ] Optimistic concurrency 409 handled in UI, migration runner + example migration
- [ ] Data export, account deletion UI
- [ ] Request IDs, structured logs, optional Sentry, backup script

## Phase 15 — E2E, performance, repo hygiene
- [ ] All eight Playwright flows pass in CI
- [ ] axe checks: zero critical/serious violations
- [ ] Code splitting, bundle budgets met, sizes reported
- [ ] LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, CHANGELOG, GitHub templates
- [ ] Git history scanned, no secrets

## Phase 16 — Ship
- [ ] `DEPLOYMENT.md` complete (Atlas + Render + Vercel, env vars, cross-origin cookies, trust proxy)
- [ ] SPF/DKIM/DMARC documented; test email reached a real Gmail inbox, not spam
- [ ] Deploy workflow, uptime monitor
- [ ] Definition of Done (SPEC.md Section 17) verified item by item

## Phase 17 — Optional
- [ ] Google OAuth (only if phases 1–16 are green and nothing regresses)

---

## Manual steps waiting on me (the human)
_The agent appends anything it cannot do itself here — DNS records, account signups, secrets to generate._

- [ ] Fill `{{CONTACT_EMAIL}}` in Terms, Privacy, and SECURITY.md

## Deferred / known issues
_Anything intentionally postponed, with the reason._

- Real-browser verification of the client is deferred to Phase 15: no Chrome/Playwright browser is
  installed on this machine yet, so Phase 1 proved the stack with HTTP-level checks against the
  compose containers instead. Phase 15 installs the Playwright browsers and covers this properly.
- Production Docker image stages and the split-host deployment configuration are Phase 16 work.
