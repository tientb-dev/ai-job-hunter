import { DeleteIcon } from './icons';
import { useId, useRef, type FocusEvent, type ReactNode } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';
import { DialogCloseButton } from './DialogCloseButton';

/**
 * Two-choice confirmation. The safe choice is emphasized (contained), gets
 * initial focus and is what X and Escape do. The confirm action is outlined;
 * when destructive it is neutral with a red hover/focus (theme, color="error").
 */
export function ConfirmDialog({
  open,
  title,
  text,
  safeLabel,
  confirmLabel,
  destructive = false,
  confirmIcon = destructive ? <DeleteIcon /> : undefined,
  onSafe,
  onConfirm,
  onExited,
}: {
  open: boolean;
  title: string;
  /** A string is set as dialog text; other content renders as given. */
  text: ReactNode;
  safeLabel: string;
  confirmLabel: string;
  destructive?: boolean;
  /** Leading icon for the confirm action; destructive confirms default to Delete. */
  confirmIcon?: ReactNode;
  onSafe: () => void;
  onConfirm: () => void;
  /** Runs after the close transition, e.g. to restore focus elsewhere. */
  onExited?: () => void;
}) {
  const titleId = useId();
  const safe = useRef<HTMLButtonElement>(null);
  // Let the modal's focus trap focus its surface first, then hand focus to the safe action.
  const handleFocus = (event: FocusEvent<HTMLElement>) => {
    const button = safe.current;
    if (
      open &&
      button &&
      event.target !== button &&
      event.target.contains(button)
    )
      button.focus({ preventScroll: true });
  };
  return (
    <Dialog
      open={open}
      onClose={onSafe}
      onFocus={handleFocus}
      aria-labelledby={titleId}
      slotProps={onExited ? { transition: { onExited } } : undefined}
    >
      <DialogCloseButton onClick={onSafe} />
      <DialogTitle id={titleId} sx={{ pr: 7 }}>
        {title}
      </DialogTitle>
      <DialogContent>
        {typeof text === 'string' ? (
          <DialogContentText>{text}</DialogContentText>
        ) : (
          text
        )}
      </DialogContent>
      <DialogActions>
        <Button
          ref={safe}
          variant="contained"
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
          variant="outlined"
          color={destructive ? 'error' : 'primary'}
          startIcon={confirmIcon}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
