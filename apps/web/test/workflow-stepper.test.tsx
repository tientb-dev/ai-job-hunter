import { ThemeProvider } from '@mui/material';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from './render';
import { theme } from '../src/app/theme';
import { WorkflowStepIcon } from '../src/components/WorkflowStepIcon';
import { workflowStepState } from '../src/components/workflow-step';
import { JobEditor } from '../src/features/inbox/JobEditor';

const icon = (step: HTMLElement) =>
  step.querySelector<HTMLElement>('[data-step-state]')!;

test('current always shows its number; checkmarks only for completed non-current steps', () => {
  expect(workflowStepState(0, 0, true)).toBe('current');
  expect(workflowStepState(0, 1, true)).toBe('completed');
  expect(workflowStepState(2, 1, false)).toBe('upcoming');
  const { container } = render(
    <ThemeProvider theme={theme}>
      <WorkflowStepIcon number={1} state="current" />
      <WorkflowStepIcon number={2} state="completed" />
      <WorkflowStepIcon number={3} state="upcoming" />
    </ThemeProvider>,
  );
  const [current, completed, upcoming] = Array.from(
    container.querySelectorAll<HTMLElement>('[data-step-state]'),
  ) as [HTMLElement, HTMLElement, HTMLElement];
  expect(current).toHaveTextContent('1');
  expect(current.querySelector('svg')).toBeNull();
  expect(completed.querySelector('svg')).not.toBeNull();
  expect(completed).not.toHaveTextContent('2');
  expect(upcoming).toHaveTextContent('3');
  expect(upcoming.querySelector('svg')).toBeNull();
});

test('Add Job marks current, completed and upcoming steps', () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(null)),
  );
  render(
    <ThemeProvider theme={theme}>
      <RouterProvider
        router={createMemoryRouter(
          [{ path: '/jobs/new', element: <JobEditor /> }],
          {
            initialEntries: ['/jobs/new'],
          },
        )}
      />
    </ThemeProvider>,
  );
  const steps = () =>
    within(screen.getByLabelText('Add job steps'))
      .getAllByText(/^(Import sources|Review & Save)$/)
      .map((label) => label.closest<HTMLElement>('.MuiStep-root')!) as [
      HTMLElement,
      HTMLElement,
    ];
  let [importStep, reviewStep] = steps();
  expect(importStep).toHaveAttribute('aria-current', 'step');
  expect(icon(importStep)).toHaveAttribute('data-step-state', 'current');
  expect(within(importStep).getByText('Current')).toBeVisible();
  expect(icon(reviewStep)).toHaveAttribute('data-step-state', 'upcoming');
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue to Review & Save' }),
  );
  [importStep, reviewStep] = steps();
  expect(icon(importStep)).toHaveAttribute('data-step-state', 'completed');
  expect(within(importStep).getByText('Complete')).toBeVisible();
  expect(reviewStep).toHaveAttribute('aria-current', 'step');
  expect(icon(reviewStep)).toHaveAttribute('data-step-state', 'current');
  expect(icon(reviewStep)).toHaveTextContent('2');
});
