import type { TimelinePoint } from '@/types/analytics';

/**
 * Status changes that moved an existing application, leaving out the ones
 * that created it.
 *
 * The server's `statusChanges` counts every `statusHistory` entry in the
 * bucket, and every application's history opens with a `from: null` entry
 * written as it is created — by the form, the CSV import and the demo set
 * alike. So each application added is also counted once as a status change.
 * That entry and `createdAt` are the same moment, so they always land in the
 * same bucket, and taking the bucket's `created` away removes exactly them.
 *
 * Never below zero: a bucket cannot hold more openings than entries.
 */
export function statusUpdates(point: Pick<TimelinePoint, 'created' | 'statusChanges'>): number {
  return Math.max(0, point.statusChanges - point.created);
}
