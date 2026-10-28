import type { z } from 'zod';

/**
 * Parse options that keep "Required" as the message for a missing value. Zod 4's
 * default, "Invalid input: expected string, received undefined", reads like a type
 * bug rather than a field someone left out. A message written on a schema still wins.
 */
export const parseOptions: z.core.ParseContext<z.core.$ZodIssue> = {
  error: (issue) =>
    issue.code === 'invalid_type' && issue.input === undefined ? 'Required' : undefined,
};
