import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { makeApplication, makeListResponse, makeSession } from '../utils/factories';
import { installMockApi } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

/**
 * The toolbar's Filters and Columns menus are the `Popover`s that predate the
 * date picker. When the picker reshaped `Popover` (Escape caught in the capture
 * phase, closing when focus tabs out), these two menus changed with it, so their
 * dismissal is held here directly rather than inferred from the picker's tests.
 */

const MENUS = ['Filters', 'Columns'] as const;

beforeEach(() => {
  resetClientState();
  installMockApi({
    'GET /applications': () => ({
      status: 200,
      data: makeListResponse([makeApplication({ company: 'Stripe', role: 'Backend Intern' })]),
    }),
  });
  signIn(makeSession());
});

afterEach(() => {
  resetClientState();
});

async function openMenu(menu: (typeof MENUS)[number]) {
  const user = userEvent.setup();
  renderWithProviders(<App />, { route: '/applications' });
  await screen.findByText('Stripe');

  const trigger = screen.getByRole('button', { name: new RegExp(`^${menu}`) });
  await user.click(trigger);
  const panel = screen.getByRole('group', { name: menu });

  return { user, trigger, panel };
}

describe.each(MENUS)('the %s menu', (menu) => {
  it('closes on Escape and returns focus to its button', async () => {
    const { user, trigger } = await openMenu(menu);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('group', { name: menu })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when focus tabs out of it', async () => {
    const { user, trigger, panel } = await openMenu(menu);
    trigger.focus();

    // Walk forward through the panel's checkboxes until focus is past them.
    for (let step = 0; step < 40 && panel.isConnected; step += 1) {
      await user.tab();
      if (!panel.contains(document.activeElement) && document.activeElement !== trigger) break;
    }

    expect(panel.contains(document.activeElement)).toBe(false);
    expect(screen.queryByRole('group', { name: menu })).not.toBeInTheDocument();
  });

  it('closes on a click outside', async () => {
    const { user } = await openMenu(menu);

    await user.click(screen.getByRole('heading', { level: 1 }));

    expect(screen.queryByRole('group', { name: menu })).not.toBeInTheDocument();
  });

  it('stays open while a checkbox inside it is ticked', async () => {
    const { user, panel } = await openMenu(menu);
    const box = within(panel)
      .getAllByRole<HTMLInputElement>('checkbox')
      .find((checkbox) => !checkbox.disabled);
    if (!box) throw new Error(`The ${menu} menu has no enabled checkbox to tick`);
    const wasChecked = box.checked;

    await user.click(box);

    expect(box.checked).toBe(!wasChecked);
    expect(screen.getByRole('group', { name: menu })).toBeInTheDocument();
  });
});
