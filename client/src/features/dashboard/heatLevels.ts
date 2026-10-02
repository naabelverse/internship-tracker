/**
 * The Activity card's five intensity steps, level 0 being nothing at all. The
 * heatmap's days and the weekly pace bars share them, so "darker is busier"
 * means the same thing everywhere on the card and one legend covers both.
 */
export const HEAT_LEVEL_CLASSES = [
  'bg-heat-0',
  'bg-heat-1',
  'bg-heat-2',
  'bg-heat-3',
  'bg-heat-4',
] as const;

/** Four filled levels, so a busy day is distinguishable from a merely active one. */
export function heatLevel(count: number, busiest: number): number {
  if (count === 0) return 0;
  if (busiest <= 1) return HEAT_LEVEL_CLASSES.length - 1;

  const share = count / busiest;
  if (share > 0.75) return 4;
  if (share > 0.5) return 3;
  if (share > 0.25) return 2;

  return 1;
}
