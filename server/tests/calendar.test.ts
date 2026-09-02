import request from 'supertest';
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
const CALENDAR = '/api/v1/calendar';

const at = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

const fetchCalendar = (token: string, from: string, to: string): request.Test =>
  request(app)
    .get(`${CALENDAR}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
    .set('Authorization', `Bearer ${token}`);

describe('GET /calendar', () => {
  it('requires authentication', async () => {
    expect((await request(app).get(CALENDAR)).status).toBe(401);
  });

  it('requires both ends of the window', async () => {
    const { accessToken } = await registerUser(app);

    const response = await request(app)
      .get(`${CALENDAR}?from=${encodeURIComponent(at(0))}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a window that runs backwards', async () => {
    const { accessToken } = await registerUser(app);

    const response = await fetchCalendar(accessToken, at(10), at(1));

    expect(response.status).toBe(400);
  });

  it('merges deadlines and interviews into one stream ordered by time', async () => {
    const { accessToken } = await registerUser(app);

    const withDeadline = await createApplicationFor(app, accessToken, {
      company: 'Grab',
      deadline: at(5),
    });
    await request(app)
      .post(`${APPLICATIONS_BASE}/${withDeadline.id}/interviews`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ type: 'technical', mode: 'video', scheduledAt: at(2) });

    const response = await fetchCalendar(accessToken, at(0), at(30));
    const events = response.body.data.events as { kind: string; at: string; company: string }[];

    expect(response.status).toBe(200);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.kind)).toEqual(['interview', 'deadline']);
    expect(events.every((event) => event.company === 'Grab')).toBe(true);
    expect(new Date(events[0].at) < new Date(events[1].at)).toBe(true);
  });

  it('carries the interview detail through on interview events', async () => {
    const { accessToken } = await registerUser(app);
    const application = await createApplicationFor(app, accessToken);
    await request(app)
      .post(`${APPLICATIONS_BASE}/${application.id}/interviews`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ type: 'hr', mode: 'phone', scheduledAt: at(3) });

    const response = await fetchCalendar(accessToken, at(0), at(30));

    expect(response.body.data.events[0]).toMatchObject({
      kind: 'interview',
      interviewType: 'hr',
      mode: 'phone',
      outcome: 'pending',
      applicationId: application.id,
    });
  });

  it('excludes anything outside the window', async () => {
    const { accessToken } = await registerUser(app);
    await createApplicationFor(app, accessToken, { deadline: at(40) });

    const inside = await fetchCalendar(accessToken, at(0), at(30));
    const outside = await fetchCalendar(accessToken, at(35), at(45));

    expect(inside.body.data.events).toHaveLength(0);
    expect(outside.body.data.events).toHaveLength(1);
  });

  it('excludes archived applications', async () => {
    const { accessToken } = await registerUser(app);
    await createApplicationFor(app, accessToken, { deadline: at(5), archived: true });

    const response = await fetchCalendar(accessToken, at(0), at(30));

    expect(response.body.data.events).toHaveLength(0);
  });

  it('never returns another account events', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    await createApplicationFor(app, alice.accessToken, { company: 'Alice Co', deadline: at(5) });

    const response = await fetchCalendar(bob.accessToken, at(0), at(30));

    expect(response.body.data.events).toHaveLength(0);
  });
});
