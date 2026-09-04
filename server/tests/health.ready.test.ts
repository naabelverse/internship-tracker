import request from 'supertest';
import { createApp } from '@/app';
import { useTestDatabase } from './helpers/testDb';

/**
 * The other half of `health.test.ts`, which runs with no database on purpose and
 * therefore can only ever prove the 503 branch. Readiness returning 200 against
 * a live connection is what the deploy platform actually gates traffic on, so it
 * is worth proving rather than assuming — and it needs its own file, because
 * connecting Mongoose here would invalidate that suite's disconnected fixtures.
 */
useTestDatabase();

const app = createApp();

describe('GET /ready with a live database', () => {
  it('returns 200 once MongoDB answers a ping', async () => {
    const response = await request(app).get('/ready');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { ready: true, checks: { database: { ok: true, state: 'connected' } } },
    });
  });

  it('is reachable on the versioned base path too', async () => {
    const response = await request(app).get('/api/v1/ready');

    expect(response.status).toBe(200);
    expect(response.body.data.ready).toBe(true);
  });

  it('reports the connection on the liveness probe as well', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.data.database).toMatchObject({ connected: true, state: 'connected' });
  });
});
