import { useContext, useRef, type FocusEvent, type RefObject } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from '@mui/material';
import {
  UNSAFE_DataRouterContext,
  useBeforeUnload,
  useBlocker,
} from 'react-router-dom';

export function UnsavedJobGuard({
  dirty,
  savedNavigation,
  sourceCvDirty = false,
  allowPath,
}: {
  dirty: boolean;
  sourceCvDirty?: boolean;
  savedNavigation: RefObject<boolean>;
  /** Destinations that keep the edited state mounted, so need no prompt. */
  allowPath?: (pathname: string) => boolean;
}) {
  useBeforeUnload((event) => {
    if (sourceCvDirty || (dirty && !savedNavigation.current)) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  // Production uses a data router; embedded previews may use MemoryRouter.
  const router = useContext(UNSAFE_DataRouterContext);
  return router ? (
    <RouteGuard
      dirty={dirty}
      sourceCvDirty={sourceCvDirty}
      savedNavigation={savedNavigation}
      allowPath={allowPath}
    />
  ) : null;
}
function RouteGuard({
  dirty,
  savedNavigation,
  sourceCvDirty,
  allowPath,
}: {
  dirty: boolean;
  sourceCvDirty: boolean;
  savedNavigation: RefObject<boolean>;
  allowPath?: (pathname: string) => boolean;
}) {
  const blocker = useBlocker(
    ({ nextLocation }) =>
      !allowPath?.(nextLocation.pathname) &&
      (sourceCvDirty || (dirty && !savedNavigation.current)),
  );
  const stay = useRef<HTMLButtonElement>(null);
  function handleDialogFocus(event: FocusEvent<HTMLElement>) {
    const button = stay.current;
    // Let Modal/FocusTrap establish and record initial surface focus first.
    // Then hand that focus to Stay. Descendant actions never trigger this handoff.
    if (
      blocker.state === 'blocked' &&
      button &&
      event.target !== button &&
      event.target.contains(button)
    ) {
      button.focus({ preventScroll: true });
    }
  }
  return (
    <Dialog
      open={blocker.state === 'blocked'}
      aria-labelledby="unsaved-job-title"
      onFocus={handleDialogFocus}
    >
      <DialogTitle id="unsaved-job-title">Leave unsaved changes?</DialogTitle>
      <DialogContent>
        <Alert severity="warning">
          {sourceCvDirty
            ? 'Your CV review changes have not been saved. Stay to review and save them, or discard them and leave.'
            : 'Your job changes have not been saved. Stay to review and save them, or discard them and leave.'}
        </Alert>
      </DialogContent>
      <DialogActions>
        <Button
          ref={stay}
          variant="contained"
          // Programmatic focus lands here, so :focus (not only focus-visible) shows the ring.
          sx={(theme) => ({
            '&:focus': {
              outline: `2px solid ${theme.palette.primary.main}`,
              outlineOffset: 2,
            },
          })}
          onClick={() => blocker.state === 'blocked' && blocker.reset()}
        >
          Stay and edit
        </Button>
        <Button
          variant="outlined"
          sx={{
            '&:hover': {
              color: 'error.main',
              borderColor: 'error.main',
              bgcolor: 'transparent',
            },
          }}
          onClick={() => blocker.state === 'blocked' && blocker.proceed()}
        >
          Discard and leave
        </Button>
      </DialogActions>
    </Dialog>
  );
}
