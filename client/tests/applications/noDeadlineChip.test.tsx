import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ApplicationCardList } from '@/features/applications/ApplicationCardList';
import { BoardCardFace } from '@/features/board/BoardCard';
import type { Application } from '@/types/application';
import { makeApplication } from '../utils/factories';
import { renderWithProviders } from '../utils/render';

const inTenDays = new Date(Date.now() + 10 * 86_400_000).toISOString();

/** The board card's chip row: the element between the header and the Move button. */
function boardChipRow(application: Application): Element | null {
  const { container } = renderWithProviders(<BoardCardFace application={application} />);
  const children = [...container.children];
  return children.length === 3 ? (children[1] ?? null) : null;
}

/**
 * Outside the table, `DeadlineChip`'s "—" sits under no "Deadline" header, so it
 * reads as a broken chip. The board and the narrow card list render no chip at
 * all when there is no deadline; the table keeps its dash.
 */
describe('board card chip row', () => {
  it('shows no dash when there is no deadline', () => {
    boardChipRow(makeApplication({ tags: ['react'] }));

    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('still shows the due chip when there is a deadline', () => {
    const row = boardChipRow(makeApplication({ deadline: inTenDays, tags: ['react'] }));

    expect(row?.firstElementChild).toHaveTextContent(/^Deadline .+, in 10d$/);
  });

  it('starts a tags-only row with the first tag', () => {
    const row = boardChipRow(makeApplication({ tags: ['react'] }));

    expect(row?.children).toHaveLength(1);
    expect(row?.firstElementChild).toHaveTextContent(/^react$/);
  });

  it('renders no row at all with neither a deadline nor tags', () => {
    const { container } = renderWithProviders(
      <BoardCardFace application={makeApplication({ tags: [] })} />,
    );

    expect(container.children).toHaveLength(2);
    expect(container.lastElementChild).toHaveTextContent('Move');
  });
});

describe('narrow card list deadline chip', () => {
  function renderList(applications: Application[]): void {
    renderWithProviders(
      <ApplicationCardList
        applications={applications}
        selectedIds={[]}
        pendingStatusIds={[]}
        onToggle={() => undefined}
        onStatusChange={() => undefined}
        onEdit={() => undefined}
      />,
    );
  }

  it('shows no dash when there is no deadline', () => {
    renderList([makeApplication({ company: 'Stripe' })]);

    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('still shows the due chip when there is a deadline', () => {
    renderList([makeApplication({ company: 'Stripe', deadline: inTenDays })]);

    const card = screen.getByRole('listitem');
    expect(within(card).getByText('in 10d', { exact: false })).toHaveTextContent(
      /^Deadline .+, in 10d$/,
    );
  });
});
