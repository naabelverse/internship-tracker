import { z } from 'zod';

export const timelineQuerySchema = z
  .object({
    granularity: z.enum(['day', 'week', 'month']).default('day'),
    range: z.enum(['30d', '90d', '1y']).default('90d'),
  })
  .strict();

export const topCompaniesQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(50).default(10) })
  .strict();

export type TimelineQuery = z.infer<typeof timelineQuerySchema>;
export type TopCompaniesQuery = z.infer<typeof topCompaniesQuerySchema>;
