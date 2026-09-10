import { useRef } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/ui/FormError';
import { Checkbox } from '@/components/ui/Checkbox';
import { PasswordField } from '@/components/ui/PasswordField';
import { TextField } from '@/components/ui/TextField';
import { detectTimezone, registerSchema, type RegisterValues } from '@/features/auth/authSchemas';
import { applyServerErrors } from '@/features/auth/serverErrors';
import { useRegister } from '@/features/auth/useAuthMutations';
import { paths } from '@/routes/paths';

const FIELDS = ['name', 'email', 'password'] as const;

const LEGAL_LINK = 'font-medium text-primary underline underline-offset-2 hover:no-underline';

/**
 * The honeypot input, off screen rather than `display: none`.
 *
 * A field hidden with `display: none` or `hidden` is the first thing a form
 * filler skips; one positioned out of view still looks fillable to anything
 * working from the DOM. `aria-hidden` and `tabIndex={-1}` keep it away from
 * screen readers and the tab order, so nobody using the form can reach it, and
 * `autoComplete="off"` stops a browser helpfully filling it for a real person.
 */
const HONEYPOT_STYLE = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

export function RegisterForm(): JSX.Element {
  const registerAccount = useRegister(paths.dashboard);
  // Set once, on first render, so it measures the form's whole time on screen.
  const mountedAt = useRef(Date.now());
  const honeypot = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '', acceptTerms: false as unknown as true },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await registerAccount.mutateAsync({
        name: values.name,
        email: values.email,
        password: values.password,
        acceptTerms: true,
        timezone: detectTimezone(),
        // Both are read at submit time rather than held in form state: neither
        // is a field the user edits, and neither should re-render anything.
        website: honeypot.current?.value ?? '',
        elapsedMs: Date.now() - mountedAt.current,
      });
    } catch (error) {
      applyServerErrors(error, setError, FIELDS, 'Could not create your account');
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <FormError message={errors.root?.message} />

      {/*
        Not registered with react-hook-form, and not in the zod schema: it is not
        a value the user provides, so it has no validation and no error state.
        See HONEYPOT_STYLE for why it is positioned away rather than hidden.
      */}
      <input
        ref={honeypot}
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={HONEYPOT_STYLE}
        defaultValue=""
      />

      <TextField
        label="Name"
        autoComplete="name"
        placeholder="Ada Lovelace"
        error={errors.name?.message}
        {...register('name')}
      />

      <TextField
        label="Email"
        type="email"
        autoComplete="email"
        placeholder="you@university.edu"
        error={errors.email?.message}
        {...register('email')}
      />

      <PasswordField
        label="Password"
        autoComplete="new-password"
        hint="At least 8 characters, with an uppercase letter, a lowercase letter and a number."
        error={errors.password?.message}
        {...register('password')}
      />

      {/*
        The label carries real links, so somebody can read what they are
        accepting without losing the half-filled form behind them. `acceptTerms`
        is sent to the server, which stamps `acceptedTermsAt` on the account.
      */}
      <Checkbox
        label={
          <>
            I accept the{' '}
            <Link to={paths.terms} target="_blank" rel="noreferrer" className={LEGAL_LINK}>
              Terms of Service
            </Link>{' '}
            and the{' '}
            <Link to={paths.privacy} target="_blank" rel="noreferrer" className={LEGAL_LINK}>
              Privacy Policy
            </Link>
            .
          </>
        }
        error={errors.acceptTerms?.message}
        {...register('acceptTerms')}
      />

      <Button
        type="submit"
        className="w-full"
        isLoading={isSubmitting}
        loadingLabel="Creating account"
      >
        Create account
      </Button>
    </form>
  );
}
