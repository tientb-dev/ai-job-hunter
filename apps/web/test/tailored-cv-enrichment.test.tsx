import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { closeSuccess, render, screen, within } from './render';
import {
  ClarificationCard,
  SourceCvUpdate,
} from '../src/features/inbox/TailoredCvEnrichment';
import { tailoredDraftFixture } from './fixtures/tailored-cv';

test('shows draft-confirmed wording before the separate decision to use it', async () => {
  const fact = tailoredDraftFixture().document.sections.find(
    (s) => s.kind === 'experience',
  )!.entries[0]!.facts[0]!;
  const operation = vi.fn();
  function Harness() {
    const [answer, setAnswer] = useState('');
    return (
      <ClarificationCard
        fact={{
          ...fact,
          clarification: {
            kind: 'impact',
            status: answer ? 'confirmed' : 'open',
            requirementIds: [],
            ...(answer ? { answer } : {}),
          },
        }}
        disabled={false}
        where="Campaign assistant"
        original="Prepared the campaign summaries."
        onDecision={async (decision) => {
          operation(decision);
          if (decision.action === 'confirm_answer') setAnswer(decision.text);
          return true;
        }}
      />
    );
  }
  const user = userEvent.setup();
  render(<Harness />);
  expect(screen.queryByRole('button', { name: 'Use this wording' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Provide details' }));
  const input = screen.getByRole('textbox', { name: 'Your factual detail' });
  await user.type(
    input,
    'The summaries gave the team a shared weekly reference.',
  );
  expect(operation).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Confirm this fact' }));
  expect(operation).toHaveBeenCalledExactlyOnceWith({
    action: 'confirm_answer',
    factId: fact.id,
    text: 'The summaries gave the team a shared weekly reference.',
  });
  await user.click(
    await screen.findByRole('button', { name: 'Use this wording' }),
  );
  expect(operation).toHaveBeenLastCalledWith({
    action: 'use_answer',
    factId: fact.id,
  });
});

test('source changes are opt-in and cancel clears selection before a fresh diff', async () => {
  const draft = tailoredDraftFixture();
  const onUpdated = vi.fn();
  const fetch = vi.fn(async (...[path]: [string, RequestInit?]) =>
    Response.json(
      path.endsWith('/preview')
        ? {
            profileRevision: 4,
            changes: [
              { factId: 'a', before: 'Original A', after: 'New A' },
              { factId: 'b', before: 'Original B', after: 'New B' },
            ],
          }
        : { profileRevision: 5 },
    ),
  );
  vi.stubGlobal('fetch', fetch);
  try {
    const user = userEvent.setup();
    render(
      <SourceCvUpdate draft={draft} disabled={false} onUpdated={onUpdated} />,
    );
    expect(fetch).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole('checkbox', { name: 'Also update my source CV' }),
    );
    const comparison = await screen.findByText('Original A');
    const select = within(comparison.parentElement!).getByRole('checkbox');
    await user.click(select);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetch).toHaveBeenCalledTimes(1);
    await user.click(
      screen.getByRole('checkbox', { name: 'Also update my source CV' }),
    );
    const confirm = await screen.findByRole('button', {
      name: 'Confirm source CV update',
    });
    expect(confirm).toBeDisabled();
    await user.click(
      within(screen.getByText('Original B').parentElement!).getByRole(
        'checkbox',
      ),
    );
    await user.click(confirm);
    expect(JSON.parse(fetch.mock.calls[2]![1]!.body as string)).toEqual({
      contractVersion: '1',
      expectedDraftRevision: draft.revision,
      expectedProfileRevision: 4,
      factIds: ['b'],
    });
    expect(onUpdated).toHaveBeenCalledOnce();
    await closeSuccess();
  } finally {
    vi.unstubAllGlobals();
  }
});
