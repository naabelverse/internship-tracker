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
        'danger-fg': token('color-danger-fg'),
        info: token('color-info'),
        // Chart series and heatmap levels, so a chart colour is a token like
        // every other colour in the app rather than a literal in a JS object.
        'chart-1': token('color-chart-1'),
        'chart-2': token('color-chart-2'),
        'chart-3': token('color-chart-3'),
        'chart-4': token('color-chart-4'),
        'chart-5': token('color-chart-5'),
        'chart-6': token('color-chart-6'),
        'heat-0': token('color-heat-0'),
        'heat-1': token('color-heat-1'),
        'heat-2': token('color-heat-2'),
        'heat-3': token('color-heat-3'),
        'heat-4': token('color-heat-4'),
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
