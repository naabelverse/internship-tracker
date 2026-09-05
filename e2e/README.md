# End-to-end tests

SPEC section 10's eight flows, plus the accessibility and responsive audits, run
with Playwright against a real stack.

## Running them

```bash
npm run e2e:up      # build and start the isolated compose stack
npm run test:e2e    # run the suite
npm run e2e:down    # stop it and drop its volume
```

`npm run e2e:logs` tails the API container, which is where the console mail
transport prints verification and reset links.

## Why a separate stack

The suite runs against its own compose project on shifted ports — **5174** for
the client, **5001** for the API, **27018** for Mongo — so it never fights a
development stack for ports, container names or volumes. `docker-compose.e2e.yml`
carries those overrides; the `!override` tags on `ports` are load-bearing,
because Compose _appends_ port lists when it merges files.

Two settings in that override are worth knowing about:

- **`MAIL_TRANSPORT=console`.** Flows 1 and 5 need a real single-use token.
  The console transport prints the rendered message body, links included, and
  `support/mailLog.ts` reads the token back out of `docker compose logs api`.
  No test-only endpoint was added to the server: a route that hands out
  verification tokens would be a genuine hole kept alive by a test.
- **`TRUST_PROXY=1`.** Every limiter the API mounts keys on `req.ip`, and all
  the suite's traffic leaves one machine. Trusting one proxy hop lets each test
  present its own synthetic `X-Forwarded-For` address, so the limiters stay
  fully enforced but are enforced per synthetic client rather than collapsing
  the whole suite onto one bucket. `support/network.ts` explains the scheme,
  including why the run octet is randomised — without it the second consecutive
  run would inherit the first's counters, and the bar here is three clean runs
  in a row.

## Layout

| Path                      | What it holds                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `flows/01…08`             | The eight SPEC section 10 flows, one file each                                             |
| `audits/axe.spec.ts`      | `@axe-core/playwright` over landing, login, dashboard, board and the create modal          |
| `audits/overflow.spec.ts` | Every route at 375 / 768 / 1440 px, asserting the document does not scroll sideways        |
| `support/`                | API helpers, the mail-log reader, the client-address fixture, the overflow instrumentation |

## Conventions

- **No retries.** `retries: 0` in `playwright.config.ts` is deliberate: a retry
  hides exactly the intermittency this suite exists to catch. The bar is three
  clean consecutive runs.
- **Unique accounts.** Every test registers its own `@example.com` account, so a
  second run against the same database cannot collide with the first.
- **Assert the settled outcome, not the instant.** Several surfaces here are
  controlled inputs whose state round-trips through the URL. Prefer
  `click()` plus a retrying `expect`, not `check()`, which reads the DOM
  property synchronously and can sample mid-render. `flows/04` explains it.
