import { useState } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ApplicationFormModal } from '@/features/applications/ApplicationFormModal';
import { VersionConflictDialog } from '@/features/applications/VersionConflictDialog';
import { InterviewFormModal } from '@/features/applications/detail/InterviewFormModal';
import { makeApplication, makeSession } from '../utils/factories';
import { installMockApi } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

/**
 * SPEC section 6 requires a focus trap and Escape-to-close on every modal.
 *
 * Each of the four gets its own case rather than one case against the `Modal`
 * primitive, because "the primitive supports it" and "this dialog uses the
 * primitive" are different claims — a consumer that hand-rolled an overlay would
 * pass the abstract test and fail its users.
 */

/** Mounts a dialog behind a page that has its own focusable controls. */
function PageBehind({ children }: { children: (close: () => void) => JSX.Element }): JSX.Element {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div>
      <button type="button">page button before</button>
      <a href="/somewhere">page link after</a>
      {isOpen &&
        children(() => {
          setIsOpen(false);
        })}
    </div>
  );
}

/** Every element the browser would stop on inside the dialog. */
function focusablesIn(dialog: HTMLElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
}

/**
 * Tabs all the way round the dialog and one step past, asserting focus never
 * lands outside it. Walking the full cycle is the point: a trap that only holds
 * for the first few stops still leaks at the last one.
 */
async function assertTabCycles(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const dialog = screen.getByRole('dialog');
  const stops = focusablesIn(dialog);

  expect(stops.length).toBeGreaterThan(1);

  for (let step = 0; step <= stops.length; step += 1) {
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  }

  // Backwards too: shift+Tab off the first element must wrap to the last, not
  // escape to the page behind.
  for (let step = 0; step <= stops.length; step += 1) {
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  }
}

beforeEach(() => {
  installMockApi({});
  signIn(makeSession());
});

afterEach(() => {
  resetClientState();
});

describe('Application form modal', () => {
  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PageBehind>{(close) => <ApplicationFormModal isOpen onClose={close} />}</PageBehind>,
    );

    await assertTabCycles(user);
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PageBehind>{(close) => <ApplicationFormModal isOpen onClose={close} />}</PageBehind>,
    );

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});

describe('Interview form modal', () => {
  const application = makeApplication();

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PageBehind>
        {(close) => <InterviewFormModal isOpen onClose={close} applicationId={application.id} />}
      </PageBehind>,
    );

    await assertTabCycles(user);
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PageBehind>
        {(close) => <InterviewFormModal isOpen onClose={close} applicationId={application.id} />}
      </PageBehind>,
    );

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});

describe('Confirm dialog', () => {
  const props = {
    title: 'Delete this application?',
    message: 'This cannot be undone.',
    confirmLabel: 'Delete',
    onConfirm: vi.fn(),
  };

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PageBehind>{(close) => <ConfirmDialog isOpen {...props} onCancel={close} />}</PageBehind>,
    );

    await assertTabCycles(user);
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PageBehind>{(close) => <ConfirmDialog isOpen {...props} onCancel={close} />}</PageBehind>,
    );

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});

describe('Version conflict dialog', () => {
  const conflict = {
    conflictSource: 'stale_read' as const,
    current: makeApplication({ company: 'Grab' }),
  };

  it('keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PageBehind>
        {(close) => (
          <VersionConflictDialog
            conflict={conflict}
            isPending={false}
            onReload={vi.fn()}
            onOverwrite={vi.fn()}
            onDismiss={close}
          />
        )}
      </PageBehind>,
    );

    await assertTabCycles(user);
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PageBehind>
        {(close) => (
          <VersionConflictDialog
            conflict={conflict}
            isPending={false}
            onReload={vi.fn()}
            onOverwrite={vi.fn()}
            onDismiss={close}
          />
        )}
      </PageBehind>,
    );

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('shows the server copy so the choice is informed', () => {
    renderWithProviders(
      <PageBehind>
        {(close) => (
          <VersionConflictDialog
            conflict={conflict}
            isPending={false}
            onReload={vi.fn()}
            onOverwrite={vi.fn()}
            onDismiss={close}
          />
        )}
      </PageBehind>,
    );

    expect(within(screen.getByTestId('conflict-current')).getByText('Grab')).toBeInTheDocument();
  });
});
