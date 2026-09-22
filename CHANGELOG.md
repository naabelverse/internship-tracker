# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **The theme control's selected state is a thumb that slides.** One filled
  thumb moves between light, dark and system on the tokenised 150 ms ease-out
  instead of two buttons cross-fading; reduced-motion users get the end state
  without the travel. The control is now a single Tab stop on the checked
  option, and the arrow keys move both focus and the selection, which is what a
  screen reader announcing "radio" promises. Its outline is `border-strong` and
  its hover tint `content/10`, both measurably clearer on every ground it sits
  on. Labels, roles and the account sync are unchanged.
- **The interface has a new palette.** The violet "Dispatch" direction is
  replaced by a blue-ground direction adapted from a supplied shadcn-style
  reference: a neutral near-black primary on a pale blue canvas with white
  cards. The accent carries no hue of its own, so colour on screen now belongs
  to the status system rather than to the brand. Both themes change; the status
  colours themselves keep their meanings and their hues.
- **The categorical chart series was rebuilt.** Eight entries spread across the
  hue wheel, replacing the violet-era set. Charts that plot by source or by
  company therefore look different, and their colours no longer coincide with
  any status colour.
- **The auth split screen has a saturated blue ground** (`--color-wash`). It is
  the only surface that uses it; the page canvas elsewhere is a pale blue,
  because a ground that saturated cannot keep a 15% status-pill tint legible.

### Fixed

- **Every status has one colour everywhere, and Ghosted is a ring.** The
  dashboard's status breakdown painted Ghosted amber and Withdrawn green while
  every badge showed them as one pale grey, and Saved, Assessment, Ghosted and
  Withdrawn were four greys. Saved is now a neutral grey, Assessment purple,
  Ghosted a slate blue drawn as a hollow ring beside its label, and Withdrawn
  brown, in both themes, and the chart reads the same definition as the badges.

- **The refresh cookie is now sent in a split-host deployment.** It was
  `SameSite=Strict`, which a browser omits from every cross-site request, so
  `POST /auth/refresh` from a client on one domain to an API on another carried
  no cookie: sign-in worked and the next page reload logged the user out. The
  cookie policy is now derived from `CLIENT_ORIGIN` and `API_URL` and relaxes to
  `SameSite=None; Secure` when the hosts differ. Same-host deployments are
  unchanged and keep `Strict`.
- **Source maps are no longer published with the client.** `npm run build:deploy`
  strips `.map` files and `sourceMappingURL` comments from `client/dist` after
  the build, so a static host no longer serves the readable source.

### Added

- **The API says at boot whether the demo account exists.** Once the database
  connects it logs `Demo account ready`, or a `warn` naming `DEMO_EMAIL` and the
  seed command, so a deployment that shows "Try the demo" without having run
  `npm run seed` is visible in the deploy log rather than only as a visitor's
  404 toast. `DEPLOYMENT.md` step 11 now runs the seed through `railway run`,
  which is what points it at Atlas instead of a local `MONGO_URI`.
- `DEPLOYMENT.md`: free-tier deployment to MongoDB Atlas, Render and Vercel,
  covering every production environment variable, the cross-origin cookie and
  CORS configuration, SPF/DKIM/DMARC records for email deliverability, cold-start
  mitigation, the SPA rewrite rule, custom domains with HSTS, and a pre-launch
  checklist.
- `.github/workflows/deploy.yml`: fires the platform deploy hooks after the CI
  suite passes, disabled by default behind a `DEPLOY_ENABLED` repository secret.
- `COOKIE_DOMAIN`: optional, unset by default, for sharing the refresh cookie
  across subdomains of one parent domain.
- `npm run stats`: user, application and 7-day signup counts against the live
  database.
- Measured Lighthouse scores, bundle sizes and API latency in the README.

## [1.0.0] - 2026-09-05

First public release: a full-stack internship application tracker with a Kanban
board, a calendar, deadline reminders and an analytics dashboard.

### Added

- **Accounts and sessions.** Registration with an explicit Terms acceptance,
  email verification, sign-in with account lockout after repeated failures,
  forgot/reset password, email change with confirmation to the new address, a
  signed-in device list with per-session revocation, soft delete with a 30-day
  purge, and JWT access tokens with rotating refresh tokens and reuse detection.
- **Applications.** Full CRUD with server-side pagination, filtering, search and
  sorting; all list state synced to the URL so a view is shareable and survives a
  reload. Bulk actions, column visibility, inline status changes, a status
  history, interviews as a subresource, attachments, and notes in markdown.
- **Board.** A dnd-kit Kanban with a column per status, optimistic status changes
  with rollback, keyboard-operable card moves, and a version-conflict prompt when
  two edits race.
- **Calendar.** A month grid of deadlines and interviews, rendered in the user's
  own timezone, with a per-day event panel.
- **Dashboard.** Six stat cards with period-over-period deltas, five Chart.js
  visuals that re-render on a theme change, an activity heatmap, and an upcoming
  panel. Every chart ships a screen-reader data table.
- **Import and export.** CSV import with per-row error reporting, CSV and JSON
  export of the applications list, and a single-file JSON export of everything
  the system stores about an account.
- **Email.** Six transactional templates over a provider-agnostic SMTP seam, a
  retry queue, a console fallback, per-user preferences and one-click
  unsubscribe. Deadline reminders and a weekly summary run on cron.
- **Public surface.** A landing page, a sandboxed demo account that blocks
  destructive actions and resets nightly, Terms and Privacy rendered from
  markdown, and full SEO metadata with a generated OG image, sitemap and manifest.
- **Hardening.** Per-account resource caps, a disposable-email blocklist, a
  registration honeypot and timing check, EXIF stripping on uploads, an S3/R2
  storage adapter, request IDs, structured logs with secret redaction, optional
  Sentry, a `/ready` probe and a backup script.
- **Testing.** Unit and integration suites on both workspaces with an enforced
  server coverage threshold, a Playwright end-to-end suite covering eight flows
  against a real compose stack, `@axe-core/playwright` audits, and a responsive
  audit asserting no route scrolls the document sideways at 375, 768 or 1440 px.

### Fixed

- **`Content-Disposition` is now exposed through CORS.** The client and the API
  are served from different origins in production, and a browser hides response
  headers a server does not explicitly expose, so every download the client saved
  fell back to a generic filename instead of the dated one the server chose.
  Found by the first end-to-end run against a real cross-origin stack;
  same-origin development never showed it.
- **Chart canvases are no longer nameless `role="img"` elements.** react-chartjs-2
  labels the canvas `role="img"`, which axe reports as a serious violation when
  it has no accessible name. The canvas is now hidden from assistive technology,
  leaving the existing screen-reader data table as the single text alternative.
- **The page no longer scrolls sideways when a table or the board is wider than its container.**
  Tailwind's `sr-only` is `position: absolute`, and an absolutely positioned box is only clipped by
  an ancestor's `overflow` when that ancestor is in its containing block chain — which a
  `position: static` box never is. The scroll containers were static, so screen-reader labels
  escaped them and extended the document. The four horizontal scroll containers are now positioned.
- **The applications CSV export is reachable from the UI.** The endpoint had
  existed since the analytics phase with nothing calling it, so the export step
  of the documented user journey could not be walked at all.

[Unreleased]: https://github.com/naabelverse/internship-tracker/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/naabelverse/internship-tracker/releases/tag/v1.0.0
