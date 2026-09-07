# Security Policy

## Supported versions

This project follows the latest release on `main`. Security fixes land there and
are noted in [CHANGELOG.md](CHANGELOG.md).

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |
| < 1.0   | No        |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.** A public report
tells everyone about the hole before there is a fix for it.

Report privately, by either route:

- **GitHub Security Advisories** — the "Report a vulnerability" button under the
  repository's Security tab. This is preferred: it gives us a private fork to
  develop the fix in, and credits you on the published advisory.
- **Email** — `naabel.workspace@gmail.com`.

Include whatever you have: the affected route or component, the steps or request
that trigger it, what an attacker gets out of it, and the commit or deployment
you tested against. A curl command or a failing test is worth more than a
paragraph of description.

### What to expect

| Stage                    | Target                                                                  |
| ------------------------ | ----------------------------------------------------------------------- |
| Acknowledgement          | 3 working days                                                          |
| Initial assessment       | 7 working days                                                          |
| Fix for a critical issue | 30 days, sooner where practical                                         |
| Public advisory          | After the fix ships, with credit unless you would rather stay anonymous |

This is a personal project, not a funded product: there is no bug bounty, and
those targets are commitments of effort rather than a contractual SLA.

## Scope

In scope, on any deployment of this code:

- Authentication and session handling — JWT issuing, refresh-token rotation and
  reuse detection, account lockout, password reset and email verification tokens.
- Authorisation — anything that lets one account read or change another's data.
  Every service function scopes its query by `userId`; a way around that is the
  most serious class of bug this project can have.
- Injection — NoSQL/query injection, XSS in rendered markdown or user-supplied
  notes, CSV formula injection in exports.
- Upload handling — type confusion, EXIF or path traversal, resource exhaustion.
- Anything that discloses one user's email address to another, including a
  timing or response-shape difference on the forgot-password route.

Out of scope:

- Findings against the seeded **demo account**, which is public by design and
  reset nightly.
- Missing hardening headers with no demonstrated impact, output from an
  automated scanner with no working proof, and denial of service by brute
  traffic volume.
- Social engineering, physical access, and vulnerabilities in third-party
  services (MongoDB Atlas, the mail provider, the host) — report those to them.

## Handling of your report

Reports are read only by the maintainer. If your report includes another
person's data, say so and do not attach it; describe how to reproduce instead.

## Security posture of this project

For reviewers, what is already in place: bcrypt password hashing, rotating
refresh tokens with reuse detection, per-user query scoping enforced at the
service layer, zod validation at every route boundary, Helmet, CORS pinned to a
configured origin, a global rate limit with stricter limits on upload and export,
EXIF stripping on uploaded images, non-guessable storage keys served
`Content-Disposition: attachment`, and secret redaction in the logger. See
[DECISIONS.md](DECISIONS.md) for why each of those is shaped the way it is.
