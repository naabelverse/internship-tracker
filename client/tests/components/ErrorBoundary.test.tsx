import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from '@/components/ErrorBoundary';

/** Flipped between renders so "Try again" has something different to render. */
const failure = { current: true };

function Boom(): JSX.Element {
  if (failure.current) throw new Error('Chart data was malformed');
  return <p>Content recovered</p>;
}

beforeEach(() => {
  failure.current = true;
  // React prints the boundary warning itself; the app logger is already quiet in tests.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('shows a readable panel instead of a blank page', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Something broke on this page');
    expect(screen.getByText('Chart data was malformed')).toBeInTheDocument();
  });

  it('offers a retry that re-renders the subtree', async () => {
    const user = userEvent.setup();

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    failure.current = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('Content recovered')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps a reload escape hatch for an error the retry cannot clear', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
  });

  it('renders its children untouched when nothing throws', () => {
    failure.current = false;

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Content recovered')).toBeInTheDocument();
  });
});
