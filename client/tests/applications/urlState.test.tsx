import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';
import { parseFilters, toSearchParams } from '@/features/applications/filterParams';
import { makeApplication, makeListResponse, makeSession } from '../utils/factories';
import { installMockApi, type MockApi, type RecordedRequest } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

const LIST = 'GET /applications';

function listRoute(mock: { applications: ReturnType<typeof makeApplication>[] }) {
  return () => ({ status: 200, data: makeListResponse(mock.applications) });
}

function lastListRequest(mock: MockApi): RecordedRequest {
  const calls = mock.callsTo('GET', '/applications');
  return calls[calls.length - 1];
}

beforeEach(() => {
  resetClientState();
});

afterEach(() => {
  resetClientState();
});

describe('filter codec', () => {
  it('round-trips every filter through the URL', () => {
    const filters = parseFilters(
      new URLSearchParams(
        'search=stripe&status=applied,interview&priority=high&source=referral&tags=backend,remote' +
          '&company=Stripe&dateFrom=2026-01-01&dateTo=2026-03-01&archived=true&sort=deadline:asc&page=3&limit=50',
      ),
    );

    expect(filters).toMatchObject({
      search: 'stripe',
      status: ['applied', 'interview'],
      priority: ['high'],
      source: ['referral'],
      tags: ['backend', 'remote'],
      company: 'Stripe',
      dateFrom: '2026-01-01',
      dateTo: '2026-03-01',
      archived: true,
      sort: 'deadline:asc',
      page: 3,
      limit: 50,
    });

    expect(parseFilters(toSearchParams(filters))).toEqual(filters);
  });

  it('drops values the API would reject rather than failing the page', () => {
    const filters = parseFilters(
      new URLSearchParams(
        'status=applied,not-a-status&sort=nope:sideways&page=0&dateFrom=yesterday',
      ),
    );

    expect(filters.status).toEqual(['applied']);
    expect(filters.sort).toBe('createdAt:desc');
    expect(filters.page).toBe(1);
    expect(filters.dateFrom).toBeUndefined();
  });

  it('omits defaults so a clean view keeps a clean URL', () => {
    expect(toSearchParams(parseFilters(new URLSearchParams())).toString()).toBe('');
  });
});

describe('URL as the source of list state', () => {
  it('restores filters from the URL on a fresh mount, not from defaults', async () => {
    const state = { applications: [makeApplication({ company: 'Stripe', status: 'interview' })] };
    const mock = installMockApi({ [LIST]: listRoute(state) });
    signIn(makeSession());

    renderWithProviders(<App />, {
      route: '/applications?status=interview&priority=high&search=stripe&sort=deadline:asc&page=2',
    });

    await screen.findByText('Stripe');

    // A fresh mount is the same code path as a navigation: nothing is held
    // outside the URL, so the request is built from what the address says.
    const request = lastListRequest(mock);
    expect(request.params).toMatchObject({
      status: 'interview',
      priority: 'high',
      search: 'stripe',
      sort: 'deadline:asc',
      page: '2',
    });
  });

  it('writes a filter change into the URL and refetches with it', async () => {
    const user = userEvent.setup();
    const state = { applications: [makeApplication({ company: 'Stripe' })] };
    const mock = installMockApi({ [LIST]: listRoute(state) });
    signIn(makeSession());

    renderWithProviders(<App />, { route: '/applications' });
    await screen.findByText('Stripe');

    await user.click(screen.getByRole('button', { name: /Filters/ }));
    await user.click(await screen.findByLabelText('Offer'));

    await waitFor(() => {
      expect(lastListRequest(mock).params).toMatchObject({ status: 'offer' });
    });
    expect(window.location.search).toBe('');
  });

  it('debounces the search box before it touches the URL', async () => {
    const user = userEvent.setup();
    const state = { applications: [makeApplication({ company: 'Stripe' })] };
    const mock = installMockApi({ [LIST]: listRoute(state) });
    signIn(makeSession());

    renderWithProviders(<App />, { route: '/applications' });
    await screen.findByText('Stripe');

    const before = mock.callsTo('GET', '/applications').length;
    await user.type(screen.getByLabelText('Search applications'), 'stripe');

    // Five keystrokes must not become five requests.
    expect(mock.callsTo('GET', '/applications')).toHaveLength(before);

    await waitFor(() => {
      expect(lastListRequest(mock).params).toMatchObject({ search: 'stripe' });
    });
  });
});
