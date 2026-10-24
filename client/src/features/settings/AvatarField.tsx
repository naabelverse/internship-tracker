import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { AVATAR_TYPES, toAvatarDataUrl } from '@/features/settings/avatarImage';
import { useUpdateProfile } from '@/features/settings/useSettingsMutations';
import type { User } from '@/types/user';

interface AvatarFieldProps {
  user: User;
}

/**
 * The picture: upload, preview, then save or cancel; or remove.
 *
 * Upload is the only way in. A pasted link was offered too, but a page link
 * (a gallery or search result) is HTML rather than an image, and the preview
 * fell back to initials with no obvious reason. The picture saves on its own
 * rather than with "Save profile", since a picked file is not something a form
 * can show back in a text box.
 */
export function AvatarField({ user }: AvatarFieldProps): JSX.Element {
  const update = useUpdateProfile();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isReading, setIsReading] = useState(false);
  const [picked, setPicked] = useState<string>();
  const isBusy = isReading || update.isPending;

  const save = (avatarUrl: string): void => {
    update.mutate(
      { avatarUrl },
      {
        onSuccess: () => {
          setPicked(undefined);
        },
      },
    );
  };

  const pick = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setIsReading(true);
    try {
      setPicked(await toAvatarDataUrl(file));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'That image could not be used.');
    } finally {
      setIsReading(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <span className="block text-sm font-medium text-content">Avatar</span>
      <div className="flex items-center gap-4">
        <UserAvatar name={user.name} src={picked ?? user.avatarUrl} size="lg" />
        <input
          ref={inputRef}
          type="file"
          accept={AVATAR_TYPES.join(',')}
          className="sr-only"
          tabIndex={-1}
          aria-label="Avatar image file"
          onChange={(event) => {
            void pick(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {picked ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  isLoading={update.isPending}
                  loadingLabel="Saving"
                  onClick={() => {
                    save(picked);
                  }}
                >
                  Save picture
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={update.isPending}
                  onClick={() => {
                    setPicked(undefined);
                  }}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  isLoading={isBusy}
                  loadingLabel={isReading ? 'Reading' : 'Saving'}
                  onClick={() => {
                    inputRef.current?.click();
                  }}
                >
                  {user.avatarUrl ? 'Change picture' : 'Upload picture'}
                </Button>
                {user.avatarUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => {
                      save('');
                    }}
                  >
                    Remove
                  </Button>
                )}
              </>
            )}
          </div>
          <p className="text-xs text-content-subtle">
            {picked
              ? 'Preview. Not saved yet.'
              : 'PNG, JPEG or WebP, up to 5 MB. Your initials show when there is no picture.'}
          </p>
        </div>
      </div>
    </div>
  );
}
