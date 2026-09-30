import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DateField } from '@/components/ui/DateField';
import { Modal } from '@/components/ui/Modal';
import { dayFromInputValue, inputValueForDay } from '@/lib/dateInput';

/**
 * `DateField`'s calendar: react-day-picker in `Popover`, writing into the same
 * native input `register` reads. The clock is pinned to Wednesday 30 September
 * 2026 so "today" is a fixed cell. jsdom applies no CSS, so the look is held
 * by the stylesheet contract at the end and was checked in a real browser.
 */

const TRIGGER = 'Deadline, choose from calendar';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 30, 10, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

interface HarnessProps {
  defaultValue?: string;
  withTime?: boolean;
  onSubmit?: (values: { when: string }) => void;
}

/** The field as every form in the app uses it: `register`, nothing else. */
function Harness({
  defaultValue = '',
  withTime = false,
  onSubmit = () => undefined,
}: HarnessProps) {
  const { register, handleSubmit } = useForm<{ when: string }>({
    defaultValues: { when: defaultValue },
  });

  return (
    <form onSubmit={(event) => void handleSubmit(onSubmit)(event)}>
      <DateField label="Deadline" withTime={withTime} {...register('when')} />
      <button type="submit">Save</button>
    </form>
  );
}

const input = (): HTMLInputElement =>
  screen.getByLabelText<HTMLInputElement>('Deadline', { selector: 'input' });

async function openCalendar(props: HarnessProps = {}) {
  const user = userEvent.setup();
  render(<Harness {...props} />);
  await user.click(screen.getByRole('button', { name: TRIGGER }));
  return { user, calendar: screen.getByRole('dialog', { name: 'Deadline' }) };
}

describe('the calendar value helpers', () => {
  it.each([
    ['2026-09-24', new Date(2026, 8, 24)],
    ['2026-10-06T14:30', new Date(2026, 9, 6)],
    ['', undefined],
    ['1999-12-31', undefined],
    ['2026-02-30', undefined],
    ['111111-11-11', undefined],
  ])('reads %s as the day the calendar marks', (value, day) => {
    expect(dayFromInputValue(value)).toEqual(day);
  });

  it('writes a date field as yyyy-MM-dd', () => {
    expect(inputValueForDay(new Date(2026, 9, 8), false, '')).toBe('2026-10-08');
  });

  it('keeps a date-time field’s time and starts an empty one at 09:00', () => {
    expect(inputValueForDay(new Date(2026, 9, 9), true, '2026-10-06T14:30')).toBe(
      '2026-10-09T14:30',
    );
    expect(inputValueForDay(new Date(2026, 9, 9), true, '')).toBe('2026-10-09T09:00');
  });
});

describe('DateField’s calendar', () => {
  it('announces a dialog from a named trigger', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: TRIGGER });

    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await userEvent.setup().click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const calendar = screen.getByRole('dialog', { name: 'Deadline' });
    expect(within(calendar).getByRole('grid', { name: 'September 2026' })).toBeInTheDocument();
  });

  it('opens an empty field on today, focused and marked', async () => {
    const { calendar } = await openCalendar();

    expect(document.activeElement).toHaveAccessibleName(/^Today, Wednesday, September 30th, 2026/);
    expect(within(calendar).queryAllByRole('gridcell', { selected: true })).toHaveLength(0);
  });

  it('opens a filled field on its own day, selected', async () => {
    const { calendar } = await openCalendar({ defaultValue: '2027-03-14' });

    expect(within(calendar).getByRole('grid', { name: 'March 2027' })).toBeInTheDocument();
    expect(within(calendar).getByRole('gridcell', { selected: true })).toHaveTextContent('14');
  });

  it('marks no day for a value the form would refuse', async () => {
    const { calendar } = await openCalendar({ defaultValue: '1999-12-31' });

    expect(within(calendar).getByRole('grid', { name: 'September 2026' })).toBeInTheDocument();
    expect(within(calendar).queryAllByRole('gridcell', { selected: true })).toHaveLength(0);
  });

  it('writes a clicked day into the form as if it were typed', async () => {
    const onSubmit = vi.fn();
    const { user, calendar } = await openCalendar({ onSubmit });

    await user.click(within(calendar).getByRole('button', { name: /September 15th, 2026/ }));

    expect(input().value).toBe('2026-09-15');
    expect(screen.queryByRole('dialog', { name: 'Deadline' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: TRIGGER })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledWith({ when: '2026-09-15' }, expect.anything());
  });

  it('moves with the arrow keys and picks with Enter', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole('button', { name: TRIGGER }).focus();

    await user.keyboard('{Enter}');
    await user.keyboard('{ArrowRight}{ArrowDown}');
    expect(document.activeElement).toHaveAccessibleName(/October 8th, 2026/);
    await user.keyboard('{Enter}');

    expect(input().value).toBe('2026-10-08');
    expect(screen.getByRole('button', { name: TRIGGER })).toHaveFocus();
  });

  it('opens from the input with Alt+ArrowDown, as a select does', async () => {
    const user = userEvent.setup();
    render(<Harness defaultValue="2026-10-08" />);
    input().focus();

    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');

    expect(screen.getByRole('dialog', { name: 'Deadline' })).toBeInTheDocument();
    expect(document.activeElement).toHaveAccessibleName(/October 8th, 2026, selected/);
  });

  it('closes when focus tabs out of it', async () => {
    const { user } = await openCalendar();

    await user.tab();

    expect(screen.queryByRole('dialog', { name: 'Deadline' })).not.toBeInTheDocument();
  });

  it('moves an interview to another day without moving its hour', async () => {
    const { user, calendar } = await openCalendar({
      withTime: true,
      defaultValue: '2026-10-06T14:30',
    });

    await user.click(within(calendar).getByRole('button', { name: /October 9th, 2026/ }));

    expect(input().value).toBe('2026-10-09T14:30');
  });

  it.each([
    ['2000-01-15', 'Go to the Previous Month'],
    ['2099-12-10', 'Go to the Next Month'],
  ])('stops at the years the API accepts (%s)', async (value, arrow) => {
    const { user, calendar } = await openCalendar({ defaultValue: value });
    const grid = within(calendar).getByRole('grid').getAttribute('aria-label');
    const dead = within(calendar).getByRole('button', { name: arrow });

    expect(dead).toHaveAttribute('aria-disabled', 'true');
    await user.click(dead);
    expect(within(calendar).getByRole('grid')).toHaveAttribute('aria-label', grid);
  });
});

describe('Escape inside a modal', () => {
  it('closes the calendar and leaves the dialog and its form open', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal isOpen title="Edit" onClose={onClose}>
        <Harness />
      </Modal>,
    );

    await user.click(screen.getByRole('button', { name: TRIGGER }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Deadline' })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: TRIGGER })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('the calendar stylesheet contract', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
  const rule = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:[{}]|\\*/)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  };

  it('swaps in the app’s trigger only where the platform button can be hidden, on a fine pointer', () => {
    const guarded =
      /@supports selector\(::-webkit-calendar-picker-indicator\)\s*\{\s*@media \(pointer: fine\)\s*\{([\s\S]*?)\n {4}\}\n {2}\}/;
    const body = guarded.exec(css)?.[1] ?? '';

    expect(body, 'the swap lost its @supports or pointer guard').toMatch(
      /\.date-picker-trigger\s*\{\s*display: inline-flex;/,
    );
    expect(body).toMatch(/\.date-control::-webkit-calendar-picker-indicator\s*\{\s*display: none;/);
    expect(rule('.date-picker-trigger')).toMatch(/display: none;/);
  });

  it('draws days from the select panel’s tokens', () => {
    expect(rule('.date-calendar .rdp-day_button')).toMatch(/\brounded-control\b/);
    expect(rule('.date-calendar .rdp-day_button:hover')).toMatch(/\bbg-primary\/5\b/);
    expect(rule('.date-calendar .rdp-selected .rdp-day_button')).toMatch(
      /\bbg-primary\/10\b.*\bfont-semibold\b.*\bring-1\b.*\bring-primary\b/,
    );
    expect(rule('.date-calendar .rdp-today .rdp-day_button::after')).toMatch(/\bbg-primary\b/);
  });

  it('greys the month arrows the way the library marks them at the bounds', () => {
    expect(css).toMatch(/\.rdp-button_next\[aria-disabled='true'\]\s*\{[^}]*\bopacity-40\b/);
    expect(css, '`:disabled` never matches a react-day-picker arrow').not.toMatch(
      /\.rdp-button_(previous|next):(hover:enabled|disabled)/,
    );
  });

  it('keeps the keyboard ring stronger than the selection ring', () => {
    const selected = css.indexOf('.date-calendar .rdp-selected .rdp-day_button {');
    const focus = css.indexOf('.date-calendar .rdp-day_button:focus-visible {');

    expect(focus, 'the focus rule must follow the selected rule to win').toBeGreaterThan(selected);
    expect(rule('.date-calendar .rdp-day_button:focus-visible')).toMatch(/\bring-2\b/);
  });
});
