# CLAUDE.md

Instructions for any Claude Code session working in this repository.

## Start of every session

1. Read `PROGRESS.md`. Find the first phase that is not fully checked off.
2. Read the corresponding phase in `SPEC.md` (Section 16), plus any spec sections it references.
3. Run `npm run verify` (lint + typecheck + test + build). If it fails, fixing that comes before any new work.
4. State which phase you are resuming and what you intend to do, then start.

Do not start a later phase while an earlier one is incomplete. Do not re-implement work that `PROGRESS.md` marks done — read the existing code first.

## End of every phase

1. `npm run verify` passes with zero errors and zero warnings.
2. Tick the phase's items in `PROGRESS.md` and add a one-line note on anything deferred or changed.
3. Append any assumption you made to `DECISIONS.md` with a one-sentence reason.
4. Commit with a conventional-commit message (`feat:`, `fix:`, `chore:`, `test:`, `docs:`).
5. Print a short summary: what changed, what the next phase is, anything I need to do manually (create an account, add a DNS record, set an env var).

## Authority

`SPEC.md` is the source of truth for scope and requirements. If a spec requirement turns out to be wrong, impossible, or a bad idea once you are in the code, do not silently ignore it — implement the closest sensible alternative, record it in `DECISIONS.md`, and say so in your summary.

## Conventions

**General**
- TypeScript strict everywhere. No `any` without a comment explaining why.
- No `TODO`, `FIXME`, stubbed functions, commented-out code, or `console.log` in committed source. Use the logger.
- Every file you create must be imported and used by something.
- Small modules. If a file passes ~250 lines, consider splitting it.
- JSDoc on anything whose purpose is not obvious from the signature.

**Backend**
- Controllers stay thin: parse and validate input, call a service, shape the response. All business logic lives in `services/`.
- Every service function that touches user data takes `userId` as its first argument and scopes the query by it. No exceptions.
- Validate every request body, query, and param with zod at the route boundary.
- Throw `ApiError` with a status and a stable `code`; never send an ad-hoc error shape.
- Wrap async handlers in `asyncHandler` — no bare try/catch in routes.
- All responses use the `{ success, data, message?, meta? }` envelope.
- Timestamps are stored in UTC. Any user-facing date computation goes through `utils/dates` with the user's timezone.

**Frontend**
- All server state goes through TanStack Query. Never keep fetched data in `useState`.
- Query keys live in `api/queryKeys.ts` — no inline key arrays.
- Every form uses `react-hook-form` with a zod resolver.
- Colors, spacing, and radii come from Tailwind theme tokens. No hardcoded hex values in components.
- Every async surface has an explicit loading (skeleton), empty, and error state.
- Every mutation shows a toast on success and on failure.
- Icon-only buttons need an `aria-label`. Modals trap focus and close on Escape.

**Testing**
- A bug fix gets a regression test in the same commit.
- Tests use factories, not copy-pasted fixture literals.
- Never weaken or delete a test to make a build pass. If a test is wrong, fix the test deliberately and say so.

## Commands

```
npm run dev          # server + client concurrently
npm run verify       # lint + typecheck + test + build  (must pass before any commit)
npm run test         # unit + integration
npm run test:e2e     # Playwright against the compose stack
npm run seed         # demo user + realistic data
npm run seed:reset   # wipe and reseed
npm run migrate      # run pending migrations
```

## Hard rules

- Never commit a real secret, a real email address, or a `.env` file.
- Never log tokens, passwords, or password hashes.
- Never send a different response for "email exists" vs "email does not exist" on the forgot-password route.
- Never write uploads to local disk in the production code path — use the storage adapter.
- Never mark a phase complete in `PROGRESS.md` when `npm run verify` is failing.
