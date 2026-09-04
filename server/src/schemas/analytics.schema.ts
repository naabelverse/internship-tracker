import { z } from 'zod';

/** The comparison window behind every stat card delta, in days. */
export const summaryQuerySchema = z
  .object({ periodDays: z.coerce.number().int().min(1).max(365).default(30) })
  .strict();

export const timelineQuerySchema = z
  .object({
    granularity: z.enum(['day', 'week', 'month']).default('day'),
    range: z.enum(['30d', '90d', '1y']).default('90d'),
  })
  .strict();

export const topCompaniesQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(50).default(10) })
  .strict();

export type SummaryQuery = z.infer<typeof summaryQuerySchema>;
export type TimelineQuery = z.infer<typeof timelineQuerySchema>;
export type TopCompaniesQuery = z.infer<typeof topCompaniesQuerySchema>;
