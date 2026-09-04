import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Select } from '@/components/ui/Select';
import { TextField } from '@/components/ui/TextField';
import { SettingsSection } from '@/features/settings/SettingsSection';
import { preferencesSchema, type PreferencesValues } from '@/features/settings/settingsSchemas';
import { detectedTimezone, timezoneOptions } from '@/features/settings/timezoneOptions';
import { useUpdatePreferences } from '@/features/settings/useSettingsMutations';
import { THEME_PREFERENCES, type User } from '@/types/user';

interface PreferencesSectionProps {
  user: User;
}

const THEME_LABELS: Record<(typeof THEME_PREFERENCES)[number], string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'Match my system',
};

const THEME_OPTIONS = THEME_PREFERENCES.map((value) => ({ value, label: THEME_LABELS[value] }));

function toValues(user: User): PreferencesValues {
  return {
    theme: user.theme,
    weeklyGoal: String(user.weeklyGoal),
    timezone: user.timezone,
    emailRemindersEnabled: user.emailRemindersEnabled,
  };
}

/**
 * Theme, weekly goal, reminder emails and timezone.
 *
 * The timezone is the field SPEC section 7 builds the day boundaries on. It is
 * captured from the browser at registration and this is the first place it can
 * be corrected. Changing it is safe: the reminder sweep re-reads every distinct
 * timezone each hour and the analytics pipelines take it per request, so nothing
 * derived is cached and a change simply applies from the next tick.
 */
export function PreferencesSection({ user }: PreferencesSectionProps): JSX.Element {
  const update = useUpdatePreferences();
  const form = useForm<PreferencesValues>({
    resolver: zodResolver(preferencesSchema),
    defaultValues: toValues(user),
  });

  const { isDirty } = form.formState;
  const detected = detectedTimezone();
  const currentTimezone = form.watch('timezone');

  useEffect(() => {
    if (!isDirty) form.reset(toValues(user));
  }, [user, isDirty, form]);

  const onSubmit = form.handleSubmit((values) => {
    update.mutate(
      {
        theme: values.theme,
        weeklyGoal: Number(values.weeklyGoal),
        timezone: values.timezone,
        emailRemindersEnabled: values.emailRemindersEnabled,
      },
      {
        onSuccess: (saved) => {
          form.reset(toValues(saved));
        },
      },
    );
  });

  return (
    <SettingsSection
      title="Preferences"
      description="How the app behaves for you, on every device you sign in from."
      onSubmit={onSubmit}
      footer={
        <Button
          type="submit"
          isLoading={update.isPending}
          loadingLabel="Saving"
          disabled={!isDirty}
        >
          Save preferences
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Theme"
          options={THEME_OPTIONS}
          error={form.formState.errors.theme?.message}
          {...form.register('theme')}
        />
        <TextField
          label="Weekly goal"
          inputMode="numeric"
          hint="Applications per week, shown as the ring on the dashboard."
          error={form.formState.errors.weeklyGoal?.message}
          {...form.register('weeklyGoal')}
        />
      </div>

      <div className="space-y-1.5">
        <Select
          label="Timezone"
          options={timezoneOptions(user.timezone)}
          error={form.formState.errors.timezone?.message}
          {...form.register('timezone')}
        />
        <p className="text-xs text-content-subtle">
          Deadlines, streaks and the weekly window are all counted in this timezone.
        </p>
        {currentTimezone !== detected && (
          <button
            type="button"
            onClick={() => {
              form.setValue('timezone', detected, { shouldDirty: true });
            }}
            className="text-xs font-medium text-primary hover:underline"
          >
            This device says {detected}. Use that instead.
          </button>
        )}
      </div>

      <Controller
        control={form.control}
        name="emailRemindersEnabled"
        render={({ field }) => (
          <Checkbox
            label="Email me reminders about upcoming deadlines and interviews"
            checked={field.value}
            onChange={(event) => {
              field.onChange(event.target.checked);
            }}
            onBlur={field.onBlur}
            ref={field.ref}
          />
        )}
      />
    </SettingsSection>
  );
}
