import { RefreshIcon } from '../../components/icons';
import { useEffect, useState } from 'react';
import { Button, Chip, Stack } from '@mui/material';

type Status = 'loading' | 'ready' | 'unavailable';

export function ApiReadiness() {
  const [status, setStatus] = useState<Status>('loading');
  const [attempt, setAttempt] = useState(0);
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
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
      useFlexGap
    >
      <span role="status" aria-live="polite">
        <Chip
          variant={status === 'unavailable' ? 'filled' : 'outlined'}
          size="small"
          sx={{ border: 0, fontWeight: 500, '& .MuiChip-label': { px: 0.5 } }}
          color={
            status === 'ready'
              ? 'success'
              : status === 'unavailable'
                ? 'warning'
                : 'default'
          }
          label={
            status === 'ready'
              ? 'API ready'
              : status === 'unavailable'
                ? 'API unavailable'
                : 'Checking API…'
          }
        />
      </span>
      <Button
        startIcon={<RefreshIcon />}
        variant="text"
        size="small"
        sx={{ minHeight: { xs: 44, md: 32 } }}
        disabled={status === 'loading'}
        onClick={() => {
          setStatus('loading');
          setAttempt((value) => value + 1);
        }}
      >
        Check again
      </Button>
    </Stack>
  );
}
