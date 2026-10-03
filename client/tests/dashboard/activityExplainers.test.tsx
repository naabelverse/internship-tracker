import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('the Activity info tips', () => {
  it('gives each of the three sections its own named, collapsed tip', () => {
    renderCard(5);

    for (const name of ['About the heatmap', 'About these figures', 'About weekly pace']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'false');
    }
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens on a click and closes on Escape, handing focus back to the icon', async () => {
    const user = userEvent.setup();
    renderCard(5);
    const trigger = screen.getByRole('button', { name: 'About the heatmap' });

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'About the heatmap' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('says a square is shaded by applications added, not by status updates', async () => {
    const user = userEvent.setup();
    renderCard(5);

    await user.click(screen.getByRole('button', { name: 'About the heatmap' }));
    const tip = within(screen.getByRole('dialog'));

    expect(tip.getByText(/more applications you added that day/)).toBeInTheDocument();
    expect(tip.getByText(/Status updates don’t shade a square/)).toBeInTheDocument();
  });

  it('defines Active days as added or moved, not added alone', async () => {
    const user = userEvent.setup();
    renderCard(5);

    await user.click(screen.getByRole('button', { name: 'About these figures' }));

    expect(
      within(screen.getByRole('dialog')).getByText(/days you added or moved at least one/),
    ).toBeInTheDocument();
  });

  it('names the goal the pace panel draws', async () => {
    const user = userEvent.setup();
    renderCard(7);

    await user.click(screen.getByRole('button', { name: 'About weekly pace' }));
    expect(
      within(screen.getByRole('dialog')).getByText(
        /weekly goal of 7\. A week meets it by adding 7/,
      ),
    ).toBeInTheDocument();
  });

  it('says there is no line when no weekly goal is set', async () => {
    const user = userEvent.setup();
    renderCard(0);

    await user.click(screen.getByRole('button', { name: 'About weekly pace' }));
    expect(
      within(screen.getByRole('dialog')).getByText(/No weekly goal is set/),
    ).toBeInTheDocument();
  });
});
