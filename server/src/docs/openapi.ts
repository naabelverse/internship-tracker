import { APP_NAME, APP_VERSION } from '@/config/app-info';
import { env } from '@/config/env';
import { components } from '@/docs/components';
import { analyticsPaths } from '@/docs/paths/analytics';
import { applicationPaths } from '@/docs/paths/applications';
import { accountLifecyclePaths, authPaths } from '@/docs/paths/auth';
import { emailPaths } from '@/docs/paths/email';
import { metaPaths } from '@/docs/paths/meta';

/**
 * The OpenAPI 3 description served at /api/docs. A test walks the Express router
 * stack and fails if any registered route is missing here, so the document
 * cannot silently fall behind the implementation.
 */
export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Internship Tracker API',
    version: APP_VERSION,
    description:
      'Track internship applications through their whole lifecycle. Every endpoint below is scoped to the signed in account: a record owned by someone else is reported as not found rather than forbidden, so existence never leaks.',
    license: { name: 'MIT' },
  },
  servers: [{ url: env.API_URL, description: APP_NAME }],
  tags: [
    { name: 'Meta', description: 'Probes and file downloads' },
    { name: 'Auth', description: 'Registration, sessions and the profile' },
    { name: 'Applications', description: 'The tracked applications themselves' },
    { name: 'Interviews', description: 'Interviews embedded in an application' },
    { name: 'Analytics', description: 'Aggregations behind the dashboard' },
    { name: 'Calendar and reminders', description: 'Upcoming work and nudges' },
    { name: 'Email', description: 'Unsubscribing from non-transactional mail' },
  ],
  components,
  security: [{ bearerAuth: [] }],
  paths: {
    ...metaPaths,
    ...authPaths,
    ...accountLifecyclePaths,
    ...applicationPaths,
    ...analyticsPaths,
    ...emailPaths,
  },
};
