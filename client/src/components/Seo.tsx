import { Helmet } from 'react-helmet-async';
import { useLocation } from 'react-router-dom';
import { clientEnv } from '@/lib/env';

export const SITE_NAME = 'Internship Tracker';
export const OG_IMAGE_PATH = '/og-image.png';

interface SeoProps {
  /** The page's own title. The site name is appended, except on the landing page. */
  title: string;
  description: string;
  /** Landing page only: its title stands alone rather than reading "X | X". */
  standaloneTitle?: boolean;
  /**
   * Keeps a page out of the index. Every authenticated route sets this — there
   * is nothing behind a login for a crawler to find, and letting it try produces
   * an index full of sign-in redirects.
   */
  noIndex?: boolean;
}

/**
 * Per-route metadata, per SPEC section 12: title, description, canonical URL,
 * Open Graph and Twitter card tags.
 *
 * The canonical is derived from the current pathname rather than passed in, so a
 * page cannot be handed a canonical pointing somewhere it is not. Query strings
 * are dropped deliberately: `/applications?status=applied` is a filtered view of
 * one page, not a page of its own.
 */
export function Seo({ title, description, standaloneTitle, noIndex }: SeoProps): JSX.Element {
  const { pathname } = useLocation();
  const canonical = `${clientEnv.appUrl}${pathname === '/' ? '' : pathname}`;
  const fullTitle = standaloneTitle ? title : `${title} | ${SITE_NAME}`;
  const imageUrl = `${clientEnv.appUrl}${OG_IMAGE_PATH}`;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />
      {noIndex ? <meta name="robots" content="noindex, nofollow" /> : null}

      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={imageUrl} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={`${SITE_NAME} — the applications board`} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={imageUrl} />
    </Helmet>
  );
}
