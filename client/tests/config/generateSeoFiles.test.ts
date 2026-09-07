import { describe, expect, it } from 'vitest';
// @ts-expect-error -- a build script, deliberately plain .mjs rather than part
// of either TypeScript project: it runs from npm before Vite or tsc are
// involved, and giving it a tsconfig would mean compiling it first.
import * as seo from '../../scripts/generateSeoFiles.mjs';
import { INDEXABLE_PATHS as APP_INDEXABLE_PATHS } from '@/routes/paths';

/**
 * The regression test for the bug that shipped `http://localhost:5173` to
 * production.
 *
 * The root cause was not the generation logic — it read `VITE_APP_URL`
 * correctly. It was that the output was committed as a static file and never
 * regenerated, so the localhost fallback that won once won forever. The build
 * now regenerates these; what is worth asserting here is that the generator
 * honours the origin it is handed and leaks no fallback when one is supplied.
 */
const robotsTxt = seo.robotsTxt as (siteUrl: string) => string;
const sitemapXml = seo.sitemapXml as (siteUrl: string, today?: string) => string;
const normaliseSiteUrl = seo.normaliseSiteUrl as (value: string | undefined) => string;
const INDEXABLE_PATHS = seo.INDEXABLE_PATHS as string[];

const PROD = 'https://tracker.example.com';

describe('SEO file generation', () => {
  it('puts the supplied origin in robots.txt, with no localhost left behind', () => {
    const txt = robotsTxt(PROD);

    expect(txt).toContain(`Sitemap: ${PROD}/sitemap.xml`);
    expect(txt).not.toContain('localhost');
  });

  it('puts the supplied origin on every sitemap entry', () => {
    const xml = sitemapXml(PROD, '2026-01-01');

    expect(xml).not.toContain('localhost');
    for (const route of APP_INDEXABLE_PATHS) {
      const expected = route === '/' ? PROD : `${PROD}${route}`;
      expect(xml).toContain(`<loc>${expected}</loc>`);
    }
  });

  it('never doubles the slash when the origin has a trailing one', () => {
    const xml = sitemapXml(normaliseSiteUrl(`${PROD}/`), '2026-01-01');

    expect(xml).toContain(`<loc>${PROD}/login</loc>`);
    expect(xml).not.toContain('//login');
  });

  it('falls back to the dev origin only when nothing is set', () => {
    expect(normaliseSiteUrl(undefined)).toBe('http://localhost:5173');
    expect(normaliseSiteUrl(PROD)).toBe(PROD);
  });

  // The generator carries its own copy of the route list because it runs under
  // bare node and cannot import the app's TypeScript. This is what stops that
  // copy drifting from the routes the app actually exposes.
  it('lists exactly the routes the app considers indexable', () => {
    expect(INDEXABLE_PATHS).toEqual([...APP_INDEXABLE_PATHS]);
  });
});
