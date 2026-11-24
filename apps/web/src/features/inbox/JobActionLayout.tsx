import { tr } from '../../app/i18n';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Box } from '@mui/material';

// Two non-overlapping grid rows: fields scroll, actions retain their natural
// height (including wrapping and safe-area padding). The bounded shell owns
// height, including its padding; this layout never computes a viewport height.
export function JobActionLayout({
  active,
  children,
  actions,
  scrollable = active,
  scrollKey,
  feedbackKey,
  sticky = false,
}: {
  active: boolean;
  /** Keep the actions pinned to the bottom of the viewport while the page scrolls. */
  sticky?: boolean;
  scrollable?: boolean;
  scrollKey?: string;
  feedbackKey?: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  const fields = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (fields.current) fields.current.scrollTop = 0;
  }, [scrollKey]);
  useLayoutEffect(() => {
    if (scrollable && feedbackKey && fields.current)
      fields.current.scrollTop = 0;
  }, [scrollable, feedbackKey]);
  return (
    <Box
      sx={{
        minWidth: 0,
        ...(scrollable && {
          display: 'grid',
          gridTemplateRows: 'minmax(0, 1fr) auto',
          flex: 1,
          minHeight: 0,
        }),
      }}
    >
      <Box
        ref={fields}
        role={scrollable ? 'region' : undefined}
        aria-label={scrollable ? tr('Scrollable job fields') : undefined}
        tabIndex={scrollable ? 0 : undefined}
        sx={{
          minWidth: 0,
          minHeight: 0,
          ...(scrollable && {
            overflowY: 'auto',
            overflowX: 'hidden',
            overscrollBehaviorY: 'contain',
            pr: 1,
            pb: 2,
          }),
        }}
      >
        {children}
      </Box>
      <Box
        role={active ? 'region' : undefined}
        aria-label={active ? tr('Job save actions') : undefined}
        sx={
          active
            ? {
                bgcolor: 'background.paper',
                borderTop: 1,
                borderColor: 'divider',
                pt: 1.5,
                pb: 'max(12px, env(safe-area-inset-bottom, 0px))',
                minWidth: 0,
                // Sticky stays in flow, so it never covers the last content.
                ...(sticky && { position: 'sticky', bottom: 0, zIndex: 2 }),
              }
            : undefined
        }
      >
        {actions}
      </Box>
    </Box>
  );
}
