## What this changes

<!-- One or two sentences. What is different after this merges? -->

## Why

<!-- The problem, the issue number, or the spec section this satisfies.
     Closes #___ -->

## How

<!-- The approach, and anything a reviewer would otherwise have to reverse
     engineer. If you rejected an obvious alternative, say which and why. -->

## Verification

<!-- Paste the result, do not just tick the box. -->

- [ ] `npm run verify` passes with zero errors and zero warnings
- [ ] `npm run test:e2e` passes, or is not affected by this change
- [ ] New behaviour has tests; a bug fix has a regression test that fails
      against the old code

```
<!-- npm run verify output, or the relevant tail of it -->
```

## UI changes

<!-- Delete this section if there are none. -->

- [ ] Checked at 375 px, 768 px and 1440 px
- [ ] Checked in both light and dark themes
- [ ] Keyboard reachable; icon-only controls have an `aria-label`
- [ ] Loading, empty and error states all exist
- [ ] Mutations show a toast on success and on failure

| Before | After |
| ------ | ----- |
|        |       |

## Checklist

- [ ] Conventional commit messages (`feat:`, `fix:`, `chore:`, `test:`, `docs:`)
- [ ] No `TODO`, `FIXME`, `console.log`, commented-out code or unused files
- [ ] Every service function touching user data takes `userId` first and scopes
      its query by it
- [ ] Any judgement call is recorded in `DECISIONS.md`
- [ ] No secret, real email address or `.env` file is included
- [ ] `README.md` and `CHANGELOG.md` updated if this changes behaviour a user
      or an operator would notice

## Anything a reviewer should look at hardest

<!-- Be honest here. The part you are least sure about is the most useful
     thing you can point at. -->
