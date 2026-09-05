# Deployment

Everything needed to put this app on the public internet on free tiers, in order, with nothing
assumed. Work top to bottom; each step names what the next one needs from it.

**Read [Step 6](#step-6--make-the-two-origins-trust-each-other) before you deploy, not after.** The
client and the API end up on two different domains, and three separate settings have to agree for a
login to survive a page refresh. It is the one part of this deployment that fails silently.

---

## Table of contents

1. [What you are building](#what-you-are-building)
2. [Step 1 — MongoDB Atlas](#step-1--mongodb-atlas)
3. [Step 2 — Object storage for uploads](#step-2--object-storage-for-uploads)
4. [Step 3 — Generate the secrets](#step-3--generate-the-secrets)
5. [Step 4 — Deploy the API to Render](#step-4--deploy-the-api-to-render)
6. [Step 5 — Deploy the client to Vercel](#step-5--deploy-the-client-to-vercel)
7. [Step 6 — Make the two origins trust each other](#step-6--make-the-two-origins-trust-each-other)
8. [Step 7 — Transactional email and deliverability](#step-7--transactional-email-and-deliverability)
9. [Step 8 — Custom domain, HTTPS and HSTS](#step-8--custom-domain-https-and-hsts)
10. [Step 9 — Cold starts and keeping the API warm](#step-9--cold-starts-and-keeping-the-api-warm)
11. [Step 10 — Uptime, errors and backups](#step-10--uptime-errors-and-backups)
12. [Step 11 — Seed the demo account](#step-11--seed-the-demo-account)
13. [Production environment variables](#production-environment-variables)
14. [Automated deploys](#automated-deploys)
15. [Pre-launch checklist](#pre-launch-checklist)
16. [Alternatives: Railway and Netlify](#alternatives-railway-and-netlify)
17. [Troubleshooting](#troubleshooting)

---

## What you are building

```
     browser
        │
        ├──── https://tracker.example.com ──────►  Vercel     static client build (client/dist)
        │
        └──── https://api.tracker.example.com ──►  Render     Express API (server/dist)
                                                     │
                                    ┌────────────────┼────────────────┐
                                    ▼                ▼                ▼
                             MongoDB Atlas    Cloudflare R2     Email provider
                             (M0, free)       (uploads)         (Resend / SendGrid / Mailgun)
```

Four accounts, all with a free tier: MongoDB Atlas, Render, Vercel, and an email provider. A custom
domain is optional for the app itself but **required** for email that reaches an inbox — see
[Step 7](#step-7--transactional-email-and-deliverability).

Total cost at these tiers: the domain, and nothing else.

### Before you start

- The repository pushed to GitHub.
- A shell with `openssl` (Git Bash, WSL, macOS, Linux) for generating secrets.
- Node 20+ locally if you want to seed the demo account from your machine.

---

## Step 1 — MongoDB Atlas

### 1.1 Create the cluster

1. Sign up at <https://www.mongodb.com/cloud/atlas/register>.
2. **Build a Database** → **M0** (the free forever tier, 512 MB).
3. Pick a provider and a region **physically close to your Render region** — every query pays that
   round trip, and Render's free instances default to Oregon (`us-west`) or Frankfurt
   (`eu-central`). Mismatching them adds 100 ms or more to every request.
4. Name the cluster, e.g. `internship-tracker`.

### 1.2 Create the database user

**Database Access** → **Add New Database User**.

- Authentication: **Password**.
- Username: `tracker_app` (not your Atlas login).
- Password: **Autogenerate Secure Password**, then copy it somewhere safe. You cannot read it again.
- Role: **Read and write to any database**, or `readWrite` scoped to `internship_tracker` if you
  prefer least privilege.

### 1.3 Allow Render to connect

**Network Access** → **Add IP Address**.

Render's free web services do not get a dedicated outbound IP address, so there is no small set of
addresses to allowlist. Two honest choices:

| Option                                                               | When                                                     | Trade-off                                                                |
| -------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| `0.0.0.0/0` ("allow access from anywhere")                           | Free Render instances                                    | The database password becomes the only control. Make it long and unique. |
| The addresses under your Render service's **Connect** → **Outbound** | Paid Render instances, which publish static outbound IPs | Tighter, but not available on the free tier.                             |

Do not treat `0.0.0.0/0` as fine merely because it is common. It means the cluster is reachable from
any host on the internet that has the password, so that password must never be reused anywhere else
and must never be committed.

### 1.4 Build the connection string

**Database** → **Connect** → **Drivers** gives you:

```
mongodb+srv://tracker_app:<password>@internship-tracker.abc12.mongodb.net/?retryWrites=true&w=majority
```

Two edits before you use it:

1. Replace `<password>` with the real password, **URL-encoded**. A password containing `@`, `/`, `:`,
   `?`, `#`, `[`, `]` or `%` otherwise breaks the URI parse — `@` becomes `%40`, `/` becomes `%2F`,
   `#` becomes `%23`.
2. Insert the database name between the host and the query string, or you get Atlas's `test` database
   and spend an afternoon wondering where your data went.

The value to paste into `MONGO_URI`:

```
mongodb+srv://tracker_app:UrlEncodedPassword@internship-tracker.abc12.mongodb.net/internship_tracker?retryWrites=true&w=majority
```

---

## Step 2 — Object storage for uploads

**This is not optional in production, and the app enforces it.** `server/src/config/env.ts` refuses
to boot with `STORAGE_DRIVER=local` when `NODE_ENV=production`, because Render's filesystem is
ephemeral: every redeploy, every restart and every wake from idle destroys local disk. Attachments
written there would vanish silently, at a time nobody was watching.

Cloudflare R2 is the cheapest S3-compatible option (10 GB and no egress fees on the free tier). Any
S3-compatible service works — the adapter only speaks the S3 API.

1. Cloudflare dashboard → **R2** → **Create bucket**, e.g. `internship-tracker-uploads`.
2. **Manage R2 API Tokens** → **Create API token** → **Object Read & Write**, scoped to that bucket.
3. Copy the Access Key ID, the Secret Access Key, and the S3 endpoint, which looks like
   `https://<account-id>.r2.cloudflarestorage.com`.

That gives you:

```
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=internship-tracker-uploads
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

`S3_REGION=auto` is R2's convention. On AWS S3 use the real region (`eu-west-1`) and leave
`S3_ENDPOINT` unset.

Keep the bucket **private**. The app never links to it directly; downloads go through
`GET /api/v1/files/...`, which checks ownership and returns a short-lived signed URL.

---

## Step 3 — Generate the secrets

Run this on your own machine. Never reuse a value from `server/.env`, from `docker-compose.yml`, or
from any example in this repository — those are published, so anything signed with them is forgeable
by anyone who has read the repo:

```bash
openssl rand -base64 48   # JWT_ACCESS_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET
```

Run it **twice** and use two different values. The env loader enforces this at boot in production:
each secret must be at least 32 characters, must not be one of the placeholder strings from
`.env.example`, and the two must differ from each other. A deploy that gets any of it wrong fails
loudly at startup with the exact list of problems rather than running insecurely.

Rotating them later logs every user out — refresh tokens stop verifying — but breaks nothing else.
That is the correct response to a suspected leak.

---

## Step 4 — Deploy the API to Render

### 4.1 Create the service

<https://dashboard.render.com> → **New** → **Web Service** → connect the GitHub repository.

| Field             | Value                                             |
| ----------------- | ------------------------------------------------- |
| Name              | `internship-tracker-api`                          |
| Region            | the one you matched Atlas to in Step 1.1          |
| Branch            | `main`                                            |
| Root Directory    | _leave blank_ — the repo root                     |
| Runtime           | Node                                              |
| Build Command     | `npm ci --include=dev && npm run build -w server` |
| Start Command     | `npm run start -w server`                         |
| Instance Type     | Free                                              |
| Health Check Path | `/health`                                         |

**Root Directory stays blank on purpose.** This is an npm workspaces monorepo with one lockfile at
the root; pointing Render at `server/` gives it a `package.json` whose dependencies it cannot
resolve.

**`--include=dev` is not optional.** TypeScript, `tsc-alias` and the type packages are
devDependencies, and npm skips devDependencies automatically when `NODE_ENV=production` is set in the
environment — which you are about to set in the very next step. Without the flag the build fails with
`tsc: not found`.

Setting a **Health Check Path** matters beyond monitoring: Render uses it to decide whether a deploy
succeeded, so a failing boot is rolled back instead of silently serving errors.

### 4.2 Environment variables

**Environment** → **Add Environment Variable**, for each row in
[Production environment variables](#production-environment-variables). Do not set `PORT` — Render
assigns it and the app reads it.

Two Render-specific ones worth calling out:

| Variable                      | Value | Why                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRUST_PROXY`                 | `1`   | Render terminates TLS at its load balancer and forwards to your process over plain HTTP. Without this, `req.ip` is the balancer for every request, so all users share one rate-limit bucket and one person's burst throttles everybody; `req.secure` is also false, which makes Express drop `Secure` cookies. |
| `MONGOMS_DISABLE_POSTINSTALL` | `1`   | `mongodb-memory-server` is a test dependency whose postinstall downloads a MongoDB binary. `--include=dev` pulls it in, and there is no reason to spend build minutes fetching a database the production image never runs.                                                                                     |

### 4.3 First deploy

Deploy, then watch the log. A healthy boot ends with the server listening and Mongo connected. A
misconfigured one ends with:

```
Invalid environment configuration:
  - JWT_ACCESS_SECRET: must be at least 32 characters in production
  - STORAGE_DRIVER: must be s3 in production: ...
```

which lists **every** problem at once, so you fix them in one pass rather than one restart per
variable.

Confirm from your own machine:

```bash
curl -i https://internship-tracker-api.onrender.com/health   # 200, with a JSON body
curl -i https://internship-tracker-api.onrender.com/ready    # 200 only if Mongo is reachable
```

`/health` answers as long as the process is alive. `/ready` additionally checks the database, so a
200 there is what proves Step 1 worked.

### 4.4 Run the migrations

The migration runner is deliberately separate from server boot, so two instances behind a rolling
deploy cannot race each other. From Render's **Shell** tab, or as a one-off job:

```bash
npm run migrate -w server
```

Run it before each deploy that includes a new migration.

---

## Step 5 — Deploy the client to Vercel

### 5.1 Create the project

<https://vercel.com/new> → import the repository.

| Field            | Value                            |
| ---------------- | -------------------------------- |
| Framework Preset | Vite                             |
| Root Directory   | _leave as the repo root_         |
| Install Command  | `npm ci`                         |
| Build Command    | `npm run build:deploy -w client` |
| Output Directory | `client/dist`                    |

**Use `build:deploy`, not `build`.** The Vite config emits source maps on purpose — an error tracker
cannot symbolicate a minified stack without them — but `client/dist` is exactly what Vercel
publishes, so a plain `build` would leave your complete readable source one predictable `.js.map`
request away from any visitor. `build:deploy` runs the build and then
`client/scripts/stripSourcemaps.mjs`, which deletes every `.map` and removes the
`//# sourceMappingURL=` comments pointing at them. If you upload maps to Sentry, do it between the
two steps (see [Step 10](#step-10--uptime-errors-and-backups)).

### 5.2 Environment variables

Vite inlines `VITE_*` values **at build time**, not at runtime. Changing one in the Vercel dashboard
does nothing until you redeploy.

| Variable                                       | Value                                                 |
| ---------------------------------------------- | ----------------------------------------------------- |
| `VITE_API_URL`                                 | `https://api.tracker.example.com` — no trailing slash |
| `VITE_APP_URL`                                 | `https://tracker.example.com`                         |
| `VITE_DEMO_ENABLED`                            | `true`                                                |
| `VITE_SENTRY_DSN`                              | optional                                              |
| `VITE_ANALYTICS_DOMAIN` / `VITE_ANALYTICS_SRC` | optional, cookieless analytics only                   |

### 5.3 The SPA rewrite

This app uses client-side routing. Without a rewrite, `https://tracker.example.com/applications`
works when you navigate to it inside the app and **404s when you refresh the page or open the link
directly** — the browser asks Vercel for a file at `/applications`, which does not exist.

Vercel's Vite preset normally configures this for you. Make it explicit anyway, so the behaviour
survives a preset change. Create `client/vercel.json`:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

Static files still win: `robots.txt`, `sitemap.xml`, `manifest.webmanifest` and everything under
`/assets` are served normally, because a rewrite only applies when no file matches.

**Test this specifically after deploying.** Open `https://tracker.example.com/applications` in a new
tab and press reload. A 404 here is the single most common broken SPA deploy.

### 5.4 Regenerate the SEO assets

`robots.txt` and `sitemap.xml` are generated from `VITE_APP_URL` and currently carry
`http://localhost:5173`. Once the domain is live, run this locally and commit the result:

```bash
VITE_APP_URL=https://tracker.example.com npm run assets -w client
```

---

## Step 6 — Make the two origins trust each other

The client is on one domain and the API is on another. Four settings have to agree, and the failure
mode of getting them wrong is not an error message — it is a user who logs in, refreshes the page,
and finds themselves logged out.

### 6.1 CORS — an exact origin allowlist

`server/src/app.ts`:

```ts
app.use(
  cors({
    origin: env.CLIENT_ORIGIN,
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  }),
);
```

Set `CLIENT_ORIGIN` to the deployed client origin **exactly**: scheme, host, and port if it is
non-standard, with no trailing slash and no path. `https://tracker.example.com` — not
`https://tracker.example.com/`, not `tracker.example.com`.

`credentials: true` is what allows the browser to attach the refresh cookie. It also makes a wildcard
origin illegal: `Access-Control-Allow-Origin: *` and credentials cannot both be used, so there is no
lazy option available here even if you wanted one.

`exposedHeaders` is what makes downloads keep their filenames. A cross-origin response only hands
JavaScript the CORS-safelisted headers, and `Content-Disposition` is not one of them, so without this
line the client cannot read the name the server chose and every export saves as a generic
`applications.csv` instead of the dated `applications-2026-01-31.csv`. Same-origin development never
shows this. Regression test: `server/tests/cors.exposedHeaders.test.ts`.

### 6.2 The refresh cookie — `SameSite=None; Secure`

`server/src/utils/cookies.ts` derives this from your configuration rather than making you set it:

```ts
const crossSite = new URL(clientOrigin).hostname !== new URL(apiUrl).hostname;
const secureTransport = production || new URL(apiUrl).protocol === 'https:';

if (crossSite && secureTransport) return { sameSite: 'none', secure: true };
return { sameSite: 'strict', secure: production };
```

Why it has to be this way: a browser omits a `SameSite=Strict` cookie from **every** request that a
page on another site initiates. `POST /auth/refresh` from a Vercel page to a Render host is one of
those, so a `Strict` cookie simply never arrives — the silent refresh returns 401, the axios
interceptor reads that as a dead session, and the user is bounced to the login page every time their
15-minute access token expires or they reload the tab. `SameSite=None` is the only value that
travels, and browsers refuse to store `None` unless the cookie is also `Secure`, which is why the two
move together.

So: **set `CLIENT_ORIGIN` and `API_URL` to the real deployed origins and the cookie configures
itself.** Get `API_URL` wrong and you get the failure above.

Everything else about the cookie is unchanged: `httpOnly`, and `Path=/api/v1/auth` so the refresh
token is never attached to ordinary API calls.

`COOKIE_DOMAIN` stays **unset** for this topology. A host-only cookie is what you want — the API sets
it for its own hostname and nothing else reads it. Set it only if you put the API and the client on
subdomains of one parent (`api.tracker.example.com` and `tracker.example.com`) _and_ something needs
the cookie shared across them; then it is `.tracker.example.com`. Broadening a credential's scope
without a reason is a downgrade.

> **Trade-off worth knowing.** `SameSite=None` means another site can cause the browser to fire
> `POST /auth/refresh` with the cookie attached. It cannot read the response — CORS blocks that,
> since the attacker's origin is not in the allowlist — so no token is stolen. The reachable
> consequence is that the token rotates behind the user's back and reuse detection may log them out.
> A nuisance, not a breach, and the price of a split-domain deployment. Putting the client and the
> API on subdomains of one registrable domain avoids it entirely.

### 6.3 `trust proxy`

`app.set('trust proxy', env.TRUST_PROXY)` — set `TRUST_PROXY=1` on Render (one hop: their load
balancer). Covered in [4.2](#42-environment-variables); repeated here because it belongs to this set.
Leaving it at `0` breaks two things at once: rate limits key on the balancer's IP so all users share
one bucket, and Express treats the connection as insecure and will not set `Secure` cookies — which,
per 6.2, means no refresh cookie at all.

Do not set it higher than the number of proxies actually in front of you. Trusting more hops than
exist lets a client forge `X-Forwarded-For` and evade the rate limiter entirely.

### 6.4 Verify it end to end, in a browser

The unit tests cover the logic and CI's end-to-end stack covers cross-origin behaviour, but **CI
cannot cover the cookie**: its web container is `localhost:5174` and its API is `localhost:5001`,
which are different _origins_ but the same _site_, because a port is not part of a site. A
`SameSite=Strict` cookie travels happily between them. Only a real two-domain deploy exercises 6.2.

So after deploying, in a real browser:

1. Sign in at `https://tracker.example.com`.
2. Open DevTools → **Application** → **Cookies** → the API's domain. The `refresh_token` cookie must
   show `SameSite=None`, `Secure` ✓, `HttpOnly` ✓, `Path=/api/v1/auth`.
3. **Hard-reload the page.** You must still be signed in. In the **Network** tab,
   `POST /api/v1/auth/refresh` must be `200`, and its request must carry a `Cookie` header. A `401`
   here, or a request with no cookie, means 6.2 is misconfigured.
4. Leave the tab open for longer than `ACCESS_TOKEN_TTL` (15 minutes), then click around. The refresh
   should happen invisibly — no error toast, no bounce to login.
5. On the applications page, click **Export CSV**. The saved file must be named
   `applications-YYYY-MM-DD.csv`. If it saved as `applications.csv`, `exposedHeaders` is not reaching
   the browser — check 6.1, and that nothing in front of Render is stripping the header.

---

## Step 7 — Transactional email and deliverability

A verification email that lands in spam is the same as no verification email at all. The user never
sees it, never verifies, and blames the app.

### 7.1 Choose a provider and a sending domain

Any provider with an SMTP endpoint works; the app has no provider SDK. Free tiers as of writing:
Resend 3,000/month, SendGrid 100/day, Mailgun 100/day.

| Provider | `SMTP_HOST`         | `SMTP_PORT` | `SMTP_USER`        | `SMTP_PASS`   |
| -------- | ------------------- | ----------- | ------------------ | ------------- |
| Resend   | `smtp.resend.com`   | `587`       | `resend`           | API key       |
| SendGrid | `smtp.sendgrid.net` | `587`       | `apikey` (literal) | API key       |
| Mailgun  | `smtp.mailgun.org`  | `587`       | `postmaster@mg.…`  | SMTP password |

Port 465 is implicit TLS; 587 starts in the clear and upgrades with STARTTLS. Both are fine.

**You must send from a domain you control.** `MAIL_FROM=Internship Tracker <no-reply@gmail.com>` will
be rejected or spam-filed by essentially every receiver, because Gmail publishes a DMARC policy
saying nobody else may send as `gmail.com`, and you are not Gmail. The same applies to Outlook, Yahoo
and every other consumer provider. This is the one place in this deployment where a free option does
not exist.

```
MAIL_FROM=Internship Tracker <no-reply@tracker.example.com>
```

A real display name and a real address. Both are visible to the recipient and both affect whether
they trust the message.

### 7.2 The DNS records

Add your domain in the provider's dashboard. It will show you the exact records — **the DKIM public
key and selector are generated per domain, so copy those from the dashboard rather than from here.**
What follows is the shape, so you can tell whether what you were shown is complete and correct.

#### Resend (recommended default)

| Type | Name                                    | Value                                                    | Purpose                           |
| ---- | --------------------------------------- | -------------------------------------------------------- | --------------------------------- |
| MX   | `send.tracker.example.com`              | `feedback-smtp.eu-west-1.amazonses.com` (priority 10)    | Bounce and complaint feedback     |
| TXT  | `send.tracker.example.com`              | `v=spf1 include:amazonses.com ~all`                      | **SPF**                           |
| TXT  | `resend._domainkey.tracker.example.com` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GN…`                        | **DKIM** (key from the dashboard) |
| TXT  | `_dmarc.tracker.example.com`            | `v=DMARC1; p=none; rua=mailto:dmarc@tracker.example.com` | **DMARC**                         |

The region in the MX value varies with the region you chose. DKIM signs with `d=tracker.example.com`,
which aligns with your `From` domain — that alignment, not the SPF pass alone, is what makes DMARC
pass.

#### SendGrid

SendGrid uses "Authenticated Domain", which is CNAME-based:

| Type  | Name                                | Value                                   | Purpose                       |
| ----- | ----------------------------------- | --------------------------------------- | ----------------------------- |
| CNAME | `em1234.tracker.example.com`        | `u1234567.wl.sendgrid.net`              | Return-path / SPF             |
| CNAME | `s1._domainkey.tracker.example.com` | `s1.domainkey.u1234567.wl.sendgrid.net` | DKIM key 1                    |
| CNAME | `s2._domainkey.tracker.example.com` | `s2.domainkey.u1234567.wl.sendgrid.net` | DKIM key 2                    |
| TXT   | `_dmarc.tracker.example.com`        | `v=DMARC1; p=none; rua=mailto:…`        | DMARC (you add this yourself) |

#### Mailgun

| Type | Name                                     | Value                                          | Purpose |
| ---- | ---------------------------------------- | ---------------------------------------------- | ------- |
| TXT  | `mg.tracker.example.com`                 | `v=spf1 include:mailgun.org ~all`              | SPF     |
| TXT  | `smtp._domainkey.mg.tracker.example.com` | `k=rsa; p=MIGfMA0GCSq…`                        | DKIM    |
| MX   | `mg.tracker.example.com`                 | `mxa.mailgun.org`, `mxb.mailgun.org` (prio 10) | Bounces |
| TXT  | `_dmarc.tracker.example.com`             | `v=DMARC1; p=none; rua=mailto:…`               | DMARC   |

#### What the three records actually do

- **SPF** lists the servers allowed to send for the domain. Publish **exactly one** SPF record per
  name — two `v=spf1` TXT records is a permanent error and fails SPF outright, so if you already send
  mail from this domain, merge the new `include:` into the existing record instead of adding a second
  one. `~all` (softfail) is right while you are setting up; `-all` (hardfail) once you are certain
  the list is complete.
- **DKIM** signs each message with a private key held by the provider; the receiver fetches the
  public key from the `_domainkey` record and verifies the signature. This is what survives
  forwarding, which SPF does not.
- **DMARC** tells receivers what to do when SPF and DKIM disagree with the `From` domain, and where
  to send reports.

#### DMARC rollout

Start permissive and tighten with evidence — a `p=reject` published before you know your own mail
passes will silently destroy your verification emails:

```
v=DMARC1; p=none;       rua=mailto:dmarc@tracker.example.com                # week 0: observe only
v=DMARC1; p=quarantine; rua=mailto:dmarc@tracker.example.com; pct=100       # week 2-4, if clean
v=DMARC1; p=reject;     rua=mailto:dmarc@tracker.example.com                # once you are confident
```

### 7.3 Reply-to, unsubscribe and warm-up

- **Reply-to.** `no-reply@` addresses that bounce replies are a negative signal and a bad experience.
  Either make the `From` address a real monitored mailbox, or set a reply-to in the provider
  dashboard that reaches a human. Fill in `CONTACT_EMAIL` in `client/src/lib/siteMeta.ts` while you
  are here — it feeds the landing footer, the Terms and Privacy contact lines, and `SECURITY.md`.
- **Plain text.** Every template already ships an HTML part and a plain-text alternative from the
  shared layout in `server/src/mail/layout.ts`. Nothing to configure; HTML-only mail is a strong spam
  signal and this app never sends any.
- **One-click unsubscribe.** Built in Phase 12 and already applied to the two non-transactional
  emails — the reminder digest and the weekly summary. `server/src/mail/unsubscribe.ts` sets:

  ```
  List-Unsubscribe: <https://api.tracker.example.com/api/v1/email/unsubscribe?token=…>
  List-Unsubscribe-Post: List-Unsubscribe=One-Click
  ```

  which is RFC 8058, the form Gmail and Yahoo have required from bulk senders since February 2024.
  `POST /api/v1/email/unsubscribe` answers the provider's automated click with no page render; `GET`
  on the same route serves the human-facing confirmation. The token is signed, never expires (an
  unsubscribe link has to keep working), and identifies the account and the stream on its own, so no
  session is needed. The four security-critical emails — verification, password reset, password
  changed, account deletion — carry no unsubscribe header, correctly: they are transactional, and a
  user cannot opt out of being told their password changed.

- **Warm-up.** A brand-new domain sending a burst of mail looks exactly like a compromised one. For
  the first two weeks keep volume low and steady — tens per day, not hundreds — and prefer recipients
  who will actually open. Volume from a domain with no history is the biggest spam signal after
  failing authentication.

### 7.4 Verify — what is checkable now, and what only you can check

**Checkable before you own a domain**, and confirmed for this repository:

- Every template renders both an HTML and a plain-text part — `server/tests/mail.templates.test.ts`.
- The `List-Unsubscribe` and `List-Unsubscribe-Post` headers are present on exactly the two
  non-transactional emails and absent from the four security ones —
  `server/tests/email.unsubscribe.test.ts`.
- The app boots and registers with no SMTP configuration at all, falling back to a console
  transport — `server/tests/mail.noSmtpBoot.test.ts`.
- The record syntax above is well-formed.

**Only checkable once the domain and deployment are live. This is a manual step for you:**

1. Confirm the records resolve, from a shell:

   ```bash
   dig +short TXT send.tracker.example.com                  # the SPF record
   dig +short TXT resend._domainkey.tracker.example.com     # the DKIM key
   dig +short TXT _dmarc.tracker.example.com                # the DMARC policy
   ```

   DNS propagation takes minutes to hours. The provider dashboard's "Verified" badge is the
   authoritative signal.

2. Register a throwaway account on the live site using **a real Gmail address**, then repeat with
   **Outlook** and **Yahoo**. For each:
   - The verification email arrives in the **Inbox**, not Spam.
   - In Gmail: **⋮ → Show original**. It must read `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`.
   - The verification link works and lands you on the app, signed in.

3. Optionally send one message to <https://www.mail-tester.com> for a 10-point score with a
   breakdown, and enrol the domain in Google Postmaster Tools to watch the spam rate over time.

Do not launch until step 2 passes on all three providers. Everything above can be true while your
mail still lands in spam, and only a real inbox tells you.

---

## Step 8 — Custom domain, HTTPS and HSTS

### 8.1 The client on Vercel

Vercel project → **Settings** → **Domains** → add `tracker.example.com`. It shows the record to add
at your registrar:

| Type  | Name      | Value                   |
| ----- | --------- | ----------------------- |
| CNAME | `tracker` | `cname.vercel-dns.com.` |

For an apex domain (`example.com` with no subdomain) use Vercel's `A` record instead — a CNAME at the
apex is not valid DNS at most registrars.

### 8.2 The API on Render

Render service → **Settings** → **Custom Domains** → add `api.tracker.example.com`:

| Type  | Name  | Value                                  |
| ----- | ----- | -------------------------------------- |
| CNAME | `api` | `internship-tracker-api.onrender.com.` |

### 8.3 Certificates

Both platforms issue and renew Let's Encrypt certificates automatically once the DNS resolves.
Nothing to install. Both also redirect HTTP to HTTPS by default — confirm with
`curl -I http://api.tracker.example.com/health` and look for a `301`.

### 8.4 Update every origin variable, then redeploy

Domains are not live until the app agrees they are. Change all of these together:

| Where  | Variable        | New value                         |
| ------ | --------------- | --------------------------------- |
| Render | `CLIENT_ORIGIN` | `https://tracker.example.com`     |
| Render | `APP_URL`       | `https://tracker.example.com`     |
| Render | `API_URL`       | `https://api.tracker.example.com` |
| Vercel | `VITE_API_URL`  | `https://api.tracker.example.com` |
| Vercel | `VITE_APP_URL`  | `https://tracker.example.com`     |

Redeploy **both**. The Vercel values are compiled into the bundle, so the client keeps calling the
old API until it is rebuilt. Then re-run the browser checks in
[6.4](#64-verify-it-end-to-end-in-a-browser) — changing these is precisely what can break the cookie.

### 8.5 HSTS

Already sent. `helmet()` in `server/src/app.ts` emits:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

on every API response — one year, covering subdomains. Vercel sends its own HSTS header for custom
domains. Verify once the domain is live:

```bash
curl -sI https://api.tracker.example.com/health | grep -i strict-transport
```

Two cautions before you consider adding `preload`:

- HSTS is **irrevocable for its max-age**. A browser that has seen this header refuses to reach the
  host over HTTP for a year, so publish it only when every subdomain can serve HTTPS — that is what
  `includeSubDomains` promises on your behalf.
- Submitting to the preload list at <https://hstspreload.org> bakes the domain into browser binaries
  and removal takes months. Do it only for a domain you intend to keep.

---

## Step 9 — Cold starts and keeping the API warm

**Render's free web services spin down after roughly 15 minutes with no inbound traffic.** The next
request restarts the container: Node boots, Mongoose connects to Atlas, and the caller waits. Expect
**30–60 seconds** for that first request. Everything after it runs at normal speed.

For a portfolio project shown to a recruiter, that is the difference between "fast, polished app" and
"broken link". Mitigate it:

1. **Ping `/health` every 5 minutes** with the uptime monitor from
   [Step 10](#step-10--uptime-errors-and-backups). That is under the 15-minute idle threshold, so the
   service never sleeps. One monitor does double duty as availability alerting and keep-warm.
2. **Watch the free-tier hours.** Render's free plan includes 750 instance-hours per month across all
   free services. A calendar month is about 730 hours, so _one_ always-warm service fits and two do
   not — deploy a second and both run out before month end.
3. **Do not point the pinger at `/ready`.** It queries Mongo on every call, and 8,640 pointless round
   trips a day against a 512 MB shared Atlas cluster is a poor use of it. `/health` is a liveness
   probe by design and touches nothing.
4. **Handle the case where it does sleep anyway.** The client already renders skeletons rather than a
   blank screen, so a cold start reads as slow rather than broken.

Vercel has no equivalent problem — the client is static files on a CDN.

---

## Step 10 — Uptime, errors and backups

### 10.1 Uptime monitor

<https://uptimerobot.com>, free tier, 50 monitors at 5-minute intervals.

| Field    | Value                                    |
| -------- | ---------------------------------------- |
| Type     | HTTP(s)                                  |
| URL      | `https://api.tracker.example.com/health` |
| Interval | 5 minutes                                |
| Alerts   | your email                               |

Add a second monitor on `https://tracker.example.com/` to catch a broken client deploy, which the API
check cannot see.

### 10.2 Error tracking

Optional and off by default: with `SENTRY_DSN` unset the SDK is never initialised, the server makes
no outbound call, and behaviour is identical. That is what CI runs with.

To enable:

1. <https://sentry.io> → new project → **Node.js** for the API, **React** for the client.
2. Render: `SENTRY_DSN=https://…`. Leave `SENTRY_TRACES_SAMPLE_RATE` at `0` — traces are billed per
   event and errors are the point.
3. Vercel: `VITE_SENTRY_DSN=https://…`. The client SDK sits behind a dynamic import, so an unset DSN
   costs the landing bundle nothing.
4. Only 5xx responses are reported. Request headers, cookies and bodies are stripped before an event
   is sent and the user is reduced to an id, so no PII leaves the process.
5. **Source maps.** For readable stack traces, upload the maps to Sentry _between_ the build and the
   strip, by setting the Vercel build command to:

   ```bash
   npm run build -w client && npx --yes @sentry/cli sourcemaps upload --release "$VERCEL_GIT_COMMIT_SHA" client/dist && node client/scripts/stripSourcemaps.mjs
   ```

   with `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` set in the Vercel environment. Sentry
   then has the maps and the public site does not. Drop the middle command and this is exactly
   `build:deploy`.

6. Verify events actually arrive — an error tracker nobody has tested is an error tracker that is not
   working. Trigger one deliberate 500 (request a route with a malformed id, for example) and confirm
   it appears in the Sentry issue stream.

### 10.3 Backups

**Atlas M0 has no automated backups.** Snapshot and continuous backup start at the paid tiers. That
is a real gap in the free tier rather than a setting to find, so cover it yourself:

- `scripts/backup.sh` wraps `mongodump`. It needs only `mongodump` on the host, so it runs from cron
  on any machine that has the connection string — it does not need this project installed. It prunes
  old archives only _after_ a successful dump, so a failed run never destroys the last good copy.

  ```bash
  MONGO_URI="mongodb+srv://…" ./scripts/backup.sh
  ```

- Restore instructions are in the README.
- If the data becomes genuinely important, upgrading Atlas to a paid tier buys daily snapshots and is
  the cheapest real answer.

Test a restore at least once **before** you need one. An untested backup is a hypothesis.

### 10.4 Operational visibility

```bash
npm run stats -w server   # active users, soft-deleted users, applications, signups in the last 7 days
```

Runs from the Render shell against the live database. There is no admin web UI by design: no extra
authentication surface, no route, no role model.

---

## Step 11 — Seed the demo account

The landing page's **Try the demo** button signs a visitor into a sandboxed account, and it needs
that account to exist. From the Render shell, or locally with `MONGO_URI` pointed at Atlas:

```bash
npm run seed -w server
```

This creates `DEMO_EMAIL` / `DEMO_PASSWORD` with 60+ realistic applications spread over six months,
so every dashboard chart has real data. `npm run seed:reset` wipes and reseeds; a nightly cron
already does this on the deployed instance so the demo account cannot drift.

The demo credentials are published in the README on purpose — it is a throwaway account holding
generated fixtures, and destructive actions are blocked in it server-side. Change `DEMO_EMAIL` and
`DEMO_PASSWORD` if you would rather the documented credentials not work.

If you do not want a demo at all, set `VITE_DEMO_ENABLED=false` and skip the seed. The API refuses
the demo sign-in when no demo account exists, so the button is the cosmetic half of that switch, not
the enforcement.

---

## Production environment variables

Everything the API reads. The zod loader in `server/src/config/env.ts` validates all of it at boot and
refuses to start on a bad configuration, listing every problem at once.

### Required

| Variable               | Example                                            | Notes                                                                                                             |
| ---------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`             | `production`                                       | Turns on every production check below. Anything else and you are running the development configuration in public. |
| `MONGO_URI`            | `mongodb+srv://tracker_app:…@…/internship_tracker` | Step 1.4. Password URL-encoded, database name in the path.                                                        |
| `JWT_ACCESS_SECRET`    | `openssl rand -base64 48`                          | ≥32 chars, not a placeholder, different from the refresh secret.                                                  |
| `JWT_REFRESH_SECRET`   | `openssl rand -base64 48`                          | Generated separately. Never the same value.                                                                       |
| `CLIENT_ORIGIN`        | `https://tracker.example.com`                      | Exact origin, no trailing slash. Rejected if it points at localhost.                                              |
| `APP_URL`              | `https://tracker.example.com`                      | Used to build links inside emails.                                                                                |
| `API_URL`              | `https://api.tracker.example.com`                  | Signed download links, unsubscribe links, **and the cookie policy in 6.2**.                                       |
| `TRUST_PROXY`          | `1`                                                | One hop on Render. See 6.3.                                                                                       |
| `STORAGE_DRIVER`       | `s3`                                               | `local` is refused in production.                                                                                 |
| `S3_ENDPOINT`          | `https://<account>.r2.cloudflarestorage.com`       | Omit for AWS S3.                                                                                                  |
| `S3_REGION`            | `auto`                                             | `auto` for R2; the real region for AWS.                                                                           |
| `S3_BUCKET`            | `internship-tracker-uploads`                       |                                                                                                                   |
| `S3_ACCESS_KEY_ID`     | …                                                  | Secret.                                                                                                           |
| `S3_SECRET_ACCESS_KEY` | …                                                  | Secret.                                                                                                           |

### Recommended

| Variable                      | Example                                             | Notes                                                     |
| ----------------------------- | --------------------------------------------------- | --------------------------------------------------------- |
| `MAIL_FROM`                   | `Internship Tracker <no-reply@tracker.example.com>` | Real display name, domain you control. See 7.1.           |
| `MAIL_TRANSPORT`              | `smtp`                                              | Refuses to boot without `SMTP_HOST`, on purpose.          |
| `SMTP_HOST`                   | `smtp.resend.com`                                   |                                                           |
| `SMTP_PORT`                   | `587`                                               | 465 for implicit TLS.                                     |
| `SMTP_USER`                   | `resend`                                            |                                                           |
| `SMTP_PASS`                   | …                                                   | Secret — the provider API key.                            |
| `LOG_LEVEL`                   | `info`                                              | `debug` is noisy and can be expensive on a log quota.     |
| `ENABLE_CRON`                 | `true`                                              | Reminder digests, weekly summaries, purge and demo reset. |
| `MONGOMS_DISABLE_POSTINSTALL` | `1`                                                 | Build-time only. See 4.2.                                 |

### Optional

| Variable                       | Default                          | Notes                                                                 |
| ------------------------------ | -------------------------------- | --------------------------------------------------------------------- |
| `PORT`                         | `5000`                           | **Do not set on Render** — it assigns one.                            |
| `ACCESS_TOKEN_TTL`             | `15m`                            |                                                                       |
| `REFRESH_TOKEN_TTL`            | `7d`                             |                                                                       |
| `COOKIE_DOMAIN`                | unset                            | Leave unset for split-host. See 6.2.                                  |
| `MAX_UPLOAD_MB`                | `5`                              |                                                                       |
| `UPLOAD_DIR`                   | `uploads`                        | Unused when `STORAGE_DRIVER=s3`.                                      |
| `DEMO_EMAIL` / `DEMO_PASSWORD` | `demo@tracker.dev` / `Demo@1234` | Published deliberately. Change to disable the documented credentials. |
| `REMINDER_DIGEST_HOUR`         | `8`                              | Local hour, in each user's own timezone.                              |
| `WEEKLY_SUMMARY_WEEKDAY`       | `1`                              | 1 = Monday.                                                           |
| `SENTRY_DSN`                   | unset                            | Unset means Sentry is never initialised.                              |
| `SENTRY_TRACES_SAMPLE_RATE`    | `0`                              | Errors only.                                                          |

### Client (Vercel) — build-time

| Variable                                       | Example                           | Notes                                                     |
| ---------------------------------------------- | --------------------------------- | --------------------------------------------------------- |
| `VITE_API_URL`                                 | `https://api.tracker.example.com` | No trailing slash.                                        |
| `VITE_APP_URL`                                 | `https://tracker.example.com`     | Canonical URLs, sitemap, OG tags.                         |
| `VITE_DEMO_ENABLED`                            | `true`                            | Cosmetic; the API is the enforcement.                     |
| `VITE_SENTRY_DSN`                              | unset                             | Behind a dynamic import when unset.                       |
| `VITE_ANALYTICS_DOMAIN` / `VITE_ANALYTICS_SRC` | unset                             | Cookieless analytics only, so no cookie banner is needed. |

> Never put a secret in a `VITE_*` variable. Every one of them is compiled into JavaScript that
> anyone can read.

---

## Automated deploys

`.github/workflows/deploy.yml` waits for the full CI suite to pass and only then calls the platform
deploy hooks. **It is disabled by default** and does nothing at all until you opt in, so a fork or a
clone cannot accidentally deploy to anything.

To enable it, add these repository secrets under **Settings → Secrets and variables → Actions**:

| Secret                   | Where it comes from                                           |
| ------------------------ | ------------------------------------------------------------- |
| `DEPLOY_ENABLED`         | Set it to `true`. Absent or anything else and the job skips.  |
| `RENDER_DEPLOY_HOOK_URL` | Render → service → Settings → **Deploy Hook**                 |
| `VERCEL_DEPLOY_HOOK_URL` | Vercel → project → Settings → Git → **Deploy Hooks** → create |

With `DEPLOY_ENABLED` unset the workflow still runs and reports a green skip, which is the intended
resting state: CI keeps guarding `main` and nothing deploys.

Both platforms also offer their own git integration, which deploys on every push to `main` _without_
waiting for tests. If you use that instead, be aware you have given up the gate — the entire value of
this workflow is that a red test suite stops the deploy.

---

## Pre-launch checklist

Walk this immediately before announcing the URL. Every line is something that has silently broken a
launch.

**Secrets**

- [ ] `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` generated fresh with `openssl rand -base64 48`,
      different from each other, and never used in development.
- [ ] The Atlas database password is unique to this deployment.
- [ ] No `.env` file is committed. `scripts/scan-secrets.sh` runs gitleaks across the whole history.
- [ ] `NODE_ENV=production` on Render. Confirm it in the boot log, not just in the dashboard.

**The deployment**

- [ ] `GET /health` → 200 and `GET /ready` → 200 on the live API.
- [ ] `npm run migrate -w server` has been run against the production database.
- [ ] Opening `https://tracker.example.com/applications` **directly** and reloading it returns the
      app, not a 404. (Step 5.3.)
- [ ] Source maps are not published: `curl -I https://tracker.example.com/assets/index-*.js.map`
      returns 404, and no `sourceMappingURL` comment appears in the served JavaScript.
- [ ] HSTS present: `curl -sI https://api.tracker.example.com/health | grep -i strict-transport`.

**Cross-origin — the part that fails silently**

- [ ] `CLIENT_ORIGIN`, `APP_URL`, `API_URL`, `VITE_API_URL` and `VITE_APP_URL` all name the real
      deployed origins, with no trailing slashes.
- [ ] The `refresh_token` cookie shows `SameSite=None`, `Secure`, `HttpOnly`, `Path=/api/v1/auth`.
- [ ] Signing in and **hard-reloading** leaves you signed in.
- [ ] Export CSV saves as `applications-YYYY-MM-DD.csv`, not `applications.csv`.

**Email**

- [ ] SPF, DKIM and DMARC resolve for the sending domain and the provider dashboard shows Verified.
- [ ] `MAIL_FROM` uses a domain you control, with a real display name.
- [ ] A verification email **reached the Inbox** of a real Gmail, Outlook and Yahoo address, with
      `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS` under Gmail's Show original.
- [ ] The verification link in that email works against the deployed client.
- [ ] The unsubscribe link in a reminder digest works.

**Data and operations**

- [ ] `npm run seed -w server` has run; "Try the demo" signs in and every dashboard chart has data.
- [ ] An uploaded attachment survives a redeploy — proof that `STORAGE_DRIVER=s3` is really in
      effect.
- [ ] The uptime monitor is live on `/health` at 5-minute intervals and has sent a test alert.
- [ ] If Sentry is enabled, a deliberately triggered 500 has appeared in the issue stream.
- [ ] `scripts/backup.sh` has been run once **and a restore from that archive has been tested**.
- [ ] `CONTACT_EMAIL` in `client/src/lib/siteMeta.ts` is a real address — the `{{CONTACT_EMAIL}}`
      placeholder must not be live on Terms, Privacy, the footer or `SECURITY.md`.

---

## Alternatives: Railway and Netlify

### Railway instead of Render

Railway has no idle spin-down on its trial plan, so
[Step 9](#step-9--cold-starts-and-keeping-the-api-warm) does not apply; it bills by usage instead.

| Setting | Value                                             |
| ------- | ------------------------------------------------- |
| Build   | `npm ci --include=dev && npm run build -w server` |
| Start   | `npm run start -w server`                         |
| Watch   | root directory                                    |

Same environment variables, `TRUST_PROXY=1` included — Railway also fronts your process with a proxy.

### Netlify instead of Vercel

| Setting           | Value                            |
| ----------------- | -------------------------------- |
| Build command     | `npm run build:deploy -w client` |
| Publish directory | `client/dist`                    |

Netlify's SPA rewrite is a `client/public/_redirects` file, which Vite copies into `dist` verbatim:

```
/*    /index.html   200
```

Or the equivalent in `netlify.toml`:

```toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

---

## Troubleshooting

**Every API call fails with a CORS error in the browser console.**
`CLIENT_ORIGIN` does not exactly match the origin the browser is on. Compare them character by
character — a trailing slash, `http` vs `https`, or a missing `www.` is enough. Then redeploy the
API; the value is read at boot.

**Login works, but a page refresh logs the user out.**
The refresh cookie is not reaching the API. Check that `API_URL` on Render is the real API origin
(that is what 6.2 keys on), that the cookie shows `SameSite=None; Secure`, and that `TRUST_PROXY=1`.
Walk [6.4](#64-verify-it-end-to-end-in-a-browser).

**Exports download as `applications.csv` instead of the dated name.**
`Access-Control-Expose-Headers` is not reaching the browser. It is set in `app.ts`; if the deployed
response lacks it, something in front of the API is stripping it.

**Refreshing a deep link 404s.**
The SPA rewrite is missing. Step 5.3 for Vercel, the Netlify section otherwise.

**The build fails with `tsc: not found` or `Cannot find module 'tsc-alias'`.**
`NODE_ENV=production` made npm skip devDependencies. Use `npm ci --include=dev` in the build command.

**The API boots, then exits.**
Read the log. The env loader prints every invalid variable at once with the reason. The usual causes
are a short JWT secret, both secrets identical, `STORAGE_DRIVER=local`, or an origin still pointing
at localhost.

**`/health` is 200 but `/ready` is 503.**
The process is alive and Mongo is not reachable. Check the Atlas IP allowlist (Step 1.3), then that
the password in `MONGO_URI` is URL-encoded.

**The first request after a quiet period takes a minute.**
Render free-tier cold start. [Step 9](#step-9--cold-starts-and-keeping-the-api-warm).

**Emails send successfully but never arrive.**
Check the provider's own activity log first — it will show delivered, bounced or dropped. If it says
delivered, this is spam placement: work [Step 7.2](#72-the-dns-records) and confirm DMARC alignment
via Gmail's Show original.
