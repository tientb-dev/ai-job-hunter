import { ThemeProvider } from '@mui/material';
import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from './render';
import { theme } from '../src/app/theme';
import { TailoredCvReview } from '../src/features/inbox/TailoredCvReview';
import { draftJobId, tailoredDraftFixture } from './fixtures/tailored-cv';

// One older saved draft; generation returns a second, newer one (synthetic).
function setup() {
  const older = tailoredDraftFixture();
  const newer = {
    ...tailoredDraftFixture(),
    id: '00000000-0000-4000-8000-0000000000b2',
    updatedAt: '2026-11-10T09:00:00.000Z',
  };
  let readinessReads = 0;
  let hold: Promise<void> | null = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/drafts/readiness')) {
        readinessReads++;
        if (hold) await hold;
        return Response.json({
          contractVersion: '1',
          ready: true,
          reason: null,
          pins: {
            sourceRevisionId: older.document.pins.sourceRevisionId,
            profileRevisionId: older.document.pins.profileRevisionId,
            expectedProfileRevision: 2,
            expectedJobUpdatedAt: older.document.pins.jobUpdatedAt,
            // Echo the requested match, as the server pins the current one.
            matchId: (JSON.parse(String(init?.body)) as { matchId: string })
              .matchId,
          },
          matchValidForMs: 900000,
        });
      }
      if (url.endsWith('/drafts/list'))
        return Response.json({
          items: [
            {
              id: older.id,
              revision: older.revision,
              updatedAt: older.updatedAt,
            },
          ],
          nextCursor: null,
        });
      if (url.endsWith(`/drafts/${older.id}`)) return Response.json(older);
      if (url.endsWith(`/jobs/${draftJobId}/drafts`))
        return Response.json(newer);
      throw Error(`Unexpected request: ${url}`);
    }),
  );
  const view = (matchId: string) => (
    <ThemeProvider theme={theme}>
      <TailoredCvReview
        jobId={draftJobId}
        jobRevision={older.document.pins.jobUpdatedAt}
        cv={{ fileName: 'synthetic.pdf', updatedAt: older.updatedAt }}
        matchId={matchId}
        disabled={false}
        onDirtyChange={() => {}}
        onBusyChange={() => {}}
        wizardStep={2}
        continued
      />
    </ThemeProvider>
  );
  const rendered = render(view('00000000-0000-4000-8000-000000000086'));
  return {
    readinessReads: () => readinessReads,
    holdReadiness: (value: Promise<void>) => (hold = value),
    rerender: (matchId: string) => rendered.rerender(view(matchId)),
  };
}

test('after Source CV Review the new-draft action is open; a generated draft joins the switcher and is selected', async () => {
  setup();
  const current = await screen.findByRole('region', { name: 'Current draft' });
  expect(within(current).getByRole('heading')).toHaveTextContent(
    'Draft 1 of 1',
  );
  // Discoverable without generating anything automatically.
  expect(document.getElementById('generate-new-draft')).toHaveAttribute('open');
  expect(screen.getByText(/Source review saved/)).toBeVisible();
  const generate = screen.getByRole('button', { name: 'Generate new draft' });
  await waitFor(() => expect(generate).toBeEnabled());
  fireEvent.click(generate);
  await screen.findByText(/New draft generated and opened/);
  expect(within(current).getByRole('heading')).toHaveTextContent(
    'Draft 2 of 2',
  );
  expect(screen.queryByText(/Source review saved/)).toBeNull();
  fireEvent.click(screen.getByText('Switch draft (2)'));
  expect(
    screen.getByRole('button', { name: /^Draft 2 .*Open now$/ }),
  ).toHaveAttribute('aria-current', 'true');
  expect(screen.getByRole('button', { name: /^Draft 1 / })).toBeVisible();
});

test('a focus recheck keeps the readiness text instead of flashing Checking', async () => {
  const state = setup();
  const status = await screen.findByText(/ready/i, {
    selector: '#generate-new-draft [role="status"] *',
  });
  const text = status.textContent;
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Generate new draft' }),
    ).toBeEnabled(),
  );
  const before = state.readinessReads();
  let release!: () => void;
  state.holdReadiness(new Promise<void>((resolve) => (release = resolve)));
  fireEvent.focus(window);
  // Assert while the recheck is still pending, when the flash used to occur.
  await waitFor(() => expect(state.readinessReads()).toBeGreaterThan(before));
  expect(screen.queryByText(/Checking draft generation readiness/)).toBeNull();
  expect(status).toHaveTextContent(text!);
  expect(
    screen.getByRole('button', { name: 'Generate new draft' }),
  ).toBeEnabled();
  release();
});

test('a changed context clears readiness and disables generation until rechecked', async () => {
  const state = setup();
  // Re-query: the section remounts once the opened draft loads.
  const generate = () =>
    screen.getByRole('button', { name: 'Generate new draft' });
  await waitFor(() => expect(generate()).toBeEnabled());
  let release!: () => void;
  state.holdReadiness(new Promise<void>((resolve) => (release = resolve)));
  state.rerender('00000000-0000-4000-8000-0000000000c3');
  expect(generate()).toBeDisabled();
  expect(screen.getByText(/Checking draft generation readiness/)).toBeVisible();
  release();
  await waitFor(() => expect(generate()).toBeEnabled());
});
