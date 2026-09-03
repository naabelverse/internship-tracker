import type { Config } from 'tailwindcss';

/**
 * Every colour is a CSS custom property holding space-separated RGB channels, so
 * the same token works three ways: as a Tailwind utility (`bg-surface`), with an
 * opacity modifier (`bg-surface/60`), and as a raw value Chart.js can read at
 * runtime via `getComputedStyle(document.documentElement)` in Phase 8. The values
 * themselves live in `src/index.css`, swapped by the `data-theme` attribute.
 */
function token(name: string): string {
  return `rgb(var(--${name}) / <alpha-value>)`;
}

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // `dark:` keys off the same attribute the inline boot script sets, so there is
  // one source of truth for the active theme rather than a class and an attribute.
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: token('color-canvas'),
        surface: token('color-surface'),
        'surface-muted': token('color-surface-muted'),
        border: token('color-border'),
        'border-strong': token('color-border-strong'),
        content: token('color-text'),
        'content-muted': token('color-text-muted'),
        'content-subtle': token('color-text-subtle'),
        primary: token('color-primary'),
        'primary-hover': token('color-primary-hover'),
        'primary-fg': token('color-primary-fg'),
        success: token('color-success'),
        warning: token('color-warning'),
        danger: token('color-danger'),
        info: token('color-info'),
      },
      borderRadius: {
        card: '0.75rem',
        control: '0.5rem',
      },
      fontFamily: {
        sans: ['InterVariable', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(var(--color-shadow) / 0.06), 0 8px 24px -12px rgb(var(--color-shadow) / 0.28)',
      },
      ringColor: {
        DEFAULT: token('color-ring'),
      },
    },
  },
  plugins: [],
} satisfies Config;
