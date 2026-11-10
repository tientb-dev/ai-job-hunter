import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from './render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  ImportMethodCards,
  type ImportMethod,
} from '../src/features/inbox/ImportMethodCards';
import { JobEditor } from '../src/features/inbox/JobEditor';
import {
  emptyOpportunity,
  importFields,
} from '../src/features/inbox/opportunities-api';
import * as bridge from '../src/features/inbox/topcv-bookmarklet';
vi.mock('../src/features/inbox/CvMatchPanel', () => ({
  CvMatchPanel: () => <span>Synthetic match panel</span>,
}));
const id = '00000000-0000-4000-8000-123456789012';
const sourceUrl = 'https://itviec.com/it-jobs/synthetic';
const preview = {
  originalLink: sourceUrl,
  platform: 'ITviec',
  title: 'Synthetic Java engineer',
  company: 'Synthetic company',
  location: 'HCMC',
  sourceText: 'Job title: Synthetic Java engineer\nExplicit synthetic JD',
  description: 'Explicit synthetic JD',
  expired: false,
  validThrough: null,
};
function select(method: string) {
  fireEvent.click(
    screen.getByRole('button', { name: new RegExp(`^${method}`) }),
  );
}
function api() {
  let saved = {
    ...emptyOpportunity(),
    id,
    title: 'Saved synthetic engineer',
    postText: 'Saved synthetic source',
    jdText: '',
    documentName: null,
  };
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/import-url') || url.endsWith('/import-page'))
      return Response.json(preview);
    if (url.endsWith('/parse-document'))
      return Response.json({ text: 'Parsed synthetic document', warnings: [] });
    if (url.endsWith('/extract'))
      return Response.json({
        postText: 'Synthetic',
        jdText: 'Parsed synthetic document',
        description: 'Synthetic JD',
        warnings: [],
        rejected: 0,
        error: null,
        fields: importFields.map((field) => ({
          field,
          value: field === 'title' ? 'Synthetic Java engineer' : '',
          status: field === 'title' ? 'SUPPORTED' : 'MISSING',
          candidates: [],
          reviewed: false,
        })),
      });
    if (init?.method === 'PUT' || init?.method === 'POST')
      saved = { ...saved, ...JSON.parse(init.body as string) };
    return Response.json(saved);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
function mount(path = '/jobs/new') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/jobs/new" element={<JobEditor key="new" />} />
        <Route path="/jobs/:id/*" element={<JobEditor />} />
      </Routes>
    </MemoryRouter>,
  );
}

test('four method cards are keyboard buttons with selected states and no radio/dropdown replacement', async () => {
  function Harness() {
    const [value, setValue] = useState<ImportMethod>('url');
    return (
      <ImportMethodCards
        value={value}
        onChange={setValue}
        disabled={false}
        panelId="panel"
      />
    );
  }
  render(<Harness />);
  const buttons = screen.getAllByRole('button');
  expect(buttons.map((button) => button.textContent)).toEqual([
    'Job URLITviec',
    'BookmarkletTopCV · VietnamWorks',
    'Paste JDRecruiter post or text',
    'Upload JDPDF · DOCX',
  ]);
  expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
  const user = userEvent.setup();
  await user.tab();
  await user.tab();
  await user.keyboard('{Enter}');
  expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
  await user.tab();
  await user.keyboard(' ');
  expect(buttons[2]).toHaveAttribute('aria-pressed', 'true');
  expect(buttons[0]).toHaveAttribute('aria-pressed', 'false');
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});

test('one contextual panel retains text but clears the document when leaving Upload JD without fetching on selection', async () => {
  const fetch = api();
  mount();
  expect(
    screen.getByRole('heading', {
      name: 'How would you like to add this job?',
    }),
  ).toBeVisible();
  const panel = screen.getByRole('region', { name: 'Import method input' });
  expect(
    within(panel).getByLabelText('Original Job URL (optional)'),
  ).toBeVisible();
  expect(screen.queryByLabelText('Recruitment post')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Original Job URL (optional)'), {
    target: { value: sourceUrl },
  });
  select('Paste JD');
  expect(
    screen.queryByLabelText('Original Job URL (optional)'),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Recruitment post'), {
    target: { value: 'Preserved recruiter post' },
  });
  select('Upload JD');
  const document = new File(['Synthetic DOCX fixture'], 'synthetic.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  fireEvent.change(screen.getByLabelText('Upload JD document (PDF or DOCX)'), {
    target: { files: [document] },
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Extract with AI' }),
    ).toBeEnabled(),
  );
  select('Job URL');
  expect(screen.getByLabelText('Original Job URL (optional)')).toHaveValue(
    sourceUrl,
  );
  select('Paste JD');
  expect(screen.getByLabelText('Recruitment post')).toHaveValue(
    'Preserved recruiter post',
  );
  select('Upload JD');
  expect(screen.queryByText('synthetic.docx')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Extract with AI' })).toBeEnabled();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]![0]).toBe('/api/v1/opportunities/parse-document');
  fireEvent.click(screen.getByRole('button', { name: 'Extract with AI' }));
  await screen.findByRole('button', { name: 'Confirm and save job' });
  fireEvent.click(
    screen.getByRole('button', { name: 'Back to Import sources' }),
  );
  select('Paste JD');
  select('Upload JD');
  expect(screen.queryByText('synthetic.docx')).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText('Source JD text (read-only)'),
  ).not.toBeInTheDocument();
});

test('ITviec fetch loads once without AI, extraction remains explicit, and manual review edits survive', async () => {
  const fetch = api();
  mount();
  fireEvent.change(screen.getByLabelText('Original Job URL (optional)'), {
    target: { value: sourceUrl },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Fetch from URL' }));
  expect(await screen.findByText(/JD loaded from ITviec/)).toBeVisible();
  expect(fetch).toHaveBeenCalledTimes(1);
  select('Paste JD');
  expect(screen.getByLabelText('Recruitment post')).toHaveValue(
    preview.sourceText,
  );
  select('Job URL');
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue to Review & Save' }),
  );
  fireEvent.change(screen.getByLabelText(/Job title/), {
    target: { value: 'My reviewed title' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Back to Import sources' }),
  );
  select('Paste JD');
  select('Job URL');
  fireEvent.click(screen.getByRole('button', { name: 'Extract with AI' }));
  await screen.findByRole('button', { name: 'Confirm and save job' });
  expect(screen.getByLabelText(/Job title/)).toHaveValue('My reviewed title');
  expect(
    fetch.mock.calls.filter(([url]) => url.endsWith('/extract')),
  ).toHaveLength(1);
});

test('validated bookmark transfer selects Bookmarklet and keeps the original URL and source without inference', async () => {
  let receive!: (payload: bridge.TopcvPagePayload) => void;
  vi.spyOn(bridge, 'receiveTopcvPage').mockImplementation((_win, consume) => {
    receive = consume;
    return () => {};
  });
  const fetch = api();
  mount();
  const payload: bridge.TopcvPagePayload = {
    version: 1,
    sourceUrl: 'https://www.topcv.vn/viec-lam/synthetic/123.html',
    jobPosting: { '@type': 'JobPosting', description: 'Synthetic job' },
    visibleText: '',
    salaryText: '',
  };
  fetch.mockResolvedValueOnce(
    Response.json({
      ...preview,
      platform: 'TopCV',
      originalLink: payload.sourceUrl,
    }),
  );
  act(() => receive(payload));
  expect(await screen.findByText(/JD loaded from TopCV/)).toBeVisible();
  expect(screen.getByRole('button', { name: /^Bookmarklet/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByRole('button', { name: 'Extract with AI' })).toBeEnabled();
  select('Paste JD');
  expect(screen.getByLabelText('Recruitment post')).toHaveValue(
    preview.sourceText,
  );
  select('Job URL');
  expect(screen.getByLabelText('Original Job URL (optional)')).toHaveValue(
    payload.sourceUrl,
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});

// Keep import orchestration assertions independent of the advisory lookup timer.
vi.mock('../src/features/inbox/DuplicateJobNotice', () => ({
  DuplicateJobNotice: () => null,
}));
