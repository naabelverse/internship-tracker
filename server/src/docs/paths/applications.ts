import { APPLICATION_STATUSES, PRIORITIES, SOURCES, WORK_MODES } from '@/models/Application';
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

const TAG = ['Applications'];
const INTERVIEW_TAG = ['Interviews'];
const applicationData = objectOf({ application: ref('Application') });
const stringArray = { type: 'array', items: { type: 'string' } };

const conflict = {
  description: 'The record was changed elsewhere. The current document is in errors.current.',
  content: { 'application/json': { schema: ref('Error') } },
};

const enumArray = (values: readonly string[]): Record<string, unknown> => ({
  type: 'array',
  items: { type: 'string', enum: [...values] },
});

const listParameters = [
  queryParam('search', { type: 'string' }, 'Partial match on company, role, tags and notes'),
  queryParam(
    'status',
    enumArray(APPLICATION_STATUSES),
    'Repeat the key or pass a comma separated list',
  ),
  queryParam('source', enumArray(SOURCES), 'Filter by source'),
  queryParam('workMode', enumArray(WORK_MODES), 'Filter by work mode'),
  queryParam('priority', enumArray(PRIORITIES), 'Filter by priority'),
  queryParam('tags', stringArray, 'Matches any of the given tags'),
  queryParam('company', { type: 'string' }, 'Exact company name, case insensitive'),
  queryParam('dateFrom', { type: 'string', format: 'date-time' }, 'Earliest createdAt'),
  queryParam('dateTo', { type: 'string', format: 'date-time' }, 'Latest createdAt'),
  queryParam('archived', { type: 'boolean' }, 'Defaults to false, which hides archived records'),
  queryParam('sort', { type: 'string', example: 'deadline:asc' }, 'field:asc or field:desc'),
  queryParam('page', { type: 'integer', minimum: 1 }, 'Page number, from 1'),
  queryParam('limit', { type: 'integer', minimum: 1, maximum: 100 }, 'Page size, max 100'),
];

const writableApplication = {
  type: 'object',
  properties: {
    company: { type: 'string' },
    role: { type: 'string' },
    companyWebsite: { type: 'string' },
    location: { type: 'string' },
    workMode: { type: 'string', enum: [...WORK_MODES] },
    status: { type: 'string', enum: [...APPLICATION_STATUSES] },
    priority: { type: 'string', enum: [...PRIORITIES] },
    source: { type: 'string', enum: [...SOURCES] },
    sourceOther: { type: 'string', maxLength: 60, description: 'Dropped unless source is other' },
    jobUrl: { type: 'string' },
    appliedDate: { type: 'string', format: 'date-time' },
    deadline: { type: 'string', format: 'date-time' },
    tags: stringArray,
    notes: { type: 'string', maxLength: 10000 },
    archived: { type: 'boolean' },
  },
};

const interviewBody = {
  type: 'object',
  required: ['type', 'mode', 'scheduledAt'],
  properties: {
    type: { type: 'string' },
    mode: { type: 'string' },
    scheduledAt: { type: 'string', format: 'date-time' },
    durationMins: { type: 'integer' },
    link: { type: 'string' },
    interviewer: { type: 'string' },
    round: { type: 'integer' },
    outcome: { type: 'string' },
    feedback: { type: 'string' },
    prepNotes: { type: 'string' },
  },
};

const fileUploadBody = {
  required: true,
  content: {
    'multipart/form-data': {
      schema: objectOf({ file: { type: 'string', format: 'binary' } }),
    },
  },
};

const idParam = [pathParam('id', 'Application id')];

export const applicationPaths: Record<string, unknown> = {
  '/api/v1/applications': {
    get: {
      tags: TAG,
      summary: 'List applications with filtering, sorting and paging',
      security: AUTHENTICATED,
      parameters: listParameters,
      responses: {
        ...ok('A page of applications', objectOf({ applications: arrayOf('Application') })),
        '400': COMMON_ERRORS['400'],
        '401': COMMON_ERRORS['401'],
      },
    },
    post: {
      tags: TAG,
      summary: 'Create an application',
      security: AUTHENTICATED,
      requestBody: jsonBody(writableApplication),
      responses: {
        ...ok('Created', applicationData, '201'),
        '400': COMMON_ERRORS['400'],
        '401': COMMON_ERRORS['401'],
      },
    },
  },
  '/api/v1/applications/export': {
    get: {
      tags: TAG,
      summary: 'Download every application as CSV or JSON',
      security: AUTHENTICATED,
      parameters: [
        queryParam('format', { type: 'string', enum: ['csv', 'json'] }, 'Defaults to csv'),
      ],
      responses: {
        '200': {
          description: 'A file download rather than the JSON envelope',
          content: { 'text/csv': {}, 'application/json': {} },
        },
        '401': COMMON_ERRORS['401'],
      },
    },
  },
  '/api/v1/applications/import': {
    post: {
      tags: TAG,
      summary: 'Import applications from a CSV file',
      description:
        'A bad row never aborts the batch. Every skipped row is reported with its spreadsheet row number, the offending field and the reason.',
      security: AUTHENTICATED,
      requestBody: fileUploadBody,
      responses: {
        ...ok(
          'Import summary',
          objectOf({
            imported: { type: 'integer' },
            skipped: { type: 'integer' },
            errors: {
              type: 'array',
              items: objectOf({
                row: { type: 'integer' },
                field: { type: 'string' },
                message: { type: 'string' },
              }),
            },
          }),
        ),
        '400': COMMON_ERRORS['400'],
        '401': COMMON_ERRORS['401'],
      },
    },
  },
  '/api/v1/applications/demo-data': {
    post: {
      tags: TAG,
      summary: 'Fill an empty account with the demo fixture set',
      description:
        'Bridges the seed data in SPEC section 9, which is a CLI script, to the dashboard empty state, which runs in a browser. Refuses with DEMO_DATA_NOT_EMPTY when the account already holds any application, so fixture rows can never mix into a real search.',
      security: AUTHENTICATED,
      responses: {
        ...ok('Loaded', objectOf({ inserted: { type: 'integer' } }), '201'),
        '401': COMMON_ERRORS['401'],
        '409': {
          description: 'The account already has applications',
          content: { 'application/json': { schema: ref('Error') } },
        },
      },
    },
  },
  '/api/v1/applications/bulk': {
    post: {
      tags: TAG,
      summary: 'Apply one action to many records',
      description:
        'Every id is re-checked against the caller. Ids owned by another account come back in notFound and are never acted on. The delete action also erases the uploaded files of every application it removes.',
      security: AUTHENTICATED,
      requestBody: jsonBody({
        type: 'object',
        required: ['ids', 'action'],
        properties: {
          ids: { ...stringArray, maxItems: 100 },
          action: { type: 'string', enum: ['delete', 'archive', 'unarchive', 'setStatus'] },
          payload: objectOf({ status: { type: 'string', enum: [...APPLICATION_STATUSES] } }),
        },
      }),
      responses: {
        ...ok(
          'What the action changed',
          objectOf({
            matched: { type: 'integer' },
            modified: { type: 'integer' },
            notFound: stringArray,
          }),
        ),
        '400': COMMON_ERRORS['400'],
        '401': COMMON_ERRORS['401'],
      },
    },
  },
  '/api/v1/applications/{id}': {
    get: {
      tags: TAG,
      summary: 'One application',
      security: AUTHENTICATED,
      parameters: idParam,
      responses: { ...ok('The application', applicationData), ...COMMON_ERRORS },
    },
    patch: {
      tags: TAG,
      summary: 'Update an application',
      description:
        'Send the version you last read to enable the optimistic lock. Omitting it skips the check, which is what the autosaving notes editor does.',
      security: AUTHENTICATED,
      parameters: idParam,
      requestBody: jsonBody({
        ...writableApplication,
        properties: { ...writableApplication.properties, version: { type: 'integer' } },
      }),
      responses: { ...ok('Updated', applicationData), ...COMMON_ERRORS, '409': conflict },
    },
    delete: {
      tags: TAG,
      summary: 'Delete an application',
      description:
        'Deletes the application with its interviews, notes and status history, and erases its uploaded files from storage.',
      security: AUTHENTICATED,
      parameters: idParam,
      responses: { ...ok('Deleted', objectOf({ deleted: { type: 'boolean' } })), ...COMMON_ERRORS },
    },
  },
  '/api/v1/applications/{id}/status': {
    patch: {
      tags: TAG,
      summary: 'Change status and append to the history',
      security: AUTHENTICATED,
      parameters: idParam,
      requestBody: jsonBody({
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: [...APPLICATION_STATUSES] },
          note: { type: 'string', maxLength: 1000 },
        },
      }),
      responses: { ...ok('Status changed', applicationData), ...COMMON_ERRORS },
    },
  },
  '/api/v1/applications/{id}/interviews': {
    post: {
      tags: INTERVIEW_TAG,
      summary: 'Add an interview',
      security: AUTHENTICATED,
      parameters: idParam,
      requestBody: jsonBody(interviewBody),
      responses: { ...ok('Added', applicationData, '201'), ...COMMON_ERRORS },
    },
  },
  '/api/v1/applications/{id}/interviews/{interviewId}': {
    patch: {
      tags: INTERVIEW_TAG,
      summary: 'Update an interview',
      security: AUTHENTICATED,
      parameters: [...idParam, pathParam('interviewId', 'Interview id')],
      requestBody: jsonBody(interviewBody),
      responses: { ...ok('Updated', applicationData), ...COMMON_ERRORS },
    },
    delete: {
      tags: INTERVIEW_TAG,
      summary: 'Remove an interview',
      security: AUTHENTICATED,
      parameters: [...idParam, pathParam('interviewId', 'Interview id')],
      responses: { ...ok('Removed', applicationData), ...COMMON_ERRORS },
    },
  },
  '/api/v1/applications/{id}/attachments': {
    post: {
      tags: TAG,
      summary: 'Attach a file',
      description:
        'PDF, DOC, DOCX, PNG or JPG up to the configured size limit. Images are re-encoded to strip EXIF. Stored under a generated key, never the uploaded filename.',
      security: AUTHENTICATED,
      parameters: idParam,
      requestBody: fileUploadBody,
      responses: { ...ok('Attached', applicationData, '201'), ...COMMON_ERRORS },
    },
  },
  '/api/v1/applications/{id}/attachments/{attachmentId}': {
    get: {
      tags: TAG,
      summary: 'Mint a time limited download URL',
      security: AUTHENTICATED,
      parameters: [...idParam, pathParam('attachmentId', 'Attachment id')],
      responses: {
        ...ok(
          'A signed URL that expires',
          objectOf({
            url: { type: 'string' },
            expiresInSeconds: { type: 'integer' },
            filename: { type: 'string' },
          }),
        ),
        ...COMMON_ERRORS,
      },
    },
    delete: {
      tags: TAG,
      summary: 'Remove an attachment and delete the stored object',
      security: AUTHENTICATED,
      parameters: [...idParam, pathParam('attachmentId', 'Attachment id')],
      responses: { ...ok('Removed', applicationData), ...COMMON_ERRORS },
    },
  },
};
