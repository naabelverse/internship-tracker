import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Repo-wide rules. These encode the hard rules in CLAUDE.md so a violation
    // fails `npm run verify` rather than surviving to review.
    rules: {
      'no-console': 'error',
      'no-debugger': 'error',
      'no-alert': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
      'object-shorthand': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['server/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
  },
  {
    // The rules-of-hooks and exhaustive-deps checks matter most in the axios and
    // session hooks, where a missing dependency is a stale-closure bug rather
    // than a style problem.
    files: ['client/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    files: ['**/*.config.{ts,mts,js,mjs}', '**/jest.config.ts', '**/vite.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Build-time scripts: Node programs that are meant to print. They generate
    // the brand assets, capture the landing screenshot and enforce the bundle
    // budget, and their output is the whole point — `no-console` would be
    // telling a CLI not to say anything.
    files: ['client/scripts/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
  {
    // The Playwright suite. Node globals, and `console` is allowed for the same
    // reason it is in the build scripts: SPEC section 10 asks for the axe report
    // to be printed, and the responsive audit's overflow report is the record
    // that isolated the board's horizontal-scroll bug. Silencing them would
    // leave a pass/fail with nothing behind it.
    files: ['e2e/**/*.ts', 'playwright.config.ts'],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    rules: { 'no-console': 'off' },
  },
  {
    files: ['server/tests/**/*.ts', 'client/tests/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
  },
  prettier,
);
