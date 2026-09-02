import { useCallback, useEffect, useState } from 'react';
import { clientEnv } from '@/lib/env';

type ConnectionState = 'checking' | 'online' | 'offline';

interface HealthData {
  service: string;
  version: string;
  environment: string;
  database: { state: string; connected: boolean };
}

interface HealthEnvelope {
  success: boolean;
  data: HealthData;
}

const STATUS_LABEL: Record<ConnectionState, string> = {
  checking: 'Checking API',
  online: 'API reachable',
  offline: 'API unreachable',
};

/**
 * Boot screen for the scaffold: it proves the client can reach the API and shows
 * what the API reports about itself. Replaced by the application shell in Phase 5.
 */
export function App(): JSX.Element {
  const [state, setState] = useState<ConnectionState>('checking');
  const [health, setHealth] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkHealth = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setState('checking');
    setError(null);

    try {
      const response = await fetch(`${clientEnv.apiUrl}/health`, { signal });
      if (!response.ok) {
        throw new Error(`API responded with ${String(response.status)}`);
      }

      const body = (await response.json()) as HealthEnvelope;
      setHealth(body.data);
      setState('online');
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setHealth(null);
      setError(cause instanceof Error ? cause.message : 'Unknown error');
      setState('offline');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void checkHealth(controller.signal);
    return () => {
      controller.abort();
    };
  }, [checkHealth]);

  return (
    <main className="panel">
      <h1>Internship Tracker</h1>
      <p>{clientEnv.apiUrl}</p>

      <div className="status">
        <span className="dot" data-state={state} aria-hidden="true" />
        <span role="status">{STATUS_LABEL[state]}</span>
      </div>

      {health !== null && (
        <dl className="detail">
          <dt>Service</dt>
          <dd>{health.service}</dd>
          <dt>Version</dt>
          <dd>{health.version}</dd>
          <dt>Environment</dt>
          <dd>{health.environment}</dd>
          <dt>Database</dt>
          <dd>{health.database.state}</dd>
        </dl>
      )}

      {error !== null && (
        <dl className="detail">
          <dt>Reason</dt>
          <dd>{error}</dd>
        </dl>
      )}

      <button type="button" onClick={() => void checkHealth()} disabled={state === 'checking'}>
        {state === 'checking' ? 'Checking' : 'Check again'}
      </button>
    </main>
  );
}
