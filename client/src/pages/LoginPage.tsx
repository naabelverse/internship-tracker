import { Seo } from '@/components/Seo';
import { Link } from 'react-router-dom';
import { AuthSplitLayout } from '@/features/auth/AuthSplitLayout';
import { LoginForm } from '@/features/auth/LoginForm';
import { paths } from '@/routes/paths';

export function LoginPage(): JSX.Element {
  return (
    <>
      <Seo
        title="Sign in"
        description="Sign in to Internship Tracker and pick up your application pipeline where you left it."
      />
      <AuthSplitLayout
        title="Sign in"
        subtitle="Pick up where you left off."
        footer={
          <>
            New here?{' '}
            <Link to={paths.register} className="font-medium text-primary hover:underline">
              Create an account
            </Link>
          </>
        }
      >
        <LoginForm />
        <p className="mt-3 text-sm">
          <Link to={paths.forgotPassword} className="font-medium text-primary hover:underline">
            Forgot your password?
          </Link>
        </p>
      </AuthSplitLayout>
    </>
  );
}

/** Default export as well, so `React.lazy` can import this route. */
export default LoginPage;
