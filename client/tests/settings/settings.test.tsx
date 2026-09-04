import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

function renderSettings(routes: Record<string, Responder> = {}): MockApi {
  const api = installMockApi(routes);
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

describe('settings data section', () => {
  it('shows both actions as unavailable rather than hiding them', async () => {
    renderSettings();

    const exportButton = await screen.findByRole('button', { name: 'Export' });

    // Present and findable, so somebody looking for "how do I get my data out"
    // gets an answer, but inert because neither endpoint exists yet.
    expect(exportButton).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeDisabled();
    expect(screen.getByText(/full account export is not available yet/i)).toBeInTheDocument();
    expect(screen.getByText(/account deletion is not available yet/i)).toBeInTheDocument();
  });
});
