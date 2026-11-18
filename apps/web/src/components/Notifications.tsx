import {
  Notifications,
  SUCCESS_NOTIFICATION_MS,
  type Notification,
} from './useNotify';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Fade,
  Typography,
} from '@mui/material';
import { tr } from '../app/i18n';
import { CheckCircleOutlineIcon, ErrorOutlineIcon } from './icons';

const persistent = (n?: Notification) =>
  n?.severity === 'error' || n?.severity === 'warning';

export function NotificationProvider({ children }: { children: ReactNode }) {
  const sequence = useRef(0);
  const [queue, setQueue] = useState<(Notification & { id: number })[]>([]);
  const notify = useCallback((message: Notification) => {
    const entry = { ...message, id: ++sequence.current };
    // The latest completion wins: older success/info popups would only report
    // stale state late. Errors and warnings stay queued until acknowledged.
    setQueue((current) =>
      persistent(message)
        ? [...current, entry]
        : [...current.filter((item) => persistent(item)), entry],
    );
  }, []);
  const current = queue[0];
  const dismiss = useCallback(
    (id?: number) =>
      setQueue((items) => items.filter((item) => item.id !== id)),
    [],
  );
  const failure = persistent(current) ? current : undefined;
  const done = current && !failure ? current : undefined;
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(
      () => dismiss(done.id),
      done.severity === 'success' ? SUCCESS_NOTIFICATION_MS : 6000,
    );
    return () => clearTimeout(timer);
  }, [done, dismiss]);
  // Keep the last content while the dialog fades out.
  // A failure often follows a confirmation dialog whose button is gone by
  // the time ours closes, so restore focus to the last page control instead.
  const pageFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const track = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest?.('.MuiDialog-root')) pageFocus.current = target;
    };
    document.addEventListener('focusin', track);
    return () => document.removeEventListener('focusin', track);
  }, []);
  // After unmount (next frame), unless another dialog has taken over.
  const restoreFocus = () =>
    requestAnimationFrame(() => {
      const target = pageFocus.current;
      if (target?.isConnected && !document.querySelector('.MuiDialog-root'))
        target.focus();
    });
  const [last, setLast] = useState(current);
  if (current && current !== last) setLast(current);
  const titleOf = (n: Notification) =>
    n.title ??
    (n.severity === 'error'
      ? tr('Action failed')
      : n.severity === 'warning'
        ? tr('Please note')
        : n.text);
  return (
    <Notifications.Provider value={notify}>
      {children}
      <Dialog
        open={Boolean(failure)}
        onClose={() => dismiss(failure?.id)}
        fullWidth
        aria-labelledby="notification-failure-title"
        aria-describedby="notification-failure-text"
        disableRestoreFocus
        slots={{ transition: Fade }}
        slotProps={{
          transition: { onExited: restoreFocus },
          paper: { role: 'alertdialog', sx: { maxWidth: 400 } },
        }}
      >
        {last && persistent(last) && (
          <>
            <DialogTitle
              id="notification-failure-title"
              sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}
            >
              <ErrorOutlineIcon
                color={last.severity === 'error' ? 'error' : 'warning'}
              />
              {titleOf(last)}
            </DialogTitle>
            <DialogContent>
              <DialogContentText
                id="notification-failure-text"
                sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}
              >
                {last.text}
              </DialogContentText>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
              {last.onRetry && (
                <Button
                  variant="outlined"
                  onClick={() => {
                    const retry = last.onRetry;
                    dismiss(last.id);
                    retry?.();
                  }}
                >
                  {tr('Retry')}
                </Button>
              )}
              <Button
                variant="contained"
                onClick={() => dismiss(last.id)}
                autoFocus
              >
                {tr('OK')}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
      <Dialog
        open={Boolean(done)}
        onClose={() => dismiss(done?.id)}
        fullWidth
        aria-labelledby="notification-success-title"
        disableRestoreFocus
        slots={{ transition: Fade }}
        slotProps={{
          transition: { onExited: restoreFocus },
          paper: {
            role: 'status',
            'aria-live': 'polite',
            sx: { maxWidth: 420 },
          },
        }}
      >
        {last && !persistent(last) && (
          <Box sx={{ px: 3, py: 3.5, textAlign: 'center' }}>
            <CheckCircleOutlineIcon
              color={last.severity === 'success' ? 'success' : 'info'}
              sx={{ fontSize: 48, mb: 1.5 }}
            />
            <Typography
              id="notification-success-title"
              variant="h6"
              component="h2"
              sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}
            >
              {titleOf(last)}
            </Typography>
            {last.title && (
              <Typography
                variant="body2"
                color="text.secondary"
                // A "\n" separates the primary sentence from a secondary line.
                sx={{ mt: 1, overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}
              >
                {last.text}
              </Typography>
            )}
          </Box>
        )}
      </Dialog>
    </Notifications.Provider>
  );
}
