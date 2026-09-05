# Contributing

Thanks for taking a look. This is a portfolio project built to a written
specification, so contributions are welcome but the bar is "does it hold up
under the same rules the rest of the code was written to".

Before anything else, read [`CLAUDE.md`](CLAUDE.md). It is the working agreement
for this repository — conventions, hard rules, and the verification gate — and
it applies to human contributors and agents alike. [`SPEC.md`](SPEC.md) is the
source of truth for scope, and [`DECISIONS.md`](DECISIONS.md) records why things
are the way they are. If something looks wrong, check `DECISIONS.md` first;
there is a decent chance it was deliberate and the reasoning is written down.

## Getting set up

Requirements: Node 20+, npm 10+, and Docker (optional, but it is the fastest
path to a working MongoDB).

```bash
git clone https://github.com/naabelverse/internship-tracker.git
cd internship-tracker
npm install

cp server/.env.example server/.env
cp client/.env.example client/.env

docker compose up -d mongo     # or point MONGO_URI at your own instance
npm run migrate
npm run seed                   # demo account with realistic data
npm run dev                    # API on :5000, client on :5173
```

Sign in with the demo credentials printed by `npm run seed`.

## The verification gate

**`npm run verify` must pass, with zero errors and zero warnings, before you
open a pull request.** It runs lint, typecheck, the unit and integration suites,
the production build, and the bundle-budget check, in that order.

```bash
npm run verify
```

Other scripts worth knowing:

| Script                  | What it does                                 |
| ----------------------- | -------------------------------------------- |
| `npm run dev`           | Server and client together                   |
| `npm test`              | Unit + integration, both workspaces          |
| `npm run test:coverage` | Server coverage; the thresholds are enforced |
| `npm run test:e2e`      | Playwright against the compose stack         |
| `npm run seed:reset`    | Wipe and reseed the demo data                |
| `npm run migrate`       | Apply pending migrations                     |

`npm run test:e2e` needs the stack running. See [`e2e/README.md`](e2e/README.md).

## Conventions that will be checked in review

These are the ones people trip over. The full list is in `CLAUDE.md`.

**Everywhere**

- TypeScript strict. No `any` without a comment saying why.
- No `TODO`, `FIXME`, commented-out code, stubbed functions, or `console.log` in
  committed source. Use the logger.
- Every file you add must be imported and used by something.
- If a file passes ~250 lines, consider splitting it.

**Backend**

- Controllers parse input, call a service, shape the response. Business logic
  lives in `services/`.
- **Every service function that touches user data takes `userId` first and
  scopes its query by it.** There are no exceptions to this one; it is the
  boundary the whole authorisation model rests on.
- Validate every body, query and param with zod at the route boundary.
- Throw `ApiError` with a status and a stable `code`. Never invent an error shape.
- Wrap async handlers in `asyncHandler`.
- Timestamps are stored in UTC. User-facing date maths goes through
  `utils/dates` with the user's timezone.

**Frontend**

- Server state goes through TanStack Query. Never park fetched data in
  `useState`.
- Query keys live in `api/queryKeys.ts`.
- Forms use `react-hook-form` with a zod resolver.
- Colours, spacing and radii come from Tailwind theme tokens. No hardcoded hex
  in components.
- Every async surface has a loading, empty and error state. Every mutation
  toasts on success and on failure.
- Icon-only buttons need an `aria-label`. Modals trap focus and close on Escape.

**Tests**

- A bug fix ships with a regression test in the same commit.
- Use the factories in `tests/utils`, not copy-pasted fixture literals.
- **Never weaken or delete a test to make a build pass.** If a test is wrong,
  fix it deliberately and say so in the pull request.

## Commits and pull requests

Conventional commits: `feat:`, `fix:`, `chore:`, `test:`, `docs:`, `refactor:`,
`perf:`, `ci:`. Keep the subject in the imperative and under ~72 characters.

```
fix(board): keep the conflict dialog alive across a remount
```

Open the pull request against `main` and fill in the template. Explain what
changed and why; if you made a judgement call, add it to `DECISIONS.md` in the
same pull request. Screenshots or a short clip help a lot for UI work — at 375 px
as well as desktop, in both themes.

CI runs the same `npm run verify` plus the Playwright suite. A red run blocks the
merge.

## Reporting bugs and asking for features

Use the issue templates. For a bug, the reproduction steps and what you expected
instead are the two fields that decide whether it can be fixed.

**Security problems do not go in the issue tracker.** Follow
[`SECURITY.md`](SECURITY.md).

## Code of conduct

Participation is governed by the [Contributor Covenant](CODE_OF_CONDUCT.md).

## Licence

By contributing you agree that your contributions are licensed under the
[MIT Licence](LICENSE) that covers this project.
