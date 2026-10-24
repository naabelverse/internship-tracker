import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { AvatarField } from '@/features/settings/AvatarField';
import { SettingsSection } from '@/features/settings/SettingsSection';
import { TargetRolesField } from '@/features/settings/TargetRolesField';
import { profileSchema, type ProfileValues } from '@/features/settings/settingsSchemas';
import { useUpdateProfile } from '@/features/settings/useSettingsMutations';
import { applyServerErrors } from '@/features/auth/serverErrors';
import type { User } from '@/types/user';

interface ProfileSectionProps {
  user: User;
}

const SERVER_FIELDS = ['name', 'university', 'gradYear', 'targetRoles'] as const;

function toValues(user: User): ProfileValues {
  return {
    name: user.name,
    university: user.university ?? '',
    gradYear: user.gradYear === undefined ? '' : String(user.gradYear),
    targetRoles: user.targetRoles,
  };
}

/**
 * SPEC section 6: name, university, gradYear and targetRoles. The avatar saves
 * on its own from `AvatarField`, so the form never carries it.
 */
export function ProfileSection({ user }: ProfileSectionProps): JSX.Element {
  const update = useUpdateProfile();
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: toValues(user),
  });

  const { isDirty } = form.formState;

  // Re-seed from the account only while the form is untouched. Resetting on
  // every background refetch would discard whatever the user was typing, which
  // is the bug Phase 6 hit on the application edit form.
  useEffect(() => {
    if (!isDirty) form.reset(toValues(user));
  }, [user, isDirty, form]);

  const onSubmit = form.handleSubmit((values) => {
    update.mutate(
      {
        name: values.name,
        // An empty box means "clear this", which the API expresses as an empty
        // string rather than an omitted key.
        university: values.university,
        targetRoles: values.targetRoles,
        ...(values.gradYear === '' ? {} : { gradYear: Number(values.gradYear) }),
      },
      {
        onSuccess: (saved) => {
          form.reset(toValues(saved));
        },
        onError: (error) => {
          applyServerErrors(
            error,
            form.setError,
            SERVER_FIELDS,
            'Your profile could not be saved.',
          );
        },
      },
    );
  });

  return (
    <SettingsSection
      title="Profile"
      description="How you appear in the app. Only you can see this."
      onSubmit={onSubmit}
      footer={
        <Button
          type="submit"
          isLoading={update.isPending}
          loadingLabel="Saving"
          disabled={!isDirty}
        >
          Save profile
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Name"
          autoComplete="name"
          error={form.formState.errors.name?.message}
          {...form.register('name')}
        />
        <TextField
          label="Email"
          value={user.email}
          readOnly
          disabled
          hint="Change it in the Email address section below."
        />
        <TextField
          label="University"
          error={form.formState.errors.university?.message}
          {...form.register('university')}
        />
        <TextField
          label="Graduation year"
          inputMode="numeric"
          placeholder="2027"
          error={form.formState.errors.gradYear?.message}
          {...form.register('gradYear')}
        />
      </div>

      <AvatarField user={user} />

      <Controller
        control={form.control}
        name="targetRoles"
        render={({ field, fieldState }) => (
          <TargetRolesField
            value={field.value}
            onChange={field.onChange}
            error={fieldState.error?.message}
          />
        )}
      />
    </SettingsSection>
  );
}
