import type { ScheduledTask } from 'node-cron';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { startPurgeCron } from '@/jobs/purgeDeletedUsersJob';
import { startReminderCron } from '@/jobs/reminderJob';
import { startWeeklySummaryCron } from '@/jobs/weeklySummaryJob';

const tasks: ScheduledTask[] = [];

export function startScheduledJobs(): void {
  if (!env.ENABLE_CRON) {
    logger.info('Scheduler disabled by ENABLE_CRON');
    return;
  }

  tasks.push(startReminderCron());
  tasks.push(startWeeklySummaryCron());
  tasks.push(startPurgeCron());
  logger.info('Scheduled jobs started', { count: tasks.length });
}

/** Stops every task so a graceful shutdown does not leave a timer holding the process open. */
export async function stopScheduledJobs(): Promise<void> {
  await Promise.all(tasks.splice(0).map((task) => task.stop()));
}
