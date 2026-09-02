# Claude Code Prompt — Internship Tracker (MERN)

> **How to use:** create an empty folder, `git init`, and save this file inside it as `SPEC.md` along with `CLAUDE.md` and `PROGRESS.md`. Then open Claude Code in that folder and send:
>
> `Read SPEC.md, CLAUDE.md and PROGRESS.md. Then begin Phase 1.`
>
> Every later session starts with: `Read CLAUDE.md and PROGRESS.md, then continue from the first unchecked phase.`
> This is a multi-session build — do not expect all 17 phases in one run.

---

You are the lead engineer for this project. Build a **production-quality, full-stack Internship Application Tracker** from scratch. This is a portfolio-grade project, so quality, structure, and polish matter as much as features.

## 0. Working agreement (read this first)

1. **Do not ask me clarifying questions.** Where something is ambiguous, pick the sensible option, write it down in `DECISIONS.md`, and continue.
2. **Work in the phases listed in Section 16.** After each phase: run the build, run lint, run the tests, fix everything that fails, then `git commit` with a conventional-commit message and print a short summary of what changed.
3. **No placeholders.** No `TODO`, no `// implement later`, no stub functions, no fake/mocked data paths in production code, no `lorem ipsum`. Every button, route, filter, and chart must actually work end to end.
4. **No dead code.** If you create a file, it must be imported and used.
5. Prefer small, readable modules over clever one-liners. Every non-obvious function gets a short JSDoc comment.
6. Use TypeScript everywhere (backend and frontend). Strict mode on. No `any` unless justified with a comment.
7. Before you start writing code, print the full file tree you intend to create so I can see the plan.
8. If a package you want has known install problems, choose a stable alternative and note it in `DECISIONS.md`.

## 1. Product summary

A personal dashboard where a student saves internship openings and tracks every application through its full lifecycle: saved → applied → online assessment → interview → offer / rejected / ghosted / withdrawn. It gives them a Kanban board, a data table, a calendar of deadlines and interviews, reminders, and an analytics dashboard with charts.

Single-tenant per user: every user only ever sees their own data. Enforce this at the query level, not just the UI.

## 2. Tech stack (locked — do not substitute)

**Backend**
- Node.js 20 + Express 4, TypeScript
- MongoDB + Mongoose 8
- JWT auth: short-lived access token (15 min, in memory on client) + refresh token (7 days, httpOnly secure cookie, rotated on use)
- `bcryptjs` for password hashing (12 rounds)
- `zod` for request validation (shared schemas where practical)
- `helmet`, `cors`, `express-rate-limit`, `compression`, `cookie-parser`
- `multer` for file uploads behind a **storage adapter interface** (`LocalDiskStorage` for dev/tests, `S3Storage` for production — Cloudflare R2 or S3-compatible, selected by `STORAGE_DRIVER`). This is not optional: the free-tier hosts have ephemeral filesystems, so anything written to local disk is destroyed on every redeploy and restart. Uploads must go to object storage in production, with presigned time-limited URLs for downloads and no public bucket listing.
- `node-cron` for the reminder job
- `winston` + `morgan` for logging
- `nodemailer` for transactional email, `express-mongo-sanitize` for injection protection, `@aws-sdk/client-s3` for the production storage adapter, `sharp` for image processing and EXIF stripping
- `swagger-ui-express` + OpenAPI 3 spec for API docs at `/api/docs`
- Testing: `jest` + `supertest` + `mongodb-memory-server`; `autocannon` for the load sanity check

**Frontend**
- React 18 + Vite + TypeScript
- Tailwind CSS + a small custom component layer (no heavyweight UI kit)
- `react-router-dom` v6 with protected route wrapper
- TanStack Query (React Query) for all server state; Zustand for small client state (theme, filters, UI)
- `react-hook-form` + `zod` resolver for every form
- **Chart.js + react-chartjs-2** for all charts (required)
- `@dnd-kit/core` for the Kanban drag and drop
- `date-fns` for dates, `axios` with interceptors for the API client
- `react-hot-toast` for notifications
- `react-helmet-async` for per-route document head and SEO tags
- Testing: `vitest` + React Testing Library; `@playwright/test` + `@axe-core/playwright` for end-to-end and accessibility runs

**Tooling**
- ESLint + Prettier, shared config, `--max-warnings 0`
- `husky` + `lint-staged` pre-commit hook
- `docker-compose.yml` running api + web + mongo
- GitHub Actions CI: install → lint → typecheck → test → build

## 3. Repository structure

Monorepo with npm workspaces:

```
internship-tracker/
├─ README.md
├─ SPEC.md                      (this document, committed for reference)
├─ CLAUDE.md                    (conventions + how to resume work)
├─ PROGRESS.md                  (phase checklist, updated after each phase)
├─ DECISIONS.md
├─ DEPLOYMENT.md
├─ CHANGELOG.md
├─ LICENSE / CONTRIBUTING.md / CODE_OF_CONDUCT.md / SECURITY.md
├─ docker-compose.yml
├─ .github/workflows/ci.yml, deploy.yml
├─ .github/ISSUE_TEMPLATE/, pull_request_template.md
├─ scripts/backup.sh
├─ e2e/                         (Playwright specs + fixtures, runs against the compose stack)
├─ package.json                 (workspaces: server, client)
├─ server/
│  ├─ src/
│  │  ├─ config/                (env loader w/ zod, db connection, logger)
│  │  ├─ models/                (User, Application, Reminder, RefreshToken)
│  │  ├─ schemas/               (zod request/response schemas)
│  │  ├─ controllers/
│  │  ├─ services/              (business logic — controllers stay thin)
│  │  ├─ routes/
│  │  ├─ middleware/            (auth, validate, errorHandler, notFound, rateLimit, upload, requestId, limits)
│  │  ├─ storage/               (StorageAdapter interface, LocalDiskStorage, S3Storage)
│  │  ├─ emails/                (transport, queue, templates/ with html + text)
│  │  ├─ jobs/                  (reminder cron, demo reset, soft-delete purge)
│  │  ├─ migrations/            (sequential runner + migration files)
│  │  ├─ utils/                 (ApiError, asyncHandler, csv, pagination, analytics, dates/timezone)
│  │  ├─ docs/                  (openapi.ts)
│  │  ├─ seed/                  (seed.ts — realistic demo data)
│  │  ├─ app.ts
│  │  └─ index.ts
│  ├─ tests/                    (unit + integration)
│  └─ .env.example
└─ client/
   ├─ public/                   (robots.txt, sitemap.xml, manifest, favicons, og-image.png)
   ├─ content/                  (terms.md, privacy.md)
   ├─ src/
   │  ├─ api/                   (axios instance, endpoint modules, query keys)
   │  ├─ components/            (ui/, layout/, charts/, applications/, kanban/, calendar/, marketing/)
   │  ├─ features/              (auth, applications, dashboard, settings)
   │  ├─ hooks/
   │  ├─ lib/                   (formatters, constants, statusConfig, timezone, cn())
   │  ├─ pages/                 (incl. Landing, Terms, Privacy, ForgotPassword, ResetPassword, VerifyEmail, NotFound)
   │  ├─ store/
   │  ├─ types/
   │  ├─ App.tsx
   │  └─ main.tsx
   ├─ tests/
   └─ .env.example
```

## 4. Data models

### User
| field | type | notes |
|---|---|---|
| name | string | 2–60 chars |
| email | string | unique, lowercase, indexed |
| password | string | bcrypt hash, `select: false` |
| avatarUrl | string? | |
| university | string? | |
| gradYear | number? | |
| targetRoles | string[] | e.g. ["Frontend Intern"] |
| weeklyGoal | number | default 5 applications/week |
| theme | 'light' \| 'dark' \| 'system' | default 'system' |
| timezone | string | IANA name, e.g. 'Asia/Kuala_Lumpur'; captured at registration, editable |
| emailRemindersEnabled | boolean | default true |
| lastLoginAt | Date? | |
| emailVerified | boolean | default false |
| emailVerificationTokenHash | string? | `select: false`, sha256 of the emailed token |
| emailVerificationExpires | Date? | |
| pendingEmail | string? | set during an email change until confirmed |
| passwordResetTokenHash | string? | `select: false` |
| passwordResetExpires | Date? | |
| passwordChangedAt | Date? | invalidates access tokens issued before it |
| failedLoginAttempts | number | default 0 |
| lockedUntil | Date? | soft lock for 15 min after 10 consecutive failures |
| acceptedTermsAt | Date | required at registration |
| deletedAt | Date? | soft delete, purged by a job after 30 days |
| isDemo | boolean | default false; blocks destructive actions and nightly reset |
| schemaVersion | number | default 1, used by the migration runner |
| timestamps | | |

Methods: `comparePassword()`, pre-save hash hook, `toJSON` strips password.

### Application (owned by user)
| field | type | notes |
|---|---|---|
| user | ObjectId ref User | indexed, required |
| company | string | required |
| companyWebsite | string? | |
| companyLogoUrl | string? | auto-derive from domain via Clearbit-style URL; fall back to initials avatar |
| role | string | required |
| location | string? | |
| workMode | 'remote' \| 'hybrid' \| 'onsite' | |
| employmentType | 'internship' \| 'part-time' \| 'full-time' | default internship |
| stipend | { amount: number, currency: string, period: 'month'\|'year'\|'hour' } | optional |
| status | enum | `saved, applied, assessment, interview, offer, rejected, ghosted, withdrawn` |
| priority | 'low' \| 'medium' \| 'high' | default medium |
| source | enum | `linkedin, internshala, indeed, company_site, referral, career_fair, other` |
| jobUrl | string? | url validated |
| appliedDate | Date? | |
| deadline | Date? | |
| nextActionDate | Date? | derived from next interview/deadline |
| contact | { name, email, role, linkedin } | optional |
| resumeVersion | string? | |
| tags | string[] | indexed |
| notes | string? | markdown, max 10k |
| interviews | Interview[] | embedded subdocs |
| statusHistory | { from, to, changedAt, note }[] | auto-appended on every status change |
| archived | boolean | default false |
| attachments | { filename, originalName, mimeType, size, url, uploadedAt }[] | |
| schemaVersion | number | default 1 |
| timestamps | | |

Compound indexes: `{ user: 1, status: 1 }`, `{ user: 1, deadline: 1 }`, text index on `company, role, notes, tags`.

### Interview (embedded)
`type` (`oa | phone_screen | technical | hr | managerial | final`), `scheduledAt`, `durationMins`, `mode` (`onsite | video | phone`), `link`, `interviewer`, `round` (number), `outcome` (`pending | passed | failed | cancelled`), `feedback`, `prepNotes`.

### Reminder
`user`, `application` (ref), `type` (`deadline | interview | followup | custom`), `title`, `dueAt`, `sent` (boolean), `readAt`, `channel` (`in_app | email`).

### RefreshToken
`user`, `tokenHash`, `expiresAt`, `revokedAt`, `replacedBy`, `userAgent`, `ip`. Rotate on refresh, revoke the whole family on reuse detection.

## 5. API specification

Base path `/api/v1`. All responses use a consistent envelope: `{ success, data, message?, meta? }`. All errors: `{ success: false, message, code, errors? }`.

**Auth**
- `POST /auth/register` — name, email, password → creates user (unverified), sends verification email, sets refresh cookie, returns access token + user
- `POST /auth/login`
- `POST /auth/refresh` — rotates refresh token
- `POST /auth/logout` — revokes token, clears cookie
- `POST /auth/logout-all` — revokes every refresh token for the user
- `POST /auth/verify-email` — body `{ token }`; single-use, 24 h expiry
- `POST /auth/resend-verification` — rate limited to 3 / hour / account
- `POST /auth/forgot-password` — body `{ email }`; **always returns 200 with the same message** whether or not the account exists (no user enumeration); sends a reset link with a hashed, single-use, 30-minute token
- `POST /auth/reset-password` — body `{ token, password }`; consumes the token, revokes all refresh tokens, sends a "your password was changed" email
- `GET  /auth/me`
- `PATCH /auth/me` — profile fields; changing email re-triggers verification and keeps the old email active until confirmed
- `PATCH /auth/me/password` — requires current password; revokes all other sessions
- `GET  /auth/sessions` — list active refresh tokens (device, IP, last used) so users can see and revoke logins
- `DELETE /auth/sessions/:id`
- `DELETE /auth/me` — requires password confirmation; cascade-deletes all user data and uploaded files, sends a confirmation email
- Rate limit: 5 attempts / 15 min on login, register, forgot-password and reset-password, keyed on IP **and** email separately.
- Unverified users may use the app for 7 days, after which write endpoints return 403 with `code: EMAIL_UNVERIFIED` and the client shows a persistent banner with a resend button. Never block login itself on verification.

**Applications**
- `GET /applications` — query params: `search, status[], source[], workMode[], priority[], tags[], company, dateFrom, dateTo, archived, sort (field:dir), page, limit`. Returns paginated results + `meta { total, page, limit, totalPages }`.
- `POST /applications`
- `GET /applications/:id`
- `PATCH /applications/:id`
- `DELETE /applications/:id`
- `PATCH /applications/:id/status` — body `{ status, note? }`; appends to `statusHistory`
- `POST /applications/bulk` — body `{ ids[], action: 'delete'|'archive'|'unarchive'|'setStatus', payload? }`
- `GET /applications/export?format=csv|json`
- `POST /applications/import` — CSV upload, returns `{ imported, skipped, errors[] }` with per-row reasons
- `POST /applications/:id/attachments` — multipart, max 5 MB, pdf/doc/docx/png/jpg only
- `DELETE /applications/:id/attachments/:attachmentId`

**Interviews**
- `POST /applications/:id/interviews`
- `PATCH /applications/:id/interviews/:interviewId`
- `DELETE /applications/:id/interviews/:interviewId`

**Analytics**
- `GET /analytics/summary` — totals, active count, response rate, interview rate, offer rate, avg days to first response, current streak, weekly goal progress
- `GET /analytics/status-breakdown`
- `GET /analytics/timeline?granularity=day|week|month&range=30d|90d|1y` — applications created + status changes over time
- `GET /analytics/by-source`
- `GET /analytics/funnel` — applied → assessment → interview → offer with conversion percentages
- `GET /analytics/top-companies`
- All analytics use MongoDB aggregation pipelines, not in-memory JS filtering.

**Calendar / Reminders**
- `GET /calendar?from=&to=` — merged deadlines + interviews
- `GET /reminders?unreadOnly=true`
- `PATCH /reminders/:id/read`
- `POST /reminders` / `DELETE /reminders/:id`

**Meta**
- `GET /health` — db status + uptime
- `GET /api/docs` — Swagger UI

Every protected route uses the `requireAuth` middleware, and every service function takes `userId` and scopes the query by it. Add a test that proves user A cannot read or mutate user B's application (expect 404, not 403 — don't leak existence).

## 6. Frontend pages & behaviour

**Routes**
- `/login`, `/register` — split-screen layout, form validation, show/hide password, friendly server error mapping
- `/` → Dashboard (protected)
- `/applications` → table view
- `/applications/board` → Kanban
- `/applications/calendar` → calendar
- `/applications/:id` → detail drawer/page
- `/settings` → profile, password, preferences, data export, delete account
- `*` → 404 page

**Dashboard**
- Top row: 4–6 stat cards (Total, Active, Interviews, Offers, Response rate, Weekly goal ring) each with a delta vs previous period.
- Charts (all Chart.js):
  1. **Line** — applications over time, switchable day/week/month
  2. **Doughnut** — status breakdown with custom legend and center total
  3. **Bar** — applications by source
  4. **Horizontal bar / funnel** — conversion funnel with percentages
  5. **Bar** — top 10 companies applied to
  6. Optional heatmap-style grid — activity per day over the last 12 weeks (build with CSS grid, not Chart.js)
- Charts must respect the dark/light theme (read CSS variables, re-render on theme change), have proper tooltips, no fixed pixel colors, and animate on mount.
- "Upcoming" panel: next 5 deadlines and interviews with relative dates ("in 3 days").
- Empty state when the user has no applications, with a CTA that opens the create modal and an "Load demo data" button.

**Applications table**
- Server-side pagination, sorting, filtering. All filter state synced to URL query params so views are shareable and survive refresh.
- Debounced search (300 ms).
- Row selection + bulk actions bar.
- Column visibility toggle, saved to localStorage.
- Inline status change via a dropdown that hits `PATCH /status`.
- Create/Edit in a modal with `react-hook-form` + zod; optimistic update via React Query with rollback on error.

**Kanban board**
- Columns for each status, colour-coded, with per-column counts.
- Drag a card between columns → PATCH status, optimistic, rollback + toast on failure.
- Card shows company logo/initials, role, priority dot, deadline chip that turns amber at ≤3 days and red when overdue, and tags.

**Calendar**
- Month grid, events for deadlines (red) and interviews (blue), click a day for a list, click an event to open detail.

**Detail view**
- Header with company + role + status pill, quick actions (change status, add interview, archive, delete with confirm dialog).
- Vertical timeline built from `statusHistory` + interviews.
- Notes editor with markdown preview and autosave (debounced 1 s).
- Attachments list with upload dropzone.

**Cross-cutting UI**
- Dark mode by default with a light theme toggle, persisted, no flash of wrong theme on load (inline script in `index.html`).
- Skeleton loaders for every async surface — never a bare spinner on a full page.
- Error boundary + a friendly error state with retry.
- Fully responsive: usable at 375 px (board becomes a horizontally scrollable column list; table becomes stacked cards).
- Accessibility: keyboard-navigable modals with focus trap and Escape to close, `aria-label` on icon buttons, visible focus rings, colour contrast ≥ 4.5:1, charts accompanied by a screen-reader-friendly data summary.
- Toasts for every mutation success/failure.

## 7. Security & reliability requirements

- Passwords never returned, never logged.
- Access token in memory only; refresh token in an httpOnly, sameSite=strict, secure-in-prod cookie.
- Axios response interceptor: on 401, attempt one silent refresh, queue concurrent requests during refresh, and hard-logout if refresh fails.
- Helmet, CORS locked to the client origin from env, body size limit 1 MB (except uploads).
- Rate limit: global 200 req / 15 min, auth routes stricter.
- Mongo injection protection (`express-mongo-sanitize`), and never interpolate user input into a regex without escaping.
- Validate every uploaded file's mimetype and size; store with a generated filename, never the user's.
- Central error handler that maps Mongoose `CastError`/`ValidationError`/duplicate-key to clean 400/409 responses and hides stack traces in production.
- Graceful shutdown on SIGTERM (close server, then Mongo).

**Timezone correctness** (do not skip — this is the most common source of silent bugs in a tracker like this)
- Store every timestamp in UTC. Persist the user's IANA timezone (`timezone` field on User, auto-detected via `Intl.DateTimeFormat().resolvedOptions().timeZone` at registration, editable in Settings).
- Deadlines and interview times are user-facing wall-clock moments: render them in the user's timezone everywhere, never the server's or the browser's default.
- "Today", "this week", the activity heatmap, streaks, and the weekly-goal window must be computed in the **user's** timezone, which means the analytics aggregations need a timezone argument (`$dateToString` with `timezone`), not a naive UTC day boundary.
- The reminder cron runs hourly in UTC and selects reminders whose local send time has arrived for each user — a single daily UTC job would fire at the wrong local hour for most people.
- Write tests with users in at least two very different timezones (e.g. `Asia/Kuala_Lumpur` and `America/Los_Angeles`) proving the day boundaries and reminder timing are correct for both.

**Concurrency & schema evolution**
- Enable Mongoose `optimisticConcurrency` on Application. If a client PATCHes a stale version, return 409 with the current document; the UI shows a "this was changed elsewhere" prompt with reload/overwrite options.
- Add a `schemaVersion` field to User and Application, plus a `server/src/migrations/` directory with a simple sequential runner (`npm run migrate`) and one no-op example migration. Once real users exist you cannot change a schema by editing the model alone, so the mechanism has to exist before launch.

## 8. Environment variables

Create `.env.example` in both workspaces with every variable documented and a zod-validated loader that throws on boot if anything is missing.

Server: `NODE_ENV, PORT, MONGO_URI, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL, CLIENT_ORIGIN, APP_URL, STORAGE_DRIVER (local|s3), UPLOAD_DIR, S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, MAX_UPLOAD_MB, MAIL_FROM, MAIL_TRANSPORT (smtp|console), SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, DEMO_EMAIL, DEMO_PASSWORD, SENTRY_DSN (optional), TRUST_PROXY, COOKIE_DOMAIN, CONTACT_EMAIL`.

Client: `VITE_API_URL, VITE_APP_URL, VITE_SENTRY_DSN (optional), VITE_DEMO_ENABLED, VITE_ANALYTICS_DOMAIN (optional), VITE_ANALYTICS_SRC (optional)`.

The zod loader must fail loudly at boot in production if any secret is still the example value, shorter than 32 characters, or missing — but must allow the app to run in development with only `MONGO_URI` and the two JWT secrets set.

## 9. Seed data

`npm run seed` in `server` creates one demo user (`demo@tracker.dev` / `Demo@1234`) and **60+ realistic applications** spread over the last 6 months, with a believable distribution across statuses, several interviews per in-progress application, varied sources, tags, deadlines (some past, some upcoming), and populated `statusHistory`. The dashboard must look genuinely good with this data — every chart populated, no empty panels. Add `npm run seed:reset` to wipe and reseed.

## 10. Testing

**Backend (Jest + supertest + mongodb-memory-server), minimum:**
- auth: register, duplicate email, login success/failure, refresh rotation, refresh reuse detection, logout, protected route without token
- applications: CRUD, validation failures, pagination, filtering, search, sorting
- ownership isolation (user A vs user B) — required
- status change appends history correctly
- bulk actions, CSV import happy path + malformed rows
- analytics aggregation returns correct numbers for a fixed fixture set

**Frontend (Vitest + RTL), minimum:**
- login form validation and submit
- protected route redirects when unauthenticated
- application create modal submits and shows in the list
- filter/search updates the query params
- status utils, date formatters, analytics transformers (unit tests)

Target ≥70% statement coverage on `server/src/services` and `server/src/controllers`. Print the coverage report at the end.

**End-to-end (Playwright) — required before a public launch.** Unit tests do not catch a broken auth cookie in production or a route that 404s on refresh. Cover these flows against a real running stack (`docker compose up` + seeded DB), headless, in CI:
1. Register → receive the verification token (read it from the console/mail transport in test mode) → verify → land on the dashboard
2. Login → create an application → it appears in the table and in the correct board column
3. Drag a card to another column → reload → the status persisted
4. Filter + search → the URL updates → reload → filters restored
5. Forgot password → reset → old password rejected, new password accepted
6. Export CSV → the file downloads and contains the expected header row
7. Logout → a protected route redirects to login
8. Session expiry: delete the access token, make a request, confirm the silent refresh recovers without the user seeing an error

**Accessibility.** Run `@axe-core/playwright` against the landing page, login, dashboard, board, and the create-application modal. Zero critical or serious violations. Print the report.

**Load sanity.** A short `autocannon` run against `GET /applications` with the seeded dataset; record p95 latency in the README. Add indexes if p95 exceeds 200 ms locally.

## 11. Documentation

`README.md` must contain: a one-paragraph pitch, a feature list, a screenshot placeholder section, the tech stack, architecture diagram (mermaid), full local setup (npm and Docker paths), env var table, all npm scripts, the API endpoint table, the data model diagram (mermaid ERD), the demo credentials, and a "possible extensions" section. Write it so a recruiter skimming for 30 seconds understands the project.

Also write `DECISIONS.md` logging every assumption you made and why.

**Repo files for a public repository** — this will be browsed by strangers and recruiters, so create all of them: `LICENSE` (MIT), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant), `SECURITY.md` (how to report a vulnerability privately, with a `{{CONTACT_EMAIL}}` placeholder), `CHANGELOG.md` (Keep a Changelog format, starting at 1.0.0), `.github/ISSUE_TEMPLATE/` (bug + feature), `.github/pull_request_template.md`, `.gitattributes`, and a `.gitignore` that covers `.env*` (except `.env.example`), `node_modules`, `dist`, `coverage`, `uploads/`, and OS junk files. Verify with `git log -p | grep -i` style checks that no secret or `.env` was ever committed.

## 12. Public launch requirements

This app will be shared publicly and will hold real people's data. Treat it as a live product, not a demo.

**Marketing / entry surface**
- A real landing page at `/` for logged-out visitors: hero with a one-line value proposition, 3–6 feature cards with icons, a product screenshot section, a short "how it works" strip, FAQ accordion, footer with links to Terms, Privacy, GitHub repo and contact. Logged-in users hitting `/` go straight to the dashboard.
- A **"Try the demo"** button that logs the visitor into a sandboxed read-mostly demo account seeded with the fixture data. The demo account resets on a nightly cron and blocks destructive actions (`DELETE /auth/me`, password change, email change) with a clear toast.
- SEO: per-route `<title>` and meta description via `react-helmet-async`, Open Graph + Twitter card tags, a generated `og-image.png`, `robots.txt`, `sitemap.xml`, canonical URLs, and a web manifest with favicons at all standard sizes.
- Lighthouse targets on the landing page and dashboard: Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95, SEO ≥ 95. Run it, print the scores, and fix what fails.
- **Performance budget.** Route-level code splitting with `React.lazy` + `Suspense`; Chart.js, the calendar, and dnd-kit must be lazy-loaded so they are not in the landing-page bundle. Initial JS on the landing route under 150 KB gzipped, dashboard route under 300 KB. Register only the Chart.js components you actually use (tree-shakeable imports, not `chart.js/auto`). Run `vite-bundle-visualizer` and report the final sizes.
- **Uptime & product analytics.** Document setting up a free uptime monitor (UptimeRobot or similar) pinging `/health` every 5 minutes. If you add product analytics, use a cookieless option (Plausible/Umami) so no cookie banner is needed, gate it behind `VITE_ANALYTICS_*` env vars, and disclose it in the privacy page.

**Legal & privacy (required — you are collecting emails and personal data)**
- `/terms` and `/privacy` pages rendered from markdown in the repo. Write real, specific content: what data is collected (name, email, password hash, the application records the user enters, uploaded files, IP + user agent for session records), why, how long it's retained, that it is never sold or shared, how to export it, how to delete it, and a contact address placeholder `{{CONTACT_EMAIL}}` for me to fill in.
- Registration requires an explicit checkbox accepting Terms and Privacy; store `acceptedTermsAt`.
- Settings must expose **Export all my data** (single JSON download containing everything the system stores about the user) and **Delete my account** (typed confirmation + password, soft-delete, then hard purge after 30 days including uploaded files).
- Cookie notice only if you add third-party analytics; if you use a cookieless analytics option, say so in the privacy page instead.

**Abuse prevention for an open signup**
- Disposable-email domain blocklist on registration (bundle a static list, fail open if it can't load).
- Per-account resource caps enforced server-side: 2,000 applications, 100 MB total uploads, 20 attachments per application. Return 429/403 with a clear message, and surface usage in Settings.
- Global request rate limit plus a stricter limit on upload and export endpoints.
- Honeypot field + timing check on the registration form (no third-party captcha unless you note it in `DECISIONS.md`).
- Strip EXIF metadata from uploaded images. Serve uploads with `Content-Disposition: attachment` and a non-guessable filename; never serve them from the same origin path as the app HTML.

## 13. Transactional email

- Nodemailer with a provider-agnostic transport configured from env (works with Resend, SendGrid, Mailgun, or plain SMTP). In development with no SMTP configured, fall back to a console transport that prints the full email — the app must still boot and register successfully with zero email config.
- Templates (responsive HTML + plain-text alternative, shared layout, app name and logo, unsubscribe/preferences link where applicable): **welcome + verify email**, **password reset**, **password changed**, **account deletion confirmation**, **deadline/interview reminder digest**, **weekly summary** (opt-in, sends the user's stats for the week).
- Queue with retry (3 attempts, exponential backoff) and log every send outcome. A failed email must never fail the HTTP request that triggered it.
- Every email respects the user's `emailRemindersEnabled` preference except security-critical ones (verification, reset, password changed).

**Deliverability.** A verification email that lands in spam is the same as no verification email at all. `DEPLOYMENT.md` must document: sending from a domain you control rather than a free consumer address, the exact **SPF**, **DKIM**, and **DMARC** DNS records the chosen provider requires, a real `From` name and reply-to, a plain-text alternative on every message (already required above), an unsubscribe header on non-transactional mail, and a warm-up note. Include a manual test step: send a verification email to a Gmail, an Outlook, and a Yahoo address and confirm inbox placement before launch.

## 14. Observability & operations

- Structured JSON logs in production with a request ID on every log line and response header; never log tokens, passwords, or full email bodies.
- Optional Sentry integration on both client and server, enabled only when `SENTRY_DSN` is set, with source maps uploaded in the build and PII scrubbing on.
- `/health` (liveness) and `/ready` (checks Mongo connectivity) endpoints suitable for a platform health check.
- A `scripts/backup.sh` using `mongodump` plus written restore instructions in the README. Document the free-tier Atlas backup setting to enable.
- Graceful shutdown, connection pool limits, and request timeouts.
- Basic in-app admin visibility: a `npm run stats` script printing user count, application count, signups in the last 7 days. No admin web UI.

## 15. Deployment

Produce a `DEPLOYMENT.md` with copy-paste steps for a **free-tier stack**: MongoDB Atlas + Render (or Railway) for the API + Vercel (or Netlify) for the client. Include:

- Atlas cluster creation, database user, IP allowlist, and connection string format.
- Every production env var with a note on how to generate it (`openssl rand -base64 48` for the JWT secrets) and an explicit warning never to reuse the dev secrets.
- Cross-origin cookie configuration for the split-host deployment: `sameSite: 'none'`, `secure: true`, `credentials: true` on CORS with an exact origin allowlist, and the `trust proxy` setting Express needs behind the platform's load balancer.
- Cold-start caveat on free tiers and how to keep the API warm.
- The exact build and start commands for each platform, plus the SPA rewrite rule so client-side routes don't 404 on refresh.
- Custom domain and HTTPS steps, and an HSTS header once the domain is live.
- A pre-launch checklist: secrets rotated, demo account seeded, verification email actually delivered to a real inbox, `NODE_ENV=production`, source maps not publicly exposed, error tracking receiving events, backups enabled.

Also add a `.github/workflows/deploy.yml` that runs the CI suite and only then triggers the deploy hooks (documented, disabled by default via a repo secret check).

## 16. Build phases

Complete these in order. Commit and summarise after each.

1. **Scaffold** — monorepo, workspaces, TS configs, ESLint/Prettier, husky, docker-compose, env loaders, health route, Mongo connection, logger, error handler. Verify: `docker compose up` boots, `/health` returns 200.
2. **Auth backend** — User model, register/login/refresh/logout/me, middleware, rate limits, tests green.
3. **Applications backend** — model, full CRUD, filtering/pagination/search/sort, status transitions with history, interviews subresource, ownership scoping, tests green.
4. **Analytics + calendar + reminders backend** — aggregation pipelines, cron job, CSV import/export, uploads, Swagger spec complete, tests green.
5. **Frontend foundation** — Vite app, Tailwind theme tokens (light + dark), layout shell with sidebar + topbar, router, React Query setup, axios client with refresh interceptor, auth pages, protected routes, toast + error boundary.
6. **Applications UI** — table view with all filters, create/edit modal, detail page with timeline and notes, attachments, bulk actions.
7. **Board + calendar UI** — dnd-kit Kanban with optimistic status updates, calendar month view.
8. **Dashboard + charts** — all Chart.js visuals, stat cards, theme-reactive, upcoming panel, empty states, skeletons.
9. **Settings, polish, a11y, responsive** — settings page, theme toggle, data export/delete, keyboard nav, focus traps, mobile layouts, loading/empty/error states everywhere.
10. **Seed, tests, docs, CI** — seed script, fill test gaps to the coverage target, README + DECISIONS, GitHub Actions workflow green.
11. **Account lifecycle** — email verification, forgot/reset password (backend + the `/forgot-password` and `/reset-password` pages), email change flow, session list and revocation, account lock after repeated failures, soft delete + purge job. Tests: token single-use, expiry, no user enumeration on forgot-password, session revocation after password change.
12. **Email system** — transport, all six templates, queue with retry, console fallback, preference handling. Verify by printing a rendered email in the test output.
13. **Public surface** — landing page, demo login, Terms and Privacy pages, terms checkbox at registration, SEO/meta/OG/sitemap/manifest/favicons, 404 and 500 pages. Run Lighthouse and report scores.
14. **Hardening** — resource caps, disposable email blocklist, honeypot, upload hardening and EXIF stripping, S3/R2 storage adapter, timezone correctness pass with tests, optimistic concurrency + migration runner, data export, account deletion UI, request IDs, structured logs, optional Sentry, `/ready`, backup script.
15. **E2E, performance, repo hygiene** — Playwright suite + axe checks in CI, code splitting and bundle budget, Lighthouse run, LICENSE/CONTRIBUTING/SECURITY/CHANGELOG and GitHub templates, secret-scan of the git history.
16. **Ship** — `DEPLOYMENT.md`, production config (cross-origin cookies, trust proxy, HSTS), email DNS records documented, deploy workflow, uptime monitor, pre-launch checklist verified item by item.
17. **Optional, only after 1–16 are green** — Google OAuth sign-in via Passport, linking to an existing account by verified email. If you attempt this, it must not weaken any existing flow; if anything in phases 1–16 would regress, skip it and note that in `DECISIONS.md`.

## 17. Definition of done

Do not tell me the project is finished until every one of these is true, and print this as a checklist with your verification for each:

- [ ] `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` all pass in both workspaces with zero errors and zero warnings
- [ ] `docker compose up` starts mongo + api + web, and the app is usable at `localhost:5173` against `localhost:5000`
- [ ] `npm run seed` populates the demo account and every dashboard chart renders with real data
- [ ] Register → login → create → filter → drag on board → add interview → change status → view charts → export CSV → logout all work in one manual pass
- [ ] Refreshing the page keeps the user logged in; access token expiry silently refreshes without a visible error
- [ ] User A cannot access user B's data via the API (proven by a test)
- [ ] No `TODO`, `FIXME`, `console.log`, hardcoded secret, or unused file anywhere in `src`
- [ ] The app is usable and looks correct at 375 px, 768 px, and 1440 px, in both dark and light themes
- [ ] Every mutation has a loading state, a success toast, and an error path
- [ ] README is complete and accurate; `/api/docs` documents every endpoint
- [ ] Test coverage report printed and meets the target
- [ ] Full account lifecycle works end to end: register → verification email → verify → forgot password → reset → login with the new password → old sessions revoked
- [ ] `POST /auth/forgot-password` returns an identical response for a real and a fake email (proven by a test)
- [ ] Reset and verification tokens are single-use, expire, and are stored hashed — never in plaintext
- [ ] Every one of the six emails renders correctly in HTML and plain text, and the app boots and registers successfully with **no** SMTP config
- [ ] Landing page, `/terms`, and `/privacy` are real, specific, and linked from the footer; registration requires accepting them
- [ ] "Try the demo" logs in to the sandbox account and destructive actions are blocked there
- [ ] Data export returns everything stored about the user; account deletion removes it all including files
- [ ] Lighthouse scores reported for landing + dashboard and meet the targets
- [ ] Resource caps, rate limits, and upload validation each proven by a test
- [ ] `DEPLOYMENT.md` is complete enough that someone with no context can deploy it, and the cross-origin cookie config is explicitly covered
- [ ] No secret, real email address, or personal data is committed anywhere in the repo or its history
- [ ] Uploads survive a server restart and a redeploy (object storage in production, proven by the storage adapter tests)
- [ ] Dates are correct for users in at least two distant timezones, proven by tests covering day boundaries and reminder timing
- [ ] The full Playwright suite and the axe accessibility checks pass in CI against a real running stack
- [ ] Bundle sizes reported and within budget; Chart.js is not in the landing-page bundle
- [ ] A stale concurrent edit returns 409 and the UI handles it; `npm run migrate` runs cleanly
- [ ] LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, CHANGELOG and GitHub templates all exist
- [ ] SPF/DKIM/DMARC records are documented and a test verification email reached a real Gmail inbox, not spam

Start now with Section 16, Phase 1. First print the planned file tree, then begin. Do not skip ahead; each phase depends on the one before it.
