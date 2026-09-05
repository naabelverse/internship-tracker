import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { Toaster } from 'react-hot-toast';
import { BrowserRouter } from 'react-router-dom';
import { App } from '@/App';
import { createQueryClient } from '@/api/queryClient';
import { ROUTER_FUTURE } from '@/routes/routerFuture';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { initSentry } from '@/lib/sentry';
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
          <BrowserRouter future={ROUTER_FUTURE}>
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
              success: { iconTheme: { primary: 'rgb(var(--color-success))', secondary: '#fff' } },
              error: { iconTheme: { primary: 'rgb(var(--color-danger))', secondary: '#fff' } },
            }}
          />
        </QueryClientProvider>
      </HelmetProvider>
    </ErrorBoundary>
  </StrictMode>,
);
