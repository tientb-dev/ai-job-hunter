import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from './render';
import { MemoryRouter } from 'react-router-dom';
import { JobEditor } from '../src/features/inbox/JobEditor';
import { importFields } from '../src/features/inbox/opportunities-api';

const extracted = {
  fields: importFields.map((field) => ({
    field,
    value: field === 'title' ? 'Synthetic engineer' : '',
    status: field === 'title' ? 'SUPPORTED' : 'MISSING',
    reviewed: false,
    candidates: [],
  })),
  postText: 'Synthetic post',
  jdText: '',
  description: 'Synthetic post',
  warnings: [],
  rejected: 0,
  error: null,
};
function mount() {
  render(
    <MemoryRouter>
      <JobEditor />
    </MemoryRouter>,
  );
}
const card = (name: RegExp) => screen.getByRole('button', { name });

test('Fill in with AI sends one request even when clicked repeatedly, then opens Review', async () => {
  let release!: (response: Response) => void;
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetch);
  mount();
  fireEvent.click(card(/^Paste content/));
  fireEvent.change(screen.getByLabelText('Job posting content'), {
    target: { value: 'Synthetic post' },
  });
  const fill = screen.getByRole('button', { name: 'Fill in with AI' });
  fireEvent.click(fill);
  fireEvent.click(fill);
  fireEvent.click(screen.getByRole('button', { name: /Filling in/ }));
  expect(fetch).toHaveBeenCalledTimes(1);
  release(Response.json(extracted));
  expect(
    await screen.findByRole('button', { name: 'Confirm and save job' }),
  ).toBeVisible();
  expect(screen.getByLabelText(/Job title/)).toHaveValue('Synthetic engineer');
});

test('extraction request failure stays on Import sources with the error next to the action', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ message: 'Extraction unavailable.' }, { status: 400 }),
    ),
  );
  mount();
  fireEvent.click(card(/^Paste content/));
  fireEvent.change(screen.getByLabelText('Job posting content'), {
    target: { value: 'Synthetic post' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Fill in with AI' }));
  const section = screen.getByRole('region', {
    name: 'Fill in the job details',
  });
  expect(
    await within(section).findByText(/Extraction unavailable/),
  ).toBeVisible();
  expect(screen.getAllByText(/Extraction unavailable/)).toHaveLength(1);
  expect(screen.getByLabelText('Job posting content')).toHaveValue(
    'Synthetic post',
  );
  expect(
    screen.queryByRole('button', { name: 'Confirm and save job' }),
  ).toBeNull();
});

test('Source moves to Review, is prefilled from a job-board link and stays editable', async () => {
  vi.stubGlobal('fetch', vi.fn());
  mount();
  expect(screen.queryByRole('combobox', { name: 'Source' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Job posting link'), {
    target: { value: 'https://itviec.com/it-jobs/synthetic' },
  });
  fireEvent.click(card(/^Paste content/));
  fireEvent.click(screen.getByRole('button', { name: 'Use for this job' }));
  fireEvent.change(screen.getByLabelText('Job posting content'), {
    target: { value: 'Synthetic post' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Continue without AI' }));
  const review = screen.getByRole('region', { name: 'Review & Save' });
  expect(within(review).getByLabelText('Source')).toHaveTextContent('Website');
  expect(
    within(review).getByText(/Detected from the link: ITviec/),
  ).toBeVisible();
});

test('upload uses a localised file button, validates inline and keeps the hidden input labelled', () => {
  vi.stubGlobal('fetch', vi.fn());
  mount();
  fireEvent.click(card(/^Upload document/));
  // Only the selected method's content is shown.
  expect(screen.queryByLabelText('Job posting link')).toBeNull();
  expect(screen.queryByLabelText('Job posting content')).toBeNull();
  const input = screen.getByLabelText('Upload JD document (PDF or DOCX)');
  const click = vi.spyOn(input, 'click');
  fireEvent.click(screen.getByRole('button', { name: 'Choose file' }));
  expect(click).toHaveBeenCalledTimes(1);
  fireEvent.change(input, {
    target: { files: [new File(['x'], 'synthetic.txt')] },
  });
  expect(screen.getByText(/Use a PDF or DOCX file up to 5 MB/)).toBeVisible();
  expect(fetch).not.toHaveBeenCalled();
});

test('paste shows a live character counter and the bookmark help only appears in link mode', () => {
  vi.stubGlobal('fetch', vi.fn());
  mount();
  const bookmark = "Can't fetch the page? Use the page-import bookmark";
  expect(screen.getByText(bookmark)).toBeInTheDocument();
  fireEvent.click(card(/^Paste content/));
  expect(screen.queryByText(bookmark)).toBeNull();
  expect(screen.getByText('0 / 12,000 characters')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Job posting content'), {
    target: { value: 'Synthetic post' },
  });
  expect(screen.getByText('14 / 12,000 characters')).toBeVisible();
});

test('server failures show friendly fill-in and save messages without technical details', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ message: 'x' }, { status: 503 })),
  );
  mount();
  fireEvent.click(card(/^Paste content/));
  fireEvent.change(screen.getByLabelText('Job posting content'), {
    target: { value: 'Synthetic post' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Fill in with AI' }));
  expect(
    await screen.findByText(/Could not fill in the details with AI right now/),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Continue without AI' }));
  fireEvent.change(screen.getByLabelText(/Job title/), {
    target: { value: 'Synthetic engineer' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save job' }));
  expect(
    await screen.findByText(/Could not save the job right now/),
  ).toBeVisible();
  expect(screen.queryByText(/local API/)).toBeNull();
  expect(screen.getByLabelText(/Job title/)).toHaveValue('Synthetic engineer');
});

test('dropping a file on the drop zone parses it like the file picker', async () => {
  const fetch = vi.fn<(url: string) => Promise<Response>>(async () =>
    Response.json({ text: 'Synthetic parsed JD', warnings: [] }),
  );
  vi.stubGlobal('fetch', fetch);
  mount();
  fireEvent.click(card(/^Upload document/));
  const zone = screen
    .getByText('Drag a file here, or choose one from your device.')
    .closest('[data-dragging], div')!.parentElement!;
  const file = new File(['%PDF'], 'synthetic.pdf', { type: 'application/pdf' });
  fireEvent.dragOver(zone, { dataTransfer: { files: [file] } });
  expect(screen.getByText('Drop the file to upload it.')).toBeVisible();
  fireEvent.drop(zone, { dataTransfer: { files: [file] } });
  expect(
    await screen.findByText('synthetic.pdf', { selector: 'p' }),
  ).toBeVisible();
  expect(fetch.mock.calls[0]![0]).toBe('/api/v1/opportunities/parse-document');
});
