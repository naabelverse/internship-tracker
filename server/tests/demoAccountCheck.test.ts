import request from 'supertest';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { User } from '@/models/User';
import { seedDemoAccount } from '@/scripts/seed';
import { announceDemoAccount } from '@/services/demoAccount.service';
import { AUTH_BASE, buildTestApp, useCleanAuthRateLimits } from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

/**
 * The boot-time demo check exists because an unseeded deployment fails only at
 * the moment a visitor clicks "Try the demo", and the 404 they see says nothing
 * about which step was skipped. These cases pin down that the check names the
 * missing piece, stays quiet when there is nothing to say, and can never take
 * the API down.
 */

useTestDatabase();
useCleanAuthRateLimits();

const app = buildTestApp();

let warn: jest.SpyInstance;
let info: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
  info = jest.spyOn(logger, 'info').mockImplementation(() => logger);
});

afterEach(() => {
  warn.mockRestore();
  info.mockRestore();
});

describe('announceDemoAccount', () => {
  it('warns with the configured address and the seed command when no demo account exists', async () => {
    await expect(announceDemoAccount()).resolves.toBe(false);

    expect(warn).toHaveBeenCalledTimes(1);
    const [message, meta] = warn.mock.calls[0] as [string, Record<string, unknown>];
    expect(message).toMatch(/demo account/i);
    expect(message).toMatch(/auth\/demo/);
    expect(meta).toMatchObject({ demoEmail: env.DEMO_EMAIL });
    expect(String(meta.fix)).toMatch(/npm run seed/);
  });

  it('is quiet once the seed has run', async () => {
    await seedDemoAccount();

    await expect(announceDemoAccount()).resolves.toBe(true);

    expect(warn).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/demo account/i), {
      demoEmail: env.DEMO_EMAIL,
    });
  });

  it('agrees with the sign-in: an account the route refuses is one the check reports missing', async () => {
    // The same two states `POST /auth/demo` answers 404 for. If the check and
    // the route ever used different lookups, the boot log could say "ready"
    // while every visitor met the error this check exists to explain.
    await request(app).post(`${AUTH_BASE}/register`).send({
      name: 'Squatter',
      email: env.DEMO_EMAIL,
      password: 'Str0ngPassw0rd',
      acceptTerms: true,
    });
    expect((await request(app).post(`${AUTH_BASE}/demo`)).status).toBe(404);
    await expect(announceDemoAccount()).resolves.toBe(false);

    await User.deleteMany({ email: env.DEMO_EMAIL });
    await seedDemoAccount();
    await User.updateOne({ email: env.DEMO_EMAIL }, { $set: { deletedAt: new Date() } });
    expect((await request(app).post(`${AUTH_BASE}/demo`)).status).toBe(404);
    await expect(announceDemoAccount()).resolves.toBe(false);
  });

  it('never throws, so a failed lookup cannot stop the API booting', async () => {
    // `findOne` returns a thenable query; a rejected promise stands in for one
    // whose execution failed. The cast is what lets a Promise take its place.
    const findOne = jest
      .spyOn(User, 'findOne')
      .mockImplementationOnce(() => Promise.reject(new Error('connection dropped')) as never);

    try {
      await expect(announceDemoAccount()).resolves.toBe(false);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/demo account/i), {
        message: 'connection dropped',
      });
    } finally {
      findOne.mockRestore();
    }
  });
});
