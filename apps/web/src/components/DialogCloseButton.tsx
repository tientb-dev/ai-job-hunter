import { IconButton } from '@mui/material';
import { CloseIcon } from './icons';

// Top-right X for dismissible dialogs; callers pass the same safe handler as Escape/Cancel.
export function DialogCloseButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <IconButton
      aria-label="Close dialog"
      onClick={onClick}
      disabled={disabled}
      sx={{ position: 'absolute', top: 8, right: 8, width: 44, height: 44 }}
    >
      <CloseIcon fontSize="small" />
    </IconButton>
  );
}
