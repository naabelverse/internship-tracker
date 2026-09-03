/**
 * Joins class names, dropping anything falsy. Small on purpose: the project has
 * no utility-merge dependency, so conflicting Tailwind classes are avoided by
 * writing them carefully rather than resolved at runtime.
 */
export function cn(...values: (string | false | null | undefined)[]): string {
  return values.filter((value): value is string => Boolean(value)).join(' ');
}
