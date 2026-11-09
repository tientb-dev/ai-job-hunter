import { ThemeProvider } from '@mui/material';
import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from './render';
import { theme } from '../src/app/theme';
import { TailoredCvReview } from '../src/features/inbox/TailoredCvReview';
import { draftJobId, tailoredDraftFixture } from './fixtures/tailored-cv';

function setup(currentProfileRevisionId: string | null) {
  const draft = tailoredDraftFixture();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/drafts/readiness'))
        return Response.json({
          contractVersion: '1',
          ready: false,
          reason: 'CV_DRAFT_MATCH_REQUIRED',
          pins: null,
          matchValidForMs: 0,
          currentProfileRevisionId,
        });
      if (url.endsWith('/drafts/list'))
        return Response.json({
          items: [
            {
              id: draft.id,
              revision: draft.revision,
              updatedAt: draft.updatedAt,
            },
          ],
          nextCursor: null,
        });
      if (url.endsWith(`/drafts/${draft.id}`)) return Response.json(draft);
      throw Error(`Unexpected request: ${url}`);
    }),
  );
  render(
    <ThemeProvider theme={theme}>
      <TailoredCvReview
        jobId={draftJobId}
        jobRevision={draft.document.pins.jobUpdatedAt}
        cv={{ fileName: 'synthetic.pdf', updatedAt: draft.updatedAt }}
        disabled={false}
        onDirtyChange={() => {}}
        onBusyChange={() => {}}
        wizardStep={2}
      />
    </ThemeProvider>,
  );
  return draft;
}

test('a draft built from an earlier CV review shows a non-blocking notice with a way to generate anew', async () => {
  setup('00000000-0000-4000-8000-00000000abcd');
  const notice = await screen.findByRole('alert', {
    name: 'Earlier CV review',
  });
  expect(notice).toHaveTextContent(
    'This draft uses an earlier review of your CV. Generate a new draft to include your latest corrections.',
  );
  const section = document.getElementById('generate-new-draft')!;
  expect(section).not.toHaveAttribute('open');
  fireEvent.click(screen.getByRole('button', { name: 'Generate a new draft' }));
  await waitFor(() => expect(section).toHaveAttribute('open'));
  // The old draft stays open and reviewable.
  expect(screen.getByText(/suggestions decided/)).toBeVisible();
});

test('no notice when the draft uses the current review', async () => {
  const draft = tailoredDraftFixture();
  setup(draft.document.pins.profileRevisionId);
  await screen.findByText(/suggestions decided/);
  expect(screen.queryByRole('alert', { name: 'Earlier CV review' })).toBeNull();
});
