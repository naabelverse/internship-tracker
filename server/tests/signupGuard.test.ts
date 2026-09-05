import { readFileSync } from 'node:fs';
import type * as NodeFs from 'node:fs';
import request from 'supertest';
import type { Express } from 'express';
import { User } from '@/models/User';
import { MIN_SIGNUP_FILL_MS } from '@/services/signupGuard.service';
import {
  loadDisposableDomains,
  parseDomainList,
  resetDisposableDomainCache,
} from '@/utils/disposableDomains';
import {
  AUTH_BASE,
  buildRegisterPayload,
  buildTestApp,
  useCleanAuthRateLimits,
} from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

const actualFs = jest.requireActual<typeof NodeFs>('node:fs');

// Only `readFileSync` is replaced, and only so the fail-open path below can be
// reached. Everything else on the module is the real thing.
jest.mock('node:fs', () => {
  const real = jest.requireActual<typeof NodeFs>('node:fs');

  return { ...real, readFileSync: jest.fn(real.readFileSync) };
});

const mockedReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;

useTestDatabase();
useCleanAuthRateLimits();

let app: Express;

beforeAll(() => {
  app = buildTestApp();
});

beforeEach(() => {
  resetDisposableDomainCache();
});

afterEach(() => {
  mockedReadFileSync.mockImplementation(actualFs.readFileSync);
  resetDisposableDomainCache();
});

/** Accepts the factory payload as-is, plus whatever extra fields a case adds. */
function post(body: object) {
  return request(app).post(`${AUTH_BASE}/register`).send(body);
}

describe('the bundled disposable-domain list', () => {
  it('parses, ignoring comments and blanks', () => {
    const parsed = parseDomainList(
      ['# a comment', '', 'Mailinator.com ', 'yopmail.com', '   ', '# another'].join('\n'),
    );

    expect([...parsed].sort()).toEqual(['mailinator.com', 'yopmail.com']);
  });

  it('actually loads from the repository, so the check is not silently inert', () => {
    const domains = loadDisposableDomains();

    expect(domains.size).toBeGreaterThan(100);
    expect(domains.has('mailinator.com')).toBe(true);
    expect(domains.has('guerrillamail.com')).toBe(true);
    // A real provider must never be on it.
    expect(domains.has('gmail.com')).toBe(false);
    expect(domains.has('outlook.com')).toBe(false);
  });
});

describe('disposable email addresses', () => {
  it('are refused at registration, with a reason the user can act on', async () => {
    const payload = buildRegisterPayload({ email: 'throwaway@mailinator.com' });

    const response = await post(payload);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('DISPOSABLE_EMAIL');
    expect(response.body.message).toMatch(/disposable/i);
    expect(await User.countDocuments({ email: payload.email })).toBe(0);
  });

  it('are matched case-insensitively, so MailInator.COM does not slip through', async () => {
    const response = await post(buildRegisterPayload({ email: 'Throwaway@MailInator.COM' }));

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('DISPOSABLE_EMAIL');
  });

  it('do not block an ordinary address', async () => {
    const response = await post(buildRegisterPayload({ email: 'ada@example.com' }));

    expect(response.status).toBe(201);
  });
});

/**
 * The requirement SPEC section 12 is explicit about, and the one worth a test of
 * its own: an anti-abuse measure that can take registration down when its own
 * data file is missing has traded a nuisance for an outage.
 */
describe('when the blocklist cannot be loaded, registration still works', () => {
  function breakTheList(): void {
    mockedReadFileSync.mockImplementation((...args: Parameters<typeof readFileSync>) => {
      if (String(args[0]).includes('disposable-email-domains')) {
        throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
      }

      return actualFs.readFileSync(...args);
    });
  }

  it('fails open rather than refusing every address', () => {
    breakTheList();

    expect(loadDisposableDomains().size).toBe(0);
  });

  it('registers an ordinary address exactly as it would have', async () => {
    breakTheList();

    const response = await post(buildRegisterPayload());

    expect(response.status).toBe(201);
    expect(response.body.data.accessToken).toBeTruthy();
  });

  it('even lets a disposable address through, which is the trade being made', async () => {
    breakTheList();

    const response = await post(buildRegisterPayload({ email: 'throwaway@mailinator.com' }));

    // Allowing a throwaway signup is a nuisance. Refusing every signup because a
    // text file is missing is an outage. This asserts which one was chosen.
    expect(response.status).toBe(201);
  });

  it('recovers once the file is readable again, without a restart', () => {
    breakTheList();
    expect(loadDisposableDomains().size).toBe(0);

    mockedReadFileSync.mockImplementation(actualFs.readFileSync);
    resetDisposableDomainCache();

    expect(loadDisposableDomains().size).toBeGreaterThan(100);
  });
});

describe('the honeypot field', () => {
  it('rejects a signup that filled it', async () => {
    const payload = buildRegisterPayload();

    const response = await post({ ...payload, website: 'https://spam.example' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('SIGNUP_REJECTED');
    expect(await User.countDocuments({ email: payload.email })).toBe(0);
  });

  it('says nothing about which check tripped', async () => {
    const response = await post({ ...buildRegisterPayload(), website: 'https://spam.example' });

    expect(response.body.message).not.toMatch(/honeypot|website|bot|timing/i);
    expect(response.body.message).toMatch(/automated/i);
  });

  it('accepts the empty string the real form submits', async () => {
    const response = await post({ ...buildRegisterPayload(), website: '' });

    expect(response.status).toBe(201);
  });

  it('accepts a body that omits it entirely', async () => {
    const response = await post(buildRegisterPayload());

    expect(response.status).toBe(201);
  });
});

describe('the timing check', () => {
  it('rejects a form submitted faster than a person could fill it', async () => {
    const payload = buildRegisterPayload();

    const response = await post({ ...payload, elapsedMs: 120 });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('SIGNUP_REJECTED');
    expect(await User.countDocuments({ email: payload.email })).toBe(0);
  });

  it('rejects the millisecond below the threshold and accepts the threshold itself', async () => {
    const tooFast = await post({ ...buildRegisterPayload(), elapsedMs: MIN_SIGNUP_FILL_MS - 1 });
    expect(tooFast.status).toBe(400);

    const justEnough = await post({ ...buildRegisterPayload(), elapsedMs: MIN_SIGNUP_FILL_MS });
    expect(justEnough.status).toBe(201);
  });

  it('accepts a body that omits it, so a non-browser client is not locked out', async () => {
    const response = await post(buildRegisterPayload());

    expect(response.status).toBe(201);
  });

  it('leaves the rejection recoverable: the same person can try again', async () => {
    const payload = buildRegisterPayload();

    expect((await post({ ...payload, elapsedMs: 50 })).status).toBe(400);
    expect((await post({ ...payload, elapsedMs: 9_000 })).status).toBe(201);
  });
});

describe('the guard runs before anything is created', () => {
  it('does not write a user, and does not consume the email, on rejection', async () => {
    const payload = buildRegisterPayload();

    await post({ ...payload, website: 'filled-by-a-bot' });

    expect(await User.countDocuments({})).toBe(0);

    // The address is still free, which it would not be if a partial row survived.
    expect((await post(payload)).status).toBe(201);
  });
});
