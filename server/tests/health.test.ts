import request from 'supertest';
import { createApp } from '@/app';

const app = createApp();

describe('probes and error envelope', () => {
  describe('GET /health', () => {
    it('reports liveness even with no database connection', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        data: {
          status: 'ok',
          service: 'internship-tracker-api',
          environment: 'test',
          database: { connected: false, state: 'disconnected' },
        },
      });
      expect(typeof response.body.data.uptimeSeconds).toBe('number');
      expect(Date.parse(response.body.data.timestamp)).not.toBeNaN();
    });

    it('is also reachable on the versioned base path', async () => {
      const response = await request(app).get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('returns a request id and echoes a safe inbound one', async () => {
      const generated = await request(app).get('/health');
      expect(generated.headers['x-request-id']).toMatch(/^[A-Za-z0-9-]{36}$/);

      const echoed = await request(app).get('/health').set('x-request-id', 'trace-abc-12345678');
      expect(echoed.headers['x-request-id']).toBe('trace-abc-12345678');
    });

    it('ignores an unsafe inbound request id', async () => {
      const response = await request(app).get('/health').set('x-request-id', 'bad id!');

      expect(response.headers['x-request-id']).not.toBe('bad id!');
    });
  });

  describe('GET /ready', () => {
    it('returns 503 while MongoDB is unreachable', async () => {
      const response = await request(app).get('/ready');

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        success: false,
        code: 'NOT_READY',
        errors: { database: { ok: false, state: 'disconnected' } },
      });
    });
  });

  describe('unmatched routes', () => {
    it('returns the standard 404 error envelope', async () => {
      const response = await request(app).get('/does-not-exist');

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ success: false, code: 'ROUTE_NOT_FOUND' });
      expect(response.body.message).toContain('/does-not-exist');
      expect(response.body.requestId).toBe(response.headers['x-request-id']);
    });

    it('never returns a password or token field', async () => {
      const response = await request(app).get('/does-not-exist');

      expect(JSON.stringify(response.body)).not.toMatch(/password|refreshToken/i);
    });
  });

  describe('malformed input', () => {
    it('maps an unparseable JSON body to a 400 with a stable code', async () => {
      const response = await request(app)
        .post('/api/v1/health')
        .set('Content-Type', 'application/json')
        .send('{"broken": ');

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ success: false, code: 'INVALID_JSON' });
    });
  });
});
