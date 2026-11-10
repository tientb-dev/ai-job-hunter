import { IconButton, SvgIcon } from '@mui/material';

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
      <SvgIcon aria-hidden="true" fontSize="small">
        <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
      </SvgIcon>
    </IconButton>
  );
}
