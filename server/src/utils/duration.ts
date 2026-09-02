const UNIT_TO_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const DURATION_PATTERN = /^(\d+)(s|m|h|d)$/;

/**
 * Parses a short duration string such as `15m` or `7d` into milliseconds.
 * Token lifetimes come from the environment as strings, and a silently wrong
 * lifetime is a security bug, so anything unparseable throws instead.
 */
export function parseDuration(value: string): number {
  const match = DURATION_PATTERN.exec(value.trim());

  if (!match) {
    throw new Error(
      `Invalid duration "${value}". Expected a positive number followed by s, m, h or d (for example "15m" or "7d").`,
    );
  }

  const amount = Number(match[1]);
  const milliseconds = amount * UNIT_TO_MS[match[2]];

  if (milliseconds <= 0) {
    throw new Error(`Invalid duration "${value}". Must be greater than zero.`);
  }

  return milliseconds;
}

/** Same as `parseDuration`, expressed in whole seconds for JWT `expiresIn`. */
export function parseDurationSeconds(value: string): number {
  return Math.floor(parseDuration(value) / 1000);
}
