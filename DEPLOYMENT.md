# Deployment

Everything needed to put this app on the public internet, in order, with nothing assumed. Work top
to bottom; each step names what the next one needs from it.

This guide targets **Railway for both the API and the client**, plus MongoDB Atlas and an
S3-compatible bucket. One dashboard, one bill. If you would rather split the two halves across Render
and Vercel, that path is summarised under
[Alternatives](#alternatives-render--vercel-instead-of-railway).

**Read [Step 6](#step-6--make-the-two-origins-trust-each-other) before you deploy, not after.** The
client and the API are two separate Railway services with two separate hostnames, so a browser treats
them as **cross-origin even though they sit in the same project on the same platform**. Three
settings have to agree for a login to survive a page refresh, and it is the one part of this
deployment that fails silently.

---

## Table of contents

1. [What you are building](#what-you-are-building)
2. [Step 1 — MongoDB Atlas](#step-1--mongodb-atlas)
3. [Step 2 — Object storage for uploads](#step-2--object-storage-for-uploads)
4. [Step 3 — Generate the secrets](#step-3--generate-the-secrets)
5. [Step 4 — Deploy the API to Railway](#step-4--deploy-the-api-to-railway)
6. [Step 5 — Deploy the client to Railway](#step-5--deploy-the-client-to-railway)
7. [Step 6 — Make the two origins trust each other](#step-6--make-the-two-origins-trust-each-other)
8. [Step 7 — Transactional email and deliverability](#step-7--transactional-email-and-deliverability)
9. [Step 8 — Custom domain, HTTPS and HSTS](#step-8--custom-domain-https-and-hsts)
10. [Step 9 — Cold starts and keeping the API warm](#step-9--sleeping-cold-starts-and-keeping-the-api-warm)
11. [Step 10 — Uptime, errors and backups](#step-10--uptime-errors-and-backups)
12. [Step 11 — Seed the demo account](#step-11--seed-the-demo-account)
13. [Step 12 — Optional: "Continue with Google"](#step-12--optional-continue-with-google)
14. [Production environment variables](#production-environment-variables)
15. [Automated deploys](#automated-deploys)
16. [Pre-launch checklist](#pre-launch-checklist)
17. [Alternatives: Render + Vercel](#alternatives-render--vercel-instead-of-railway)
18. [Troubleshooting](#troubleshooting)

---

## What you are building

```
                          ┌───────────── ONE Railway project ─────────────┐
     browser              │                                               │
        │                 │   ┌─────────────────┐   ┌─────────────────┐   │
        ├─ tracker.example.com ─►  web service   │   │   api service   │   │
        │                 │   │  Caddy + static │   │  Express        │   │
        └─ api.tracker.example.com ─────────────────►  server/dist    │   │
                          │   │  client/dist    │   │                 │   │
                          │   └─────────────────┘   └────────┬────────┘   │
                          └───────────────────────────────────┼──────────┘
                                             ┌────────────────┼────────────────┐
                                             ▼                ▼                ▼
                                      MongoDB Atlas    Cloudflare R2     Email provider
                                      (M0, free)       (uploads)         (Resend / SendGrid / …)
```

Two services, **two hostnames**, one project. Three accounts: Railway, MongoDB Atlas, and an email
provider — plus an S3-compatible bucket, which Cloudflare R2 gives you free. A custom domain is
optional for the app itself but **required** for email that reaches an inbox, see
[Step 7](#step-7--transactional-email-and-deliverability).

> **Two services in the same project are still cross-origin.** `web-production-a1b2.up.railway.app`
> and `api-production-c3d4.up.railway.app` are different hostnames, so every browser rule keyed on
> origin — CORS, and the `SameSite` cookie attribute — applies exactly as it would across two
> unrelated companies. Sharing a dashboard, a project, a bill and a private network changes none of
> it. This trips people up often enough that [Step 6](#step-6--make-the-two-origins-trust-each-other)
> says it again in more detail.

### What this actually costs

Railway does not have a Render-style "free instance that sleeps". Be clear-eyed before you start:

| Plan  | What you get                                                                                  |
| ----- | --------------------------------------------------------------------------------------------- |
| Trial | A one-time **$5** grant, valid up to 30 days. Enough to stand both services up and test them. |
| Free  | **$1 of credit per month**, non-rolling, capped at 1 vCPU / 0.5 GB RAM and **one project**.   |
| Hobby | **$5/month** minimum, including $5 of usage credit.                                           |

Two always-on containers will not fit inside $1 a month. Plan on the Trial to get everything working
and **Hobby at $5/month** to keep it up, or enable serverless sleeping
([Step 9](#step-9--sleeping-cold-starts-and-keeping-the-api-warm)) to stretch the credit. Atlas M0,
R2 and the email provider stay free regardless.

### Before you start

- The repository pushed to GitHub.
- A shell with `openssl` (Git Bash, WSL, macOS, Linux) for generating secrets.
- Node 20+ locally if you want to seed the demo account from your machine.
- Optionally the Railway CLI (`npm i -g @railway/cli`), which the deploy workflow in
  [Automated deploys](#automated-deploys) uses.

---

## Step 1 — MongoDB Atlas

### 1.1 Create the cluster

1. Sign up at <https://www.mongodb.com/cloud/atlas/register>.
2. **Build a Database** → **M0** (the free forever tier, 512 MB).
3. Pick a provider and a region **physically close to the Railway region you will deploy into** —
   every query pays that round trip, and mismatching them adds 100 ms or more to every request.
   Railway shows the region on each service under Settings → Deploy; pick your Atlas region to match.
4. Name the cluster, e.g. `internship-tracker`.

### 1.2 Create the database user

**Database Access** → **Add New Database User**.

- Authentication: **Password**.
- Username: `tracker_app` (not your Atlas login).
- Password: **Autogenerate Secure Password**, then copy it somewhere safe. You cannot read it again.
- Role: **Read and write to any database**, or `readWrite` scoped to `internship_tracker` if you
  prefer least privilege.

### 1.3 Allow the API to connect

**Network Access** → **Add IP Address**.

This step is platform-independent in shape — Atlas needs to know which addresses may reach the
cluster — but the answer depends on whether your host gives you a fixed outbound IP. Railway
containers do not have one by default, so there is no small set of addresses to allowlist. Two honest
choices:

| Option                                     | When                                                                   | Trade-off                                                                |
| ------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `0.0.0.0/0` ("allow access from anywhere") | The normal case on Railway, and on any host without a static egress IP | The database password becomes the only control. Make it long and unique. |
| A specific egress IP or CIDR               | Only if you have arranged static egress for the service                | Tighter, but it is extra setup and not the default anywhere.             |

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
to boot with `STORAGE_DRIVER=local` when `NODE_ENV=production`, because a container filesystem is
ephemeral: every redeploy, every restart and every wake from sleep starts from the image again.
Railway can attach a persistent volume, but a volume is billed storage and is bound to one service,
so an object store is still the right answer — and it is the one the storage adapter was built for.
Attachments written to local disk would vanish silently, at a time nobody was watching.

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

## Step 4 — Deploy the API to Railway

### 4.0 One project, two services — and why

Create **one Railway project containing two services**, not two projects. Three reasons:

- Railway's own guidance for a monorepo is two services in one project, and the Free plan allows
  **one project** anyway, so two projects is not an option there.
- Services in one project share a private network and can reference each other's variables, which
  keeps `CLIENT_ORIGIN` and `VITE_API_URL` from drifting apart (see 4.2).
- One project is one place to look at logs, usage and billing — the reason for choosing a single
  platform in the first place.

**This repository is a _shared_ monorepo, and that changes the setup.** Railway distinguishes two
shapes:

| Shape        | What it means                                                       | How you configure it                                                      |
| ------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Isolated** | Independent projects side by side, each with its own lockfile       | Set a **Root Directory** per service                                      |
| **Shared**   | One lockfile at the root, workspaces sharing config — **this repo** | Leave the root alone; set **custom build and start commands** per service |

So do **not** set Root Directory to `server/` or `client/`. There is one `package-lock.json` at the
repository root and both workspaces resolve through it; pointing a service at a subdirectory gives it
a `package.json` whose dependencies it cannot install. Every service builds from the repository root
and is told which workspace to act on with `-w`.

Railway can also auto-detect JavaScript workspaces on import and pre-stage one service per package
with workspace-scoped commands. If it offers, let it — then correct the commands to match the tables
below, because it cannot know about `build:deploy` or the `--include=dev` requirement.

### 4.1 Create the API service

<https://railway.app/new> → **Deploy from GitHub repo** → pick the repository. Railway creates the
project and a first service; rename it `api` under **Settings → Service**.

Then, still in that service's **Settings**:

| Setting           | Value                                                                      |
| ----------------- | -------------------------------------------------------------------------- |
| Root Directory    | `/` — leave it alone, see 4.0                                              |
| Build Command     | `npm ci --include=dev && npm run build -w server`                          |
| Start Command     | `npm run start -w server`                                                  |
| Watch Paths       | `/server/**`, `/package.json`, `/package-lock.json`, `/tsconfig.base.json` |
| Healthcheck Path  | `/health`                                                                  |
| Config as code    | `railway.server.json` — pins the builder and both commands, see 5.2        |
| Public Networking | **Generate Domain** — you need the hostname in 4.2                         |

**`--include=dev` is not optional.** TypeScript, `tsc-alias` and the type packages are
devDependencies, and npm skips devDependencies automatically when `NODE_ENV=production` is set in the
environment — which you are about to set in the very next step. Without the flag the build fails with
`tsc: not found`.

**Watch Paths stop the API rebuilding when only the client changed.** Both services watch the same
repository, so without them every push redeploys both, and on a metered plan you pay the build
minutes twice. They are gitignore-style patterns.

**The healthcheck earns its place beyond monitoring.** Railway polls it after starting a deployment
and will not cut traffic over to a container that never answers, so a boot that dies on a bad
environment variable fails the deploy instead of silently replacing a working one. `/health` is the
right target rather than `/ready`: it answers as long as the process is alive, whereas `/ready` also
pings Mongo and would fail a deploy over a transient database blip.

If you would rather keep this in the repository than the dashboard, Railway reads `railway.json` or
`railway.toml`, and **config-as-code overrides dashboard settings**:

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "buildCommand": "npm ci --include=dev && npm run build -w server"
  },
  "deploy": {
    "startCommand": "npm run start -w server",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 300
  }
}
```

That file is per-service, so two services in one repository means two such files under different
names with each service pointed at its own — which is exactly what `railway.server.json` and
`railway.client.json` are. Point each service at its own under **Settings → Config as code**.

**The API stays on Railpack, and that is deliberate rather than an oversight.** `server/Dockerfile`
has only a `deps` and a `dev` stage, so pinning this service to the `DOCKERFILE` builder would hand
it that last stage and run `tsx watch` in production — the same silent failure
[5.2](#52-pin-the-builder--the-setting-that-silently-serves-a-dev-server) describes for the client.
`railway.server.json` therefore pins `"builder": "RAILPACK"` explicitly, so the correct choice
survives somebody later "making the two services consistent".

### 4.2 Environment variables

Railway variables are set **per service, not per project**. Open the `api` service → **Variables**
and set every row from [Production environment variables](#production-environment-variables) there.
The `VITE_*` values in Step 5 belong to the _other_ service and do nothing here — this distinction
matters, and getting it wrong is the second most common way this deployment breaks.

Do not set `PORT`. Railway injects it and the app reads it.

**Use reference variables so the two services cannot drift apart.** Rather than pasting the client's
hostname into `CLIENT_ORIGIN` by hand:

```
CLIENT_ORIGIN=https://${{web.RAILWAY_PUBLIC_DOMAIN}}
APP_URL=https://${{web.RAILWAY_PUBLIC_DOMAIN}}
API_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
```

`${{web.…}}` reads a variable from the sibling service named `web`; the bare form reads this
service's own. Note the explicit `https://` — `RAILWAY_PUBLIC_DOMAIN` is a bare hostname with no
scheme, and the env loader requires a full URL and will refuse to boot without one. Once you attach
custom domains ([Step 8](#step-8--custom-domain-https-and-hsts)), replace these with the real
origins: `RAILWAY_PUBLIC_DOMAIN` keeps returning the `*.up.railway.app` name.

Two variables worth calling out for this platform:

| Variable                      | Value | Why                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TRUST_PROXY`                 | `1`   | Railway terminates TLS at its edge and forwards to your container over plain HTTP — one hop, exactly as any managed platform does. Without this, `req.ip` is the proxy for every request, so all users share one rate-limit bucket and one person's burst throttles everybody; `req.secure` is also false, which makes Express drop `Secure` cookies, and per 6.2 that means no refresh cookie at all. |
| `MONGOMS_DISABLE_POSTINSTALL` | `1`   | `mongodb-memory-server` is a test dependency whose postinstall downloads a MongoDB binary. `--include=dev` pulls it in, and there is no reason to spend build minutes fetching a database the production image never runs.                                                                                                                                                                             |

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
curl -i https://api-production-c3d4.up.railway.app/health   # 200, with a JSON body
curl -i https://api-production-c3d4.up.railway.app/ready    # 200 only if Mongo is reachable
```

`/health` answers as long as the process is alive. `/ready` additionally checks the database, so a
200 there is what proves Step 1 worked.

### 4.4 Run the migrations

The migration runner is deliberately separate from server boot, so two instances behind a rolling
deploy cannot race each other. Run it from your own machine through the Railway CLI, which executes
the command with the service's environment injected:

```bash
railway link                                  # pick the project, then the api service
railway run npm run migrate -w server
```

`railway run` runs locally against the remote variables, so it needs the repository checked out and
`npm ci` already done. Run it before each deploy that includes a new migration.

---

## Step 5 — Deploy the client to Railway

### 5.1 Add a second service to the same project

In the project canvas: **Create** → **GitHub Repo** → the same repository again. Rename it `web`.

Railway has no Vercel-style "static site" product: every service is a container. So the web service
builds the client and then runs a tiny web server that serves `client/dist`. That is the single
biggest structural difference from the Vercel path, and it is what 5.3 is about.

| Setting           | Value                                                                      |
| ----------------- | -------------------------------------------------------------------------- |
| Root Directory    | `/` — same reasoning as 4.0, one lockfile at the root                      |
| Watch Paths       | `/client/**`, `/package.json`, `/package-lock.json`, `/tsconfig.base.json` |
| Public Networking | **Generate Domain**                                                        |
| Builder           | **Dockerfile**, not Railpack — see 5.2 below, this one matters             |
| Config as code    | `railway.client.json` — pins the two settings above, see 5.2               |
| Dockerfile Path   | `client/Dockerfile` — its final stage is the production server, see 5.4    |
| Build / Start     | supplied by that Dockerfile — leave both blank                             |

**You will use `build:deploy`, not `build`.** The Vite config emits source maps on purpose — an
error tracker cannot symbolicate a minified stack without them — but `client/dist` is exactly what
gets served, so a plain `build` would leave your complete readable source one predictable `.js.map`
request away from any visitor. `build:deploy` runs the build and then
`client/scripts/stripSourcemaps.mjs`, which deletes every `.map` and removes the
`//# sourceMappingURL=` comments pointing at them. If you upload maps to Sentry, do it between the
two steps (see [Step 10](#step-10--uptime-errors-and-backups)).

### 5.2 Pin the builder — the setting that silently serves a dev server

**Railway defaults the Builder to Railpack, and for this service that default is wrong.** Railpack
auto-detects the repository and generates its own build and start commands. It does not use
`client/Dockerfile`, so none of the production behaviour that file provides applies: the client is
built with `npm run build` rather than `build:deploy`, so **the source maps are never stripped**, and
the start command it infers runs Vite's _development_ server. The site loads, so nothing looks
broken — the app is simply served unminified, from source, with your full source available at a
predictable `.js.map` URL. That is exactly how this deployment failed the first time, and it was only
noticed because Vite's host check rejected the Railway domain.

So the builder must be **Dockerfile**, and the repository pins it rather than leaving it to a
dashboard setting somebody has to remember:

```json
// railway.client.json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": { "builder": "DOCKERFILE", "dockerfilePath": "client/Dockerfile" },
  "deploy": { "startCommand": "npm run preview --workspace client" }
}
```

Railway's config-as-code is **per service, not per repository** — one file describes one service — so
there are two of them at the repository root, `railway.client.json` and `railway.server.json`. Point
each service at its own: **Settings → Config as code** → the file path. This is the one step that
cannot itself be version-controlled, because it is what tells Railway where the version-controlled
file lives.

**Configuration in the file overrides the dashboard.** That is the point: `startCommand` here
neutralises whatever is currently typed into the service's Start Command box, so a stale
`npm run dev -w client` left over from an earlier attempt stops taking effect.

Two things worth knowing about this mechanism:

- **There is no key for a multi-stage Docker `target`.** A build with no target builds the _last_
  stage, so `client/Dockerfile` ends with its production stage on purpose. That ordering is load-
  bearing and nothing in Railway enforces it, so `client/tests/config/dockerfileStages.test.ts`
  asserts it instead — the suite fails if a stage is ever appended after `prod`.
- **`railway.json` is deprecated in favour of Infrastructure as Code** (`.railway/railway.ts`, one
  file per project rather than per service). Existing `railway.json` files keep working until
  **2026-12-01**, and `railway config migrate --apply` converts them. Migrating changes how the whole
  project is provisioned, so it is worth doing deliberately rather than as part of a bug fix.

### 5.3 Environment variables

Set these on the **`web` service**, not the `api` service and not "shared across the project".
Railway scopes variables per service, and a `VITE_*` value sitting on the API service is simply never
read by anything.

Vite inlines `VITE_*` values **at build time**, not at runtime. The value is substituted into the
bundle as a string literal and never read again, so a running container's environment cannot change
it: if a changed value does not appear in the served bundle, redeploy rather than restart.

**Setting them on the service is necessary but not sufficient, and this has already bitten once.**
Railway makes every service variable available to the build and passes them to a Docker build as
build arguments — but Docker is the half that isolates. A build stage sees only the arguments it
declares, and an undeclared `ARG` is simply absent, with no warning from Railway, from Docker or from
Vite. The build succeeds, and the bundle carries the localhost fallbacks from `client/src/lib/env.ts`
instead. The first symptom is the deployed site calling `http://localhost:5000` and failing CORS in
the visitor's browser.

So `client/Dockerfile`'s `build` stage declares each one and exports it before the build runs:

```dockerfile
ARG VITE_API_URL
ARG VITE_APP_URL
ARG VITE_DEMO_ENABLED
ARG VITE_SENTRY_DSN
ENV VITE_API_URL=$VITE_API_URL     VITE_APP_URL=$VITE_APP_URL     VITE_DEMO_ENABLED=$VITE_DEMO_ENABLED     VITE_SENTRY_DSN=$VITE_SENTRY_DSN
RUN npm run build:deploy --workspace client
```

Two details that are easy to get wrong:

- **`ARG` does not cross stage boundaries.** Declaring these in an earlier stage leaves the stage that
  actually builds seeing nothing. They belong in the stage with the build command.
- **`ARG` alone does not reach the build process.** An `ARG` is visible to the Dockerfile's own
  instructions but is not exported into a `RUN`'s environment, which is where `vite build` looks. The
  `ENV` line is what puts them in front of it.

**Nothing extra is needed in the dashboard.** Railway has no separate "build variables" section —
service variables are available to both build and runtime, so variables already set on the `web`
service are enough once the Dockerfile declares them.

Two things now fail loudly rather than shipping a broken bundle. `npm run build:deploy` runs
`client/scripts/checkDeployEnv.mjs` first, which refuses to build when `VITE_API_URL` or
`VITE_APP_URL` is unset or still points at localhost; and
`client/tests/config/dockerfileBuildArgs.test.ts` scans the client source for every
`import.meta.env.VITE_*` it reads and fails if any is not declared and exported in the build stage, so
a variable added later cannot go missing the same way. `npm run build` is deliberately left alone, so
a plain local build and CI need no configuration.

To check a change to this before deploying, build with a value you can recognise and look for it in
the output:

```bash
docker build -f client/Dockerfile --target prod -t client-check   --build-arg VITE_API_URL=https://api-proof.example.com   --build-arg VITE_APP_URL=https://app-proof.example.com .
docker run --rm --entrypoint sh client-check   -c "grep -rho 'https://api-proof.example.com' /app/client/dist/assets/ | head -1"
```

A hit means the value was inlined. `localhost:5000` also still appears once in the bundle after this
— that is the fallback _argument_ in `src/lib/env.ts`, which is inert whenever the variable is set;
the inlined value is the first argument beside it.

You can use a reference variable here too, so the client always points at the sibling API:

```
VITE_API_URL=https://${{api.RAILWAY_PUBLIC_DOMAIN}}
VITE_APP_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
```

| Variable            | Value                                                 |
| ------------------- | ----------------------------------------------------- |
| `VITE_API_URL`      | `https://api.tracker.example.com` — no trailing slash |
| `VITE_APP_URL`      | `https://tracker.example.com`                         |
| `VITE_DEMO_ENABLED` | `true`                                                |
| `VITE_SENTRY_DSN`   | optional                                              |

### 5.4 The SPA rewrite — a Dockerfile and a Caddyfile

This app uses client-side routing. Without a fallback rule,
`https://tracker.example.com/applications` works when you navigate to it inside the app and **404s
when you refresh the page or open the link directly** — the server is asked for a file at
`/applications`, which does not exist.

On Vercel this was three lines of `vercel.json`. **On Railway there is no rewrite setting to fill
in**, because there is no static-hosting layer to configure: you ship a container, so the container
decides how unmatched paths are served.

**The repository already ships a working answer, and it is the default path.** `client/Dockerfile`'s
final stage builds the client with `build:deploy` and serves `client/dist` with `vite preview`, which
performs the SPA fallback itself — no extra file to create. Point the service at `client/Dockerfile`
with no target and you are done. The stage order matters: the production stage is last precisely so a
builder that picks the final stage cannot end up running the development server.

Vite's host allowlist is derived from `VITE_APP_URL` plus a `.up.railway.app` suffix
(`client/allowedHosts.ts`) — which is why **`VITE_APP_URL` must be set on the `web` service** before a
custom domain will be accepted. The allowlist is matched on hostname only, with the port stripped
before comparison, so it is unaffected by whatever port Railway hands the container.

### The port a container listens on

Railway injects `PORT` and routes to whatever the process actually bound. Two consequences worth
knowing before debugging a 502:

- **`EXPOSE` does nothing on Railway.** It is not read, and it does not select the target port. The
  `EXPOSE 4173` in `client/Dockerfile` documents a plain `docker run` and is kept equal to the start
  command's fallback so the two cannot drift.
- **`deploy.startCommand` replaces the image's `CMD` outright.** When that key is set in
  `railway.client.json`, the Dockerfile's `CMD` never runs on Railway at all — so a correct `CMD` and
  a stale start command look identical right up until the deploy 502s. Both are written the same way,
  and `client/tests/config/dockerfileStages.test.ts` fails if they diverge.
- **A start command on a `DOCKERFILE` build gets no shell of its own.** Railway runs it in exec form,
  unlike a Railpack build, which does get a shell. So the start command has to wrap itself:

  ```json
  "startCommand": "/bin/sh -c \"npm run preview --workspace client -- --host --port ${PORT:-4173}\""
  ```

  Without the `/bin/sh -c`, `${PORT:-4173}` reaches Vite as a literal string and the container exits
  with `'${PORT:-4173}' is not a valid port number`. The Dockerfile's own `sh -c` does not help here,
  because the start command replaces that command rather than running inside it.

Both spellings resolve to `npm run preview --workspace client -- --host --port ${PORT:-4173}`, and
each part is load-bearing:

- **Shell form.** A Docker `CMD` in exec form (`["npm", "run", …, "$PORT"]`) is passed to `execve`
  with no shell in between, so `$PORT` arrives at Vite as five literal characters and is rejected as
  a port. The `sh -c` wrapper is what performs the expansion. This is the single most common way a
  Railway container ends up on the wrong port.
- **`--host` with no value.** That is Vite's `host: true`, which binds the dual-stack wildcard and
  serves every interface — `netstat` inside the container shows `:::$PORT`. Writing `--host 0.0.0.0`
  would be _narrower_, not safer: it is IPv4 only, while Railway's private network resolves to both
  IPv4 and IPv6 addresses.
- **`${PORT:-4173}`.** Railway sets `PORT`; a local `docker run` does not, and 4173 is Vite's own
  default for `preview`.

`client/vite.config.ts` computes the same two values from `process.env.PORT`. The duplication is
deliberate: the port and interface a container listens on are its contract with the platform, and
that contract should hold even if the config file fails to load.

To check the image rather than trust it:

```bash
docker build -f client/Dockerfile --target prod -t tracker-client-prod .
docker run --rm -e PORT=7777 -p 9091:7777 tracker-client-prod
curl -o /dev/null -w '%{http_code}
' http://127.0.0.1:9091/   # expect 200
```

If that returns 200 and Railway still answers **"Application failed to respond"**, the container is
not the problem. Railway's own documentation names the remaining cause: the domain's _target port_
does not match the port the app bound. Check it under the service's **Settings → Networking → Public
Networking**, on the domain itself, and either correct it or delete and re-add the domain so it is
detected again.

> **Caddy as an alternative.** Vite's own documentation notes that `vite preview` is meant for
> previewing a build rather than serving as a hardened production server. For a low-traffic portfolio
> deployment it is fine, and it keeps the image to one toolchain. If you would rather serve with a
> real static server, the Caddy setup below replaces the final stage and is what Railway's own SPA
> guide recommends.

Create **`Caddyfile`** in the repository root:

```
{
	admin off
	persist_config off
	auto_https off
	log {
		format json
	}
	servers {
		trusted_proxies static private_ranges 100.0.0.0/8
	}
}

:{$PORT:3000} {
	log {
		format json
	}

	root * client/dist
	encode gzip
	file_server

	try_files {path} /index.html
}
```

`try_files {path} /index.html` is the whole fix, and it is the exact equivalent of the Vercel
rewrite: serve the requested file if it exists, otherwise hand back the entry HTML and let the router
take over. Real files still win — `robots.txt`, `sitemap.xml`, `manifest.webmanifest` and everything
under `/assets` are served normally — because Caddy orders `try_files` before `file_server` and only
falls through when nothing matched.

`:{$PORT:3000}` matters: Railway injects `PORT` and a container that ignores it is unreachable.
`auto_https off` is right here because Railway terminates TLS at its edge; Caddy would otherwise try
to obtain its own certificate and fail.

Create **`client/Dockerfile.web`** (or any name you point the service at) to build with Node and
serve with Caddy:

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json
RUN npm ci
COPY . ./
# Vite inlines VITE_* at build time, so they must be present in this stage.
ARG VITE_API_URL
ARG VITE_APP_URL
ARG VITE_DEMO_ENABLED
RUN npm run build:deploy -w client

FROM caddy:alpine
WORKDIR /srv
COPY Caddyfile ./Caddyfile
RUN caddy fmt Caddyfile --overwrite
COPY --from=build /app/client/dist ./client/dist
CMD ["caddy", "run", "--config", "Caddyfile", "--adapter", "caddyfile"]
```

Point the `web` service at it: **Settings → Build → Dockerfile Path** → `client/Dockerfile.web`.
Railway builds the image and ignores the Nixpacks/Railpack detection entirely, which is what you
want — the auto-detected build would try to run the whole workspace.

Caddy serves static files with no knowledge of `allowedHosts`, so this route sidesteps Vite's host
check rather than satisfying it. That is not by itself a reason to prefer it: the check only applies
to a Vite-served deployment, and a wrong `VITE_APP_URL` still breaks canonical URLs, the sitemap and
the OG tags either way.

> **Lighter alternative.** Railpack, Railway's builder, has static-site support with an
> `index_fallback` option that generates a Caddyfile for you. It is less code, but it needs the build
> output at a path it expects, which is awkward from a workspace root. The explicit Dockerfile above
> is more lines and no guesswork; prefer it unless you enjoy debugging a builder's assumptions.

**Test this specifically after deploying.** Open `https://tracker.example.com/applications` in a new
tab and press reload. A 404 here is the single most common broken SPA deploy, on any platform.

### 5.5 The SEO files need no manual step

`robots.txt` and `sitemap.xml` are generated on **every** client build from `VITE_APP_URL`, by
`client/scripts/generateSeoFiles.mjs`, which both `build` and `build:deploy` run before Vite. Set
the variable on the service and the files follow; there is nothing to run by hand and nothing to
commit.

> **Do not hand-edit these two files, and do not commit them.** They are in `.gitignore` for a
> reason. They were once committed as static files, generated on a machine where `VITE_APP_URL` was
> unset so the `http://localhost:5173` fallback won silently — and because Vite copies `public/`
> byte-for-byte with no substitution, production served that localhost URL no matter how correctly
> the variable was set on the host. A committed copy cannot pick up the deployment domain. That is
> the whole reason they are generated.

Verify after deploying, and note this is a real check rather than a formality — it is the one thing
that catches a wrong `VITE_APP_URL` at build time:

```bash
curl -s https://tracker.example.com/robots.txt | grep Sitemap:
curl -s https://tracker.example.com/sitemap.xml | grep -m1 '<loc>'
```

Both must show your domain. `localhost` here means the build did not have `VITE_APP_URL`.

The favicons, the OG image and `site.webmanifest` are different: they carry no origin, so they stay
committed and are regenerated with `npm run assets -w client` only when the **palette** changes.

---

## Step 6 — Make the two origins trust each other

The client is on one hostname and the API is on another. Four settings have to agree, and the failure
mode of getting them wrong is not an error message — it is a user who logs in, refreshes the page,
and finds themselves logged out.

> **Hosting both halves on Railway does not make them same-origin. Read this before you skip the
> section.**
>
> It is tempting to assume that two services in one project, on one platform, behind one bill, are
> somehow "internal" to each other. They are not, and no part of the browser's security model knows
> or cares that they share a dashboard. An origin is scheme + host + port. The API answers on
> `api-production-c3d4.up.railway.app` and the client is served from
> `web-production-a1b2.up.railway.app` — **two different hosts, therefore two different origins,
> therefore every cross-origin rule applies in full**:
>
> - `fetch` from the client to the API is a cross-origin request and needs CORS, with credentials
>   explicitly allowed and the client's origin explicitly named (6.1).
> - The refresh cookie is set by the API's host and sent from a page on the client's host, so it
>   needs `SameSite=None; Secure` or the browser silently omits it (6.2).
>
> The private network Railway gives you between services is real, but it is for **service-to-service**
> traffic inside the platform. Every request in this app originates in the user's browser, out on the
> public internet, so none of it travels that network. Custom domains do not change the picture
> either: `tracker.example.com` and `api.tracker.example.com` are still different hosts.
>
> The only arrangement that would make this same-origin is putting both behind one hostname with a
> path-based proxy — which this guide does not do, because it trades a settings problem you fix once
> for a routing layer you maintain forever.

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
page on another site initiates. `POST /auth/refresh` from a page on the web service to the API service is one
of those, so a `Strict` cookie simply never arrives — the silent refresh returns 401, the axios
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

`app.set('trust proxy', env.TRUST_PROXY)` — set `TRUST_PROXY=1` on the API service (one hop: Railway's
edge proxy). Covered in [4.2](#42-environment-variables); repeated here because it belongs to this
set. The value is `1` on Railway for the same reason it is `1` on Render, Railway, Fly or anything
else that terminates TLS in front of your container: the count is of proxies, not of vendors.

Leaving it at `0` breaks two things at once: rate limits key on the proxy's IP so all users share one
bucket, and Express treats the connection as insecure and will not set `Secure` cookies — which, per
6.2, means no refresh cookie at all.

Do not set it higher than the number of proxies actually in front of you. Trusting more hops than
exist lets a client forge `X-Forwarded-For` and evade the rate limiter entirely.

### 6.4 Verify it end to end, in a browser

The unit tests cover the logic and CI's end-to-end stack covers cross-origin behaviour, but **CI
cannot cover the cookie**: its web container is `localhost:5174` and its API is `localhost:5001`,
which are different _origins_ but the same _site_, because a port is not part of a site. A
`SameSite=Strict` cookie travels happily between them. Only a real two-domain deploy exercises 6.2.

Deploying both services to one Railway project does **not** close this gap — the two
`*.up.railway.app` hostnames are as cross-origin as two unrelated domains would be, so 6.2 is
exercised for real the moment you deploy, whether or not you have attached custom domains yet.

So after deploying, in a real browser:

1. Sign in at the web service's URL (`https://web-production-a1b2.up.railway.app`, or your custom
   domain once Step 8 is done).
2. Open DevTools → **Application** → **Cookies** → the API's domain. The `refresh_token` cookie must
   show `SameSite=None`, `Secure` ✓, `HttpOnly` ✓, `Path=/api/v1/auth`.
3. **Hard-reload the page.** You must still be signed in. In the **Network** tab,
   `POST /api/v1/auth/refresh` must be `200`, and its request must carry a `Cookie` header. A `401`
   here, or a request with no cookie, means 6.2 is misconfigured.
4. Leave the tab open for longer than `ACCESS_TOKEN_TTL` (15 minutes), then click around. The refresh
   should happen invisibly — no error toast, no bounce to login.
5. On the applications page, click **Export CSV**, then **All fields**. The saved file must be named
   `applications-YYYY-MM-DD.csv`. If it saved as `applications.csv`, `exposedHeaders` is not reaching
   the browser — check 6.1, and that nothing in front of the API is stripping the header.

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

> **If every SMTP port times out, the host is blocking SMTP — this is observed on Railway.**
>
> Symptom: `Connection timeout` on 465, 2465, 587 and 2587 alike, on every redeploy, with a
> correct host and a valid key. Changing provider does not help and neither does changing port,
> because nothing is wrong with the provider, the credential or the queue — the queue is retrying
> correctly and logging the real failure. Blocking outbound SMTP wholesale is a common anti-abuse
> posture on shared PaaS networks.
>
> **The escape hatch is to stop using SMTP.** Set two variables on the API service and redeploy:
>
> ```
> MAIL_TRANSPORT=resend-api
> RESEND_API_KEY=re_…
> ```
>
> Mail then goes to `https://api.resend.com/emails` over 443, which is not subject to the block.
> The `SMTP_*` variables are ignored in this mode and can be left unset. Create the key at
> <https://resend.com/api-keys>.
>
> Everything else is identical, by construction rather than by promise: `resend-api` implements the
> same `MailTransport` contract as SMTP, so the same six templates, the same three-attempt retry with
> exponential backoff, the same `List-Unsubscribe` headers and the same guarantee that a failed send
> never fails the HTTP request that triggered it all apply unchanged. The only difference is which
> socket the message leaves by. `server/tests/mail.resendTransport.test.ts` drives the real queue and
> the real templates through it to hold that true.
>
> **The DNS records in 7.2 are still required.** This changes the transport, not the sender: SPF,
> DKIM and DMARC are about the domain you send from, and Resend verifies them the same way for its
> HTTP API as for its SMTP endpoint. An unverified domain fails with `403`, not a timeout.
>
> This is not Railway-specific advice. Any host that blocks outbound SMTP has the same symptom and
> the same fix.

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

The region in the MX value varies with the region you chose. Newer Resend domains (seen in
October 2026) show two CNAMEs in place of the MX + SPF TXT pair: `send.tracker` →
`send.forge.rmta.net` and `rsend.tracker` → `rsend-<region>.forge.rmta.net`. Copy whichever set the dashboard shows. If the
domain was bought through Railway, add the records under Railway → Workspace → Domains, not at the
registrar the nameservers name. DKIM signs with `d=tracker.example.com`,
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

You do not have a domain yet, so this section is forward-looking: nothing here needs doing to get the
app running on the generated `*.up.railway.app` hostnames. Come back when you buy one.

Custom domains are supported on every Railway plan, free trial included, with certificates issued and
renewed automatically.

### 8.1 Two domains, one per service

Each service gets its own hostname, because each service is its own origin. In the Railway project,
for **each** of the two services: **Settings** → **Networking** → **Custom Domain**.

| Service | Domain to add             | Record type | Name      | Value                        |
| ------- | ------------------------- | ----------- | --------- | ---------------------------- |
| `web`   | `tracker.example.com`     | CNAME       | `tracker` | the target Railway shows you |
| `api`   | `api.tracker.example.com` | CNAME       | `api`     | the target Railway shows you |

Railway displays the exact CNAME target when you add the domain — it is per-service and per-region,
so copy it from the dashboard rather than guessing. It then shows the domain as pending until DNS
resolves.

**Apex domains need care.** A CNAME at the apex (`example.com` with no subdomain) is not valid DNS at
most registrars. Either use a subdomain for both services, as above, or use a registrar that supports
CNAME flattening / ALIAS records at the apex (Cloudflare and a few others do).

### 8.2 Certificates

Railway issues and renews certificates automatically once DNS resolves. Nothing to install, and
HTTP is redirected to HTTPS — confirm with `curl -I http://api.tracker.example.com/health` and look
for a redirect.

### 8.3 Update every origin variable, then redeploy

Domains are not live until the app agrees they are. If you used the reference variables from 4.2,
**replace them now with the literal domains** — `RAILWAY_PUBLIC_DOMAIN` keeps returning the
`*.up.railway.app` name, so leaving the references in place means CORS keeps allowlisting the old
hostname and the new one is rejected.

| Service | Variable        | New value                         |
| ------- | --------------- | --------------------------------- |
| `api`   | `CLIENT_ORIGIN` | `https://tracker.example.com`     |
| `api`   | `APP_URL`       | `https://tracker.example.com`     |
| `api`   | `API_URL`       | `https://api.tracker.example.com` |
| `web`   | `VITE_API_URL`  | `https://api.tracker.example.com` |
| `web`   | `VITE_APP_URL`  | `https://tracker.example.com`     |

Redeploy **both** services. The `VITE_*` values are compiled into the bundle at image build time, so
the client keeps calling the old API until the `web` service is rebuilt — a restart is not enough.
Then re-run the browser checks in [6.4](#64-verify-it-end-to-end-in-a-browser): changing these is
precisely what can break the cookie.

### 8.5 HSTS

Already sent. `helmet()` in `server/src/app.ts` emits:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

on every API response — one year, covering subdomains. This is the app's own header and is
platform-independent: it ships from Express, so it is identical on Railway, Render or anywhere else.
The `web` service serves static files through Caddy and does not add HSTS of its own; if you want it
on the client host too, add `header Strict-Transport-Security "max-age=31536000; includeSubDomains"`
inside the site block of the Caddyfile in [5.3](#54-the-spa-rewrite--a-dockerfile-and-a-caddyfile).

Verify once the domain is live:

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

## Step 9 — Sleeping, cold starts and keeping the API warm

**Railway's model is the opposite of Render's, and this is the single biggest behavioural difference
between the two paths.** Railway runs long-lived containers that stay up by default. There is no
forced spin-down on any plan, so out of the box there is **no cold start at all** — the trade is that
you pay for the time, and an idle container still burns credit.

Serverless sleeping is available as an **opt-in per-service setting**, not something imposed on you.
Enable it and the service sleeps after it stops sending outbound traffic, and wakes on the next
request. Two details matter before you turn it on:

- **The idle timer watches _outbound_ traffic, not inbound.** A service is considered inactive once
  it stops sending packets — and that counts telemetry, NTP and **database connections**. This API
  holds a Mongoose connection pool open, so it may well never look idle enough to sleep, and you can
  end up paying as if sleeping were off. Cron is another wakeful path: `ENABLE_CRON=true` runs an
  hourly reminder tick. In practice a service sleeps somewhere between 5 and 10 minutes after its
  last outbound packet, if it ever gets there.
- **The first request to a slept service may return `502 Bad Gateway`,** not merely a slow `200`.
  That is worse than Render's slow-but-successful wake: a recruiter opening your link gets an error
  page rather than a pause.

So pick deliberately:

| Goal                           | Setting                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| A link that is always instant  | Leave sleeping **off**. Budget for two always-on containers — realistically the $5/month Hobby plan. |
| Stretch a small credit balance | Turn sleeping **on** for both services, and accept a possible 502 on the first hit after idle.       |

Whichever you choose:

1. **Point an uptime monitor at `/health` every 5 minutes** ([Step 10](#step-10--uptime-errors-and-backups)).
   With sleeping off it is pure availability alerting; with sleeping on it also keeps the service
   awake — though that then defeats the credit saving, so do not enable both and expect a discount.
2. **Do not point the pinger at `/ready`.** It queries Mongo on every call, and 8,640 pointless round
   trips a day against a 512 MB shared Atlas cluster is a poor use of it. `/health` is a liveness
   probe by design and touches nothing.
3. **The client suffers the same way.** Unlike the Vercel path, where the client is static files on a
   CDN and never sleeps, here the `web` service is a container too. If you enable sleeping, enable it
   knowing the landing page itself can 502 on a cold hit. Caddy serving static files is cheap, so
   leaving the `web` service always-on is the easier call.
4. **The UI degrades gracefully either way.** The client renders skeletons rather than a blank screen,
   so a slow API reads as slow rather than broken.

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
2. On the `api` service: `SENTRY_DSN=https://…`. Leave `SENTRY_TRACES_SAMPLE_RATE` at `0` — traces are billed per
   event and errors are the point.
3. On the `web` service: `VITE_SENTRY_DSN=https://…`. The client SDK sits behind a dynamic import, so an unset DSN
   costs the landing bundle nothing.
4. Only 5xx responses are reported. Request headers, cookies and bodies are stripped before an event
   is sent and the user is reduced to an id, so no PII leaves the process.
5. **Source maps.** For readable stack traces, upload the maps to Sentry _between_ the build and the
   strip. In the Dockerfile from 5.3, replace the single `RUN npm run build:deploy -w client` with:

   ```bash
   npm run build -w client && npx --yes @sentry/cli sourcemaps upload --release "$VERCEL_GIT_COMMIT_SHA" client/dist && node client/scripts/stripSourcemaps.mjs
   ```

   with `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` passed in as build args. Sentry
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

Run it with `railway run npm run stats -w server` against the live database. There is no admin web UI by design: no extra
authentication surface, no route, no role model.

#### Sweeping orphaned uploads (one-off, issue #42)

Deletions before the #34 fix removed records but left their files in the bucket. `storage:sweep`
finds them: keys under `attachments/` that no application references, that match the generated
`attachments/<user>/<application>/<uuid>.<ext>` shape, and that are more than 24 hours old.

```bash
railway run npm run storage:sweep -w server                                   # dry run: counts, bytes, keys by user
railway run npm run storage:sweep -w server -- --apply --expect <N>           # deletes exactly the N orphans the dry run listed
```

It is a dry run unless given `--apply`, and `--apply` refuses, deleting nothing, when:

- `--expect` is missing, or does not match the orphan count found at that moment;
- the database has no applications, which is what a wrong `MONGO_URI` looks like;
- orphans are more than half of every listed file, unless `--allow-majority` is also passed.

Keys it does not recognise are listed and never deleted. The R2 token from step 2 (Object Read &
Write) already allows listing. On Windows, if `railway run` fails with `querySrv ECONNREFUSED`, run it
from `railway shell` with the standard connection string, as for the seed in step 11.

---

## Step 11 — Seed the demo account

The landing page's **Try the demo** button signs a visitor into a sandboxed account, and it needs
that account to exist. Run it through the Railway CLI so it uses the deployed variables — the
`railway run` prefix is what points it at Atlas rather than the `MONGO_URI` in your local
`server/.env`, exactly as the migration step in 4.4 does:

```bash
railway link                          # once: pick the project, then the api service
railway run npm run seed -w server
```

The API also checks for the account every time it boots and logs
`No demo account on this deployment: POST /auth/demo answers 404 until it is seeded` at `warn`
until this step has been done, so a skipped seed shows up in the deploy log rather than as a
visitor's error toast.

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

## Step 12 — Optional: "Continue with Google"

Skip this step and nothing changes: with no Google client configured, the API leaves every other
sign-in flow exactly as it was and the client shows no Google button.

### 12.1 Create the OAuth client

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project (or pick one).
2. **APIs & Services → OAuth consent screen**: user type **External**, app name, support email,
   and the app's home, privacy (`/privacy`) and terms (`/terms`) URLs. Scopes: `openid`, `email`,
   `profile` only. These are non-sensitive, so no Google review is needed. While the app is in
   **Testing**, only the test users you list can sign in; **Publish** it to open it to everyone.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web
   application**:
   - **Authorized JavaScript origins:** none are needed. The browser never calls Google from the
     client; it is redirected there by the API.
   - **Authorized redirect URIs:** the API's callback, exactly, one per environment:
     `https://<api>/api/v1/auth/google/callback`, and `http://localhost:5000/api/v1/auth/google/callback`
     for local development. Google rejects any callback not listed here, character for character.
4. Copy the client ID and client secret.

### 12.2 Set the variables

- **API service:** `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Set both or neither: the env
  loader refuses to boot with one. `API_URL` must be the public API origin, because the callback
  URL sent to Google is built from it.
- **Client service:** `VITE_GOOGLE_AUTH_ENABLED=true`, then redeploy the client, because Vite
  inlines it at build time.

### 12.3 How it behaves

- The callback sets the same refresh cookie as a password sign-in and redirects to `/dashboard`,
  whose cold-start refresh opens the session. No token is ever put in a URL.
- An existing account is linked by email only when Google and this app have both verified the
  address. Otherwise the visitor is sent back with a message, never signed in.
- Only the register page, after the terms box is ticked, can create an account. The sign-in page
  answers an unknown Google address with "Create one first".
- An account created through Google has a random password nobody knows. "Forgot password" sets a
  real one, after which both ways of signing in work.

### 12.4 Verify

Sign up with Google from `/register` with a test user, sign out, then sign in with Google from
`/login`. Both should land on the dashboard. Cancelling at Google's account picker should land back
on `/login` with "Google sign-in was cancelled."

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
| `TRUST_PROXY`          | `1`                                                | One hop on Railway's edge. See 6.3.                                                                               |
| `STORAGE_DRIVER`       | `s3`                                               | `local` is refused in production.                                                                                 |
| `S3_ENDPOINT`          | `https://<account>.r2.cloudflarestorage.com`       | Omit for AWS S3.                                                                                                  |
| `S3_REGION`            | `auto`                                             | `auto` for R2; the real region for AWS.                                                                           |
| `S3_BUCKET`            | `internship-tracker-uploads`                       |                                                                                                                   |
| `S3_ACCESS_KEY_ID`     | …                                                  | Secret.                                                                                                           |
| `S3_SECRET_ACCESS_KEY` | …                                                  | Secret.                                                                                                           |

### Recommended

| Variable                      | Example                                             | Notes                                                                                                  |
| ----------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `MAIL_FROM`                   | `Internship Tracker <no-reply@tracker.example.com>` | Real display name, domain you control. See 7.1.                                                        |
| `MAIL_TRANSPORT`              | `smtp`                                              | Or `resend-api` where outbound SMTP is blocked. Refuses to boot without the credential its mode needs. |
| `SMTP_HOST`                   | `smtp.resend.com`                                   |                                                                                                        |
| `SMTP_PORT`                   | `587`                                               | 465 for implicit TLS.                                                                                  |
| `SMTP_USER`                   | `resend`                                            |                                                                                                        |
| `SMTP_PASS`                   | …                                                   | Secret — the provider API key.                                                                         |
| `RESEND_API_KEY`              | `re_…`                                              | Secret. Required when `MAIL_TRANSPORT=resend-api`; unused otherwise.                                   |
| `LOG_LEVEL`                   | `info`                                              | `debug` is noisy and can be expensive on a log quota.                                                  |
| `ENABLE_CRON`                 | `true`                                              | Reminder digests, weekly summaries, purge and demo reset.                                              |
| `MONGOMS_DISABLE_POSTINSTALL` | `1`                                                 | Build-time only. See 4.2.                                                                              |

### Optional

| Variable                       | Default                          | Notes                                                                 |
| ------------------------------ | -------------------------------- | --------------------------------------------------------------------- |
| `PORT`                         | `5000`                           | **Do not set on Railway** — it injects one.                           |
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
| `GOOGLE_CLIENT_ID` / `_SECRET` | unset                            | Both or neither. Enables "Continue with Google". See Step 12.         |

### Client (`web` service) — build-time

| Variable                   | Example                           | Notes                                  |
| -------------------------- | --------------------------------- | -------------------------------------- |
| `VITE_API_URL`             | `https://api.tracker.example.com` | No trailing slash.                     |
| `VITE_APP_URL`             | `https://tracker.example.com`     | Canonical URLs, sitemap, OG tags.      |
| `VITE_DEMO_ENABLED`        | `true`                            | Cosmetic; the API is the enforcement.  |
| `VITE_GOOGLE_AUTH_ENABLED` | `false`                           | Shows "Continue with Google". Step 12. |
| `VITE_SENTRY_DSN`          | unset                             | Behind a dynamic import when unset.    |

> Never put a secret in a `VITE_*` variable. Every one of them is compiled into JavaScript that
> anyone can read.

---

## Automated deploys

`.github/workflows/deploy.yml` waits for the full CI suite to pass and only then deploys. **It is
disabled by default** and does nothing at all until you opt in, so a fork or a clone cannot
accidentally deploy to anything.

**Railway has no URL deploy hook.** Render and Vercel both hand you a secret URL you `POST` to;
Railway does not work that way. The workflow calls Railway's public GraphQL API with a **project
token** and asks for each service to be deployed **at the exact commit CI just passed**
(`serviceInstanceDeployV2` with `commitSha`). Railway builds that commit from the service's
connected GitHub repo. That is the one substantive change from the Render/Vercel version of this
workflow — the CI gate, the `DEPLOY_ENABLED` switch and the green-skip resting state are all
unchanged.

It does not use `railway redeploy`. That command rebuilds a service's _latest deployment_, commit
and all, so if Railway's GitHub trigger ever stops picking up pushes, a green run would quietly
rebuild the old commit.

To enable it, add these repository secrets under **Settings → Secrets and variables → Actions**:

| Secret                | Where it comes from                                                          |
| --------------------- | ---------------------------------------------------------------------------- |
| `DEPLOY_ENABLED`      | Set it to `true`. Absent or anything else and the job skips.                 |
| `RAILWAY_TOKEN`       | Railway → project → **Settings → Tokens** → create a **project token**       |
| `RAILWAY_API_SERVICE` | The `api` service's name or id — not secret, but kept alongside for tidiness |
| `RAILWAY_WEB_SERVICE` | The `web` service's name or id                                               |

A **project token** is scoped to one project and one environment, which is what you want here: it
cannot touch anything else in your account. Do not use a personal account token.

With `DEPLOY_ENABLED` unset the workflow still runs and reports a green skip, which is the intended
resting state: CI keeps guarding `main` and nothing deploys.

**Railway's own push trigger must stay off while this workflow is enabled.** Railway connects a
service to GitHub in two separate parts:

- The **repo connection** (the service's source). The workflow's deploy builds from it, so keep it.
  **Do not disconnect the repo.**
- The **deployment trigger** (the branch connected to `production`, with its **Wait for CI**
  option). This is what deploys on every push. It has no on/off switch. The only way to stop push
  deploys is to delete it: service → **Settings → Source**, disconnect the branch, or call
  `deploymentTriggerDelete` in the API.

**"Wait for CI" does not stop the duplicate.** It only delays Railway's deploy until CI passes, and
that is exactly when this workflow deploys too. On PR #37 (`f95f30b`, 25 Sep 2026) the client was
built and started twice from the same commit, once by the trigger and once by the workflow. The
two builds raced, and only one survived. With the trigger deleted, the only deploy path is this
workflow. Every deploy then has a run log naming its commit and a deployment id to match in
Railway, and a failure turns the run red. The trigger failed silently on 24 Sep: two pushes were
never deployed, and nothing reported it.

After changing a service's source settings, check that no trigger has come back. Turning on Wait
for CI gave both triggers new ids, so a settings change can recreate one.

### Checking a deploy

Merged to `main` is not the same as live. `scripts/deploy-checks/watch-deploy.sh` checks a merge
end to end and only reads: it never deploys or changes a setting.

```bash
scripts/deploy-checks/watch-deploy.sh                # wait for the next merge touching client/ or server/
scripts/deploy-checks/watch-deploy.sh --since <sha>  # the first such merge after <sha>
scripts/deploy-checks/watch-deploy.sh --sha <sha>    # a merge that has already landed
```

It prints a PASS or FAIL line for each check:

1. The Deploy run for that commit logged a queued deployment for both services.
2. Each service has a Railway deployment at that commit that ended in `SUCCESS`.
3. Each service has **exactly one** deployment record at that commit, of any status, and its id is
   the one the Deploy run logged. A second record, even a `SKIPPED` one, means something other than
   this workflow is deploying. Usually that is a trigger that has come back.

A red CI makes Deploy skip itself, and the script does not take that as the result. It says so and
keeps watching the same commit, because re-running CI starts a new Deploy run. It waits up to
`RERUN_WAIT_MINUTES` (default 360) for that re-run. Set `RERUN_WAIT_MINUTES=0` to report the skip at
once. `bash scripts/deploy-checks/test-watch-deploy.sh` replays the skip-then-re-run sequence with
stubbed `gh` and `railway`.

Each `gh` call is retried once after 10 seconds (`GH_RETRY_SECONDS`). If it fails again, the field
reads `unknown (gh failed twice: <error>)` instead of being blank, so a dropped connection never looks
like a real result. The Deploy log is what check 1 and check 3 compare against, so a log that cannot
be read is a check 1 ERROR, and the run ends in FAILED. While waiting for the Deploy run, a lookup
that fails twice prints a `Deploy run list: unknown (...)` line and keeps polling. If the wait runs
out while the lookups are still failing, that is a check 1 ERROR too, not "no completed Deploy run".

It ends by printing each service's deployment triggers, which should be empty. It needs `gh` and the
Railway CLI, both logged in (`railway whoami` refreshes an expired session). The trigger check uses
`scripts/deploy-checks/railway-query.mjs`, which calls Railway's GraphQL API with the CLI's login.
The CLI cannot list triggers itself. The script defaults to this project's production ids. Set
`RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID`, `RAILWAY_CLIENT_SERVICE_ID` and
`RAILWAY_SERVER_SERVICE_ID` to point it at another project.

---

## Pre-launch checklist

Walk this immediately before announcing the URL. Every line is something that has silently broken a
launch.

**Secrets**

- [ ] `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` generated fresh with `openssl rand -base64 48`,
      different from each other, and never used in development.
- [ ] The Atlas database password is unique to this deployment.
- [ ] No `.env` file is committed. `scripts/scan-secrets.sh` runs gitleaks across the whole history.
- [ ] `NODE_ENV=production` on the `api` service. Confirm it in the boot log, not just the dashboard.
- [ ] Every variable is on the **right service**: `CLIENT_ORIGIN`/`APP_URL`/`API_URL` on `api`,
      `VITE_*` on `web`. Railway scopes variables per service and a misplaced one is simply ignored.

**The deployment**

- [ ] `GET /health` → 200 and `GET /ready` → 200 on the live API.
- [ ] `npm run migrate -w server` has been run against the production database.
- [ ] `railway run npm run seed -w server` has been run, and the api boot log says `Demo account ready`
      rather than `No demo account on this deployment`. (Step 11.)
- [ ] Opening `https://tracker.example.com/applications` **directly** and reloading it returns the
      app, not a 404 — the Caddy `try_files` fallback. (Step 5.4.)
- [ ] Source maps are not published: `curl -I https://tracker.example.com/assets/index-*.js.map`
      returns 404, and no `sourceMappingURL` comment appears in the served JavaScript.
- [ ] HSTS present: `curl -sI https://api.tracker.example.com/health | grep -i strict-transport`.

**Cross-origin — the part that fails silently**

- [ ] `CLIENT_ORIGIN`, `APP_URL`, `API_URL`, `VITE_API_URL` and `VITE_APP_URL` all name the real
      deployed origins, with no trailing slashes.
- [ ] **`VITE_APP_URL` is set on the `web` service _before_ you attach a custom domain, and the
      service is redeployed afterwards.** This one has a failure mode worth spelling out. Vite
      refuses any request whose `Host` header is not in `allowedHosts`, and this app builds that
      list in `client/allowedHosts.ts` from two things: a `.up.railway.app` suffix, and the hostname
      parsed out of `VITE_APP_URL`. A custom domain is not covered by the suffix, so if you attach
      `tracker.example.com` while `VITE_APP_URL` is unset or still points at the old
      `*.up.railway.app` name, **the new domain serves `403 Blocked request` for every request** —
      the Railway URL keeps working, which makes it look like a DNS problem rather than a
      configuration one. `VITE_*` values are compiled into the bundle at image build time, so
      changing it needs a **redeploy**; a restart will not pick it up. `ALLOWED_HOSTS`
      (comma-separated) is available if you need to serve two domains at once during a migration.
- [x] The `refresh_token` cookie shows `SameSite=None`, `Secure`, `HttpOnly`, `Path=/api/v1/auth`.
- [x] Signing in and **hard-reloading** leaves you signed in.
- [x] Export CSV → All fields saves as `applications-YYYY-MM-DD.csv`, not `applications.csv`.

**Email**

- [x] SPF, DKIM and DMARC resolve for the sending domain and the provider dashboard shows Verified.
- [x] `MAIL_FROM` uses a domain you control, with a real display name.
- [ ] A verification email **reached the Inbox** of a real Gmail, Outlook and Yahoo address, with
      `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS` under Gmail's Show original.
- [ ] The verification link in that email works against the deployed client.
- [ ] The unsubscribe link in a reminder digest works.

**Data and operations**

- [ ] `npm run seed -w server` has run; "Try the demo" signs in and every dashboard chart has data.
- [ ] An uploaded attachment survives a redeploy — proof that `STORAGE_DRIVER=s3` is really in
      effect.
- [x] The uptime monitor is live on `/health` at 5-minute intervals and has sent a test alert.
- [x] If Sentry is enabled, a deliberately triggered 500 has appeared in the issue stream.
- [x] `scripts/backup.sh` has been run once **and a restore from that archive has been tested**.
- [x] `CONTACT_EMAIL` in `client/src/lib/siteMeta.ts` is a real address — the `{{CONTACT_EMAIL}}`
      placeholder must not be live on Terms, Privacy, the footer or `SECURITY.md`.

---

## Alternatives: Render + Vercel instead of Railway

Splitting the two halves across two platforms costs you a second dashboard and a second bill, but
buys a genuinely free tier for the API and a CDN-hosted client that never sleeps and never costs
anything. Everything in Steps 1, 2, 3, 6 and 7 applies unchanged — **including the whole of Step 6**,
since a Vercel client calling a Render API is cross-origin in exactly the same way two Railway
services are.

What differs:

### The API on Render

| Setting           | Value                                                     |
| ----------------- | --------------------------------------------------------- |
| Root Directory    | blank — the repo root, same shared-monorepo reason as 4.0 |
| Build Command     | `npm ci --include=dev && npm run build -w server`         |
| Start Command     | `npm run start -w server`                                 |
| Health Check Path | `/health`                                                 |
| `TRUST_PROXY`     | `1` — still one hop                                       |

Render's free web services **spin down after about 15 minutes idle**, and the next request pays a
30–60 second wake. That is forced, not opt-in, unlike Railway. The free plan also allows 750
instance-hours a month across all free services, so a `/health` ping every 5 minutes can keep exactly
one service warm.

### The client on Vercel

| Setting          | Value                            |
| ---------------- | -------------------------------- |
| Framework Preset | Vite                             |
| Root Directory   | the repo root                    |
| Install Command  | `npm ci`                         |
| Build Command    | `npm run build:deploy -w client` |
| Output Directory | `client/dist`                    |

No Dockerfile and no Caddyfile: Vercel hosts the static output directly, and the SPA fallback is
three lines in `client/vercel.json` instead of a `try_files` directive:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

Netlify is equivalent, with `client/public/_redirects` — Vite copies it into `dist` verbatim:

```
/*    /index.html   200
```

### The deploy workflow

Render and Vercel both expose a **deploy hook URL** you `POST` to, so `deploy.yml` would use two
`curl` calls against `RENDER_DEPLOY_HOOK_URL` and `VERCEL_DEPLOY_HOOK_URL` instead of the Railway
CLI. The `DEPLOY_ENABLED` gate is identical either way; see the comments in the workflow file.

---

## Troubleshooting

**Every API call fails with a CORS error in the browser console.**
`CLIENT_ORIGIN` does not exactly match the origin the browser is on. Compare them character by
character — a trailing slash, `http` vs `https`, or a missing `www.` is enough. Then redeploy the
API; the value is read at boot.

**Login works, but a page refresh logs the user out.**
The refresh cookie is not reaching the API. Check that `API_URL` on the `api` service is its real origin
(that is what 6.2 keys on), that the cookie shows `SameSite=None; Secure`, and that `TRUST_PROXY=1`.
Walk [6.4](#64-verify-it-end-to-end-in-a-browser).

**Exports download as `applications.csv` instead of the dated name.**
`Access-Control-Expose-Headers` is not reaching the browser. It is set in `app.ts`; if the deployed
response lacks it, something in front of the API is stripping it.

**Refreshing a deep link 404s.**
The Caddy `try_files` fallback is missing, or Railpack built the service instead of the Dockerfile. Steps 5.2 and 5.4.

**The build fails with `tsc: not found` or `Cannot find module 'tsc-alias'`.**
`NODE_ENV=production` made npm skip devDependencies. Use `npm ci --include=dev` in the build command.

**The build fails resolving a workspace dependency, or installs the wrong package.**
Root Directory is set to `server/` or `client/`. This is a shared monorepo with one root lockfile;
leave Root Directory at `/` and select the workspace with `-w`. See 4.0.

**The client is served but every asset 404s, or you get a Caddy welcome page.**
The `root * client/dist` path in the Caddyfile does not match where the build stage copied the output.
Check the `COPY --from=build` line in the Dockerfile and the `root` directive agree. See 5.3.

**The API boots, then exits.**
Read the log. The env loader prints every invalid variable at once with the reason. The usual causes
are a short JWT secret, both secrets identical, `STORAGE_DRIVER=local`, or an origin still pointing
at localhost.

**`/health` is 200 but `/ready` is 503.**
The process is alive and Mongo is not reachable. Check the Atlas IP allowlist (Step 1.3), then that
the password in `MONGO_URI` is URL-encoded.

**The first request after a quiet period takes a minute.**
The service slept. [Step 9](#step-9--sleeping-cold-starts-and-keeping-the-api-warm).

**Emails send successfully but never arrive.**
Check the provider's own activity log first — it will show delivered, bounced or dropped. If it says
delivered, this is spam placement: work [Step 7.2](#72-the-dns-records) and confirm DMARC alignment
via Gmail's Show original.
