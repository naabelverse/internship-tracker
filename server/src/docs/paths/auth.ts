import {
  AUTHENTICATED,
  COMMON_ERRORS,
  jsonBody,
  objectOf,
  ok,
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
        'Email is deliberately not accepted here: changing it requires the verification flow.',
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
        },
      }),
      responses: {
        ...ok('Updated', objectOf({ user: ref('User') })),
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
