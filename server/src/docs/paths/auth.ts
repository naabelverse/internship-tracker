import {
  AUTHENTICATED,
  COMMON_ERRORS,
  jsonBody,
  objectOf,
  ok,
  pathParam,
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
        'Ten consecutive failures lock the account for 15 minutes and return 423. An unknown email and a wrong password produce identical responses.',
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
        '423': {
          description: 'Account temporarily locked after repeated failures',
          content: { 'application/json': { schema: ref('Error') } },
        },
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
        'Requires the current password. The account is soft deleted: access ends immediately and every session is revoked, and the data is permanently removed by a job 30 days later.',
      security: AUTHENTICATED,
      requestBody: jsonBody({
        type: 'object',
        required: ['password'],
        properties: { password: { type: 'string' } },
      }),
      responses: {
        ...ok('The account is closed', objectOf({ deleted: { type: 'boolean' } })),
        '400': COMMON_ERRORS['400'],
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
