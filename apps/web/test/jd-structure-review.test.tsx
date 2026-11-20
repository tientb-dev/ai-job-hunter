import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Notifications } from '../src/components/useNotify';
import { JdStructureReview } from '../src/features/inbox/JdStructureReview';

test('shows the source, requires an explicit assignment, and confirms against the loaded revision', async () => {
  const source = 'JavaScript and VueJS or a suitable frontend framework';
  const requirement = {
    id: 'group',
    reason: 'AMBIGUOUS_GROUP',
    eligible: false,
    priority: 'required',
    alternatives: 'NAMED_WITH_FALLBACK',
    namedAlternatives: ['Vue'],
    candidates: [
      { canonical: 'JavaScript', literal: 'JavaScript' },
      { canonical: 'Vue', literal: 'VueJS' },
    ],
    sources: [{ source: { field: 'description', quote: source } }],
  };
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    Response.json({
      state: init?.method === 'POST' ? 'COMPLETE' : 'INCOMPLETE',
      inventory: {
        id: 'inventory',
        requirements:
          init?.method === 'POST'
            ? [
                {
                  ...requirement,
                  eligible: true,
                  confirmation: {
                    mandatory: ['JavaScript'],
                    alternatives: ['Vue'],
                  },
                },
              ]
            : [requirement],
      },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const notify = vi.fn(),
    saved = vi.fn(),
    user = userEvent.setup();
  render(
    <Notifications.Provider value={notify}>
      <JdStructureReview jobId="job" onSaved={saved} />
    </Notifications.Provider>,
  );
  await user.click(
    screen.getByRole('button', { name: 'Review ambiguous JD structure' }),
  );
  await user.click(
    await screen.findByRole('combobox', { name: 'Ambiguous requirement' }),
  );
  await user.click(screen.getByRole('option', { name: source }));
  const confirm = screen.getByRole('button', {
    name: 'Confirm interpretation',
  });
  expect(confirm).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Leave unresolved' }));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await user.click(
    screen.getByRole('combobox', { name: 'Ambiguous requirement' }),
  );
  await user.click(screen.getByRole('option', { name: source }));
  await user.click(screen.getByRole('combobox', { name: 'JavaScript' }));
  await user.click(
    screen.getByRole('option', { name: 'Each selected skill is required' }),
  );
  await user.click(
    screen.getByRole('button', { name: 'Confirm interpretation' }),
  );
  expect(await screen.findByText(/Confirmed JD structure/)).toBeVisible();
  expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
    groupId: 'group',
    inventoryId: 'inventory',
    mandatory: ['JavaScript'],
    alternatives: ['Vue'],
    contextual: [],
    mandatoryPriority: 'required',
    alternativePriority: 'required',
  });
  expect(saved).toHaveBeenCalledTimes(1);
  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({ severity: 'success' }),
  );
});
