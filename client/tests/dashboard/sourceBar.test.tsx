import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { ChartData } from 'chart.js';
import { SourceBar } from '@/features/dashboard/charts/SourceBar';
import { renderWithProviders, resetClientState } from '../utils/render';

// Chart.js paints to a canvas jsdom cannot read, so the test reads what the
// component hands it instead: the labels and the colour it asked for.
const drawn = vi.hoisted(() => ({ data: undefined as ChartData<'bar'> | undefined }));

vi.mock('react-chartjs-2', () => ({
  Bar: (props: { data: ChartData<'bar'> }) => {
    drawn.data = props.data;
    return null;
  },
}));

beforeEach(() => {
  resetClientState();
  drawn.data = undefined;
});

function renderBar(sources: { source: string; count: number }[]): void {
  renderWithProviders(
    <SourceBar sources={sources} isLoading={false} error={null} onRetry={() => undefined} />,
  );
}

const EVERY_SOURCE = [
  'jobstreet',
  'linkedin',
  'indeed',
  'hiredly',
  'maukerja',
  'myfuturejobs',
  'company_site',
  'referral',
  'career_fair',
  'other',
  'unspecified',
];

describe('the "By source" chart', () => {
  // With a colour per bar, an eleventh source had to reuse one of the eight
  // series colours. One colour removes that class of bug for any list length.
  it('paints every bar the same single colour', () => {
    renderBar(EVERY_SOURCE.map((source, index) => ({ source, count: 11 - index })));

    const [dataset] = drawn.data?.datasets ?? [];
    expect(drawn.data?.labels).toHaveLength(11);
    expect(typeof dataset?.backgroundColor).toBe('string');
  });

  it('labels a retired source as stored rather than as "Unspecified"', () => {
    renderBar([
      { source: 'jobstreet', count: 5 },
      { source: 'internshala', count: 3 },
      { source: 'unspecified', count: 1 },
    ]);

    expect(drawn.data?.labels).toEqual(['JobStreet', 'internshala', 'Unspecified']);
    // The screen reader table carries the same labels as the axis.
    expect(screen.getByRole('rowheader', { name: 'internshala' })).toBeInTheDocument();
  });
});
