import { LegalPage } from '@/pages/LegalPage';
import termsMarkdown from '../../content/terms.md?raw';

export default function TermsPage(): JSX.Element {
  return (
    <LegalPage
      title="Terms of Service"
      description="The terms covering your use of Internship Tracker: what the service is, what your account and your content are, acceptable use, and how either side can end it."
      source={termsMarkdown}
    />
  );
}
