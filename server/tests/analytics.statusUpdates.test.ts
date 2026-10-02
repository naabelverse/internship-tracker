import { Types } from 'mongoose';
import { Application } from '@/models/Application';
import { getTimeline } from '@/services/analytics.service';
import { loadDemoData } from '@/services/demoData.service';
import { buildTestApp, registerUser, useCleanAuthRateLimits } from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();
useCleanAuthRateLimits();

const app = buildTestApp();

const KL = 'Asia/Kuala_Lumpur';

/** Friday 2 Oct 2026, 20:16 in Kuala Lumpur: when the demo account was measured. */
const NOW = new Date('2026-10-02T12:16:00Z');

/** Monday 13 Jul 2026 at local midnight, the first day of the dashboard's twelve-week grid. */
const GRID_START = new Date('2026-07-12T16:00:00Z');

/**
 * The client shows `statusChanges - created` as status updates, on the claim
 * that `statusChanges` counts each new application's opening `from: null`
 * entry once, in the same bucket as its `createdAt`. These hold the server to
 * that claim on the demo set, the data the demo account actually shows.
 */
describe('timeline statusChanges include each application’s opening entry', () => {
  async function demoUser(): Promise<Types.ObjectId> {
    const { userId } = await registerUser(app, { timezone: KL });
    const id = new Types.ObjectId(userId);
    await loadDemoData(id, NOW);
    return id;
  }

  it('gives the demo account 41 added and 53 status updates across the grid', async () => {
    const user = await demoUser();
    const points = (await getTimeline(user, KL, 'day', '90d', NOW)).filter(
      (point) => new Date(point.bucket) >= GRID_START,
    );

    const created = points.reduce((sum, point) => sum + point.created, 0);
    const raw = points.reduce((sum, point) => sum + point.statusChanges, 0);

    expect(created).toBe(41);
    expect(raw).toBe(94);
    expect(raw - created).toBe(53);
  });

  it('matches the moves counted straight off the documents, bucket by bucket', async () => {
    const user = await demoUser();
    const points = await getTimeline(user, KL, 'day', '90d', NOW);
    const documents = await Application.find({ user }).lean();
    const windowStart = NOW.getTime() - 90 * 86_400_000;

    // Entries with a `from` are real moves; each document has exactly one without.
    const moves = documents.flatMap((doc) =>
      doc.statusHistory.filter(
        (entry) => entry.from !== null && entry.changedAt.getTime() >= windowStart,
      ),
    );
    expect(documents.every((doc) => doc.statusHistory[0]?.from === null)).toBe(true);

    for (const point of points) {
      const start = new Date(point.bucket).getTime();
      const inBucket = moves.filter((entry) => {
        const at = entry.changedAt.getTime();
        return at >= start && at < start + 86_400_000;
      }).length;

      expect({ bucket: point.bucket, moves: point.statusChanges - point.created }).toEqual({
        bucket: point.bucket,
        moves: inBucket,
      });
    }
  });
});
