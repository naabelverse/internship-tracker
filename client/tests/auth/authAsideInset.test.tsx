import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthSplitLayout } from '@/features/auth/AuthSplitLayout';
import { renderWithProviders, resetClientState } from '../utils/render';

/**
 * The marketing aside used to carry a uniform `p-10`, so its copy began 40px
 * from the viewport edge at every width while the form column beside it — a
 * `max-w-sm` block centred by `mx-auto` — begins 64px from its own edge at `lg`
 * and 168px at 1440. The split screen therefore read as lopsided on all six
 * pages that render through this layout.
 *
 * jsdom applies no CSS, so nothing here can measure the balance itself; that is
 * verified by the screenshots and the measurement harness on the PR. What this
 * test pins is the class contract the fix rests on, which is exactly what a
 * careless revert would undo: the horizontal inset is its own, larger step than
 * the vertical one, and it widens again on the next breakpoint up. The steps are
 * read as numbers rather than matched as strings so the values can still be
 * tuned without rewriting the test.
 */
function asideClasses(): string {
  const { container } = renderWithProviders(
    <AuthSplitLayout title="Sign in" subtitle="Pick up where you left off." footer={null}>
      <form />
    </AuthSplitLayout>,
  );
  const aside = container.querySelector('aside');
  if (!aside) throw new Error('the layout should render a complementary landmark');
  return aside.className;
}

/** The numeric step of a Tailwind spacing utility, e.g. `xl:px-24` -> 24. */
function step(classes: string, utility: string): number {
  const match = new RegExp(`(?:^|\\s)${utility}-(\\d+)(?:\\s|$)`).exec(classes);
  if (!match) throw new Error(`expected a \`${utility}-<n>\` utility in: ${classes}`);
  return Number(match[1]);
}

beforeEach(() => {
  resetClientState();
});

afterEach(() => {
  resetClientState();
});

describe('the auth aside keeps its horizontal inset', () => {
  it('insets horizontally by its own step, not a uniform padding', () => {
    const classes = asideClasses();

    // A uniform `p-<n>` is the shape of the bug: one value cannot both hold the
    // copy off the viewport edge and leave the `justify-between` column alone.
    expect(classes).not.toMatch(/(?:^|\s)p-\d+(?:\s|$)/);
    expect(step(classes, 'px')).toBeGreaterThan(step(classes, 'py'));
  });

  it('widens that inset again once the panel itself gets wider', () => {
    const classes = asideClasses();

    expect(step(classes, 'xl:px')).toBeGreaterThan(step(classes, 'px'));
  });

  it('leaves the vertical rhythm to justify-between', () => {
    const classes = asideClasses();

    // The gaps between the lockup, the copy and the footer are distributed, so
    // the fix had to stay out of the vertical axis entirely.
    expect(classes).toContain('justify-between');
    expect(classes).not.toMatch(/(?:^|\s)xl:py-\d+(?:\s|$)/);
  });

  it('is still hidden below the breakpoint that makes room for it', () => {
    const classes = asideClasses();

    // At 375 and 768 the aside is `display: none`, which is why the padding
    // change cannot eat space on a phone.
    expect(classes).toContain('hidden');
    expect(classes).toContain('lg:flex');
  });
});
