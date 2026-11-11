import { useRef, type FocusEvent } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import { DialogCloseButton } from '../../components/DialogCloseButton';

/**
 * Mock interview confirmations. The safe choice gets initial focus and is what
 * X and Escape do; the confirm action is outlined red when destructive.
 */
export function ConfirmDialog({
  open,
  title,
  text,
  safeLabel,
  confirmLabel,
  destructive,
  onSafe,
  onConfirm,
}: {
  open: boolean;
  title: string;
  text: string;
  safeLabel: string;
  confirmLabel: string;
  destructive: boolean;
  onSafe: () => void;
  onConfirm: () => void;
}) {
  const safe = useRef<HTMLButtonElement>(null);
  // Same handoff as UnsavedJobGuard: after the focus trap focuses the surface.
  const handleFocus = (event: FocusEvent<HTMLElement>) => {
    const button = safe.current;
    if (button && event.target !== button && event.target.contains(button))
      button.focus({ preventScroll: true });
  };
  return (
    <Dialog
      open={open}
      onClose={onSafe}
      onFocus={handleFocus}
      aria-labelledby="mock-confirm-title"
    >
      <DialogCloseButton onClick={onSafe} />
      <DialogTitle id="mock-confirm-title" sx={{ pr: 7 }}>
        {title}
      </DialogTitle>
      <DialogContent>
        <DialogContentText>{text}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button
          ref={safe}
          variant="outlined"
          onClick={onSafe}
          // Programmatic focus lands here, so :focus (not only focus-visible) shows the ring.
          sx={(theme) => ({
            '&:focus': {
              outline: `2px solid ${theme.palette.primary.main}`,
              outlineOffset: 2,
            },
          })}
        >
          {safeLabel}
        </Button>
        <Button
          variant={destructive ? 'outlined' : 'contained'}
          color={destructive ? 'error' : 'primary'}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
