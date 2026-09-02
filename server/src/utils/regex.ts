const SPECIAL_CHARACTERS = /[.*+?^${}()|[\]\\]/g;

/**
 * Escapes user input before it reaches a RegExp (SPEC section 7). Without this a
 * search for `.*` would scan every document, and a crafted term could be used to
 * mount a denial of service through catastrophic backtracking.
 */
export function escapeRegex(value: string): string {
  return value.replace(SPECIAL_CHARACTERS, '\\$&');
}

/** Case insensitive substring match, for type-ahead search. */
export function containsRegex(value: string): RegExp {
  return new RegExp(escapeRegex(value), 'i');
}

/** Case insensitive whole value match, for filtering on an exact company name. */
export function exactRegex(value: string): RegExp {
  return new RegExp(`^${escapeRegex(value)}$`, 'i');
}
