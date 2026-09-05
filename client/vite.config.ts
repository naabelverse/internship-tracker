import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { buildAllowedHosts } from './allowedHosts';

/*
  Vite refuses a request whose `Host` header it does not recognise, and a
  deployment behind a platform-assigned domain is exactly the case that trips it.
  The list is derived from the environment rather than written here, so no single
  domain is baked into source: see `allowedHosts.ts`.

  `preview.allowedHosts` falls back to `server.allowedHosts` when it is unset, but
  both are set explicitly — the fallback is an implementation detail, and a
  production server should not depend on one.
*/
const allowedHosts = buildAllowedHosts(process.env);

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
    allowedHosts,
  },
  preview: {
    host: true,
    // A platform tells the container which port to listen on; locally there is no
    // PORT and 4173 is Vite's own default.
    port: Number(process.env.PORT) || 4173,
    strictPort: true,
    allowedHosts,
  },
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
    /*
      Half the cores, not all of them.

      Every test file mounts its own jsdom and transforms the route modules it
      touches, and with all sixteen routes lazy the first assertion in a file
      absorbs its chunk's first transform: measured at 3.4-4.4 s, against every
      later test in the same file at around 0.7 s. Left uncapped, the suite
      oversubscribes the machine and inflates that first figure until it crosses
      the 10 s `asyncUtilTimeout` in tests/setup.ts, which is what four of these
      files did when they ran alongside a busy machine.

      Capping halves the work without costing wall time — measured on a 12-core
      box, 44.5 s uncapped against 44.9 s capped, with collection dropping from
      105 s of CPU to 48 s. The suite is bound by contention, not by parallelism,
      and a two-core CI runner is the case that needs this most.
    */
    maxWorkers: '50%',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    css: false,
  },
});
