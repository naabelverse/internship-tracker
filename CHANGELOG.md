# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`npm run storage:sweep -w server` finds uploaded files that no application
  references** (issue #42), the ones left behind by deletions before the #34
  fix. It is a dry run by default. `--apply --expect <N>` deletes exactly the
  orphans the dry run counted, and refuses against an empty database or when
  orphans are a majority of stored files. The storage adapter gains a
  read-only `list(prefix)` for both drivers. The report names the storage
  driver and bucket it listed.

### Fixed

- **Deleting an application or closing an account now erases its uploaded
  files** (issue #34). The 30-day purge, deleting an application (one at a
  time or in bulk) and the demo account's nightly reset all remove the files
  from storage once the records are gone. A file storage refuses is logged,
  and the deletion completes anyway. This supersedes the account-closure
  entry below: the FAQ, danger zone, closure email, closed page and privacy
  policy say "data" again and include uploaded files. Files left behind by
  deletions before this fix are tracked separately in issue #42.

### Changed

- **The landing page's dashboard screenshot matches the shipped dashboard.** It
  shows all eight stat cards, including interview rate and time to first reply,
  in the 4 x 2 grid. There is a light and a dark capture, and the page shows the
  one matching the theme the visitor picked. A test now fails when the
  dashboard's cards change without a recapture.
- **The landing page's feature grid is six equal cells.** It runs 2 x 3 from
  640px and 3 x 2 from 1024px, replacing the 7/5, 4/4/4, 12 spans that left
  the shortest card alone in a full-width last row. Below 640px it is one
  column, as before.
- **Two feature claims were corrected to match the app.** The board card says
  the history shows when each move happened, not how long each stage took,
  which nothing computes. The statistics card says where applications come
  from, not which sources convert, which nothing computes either.
- **Dashboard stat cards sit 2 x 4 below 1280px and 4 x 2 from it**, and a
  delta wraps between the change and "vs previous 30 days" instead of splitting
  "32.3 pts" or "No change" across lines on a narrow card.
- **Closing an account says what actually happens.** The closed page, the
  Settings danger zone, the closure email, the FAQ and the privacy policy now
  describe restoring by signing in, say plainly that a forgotten password rules
  it out, and no longer offer "contact support", which could not reopen an
  account. None of them claims uploaded files are erased any more: the purge
  does not yet delete them from storage (issue #34), and the privacy policy
  explains exactly what is and is not removed.

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

### Removed

- **The landing page no longer shows the eight-status legend.** The row of
  status colours at the foot of the hero explained colours the landing page
  does not use: the "Next up" example marks deadlines and interviews, not
  statuses, and blue meant Applied in the legend but an interview in the card
  above it. The hero now ends on its own padding. The status colours in the app
  itself are unchanged.

### Fixed

- **The deploy workflow deploys the commit CI passed.** It used `railway redeploy`,
  which rebuilds whatever Railway deployed last. If Railway stopped picking up
  pushes, a green run would have rebuilt an old commit and looked like a deploy.
  It now asks Railway to build `workflow_run.head_sha` explicitly. Deploys stay
  off behind `DEPLOY_ENABLED`.
- **The landing page's "Next up" example says what its dots mean.** A small
  key under the card names the two colours it uses, red for a deadline and blue
  for an interview. On wide screens the card now sits centred against the
  headline column instead of hanging from its top.
- **Withdrawn no longer looks like Interview.** Its brown sat so close to
  Interview's amber in the light theme that the two were hard to tell apart at
  dot size, closer than Interview is to Rejected's red. Withdrawn is now a
  deeper brown in the light theme and a paler sand in the dark theme, the same
  hue at a lightness no other status uses. The change reaches every status pill,
  dot, board column, timeline marker and doughnut slice at once, and it also
  separates Withdrawn from Saved, Offer and Rejected for colour-blind readers.
- **The landing page's "Next up" example now shows the dashboard as it really
  is.** It was hand-built and had drifted: it coloured each row by application
  status, so an interview was amber on the landing page and blue in the
  dashboard's upcoming panel. Its caption also claimed amber was the only colour
  that means hurry, while the app paints overdue dates red. The example now
  renders the dashboard's own row: a dot for deadline or interview, the relative
  date above the exact one, and amber inside three days decided by the same rule.
  Its dates count from today, so "in 2 days" stays true. The caption now reads
  "Amber and red mean it needs attention."
- **The auth pages' logo is easier to hit.** The "Internship Tracker" lockup on
  sign-in, create-account, forgot-password, reset-password, verify-email and
  account-closed was a 146x20 link — wide enough, but half as tall as a
  comfortable pointer or thumb target, and on a phone it is the only chrome the
  page has. Its clickable area is now 40px tall, gained from an invisible band
  centred on the lockup rather than from padding. Nothing moves: the mark, the
  wordmark, the gap between them, the focus ring and the theme toggle opposite
  are at identical coordinates across all six pages, both themes and every
  width, and the larger target cannot reach the toggle.
- **The auth pages' marketing panel no longer hugs the left edge.** Its copy sat
  40px from the viewport edge at every width, while the form beside it sits 64px
  from its own edge at the narrowest split and 168px at 1440 — the two halves
  insetting by different mechanisms, so the page read as lopsided on sign-in,
  create-account, forgot-password, reset-password, verify-email and
  account-closed alike. The panel's horizontal padding now starts at that same
  64px and widens on larger screens. Its vertical spacing, the copy itself and
  the logo's position, target and hover are all unchanged, and the panel is
  still hidden on phones.
- **The auth pages' logo is a link home, at every width.** The "Internship
  Tracker" lockup at the top of the sign-in, create-account, forgot-password,
  reset-password, verify-email and account-closed pages was a static label,
  and below the `lg` breakpoint it was not shown at all; none of the other
  links on those pages leave the auth flow. The mark and the wordmark are now
  one link to the landing page, in the aside on wide screens and opposite the
  theme toggle above the form on phones, with a hover that shifts both to the
  muted text token, the same accessible name the marketing header's logo has,
  and the standard focus ring. The forms are unchanged.

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

- **Interview rate and time to first reply on the dashboard.** Both were
  already on `GET /analytics/summary` but shown nowhere. Each card carries a
  30-day delta like response rate, from two new fields on each `period` window;
  a falling reply time reads as good, and a window nobody heard back in shows
  "—" rather than zero.
- **A closed account can be restored by signing in within 30 days.** The
  correct password on a closed account now opens a dialog naming the deletion
  date and asking whether to restore it; "Restore my account" brings everything
  back as it was, and "Keep it closed" leaves it closed. Reminders that came due
  while closed are not sent, and devices signed in before the closure stay
  signed out. A wrong password still gets the same answer as an unknown email,
  and forgot-password still does not work for a closed account. New endpoint:
  `POST /auth/restore`; `POST /auth/login` can answer 409 or 410 for a closed
  account; `DELETE /auth/me` returns `purgeAt`. An "account restored" security
  email is sent.

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

### Security

- **`qs` is patched to 6.16.0** through express 4.22.3 and body-parser 1.20.8,
  clearing GHSA-x5fp-wj9c-mxmx and GHSA-4mjr-xmp4-gh2g. Neither was reachable
  here: the server never parses with `comma: true` and never calls
  `qs.stringify`. The two react-router advisories remain and are not reachable
  either; DECISIONS.md records why the v7 upgrade that fixes them is deferred.

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
