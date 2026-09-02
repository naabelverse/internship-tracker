import type { Types } from 'mongoose';
import {
  runReminderSweep,
  selectDueReminders,
  selectTimeZonesAtDigestHour,
} from '@/jobs/reminderJob';
import { Reminder } from '@/models/Reminder';
import { User } from '@/models/User';
import { buildTestApp, registerUser, useCleanAuthRateLimits } from './helpers/factories';
import { useTestDatabase } from './helpers/testDb';

useTestDatabase();
useCleanAuthRateLimits();

const app = buildTestApp();

const KL = 'Asia/Kuala_Lumpur';
const LA = 'America/Los_Angeles';

// Long past, so every reminder below is due in absolute terms at every instant
// tested. What varies is only whether delivery is allowed in that UTC hour.
const LONG_DUE = new Date('2026-01-01T00:00:00Z');

// Digest hour is 08:00 local.
// Kuala Lumpur is UTC+8 all year, so 08:00 local is 00:00 UTC.
// Los Angeles is UTC-7 in summer and UTC-8 in winter, so 08:00 local moves
// between 15:00 and 16:00 UTC. That shift is the reason a stored offset is not
// good enough and Intl has to resolve the hour.
const KL_DIGEST_UTC = new Date('2026-03-10T00:00:00Z');
const LA_DIGEST_UTC_SUMMER = new Date('2026-03-10T15:00:00Z');
const LA_DIGEST_UTC_WINTER = new Date('2026-01-10T16:00:00Z');

async function seedUser(timeZone: string): Promise<Types.ObjectId> {
  const registered = await registerUser(app, { timezone: timeZone });
  const user = await User.findById(registered.userId);
  if (!user) throw new Error('user was not created');
  return user._id;
}

async function seedReminder(
  user: Types.ObjectId,
  channel: 'email' | 'in_app' = 'email',
  dueAt: Date = LONG_DUE,
): Promise<void> {
  await Reminder.create({ user, type: 'custom', title: 'Deadline digest', dueAt, channel });
}

describe('reminder sweep selects by local hour, not UTC hour', () => {
  it('selects a Kuala Lumpur account at 00:00 UTC and not at 15:00 UTC', async () => {
    const user = await seedUser(KL);
    await seedReminder(user);

    const atLocalMorning = await selectDueReminders(KL_DIGEST_UTC);
    const atOtherHour = await selectDueReminders(LA_DIGEST_UTC_SUMMER);

    expect(atLocalMorning).toHaveLength(1);
    expect(atOtherHour).toHaveLength(0);
  });

  it('selects a Los Angeles account at 15:00 UTC in summer and not at 00:00 UTC', async () => {
    const user = await seedUser(LA);
    await seedReminder(user);

    const atLocalMorning = await selectDueReminders(LA_DIGEST_UTC_SUMMER);
    const atOtherHour = await selectDueReminders(KL_DIGEST_UTC);

    expect(atLocalMorning).toHaveLength(1);
    expect(atOtherHour).toHaveLength(0);
  });

  it('follows the account across a daylight saving change', async () => {
    const user = await seedUser(LA);
    await seedReminder(user);

    const winterCorrect = await selectDueReminders(LA_DIGEST_UTC_WINTER);
    const winterSummerHour = await selectDueReminders(new Date('2026-01-10T15:00:00Z'));

    expect(winterCorrect).toHaveLength(1);
    // 15:00 UTC is 07:00 local in winter, an hour too early.
    expect(winterSummerHour).toHaveLength(0);
  });

  it('never fires two accounts in distant zones on the same tick', async () => {
    const klUser = await seedUser(KL);
    const laUser = await seedUser(LA);
    await seedReminder(klUser);
    await seedReminder(laUser);

    const klTick = await selectDueReminders(KL_DIGEST_UTC);
    const laTick = await selectDueReminders(LA_DIGEST_UTC_SUMMER);

    expect(klTick.map((reminder) => reminder.user.toString())).toEqual([klUser.toString()]);
    expect(laTick.map((reminder) => reminder.user.toString())).toEqual([laUser.toString()]);
  });

  it('reports only the zones whose clock currently reads the digest hour', async () => {
    await seedUser(KL);
    await seedUser(LA);

    expect(await selectTimeZonesAtDigestHour(KL_DIGEST_UTC)).toEqual([KL]);
    expect(await selectTimeZonesAtDigestHour(LA_DIGEST_UTC_SUMMER)).toEqual([LA]);
    expect(await selectTimeZonesAtDigestHour(new Date('2026-03-10T03:00:00Z'))).toEqual([]);
  });
});

describe('reminder sweep selection rules', () => {
  it('ignores a reminder that has not come due yet', async () => {
    const user = await seedUser(KL);
    await seedReminder(user, 'email', new Date('2026-06-01T00:00:00Z'));

    expect(await selectDueReminders(KL_DIGEST_UTC)).toHaveLength(0);
  });

  it('ignores in-app reminders, which need no delivery window', async () => {
    const user = await seedUser(KL);
    await seedReminder(user, 'in_app');

    expect(await selectDueReminders(KL_DIGEST_UTC)).toHaveLength(0);
  });

  it('ignores an account that has turned email reminders off', async () => {
    const user = await seedUser(KL);
    await seedReminder(user);
    await User.updateOne({ _id: user }, { $set: { emailRemindersEnabled: false } });

    expect(await selectDueReminders(KL_DIGEST_UTC)).toHaveLength(0);
  });

  it('marks a swept batch as sent so the next tick does not repeat it', async () => {
    const user = await seedUser(KL);
    await seedReminder(user);

    const first = await runReminderSweep(KL_DIGEST_UTC);
    const second = await runReminderSweep(KL_DIGEST_UTC);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);

    const stored = await Reminder.findOne({ user });
    expect(stored?.sent).toBe(true);
    expect(stored?.sentAt).toBeInstanceOf(Date);
  });
});
