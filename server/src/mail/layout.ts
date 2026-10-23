import { APP_LOGO_MARK, APP_PRODUCT_NAME } from '@/config/app-info';
import { logoUrl } from '@/mail/links';
import { MAIL_PALETTE } from '@/mail/palette';

/**
 * The shared shell every template renders into: a masthead carrying the app name
 * and logo mark, a body of blocks, and a footer.
 *
 * Both bodies come from the same block list rather than from two hand-written
 * strings. That is the point of the block model: the plain-text alternative is a
 * projection of the same content, so a change to one cannot silently leave the
 * other behind.
 *
 * The HTML is deliberately old-fashioned — tables, inline styles, a 600px
 * ceiling and one `max-width` media query. Mail clients strip most `<style>`
 * rules, ignore flexbox, and re-flow anything wider than the viewport, so this
 * is what "responsive" has to mean inside a message body.
 */

export interface StatItem {
  label: string;
  value: string;
  hint?: string;
}

export interface ListEntry {
  title: string;
  detail: string;
  context?: string;
}

export type MailBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'button'; label: string; url: string }
  | { type: 'list'; entries: ListEntry[] }
  | { type: 'stats'; items: StatItem[] }
  | { type: 'note'; text: string };

export interface MailFooter {
  /** Always present: where a signed-in user manages every email setting. */
  preferencesUrl: string;
  /** Optional mail only. One click, no sign-in, per SPEC section 13. */
  unsubscribeUrl?: string;
  /** What the unsubscribe link actually turns off, named in the copy. */
  unsubscribeLabel?: string;
}

export interface LayoutInput {
  /** The `<h1>` and the `<title>`; the subject line is chosen by the template. */
  heading: string;
  /** The grey line an inbox list shows next to the subject. */
  preheader: string;
  blocks: MailBlock[];
  footer: MailFooter;
}

/*
  Generated from the light theme block of `client/src/index.css` by
  `npm run mail:palette -w server`, not written here. These were six hex literals
  - a templated indigo and five greys - with nothing tying them to the app's
  tokens, so every transactional email kept rendering `#4f46e5` for two redesigns
  after the primary moved to violet (issue #10). The same defect
  `brandPalette.mjs` ended for the favicons, one workspace over.

  `brandFill` rather than `brand` backs the tile and the button because both are
  solid blocks carrying white text, which is the fill token's stated job; the
  detail line in a list is an accent on the surface and keeps `brand`.
*/
const {
  brand: BRAND,
  brandFill: BRAND_FILL,
  brandFillText: BRAND_FILL_TEXT,
  ink: INK,
  muted: MUTED,
  border: BORDER,
  canvas: CANVAS,
  surface: SURFACE,
} = MAIL_PALETTE;

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif,'Apple Color Emoji'";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paragraphHtml(text: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:${INK};">${escapeHtml(text)}</p>`;
}

function buttonHtml(label: string, url: string): string {
  const href = escapeHtml(url);

  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">',
    `<tr><td style="border-radius:8px;background:${BRAND_FILL};">`,
    `<a href="${href}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;line-height:20px;color:${BRAND_FILL_TEXT};text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>`,
    '</td></tr></table>',
    // The button is a link, and some clients flatten it. The address has to be
    // readable on its own or the message becomes a dead end.
    `<p style="margin:0 0 16px;font-size:12px;line-height:20px;color:${MUTED};word-break:break-all;">Or paste this into your browser: ${href}</p>`,
  ].join('');
}

function listHtml(entries: ListEntry[]): string {
  const rows = entries
    .map((entry) => {
      const context = entry.context
        ? `<div style="font-size:13px;line-height:20px;color:${MUTED};">${escapeHtml(entry.context)}</div>`
        : '';

      return [
        `<tr><td style="padding:12px 0;border-bottom:1px solid ${BORDER};">`,
        `<div style="font-size:15px;line-height:22px;font-weight:600;color:${INK};">${escapeHtml(entry.title)}</div>`,
        context,
        `<div style="font-size:13px;line-height:20px;color:${BRAND};">${escapeHtml(entry.detail)}</div>`,
        '</td></tr>',
      ].join('');
    })
    .join('');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">${rows}</table>`;
}

function statCellHtml(item: StatItem): string {
  const hint = item.hint
    ? `<div style="font-size:12px;line-height:18px;color:${MUTED};">${escapeHtml(item.hint)}</div>`
    : '';

  return [
    '<td class="stat" width="50%" style="padding:0 8px 12px 0;vertical-align:top;">',
    `<div style="border:1px solid ${BORDER};border-radius:8px;padding:12px;">`,
    `<div style="font-size:12px;line-height:18px;text-transform:uppercase;letter-spacing:.04em;color:${MUTED};">${escapeHtml(item.label)}</div>`,
    `<div style="font-size:22px;line-height:30px;font-weight:700;color:${INK};">${escapeHtml(item.value)}</div>`,
    hint,
    '</div></td>',
  ].join('');
}

/**
 * Two tiles per row. `display:block` in the mobile media query drops them to one
 * column, which is the only reliable way to reflow a table cell in Outlook.
 */
function statsHtml(items: StatItem[]): string {
  const rows: string[] = [];

  for (let index = 0; index < items.length; index += 2) {
    rows.push(
      `<tr>${items
        .slice(index, index + 2)
        .map(statCellHtml)
        .join('')}</tr>`,
    );
  }

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;">${rows.join('')}</table>`;
}

function noteHtml(text: string): string {
  return `<p style="margin:0 0 16px;padding:12px 14px;border-radius:8px;background:${CANVAS};font-size:13px;line-height:20px;color:${MUTED};">${escapeHtml(text)}</p>`;
}

function blockHtml(block: MailBlock): string {
  switch (block.type) {
    case 'paragraph':
      return paragraphHtml(block.text);
    case 'button':
      return buttonHtml(block.label, block.url);
    case 'list':
      return listHtml(block.entries);
    case 'stats':
      return statsHtml(block.items);
    case 'note':
      return noteHtml(block.text);
  }
}

function footerHtml(footer: MailFooter): string {
  const links = [
    `<a href="${escapeHtml(footer.preferencesUrl)}" style="color:${MUTED};">Email preferences</a>`,
  ];

  if (footer.unsubscribeUrl) {
    const what = escapeHtml(footer.unsubscribeLabel ?? 'these emails');
    links.push(
      `<a href="${escapeHtml(footer.unsubscribeUrl)}" style="color:${MUTED};">Unsubscribe from ${what}</a>`,
    );
  }

  return [
    `<td class="pad" style="padding:20px 28px 28px;border-top:1px solid ${BORDER};">`,
    `<p style="margin:0 0 6px;font-size:12px;line-height:20px;color:${MUTED};">${links.join(' &nbsp;&middot;&nbsp; ')}</p>`,
    `<p style="margin:0;font-size:12px;line-height:20px;color:${MUTED};">${escapeHtml(APP_PRODUCT_NAME)}</p>`,
    '</td>',
  ].join('');
}

export function renderHtml(input: LayoutInput): string {
  const body = input.blocks.map(blockHtml).join('');

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(input.heading)}</title>
<style>
  @media only screen and (max-width:600px) {
    .shell { width:100% !important; }
    .pad { padding-left:20px !important; padding-right:20px !important; }
    .stat { display:block !important; width:100% !important; padding-right:0 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${CANVAS};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CANVAS};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="shell" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:${SURFACE};border-radius:12px;font-family:${FONT};">
<tr><td class="pad" style="padding:28px 28px 8px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="width:32px;height:32px;border-radius:8px;background:${BRAND_FILL};text-align:center;font-size:13px;font-weight:700;color:${BRAND_FILL_TEXT};font-family:${FONT};"><img src="${escapeHtml(logoUrl())}" width="32" height="32" alt="${escapeHtml(APP_LOGO_MARK)}" style="display:block;width:32px;height:32px;border:0;border-radius:8px;line-height:32px;text-align:center;font-size:13px;font-weight:700;color:${BRAND_FILL_TEXT};font-family:${FONT};"></td>
<td style="padding-left:10px;font-size:15px;font-weight:600;color:${INK};font-family:${FONT};">${escapeHtml(APP_PRODUCT_NAME)}</td>
</tr></table>
</td></tr>
<tr><td class="pad" style="padding:16px 28px 0;">
<h1 style="margin:0 0 16px;font-size:21px;line-height:28px;font-weight:700;color:${INK};">${escapeHtml(input.heading)}</h1>
${body}
</td></tr>
<tr>${footerHtml(input.footer)}</tr>
</table>
</td></tr></table>
</body></html>`;
}

function blockText(block: MailBlock): string {
  switch (block.type) {
    case 'paragraph':
      return block.text;
    case 'button':
      return `${block.label}:\n${block.url}`;
    case 'list':
      return block.entries
        .map((entry) =>
          [
            `- ${entry.title}`,
            entry.context ? `  ${entry.context}` : undefined,
            `  ${entry.detail}`,
          ]
            .filter((line): line is string => line !== undefined)
            .join('\n'),
        )
        .join('\n');
    case 'stats':
      return block.items
        .map((item) => `- ${item.label}: ${item.value}${item.hint ? ` (${item.hint})` : ''}`)
        .join('\n');
    case 'note':
      return block.text;
  }
}

export function renderText(input: LayoutInput): string {
  const lines = [
    APP_PRODUCT_NAME,
    '='.repeat(APP_PRODUCT_NAME.length),
    '',
    input.heading,
    ...input.blocks.map(blockText),
    '--',
    `Email preferences: ${input.footer.preferencesUrl}`,
  ];

  if (input.footer.unsubscribeUrl) {
    const what = input.footer.unsubscribeLabel ?? 'these emails';
    lines.push(`Unsubscribe from ${what}: ${input.footer.unsubscribeUrl}`);
  }

  return `${lines.join('\n\n')}\n`;
}
