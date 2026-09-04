import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { App } from '@/App';
import { makeApplication, makeListResponse, makeSession } from '../utils/factories';
import { columnCentre, mockBoardLayout, pointerDrag } from '../utils/dnd';
import { installMockApi } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

/**
 * dnd-kit keeps a capture-phase `click` listener on the document for 50 ms after a
 * drag ends, to stop the click a pointer device emits on release from activating
 * whatever the card was dropped on. A test that clicks inside that window has the
 * event stopped at the document before it reaches its target or React: the button
 * is attached, enabled and correctly labelled, and nothing happens.
 *
 * That is what made the board's overwrite case in `dragAndDrop.test.tsx` fail about
 * three runs in four once the cases before it had warmed the module graph — the
 * click simply arrived sooner. This pins the fix at the helper rather than leaving
 * the guarantee to how fast the machine happens to be.
 */
describe('pointerDrag', () => {
  let restoreLayout: () => void;

  beforeEach(() => {
    restoreLayout = mockBoardLayout();
    resetClientState();
  });

  afterEach(() => {
    restoreLayout();
    resetClientState();
  });

  it('resolves only once a click can reach its target again', async () => {
    const stored = makeApplication({ id: 'app-1', company: 'Stripe', status: 'applied' });
    installMockApi({
      'GET /applications': () => ({ status: 200, data: makeListResponse([stored]) }),
      'PATCH /applications/app-1': () => ({
        status: 200,
        data: { success: true, data: { application: { ...stored, status: 'interview' } } },
      }),
    });
    signIn(makeSession());
    renderWithProviders(<App />, { route: '/applications/board' });

    await screen.findByText('Stripe');
    await pointerDrag(screen.getByRole('button', { name: /^Move Stripe/ }), columnCentre(3));

    // Dispatched with no await in between, so the assertion is about the helper's
    // contract and not about the scheduling of whatever a caller does next.
    const target = document.createElement('button');
    document.body.append(target);
    let delivered = 0;
    target.addEventListener('click', () => {
      delivered += 1;
    });
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    target.remove();

    expect(delivered).toBe(1);
  });
});
