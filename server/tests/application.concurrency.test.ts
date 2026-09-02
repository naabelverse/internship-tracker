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

const patch = (id: string, token: string): request.Test =>
  request(app).patch(`${APPLICATIONS_BASE}/${id}`).set('Authorization', `Bearer ${token}`);

const read = (id: string, token: string): request.Test =>
  request(app).get(`${APPLICATIONS_BASE}/${id}`).set('Authorization', `Bearer ${token}`);

describe('optimistic concurrency on PATCH /applications/:id', () => {
  it('lets exactly one of two concurrent writers win and hands the loser the current document', async () => {
    const { accessToken } = await registerUser(app);
    const created = await createApplicationFor(app, accessToken);

    // Two clients open the same record and both read the same version.
    const [clientA, clientB] = await Promise.all([
      read(created.id, accessToken),
      read(created.id, accessToken),
    ]);
    const version = clientA.body.data.application.version as number;
    expect(clientB.body.data.application.version).toBe(version);

    const spans: { start: number; end: number }[] = [];
    const timedPatch = async (location: string): Promise<request.Response> => {
      const start = Date.now();
      const response = await patch(created.id, accessToken).send({ location, version });
      spans.push({ start, end: Date.now() });
      return response;
    };

    const [first, second] = await Promise.all([
      timedPatch('Kuala Lumpur'),
      timedPatch('Singapore'),
    ]);

    // Both requests were outstanding at once. Run one after the other, the
    // second span would start exactly where the first ended and this fails.
    const [spanA, spanB] = spans;
    expect(spanA.start).toBeLessThan(spanB.end);
    expect(spanB.start).toBeLessThan(spanA.end);

    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 409]);

    const loser = first.status === 409 ? first : second;
    expect(loser.body.code).toBe('VERSION_CONFLICT');
    expect(loser.body.errors.current.id).toBe(created.id);
    expect(loser.body.errors.current.version).toBe(version + 1);
    expect(['stale_read', 'concurrent_write']).toContain(loser.body.errors.conflictSource);

    // The decisive invariant: two writes were attempted, one landed. Had both
    // been applied the version would now be version + 2.
    const final = await read(created.id, accessToken);
    expect(final.body.data.application.version).toBe(version + 1);
  });

  it('collapses a burst of five concurrent writers to a single applied change', async () => {
    const { accessToken } = await registerUser(app);
    const created = await createApplicationFor(app, accessToken);
    const { version } = created;

    const responses = await Promise.all(
      Array.from({ length: 5 }, (_unused, index) =>
        patch(created.id, accessToken).send({ location: `City ${String(index)}`, version }),
      ),
    );

    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(4);

    const final = await read(created.id, accessToken);
    expect(final.body.data.application.version).toBe(version + 1);
  });

  it('reports a sequential stale write as a stale read, a different branch to the race', async () => {
    const { accessToken } = await registerUser(app);
    const created = await createApplicationFor(app, accessToken);
    const { version } = created;

    const firstWrite = await patch(created.id, accessToken).send({ location: 'Penang', version });
    expect(firstWrite.status).toBe(200);

    const staleWrite = await patch(created.id, accessToken).send({ location: 'Johor', version });

    expect(staleWrite.status).toBe(409);
    expect(staleWrite.body.errors.conflictSource).toBe('stale_read');
    expect(staleWrite.body.errors.current.location).toBe('Penang');
  });

  it('increments the version on every successful write', async () => {
    const { accessToken } = await registerUser(app);
    const created = await createApplicationFor(app, accessToken);

    const first = await patch(created.id, accessToken).send({ location: 'One' });
    const second = await patch(created.id, accessToken).send({ location: 'Two' });

    expect(first.body.data.application.version).toBe(created.version + 1);
    expect(second.body.data.application.version).toBe(created.version + 2);
  });

  it('skips the check when the client omits version, for autosave style writes', async () => {
    const { accessToken } = await registerUser(app);
    const created = await createApplicationFor(app, accessToken);

    await patch(created.id, accessToken).send({ location: 'First' });
    const withoutVersion = await patch(created.id, accessToken).send({ notes: 'Autosaved' });

    expect(withoutVersion.status).toBe(200);
    expect(withoutVersion.body.data.application.notes).toBe('Autosaved');
  });
});
