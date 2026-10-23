import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { UserAvatar } from '@/components/ui/UserAvatar';

const PICTURE = 'https://images.example.test/ada.png';

describe('UserAvatar', () => {
  it('shows initials when there is no picture', () => {
    const { container } = render(<UserAvatar name="Ada King Lovelace" />);

    expect(screen.getByText('AK')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows the saved picture when there is one', () => {
    const { container } = render(<UserAvatar name="Ada Lovelace" src={PICTURE} />);

    expect(container.querySelector('img')).toHaveAttribute('src', PICTURE);
    expect(screen.queryByText('AL')).not.toBeInTheDocument();
  });

  it('falls back to initials when the picture fails, and retries a new URL', () => {
    const { container, rerender } = render(<UserAvatar name="Ada Lovelace" src={PICTURE} />);

    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(screen.getByText('AL')).toBeInTheDocument();

    const replacement = 'https://images.example.test/ada-2.png';
    rerender(<UserAvatar name="Ada Lovelace" src={replacement} />);
    expect(container.querySelector('img')).toHaveAttribute('src', replacement);
  });
});
