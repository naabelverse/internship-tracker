import DOMPurify from 'dompurify';
import { marked } from 'marked';

/**
 * Renders note markdown to HTML that is safe to inject.
 *
 * Notes are the user's own text, but they round-trip through the API and land in
 * `dangerouslySetInnerHTML`, so the output is sanitised rather than trusted.
 * Sanitising after parsing, not before, is what closes the gap where a payload is
 * harmless as markdown and dangerous once expanded to HTML.
 */
export interface RenderMarkdownOptions {
  /**
   * Whether a single newline becomes a `<br>`.
   *
   * True for a note, where the user typed the break and expects to see it.
   * False for a document held in the repository: `content/terms.md` and
   * `content/privacy.md` are hard-wrapped at about ninety columns, and with
   * `breaks` on, every one of those wraps rendered as a line break - so a
   * paragraph arrived broken at whatever column the source file happened to
   * wrap at, which is what `/terms` and `/privacy` shipped.
   */
  breaks?: boolean;
}

export function renderMarkdown(source: string, options: RenderMarkdownOptions = {}): string {
  const { breaks = true } = options;
  const html = marked.parse(source, { async: false, gfm: true, breaks });

  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p',
      'br',
      'strong',
      'em',
      'del',
      'code',
      'pre',
      'blockquote',
      'ul',
      'ol',
      'li',
      'a',
      'h1',
      'h2',
      'h3',
      'h4',
      'hr',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
    ],
    ALLOWED_ATTR: ['href', 'title'],
    // Anything that is not http(s) or mailto — javascript: above all — is dropped.
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  });
}
