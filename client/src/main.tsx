import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { Toaster } from 'react-hot-toast';
import { BrowserRouter } from 'react-router-dom';
import { App } from '@/App';
import { createQueryClient } from '@/api/queryClient';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { initSentry } from '@/lib/sentry';
// Self-hosted so the app owns its typography rather than depending on a
// third-party font host. The `wdth` build carries the weight *and* width
// axes in one file, which is what lets headings be set wide without a
// second family or a second request.
import '@fontsource-variable/archivo/wdth.css';
import '@/index.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element #root is missing from index.html');
}

// Not awaited: the SDK is optional and lazily imported, so blocking the first
// paint on it would make monitoring cost the thing it is monitoring. Errors
// thrown before it resolves are the ones a boundary reports anyway.
void initSentry();

const queryClient = createQueryClient();

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <HelmetProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
          <Toaster
            position="bottom-right"
            toastOptions={{
              // Tokens rather than literals, so toasts follow the theme toggle.
              style: {
                background: 'rgb(var(--color-surface))',
                color: 'rgb(var(--color-text))',
                border: '1px solid rgb(var(--color-border))',
              },
              /*
                `secondary` is the glyph punched out of the icon disc, so it has
                to contrast with `primary` in both themes. It was `#fff`, which
                only works in one: the dark theme's success and danger are a
                light green and a light red, and a white tick on either is close
                to unreadable. The surface token is the card the disc sits on, so
                the glyph reads as a hole through it and follows the theme.
              */
              success: {
                iconTheme: {
                  primary: 'rgb(var(--color-success))',
                  secondary: 'rgb(var(--color-surface))',
                },
              },
              error: {
                iconTheme: {
                  primary: 'rgb(var(--color-danger))',
                  secondary: 'rgb(var(--color-surface))',
                },
              },
            }}
          />
        </QueryClientProvider>
      </HelmetProvider>
    </ErrorBoundary>
  </StrictMode>,
);
