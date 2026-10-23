import {
  AUTHENTICATED,
  COMMON_ERRORS,
  RATE_LIMITED,
  jsonBody,
  objectOf,
  ok,
  queryParam,
  ref,
} from '@/docs/paths/helpers';

const tokenParam = queryParam(
  'token',
  { type: 'string' },
  'The signed token from the unsubscribe link in the email footer. It identifies the account and the stream on its own, so no session is needed.',
  true,
);

const invalidToken = {
  '400': {
    description: 'The token is missing, malformed, or not one this server signed',
    content: { 'application/json': { schema: ref('Error') } },
  },
};

const unsubscribe = {
  get: {
    tags: ['Email'],
    summary: 'Unsubscribe from one non-transactional email stream',
    description:
      'The link a person clicks in a reminder digest or weekly summary. Unauthenticated by design, and strictly subtractive: it can only switch a preference off. Security email — verification, password reset, password changed, account closure — is unaffected and keeps sending. Answers with a small HTML confirmation rather than JSON, because a browser is what follows this link.',
    security: [],
    parameters: [tokenParam],
    responses: {
      '200': {
        description: 'The preference is off',
        content: { 'text/html': { schema: { type: 'string' } } },
      },
      ...invalidToken,
    },
  },
  post: {
    tags: ['Email'],
    summary: 'RFC 8058 one-click unsubscribe',
    description:
      'The address carried in the List-Unsubscribe header. Gmail and Outlook POST here on the reader behalf with no page ever rendered, so this answers in the usual JSON envelope.',
    security: [],
    parameters: [tokenParam],
    responses: {
      ...ok(
        'The preference is off',
        objectOf({ category: { type: 'string', enum: ['reminders', 'weekly_summary'] } }),
      ),
      ...invalidToken,
    },
  },
};

const feedback = {
  post: {
    tags: ['Email'],
    summary: 'Send feedback to the maintainer',
    description:
      'Emails the message to the project inbox; nothing is stored. A non-empty replyTo becomes the Reply-To address, and an empty one means the sender wants no reply. Limited to 5 an hour per account.',
    security: AUTHENTICATED,
    requestBody: jsonBody(
      objectOf({
        category: { type: 'string', enum: ['general', 'bug', 'suggestion'] },
        message: { type: 'string', minLength: 1, maxLength: 5000 },
        replyTo: { type: 'string', description: 'An email address, or empty for no reply' },
      }),
    ),
    responses: {
      ...ok('Queued for delivery', { nullable: true }, '202'),
      '400': COMMON_ERRORS['400'],
      '401': COMMON_ERRORS['401'],
      ...RATE_LIMITED,
    },
  },
};

export const emailPaths = {
  '/api/v1/email/unsubscribe': unsubscribe,
  '/api/v1/email/feedback': feedback,
};
