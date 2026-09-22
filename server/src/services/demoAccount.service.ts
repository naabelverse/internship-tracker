import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { User, type UserDocument } from '@/models/User';

/**
 * The one lookup behind "Try the demo". `loginAsDemo` signs a visitor into
 * whatever this returns, and `announceDemoAccount` reports at boot whether it
 * returns anything; sharing the query is what stops the two from disagreeing.
 *
 * `isDemo: true` keeps a squatter who registered the address before the seed
 * ran out of the demo, and `deletedAt: null` keeps a closed account out.
 */
export async function findDemoAccount(): Promise<UserDocument | null> {
  return User.findOne({ email: env.DEMO_EMAIL, isDemo: true, deletedAt: null });
}

/**
 * Boot-time check for the demo account, in the spirit of `initMailer`: a deploy
 * whose landing page shows "Try the demo" but whose database was never seeded
 * says so in the startup log, naming the address it looked for and the command
 * that creates it. Without this the first sign of the problem is a visitor's
 * 404, and the only line in the logs is the reset job's nightly "skipped".
 *
 * Never throws. A missing demo account is a legitimate configuration, and a
 * lookup that fails moments after the connection succeeded is not a reason to
 * take the API down, so both cases resolve to `false` and log.
 */
export async function announceDemoAccount(): Promise<boolean> {
  try {
    const account = await findDemoAccount();

    if (account) {
      logger.info('Demo account ready', { demoEmail: env.DEMO_EMAIL });
      return true;
    }

    logger.warn(
      'No demo account on this deployment: POST /auth/demo answers 404 until it is seeded',
      {
        demoEmail: env.DEMO_EMAIL,
        fix: 'run "npm run seed -w server" against this database (on Railway: "railway run npm run seed -w server")',
      },
    );
    return false;
  } catch (error) {
    logger.warn('Could not check for the demo account', {
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
