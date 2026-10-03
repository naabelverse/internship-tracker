import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActivityHeatmap } from '@/features/dashboard/ActivityHeatmap';
import { makeTimelinePoint } from '../utils/factories';

function renderCard(weeklyGoal: number): void {
  render(
    <ActivityHeatmap
      points={[makeTimelinePoint({ bucket: new Date().toISOString(), created: 1 })]}
      timeZone="UTC"
      weeklyGoal={weeklyGoal}
      isLoading={false}
    />,
  );
}

describe('the Activity subtitle', () => {
  it('says what the card covers, in a phone length and a full length', () => {
    renderCard(5);

    const short = screen.getByText('Last 12 weeks, against your weekly goal');
    const full = screen.getByText(
      'Your activity over the last 12 weeks, and how it compares to your weekly goal.',
    );

    // jsdom applies no CSS, so this pins the swap: one shown below a 26rem
    // card, the other from it, never both.
    expect(short).toHaveClass('[@container_(min-width:26rem)]:hidden');
    expect(full).toHaveClass('hidden', '[@container_(min-width:26rem)]:inline');
    expect(short.parentElement).toBe(full.parentElement);
  });

  it('drops the goal from the line when no weekly goal is set', () => {
    renderCard(0);

    expect(screen.getByText('Last 12 weeks')).toBeInTheDocument();
    expect(screen.getByText('Your activity over the last 12 weeks.')).toBeInTheDocument();
    // The pace summary's own "No weekly goal set" is expected; the subtitle's
    // comparison is not.
    expect(screen.queryByText(/(against|compares to) your weekly goal/)).not.toBeInTheDocument();
  });
});
