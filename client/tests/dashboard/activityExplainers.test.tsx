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

  // Changed deliberately: shade was applications added only, and the tip said
  // so. It is now added or moved, the same count as Active days.
  it('says a square is shaded by applications added and status updates together', async () => {
    const user = userEvent.setup();
    renderCard(5);

    await user.click(screen.getByRole('button', { name: 'About the heatmap' }));
    const tip = within(screen.getByRole('dialog'));

    expect(
      tip.getByText(/counting applications added and status updates together/),
    ).toBeInTheDocument();
    expect(tip.getByText(/shaded squares add up to Active days/)).toBeInTheDocument();
    expect(tip.queryByText(/don’t shade/)).not.toBeInTheDocument();
  });

  it('sets the heatmap’s tip beside its “Daily activity” title, not in the legend', () => {
    renderCard(5);
    const title = screen.getByRole('heading', { level: 3, name: 'Daily activity' });
    const trigger = screen.getByRole('button', { name: 'About the heatmap' });

    expect(title.parentElement).toContainElement(trigger);
    expect(screen.getByText('Less').parentElement).not.toContainElement(trigger);
  });

  it('says plainly that weekly pace counts applications added only', async () => {
    const user = userEvent.setup();
    renderCard(5);

    await user.click(screen.getByRole('button', { name: 'About weekly pace' }));
    const tip = within(screen.getByRole('dialog'));

    expect(
      tip.getByText(
        /Only applications added count here and toward your goal\. Status updates don’t/,
      ),
    ).toBeInTheDocument();
    expect(tip.queryByText(/total of that week’s column/)).not.toBeInTheDocument();
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

  it('explains the ratio line in the figures’ tip, which sits beside their title', async () => {
    const user = userEvent.setup();
    renderCard(5);
    const title = screen.getByRole('heading', { level: 3, name: 'Follow-through' });
    const trigger = screen.getByRole('button', { name: 'About these figures' });

    expect(title.parentElement).toContainElement(trigger);

    await user.click(trigger);
    expect(
      within(screen.getByRole('dialog')).getByText(
        'The line under the figures is status updates divided by applications added.',
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

/**
 * The ratio line once carried its own (?) and sat 16px above "Weekly pace (?)",
 * the same size, so it read as a second heading. It is now the figures'
 * caption, and a rule sets Weekly pace apart. jsdom applies no CSS, so this
 * pins the structure; `e2e/audits/heatmap.spec.ts` measures the gaps.
 */
describe('the Activity figures group', () => {
  /** Three added and four moves: "1.3 updates for every application added". */
  function renderWithRatio(): void {
    render(
      <ActivityHeatmap
        points={[
          makeTimelinePoint({ bucket: new Date().toISOString(), created: 3, statusChanges: 7 }),
        ]}
        timeZone="UTC"
        weeklyGoal={5}
        isLoading={false}
      />,
    );
  }

  /** The text-size and colour utilities on an element, the rest left out. */
  function textStyle(element: Element): string[] {
    return [...element.classList].filter((name) => /^text-/.test(name)).sort();
  }

  it('keeps the ratio line a caption: no (?) of its own, and the style of “of N days”', () => {
    renderWithRatio();
    const ratio = screen.getByText('1.3 updates for every application added');
    const ofDays = screen.getByText(/^of \d+ days$/);
    const figures = screen.getByText('Added').closest('dl');

    expect(ratio.tagName).toBe('P');
    // Directly under the figures row, in the same block, which holds no button.
    expect(ratio.previousElementSibling).toBe(figures);
    expect(within(ratio.parentElement as HTMLElement).queryAllByRole('button')).toHaveLength(0);
    expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).not.toContain(
      ratio.textContent,
    );
    expect(textStyle(ratio)).toEqual(textStyle(ofDays));
  });

  it('sets the only rule directly above Weekly pace, with the ratio line the last thing before it', () => {
    renderWithRatio();
    const ratio = screen.getByText('1.3 updates for every application added');
    const titles = screen.getAllByRole('heading', { level: 3 });

    // Changed deliberately: the heatmap now has a title of its own, first.
    expect(titles.map((title) => title.textContent)).toEqual([
      'Daily activity',
      'Follow-through',
      'Weekly pace',
    ]);

    // The side column's sections: the figures, then Weekly pace. Only the
    // second is ruled off; the pace plot's dashed goal line is not a section.
    const column = titles[1].parentElement?.parentElement?.parentElement;
    const sections = [...(column?.children ?? [])] as HTMLElement[];
    const ruled = sections.filter((section) => section.classList.contains('border-t'));

    expect(sections).toHaveLength(2);
    expect(ruled).toEqual([sections[1]]);
    expect(within(sections[1]).getAllByRole('heading')[0]).toHaveTextContent('Weekly pace');
    expect(within(sections[0]).getAllByRole('heading')[0]).toHaveTextContent('Follow-through');
    expect(sections[0].classList.contains('border-b')).toBe(false);

    // Nothing sits between the ratio line and the rule.
    expect(sections[0].lastElementChild?.lastElementChild).toBe(ratio);
  });
});
