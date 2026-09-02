import request from 'supertest';
import { Reminder } from '@/models/Reminder';
import {
  buildTestApp,
  createApplicationFor,
  registerUser,
  useCleanAuthRateLimits,
} from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();
useCleanAuthRateLimits();

const app = buildTestApp();
const REMINDERS = '/api/v1/reminders';

const past = (): string => new Date(Date.now() - 3_600_000).toISOString();
const future = (): string => new Date(Date.now() + 86_400_000).toISOString();

const create = (token: string, body: object): request.Test =>
  request(app).post(REMINDERS).set('Authorization', `Bearer ${token}`).send(body);

const list = (token: string, query = ''): request.Test =>
  request(app).get(`${REMINDERS}${query}`).set('Authorization', `Bearer ${token}`);

describe('reminders', () => {
  it('requires authentication', async () => {
    expect((await request(app).get(REMINDERS)).status).toBe(401);
  });

  it('creates a reminder with the documented defaults', async () => {
    const { accessToken } = await registerUser(app);

    const response = await create(accessToken, {
      type: 'deadline',
      title: 'Grab application closes',
      dueAt: future(),
    });

    expect(response.status).toBe(201);
    expect(response.body.data.reminder).toMatchObject({
      type: 'deadline',
      title: 'Grab application closes',
      channel: 'in_app',
      sent: false,
      readAt: null,
    });
  });

  it('links a reminder to an application the caller owns', async () => {
    const { accessToken } = await registerUser(app);
    const application = await createApplicationFor(app, accessToken);

    const response = await create(accessToken, {
      application: application.id,
      type: 'interview',
      title: 'Technical round',
      dueAt: future(),
    });

    expect(response.status).toBe(201);
    expect(response.body.data.reminder.application).toBe(application.id);
  });

  it('refuses to link a reminder to another account application', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const aliceApplication = await createApplicationFor(app, alice.accessToken);

    const response = await create(bob.accessToken, {
      application: aliceApplication.id,
      type: 'followup',
      title: 'Chase them',
      dueAt: future(),
    });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('APPLICATION_NOT_FOUND');
  });

  it('lists every reminder by default, ordered by due date', async () => {
    const { accessToken } = await registerUser(app);
    await create(accessToken, { type: 'custom', title: 'Later', dueAt: future() });
    await create(accessToken, { type: 'custom', title: 'Earlier', dueAt: past() });

    const response = await list(accessToken);
    const titles = (response.body.data.reminders as { title: string }[]).map((row) => row.title);

    expect(titles).toEqual(['Earlier', 'Later']);
  });

  it('unreadOnly returns just what has come due and is unacknowledged', async () => {
    const { accessToken } = await registerUser(app);
    await create(accessToken, { type: 'custom', title: 'Due now', dueAt: past() });
    await create(accessToken, { type: 'custom', title: 'Not yet', dueAt: future() });

    const response = await list(accessToken, '?unreadOnly=true');
    const titles = (response.body.data.reminders as { title: string }[]).map((row) => row.title);

    expect(titles).toEqual(['Due now']);
  });

  it('drops a reminder from unreadOnly once it is acknowledged', async () => {
    const { accessToken } = await registerUser(app);
    const created = await create(accessToken, {
      type: 'custom',
      title: 'Due now',
      dueAt: past(),
    });
    const id = created.body.data.reminder.id as string;

    const marked = await request(app)
      .patch(`${REMINDERS}/${id}/read`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(marked.status).toBe(200);
    expect(marked.body.data.reminder.readAt).not.toBeNull();

    const remaining = await list(accessToken, '?unreadOnly=true');
    expect(remaining.body.data.reminders).toHaveLength(0);
  });

  it('deletes a reminder', async () => {
    const { accessToken } = await registerUser(app);
    const created = await create(accessToken, { type: 'custom', title: 'Bye', dueAt: past() });
    const id = created.body.data.reminder.id as string;

    const response = await request(app)
      .delete(`${REMINDERS}/${id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(await Reminder.countDocuments({})).toBe(0);
  });

  it('hides another account reminders behind a 404', async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const created = await create(alice.accessToken, {
      type: 'custom',
      title: 'Private',
      dueAt: past(),
    });
    const id = created.body.data.reminder.id as string;

    const read = await request(app)
      .patch(`${REMINDERS}/${id}/read`)
      .set('Authorization', `Bearer ${bob.accessToken}`);
    const removed = await request(app)
      .delete(`${REMINDERS}/${id}`)
      .set('Authorization', `Bearer ${bob.accessToken}`);
    const listed = await list(bob.accessToken);

    expect(read.status).toBe(404);
    expect(removed.status).toBe(404);
    expect(listed.body.data.reminders).toHaveLength(0);
    expect(await Reminder.countDocuments({})).toBe(1);
  });

  it.each([
    ['an unknown type', { type: 'telepathy', title: 'x', dueAt: future() }],
    ['a missing title', { type: 'custom', dueAt: future() }],
    ['a malformed due date', { type: 'custom', title: 'x', dueAt: 'not-a-date' }],
  ])('rejects %s', async (_label, body) => {
    const { accessToken } = await registerUser(app);

    expect((await create(accessToken, body)).status).toBe(400);
  });
});
