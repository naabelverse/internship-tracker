import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/App';

const healthBody = {
  success: true,
  data: {
    status: 'ok',
    service: 'internship-tracker-api',
    version: '1.0.0',
    environment: 'development',
    uptimeSeconds: 12,
    timestamp: '2026-01-01T00:00:00.000Z',
    database: { state: 'connected', connected: true },
  },
};

const okResponse = () => ({ ok: true, status: 200, json: () => Promise.resolve(healthBody) });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('renders what the API reports when the health check succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()));

    render(<App />);

    expect(await screen.findByText('API reachable')).toBeInTheDocument();
    expect(screen.getByText('internship-tracker-api')).toBeInTheDocument();
    expect(screen.getByText('connected')).toBeInTheDocument();
  });

  it('surfaces the reason when the API cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));

    render(<App />);

    expect(await screen.findByText('API unreachable')).toBeInTheDocument();
    expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
  });

  it('treats a non-2xx response as unreachable rather than showing stale data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 502, json: () => Promise.resolve({}) }),
    );

    render(<App />);

    expect(await screen.findByText('API unreachable')).toBeInTheDocument();
    expect(screen.getByText('API responded with 502')).toBeInTheDocument();
  });

  it('re-checks the API when the button is pressed', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    expect(await screen.findByText('API unreachable')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));

    await waitFor(() => {
      expect(screen.getByText('API reachable')).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
