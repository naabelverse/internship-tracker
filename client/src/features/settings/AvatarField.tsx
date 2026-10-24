import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { AVATAR_TYPES, toAvatarDataUrl } from '@/features/settings/avatarImage';
import { useUpdateProfile } from '@/features/settings/useSettingsMutations';
import type { User } from '@/types/user';

interface AvatarFieldProps {
  user: User;
  /** Lets the profile form re-seed its link field from the saved account. */
  onSaved: (user: User) => void;
}

/**
 * The picture, with upload and remove. Both save at once rather than waiting
 * for "Save profile": a picked file is not something a form can show back in a
 * text box, and a half-finished upload sitting in a dirty form is easy to lose.
 */
export function AvatarField({ user, onSaved }: AvatarFieldProps): JSX.Element {
  const update = useUpdateProfile();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isReading, setIsReading] = useState(false);
  const isBusy = isReading || update.isPending;

  const save = (avatarUrl: string): void => {
    update.mutate({ avatarUrl }, { onSuccess: onSaved });
  };

  const upload = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setIsReading(true);
    try {
      save(await toAvatarDataUrl(file));
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
        <UserAvatar name={user.name} src={user.avatarUrl} size="lg" />
        <input
          ref={inputRef}
          type="file"
          accept={AVATAR_TYPES.join(',')}
          className="sr-only"
          tabIndex={-1}
          aria-label="Avatar image file"
          onChange={(event) => {
            void upload(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            isLoading={isBusy}
            loadingLabel="Saving"
            onClick={() => {
              inputRef.current?.click();
            }}
          >
            Upload image
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
        </div>
      </div>
      <p className="text-xs text-content-subtle">PNG, JPEG or WebP, up to 5 MB.</p>
    </div>
  );
}
