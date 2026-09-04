import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppLayout } from '@/components/layout/AppLayout';
import { Sidebar } from '@/components/layout/Sidebar';
import { makeSession } from '../utils/factories';
import { installMockApi } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

beforeEach(() => {
  installMockApi({});
  signIn(makeSession());
});

afterEach(() => {
  resetClientState();
});

describe('navigation drawer keyboard behaviour', () => {
  /**
   * The defect this covers was real and shipped in phase 5: below `lg` the
   * drawer was only translated off screen with `-translate-x-full`. A transform
   * moves pixels but leaves everything inside it focusable, so Tab from the
   * topbar walked through six nav links nobody could see.
   *
   * `visibility: hidden` is what actually removes a subtree from the tab order.
   * jsdom applies no stylesheet, so the class contract is asserted here and the
   * rendered behaviour was confirmed in a real browser during this phase.
   */
  it('is invisible, not merely shifted, while closed', () => {
    renderWithProviders(<Sidebar isOpen={false} onClose={() => undefined} />);

    const panel = screen.getByLabelText('Main navigation');

    expect(panel.className).toContain('invisible');
    expect(panel.className).toContain('lg:visible');
  });

  it('becomes visible when opened', () => {
    renderWithProviders(<Sidebar isOpen onClose={() => undefined} />);

    const panel = screen.getByLabelText('Main navigation');

    expect(panel.className).toContain('visible');
    expect(panel.className).not.toContain('invisible');
  });

  it('is only a dialog while it is acting as one', () => {
    const { rerender } = renderWithProviders(<Sidebar isOpen={false} onClose={() => undefined} />);

    // A permanently modal rail would be announced as a dialog on a desktop,
    // where it is just a sidebar.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(<Sidebar isOpen onClose={() => undefined} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('traps Tab and closes on Escape while open', async () => {
    const user = userEvent.setup();
    let closed = false;

    renderWithProviders(
      <Sidebar
        isOpen
        onClose={() => {
          closed = true;
        }}
      />,
    );

    const panel = screen.getByRole('dialog');
    for (let step = 0; step < 8; step += 1) {
      await user.tab();
      expect(panel).toContainElement(document.activeElement as HTMLElement);
    }

    await user.keyboard('{Escape}');

    expect(closed).toBe(true);
  });
});

describe('app shell keyboard order', () => {
  it('offers a skip link as the very first stop', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppLayout />, { route: '/' });

    await user.tab();

    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    expect(document.activeElement).toBe(skip);
    expect(skip).toHaveAttribute('href', '#main-content');
  });

  it('points the skip link at a main landmark that exists', () => {
    renderWithProviders(<AppLayout />, { route: '/' });

    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
  });

  it('labels the drawer toggle and ties it to the panel it controls', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppLayout />, { route: '/' });

    const toggle = screen.getByRole('button', { name: 'Open navigation' });

    expect(toggle).toHaveAttribute('aria-controls', 'app-navigation');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open navigation' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    });
  });

  it('gives the theme control a real radio group', () => {
    renderWithProviders(<AppLayout />, { route: '/' });

    const group = screen.getByRole('radiogroup', { name: 'Theme' });

    expect(within(group).getAllByRole('radio')).toHaveLength(3);
    for (const radio of within(group).getAllByRole('radio')) {
      expect(radio).toHaveAccessibleName();
    }
  });
});
