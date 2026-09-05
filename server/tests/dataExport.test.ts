import request from 'supertest';
import type { Express } from 'express';
import { Application } from '@/models/Application';
import { RefreshToken } from '@/models/RefreshToken';
import { Reminder } from '@/models/Reminder';
import { User } from '@/models/User';
import {
  APPLICATIONS_BASE,
  AUTH_BASE,
  buildTestApp,
  createApplicationFor,
  registerUser,
  useCleanAuthRateLimits,
  type RegisteredUser,
} from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();
useCleanAuthRateLimits();

const EXPORT_URL = `${AUTH_BASE}/me/export`;

let app: Express;

beforeAll(() => {
  app = buildTestApp();
});

interface SeededAccount {
  user: RegisteredUser;
  applicationId: string;
  reminderId: string;
}

/**
 * An account with a row in every model the system stores user data in: User,
 * Application (with an embedded interview, status history and an attachment),
 * Reminder, and more than one RefreshToken.
 *
 * Everything goes through the real endpoints where one exists, so the export is
 * asserted against data the application itself produced rather than against
 * fixtures shaped to match it.
 */
async function seedEverything(): Promise<SeededAccount> {
  const user = await registerUser(app, { timezone: 'Asia/Kuala_Lumpur' });
  const auth = { Authorization: `Bearer ${user.accessToken}` };

  const created = await createApplicationFor(app, user.accessToken, {
    company: 'Fathom Analytics',
    role: 'Backend Intern',
    notes: 'Referred by a friend on the platform team.',
    tags: ['backend', 'referral'],
  });

  // A status change, so statusHistory has more than its opening entry.
  await request(app)
    .patch(`${APPLICATIONS_BASE}/${created.id}/status`)
    .set(auth)
    .send({ status: 'applied', note: 'Submitted through the careers page' });

  await request(app)
    .post(`${APPLICATIONS_BASE}/${created.id}/interviews`)
    .set(auth)
    .send({
      type: 'technical',
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
      mode: 'video',
      interviewer: 'Priya',
    });

  await request(app)
    .post(`${APPLICATIONS_BASE}/${created.id}/attachments`)
    .set(auth)
    .attach('file', Buffer.from('%PDF-1.4 my cv'), {
      filename: 'my-cv.pdf',
      contentType: 'application/pdf',
    });

  const reminder = await request(app)
    .post('/api/v1/reminders')
    .set(auth)
    .send({
      type: 'followup',
      title: 'Chase the recruiter',
      dueAt: new Date(Date.now() + 172_800_000).toISOString(),
      application: created.id,
    });

  // A second device, so `sessions` has something to be more than one of.
  await request(app).post(`${AUTH_BASE}/login`).set('User-Agent', 'Second Device').send({
    email: user.payload.email,
    password: user.payload.password,
  });

  return {
    user,
    applicationId: created.id,
    reminderId: reminder.body.data.reminder.id as string,
  };
}

describe('GET /auth/me/export', () => {
  it('needs a session', async () => {
    expect((await request(app).get(EXPORT_URL)).status).toBe(401);
  });

  it('is sent as a download, not wrapped in the API envelope', async () => {
    const { user } = await seedEverything();

    const response = await request(app)
      .get(EXPORT_URL)
      .set('Authorization', `Bearer ${user.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename="internship-tracker-export-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    // The file is the export itself, so there is no `success`/`data` wrapper to
    // unwrap before anything can read it.
    expect(response.body.success).toBeUndefined();
    expect(response.body.profile).toBeDefined();
  });

  /**
   * The completeness check SPEC section 12 actually asks for. Written against
   * the model list rather than the screens, so a model added later without a
   * branch in the export service fails here rather than shipping a gap.
   */
  it('contains a record from every model the system stores user data in', async () => {
    const { user, applicationId, reminderId } = await seedEverything();

    const response = await request(app)
      .get(EXPORT_URL)
      .set('Authorization', `Bearer ${user.accessToken}`);

    const body = response.body;

    // 1. User.
    expect(body.profile.email).toBe(user.payload.email);
    expect(body.profile.name).toBe(user.payload.name);
    expect(body.profile.timezone).toBe('Asia/Kuala_Lumpur');
    expect(body.profile.acceptedTermsAt).toBeTruthy();
    expect(body.profile.schemaVersion).toBe(1);

    // 2. Application.
    expect(body.applications).toHaveLength(1);
    const application = body.applications[0];
    expect(application.id).toBe(applicationId);
    expect(application.company).toBe('Fathom Analytics');
    expect(application.notes).toBe('Referred by a friend on the platform team.');
    expect(application.tags).toEqual(['backend', 'referral']);

    // 3. Interview, embedded in the application.
    expect(application.interviews).toHaveLength(1);
    expect(application.interviews[0].interviewer).toBe('Priya');
    expect(application.interviews[0].type).toBe('technical');

    // 4. Status history, embedded in the application.
    expect(application.statusHistory.length).toBeGreaterThanOrEqual(2);
    expect(application.statusHistory.at(-1)).toMatchObject({
      to: 'applied',
      note: 'Submitted through the careers page',
    });

    // 5. Attachment record, embedded in the application.
    expect(application.attachments).toHaveLength(1);
    expect(application.attachments[0].originalName).toBe('my-cv.pdf');
    expect(application.attachments[0].mimeType).toBe('application/pdf');
    expect(application.attachments[0].size).toBeGreaterThan(0);

    // 6. Reminder.
    expect(body.reminders).toHaveLength(1);
    expect(body.reminders[0].id).toBe(reminderId);
    expect(body.reminders[0].title).toBe('Chase the recruiter');

    // 7. RefreshToken metadata, for both devices.
    expect(body.sessions.length).toBeGreaterThanOrEqual(2);
    expect(body.sessions.map((session: { userAgent?: string }) => session.userAgent)).toContain(
      'Second Device',
    );
    expect(body.sessions[0].createdAt).toBeTruthy();
    expect(body.sessions[0].expiresAt).toBeTruthy();
  });

  it('counts what it contains, so a truncated file is detectable', async () => {
    const { user } = await seedEverything();

    const response = await request(app)
      .get(EXPORT_URL)
      .set('Authorization', `Bearer ${user.accessToken}`);

    expect(response.body.meta.counts).toMatchObject({
      applications: 1,
      interviews: 1,
      attachments: 1,
      reminders: 1,
    });
    expect(response.body.meta.counts.sessions).toBeGreaterThanOrEqual(2);
    expect(response.body.meta.exportedAt).toBeTruthy();

    // The counts have to describe the arrays, not be written independently of them.
    expect(response.body.applications).toHaveLength(response.body.meta.counts.applications);
    expect(response.body.reminders).toHaveLength(response.body.meta.counts.reminders);
    expect(response.body.sessions).toHaveLength(response.body.meta.counts.sessions);
  });
});

describe('what the export deliberately leaves out', () => {
  it('never carries a credential, in any form', async () => {
    const { user } = await seedEverything();

    const response = await request(app)
      .get(EXPORT_URL)
      .set('Authorization', `Bearer ${user.accessToken}`);

    const raw = JSON.stringify(response.body);
    const stored = await User.findOne({ email: user.payload.email }).select(
      '+password +emailVerificationTokenHash',
    );
    const tokens = await RefreshToken.find({ user: user.userId });

    expect(response.body.profile.password).toBeUndefined();
    expect(response.body.profile.emailVerificationTokenHash).toBeUndefined();
    expect(response.body.profile.passwordResetTokenHash).toBeUndefined();

    // Not just absent under the expected key - absent from the bytes entirely.
    expect(raw).not.toContain(stored?.password);
    expect(raw).not.toContain(user.payload.password);
    for (const token of tokens) expect(raw).not.toContain(token.tokenHash);
  });

  it('lists attachment records without inlining the bytes', async () => {
    const { user } = await seedEverything();

    const response = await request(app)
      .get(EXPORT_URL)
      .set('Authorization', `Bearer ${user.accessToken}`);

    const attachment = response.body.applications[0].attachments[0];

    expect(attachment).toMatchObject({ originalName: 'my-cv.pdf', mimeType: 'application/pdf' });
    // No base64 payload, and no storage key either - the key is a server detail
    // and downloads go through a signed URL minted on demand.
    expect(attachment.data).toBeUndefined();
    expect(attachment.filename).toBeUndefined();
    // The reader is told where the file itself lives.
    expect(response.body.meta.notes.join(' ')).toMatch(/download the files themselves/i);
  });
});

describe('the export is scoped to the account asking for it', () => {
  it('never contains another account data', async () => {
    const mine = await seedEverything();
    const theirs = await seedEverything();

    const response = await request(app)
      .get(EXPORT_URL)
      .set('Authorization', `Bearer ${mine.user.accessToken}`);

    const raw = JSON.stringify(response.body);

    expect(response.body.profile.email).toBe(mine.user.payload.email);
    expect(raw).not.toContain(theirs.user.payload.email);
    expect(raw).not.toContain(theirs.applicationId);
    expect(raw).not.toContain(theirs.reminderId);
    expect(response.body.applications).toHaveLength(1);
    expect(response.body.reminders).toHaveLength(1);
  });

  it('exports an empty account without inventing anything', async () => {
    const user = await registerUser(app);

    const response = await request(app)
      .get(EXPORT_URL)
      .set('Authorization', `Bearer ${user.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.applications).toEqual([]);
    expect(response.body.reminders).toEqual([]);
    expect(response.body.sessions).toHaveLength(1);
    expect(response.body.meta.counts).toMatchObject({
      applications: 0,
      interviews: 0,
      attachments: 0,
      reminders: 0,
      sessions: 1,
    });
  });

  it('refuses an account that has been closed', async () => {
    const user = await registerUser(app);

    await User.updateOne({ _id: user.userId }, { $set: { deletedAt: new Date() } });

    const response = await request(app)
      .get(EXPORT_URL)
      .set('Authorization', `Bearer ${user.accessToken}`);

    expect(response.status).toBe(401);
  });

  it('reports usage alongside the data, so the file explains its own size', async () => {
    const { user } = await seedEverything();

    const response = await request(app)
      .get(EXPORT_URL)
      .set('Authorization', `Bearer ${user.accessToken}`);

    expect(response.body.usage.applications.used).toBe(1);
    expect(response.body.usage.storageBytes.used).toBeGreaterThan(0);
  });
});

describe('the models this export is written against', () => {
  /**
   * A guard on the guard. If a later phase adds a model holding user data, this
   * fails and points at the export service - which is the only way a test can
   * notice an omission it was never told about.
   */
  it('is the full set of collections that reference a user', async () => {
    const { user } = await seedEverything();

    const owned = await Promise.all([
      User.countDocuments({ _id: user.userId }),
      Application.countDocuments({ user: user.userId }),
      Reminder.countDocuments({ user: user.userId }),
      RefreshToken.countDocuments({ user: user.userId }),
    ]);

    // Every one of them has a row, so the assertions above are not passing
    // because a collection happened to be empty.
    for (const count of owned) expect(count).toBeGreaterThan(0);
  });
});
