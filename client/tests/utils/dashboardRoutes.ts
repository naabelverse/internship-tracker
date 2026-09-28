import { successBody } from './factories';
import type { Responder } from './mockAdapter';

/**
 * Every request the dashboard makes, answered with an empty account, so a test
 * that mounts the whole `App` on the dashboard can settle without a stray
 * "no mock route" failure pulling focus from what it is really about.
 */
export const dashboardRoutes: Record<string, Responder> = {
  'GET /analytics/summary': () => ({
    status: 200,
    data: successBody({
      total: 0,
      active: 0,
      applied: 0,
      responded: 0,
      interviewed: 0,
      offers: 0,
      responseRate: 0,
      interviewRate: 0,
      offerRate: 0,
      avgDaysToFirstResponse: null,
      currentStreakDays: 0,
      weeklyGoal: { target: 5, completed: 0, percentage: 0, previousCompleted: 0 },
      period: {
        days: 30,
        current: {
          created: 0,
          active: 0,
          applied: 0,
          responded: 0,
          interviewed: 0,
          offers: 0,
          responseRate: 0,
        },
        previous: {
          created: 0,
          active: 0,
          applied: 0,
          responded: 0,
          interviewed: 0,
          offers: 0,
          responseRate: 0,
        },
      },
    }),
  }),
  'GET /analytics/status-breakdown': () => ({ status: 200, data: successBody({ breakdown: [] }) }),
  'GET /analytics/timeline': () => ({
    status: 200,
    data: successBody({ granularity: 'day', range: '90d', points: [] }),
  }),
  'GET /analytics/by-source': () => ({ status: 200, data: successBody({ sources: [] }) }),
  'GET /analytics/funnel': () => ({ status: 200, data: successBody({ stages: [] }) }),
  'GET /analytics/top-companies': () => ({ status: 200, data: successBody({ companies: [] }) }),
  'GET /calendar': () => ({ status: 200, data: successBody({ events: [] }) }),
};
