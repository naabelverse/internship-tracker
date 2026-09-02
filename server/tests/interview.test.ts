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

const soon = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

const addInterview = (id: string, token: string, body: object): request.Test =>
  request(app)
    .post(`${APPLICATIONS_BASE}/${id}/interviews`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

describe('interviews subresource', () => {
  it('adds an interview and defaults the outcome to pending', async () => {
    const { accessToken } = await registerUser(app);
    const created = await createApplicationFor(app, accessToken);

    const response = await addInterview(created.id, accessToken, {
      type: 'technical',
      mode: 'video',
      scheduledAt: soon(3),
      durationMins: 60,
      interviewer: 'Ada',
      round: 1,
    });

    expect(response.status).toBe(201);
    const interviews = response.body.data.application.interviews as Record<string, unknown>[];
    expect(interviews).toHaveLength(1);
    expect(interviews[0]).toMatchObject({
      type: 'technical',
      mode: 'video',
      outcome: 'pending',
      interviewer: 'Ada',
      round: 1,
    });
    expect(interviews[0].id).toBeDefined();
  });

  it('pulls nextActionDate forward to the soonest pending interview', async () => {
    const { accessToken } = await registerUser(app);
    const created = await createApplicationFor(app, accessToken, { deadline: soon(10) });

    const response = await addInterview(created.id, accessToken, {
      type: 'hr',
      mode: 'phone',
      scheduledAt: soon(2),
    });

    const nextAction = response.body.data.application.nextActionDate as string;
    expect(new Date(nextAction).getTime()).toBeLessThan(new Date(soon(3)).getTime());
  });

  it('stops counting an interview once its outcome is settled', async () => {
    const { accessToken } = await registerUser(app);
    const created = await createApplicationFor(app, accessToken);
    const added = await addInterview(created.id, accessToken, {
      type: 'oa',
      mode: 'video',
      scheduledAt: soon(1),
    });
    const interviewId = added.body.data.application.interviews[0].id as string;

    const response = await request(app)
      .patch(`${APPLICATIONS_BASE}/${created.id}/interviews/${interviewId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ outcome: 'passed', feedback: 'Solid' });

    expect(response.status).toBe(200);
    expect(response.body.data.application.interviews[0].outcome).toBe('passed');
    expect(response.body.data.application.nextActionDate).toBeUndefined();
  });

  it('removes an interview', async () => {
    const { accessToken } = await registerUser(app);
    const created = await createApplicationFor(app, accessToken);
    const added = await addInterview(created.id, accessToken, {
      type: 'final',
      mode: 'onsite',
      scheduledAt: soon(5),
    });
    const interviewId = added.body.data.application.interviews[0].id as string;

    const response = await request(app)
      .delete(`${APPLICATIONS_BASE}/${created.id}/interviews/${interviewId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.application.interviews).toHaveLength(0);

    const stored = await Application.findById(created.id);
    expect(stored?.interviews).toHaveLength(0);
  });

  it('returns 404 for an interview that does not exist on the record', async () => {
    const { accessToken } = await registerUser(app);
    const created = await createApplicationFor(app, accessToken);

    const response = await request(app)
      .delete(`${APPLICATIONS_BASE}/${created.id}/interviews/64b7f0000000000000000000`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('INTERVIEW_NOT_FOUND');
  });

  it('rejects an interview with an unknown type or mode', async () => {
    const { accessToken } = await registerUser(app);
    const created = await createApplicationFor(app, accessToken);

    const response = await addInterview(created.id, accessToken, {
      type: 'coffee_chat',
      mode: 'telepathy',
      scheduledAt: soon(1),
    });

    expect(response.status).toBe(400);
  });
});
