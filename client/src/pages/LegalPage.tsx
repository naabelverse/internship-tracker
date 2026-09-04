import { Seo } from '@/components/Seo';
import { MarketingShell } from '@/components/marketing/MarketingChrome';
import { renderMarkdown } from '@/lib/markdown';
import { CONTACT_EMAIL } from '@/lib/siteMeta';

interface LegalPageProps {
  title: string;
  description: string;
  /** Raw markdown, imported with Vite `?raw` so it stays a file in the repo. */
  source: string;
}

/**
 * The shared shell for Terms and Privacy, which SPEC section 12 requires to be
 * rendered from markdown held in the repository.
 *
 * `{{CONTACT_EMAIL}}` is substituted here rather than hard-coded into the two
 * documents, so filling in the real address is a one-line change in `siteMeta`
 * instead of a hunt through the prose.
 *
 * The markdown goes through the same `renderMarkdown` the notes editor uses, so
 * it is sanitised on the way to `dangerouslySetInnerHTML` even though the source
 * is our own file. Trusting it because we wrote it is the argument that stops
 * holding the day somebody edits it.
 */
export function LegalPage({ title, description, source }: LegalPageProps): JSX.Element {
  const html = renderMarkdown(source.split('{{CONTACT_EMAIL}}').join(CONTACT_EMAIL));

  return (
    <MarketingShell>
      <Seo title={title} description={description} />

      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        {/* Sanitised immediately above; see `renderMarkdown`. */}
        <div className="prose-legal" dangerouslySetInnerHTML={{ __html: html }} />
      </article>
    </MarketingShell>
  );
}
