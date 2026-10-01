import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WeeklyGoalRing, goalFraction } from '@/features/dashboard/WeeklyGoalRing';
import { installThemeTokens, removeThemeTokens, tokenColor } from '../utils/themeTokens';

/**
 * The ring has to draw its share of the circle exactly. It used to round-cap
 * the arc, which reaches half the stroke width past each end, so 1 of 5 painted
 * about 86° rather than 72°; and its track matched the card closely enough
 * (1.14:1) that the arc had no visible circle to be a fraction of.
 */

function circles(): { track: SVGCircleElement; fill: SVGCircleElement } {
  const [track, fill] = [...screen.getByRole('img').querySelectorAll('circle')];

  return { track, fill };
}

/** The angle the visible dash covers, from the attributes the browser paints. */
function arcDegrees(fill: SVGCircleElement): number {
  const length = Number(fill.getAttribute('stroke-dasharray'));
  const offset = Number(fill.getAttribute('stroke-dashoffset'));

  return ((length - offset) / length) * 360;
}

describe('WeeklyGoalRing', () => {
  beforeEach(() => {
    installThemeTokens();
  });

  afterEach(() => {
    removeThemeTokens();
  });

  it.each([
    [1, 5, 72],
    [0, 5, 0],
    [5, 5, 360],
    [1, 3, 120],
    [7, 5, 360],
    [2, 0, 0],
  ])('draws %i of %i as a %i° arc', (completed, target, degrees) => {
    render(<WeeklyGoalRing completed={completed} target={target} />);

    expect(arcDegrees(circles().fill)).toBeCloseTo(degrees, 9);
  });

  it('caps the arc flat, so nothing is painted past its share', () => {
    render(<WeeklyGoalRing completed={1} target={5} />);

    expect(circles().fill).toHaveAttribute('stroke-linecap', 'butt');
  });

  it('paints the progress in primary on a primary tint, and turns green once met', () => {
    const { unmount } = render(<WeeklyGoalRing completed={1} target={5} />);

    expect(circles().fill).toHaveAttribute('stroke', tokenColor('color-primary'));
    expect(circles().track).toHaveAttribute(
      'stroke',
      tokenColor('color-primary').replace(')', ' / 0.2)'),
    );
    unmount();

    render(<WeeklyGoalRing completed={5} target={5} />);
    expect(circles().fill).toHaveAttribute('stroke', tokenColor('color-success'));
  });

  it('reads past the goal out in full while the arc stops at the circle', () => {
    render(<WeeklyGoalRing completed={7} target={5} />);

    expect(screen.getByRole('img')).toHaveAccessibleName(
      '7 of 5 applications this week, 140 percent of the goal',
    );
  });
});

describe('goalFraction', () => {
  it('works from the counts, not a rounded percentage', () => {
    expect(goalFraction(1, 3)).toBe(1 / 3);
  });

  it('treats a goal of zero as nothing to fill', () => {
    expect(goalFraction(4, 0)).toBe(0);
  });
});
