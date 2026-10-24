import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TargetRolesField } from '@/features/settings/TargetRolesField';

describe('TargetRolesField', () => {
  it('keeps saved roles when Backspace clears the draft and keeps going', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TargetRolesField value={['Backend Intern']} onChange={onChange} />);

    await user.type(screen.getByLabelText('Target roles'), 'QA{Backspace>5/}');

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Backend Intern')).toBeInTheDocument();
  });
});
