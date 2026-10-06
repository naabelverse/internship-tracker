import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TextField } from '@/components/ui/TextField';

/**
 * `TextField` spaces its children with `space-y-1.5`, which gives every child
 * after the first a 6px top margin. A visually hidden label is still a child,
 * so as the first one it pushed the input down 6px with nothing visible above
 * it, and the toolbar search sat 3px below the buttons beside it. jsdom has no
 * layout, so this holds the structure that decides it: with a hidden label the
 * input's box is the first child; with a visible one the label still is.
 */
describe('TextField', () => {
  it('puts nothing in the spaced flow above the input when its label is hidden', () => {
    const { container } = render(<TextField label="Search applications" labelHidden />);
    const input = screen.getByRole('textbox', { name: 'Search applications' });

    expect(container.firstElementChild?.firstElementChild).toContainElement(input);
  });

  it('keeps a visible label first, above the input', () => {
    const { container } = render(<TextField label="Company" />);

    expect(container.firstElementChild?.firstElementChild).toBe(screen.getByText('Company'));
  });

  it('draws a leading element inside the field, after the input, without taking clicks', () => {
    render(<TextField label="Search" leading={<span data-testid="lead" />} />);
    const input = screen.getByRole('textbox', { name: 'Search' });
    const lead = screen.getByTestId('lead');

    expect(input.parentElement).toContainElement(lead);
    expect(input.compareDocumentPosition(lead) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(lead.parentElement).toHaveClass('pointer-events-none');
  });
});
