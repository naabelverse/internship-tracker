import request from 'supertest';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { runDemoReset } from '@/jobs/demoResetJob';
import { PURGE_AFTER_MS, purgeDeletedUsers } from '@/jobs/purgeDeletedUsersJob';
import { Application } from '@/models/Application';
import { User } from '@/models/User';
import { seedDemoAccount } from '@/scripts/seed';
import { addAttachment } from '@/services/attachment.service';
import { getStorage } from '@/storage';
import {
  APPLICATIONS_BASE,
  AUTH_BASE,
  attachFileTo,
  buildTestApp,
  createApplicationFor,
  registerUser,
  useCleanAuthRateLimits,
  type RegisteredUser,
} from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();
useCleanAuthRateLimits();

const app = buildTestApp();

/** Closes the account and moves its deletion date past the 30 day window. */
async function expireAccount(user: RegisteredUser): Promise<void> {
  const response = await request(app)
    .delete(`${AUTH_BASE}/me`)
    .set('Authorization', `Bearer ${user.accessToken}`)
    .send({ password: user.payload.password });

  expect(response.status).toBe(200);

  await User.updateOne(
    { _id: user.userId },
    { $set: { deletedAt: new Date(Date.now() - PURGE_AFTER_MS - 1000) } },
  );
}

/** Makes storage refuse to delete one key, and delete every other key for real. */
function failDeletionOf(failingKey: string): jest.SpyInstance {
  const storage = getStorage();
  const realDelete = storage.delete.bind(storage);

  return jest.spyOn(storage, 'delete').mockImplementation(async (key: string) => {
    if (key === failingKey) throw new Error('storage unavailable');
    await realDelete(key);
  });
}

const stored = (key: string): Promise<boolean> => getStorage().exists(key);

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the purge job erases uploaded files', () => {
  it('erases every file an expired account owned, and no one else’s', async () => {
    const doomed = await registerUser(app, { email: 'doomed@example.com' });
    const first = await createApplicationFor(app, doomed.accessToken);
    const second = await createApplicationFor(app, doomed.accessToken);
    const doomedKeys = [
      await attachFileTo(app, doomed.accessToken, first.id),
      await attachFileTo(app, doomed.accessToken, first.id),
      await attachFileTo(app, doomed.accessToken, second.id),
    ];

    const survivor = await registerUser(app, { email: 'survivor@example.com' });
    const kept = await createApplicationFor(app, survivor.accessToken);
    const survivorKey = await attachFileTo(app, survivor.accessToken, kept.id);

    await expireAccount(doomed);

    const result = await purgeDeletedUsers();

    expect(result).toMatchObject({ users: 1, applications: 2, filesErased: 3, filesFailed: 0 });
    for (const key of doomedKeys) {
      expect(await stored(key)).toBe(false);
    }
    expect(await stored(survivorKey)).toBe(true);
  });

  it('logs a failed file and still purges every account and every other file', async () => {
    const error = jest.spyOn(logger, 'error').mockImplementation(() => logger);

    const first = await registerUser(app, { email: 'first@example.com' });
    const firstApplication = await createApplicationFor(app, first.accessToken);
    const stuckKey = await attachFileTo(app, first.accessToken, firstApplication.id);
    const firstOtherKey = await attachFileTo(app, first.accessToken, firstApplication.id);

    const second = await registerUser(app, { email: 'second@example.com' });
    const secondApplication = await createApplicationFor(app, second.accessToken);
    const secondKey = await attachFileTo(app, second.accessToken, secondApplication.id);

    await expireAccount(first);
    await expireAccount(second);
    failDeletionOf(stuckKey);

    const result = await purgeDeletedUsers();

    expect(result).toMatchObject({ users: 2, applications: 2, filesErased: 2, filesFailed: 1 });
    expect(await User.countDocuments({})).toBe(0);
    expect(await Application.countDocuments({})).toBe(0);
    expect(await stored(firstOtherKey)).toBe(false);
    expect(await stored(secondKey)).toBe(false);
    expect(error).toHaveBeenCalledWith(
      'Stored file could not be erased',
      expect.objectContaining({ key: stuckKey, reason: 'storage unavailable' }),
    );
  });
});

describe('deleting an application erases its files', () => {
  it('erases the files of a single deleted application', async () => {
    const { accessToken } = await registerUser(app);
    const doomed = await createApplicationFor(app, accessToken);
    const kept = await createApplicationFor(app, accessToken);
    const doomedKeys = [
      await attachFileTo(app, accessToken, doomed.id),
      await attachFileTo(app, accessToken, doomed.id),
    ];
    const keptKey = await attachFileTo(app, accessToken, kept.id);

    const response = await request(app)
      .delete(`${APPLICATIONS_BASE}/${doomed.id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    for (const key of doomedKeys) {
      expect(await stored(key)).toBe(false);
    }
    expect(await stored(keptKey)).toBe(true);
  });

  it('never erases the files of an application someone else owns', async () => {
    const owner = await registerUser(app, { email: 'owner@example.com' });
    const application = await createApplicationFor(app, owner.accessToken);
    const key = await attachFileTo(app, owner.accessToken, application.id);

    const intruder = await registerUser(app, { email: 'intruder@example.com' });
    const response = await request(app)
      .delete(`${APPLICATIONS_BASE}/${application.id}`)
      .set('Authorization', `Bearer ${intruder.accessToken}`);

    expect(response.status).toBe(404);
    expect(await stored(key)).toBe(true);
  });

  it('still deletes the application when storage fails, and logs the file', async () => {
    const error = jest.spyOn(logger, 'error').mockImplementation(() => logger);
    const { accessToken } = await registerUser(app);
    const application = await createApplicationFor(app, accessToken);
    const key = await attachFileTo(app, accessToken, application.id);
    failDeletionOf(key);

    const response = await request(app)
      .delete(`${APPLICATIONS_BASE}/${application.id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(await Application.findById(application.id)).toBeNull();
    expect(error).toHaveBeenCalledWith(
      'Stored file could not be erased',
      expect.objectContaining({ key }),
    );
  });

  it('erases the files of every application in a bulk delete', async () => {
    const { accessToken } = await registerUser(app);
    const first = await createApplicationFor(app, accessToken);
    const second = await createApplicationFor(app, accessToken);
    const kept = await createApplicationFor(app, accessToken);
    const doomedKeys = [
      await attachFileTo(app, accessToken, first.id),
      await attachFileTo(app, accessToken, second.id),
    ];
    const keptKey = await attachFileTo(app, accessToken, kept.id);

    const response = await request(app)
      .post(`${APPLICATIONS_BASE}/bulk`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ids: [first.id, second.id], action: 'delete' });

    expect(response.status).toBe(200);
    expect(response.body.data.modified).toBe(2);
    for (const key of doomedKeys) {
      expect(await stored(key)).toBe(false);
    }
    expect(await stored(keptKey)).toBe(true);
  });
});

describe('the demo reset erases uploaded files', () => {
  it('erases a file a demo visitor attached before the nightly reset', async () => {
    await seedDemoAccount();
    const demo = await User.findOne({ email: env.DEMO_EMAIL });
    const application = await Application.findOne({ user: demo?._id });
    if (!demo || !application) throw new Error('Seed did not create the demo account');

    const updated = await addAttachment(demo._id, application.id as string, {
      originalname: 'visitor.pdf',
      mimetype: 'application/pdf',
      size: 16,
      buffer: Buffer.from('%PDF-1.7\nvisitor\n', 'utf8'),
    });
    const key = updated.attachments[0].filename;
    expect(await stored(key)).toBe(true);

    await runDemoReset();

    expect(await stored(key)).toBe(false);
  });
});
