import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useContext, useEffect, useRef, type RefObject } from 'react';
import { Alert } from '@mui/material';
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
  // Last edited control outside dialogs; Stay returns focus there instead of the nav link.
  const lastField = useRef<HTMLElement | null>(null);
  const stayed = useRef(false);
  useEffect(() => {
    const track = (event: Event) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.matches('input, textarea, select, [contenteditable="true"]') &&
        !target.closest('[role="dialog"]')
      )
        lastField.current = target;
    };
    document.addEventListener('focusin', track);
    return () => document.removeEventListener('focusin', track);
  }, []);
  const stayHere = () => {
    if (blocker.state !== 'blocked') return;
    stayed.current = true;
    blocker.reset();
  };
  // Runs after MUI's own restore to the trigger, which stays the fallback.
  const restoreField = () => {
    const field = lastField.current;
    if (
      stayed.current &&
      field?.isConnected &&
      !field.matches(':disabled') &&
      field.getClientRects().length > 0
    )
      field.focus();
    stayed.current = false;
  };
  return (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      title="Leave unsaved changes?"
      text={
        <Alert severity="warning">
          {sourceCvDirty
            ? 'Your CV review changes have not been saved. Stay to review and save them, or discard them and leave.'
            : 'Your job changes have not been saved. Stay to review and save them, or discard them and leave.'}
        </Alert>
      }
      safeLabel="Stay and edit"
      confirmLabel="Discard and leave"
      destructive
      // Escape and X behave like Stay and edit: navigation stays blocked, nothing is discarded.
      onSafe={stayHere}
      onConfirm={() => blocker.state === 'blocked' && blocker.proceed()}
      onExited={restoreField}
    />
  );
}
