import { useRef, useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { AVATAR_TYPES, toAvatarDataUrl } from '@/features/settings/avatarImage';
import { useUpdateProfile } from '@/features/settings/useSettingsMutations';
import type { User } from '@/types/user';

interface AvatarFieldProps {
  user: User;
  /**
   * An unsaved link from the link box, previewed in place of the saved picture.
   * Undefined when the box still matches the account.
   */
  linkPreview?: string;
  /** Lets the profile form re-seed its link field from the saved account. */
  onSaved: (user: User) => void;
  /** The link field, set under the buttons so the two read as one control. */
  children: ReactNode;
}

/**
 * The picture, with upload and remove.
 *
 * A picked file is previewed first and saved on its own by "Save picture"
 * rather than by "Save profile": it is not something a form can show back in a
 * text box, and a half-finished upload sitting in a dirty form is easy to lose.
 * A pasted link is previewed too but rides with the form, like any other field.
 */
export function AvatarField({
  user,
  linkPreview,
  onSaved,
  children,
}: AvatarFieldProps): JSX.Element {
  const update = useUpdateProfile();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isReading, setIsReading] = useState(false);
  const [picked, setPicked] = useState<string>();
  const isBusy = isReading || update.isPending;

  const save = (avatarUrl: string): void => {
    update.mutate(
      { avatarUrl },
      {
        onSuccess: (saved) => {
          setPicked(undefined);
          onSaved(saved);
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

  let note = 'PNG, JPEG or WebP, up to 5 MB.';
  if (picked) note = 'Preview. Not saved yet.';
  else if (linkPreview !== undefined) note = 'Preview. Save profile to keep it.';

  return (
    <div className="space-y-1.5">
      <span className="block text-sm font-medium text-content">Avatar</span>
      <div className="flex items-start gap-4">
        <UserAvatar name={user.name} src={picked ?? linkPreview ?? user.avatarUrl} size="lg" />
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
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
              </>
            )}
            <span className="text-xs text-content-subtle">{note}</span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
