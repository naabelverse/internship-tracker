import {
  arrayOf,
  AUTHENTICATED,
  COMMON_ERRORS,
  jsonBody,
  objectOf,
  ok,
  pathParam,
  queryParam,
  ref,
} from '@/docs/paths/helpers';

const TAG = ['Analytics'];
const PLANNING = ['Calendar and reminders'];

const authOnly = { '401': COMMON_ERRORS['401'] };

const summaryData = objectOf({
  total: { type: 'integer' },
  active: { type: 'integer' },
  applied: { type: 'integer' },
  responded: { type: 'integer' },
  interviewed: { type: 'integer' },
  offers: { type: 'integer' },
  responseRate: { type: 'number', description: 'Percentage of applied that got any response' },
  interviewRate: { type: 'number' },
  offerRate: { type: 'number' },
  avgDaysToFirstResponse: { type: 'number', nullable: true },
  currentStreakDays: {
    type: 'integer',
    description: 'Consecutive days with activity, counted in the timezone on the account',
  },
  weeklyGoal: objectOf({
    target: { type: 'integer' },
    completed: { type: 'integer' },
    percentage: { type: 'number' },
  }),
});

const countedBy = (key: string): Record<string, unknown> => ({
  type: 'array',
  items: objectOf({ [key]: { type: 'string' }, count: { type: 'integer' } }),
});

export const analyticsPaths: Record<string, unknown> = {
  '/api/v1/analytics/summary': {
    get: {
      tags: TAG,
      summary: 'Headline numbers for the dashboard',
      description:
        'Day and week boundaries, the streak and the weekly goal window are all computed in the timezone stored on the account, never the server one.',
      security: AUTHENTICATED,
      responses: { ...ok('Summary', summaryData), ...authOnly },
    },
  },
  '/api/v1/analytics/status-breakdown': {
    get: {
      tags: TAG,
      summary: 'Count per status, including the empty ones',
      security: AUTHENTICATED,
      responses: {
        ...ok('Breakdown', objectOf({ breakdown: countedBy('status') })),
        ...authOnly,
      },
    },
  },
  '/api/v1/analytics/timeline': {
    get: {
      tags: TAG,
      summary: 'Applications created and status changes over time',
      description: 'Only buckets with activity are returned; the chart fills the gaps.',
      security: AUTHENTICATED,
      parameters: [
        queryParam(
          'granularity',
          { type: 'string', enum: ['day', 'week', 'month'] },
          'Defaults to day',
        ),
        queryParam('range', { type: 'string', enum: ['30d', '90d', '1y'] }, 'Defaults to 90d'),
      ],
      responses: {
        ...ok(
          'Timeline',
          objectOf({
            granularity: { type: 'string' },
            range: { type: 'string' },
            points: {
              type: 'array',
              items: objectOf({
                bucket: { type: 'string', format: 'date-time' },
                created: { type: 'integer' },
                statusChanges: { type: 'integer' },
              }),
            },
          }),
        ),
        '400': COMMON_ERRORS['400'],
        ...authOnly,
      },
    },
  },
  '/api/v1/analytics/by-source': {
    get: {
      tags: TAG,
      summary: 'Count per source, busiest first',
      security: AUTHENTICATED,
      responses: {
        ...ok('Sources', objectOf({ sources: countedBy('source') })),
        ...authOnly,
      },
    },
  },
  '/api/v1/analytics/funnel': {
    get: {
      tags: TAG,
      summary: 'Applied to assessment to interview to offer, with conversion rates',
      security: AUTHENTICATED,
      responses: {
        ...ok(
          'Funnel',
          objectOf({
            stages: {
              type: 'array',
              items: objectOf({
                stage: { type: 'string' },
                count: { type: 'integer' },
                conversionFromApplied: { type: 'number' },
                conversionFromPrevious: { type: 'number' },
              }),
            },
          }),
        ),
        ...authOnly,
      },
    },
  },
  '/api/v1/analytics/top-companies': {
    get: {
      tags: TAG,
      summary: 'Companies applied to most often',
      security: AUTHENTICATED,
      parameters: [
        queryParam('limit', { type: 'integer', minimum: 1, maximum: 50 }, 'Defaults to 10'),
      ],
      responses: {
        ...ok('Top companies', objectOf({ companies: countedBy('company') })),
        '400': COMMON_ERRORS['400'],
        ...authOnly,
      },
    },
  },
  '/api/v1/calendar': {
    get: {
      tags: PLANNING,
      summary: 'Deadlines and interviews merged into one ordered stream',
      security: AUTHENTICATED,
      parameters: [
        queryParam('from', { type: 'string', format: 'date-time' }, 'Window start', true),
        queryParam('to', { type: 'string', format: 'date-time' }, 'Window end', true),
      ],
      responses: {
        ...ok('Events', objectOf({ events: arrayOf('CalendarEvent') })),
        '400': COMMON_ERRORS['400'],
        ...authOnly,
      },
    },
  },
  '/api/v1/reminders': {
    get: {
      tags: PLANNING,
      summary: 'Reminders for the account',
      security: AUTHENTICATED,
      parameters: [
        queryParam(
          'unreadOnly',
          { type: 'boolean' },
          'Only reminders that have come due and have not been acknowledged',
        ),
      ],
      responses: {
        ...ok('Reminders', objectOf({ reminders: arrayOf('Reminder') })),
        '400': COMMON_ERRORS['400'],
        ...authOnly,
      },
    },
    post: {
      tags: PLANNING,
      summary: 'Create a reminder',
      description:
        'Email reminders are delivered by the hourly sweep, which only sends when the clock on the account reads the digest hour.',
      security: AUTHENTICATED,
      requestBody: jsonBody({
        type: 'object',
        required: ['type', 'title', 'dueAt'],
        properties: {
          application: { type: 'string' },
          type: { type: 'string', enum: ['deadline', 'interview', 'followup', 'custom'] },
          title: { type: 'string', maxLength: 200 },
          dueAt: { type: 'string', format: 'date-time' },
          channel: { type: 'string', enum: ['in_app', 'email'] },
        },
      }),
      responses: {
        ...ok('Created', objectOf({ reminder: ref('Reminder') }), '201'),
        ...COMMON_ERRORS,
      },
    },
  },
  '/api/v1/reminders/{id}/read': {
    patch: {
      tags: PLANNING,
      summary: 'Acknowledge a reminder',
      security: AUTHENTICATED,
      parameters: [pathParam('id', 'Reminder id')],
      responses: {
        ...ok('Marked read', objectOf({ reminder: ref('Reminder') })),
        ...COMMON_ERRORS,
      },
    },
  },
  '/api/v1/reminders/{id}': {
    delete: {
      tags: PLANNING,
      summary: 'Delete a reminder',
      security: AUTHENTICATED,
      parameters: [pathParam('id', 'Reminder id')],
      responses: { ...ok('Deleted', objectOf({ deleted: { type: 'boolean' } })), ...COMMON_ERRORS },
    },
  },
};
