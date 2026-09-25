import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import dashboardScreenshot from '@/components/marketing/dashboardScreenshot.json';
import { StatCards } from '@/features/dashboard/StatCards';
import { makeSummary } from '../utils/factories';

/**
 * The landing page shows screenshots of the dashboard and calls them "the same
 * view the demo account opens on". They are images, so nothing else notices when
 * the dashboard moves on without them: PR #33 added two stat cards and the
 * screenshot went on showing six.
 *
 * `scripts/captureScreenshot.mjs` records the stat-card labels it saw at capture
 * time. This compares that record with what `StatCards` renders now, so a change
 * to the cards fails here until the screenshots are recaptured. It covers the
 * cards only — dates in the upcoming list age regardless, and are not checked.
 */
describe('landing page dashboard screenshot', () => {
  it('shows the stat cards the dashboard renders today', () => {
    const { container } = render(<StatCards summary={makeSummary()} isLoading={false} />);

    // Each card is a direct child of the grid, and its first paragraph is its label.
    const cards = [...(container.firstElementChild?.children ?? [])];
    const labels = cards.map((card) => card.querySelector('p')?.textContent?.trim() ?? '');

    expect(
      labels,
      'The dashboard stat cards changed since the landing screenshots were captured. ' +
        'Recapture them with client/scripts/captureScreenshot.mjs.',
    ).toEqual(dashboardScreenshot.statCards);
  });
});
