import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from './render';
import { ProposalComparison } from '../src/features/inbox/ProposalComparison';

test('diff preserves exact Unicode text and stays collapsed until requested', () => {
  const { container } = render(
    <ProposalComparison
      original="Hỗ trợ nhóm Java."
      suggestion="Hỗ trợ nhóm với Java."
      proposal="pending"
      manuallyEdited={false}
      where="Experience · Description"
      why="Names the team context."
      disabled={false}
      onDecision={vi.fn()}
    />,
  );
  expect(
    [...container.querySelectorAll('ins')].map((el) => el.textContent).join(''),
  ).toBe('với ');
  expect(container.querySelectorAll('del')).toHaveLength(0);
  expect(screen.getByText('Your original')).toBeVisible();
  expect(screen.getByText('Suggested')).toBeVisible();
  expect(screen.getByText('Names the team context.')).toBeVisible();
  expect(screen.getByText('AI suggestion')).not.toBeVisible();
  fireEvent.click(screen.getByText('Show evidence and word changes'));
  expect(screen.getByText('AI suggestion')).toBeVisible();
  expect(container.textContent).toContain('Hỗ trợ nhóm Java.');
  expect(container.textContent).toContain('Hỗ trợ nhóm với Java.');
});

test('decided card hides decision buttons until the user changes it', () => {
  const onDecision = vi.fn();
  const { container } = render(
    <ProposalComparison
      original="Led a Java project."
      suggestion="Assisted a Java project."
      proposal="rejected"
      manuallyEdited={false}
      where="Experience · Description"
      disabled={false}
      onDecision={onDecision}
    />,
  );
  expect(
    [...container.querySelectorAll('del')].map((el) => el.textContent).join(''),
  ).toBe('Led ');
  expect(screen.getByText('Original kept')).toBeVisible();
  expect(
    screen.queryByRole('button', {
      name: 'Accept suggestion for Experience · Description',
    }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Change decision for Experience · Description',
    }),
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Accept suggestion for Experience · Description',
    }),
  );
  expect(onDecision).toHaveBeenCalledWith('accept', undefined);
});

test('unverified rewrites show their reason before the decision', () => {
  render(
    <ProposalComparison
      original="Built APIs."
      suggestion="Built APIs serving 2M users."
      proposal="pending"
      manuallyEdited={false}
      where="Summary"
      needsCheck="2M users is not in your CV."
      disabled={false}
      onDecision={vi.fn()}
    />,
  );
  expect(screen.getByText('Needs your check')).toBeVisible();
  expect(screen.getByText('2M users is not in your CV.')).toBeVisible();
});

test('an accepted suggestion the user later edited reports the edited wording, which is what the CV uses', () => {
  render(
    <ProposalComparison
      original="Assisted a team prototype."
      suggestion="Assisted a 4-person team prototype."
      proposal="accepted"
      manuallyEdited
      where="Experience · Description"
      disabled={false}
      onDecision={vi.fn()}
    />,
  );
  expect(screen.getByText('Using your own edited wording.')).toBeVisible();
  expect(screen.getByText('Edited by you')).toBeVisible();
  expect(screen.queryByText(/Using the suggestion/)).toBeNull();
});

test('a suggestion needing confirmation: unticked by default, accept reports the confirmation, and a new suggestion text needs a new tick', () => {
  const onDecision = vi.fn();
  const props = {
    original: 'Assisted a team prototype.',
    proposal: 'pending' as const,
    manuallyEdited: false,
    where: 'Experience · Description',
    disabled: false,
    onDecision,
    requiresConfirmation: true,
    confirmationAssertion: 'Numbers not in your CV: 4',
  };
  const { rerender } = render(
    <ProposalComparison
      {...props}
      suggestion="Assisted a 4-person team prototype."
    />,
  );
  const accept = screen.getByRole('button', {
    name: 'Confirm and accept suggestion for Experience · Description',
  });
  const box = screen.getByRole('checkbox', {
    name: 'I confirm this information is true to my actual experience.',
  });
  expect(box).not.toBeChecked();
  expect(accept).toBeDisabled();
  fireEvent.click(box);
  expect(accept).toBeEnabled();
  rerender(
    <ProposalComparison
      {...props}
      suggestion="Assisted a 5-person team prototype."
    />,
  );
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(accept).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(accept);
  expect(onDecision).toHaveBeenCalledWith('accept', true);
  // Without a stated claim there is nothing to confirm: accept stays off.
  rerender(
    <ProposalComparison
      {...props}
      confirmationAssertion={undefined}
      suggestion="Assisted a 4-person team prototype."
    />,
  );
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(
    screen.getByRole('button', {
      name: 'Confirm and accept suggestion for Experience · Description',
    }),
  ).toBeDisabled();
});
