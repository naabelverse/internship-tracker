import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileSection } from '@/features/settings/ProfileSection';
import type { User } from '@/types/user';
import { makeSession, makeUser, successBody } from '../utils/factories';
import { installMockApi, type MockApi } from '../utils/mockAdapter';
import { renderWithProviders, resetClientState, signIn } from '../utils/render';

// jsdom has no canvas, so the resize itself is checked in a real browser; here
// it stands in for the result, and the tests cover what the form does with it.
const toAvatarDataUrl = vi.hoisted(() => vi.fn<(file: File) => Promise<string>>());
vi.mock('@/features/settings/avatarImage', () => ({
  AVATAR_TYPES: ['image/png', 'image/jpeg', 'image/webp'],
  toAvatarDataUrl,
}));

const UPLOADED = 'data:image/webp;base64,UklGRgAAAABXRUJQ';
const PATCH_ME = 'PATCH /auth/me';

function renderProfile(account: User): MockApi {
  const api = installMockApi({
    [PATCH_ME]: (request) => ({
      status: 200,
      data: successBody({ user: { ...account, ...(request.data as object) } }),
    }),
  });
  signIn(makeSession({ user: account }));
  renderWithProviders(<ProfileSection user={account} />);
  return api;
}

const photo = (): File => new File(['photo'], 'me.jpg', { type: 'image/jpeg' });

afterEach(() => {
  toAvatarDataUrl.mockReset();
  vi.restoreAllMocks();
  resetClientState();
});

describe('avatar upload', () => {
  it('previews the resized picture, then saves it on its own', async () => {
    const user = userEvent.setup();
    toAvatarDataUrl.mockResolvedValue(UPLOADED);
    const api = renderProfile(makeUser({ name: 'Ada Lovelace' }));

    await user.upload(screen.getByLabelText('Avatar image file'), photo());

    expect(await screen.findByText('Preview. Not saved yet.')).toBeInTheDocument();
    expect(document.querySelector('img')).toHaveAttribute('src', UPLOADED);
    expect(api.callsTo('PATCH', '/auth/me')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Save picture' }));

    await waitFor(() => {
      expect(api.callsTo('PATCH', '/auth/me')).toHaveLength(1);
    });
    expect(api.callsTo('PATCH', '/auth/me')[0].data).toEqual({ avatarUrl: UPLOADED });
  });

  it('drops a previewed picture on Cancel and sends nothing', async () => {
    const user = userEvent.setup();
    toAvatarDataUrl.mockResolvedValue(UPLOADED);
    const api = renderProfile(makeUser({ name: 'Ada Lovelace' }));

    await user.upload(screen.getByLabelText('Avatar image file'), photo());
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: 'Upload picture' })).toBeInTheDocument();
    expect(api.callsTo('PATCH', '/auth/me')).toHaveLength(0);
  });

  it('says why a file was refused and sends nothing', async () => {
    const user = userEvent.setup();
    const error = vi.spyOn(toast, 'error');
    toAvatarDataUrl.mockRejectedValue(new Error('Choose an image under 5 MB.'));
    const api = renderProfile(makeUser());

    await user.upload(screen.getByLabelText('Avatar image file'), photo());

    await waitFor(() => {
      expect(error).toHaveBeenCalledWith('Choose an image under 5 MB.');
    });
    expect(api.callsTo('PATCH', '/auth/me')).toHaveLength(0);
  });

  it('removes the picture', async () => {
    const user = userEvent.setup();
    const api = renderProfile(makeUser({ avatarUrl: UPLOADED }));

    await user.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(api.callsTo('PATCH', '/auth/me')).toHaveLength(1);
    });
    expect(api.callsTo('PATCH', '/auth/me')[0].data).toEqual({ avatarUrl: '' });
  });

  it('offers no Remove when there is nothing to remove', () => {
    renderProfile(makeUser());

    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('offers no link box, and Save profile leaves the picture alone', async () => {
    const user = userEvent.setup();
    const api = renderProfile(makeUser({ name: 'Ada Lovelace', avatarUrl: UPLOADED }));

    expect(screen.queryByLabelText('Image link')).not.toBeInTheDocument();

    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Ada L');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => {
      expect(api.callsTo('PATCH', '/auth/me')).toHaveLength(1);
    });
    expect(api.callsTo('PATCH', '/auth/me')[0].data).not.toHaveProperty('avatarUrl');
  });

  it('names the button for what it does', () => {
    renderProfile(makeUser({ avatarUrl: UPLOADED }));

    expect(screen.getByRole('button', { name: 'Change picture' })).toBeInTheDocument();
  });
});
