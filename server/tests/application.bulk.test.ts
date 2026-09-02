import request from 'supertest';
import { Application } from '@/models/Application';
import {
  APPLICATIONS_BASE,
  buildTestApp,
  createApplicationFor,
  registerUser,
  useCleanAuthRateLimits,
} from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();
useCleanAuthRateLimits();

const app = buildTestApp();

const bulk = (token: string, body: object): request.Test =>
  request(app).post(`${APPLICATIONS_BASE}/bulk`).set('Authorization', `Bearer ${token}`).send(body);

describe('POST /applications/bulk', () => {
  it('deletes several records at once', async () => {
    const { accessToken } = await registerUser(app);
    const first = await createApplicationFor(app, accessToken);
    const second = await createApplicationFor(app, accessToken);

    const response = await bulk(accessToken, { ids: [first.id, second.id], action: 'delete' });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ matched: 2, modified: 2, notFound: [] });
    expect(await Application.countDocuments({})).toBe(0);
  });

  it('archives and then unarchives', async () => {
    const { accessToken } = await registerUser(app);
    const created = await createApplicationFor(app, accessToken);

    await bulk(accessToken, { ids: [created.id], action: 'archive' });
    const archived = await Application.findById(created.id);
    expect(archived?.archived).toBe(true);

    await bulk(accessToken, { ids: [created.id], action: 'unarchive' });
    const restored = await Application.findById(created.id);
    expect(restored?.archived).toBe(false);
  });

  it('sets a status and appends one history entry per changed record', async () => {
    const { accessToken } = await registerUser(app);
    const first = await createApplicationFor(app, accessToken);
    const second = await createApplicationFor(app, accessToken, { status: 'rejected' });

    const response = await bulk(accessToken, {
      ids: [first.id, second.id],
      action: 'setStatus',
      payload: { status: 'rejected' },
    });

    // The second record was already rejected, so only one row actually changed.
    expect(response.body.data.modified).toBe(1);

    const changed = await Application.findById(first.id);
    const unchanged = await Application.findById(second.id);
    expect(changed?.status).toBe('rejected');
    expect(changed?.statusHistory).toHaveLength(2);
    expect(unchanged?.statusHistory).toHaveLength(1);
  });

  it('reports ids that do not exist without failing the whole request', async () => {
    const { accessToken } = await registerUser(app);
    const created = await createApplicationFor(app, accessToken);
    const missing = '64b7f0000000000000000000';

    const response = await bulk(accessToken, { ids: [created.id, missing], action: 'archive' });

    expect(response.status).toBe(200);
    expect(response.body.data.matched).toBe(1);
    expect(response.body.data.notFound).toEqual([missing]);
  });

  it('requires payload.status when the action is setStatus', async () => {
    const { accessToken } = await registerUser(app);
    const created = await createApplicationFor(app, accessToken);

    const response = await bulk(accessToken, { ids: [created.id], action: 'setStatus' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it.each([
    ['an empty id list', { ids: [], action: 'archive' }],
    ['an unknown action', { ids: ['64b7f0000000000000000000'], action: 'incinerate' }],
    ['a malformed id', { ids: ['nope'], action: 'archive' }],
  ])('rejects %s', async (_label, body) => {
    const { accessToken } = await registerUser(app);

    const response = await bulk(accessToken, body);

    expect(response.status).toBe(400);
  });

  it('rejects more ids than the cap allows', async () => {
    const { accessToken } = await registerUser(app);
    const ids = Array.from({ length: 101 }, () => '64b7f0000000000000000000');

    const response = await bulk(accessToken, { ids, action: 'archive' });

    expect(response.status).toBe(400);
  });
});
