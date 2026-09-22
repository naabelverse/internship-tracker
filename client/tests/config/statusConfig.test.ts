import { describe, expect, it } from 'vitest';
import tailwindConfig from '../../tailwind.config';
import { TOKENS } from '@/features/dashboard/charts/chartTokens';
import { STATUS_CONFIG } from '@/lib/statusConfig';
import { APPLICATION_STATUSES } from '@/types/application';

/**
 * One status, one token, everywhere.
 *
 * `STATUS_CONFIG` names a token and spells out the Tailwind classes that paint
 * with it, because Tailwind only emits a utility it finds as a literal. The
 * doughnut reads the token; the board, the table and the timeline read the
 * classes. Nothing but this file ties the two together, and before it existed
 * the chart kept a second map of its own that drifted: when the chart series
 * was rebuilt, ghosted turned amber and withdrawn green in the doughnut while
 * every pill stayed grey.
 */
describe('status config', () => {
  /** The Tailwind key a `color-*` token is reached through. */
  const utility = (token: string): string => token.replace(/^color-/, '');

  it.each(APPLICATION_STATUSES)('%s paints its pill and its dot with its own token', (status) => {
    const { token, pill, dot, hollow } = STATUS_CONFIG[status];
    const name = utility(token);

    expect(pill).toBe(`bg-${name}/15 text-${name}`);
    expect(dot).toBe(hollow ? `border-${name} bg-transparent` : `bg-${name}`);
  });

  it.each(APPLICATION_STATUSES)('%s reaches its token through a Tailwind key', (status) => {
    const { token } = STATUS_CONFIG[status];
    const colours = tailwindConfig.theme.extend.colors as Record<string, string>;

    expect(colours[utility(token)]).toContain(`--${token}`);
  });

  it.each(APPLICATION_STATUSES)('%s names a token the charts snapshot', (status) => {
    // `readChartPalette` falls back to a sentinel grey for a token outside
    // `TOKENS`, silently, which is how a slice would come out wrong.
    expect(TOKENS).toContain(STATUS_CONFIG[status].token);
  });

  it('gives no two statuses the same token', () => {
    const tokens = APPLICATION_STATUSES.map((status) => STATUS_CONFIG[status].token);

    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('draws ghosted hollow and every other status solid', () => {
    const hollow = APPLICATION_STATUSES.filter((status) => STATUS_CONFIG[status].hollow);

    // Exactly one: the shape is a second signal for the pair that was broken,
    // and a second hollow status would make it a family again.
    expect(hollow).toEqual(['ghosted']);
  });
});
