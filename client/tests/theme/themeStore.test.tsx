import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, resetClientState } from '../utils/render';
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_STORAGE_KEY,
  readStoredPreference,
  resolveTheme,
  useThemeStore,
} from '@/store/themeStore';

function stubMatchMedia(prefersLight: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('prefers-color-scheme: light') ? prefersLight : !prefersLight,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  useThemeStore.setState({ preference: 'dark', resolved: 'dark' });
  document.documentElement.setAttribute('data-theme', 'dark');
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetClientState();
});

describe('theme preference reading', () => {
  it('defaults to dark, matching the inline boot script', () => {
    expect(readStoredPreference()).toBe(DEFAULT_THEME_PREFERENCE);
    expect(DEFAULT_THEME_PREFERENCE).toBe('dark');
  });

  it('reads a stored preference back', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');

    expect(readStoredPreference()).toBe('light');
  });

  it('rejects a stored value that is not a preference', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'neon');

    expect(readStoredPreference()).toBe('dark');
  });
});

describe('theme resolution', () => {
  it('passes an explicit choice straight through', () => {
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('asks the operating system for the system preference', () => {
    stubMatchMedia(true);
    expect(resolveTheme('system')).toBe('light');

    stubMatchMedia(false);
    expect(resolveTheme('system')).toBe('dark');
  });
});

describe('ThemeToggle', () => {
  it('applies and persists the chosen theme', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ThemeToggle />);

    await user.click(screen.getByRole('radio', { name: 'Light theme' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(screen.getByRole('radio', { name: 'Light theme' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('stores the system choice rather than the theme it currently resolves to', async () => {
    stubMatchMedia(true);
    const user = userEvent.setup();
    renderWithProviders(<ThemeToggle />);

    await user.click(screen.getByRole('radio', { name: 'Match system theme' }));

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('exposes the three preferences as a radio group', () => {
    renderWithProviders(<ThemeToggle />);

    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  // The APG radio group pattern: the group is one Tab stop, sitting on the
  // checked option, and the arrow keys move both focus and the selection. Three
  // separate Tab stops would make the header cost three presses to cross, and
  // a screen reader announcing "radio" promises arrow-key behaviour it would
  // then fail to deliver.
  it('is a single Tab stop, on the checked option', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <button type="button">before</button>
        <ThemeToggle />
        <button type="button">after</button>
      </>,
    );

    screen.getByRole('button', { name: 'before' }).focus();
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Dark theme' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus();
  });

  it('moves the selection with the arrow keys, wrapping at both ends', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ThemeToggle />);

    screen.getByRole('radio', { name: 'Dark theme' }).focus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Match system theme' })).toHaveFocus();
    expect(screen.getByRole('radio', { name: 'Match system theme' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Light theme' })).toHaveFocus();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Match system theme' })).toHaveFocus();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');

    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('radio', { name: 'Dark theme' })).toHaveFocus();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });
});
