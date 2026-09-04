# Privacy Policy

**Last updated: 5 September 2026**

This policy describes exactly what Internship Tracker stores, why it stores it, and how
long it keeps it. It describes this application specifically — every field listed below is
one the software actually writes to its database.

If anything here is unclear, or you want data removed outside the routes described below,
email **{{CONTACT_EMAIL}}**.

## Who is responsible

Internship Tracker is operated by the person or organisation running this deployment,
reachable at **{{CONTACT_EMAIL}}**. The source code is public, so you can verify every
claim on this page against the code that implements it.

## What is stored, and why

### Your account

| Data                                      | Why it exists                                                                                                                                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                                      | Shown in the app, and used to address the emails we send you.                                                                                                                                        |
| Email address                             | It is how you sign in, how we send you a password reset, and where reminders go.                                                                                                                     |
| Password                                  | Stored only as a **bcrypt hash** (cost factor 12). The password itself is never written to disk or to a log, and cannot be recovered from the hash — if you forget it, it is reset, not retrieved.   |
| University, graduation year, target roles | Optional profile fields you choose to fill in. They exist to make the app yours; leaving them blank costs you nothing.                                                                               |
| Timezone                                  | Deadlines, reminder delivery, streaks and the weekly window are all calculated on your local clock rather than the server's. Without it, a deadline on the 3rd would be wrong for most of the world. |
| Theme and weekly goal                     | Interface preferences.                                                                                                                                                                               |
| Email preferences                         | Whether you want reminder emails, and whether you have opted in to the weekly summary.                                                                                                               |
| Terms acceptance timestamp                | Recorded when you register, as the record that you accepted these terms.                                                                                                                             |
| Verification and password-reset tokens    | Stored **hashed**, never in plaintext, and single-use.                                                                                                                                               |
| Failed sign-in count and lock expiry      | Used to lock an account for 15 minutes after 10 consecutive failures, which is what stops someone guessing your password.                                                                            |

### What you put into the app

Everything you record about your job search: companies, roles, application status and its
full history, salary notes, locations, links, tags, your own free-text notes, interview
records, and any deadlines or reminders you set. This is the content of the product. It is
stored so the app can show it back to you, and for nothing else.

### Files you upload

CVs, cover letters and any other attachments you add to an application. Files are stored
under a non-guessable name and served with `Content-Disposition: attachment`, so a link
cannot be guessed and a file cannot be rendered inline in your browser. Metadata (EXIF) is
stripped from uploaded images before storage.

### Sessions

For each device you sign in from, one record holding a **hashed** refresh token, the
**IP address** and the **user agent string** the sign-in came from, and the times it was
created and last used.

This is the one category collected about you rather than entered by you, so it is worth
being precise about why: it is what makes the "Signed in devices" list in Settings
meaningful. Without an IP and a device name that list would be a row of identical entries
and you could not tell which session to revoke. The same data lets the app lock an account
that is under a password-guessing attempt.

### Logs

The server writes operational logs with a request ID, the HTTP method, the path, the status
code and the response time. Tokens, passwords, password hashes and full email bodies are
explicitly excluded from logs.

## What is never collected

- **No tracking or advertising cookies.** The only cookie set is the `httpOnly` refresh
  token that keeps you signed in, scoped to the authentication path.
- **No third-party analytics by default.** If this deployment enables analytics it uses a
  cookieless provider configured through `VITE_ANALYTICS_*`, which sets no cookie and
  builds no cross-site profile. If that is switched on, it is disclosed here.
- **No advertising identifiers, no fingerprinting, no session recording.**
- **No payment data.** Nothing is charged, so no card details are ever handled.

## Your data is never sold or shared

Your data is not sold, rented, licensed, traded, or shared with advertisers, data brokers,
or anyone else — not in aggregate, not "anonymised", not ever.

The only third parties involved are the infrastructure the app runs on, which process data
solely to operate the service and never for their own purposes:

- **A database host** (MongoDB Atlas or equivalent), which stores the records above.
- **An email provider** (configured over SMTP), which is handed your email address, your
  name and the message body in order to deliver it. When no provider is configured, mail is
  printed to the server console and nothing leaves the machine.
- **Object storage** (S3-compatible) for uploaded files in production deployments.
- **The hosting platforms** serving the API and the site.

Data is disclosed otherwise only where a valid legal obligation requires it.

## How long it is kept

| Data                         | Retention                                                                                                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account and everything in it | Until you delete your account.                                                                                                                                                                                   |
| Deleted accounts             | Soft-deleted immediately and invisible at once; **permanently purged after 30 days**, including uploaded files. The window exists so an accidental deletion can be undone; after it, nothing remains to restore. |
| Session records              | Refresh tokens expire 7 days after issue. Signing out, changing your password or revoking a device removes them sooner.                                                                                          |
| Password reset tokens        | 30 minutes, and single-use.                                                                                                                                                                                      |
| Email verification tokens    | 24 hours, and single-use.                                                                                                                                                                                        |
| Server logs                  | Retained by the hosting platform under its own policy, typically days rather than months.                                                                                                                        |

## Getting your data out

**Settings → Export all my data** returns a single JSON file containing everything the
system holds about you: your profile, every application and its status history, every
interview, reminder and attachment record, and your session list. It is a complete export,
not a summary.

## Deleting your data

**Settings → Close my account** asks for your password and a typed confirmation, then
soft-deletes the account. You are signed out everywhere immediately and the account can no
longer be used to sign in. After 30 days a scheduled job permanently removes the user
record, every application, every reminder, every session and every uploaded file.

To delete your data sooner than that window allows, email **{{CONTACT_EMAIL}}**.

## Email you receive

Four messages are sent regardless of your preferences, because each one is about the
security of your account and suppressing it would be worse than sending it: address
verification, password reset, a notice that your password changed, and confirmation that
your account was closed.

Two are optional and carry a one-click unsubscribe link in every message: the deadline and
interview reminder digest, and the opt-in weekly summary. Both can also be switched off in
Settings at any time.

## Security

Passwords are hashed with bcrypt. Verification and reset tokens are stored as digests, so a
copy of the database cannot be replayed against the app. Refresh tokens are hashed, rotated
on every use, and an attempt to reuse a rotated token revokes that whole session family.
Access tokens are short-lived and held in memory rather than in browser storage. The API
rate-limits sign-in, registration and password-reset attempts, and locks an account after
repeated failures.

No system is perfectly secure. Please use a password you do not use anywhere else.

## Children

This app is intended for university students and other adults searching for internships. It
is not directed at children under 16, and accounts should not be created for them.

## Changes to this policy

Material changes will be announced by email to the address on your account before they take
effect. The date at the top of this page always reflects the current version, and the full
history is visible in the repository.

## Contact

Questions, corrections, or a request to remove your data: **{{CONTACT_EMAIL}}**.
