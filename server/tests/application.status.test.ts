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

const setStatus = (id: string, token: string, body: object): request.Test =>
  request(app)
    .patch(`${APPLICATIONS_BASE}/${id}/status`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

describe('status history', () => {
  it('opens the history with the status the record was created in', async () => {
    const { accessToken } = await registerUser(app);

    const created = await createApplicationFor(app, accessToken, { status: 'applied' });

    const history = created.application.statusHistory as { from: null; to: string }[];
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ from: null, to: 'applied' });
  });

  it('appends an entry with from, to, changedAt and note on a status change', async () => {
    const { accessToken } = await registerUser(app);
    const created = await createApplicationFor(app, accessToken);

    const response = await setStatus(created.id, accessToken, {
      status: 'interview',
      note: 'Recruiter called',
    });

    expect(response.status).toBe(200);
    const history = response.body.data.application.statusHistory as Record<string, unknown>[];
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({ from: 'saved', to: 'interview', note: 'Recruiter called' });
    expect(Date.parse(history[1].changedAt as string)).not.toBeNaN();
    expect(response.body.data.application.status).toBe('interview');
  });

  it('records each transition in order across several changes', async () => {
    const { accessToken } = await registerUser(app);
    const created = await createApplicationFor(app, accessToken);

    await setStatus(created.id, accessToken, { status: 'applied' });
    await setStatus(created.id, accessToken, { status: 'assessment' });
    const final = await setStatus(created.id, accessToken, { status: 'offer' });

    const history = final.body.data.application.statusHistory as { from: string; to: string }[];
    expect(history.map((entry) => entry.to)).toEqual(['saved', 'applied', 'assessment', 'offer']);
    expect(history.map((entry) => entry.from)).toEqual([null, 'saved', 'applied', 'assessment']);
  });

  it('writes exactly one entry per change, proving there is no duplicate hook', async () => {
    const { accessToken } = await registerUser(app);
    const created = await createApplicationFor(app, accessToken);

    await setStatus(created.id, accessToken, { status: 'applied' });

    const stored = await Application.findById(created.id);
    expect(stored?.statusHistory).toHaveLength(2);
  });

  it('does not append when the status is unchanged', async () => {
    const { accessToken } = await registerUser(app);
    const created = await createApplicationFor(app, accessToken);

    await setStatus(created.id, accessToken, { status: 'saved' });

    const stored = await Application.findById(created.id);
    expect(stored?.statusHistory).toHaveLength(1);
  });

  it('also records a status changed through the generic PATCH route', async () => {
    const { accessToken } = await registerUser(app);
    const created = await createApplicationFor(app, accessToken);

    const response = await request(app)
      .patch(`${APPLICATIONS_BASE}/${created.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'rejected' });

    const history = response.body.data.application.statusHistory as { to: string }[];
    expect(history).toHaveLength(2);
    expect(history[1].to).toBe('rejected');
  });

  it('rejects an unknown status', async () => {
    const { accessToken } = await registerUser(app);
    const created = await createApplicationFor(app, accessToken);

    const response = await setStatus(created.id, accessToken, { status: 'maybe' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a note longer than the limit', async () => {
    const { accessToken } = await registerUser(app);
    const created = await createApplicationFor(app, accessToken);

    const response = await setStatus(created.id, accessToken, {
      status: 'applied',
      note: 'x'.repeat(1_001),
    });

    expect(response.status).toBe(400);
  });
});
