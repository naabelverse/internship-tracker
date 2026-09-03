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
    rollupOptions: {
      output: {
        // Dependencies change far less often than application code, so splitting
        // them out keeps a deploy from invalidating the whole bundle. The
        // markdown pair and dnd-kit are separated again because only the detail
        // view and the board need them, so neither loads on the dashboard's path.
        // Route-level lazy loading and the formal size budget are Phase 15.
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'query-vendor': ['@tanstack/react-query', 'axios'],
          markdown: ['marked', 'dompurify'],
          dnd: ['@dnd-kit/core', '@dnd-kit/utilities'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    css: false,
  },
});
