export type WorkflowStepState = 'current' | 'completed' | 'upcoming';

export function workflowStepState(
  index: number,
  current: number,
  completed: boolean,
): WorkflowStepState {
  if (index === current) return 'current';
  return completed ? 'completed' : 'upcoming';
}

/** Shared label emphasis: the current step reads strongest. */
export const workflowStepperSx = {
  '& .MuiStepLabel-label': { color: 'text.secondary', fontWeight: 400 },
  '& .MuiStepLabel-label.Mui-active': {
    color: 'text.primary',
    fontWeight: 700,
  },
  '& .MuiStepLabel-label.Mui-completed:not(.Mui-active)': {
    color: 'text.primary',
  },
  // Keyboard focus rings the step label, not the whole (wide) step button, and
  // drops MUI's grey ripple highlight so only one focus indicator shows.
  '& .MuiStepButton-root .MuiTouchRipple-root': { display: 'none' },
  '& .MuiStepButton-root.Mui-focusVisible .MuiStepLabel-label': {
    outline: '2px solid',
    outlineColor: 'primary.main',
    outlineOffset: 2,
    borderRadius: 1,
  },
} as const;
