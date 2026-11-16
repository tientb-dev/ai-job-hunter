import { RefreshIcon } from '../../components/icons';
import { useEffect, useState } from 'react';
import { Alert, Button } from '@mui/material';
import { useI18n } from '../../app/i18n';

type Status = 'loading' | 'ready' | 'unavailable';

export function ApiReadiness() {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>('loading');
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    let stopped = false;
    let controller: AbortController;
    let poll: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    async function check() {
      controller = new AbortController();
      deadline = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch('/api/v1/health/ready', {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Service unavailable');
        const body: unknown = await response.json();
        if (
          typeof body !== 'object' ||
          body === null ||
          !('status' in body) ||
          body.status !== 'ok'
        ) {
          throw new Error('Unexpected readiness response');
        }
        if (!stopped) setStatus('ready');
      } catch {
        if (!stopped) setStatus('unavailable');
      } finally {
        clearTimeout(deadline);
        if (!stopped) setRetrying(false);
        if (!stopped)
          poll = setTimeout(() => {
            void check();
          }, 30000);
      }
    }
    void check();
    return () => {
      stopped = true;
      controller?.abort();
      clearTimeout(deadline);
      clearTimeout(poll);
    };
  }, [attempt]);
  // Silent while the server answers; only an unreachable server is reported.
  return (
    <div role="status" aria-live="polite" style={{ flexShrink: 0 }}>
      {status === 'unavailable' && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <Button
              color="inherit"
              size="small"
              startIcon={<RefreshIcon />}
              disabled={retrying}
              onClick={() => {
                setRetrying(true);
                setAttempt((value) => value + 1);
              }}
            >
              {t('api.retry')}
            </Button>
          }
        >
          {t('api.unreachable')}
        </Alert>
      )}
    </div>
  );
}
