import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // `host: true` binds 0.0.0.0 so the dev server is reachable from the container.
    host: true,
    port: 5173,
    strictPort: true,
  },
  preview: { host: true, port: 4173, strictPort: true },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Emitted so `scripts/checkBundle.mjs` can walk the real static-import graph
    // rather than guess at it from file names. SPEC section 12's landing-route
    // budget is only checkable against the actual closure.
    manifest: true,
    rollupOptions: {
      output: {
        // Dependencies change far less often than application code, so splitting
        // them out keeps a deploy from invalidating the whole bundle. The
        // markdown pair and dnd-kit are separated again because only the detail
        // view and the board need them, so neither loads on the dashboard's path.
        // The formal budget check across every route is Phase 15.
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'query-vendor': ['@tanstack/react-query', 'axios'],
          markdown: ['marked', 'dompurify'],
          // Chart.js is the heaviest dependency here. Splitting it out keeps it
          // in a chunk the dashboard's lazy route pulls in on demand, so no
          // other route pays for it. Only the registered components ship, since
          // nothing imports `chart.js/auto`.
          'chart-vendor': ['chart.js', 'react-chartjs-2'],
          dnd: ['@dnd-kit/core', '@dnd-kit/utilities'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    // Comfortably above `asyncUtilTimeout` in tests/setup.ts. Lazy routes make a
    // first mount slower under Vite's on-demand transform, and if the two are
    // equal a slow chunk reports "test timed out" instead of the assertion that
    // really failed.
    testTimeout: 20_000,
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    css: false,
  },
});
