import request from 'supertest';
import { resetAuthRateLimiters } from '@/middleware/rateLimit';
import { RefreshToken } from '@/models/RefreshToken';
import { hashRefreshToken, REFRESH_REUSE_GRACE_MS } from '@/services/token.service';
import { REFRESH_COOKIE_NAME } from '@/utils/cookies';
import {
  AUTH_BASE,
  buildTestApp,
  cookieValue,
  extractRefreshCookie,
  registerUser,
} from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();

const app = buildTestApp();

// Auth limiters are live during tests; clear the counters so one case cannot
// throttle the next.
beforeEach(() => {
  resetAuthRateLimiters();
});

const refresh = (cookie?: string): request.Test => {
  const test = request(app).post(`${AUTH_BASE}/refresh`);
  return cookie === undefined ? test : test.set('Cookie', cookie);
};

/** Pushes a revocation into the past so a replay is no longer inside the race window. */
async function ageRevocation(cookie: string, millisecondsAgo: number): Promise<void> {
  await RefreshToken.updateOne(
    { tokenHash: hashRefreshToken(cookieValue(cookie)) },
    { $set: { revokedAt: new Date(Date.now() - millisecondsAgo) } },
  );
}

describe('POST /auth/refresh', () => {
  describe('happy path', () => {
    it('rotates the token and returns a new access token', async () => {
      const { refreshCookie } = await registerUser(app);

      const response = await refresh(refreshCookie);

      expect(response.status).toBe(200);
      expect(typeof response.body.data.accessToken).toBe('string');

      const rotated = extractRefreshCookie(response);
      expect(cookieValue(rotated)).not.toBe(cookieValue(refreshCookie));
    });

    it('keeps the rotated token in the same family and links replacedBy', async () => {
      const { refreshCookie, userId } = await registerUser(app);

      const response = await refresh(refreshCookie);
      const rotated = extractRefreshCookie(response);

      const previous = await RefreshToken.findOne({
        tokenHash: hashRefreshToken(cookieValue(refreshCookie)),
      });
      const next = await RefreshToken.findOne({
        tokenHash: hashRefreshToken(cookieValue(rotated)),
      });

      expect(previous?.revokedReason).toBe('rotated');
      expect(previous?.replacedBy?.toString()).toBe(next?._id.toString());
      expect(next?.family).toBe(previous?.family);
      expect(next?.user.toString()).toBe(userId);
    });
  });

  describe('concurrent use of one token', () => {
    it('lets exactly one of two simultaneous requests win and does not revoke the family', async () => {
      const { refreshCookie, userId } = await registerUser(app);

      // Both requests are dispatched before either resolves, so they genuinely
      // race for the same document rather than running back to back.
      const [first, second] = await Promise.all([refresh(refreshCookie), refresh(refreshCookie)]);

      const statuses = [first.status, second.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 401]);

      const winner = first.status === 200 ? first : second;
      const loser = first.status === 200 ? second : first;

      expect(loser.body.code).toBe('REFRESH_TOKEN_RACE');

      // Reuse detection must not have fired: nothing marked, family still alive.
      const reuseRevocations = await RefreshToken.countDocuments({
        user: userId,
        revokedReason: 'reuse_detected',
      });
      expect(reuseRevocations).toBe(0);

      // The token issued to the winner still works, proving the session survived.
      const followUp = await refresh(extractRefreshCookie(winner));
      expect(followUp.status).toBe(200);
    });

    it('has both requests outstanding at the same time, not one after the other', async () => {
      const { refreshCookie } = await registerUser(app);

      const spans: { start: number; end: number }[] = [];
      const timed = async (): Promise<number> => {
        const start = Date.now();
        const response = await refresh(refreshCookie);
        spans.push({ start, end: Date.now() });
        return response.status;
      };

      await Promise.all([timed(), timed()]);

      const [a, b] = spans;
      // Overlapping intervals prove the second request was already in flight
      // while the first was still unresolved. Without this the RACE assertions
      // below would also pass for two sequential calls, which is a weaker claim.
      expect(a.start).toBeLessThan(b.end);
      expect(b.start).toBeLessThan(a.end);
    });

    it('serialises a burst of five simultaneous requests down to one winner', async () => {
      const { refreshCookie, userId } = await registerUser(app);

      const responses = await Promise.all(Array.from({ length: 5 }, () => refresh(refreshCookie)));

      const succeeded = responses.filter((response) => response.status === 200);
      const rejected = responses.filter((response) => response.status === 401);

      expect(succeeded).toHaveLength(1);
      expect(rejected).toHaveLength(4);
      expect(rejected.every((response) => response.body.code === 'REFRESH_TOKEN_RACE')).toBe(true);

      const reuseRevocations = await RefreshToken.countDocuments({
        user: userId,
        revokedReason: 'reuse_detected',
      });
      expect(reuseRevocations).toBe(0);

      const live = await RefreshToken.countDocuments({ user: userId, revokedAt: null });
      expect(live).toBe(1);
    });

    it('rejects a sequential second use inside the grace window without punishing the account', async () => {
      const { refreshCookie, userId } = await registerUser(app);

      const firstUse = await refresh(refreshCookie);
      expect(firstUse.status).toBe(200);

      const secondUse = await refresh(refreshCookie);

      expect(secondUse.status).toBe(401);
      expect(secondUse.body.code).toBe('REFRESH_TOKEN_RACE');

      const live = await RefreshToken.countDocuments({ user: userId, revokedAt: null });
      expect(live).toBe(1);
    });
  });

  describe('reuse detection', () => {
    it('revokes the entire family when a rotated token is replayed after the grace window', async () => {
      const { refreshCookie, userId } = await registerUser(app);

      const rotated = await refresh(refreshCookie);
      const liveCookie = extractRefreshCookie(rotated);

      await ageRevocation(refreshCookie, REFRESH_REUSE_GRACE_MS + 5_000);

      const replay = await refresh(refreshCookie);

      expect(replay.status).toBe(401);
      expect(replay.body.code).toBe('REFRESH_TOKEN_REUSED');

      // The honest descendant is collateral damage, which is the point: the
      // whole family is treated as compromised.
      const afterReuse = await refresh(liveCookie);
      expect(afterReuse.status).toBe(401);

      const live = await RefreshToken.countDocuments({ user: userId, revokedAt: null });
      expect(live).toBe(0);
    });

    it('revokes only the compromised family, leaving other sessions signed in', async () => {
      const registered = await registerUser(app);
      const secondLogin = await request(app).post(`${AUTH_BASE}/login`).send({
        email: registered.payload.email,
        password: registered.payload.password,
      });
      const otherFamilyCookie = extractRefreshCookie(secondLogin);

      await refresh(registered.refreshCookie);
      await ageRevocation(registered.refreshCookie, REFRESH_REUSE_GRACE_MS + 5_000);
      const replay = await refresh(registered.refreshCookie);

      expect(replay.body.code).toBe('REFRESH_TOKEN_REUSED');

      const otherSession = await refresh(otherFamilyCookie);
      expect(otherSession.status).toBe(200);
    });
  });

  describe('invalid input', () => {
    it('rejects a request with no cookie', async () => {
      const response = await refresh();

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('MISSING_REFRESH_TOKEN');
    });

    it('rejects an unknown token without touching any family', async () => {
      const { userId } = await registerUser(app);

      const response = await refresh(`${REFRESH_COOKIE_NAME}=not-a-real-token`);

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('INVALID_REFRESH_TOKEN');

      const live = await RefreshToken.countDocuments({ user: userId, revokedAt: null });
      expect(live).toBe(1);
    });

    it('rejects an expired token', async () => {
      const { refreshCookie } = await registerUser(app);

      await RefreshToken.updateOne(
        { tokenHash: hashRefreshToken(cookieValue(refreshCookie)) },
        { $set: { expiresAt: new Date(Date.now() - 1_000) } },
      );

      const response = await refresh(refreshCookie);

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('REFRESH_TOKEN_EXPIRED');
    });

    it('clears the dead cookie when rotation fails', async () => {
      const response = await refresh(`${REFRESH_COOKIE_NAME}=not-a-real-token`);

      const setCookie: unknown = response.headers['set-cookie'];
      const cookies = (Array.isArray(setCookie) ? setCookie : [setCookie]).filter(
        (value): value is string => typeof value === 'string',
      );

      expect(cookies.some((value) => value.startsWith(`${REFRESH_COOKIE_NAME}=;`))).toBe(true);
    });
  });
});
