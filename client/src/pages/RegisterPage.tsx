import { Seo } from '@/components/Seo';
import { Link } from 'react-router-dom';
import { AuthSplitLayout } from '@/features/auth/AuthSplitLayout';
import { RegisterForm } from '@/features/auth/RegisterForm';
import { paths } from '@/routes/paths';

export function RegisterPage(): JSX.Element {
  return (
    <>
      <Seo
        title="Create your account"
        description="Create a free Internship Tracker account and keep every application, deadline and interview in one place."
      />
      <AuthSplitLayout
        title="Create your account"
        subtitle="Track every application in one place."
        footer={
          <>
            Already have an account?{' '}
            <Link to={paths.login} className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </>
        }
      >
        <RegisterForm />
      </AuthSplitLayout>
    </>
  );
}

/** Default export as well, so `React.lazy` can import this route. */
export default RegisterPage;
