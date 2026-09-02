import type { Router } from 'express';
import { openApiDocument } from '@/docs/openapi';
import analyticsRouter from '@/routes/analytics.routes';
import applicationRouter from '@/routes/application.routes';
import authRouter from '@/routes/auth.routes';
import calendarRouter from '@/routes/calendar.routes';
import fileRouter from '@/routes/file.routes';
import healthRouter from '@/routes/health.routes';
import apiRouter from '@/routes/index';
import reminderRouter from '@/routes/reminder.routes';

/** Where each router is mounted, mirroring routes/index.ts. */
const MOUNTS: { prefix: string; router: Router }[] = [
  { prefix: '', router: healthRouter },
  { prefix: '/api/v1', router: healthRouter },
  { prefix: '/api/v1/auth', router: authRouter },
  { prefix: '/api/v1/applications', router: applicationRouter },
  { prefix: '/api/v1/analytics', router: analyticsRouter },
  { prefix: '/api/v1/calendar', router: calendarRouter },
  { prefix: '/api/v1/reminders', router: reminderRouter },
  { prefix: '/api/v1/files', router: fileRouter },
];

interface RouterLayer {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: unknown;
  name: string;
}

function layersOf(router: Router): RouterLayer[] {
  return (router as unknown as { stack: RouterLayer[] }).stack;
}

/** Express `:param` and `*` become OpenAPI `{param}` and `{0}`. */
function toOpenApiPath(prefix: string, path: string): string {
  const combined = `${prefix}${path === '/' ? '' : path}`;
  const normalised = combined.replace(/:([A-Za-z0-9_]+)/g, '{$1}').replace(/\/\*$/, '/{0}');

  return normalised === '' ? '/' : normalised;
}

function registeredOperations(): string[] {
  const operations = new Set<string>();

  for (const { prefix, router } of MOUNTS) {
    for (const layer of layersOf(router)) {
      if (!layer.route) continue;

      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (!enabled) continue;
        operations.add(`${method.toUpperCase()} ${toOpenApiPath(prefix, layer.route.path)}`);
      }
    }
  }

  return [...operations].sort();
}

function documentedOperations(): string[] {
  const operations: string[] = [];
  const paths = openApiDocument.paths as Record<string, Record<string, unknown>>;

  for (const [path, item] of Object.entries(paths)) {
    for (const method of Object.keys(item)) {
      operations.push(`${method.toUpperCase()} ${path}`);
    }
  }

  return operations.sort();
}

describe('OpenAPI document', () => {
  it('describes itself as OpenAPI 3 with the app version', () => {
    expect(openApiDocument.openapi).toMatch(/^3\./);
    expect(openApiDocument.info.title).toBe('Internship Tracker API');
    expect(openApiDocument.info.version).toBeTruthy();
  });

  it('mirrors every router that routes/index.ts actually mounts', () => {
    // Guards the table above: a new sub-router added to the API without being
    // listed here would otherwise escape the completeness check below.
    const mountedRouters = layersOf(apiRouter).filter((layer) => !layer.route).length;

    expect(mountedRouters).toBe(MOUNTS.length - 1);
  });

  it('documents every registered route, including those from earlier phases', () => {
    const registered = registeredOperations();
    const documented = new Set(documentedOperations());

    const missing = registered.filter((operation) => !documented.has(operation));

    expect(missing).toEqual([]);
  });

  it('does not document routes that no longer exist', () => {
    const registered = new Set(registeredOperations());
    const stale = documentedOperations().filter((operation) => !registered.has(operation));

    expect(stale).toEqual([]);
  });

  it('covers the auth and application surfaces from phases 2 and 3', () => {
    const documented = new Set(documentedOperations());

    for (const operation of [
      'POST /api/v1/auth/register',
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/refresh',
      'PATCH /api/v1/auth/me/password',
      'GET /api/v1/applications',
      'PATCH /api/v1/applications/{id}',
      'POST /api/v1/applications/bulk',
      'DELETE /api/v1/applications/{id}/interviews/{interviewId}',
    ]) {
      expect(documented.has(operation)).toBe(true);
    }
  });

  it('declares bearer auth and references only schemas that exist', () => {
    const schemas = Object.keys(openApiDocument.components.schemas);
    const referenced = [
      ...JSON.stringify(openApiDocument).matchAll(/#\/components\/schemas\/([A-Za-z]+)/g),
    ].map((match) => match[1]);

    expect(openApiDocument.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
    expect([...new Set(referenced)].filter((name) => !schemas.includes(name))).toEqual([]);
  });
});
