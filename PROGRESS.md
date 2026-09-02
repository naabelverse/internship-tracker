# PROGRESS

Update this after every phase. A phase is only done when `npm run verify` passes and every box below it is ticked.

**Status:** Phase 4 complete
**Current phase:** 5
**Last updated:** 2026-09-03

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
- [ ] Vite + Tailwind theme tokens (light + dark), no flash of wrong theme
- [ ] Layout shell, router, protected routes, 404 page
- [ ] TanStack Query setup, axios client with silent-refresh interceptor + request queue
- [ ] Login and register pages with validation
- [ ] Toast system + error boundary

## Phase 6 — Applications UI
- [ ] Table with server-side pagination, sorting, filters synced to URL
- [ ] Debounced search, column visibility, row selection, bulk actions bar
- [ ] Create/edit modal with optimistic update and rollback
- [ ] Detail page: timeline, markdown notes with autosave, attachments

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
