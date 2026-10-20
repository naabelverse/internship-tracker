import {
  AUTHENTICATED,
  COMMON_ERRORS,
  jsonBody,
  objectOf,
  ok,
  pathParam,
  queryParam,
  RATE_LIMITED,
  ref,
} from '@/docs/paths/helpers';

const TAG = ['Auth'];

const sessionData = objectOf({ user: ref('User'), accessToken: { type: 'string' } });

const registerBody = {
  type: 'object',
  required: ['name', 'email', 'password', 'acceptTerms'],
  properties: {
    name: { type: 'string', minLength: 2, maxLength: 60 },
    email: { type: 'string', format: 'email' },
    password: {
      type: 'string',
      minLength: 8,
      description:
        'At least 8 characters with an upper case letter, a lower case letter and a digit',
    },
    timezone: { type: 'string', example: 'Asia/Kuala_Lumpur' },
    acceptTerms: { type: 'boolean', enum: [true] },
    website: {
      type: 'string',
      description:
        'Honeypot. The sign-up form renders this off-screen and leaves it empty; any value rejects the request as automated.',
    },
    elapsedMs: {
      type: 'integer',
      description:
        'Milliseconds between the form mounting and submitting. Under 2500 is rejected as automated. Optional: omitting it is allowed.',
    },
  },
};

const usageCounter = {
  type: 'object',
  properties: {
    used: { type: 'integer' },
    limit: { type: 'integer' },
    remaining: { type: 'integer' },
  },
};

const sessionSummary = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    userAgent: { type: 'string' },
    ip: { type: 'string' },
    lastUsedAt: { type: 'string', format: 'date-time' },
    createdAt: { type: 'string', format: 'date-time' },
    expiresAt: { type: 'string', format: 'date-time' },
    current: { type: 'boolean', description: 'True for the device making this request' },
  },
};

export const authPaths: Record<string, unknown> = {
  '/api/v1/auth/register': {
    post: {
      tags: TAG,
      summary: 'Create an account and open a session',
      description:
        'Sets an httpOnly refresh cookie scoped to /api/v1/auth and returns a short lived access token. Limited to 5 attempts per 15 minutes, keyed on IP and on email independently.',
      requestBody: jsonBody(registerBody),
      responses: {
        ...ok('Account created', sessionData, '201'),
        '400': COMMON_ERRORS['400'],
        '409': {
          description: 'That email is already registered',
          content: { 'application/json': { schema: ref('Error') } },
        },
        ...RATE_LIMITED,
      },
    },
  },
  '/api/v1/auth/login': {
    post: {
      tags: TAG,
      summary: 'Exchange credentials for a session',
      description:
        'Ten consecutive failures lock the account for 15 minutes and return 423. An unknown email and a wrong password produce identical responses, including for a closed account. Only a correct password on a closed account is answered differently: 409 with a restore token inside the 30 day window, 410 after it. No session is created for a closed account.',
      requestBody: jsonBody({
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string' },
        },
      }),
      responses: {
        ...ok('Signed in', sessionData),
        '400': COMMON_ERRORS['400'],
        '401': COMMON_ERRORS['401'],
        '409': {
          description:
            'ACCOUNT_PENDING_DELETION: the password is correct but the account is closed. `errors` carries `purgeAt` (ISO date-time, the end of the restore window) and `restoreToken` (single use, valid for 10 minutes) for POST /auth/restore.',
          content: { 'application/json': { schema: ref('Error') } },
        },
        '410': {
          description:
            'ACCOUNT_PURGED: the password is correct but the account was closed more than 30 days ago and can no longer be restored.',
          content: { 'application/json': { schema: ref('Error') } },
        },
        '423': {
          description: 'Account temporarily locked after repeated failures',
          content: { 'application/json': { schema: ref('Error') } },
        },
        ...RATE_LIMITED,
      },
    },
  },
  '/api/v1/auth/restore': {
    post: {
      tags: TAG,
      summary: 'Restore a closed account and open a session',
      description:
        'Exchanges the restoreToken from a 409 ACCOUNT_PENDING_DELETION login for a session, exactly as a login would. Clears deletedAt, marks reminders that came due while the account was closed as sent, and mails a security notice. Sessions revoked at closure stay revoked. The token is single use; the claim checks it, its expiry and the 30 day window in one write.',
      security: [],
      requestBody: jsonBody({
        type: 'object',
        required: ['restoreToken'],
        properties: { restoreToken: { type: 'string' } },
      }),
      responses: {
        ...ok('Account restored and signed in', sessionData),
        '400': {
          description:
            'VALIDATION_ERROR, INVALID_TOKEN (unknown or already used) or TOKEN_EXPIRED (older than 10 minutes). Signing in again issues a new token.',
          content: { 'application/json': { schema: ref('Error') } },
        },
        '410': {
          description: 'ACCOUNT_PURGED: the 30 day restore window has ended',
          content: { 'application/json': { schema: ref('Error') } },
        },
        ...RATE_LIMITED,
      },
    },
  },
  '/api/v1/auth/demo': {
    post: {
      tags: TAG,
      summary: 'Sign in to the shared demo account',
      description:
        'Backs the landing page "Try the demo" button. Takes no request body, which is the security property rather than a convenience: there is no parameter that could point this at another account, the identity comes from the server DEMO_EMAIL, and the handler only ever looks the account up — it never creates one, so it cannot mint accounts or bypass registration. The session it returns is ordinary, but the account carries isDemo, so the password change, the email change and the deletion are each refused with 403 DEMO_ACCOUNT_READONLY.',
      security: [],
      responses: {
        ...ok('Signed in to the demo account', sessionData),
        '404': {
          description: 'This deployment has no seeded demo account',
          content: { 'application/json': { schema: ref('Error') } },
        },
        ...RATE_LIMITED,
      },
    },
  },
  '/api/v1/auth/google': {
    get: {
      tags: TAG,
      summary: 'Start "Continue with Google"',
      description:
        'A browser navigation, not an API call: redirects to Google with a state handle and a PKCE challenge, both kept in a short-lived httpOnly google_oauth_state cookie. When this deployment has no Google client configured, redirects to the client with ?oauth=GOOGLE_UNAVAILABLE instead.',
      security: [],
      parameters: [
        queryParam(
          'intent',
          { type: 'string', enum: ['login', 'register'], default: 'login' },
          'Only register may create an account; the register page sends it once the terms are accepted.',
        ),
        queryParam(
          'timezone',
          { type: 'string', example: 'Asia/Kuala_Lumpur' },
          'IANA timezone for an account this creates.',
        ),
      ],
      responses: {
        '302': { description: 'To Google, or back to the client when Google is unavailable' },
        '400': COMMON_ERRORS['400'],
      },
    },
  },
  '/api/v1/auth/google/callback': {
    get: {
      tags: TAG,
      summary: 'Where Google returns the browser',
      description:
        'Verifies the state handle against the cookie, exchanges the code with the PKCE verifier, then signs in by Google id, links an account by email when both Google and this app have verified it, or creates one when intent was register. On success sets the refresh cookie and redirects to /dashboard, whose cold-start refresh opens the session; no token travels in a URL. Every refusal redirects to /login or /register with ?oauth=<code>: GOOGLE_CANCELLED, GOOGLE_FAILED, GOOGLE_EMAIL_UNVERIFIED, NO_ACCOUNT, ACCOUNT_UNVERIFIED, GOOGLE_ACCOUNT_MISMATCH, ACCOUNT_CLOSED, DEMO_ACCOUNT or DISPOSABLE_EMAIL.',
      security: [],
      parameters: [
        queryParam('code', { type: 'string' }, 'Authorization code from Google.'),
        queryParam('state', { type: 'string' }, 'The state handle sent to Google.'),
        queryParam('error', { type: 'string' }, 'Set by Google, e.g. access_denied on cancel.'),
      ],
      responses: {
        '302': { description: 'To /dashboard signed in, or to /login or /register with ?oauth=' },
        ...RATE_LIMITED,
      },
    },
  },
  '/api/v1/auth/refresh': {
    post: {
      tags: TAG,
      summary: 'Rotate the refresh cookie and mint a new access token',
      description:
        'Reads the refresh cookie. Rotation is atomic: of several concurrent calls exactly one succeeds. Replaying a token that was already rotated, outside a short grace window, revokes every session in that family.',
      responses: {
        ...ok('Rotated', objectOf({ accessToken: { type: 'string' } })),
        '401': COMMON_ERRORS['401'],
      },
    },
  },
  '/api/v1/auth/logout': {
    post: {
      tags: TAG,
      summary: 'Revoke the presented refresh token and clear the cookie',
      responses: ok('Signed out', objectOf({ loggedOut: { type: 'boolean' } })),
    },
  },
  '/api/v1/auth/logout-all': {
    post: {
      tags: TAG,
      summary: 'Revoke every refresh token for the account',
      security: AUTHENTICATED,
      responses: {
        ...ok('Signed out everywhere', objectOf({ revokedSessions: { type: 'integer' } })),
        '401': COMMON_ERRORS['401'],
      },
    },
  },
  '/api/v1/auth/me': {
    get: {
      tags: TAG,
      summary: 'The signed in account',
      security: AUTHENTICATED,
      responses: {
        ...ok('The account', objectOf({ user: ref('User') })),
        '401': COMMON_ERRORS['401'],
      },
    },
    patch: {
      tags: TAG,
      summary: 'Update profile fields',
      description:
        'A new email address is accepted but not applied: it is held as a pending change and a confirmation link is sent to it, so the current address stays valid for signing in until the new one is confirmed through POST /auth/verify-email.',
      security: AUTHENTICATED,
      requestBody: jsonBody({
        type: 'object',
        properties: {
          name: { type: 'string' },
          university: { type: 'string' },
          gradYear: { type: 'integer' },
          targetRoles: { type: 'array', items: { type: 'string' } },
          weeklyGoal: { type: 'integer' },
          theme: { type: 'string', enum: ['light', 'dark', 'system'] },
          timezone: { type: 'string' },
          emailRemindersEnabled: { type: 'boolean' },
          avatarUrl: { type: 'string' },
          email: { type: 'string', format: 'email' },
        },
      }),
      responses: {
        ...ok('Updated', objectOf({ user: ref('User') })),
        '400': COMMON_ERRORS['400'],
        '401': COMMON_ERRORS['401'],
        '409': {
          description: 'That email is already registered',
          content: { 'application/json': { schema: ref('Error') } },
        },
      },
    },
    delete: {
      tags: TAG,
      summary: 'Close the account',
      description:
        'Requires the current password. The account is soft deleted: access ends immediately and every session is revoked. Signing in with the same password within 30 days offers a restore (see POST /auth/login and POST /auth/restore); after that a job permanently removes the account and its data, uploaded files included.',
      security: AUTHENTICATED,
      requestBody: jsonBody({
        type: 'object',
        required: ['password'],
        properties: { password: { type: 'string' } },
      }),
      responses: {
        ...ok(
          'The account is closed',
          objectOf({
            deleted: { type: 'boolean' },
            purgeAt: {
              type: 'string',
              format: 'date-time',
              description: 'The end of the restore window',
            },
          }),
        ),
        '400': COMMON_ERRORS['400'],
        '401': COMMON_ERRORS['401'],
      },
    },
  },
  '/api/v1/auth/me/export': {
    get: {
      tags: TAG,
      summary: 'Download everything stored about this account',
      description:
        'A single JSON file containing the profile, every application with its embedded interviews, status history and attachment records, every reminder, and the metadata of every session. Password and token hashes are excluded: they are credentials, not user data. Attachment bytes are not inlined - the records point at files downloaded through their own signed URLs. Limited to 5 requests an hour per account.',
      security: AUTHENTICATED,
      responses: {
        '200': {
          description: 'The export, sent as a file download rather than in the envelope',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  meta: objectOf({
                    application: { type: 'string' },
                    version: { type: 'string' },
                    exportedAt: { type: 'string', format: 'date-time' },
                    counts: { type: 'object', additionalProperties: { type: 'integer' } },
                    notes: { type: 'array', items: { type: 'string' } },
                  }),
                  profile: ref('User'),
                  applications: { type: 'array', items: ref('Application') },
                  reminders: { type: 'array', items: ref('Reminder') },
                  sessions: { type: 'array', items: sessionSummary },
                },
              },
            },
          },
        },
        '401': COMMON_ERRORS['401'],
        ...RATE_LIMITED,
      },
    },
  },
  '/api/v1/auth/me/usage': {
    get: {
      tags: TAG,
      summary: 'Report this account against its resource limits',
      description:
        'SPEC section 12 caps an account at 2000 applications, 100 MB of uploads in total and 20 attachments on any one application. Breaching a cap answers 403 on the write that would have crossed it; this endpoint is what Settings renders so it never comes as a surprise.',
      security: AUTHENTICATED,
      responses: {
        ...ok(
          'Current usage and the ceilings it is measured against',
          objectOf({
            applications: usageCounter,
            storageBytes: usageCounter,
            attachmentsPerApplication: objectOf({ limit: { type: 'integer' } }),
          }),
        ),
        '401': COMMON_ERRORS['401'],
      },
    },
  },
  '/api/v1/auth/me/password': {
    patch: {
      tags: TAG,
      summary: 'Change the password',
      description:
        'Requires the current password. Every refresh token is revoked and a fresh session is issued to the caller, so other devices are signed out.',
      security: AUTHENTICATED,
      requestBody: jsonBody({
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string' },
          newPassword: { type: 'string', minLength: 8 },
        },
      }),
      responses: {
        ...ok('Password changed', sessionData),
        '400': COMMON_ERRORS['400'],
        '401': COMMON_ERRORS['401'],
      },
    },
  },
};

export const accountLifecyclePaths: Record<string, unknown> = {
  '/api/v1/auth/verify-email': {
    post: {
      tags: TAG,
      summary: 'Confirm an email address',
      description:
        'Consumes a single use token that expires 24 hours after it was issued. When the account has a pending address change, this is what promotes it to the live address.',
      security: [],
      requestBody: jsonBody({
        type: 'object',
        required: ['token'],
        properties: { token: { type: 'string' } },
      }),
      responses: {
        ...ok('Email address confirmed', objectOf({ user: ref('User') })),
        '400': COMMON_ERRORS['400'],
      },
    },
  },
  '/api/v1/auth/resend-verification': {
    post: {
      tags: TAG,
      summary: 'Send a new confirmation link',
      description: 'Limited to 3 requests per hour for each account.',
      security: AUTHENTICATED,
      responses: {
        ...ok('A new link has been queued', objectOf({ sent: { type: 'boolean' } })),
        '400': COMMON_ERRORS['400'],
        '401': COMMON_ERRORS['401'],
        ...RATE_LIMITED,
      },
    },
  },
  '/api/v1/auth/forgot-password': {
    post: {
      tags: TAG,
      summary: 'Request a password reset link',
      description:
        'Always answers 200 with the same message whether or not the address has an account, so this endpoint cannot be used to discover who is registered. Limited to 5 attempts per 15 minutes, keyed on IP and on email independently.',
      security: [],
      requestBody: jsonBody({
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string', format: 'email' } },
      }),
      responses: {
        ...ok('The request was accepted', objectOf({ requested: { type: 'boolean' } })),
        '400': COMMON_ERRORS['400'],
        ...RATE_LIMITED,
      },
    },
  },
  '/api/v1/auth/reset-password': {
    post: {
      tags: TAG,
      summary: 'Set a new password with a reset token',
      description:
        'Consumes a single use token that expires 30 minutes after it was issued, then revokes every refresh token on the account and sends a confirmation email.',
      security: [],
      requestBody: jsonBody({
        type: 'object',
        required: ['token', 'password'],
        properties: { token: { type: 'string' }, password: { type: 'string', minLength: 8 } },
      }),
      responses: {
        ...ok('The password was reset', objectOf({ reset: { type: 'boolean' } })),
        '400': COMMON_ERRORS['400'],
        ...RATE_LIMITED,
      },
    },
  },
  '/api/v1/auth/sessions': {
    get: {
      tags: TAG,
      summary: 'List the signed in devices',
      description:
        'The live refresh tokens for this account, newest first, with the device and address each was issued to.',
      security: AUTHENTICATED,
      responses: {
        ...ok(
          'The active sessions',
          objectOf({ sessions: { type: 'array', items: sessionSummary } }),
        ),
        '401': COMMON_ERRORS['401'],
      },
    },
  },
  '/api/v1/auth/sessions/{id}': {
    delete: {
      tags: TAG,
      summary: 'Sign one device out',
      description:
        'Revokes exactly the named session. A session belonging to another account is reported as not found rather than forbidden.',
      security: AUTHENTICATED,
      parameters: [pathParam('id', 'The session id from GET /auth/sessions')],
      responses: {
        ...ok('That device has been signed out', objectOf({ revoked: { type: 'boolean' } })),
        '401': COMMON_ERRORS['401'],
        '404': COMMON_ERRORS['404'],
      },
    },
  },
};
