import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Select } from '@/components/ui/Select';
import { StatusSelect } from '@/features/applications/StatusSelect';

/**
 * Every `<select>` in the app is one of these two components, so the dropdown
 * panel is designed once, in `.select-control` in `index.css`. jsdom applies no
 * CSS, so what can be held here is the contract: both components opt in, and
 * the rule keeps its guards and its shared tokens. What the panel looks like was
 * checked in a real browser and is recorded in DECISIONS.md.
 */

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

/**
 * The body of the rule whose selector list is exactly `selector`. Anchored to
 * the end of the previous rule, block or comment, so a selector that also
 * appears as the second half of a list (`.a, .a::picker(select)`) is not read.
 */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:[{}]|\\*/)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
}

describe('the shared dropdown panel', () => {
  it('is used by the Select field', () => {
    render(<Select label="Priority" options={[{ value: 'high', label: 'High' }]} />);

    expect(screen.getByLabelText('Priority')).toHaveClass('select-control');
  });

  it('is used by the inline status pill', () => {
    render(<StatusSelect value="applied" onChange={() => undefined} label="Status for Grab" />);

    expect(screen.getByLabelText('Status for Grab')).toHaveClass('select-control');
  });

  it('opts in only where base-select exists and the pointer is fine', () => {
    const guarded = /@supports \(appearance: base-select\)\s*\{\s*@media \(pointer: fine\)\s*\{/;

    expect(css, 'the base-select opt-in lost its @supports or pointer guard').toMatch(guarded);
    expect(css.split(guarded)[1]).toMatch(
      /\.select-control,\s*\.select-control::picker\(select\)\s*\{\s*appearance: base-select;/,
    );
  });

  it('draws the panel from the tokens the popover menus already use', () => {
    const panel = ruleBody('.select-control::picker(select)');

    for (const utility of ['rounded-card', 'shadow-float', 'bg-surface', 'border-border', 'my-1']) {
      expect(panel, `the panel no longer uses ${utility}`).toMatch(new RegExp(`\\b${utility}\\b`));
    }
  });

  it('keeps option corners concentric with the panel', () => {
    expect(ruleBody('.select-control option')).toMatch(/\brounded-control\b/);
    expect(ruleBody('.select-control::picker(select)')).toMatch(/\bp-1\b/);
  });
});
