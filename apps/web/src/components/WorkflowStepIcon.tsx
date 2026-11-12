import { Box } from '@mui/material';

import { CheckIcon } from './icons';
import type { WorkflowStepState } from './workflow-step';

/**
 * One visual language for workflow steppers. The current step always shows its
 * number with a ring, even when its work is done; checkmarks are only for
 * completed steps that are not current.
 */
export function WorkflowStepIcon({
  number,
  state,
}: {
  number: number;
  state: WorkflowStepState;
}) {
  return (
    <Box
      data-step-state={state}
      aria-hidden="true"
      sx={(theme) => ({
        width: 28,
        height: 28,
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '0.8125rem',
        fontWeight: 600,
        flexShrink: 0,
        ...(state === 'current' && {
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          boxShadow: `0 0 0 3px ${theme.palette.background.paper}, 0 0 0 5px ${theme.palette.primary.main}`,
        }),
        ...(state === 'completed' && {
          bgcolor: 'success.main',
          color: 'success.contrastText',
        }),
        ...(state === 'upcoming' && {
          border: 2,
          borderColor: 'action.disabled',
          color: 'text.secondary',
          bgcolor: 'background.paper',
        }),
      })}
    >
      {state === 'completed' ? <CheckIcon sx={{ fontSize: 18 }} /> : number}
    </Box>
  );
}
