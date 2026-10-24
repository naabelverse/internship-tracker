import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from '@/pages/SettingsPage';
import { useAuthStore } from '@/store/authStore';
import { useThemeStore } from '@/store/themeStore';
import { errorBody, makeSession, makeUser, successBody } from '../utils/factories';
import { installMockApi, type MockApi, type Responder } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';
import { installThemeTokens, removeThemeTokens } from '../utils/themeTokens';

const PATCH_ME = 'PATCH /auth/me';
const PATCH_PASSWORD = 'PATCH /auth/me/password';

const ACCOUNT = makeUser({
  name: 'Ada Lovelace',
  email: 'ada@example.test',
  university: 'Analytical University',
  gradYear: 2027,
  targetRoles: ['Backend Intern'],
  weeklyGoal: 5,
  theme: 'dark',
  timezone: 'Asia/Kuala_Lumpur',
  emailRemindersEnabled: true,
});

/** `UsageSection` fetches on mount, so every render of this page needs it answered. */
const USAGE: Responder = () => ({
  status: 200,
  data: successBody({
    applications: { used: 12, limit: 2000, remaining: 1988 },
    storageBytes: { used: 5_242_880, limit: 104_857_600, remaining: 99_614_720 },
    attachmentsPerApplication: { limit: 20 },
  }),
});

function renderSettings(routes: Record<string, Responder> = {}): MockApi {
  const api = installMockApi({ 'GET /auth/me/usage': USAGE, ...routes });
  signIn(makeSession({ user: ACCOUNT }));
  renderWithProviders(<SettingsPage />);

  return api;
}

/** The saved-user echo the API returns from a successful PATCH. */
function saved(): Responder {
  return (request) => ({
    status: 200,
    data: successBody({ user: { ...ACCOUNT, ...(request.data as object) } }),
  });
}

beforeEach(() => {
  installThemeTokens();
  useThemeStore.setState({ preference: 'dark', resolved: 'dark' });
});

afterEach(() => {
  removeThemeTokens();
  resetClientState();
});

describe('settings profile', () => {
  it('seeds every field from the account', async () => {
    renderSettings();

    expect(await screen.findByLabelText('Name')).toHaveValue('Ada Lovelace');
    expect(screen.getByLabelText('University')).toHaveValue('Analytical University');
    expect(screen.getByLabelText('Graduation year')).toHaveValue('2027');
    expect(screen.getByText('Backend Intern')).toBeInTheDocument();
    // Email is shown but not editable: changing it needs the verification flow.
    expect(screen.getByLabelText('Email')).toBeDisabled();
  });

  it('saves the changed fields and nothing else', async () => {
    const user = userEvent.setup();
    const api = renderSettings({ [PATCH_ME]: saved() });

    const name = await screen.findByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Ada L');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => {
      expect(api.callsTo('PATCH', '/auth/me')).toHaveLength(1);
    });
    expect(api.callsTo('PATCH', '/auth/me')[0].data).toMatchObject({
      name: 'Ada L',
      gradYear: 2027,
      targetRoles: ['Backend Intern'],
    });
  });

  it('keeps the save button inert until something actually changes', async () => {
    renderSettings();

    expect(await screen.findByRole('button', { name: 'Save profile' })).toBeDisabled();
  });

  it('rejects a bad graduation year before it reaches the server', async () => {
    const user = userEvent.setup();
    const api = renderSettings();

    const year = await screen.findByLabelText('Graduation year');
    await user.clear(year);
    await user.type(year, '20');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(await screen.findByText('Enter a four digit year')).toBeInTheDocument();
    expect(api.callsTo('PATCH', '/auth/me')).toHaveLength(0);
  });

  it('adds and removes a target role from the keyboard', async () => {
    const user = userEvent.setup();
    renderSettings();

    const roles = await screen.findByLabelText('Target roles');
    await user.type(roles, 'Platform Intern{Enter}');

    expect(screen.getByText('Platform Intern')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove Platform Intern' }));

    expect(screen.queryByText('Platform Intern')).not.toBeInTheDocument();
  });

  it('puts a server field error on the field it belongs to', async () => {
    const user = userEvent.setup();
    renderSettings({
      [PATCH_ME]: () => ({
        status: 400,
        data: errorBody('Validation failed', 'VALIDATION_ERROR', {
          name: ['must be at least 2 characters'],
        }),
      }),
    });

    const name = await screen.findByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Ada L');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    expect(await screen.findByText('Must be at least 2 characters')).toBeInTheDocument();
  });
});

describe('settings preferences', () => {
  it('saves the timezone, goal and reminder flag together', async () => {
    const user = userEvent.setup();
    const api = renderSettings({ [PATCH_ME]: saved() });

    const goal = await screen.findByLabelText('Weekly goal');
    await user.clear(goal);
    await user.type(goal, '8');
    await user.selectOptions(screen.getByLabelText('Timezone'), 'America/Los_Angeles');
    // Named rather than positional: Phase 12 added the weekly summary opt-in
    // beside this one, so a bare checkbox query is now ambiguous.
    await user.click(screen.getByRole('checkbox', { name: /reminders about upcoming deadlines/i }));
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    await waitFor(() => {
      expect(api.callsTo('PATCH', '/auth/me')).toHaveLength(1);
    });
    expect(api.callsTo('PATCH', '/auth/me')[0].data).toEqual({
      theme: 'dark',
      weeklyGoal: 8,
      timezone: 'America/Los_Angeles',
      emailRemindersEnabled: false,
      // Untouched by this case, and sent as it stands: the two streams are
      // independent preferences saved by one form.
      weeklySummaryEnabled: false,
    });
  });

  it('sends the weekly summary opt-in independently of the reminder flag', async () => {
    const user = userEvent.setup();
    const api = renderSettings({ [PATCH_ME]: saved() });

    await user.click(await screen.findByRole('checkbox', { name: /weekly summary of my stats/i }));
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    await waitFor(() => {
      expect(api.callsTo('PATCH', '/auth/me')).toHaveLength(1);
    });

    const body = api.callsTo('PATCH', '/auth/me')[0].data as Record<string, unknown>;
    expect(body.weeklySummaryEnabled).toBe(true);
    expect(body.emailRemindersEnabled).toBe(true);
  });

  it('keeps the account timezone in the list even though it is unusual', async () => {
    installMockApi({});
    signIn(makeSession({ user: { ...ACCOUNT, timezone: 'Indian/Christmas' } }));
    renderWithProviders(<SettingsPage />);

    const select = await screen.findByLabelText('Timezone');

    expect(within(select).getByRole('option', { name: /Indian \/ Christmas/ })).toBeInTheDocument();
  });

  it('reports the account state back after a successful save', async () => {
    const user = userEvent.setup();
    renderSettings({ [PATCH_ME]: saved() });

    const goal = await screen.findByLabelText('Weekly goal');
    await user.clear(goal);
    await user.type(goal, '9');
    await user.click(screen.getByRole('button', { name: 'Save preferences' }));

    await waitFor(() => {
      expect(useAuthStore.getState().user?.weeklyGoal).toBe(9);
    });
  });
});

describe('settings password', () => {
  it('warns that other sessions end before the button is pressed', async () => {
    renderSettings();

    expect(await screen.findByText(/every other device is signed out/i)).toBeInTheDocument();
  });

  it('sends the change and clears the form', async () => {
    const user = userEvent.setup();
    const api = renderSettings({
      [PATCH_PASSWORD]: () => ({ status: 200, data: successBody({}) }),
    });

    await user.type(await screen.findByLabelText('Current password'), 'Password1');
    await user.type(screen.getByLabelText('New password'), 'Password2');
    await user.type(screen.getByLabelText('Confirm new password'), 'Password2');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => {
      expect(api.callsTo('PATCH', '/auth/me/password')).toHaveLength(1);
    });
    expect(api.callsTo('PATCH', '/auth/me/password')[0].data).toEqual({
      currentPassword: 'Password1',
      newPassword: 'Password2',
    });
    await waitFor(() => {
      expect(screen.getByLabelText('Current password')).toHaveValue('');
    });
  });

  it('catches a mismatched confirmation without a round trip', async () => {
    const user = userEvent.setup();
    const api = renderSettings();

    await user.type(await screen.findByLabelText('Current password'), 'Password1');
    await user.type(screen.getByLabelText('New password'), 'Password2');
    await user.type(screen.getByLabelText('Confirm new password'), 'Password3');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Both passwords must match')).toBeInTheDocument();
    expect(api.callsTo('PATCH', '/auth/me/password')).toHaveLength(0);
  });

  it('puts a wrong current password on the field', async () => {
    const user = userEvent.setup();
    renderSettings({
      [PATCH_PASSWORD]: () => ({
        status: 400,
        data: errorBody('Validation failed', 'VALIDATION_ERROR', {
          currentPassword: ['is incorrect'],
        }),
      }),
    });

    await user.type(await screen.findByLabelText('Current password'), 'Wrong1234');
    await user.type(screen.getByLabelText('New password'), 'Password2');
    await user.type(screen.getByLabelText('Confirm new password'), 'Password2');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Is incorrect')).toBeInTheDocument();
  });
});

/**
 * Rewritten in Phase 14, deliberately.
 *
 * This block used to assert that both actions were disabled and labelled "not
 * available yet". That had already stopped being true for deletion when Phase 11
 * shipped `DangerZoneSection`, and Phase 14 makes the export real - so the old
 * assertions were pinning a placeholder rather than describing the product. The
 * replacement asserts what the section now actually does, and the "no stale
 * copy" case is what stops the placeholder wording creeping back.
 */
describe('settings section navigation', () => {
  const nextFrame = (): Promise<void> =>
    act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

  it('links to every section, and every link has a target on the page', async () => {
    renderSettings();
    await screen.findByLabelText('Name');

    const links = within(
      screen.getByRole('navigation', { name: 'Settings sections' }),
    ).getAllByRole('link');

    expect(links).toHaveLength(8);
    for (const link of links) {
      const id = link.getAttribute('href')?.slice(1) ?? '';
      expect(document.getElementById(id), `#${id}`).not.toBeNull();
    }
  });

  /**
   * jsdom has no layout, so each section is given a top: 600 px apart, starting
   * below the top bar. Scrolling 700 px lifts the second past the 96 px line.
   */
  it('marks the section whose top has passed the top bar', async () => {
    const order = [
      'profile',
      'email',
      'preferences',
      'password',
      'sessions',
      'usage',
      'data',
      'close-account',
    ];
    let scrolled = 0;
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const index = order.indexOf(this.id);
      return DOMRect.fromRect({ y: index === -1 ? 0 : 120 + index * 600 - scrolled });
    });

    try {
      renderSettings();
      await screen.findByLabelText('Name');
      const nav = screen.getByRole('navigation', { name: 'Settings sections' });
      const current = (): string | undefined =>
        within(nav).queryByRole('link', { current: 'location' })?.textContent ?? undefined;

      await nextFrame();
      expect(current()).toBe('Profile');

      scrolled = 700;
      fireEvent.scroll(window);
      await nextFrame();
      expect(current()).toBe('Email address');

      // A jump to #usage snaps to a device pixel and can stop a fraction short of
      // the line, which used to mark "Signed in devices" instead.
      scrolled = 120 + 5 * 600 - 96.25;
      fireEvent.scroll(window);
      await nextFrame();
      expect(current()).toBe('Storage and limits');

      // At the very bottom (jsdom's scrollHeight is 0), "Your data" sits on
      // screen at 220 px but can never reach the line: the clicked link wins.
      Object.defineProperty(window, 'scrollY', { value: 3500, configurable: true });
      scrolled = 3500;
      window.location.hash = '#data';
      fireEvent(window, new HashChangeEvent('hashchange'));
      await nextFrame();
      expect(current()).toBe('Your data');

      // A stale hash for a section scrolled off screen falls back to the last.
      window.location.hash = '#profile';
      fireEvent(window, new HashChangeEvent('hashchange'));
      await nextFrame();
      expect(current()).toBe('Close your account');
    } finally {
      rect.mockRestore();
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
      window.location.hash = '';
    }
  });
});

describe('settings data section', () => {
  it('offers a working export rather than a disabled placeholder', async () => {
    renderSettings();

    expect(await screen.findByRole('button', { name: 'Export' })).toBeEnabled();
  });

  it('says what the file contains, because the privacy page promises it', async () => {
    renderSettings();
    await screen.findByRole('button', { name: 'Export' });

    const section = screen.getByRole('region', { name: 'Your data' });

    expect(within(section).getByText(/every application and its interviews/i)).toBeInTheDocument();
    expect(within(section).getByText(/every reminder/i)).toBeInTheDocument();
    expect(within(section).getByText(/each signed-in device/i)).toBeInTheDocument();
    // The two exclusions the export service really makes.
    expect(
      within(section).getByText(/attachments are listed with their name/i),
    ).toBeInTheDocument();
    expect(
      within(section).getByText(/passwords and session tokens are never included/i),
    ).toBeInTheDocument();
  });

  it('carries no copy claiming a feature is unavailable', async () => {
    renderSettings();
    await screen.findByRole('button', { name: 'Export' });

    expect(screen.queryByText(/not available yet/i)).not.toBeInTheDocument();
  });

  it('leaves deletion to the danger zone, so there is one affordance for it', async () => {
    renderSettings();
    await screen.findByRole('button', { name: 'Export' });

    // The old placeholder button is gone; the real flow lives in its own section
    // and opens a confirmation rather than deleting on the first click.
    expect(screen.queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close my account' })).toBeEnabled();
  });
});
