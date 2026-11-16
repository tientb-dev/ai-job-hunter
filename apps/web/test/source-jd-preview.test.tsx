import { expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from './render';
import { MemoryRouter } from 'react-router-dom';
import { JobEditor } from '../src/features/inbox/JobEditor';
import { SourceJdPreview } from '../src/features/inbox/SourceJdPreview';
import * as bridge from '../src/features/inbox/topcv-bookmarklet';
const raw =
  'Original source heading\nResponsibilities: system architecture\nRequirements: education, TOEIC 550 / IELTS 5.5\nEnd of full source';
const preview = {
  originalLink: 'https://itviec.com/it-jobs/synthetic-viettel',
  platform: 'ITviec',
  title: 'Synthetic engineer',
  company: 'Synthetic',
  location: '',
  sourceText: raw,
  description: 'A different editable job description',
  expired: false,
  validThrough: null,
};
const select = (label: string) =>
  fireEvent.click(
    screen.getByRole('button', { name: new RegExp(`^${label}`) }),
  );
const mount = () =>
  render(
    <MemoryRouter>
      <JobEditor />
    </MemoryRouter>,
  );

test('ITviec preview shows full actual extraction source before AI, survives switching, and does not duplicate Paste', async () => {
  const fetch = vi.fn(async () => Response.json(preview));
  vi.stubGlobal('fetch', fetch);
  mount();
  expect(screen.getByText('Empty')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Original Job URL (optional)'), {
    target: { value: preview.originalLink },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Fetch from URL' }));
  const text = await screen.findByLabelText('Source JD text (read-only)');
  expect(text).toHaveValue(raw);
  expect(text).toHaveAttribute('readonly');
  // Collapsed by default behind the job summary; one click shows it.
  expect(text).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /Preview source JD/ }));
  await waitFor(() => expect(text).toBeVisible());
  expect(text).not.toHaveValue(preview.description);
  select('Paste JD');
  expect(
    screen.queryByRole('button', { name: /Preview source JD/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText('Recruitment post')).toHaveValue(raw);
  fireEvent.change(screen.getByLabelText('Recruitment post'), {
    target: { value: `${raw}\nManual source correction` },
  });
  select('Paste job URL');
  expect(screen.getByLabelText('Source JD text (read-only)')).toHaveValue(
    `${raw}\nManual source correction`,
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('bookmarklet preview uses transferred source text with its known platform and never calls extraction', async () => {
  let consume!: (payload: bridge.TopcvPagePayload) => void;
  vi.spyOn(bridge, 'receiveTopcvPage').mockImplementation((_win, receive) => {
    consume = receive;
    return () => {};
  });
  const fetch = vi.fn(async () =>
    Response.json({ ...preview, platform: 'VietnamWorks' }),
  );
  vi.stubGlobal('fetch', fetch);
  mount();
  act(() =>
    consume({
      version: 1,
      sourceUrl: 'https://www.vietnamworks.com/synthetic-jv',
      jobPosting: { '@type': 'JobPosting', description: raw },
      visibleText: raw,
      salaryText: '',
    }),
  );
  expect(
    await screen.findByLabelText('Source JD text (read-only)'),
  ).toHaveValue(raw);
  fireEvent.click(screen.getByRole('button', { name: /Preview source JD/ }));
  await waitFor(() =>
    expect(
      screen.getByText(/VietnamWorks · Original source text/),
    ).toBeVisible(),
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]).toBeDefined();
});

test('upload calls existing parse-only endpoint once, shows real parsed text, and clears it when leaving Upload JD', async () => {
  const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () => Response.json({ text: raw, warnings: [] }),
  );
  vi.stubGlobal('fetch', fetch);
  mount();
  select('Upload JD');
  const file = new File(['synthetic DOCX'], 'synthetic.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  fireEvent.change(screen.getByLabelText('Upload JD document (PDF or DOCX)'), {
    target: { files: [file] },
  });
  expect(
    await screen.findByLabelText('Source JD text (read-only)'),
  ).toHaveValue(raw);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: /^Paste job URL/ }),
    ).toBeEnabled(),
  );
  expect(fetch.mock.calls[0]![0]).toBe('/api/v1/opportunities/parse-document');
  expect(fetch.mock.calls[0]![1]!.headers).toMatchObject({
    'Content-Type': file.type,
  });
  expect(fetch.mock.calls[0]![1]!.body).toBeInstanceOf(Blob);
  select('Paste JD');
  select('Paste job URL');
  select('Upload JD');
  expect(
    screen.queryByLabelText('Source JD text (read-only)'),
  ).not.toBeInTheDocument();
  expect(screen.queryByText('synthetic.docx')).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('parse failure shows an actionable preview error without inventing parsed content or retaining the failed file', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(
        { message: 'No readable text. Paste JD text instead.' },
        { status: 400 },
      ),
    ),
  );
  mount();
  select('Upload JD');
  fireEvent.change(screen.getByLabelText('Upload JD document (PDF or DOCX)'), {
    target: {
      files: [
        new File(['synthetic'], 'synthetic.pdf', { type: 'application/pdf' }),
      ],
    },
  });
  expect(await screen.findByText('Preview error')).toBeVisible();
  expect(screen.getByText(/No readable text/)).toBeVisible();
  expect(
    screen.queryByLabelText('Source JD text (read-only)'),
  ).not.toBeInTheDocument();
  expect(screen.queryByText('synthetic.pdf')).not.toBeInTheDocument();
});

test('preview starts collapsed, opens on demand, stays put on new text and opens for errors', async () => {
  const { rerender } = render(
    <SourceJdPreview text={raw} source="Synthetic source" />,
  );
  const text = () => screen.getByLabelText('Source JD text (read-only)');
  expect(text()).not.toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /Preview source JD/ }));
  await waitFor(() => expect(text()).toBeVisible());
  fireEvent.click(screen.getByRole('button', { name: /Preview source JD/ }));
  await waitFor(() => expect(text()).not.toBeVisible());
  rerender(
    <SourceJdPreview text={`${raw}\nNew section`} source="Synthetic source" />,
  );
  expect(text()).toHaveValue(`${raw}\nNew section`);
  expect(text()).not.toBeVisible();
  rerender(
    <SourceJdPreview
      text={`${raw}\nNew section`}
      source="Synthetic source"
      error="Synthetic failure"
    />,
  );
  await waitFor(() =>
    expect(screen.getByText(/Synthetic failure/)).toBeVisible(),
  );
});

test('height-limited preview retains the complete long source rather than truncating its value', () => {
  const text = Array.from(
    { length: 80 },
    (_, index) => `Synthetic source line ${index + 1}`,
  ).join('\n');
  render(<SourceJdPreview text={text} source="Synthetic long source" />);
  expect(screen.getByLabelText('Source JD text (read-only)')).toHaveValue(text);
  expect(
    (
      screen.getByLabelText('Source JD text (read-only)') as HTMLTextAreaElement
    ).value.split('\n'),
  ).toHaveLength(80);
});

// Isolate source-import requests from the separately tested duplicate lookup timer.
vi.mock('../src/features/inbox/DuplicateJobNotice', () => ({
  DuplicateJobNotice: () => null,
}));
