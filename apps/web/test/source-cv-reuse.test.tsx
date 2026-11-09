import { ThemeProvider } from '@mui/material';
import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from './render';
import { theme } from '../src/app/theme';
import { SourceCvReview } from '../src/features/inbox/SourceCvReview';
import { splitDates } from '../src/features/inbox/source-cv-review.contract';
import {
  cvProfileFixture,
  sourceCvFixture,
  structuredCvFixture,
} from './fixtures/source-cv-review';

const priorRevision = '00000000-0000-4000-8000-0000000000aa';
function setup() {
  const bodies: Record<string, unknown>[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/sources') || url.endsWith('/content'))
      return Response.json(sourceCvFixture);
    if (url.endsWith('/profile')) return Response.json(null);
    if (url.endsWith('/reusable-review'))
      return Response.json({
        contractVersion: '1',
        profileRevisionId: priorRevision,
        revision: 4,
        savedAt: '2026-11-08T10:00:00.000Z',
        checkedSections: 2,
        totalSections: 3,
        confirmedFacts: 5,
      });
    if (url.endsWith('/profiles')) {
      bodies.push(JSON.parse(init!.body as string));
      return Response.json({
        ...cvProfileFixture(false),
        document: structuredCvFixture(),
      });
    }
    if (url.endsWith('/revisions')) throw new Error('No save expected');
    throw new Error(`Unexpected test request: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  render(
    <ThemeProvider theme={theme}>
      <SourceCvReview
        cv={{
          fileName: sourceCvFixture.fileName,
          updatedAt: sourceCvFixture.savedCvUpdatedAt,
        }}
        disabled={false}
        onDirtyChange={() => {}}
        onBusyChange={() => {}}
      />
    </ThemeProvider>,
  );
  return { fetch, bodies };
}

test('an identical earlier review is offered; continuing reuses it explicitly', async () => {
  const state = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Review source CV' }));
  await screen.findByText('You already reviewed this exact CV');
  expect(screen.getByText(/2 of\s+3 sections checked/)).toBeVisible();
  expect(state.bodies).toHaveLength(0);
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue earlier review' }),
  );
  await screen.findByText(/earlier review was carried over/);
  expect(state.bodies[0]).toMatchObject({
    reuseProfileRevisionId: priorRevision,
  });
});

test('a fresh review is still available and sends no reuse request', async () => {
  const state = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Review source CV' }));
  await screen.findByText('You already reviewed this exact CV');
  fireEvent.click(screen.getByRole('button', { name: 'Start a fresh review' }));
  await screen.findByText(/A fresh review was started/);
  expect(state.bodies[0]).not.toHaveProperty('reuseProfileRevisionId');
});

test('Complete review lists exact blockers instead of saving unfinished work', async () => {
  const state = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Review source CV' }));
  fireEvent.click(
    await screen.findByRole('button', { name: 'Start a fresh review' }),
  );
  await screen.findByText(/A fresh review was started/);
  const blockers = screen.getByRole('region', {
    name: 'Before you can complete the review',
  });
  expect(blockers).toHaveTextContent(/as checked|Check /);
  fireEvent.click(screen.getByRole('button', { name: 'Complete review' }));
  await waitFor(() => expect(blockers).toHaveFocus());
  expect(
    state.fetch.mock.calls.some(([url]) => String(url).endsWith('/revisions')),
  ).toBe(false);
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
});

test('institution/date split is only offered for a clear trailing range', () => {
  expect(
    splitDates('Example Institute of Technology Aug 2015 - Sep 2019\n'),
  ).toEqual({
    name: 'Example Institute of Technology',
    dates: 'Aug 2015 - Sep 2019',
  });
  expect(splitDates('Synthetic College 2018 – Present')).toEqual({
    name: 'Synthetic College',
    dates: '2018 – Present',
  });
  expect(splitDates('Graduated: 2019')).toBeNull();
  expect(splitDates('Class of 2019 University')).toBeNull();
});
