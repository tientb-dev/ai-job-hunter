import { Notifications, type Notification } from './useNotify';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Alert, Portal, Snackbar } from '@mui/material';

export function NotificationProvider({ children }: { children: ReactNode }) {
  const sequence = useRef(0);
  const [queue, setQueue] = useState<(Notification & { id: number })[]>([]);
  const notify = useCallback((message: Notification) => {
    const entry = { ...message, id: ++sequence.current };
    // The latest completion wins: older success/info toasts would only report
    // stale state late. Errors and warnings stay queued until dismissed.
    setQueue((current) =>
      message.severity === 'success' || message.severity === 'info'
        ? [
            ...current.filter(
              (item) =>
                item.severity === 'error' || item.severity === 'warning',
            ),
            entry,
          ]
        : [...current, entry],
    );
  }, []);
  const current = queue[0];
  return (
    <Notifications.Provider value={notify}>
      {children}
      <Portal>
        <Snackbar
          key={current?.id ?? 'empty'}
          open={Boolean(current)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          autoHideDuration={
            current?.severity === 'error' || current?.severity === 'warning'
              ? null
              : current?.severity === 'success'
                ? 3000
                : 6000
          }
          onClose={(_, reason) => {
            if (reason !== 'clickaway')
              setQueue((items) =>
                items.filter((item) => item.id !== current?.id),
              );
          }}
          sx={{
            bottom: { xs: 'max(16px, env(safe-area-inset-bottom))', sm: 24 },
            left: { xs: 16, sm: 'auto' },
            right: { xs: 16, sm: 24 },
            maxWidth: { sm: 'min(32rem, calc(100vw - 48px))' },
          }}
        >
          <Alert
            severity={current?.severity ?? 'info'}
            role={
              current?.severity === 'error' || current?.severity === 'warning'
                ? 'alert'
                : 'status'
            }
            aria-live={
              current?.severity === 'error' || current?.severity === 'warning'
                ? 'assertive'
                : 'polite'
            }
            aria-atomic="true"
            onClose={() =>
              setQueue((items) =>
                items.filter((item) => item.id !== current?.id),
              )
            }
            sx={{
              width: '100%',
              overflowWrap: 'anywhere',
              maxHeight: 'calc(100dvh - 32px)',
              overflowY: 'auto',
            }}
          >
            {current?.text}
          </Alert>
        </Snackbar>
      </Portal>
    </Notifications.Provider>
  );
}
