import { objectOf, ok, ref } from '@/docs/paths/helpers';

const healthData = objectOf({
  status: { type: 'string', example: 'ok' },
  service: { type: 'string' },
  version: { type: 'string' },
  environment: { type: 'string' },
  uptimeSeconds: { type: 'number' },
  timestamp: { type: 'string', format: 'date-time' },
  database: objectOf({ state: { type: 'string' }, connected: { type: 'boolean' } }),
});

const readyData = objectOf({
  ready: { type: 'boolean' },
  checks: objectOf({ database: objectOf({ ok: { type: 'boolean' }, state: { type: 'string' } }) }),
});

const health = {
  get: {
    tags: ['Meta'],
    summary: 'Liveness probe, answers even while the database is unreachable',
    responses: ok('The process is up', healthData),
  },
};

const ready = {
  get: {
    tags: ['Meta'],
    summary: 'Readiness probe, round trips to MongoDB',
    responses: {
      ...ok('Ready to serve traffic', readyData),
      '503': {
        description: 'MongoDB is not reachable',
        content: { 'application/json': { schema: ref('Error') } },
      },
    },
  },
};

const fileDownload = {
  get: {
    tags: ['Meta'],
    summary: 'Download a stored attachment against a signed, expiring URL',
    description:
      'Unauthenticated by design: the signature in the query string is the credential. Always served as an attachment. Used only by the local storage driver; the S3 driver presigns against the bucket instead.',
    parameters: [
      {
        name: '0',
        in: 'path',
        required: true,
        description: 'Storage key',
        schema: { type: 'string' },
      },
      { name: 'expires', in: 'query', required: true, schema: { type: 'integer' } },
      { name: 'signature', in: 'query', required: true, schema: { type: 'string' } },
      { name: 'name', in: 'query', required: false, schema: { type: 'string' } },
    ],
    responses: {
      '200': { description: 'The file bytes', content: { 'application/octet-stream': {} } },
      '404': {
        description: 'Unknown key, or an invalid or expired signature',
        content: { 'application/json': { schema: ref('Error') } },
      },
    },
  },
};

export const metaPaths: Record<string, unknown> = {
  '/health': health,
  '/ready': ready,
  '/api/v1/health': health,
  '/api/v1/ready': ready,
  '/api/v1/files/{0}': fileDownload,
};
