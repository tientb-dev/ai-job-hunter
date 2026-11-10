import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from './render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { JobEditor } from '../src/features/inbox/JobEditor';
import {
  emptyOpportunity,
  importFields,
} from '../src/features/inbox/opportunities-api';
import type { ImportPreview } from '../src/features/inbox/opportunities-api';
const id = '00000000-0000-4000-8000-123456789012';
const post = 'Synthetic engineer recruitment post';
function preview(
  values: Record<string, string>,
  options: { conflict?: boolean; error?: string; jd?: string } = {},
): ImportPreview {
  return {
    fields: importFields.map((field) => ({
      field,
      value: values[field] ?? '',
      status:
        options.conflict && field === 'company'
          ? 'CONFLICT'
          : values[field]
            ? 'SUPPORTED'
            : 'MISSING',
      reviewed: false,
      candidates:
        options.conflict && field === 'company'
          ? [
              {
                field,
                value: 'Example A',
                source: 'post',
                quote: 'Employer: Example A',
              },
              {
                field,
                value: 'Example B',
                source: 'jd',
                quote: 'Employer: Example B',
              },
            ]
          : values[field]
            ? [
                {
                  field,
                  value: values[field]!,
                  source: options.jd ? 'jd' : 'post',
                  quote: values[field]!,
                },
              ]
            : [],
    })),
    postText: post,
    jdText: options.jd ?? '',
    description: `${post}\n${options.jd ?? ''}`,
    warnings: [],
    rejected: 0,
    error: options.error ?? null,
  };
}
function mount() {
  const view = render(
    <MemoryRouter initialEntries={['/jobs/new']}>
      <Routes>
        <Route path="/jobs/new" element={<JobEditor />} />
        <Route path="/jobs/:id/*" element={<JobEditor />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Paste JD/ }));
  return view;
}
function mock(result: ImportPreview) {
  let saved = {
    ...emptyOpportunity(),
    id,
    jdText: result.jdText,
    documentName: null,
  };
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/cv/current')) return Response.json(null);
    if (url.endsWith('/parse-document'))
      return Response.json({
        text: result.jdText || 'Synthetic parsed JD',
        warnings: [],
      });
    if (url.endsWith('/extract')) return Response.json(result);
    if (init?.method === 'POST' || init?.method === 'PUT') {
      const record =
        typeof init.body === 'string'
          ? JSON.parse(init.body)
          : JSON.parse((init.body as FormData).get('record') as string);
      saved = { ...saved, ...record };
      return Response.json(saved, { status: 201 });
    }
    return Response.json(saved);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
test('paste-first extraction fills editable fields, leaves company optional and saves original post', async () => {
  const fetch = mock(
    preview({ title: 'Synthetic engineer', location: 'Example City' }),
  );
  mount();
  expect(
    screen.getByRole('button', { name: 'Extract with AI' }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Recruitment post'), {
    target: { value: post },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Extract with AI' }),
  );
  expect(await screen.findByDisplayValue('Synthetic engineer')).toBeVisible();
  expect(screen.getByLabelText('Company')).not.toBeRequired();
  expect(screen.getAllByText(/Missing \/ unknown/).length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText('Location'), {
    target: { value: 'Edited City' },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm and save job' }),
  );
  await screen.findByRole('heading', { name: 'Job overview' });
  const request = fetch.mock.calls.find(
    ([, init]) => init?.method === 'POST' && typeof init.body === 'string',
  )!;
  expect(JSON.parse(request[1]!.body as string)).toMatchObject({
    postText: post,
    company: '',
    location: 'Edited City',
    title: 'Synthetic engineer',
  });
  const extract = fetch.mock.calls[0]![1]!;
  expect(extract.body).toBeInstanceOf(FormData);
  expect(
    JSON.parse((extract.body as FormData).get('record') as string),
  ).toEqual({ postText: post });
});
test.each([false, true])(
  'JD upload supports document-only or combined input (post=%s) and preserves the file for save',
  async (withPost) => {
    const fetch = mock(
      preview(
        { title: 'Synthetic JD engineer', company: 'JD Employer' },
        { jd: 'Company: JD Employer' },
      ),
    );
    mount();
    const file = new File(['synthetic PDF bytes'], 'synthetic.pdf', {
      type: 'application/pdf',
    });
    if (withPost) {
      fireEvent.change(screen.getByLabelText('Recruitment post'), {
        target: { value: post },
      });
    }
    fireEvent.click(screen.getByRole('button', { name: /Upload JD/ }));
    await userEvent.upload(
      screen.getByLabelText('Upload JD document (PDF or DOCX)'),
      file,
    );
    await waitFor(() =>
      expect(screen.getByText('synthetic.pdf')).toBeVisible(),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Extract with AI' }),
    );
    await screen.findByDisplayValue('JD Employer');
    expect(
      (
        fetch.mock.calls.find(([url]) => url.endsWith('/extract'))![1]!
          .body as FormData
      ).get('document'),
    ).toBeInstanceOf(File);
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirm and save job' }),
    );
    await screen.findByRole('heading', { name: 'Job overview' });
    const saved = fetch.mock.calls.find(
      ([url, init]) =>
        url === '/api/v1/opportunities' && init?.method === 'POST',
    )![1]!.body as FormData;
    expect(saved.get('document')).toBeInstanceOf(File);
    expect(JSON.parse(saved.get('record') as string).company).toBe(
      'JD Employer',
    );
  },
);
test('conflict is blank and saving stays blocked until an explicit review', async () => {
  mock(
    preview(
      { title: 'Synthetic engineer' },
      { conflict: true, jd: 'Employer: Example B' },
    ),
  );
  mount();
  fireEvent.change(screen.getByLabelText('Recruitment post'), {
    target: { value: post },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Extract with AI' }),
  );
  await screen.findByText('Conflicting evidence');
  expect(screen.getByLabelText('Company')).toHaveValue('');
  expect(
    screen.getByRole('button', { name: 'Confirm and save job' }),
  ).toBeDisabled();
  await userEvent.click(
    screen.getByRole('checkbox', {
      name: 'I reviewed the conflict for Company',
    }),
  );
  expect(
    screen.getByRole('button', { name: 'Confirm and save job' }),
  ).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Company'), {
    target: { value: 'Manual correction' },
  });
  expect(
    screen.getByRole('button', { name: 'Confirm and save job' }),
  ).toBeDisabled();
  await userEvent.click(
    screen.getByRole('checkbox', {
      name: 'I reviewed the conflict for Company',
    }),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm and save job' }),
  );
  await screen.findByRole('heading', { name: 'Job overview' });
});
test('AI failure retains the post and allows manual save without another extraction', async () => {
  const fetch = mock(
    preview({}, { error: 'AI unavailable. Enter fields manually.' }),
  );
  mount();
  fireEvent.change(screen.getByLabelText('Recruitment post'), {
    target: { value: post },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Extract with AI' }),
  );
  await screen.findByText(/AI unavailable/);
  expect(screen.getByLabelText('Recruitment post')).toHaveValue(post);
  fireEvent.change(screen.getByLabelText(/Job title/), {
    target: { value: 'Synthetic manual engineer' },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm and save job' }),
  );
  await screen.findByRole('heading', { name: 'Job overview' });
  expect(
    fetch.mock.calls.filter(([url]) => url.endsWith('/extract')),
  ).toHaveLength(1);
});

test('maps the captured single Ollama result, requires conflict review and saves manual corrections', async () => {
  const result = (await import('./fixtures/smart-import.synthetic-result.json'))
    .default as ImportPreview;
  const fetch = mock(result);
  mount();
  fireEvent.change(screen.getByLabelText('Recruitment post'), {
    target: { value: result.postText },
  });
  fireEvent.click(screen.getByRole('button', { name: /Upload JD/ }));
  await userEvent.upload(
    screen.getByLabelText('Upload JD document (PDF or DOCX)'),
    new File(['synthetic replay attachment'], 'synthetic-jd.pdf', {
      type: 'application/pdf',
    }),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Extract with AI' }),
  );
  expect(await screen.findByDisplayValue('Example Labs')).toBeVisible();
  expect(screen.getByLabelText('Recruitment agency')).toHaveValue(
    'Example Talent Agency',
  );
  expect(screen.getByLabelText('Location')).toHaveValue('Example City');
  expect(screen.getByLabelText('Employment type')).toHaveValue('Full-time');
  expect(screen.getByLabelText('Required skills')).toHaveValue('TypeScript');
  expect(screen.getByLabelText('Original link')).toHaveValue(
    'https://example.com/synthetic-job',
  );
  expect(screen.getByLabelText('Work mode')).toHaveValue('');
  expect(screen.getByLabelText('Salary')).toHaveValue('');
  expect(screen.getByLabelText('Seniority')).toHaveValue('');
  expect(
    screen.getByRole('button', { name: 'Confirm and save job' }),
  ).toBeDisabled();
  expect(screen.getByText('JD document: Hybrid')).toBeVisible();
  expect(screen.getByText('Recruitment post: Remote')).toBeVisible();
  fireEvent.change(screen.getByLabelText(/Job title/), {
    target: { value: '[Synthetic verification] Synthetic Backend Engineer' },
  });
  fireEvent.change(screen.getByLabelText('Recruiter / contact notes'), {
    target: { value: 'Alex Example, synthetic.recruiter@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Work mode'), {
    target: { value: 'Hybrid' },
  });
  await userEvent.click(
    screen.getByRole('checkbox', {
      name: 'I reviewed the conflict for Work mode',
    }),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm and save job' }),
  );
  await screen.findByRole('heading', { name: 'Job overview' });
  const savedRequest = fetch.mock.calls.find(
    ([url, init]) => url === '/api/v1/opportunities' && init?.method === 'POST',
  )![1]!;
  const body = savedRequest.body;
  const saved =
    typeof body === 'string'
      ? JSON.parse(body)
      : JSON.parse((body as FormData).get('record') as string);
  expect(saved).toMatchObject({
    title: '[Synthetic verification] Synthetic Backend Engineer',
    company: 'Example Labs',
    workMode: 'Hybrid',
    salary: '',
    seniority: '',
    contactNotes: 'Alex Example, synthetic.recruiter@example.com',
    postText: result.postText,
  });
  expect(
    saved.importReview.find(
      (field: { field: string }) => field.field === 'workMode',
    ).reviewed,
  ).toBe(true);
  expect(
    fetch.mock.calls.filter(([url]) => url.endsWith('/extract')),
  ).toHaveLength(1);
});

test('an actionable DOCX parsing failure retains post and manual fields but rejects the file', async () => {
  const parseMessage =
    'The DOCX archive is damaged or has an unsupported ZIP layout. Open it in Word or LibreOffice and Save As a new .docx, or paste the JD text.';
  const fetch = vi.fn(async () =>
    Response.json(
      {
        statusCode: 400,
        errorCode: 'PARSING_FAILED',
        parserReason: 'ZIP_INVALID',
        message: parseMessage,
      },
      { status: 400 },
    ),
  );
  vi.stubGlobal('fetch', fetch);
  mount();
  fireEvent.change(screen.getByLabelText('Recruitment post'), {
    target: { value: post },
  });
  fireEvent.change(screen.getByLabelText(/Job title/), {
    target: { value: 'Synthetic manual title' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Upload JD/ }));
  await userEvent.upload(
    screen.getByLabelText('Upload JD document (PDF or DOCX)'),
    new File(['synthetic corrupted docx'], 'retained-synthetic.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  );
  await screen.findByText(/The DOCX archive is damaged/);
  expect(screen.queryByText('retained-synthetic.docx')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Paste JD/ }));
  expect(screen.getByLabelText('Recruitment post')).toHaveValue(post);
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue to Review & Save' }),
  );
  expect(screen.getByLabelText(/Job title/)).toHaveValue(
    'Synthetic manual title',
  );
  expect(
    screen.getByRole('button', { name: 'Confirm and save job' }),
  ).toBeEnabled();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('complete synthetic extraction populates new review fields and corrections survive save/read/edit', async () => {
  const result = (
    await import('./fixtures/smart-import-complete.synthetic.json')
  ).default as ImportPreview;
  const fetch = mock(result);
  const view = mount();
  fireEvent.change(screen.getByLabelText('Recruitment post'), {
    target: { value: result.postText },
  });
  fireEvent.click(screen.getByRole('button', { name: /Upload JD/ }));
  await userEvent.upload(
    screen.getByLabelText('Upload JD document (PDF or DOCX)'),
    new File(['synthetic-only docx'], 'synthetic-vietnamese.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Extract with AI' }),
  );
  await screen.findByDisplayValue('AI Developer');
  expect(screen.getByLabelText('Company')).toHaveValue('Tinh Vân');
  expect(screen.getByLabelText('Location')).toHaveValue('Quận 7, TP.HCM');
  expect(screen.getByLabelText('Work mode')).toHaveValue('Onsite');
  expect(screen.getByLabelText('Experience')).toHaveValue('Minimum 3 years');
  expect(screen.getByLabelText('Preferred skills')).toHaveValue(
    'Backend Java\nVoicebot',
  );
  expect(screen.getByLabelText('Domain')).toHaveValue('Insurance');
  expect(screen.getByLabelText('Salary')).toHaveValue('23M-25M gross');
  expect(screen.getByLabelText('Required skills')).toHaveValue(
    'AI application development\nPython\nAI/ML',
  );
  expect(screen.getByLabelText('Required skills')).not.toHaveValue(
    expect.stringContaining('Java'),
  );
  fireEvent.change(screen.getByLabelText('Experience'), {
    target: { value: 'Minimum 4 years (reviewed)' },
  });
  fireEvent.change(screen.getByLabelText('Preferred skills'), {
    target: { value: 'Backend Java\nVoicebot\nManual preference' },
  });
  fireEvent.change(screen.getByLabelText('Domain'), {
    target: { value: 'Insurance (reviewed)' },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm and save job' }),
  );
  await screen.findByRole('heading', { name: 'Job overview' });
  expect(screen.getByLabelText('Experience')).toHaveValue(
    'Minimum 4 years (reviewed)',
  );
  view.unmount();
  render(
    <MemoryRouter initialEntries={[`/jobs/${id}`]}>
      <Routes>
        <Route path="/jobs/:id/*" element={<JobEditor />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByDisplayValue('Minimum 4 years (reviewed)');
  expect(screen.getByLabelText('Preferred skills')).toHaveValue(
    'Backend Java\nVoicebot\nManual preference',
  );
  expect(screen.getByLabelText('Domain')).toHaveValue('Insurance (reviewed)');
  expect(
    fetch.mock.calls.filter(([url]) => url.endsWith('/extract')),
  ).toHaveLength(1);
});
test('extraction keeps manual field edits, description and tracking information', async () => {
  const result = (
    await import('./fixtures/smart-import-complete.synthetic.json')
  ).default as ImportPreview;
  mock(result);
  mount();
  fireEvent.change(screen.getByLabelText('Recruitment post'), {
    target: { value: result.postText },
  });
  fireEvent.change(screen.getByLabelText(/Job title/), {
    target: { value: 'Manual corrected title' },
  });
  fireEvent.change(screen.getByLabelText('Domain'), {
    target: { value: 'Manual domain' },
  });
  fireEvent.change(screen.getByLabelText('Job description'), {
    target: { value: 'Manual description' },
  });
  fireEvent.change(screen.getByLabelText('Next follow-up date'), {
    target: { value: '2026-11-02' },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Extract with AI' }),
  );
  await screen.findByDisplayValue('Tinh Vân');
  expect(screen.getByLabelText(/Job title/)).toHaveValue(
    'Manual corrected title',
  );
  expect(screen.getByLabelText('Domain')).toHaveValue('Manual domain');
  expect(screen.getByLabelText('Job description')).toHaveValue(
    'Manual description',
  );
  expect(screen.getByLabelText('Next follow-up date')).toHaveValue(
    '2026-11-02',
  );
});

test('a saved manually cleared field stays empty in manual Edit JD', async () => {
  const result = (
    await import('./fixtures/smart-import-complete.synthetic.json')
  ).default as ImportPreview;
  const row = {
    ...emptyOpportunity(),
    ...Object.fromEntries(result.fields.map((f) => [f.field, f.value])),
    id,
    company: '',
    postText: result.postText,
    importReview: result.fields,
    jdText: result.jdText,
    documentName: null,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(url.endsWith('/extract') ? result : row),
    ),
  );
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(
    <MemoryRouter initialEntries={[`/jobs/${id}`]}>
      <Routes>
        <Route path="/jobs/:id/*" element={<JobEditor />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByDisplayValue('AI Developer');
  fireEvent.click(screen.getByRole('link', { name: 'Edit JD' }));
  expect(screen.getByLabelText('Company')).toHaveValue('');
  expect(
    screen.queryByRole('button', { name: 'Extract with AI' }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText('Company')).toHaveValue('');
});

test('all contact methods display, save and reload for manual Edit JD', async () => {
  const contacts = 'recruiter@example.com\nZalo: 0900 123 456';
  const result = preview({
    title: 'Synthetic contact preservation',
    contactNotes: contacts,
  });
  mock(result);
  const view = mount();
  fireEvent.change(screen.getByLabelText('Recruitment post'), {
    target: { value: 'Email: recruiter@example.com\nZalo: 0900 123 456' },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Extract with AI' }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Recruiter / contact notes')).toHaveValue(
      contacts,
    ),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm and save job' }),
  );
  await screen.findByRole('heading', { name: 'Job overview' });
  expect(screen.getByLabelText('Recruiter / contact notes')).toHaveValue(
    contacts,
  );
  view.unmount();
  render(
    <MemoryRouter initialEntries={[`/jobs/${id}`]}>
      <Routes>
        <Route path="/jobs/:id/*" element={<JobEditor />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Recruiter / contact notes')).toHaveValue(
      contacts,
    ),
  );
  fireEvent.click(screen.getByRole('link', { name: 'Edit JD' }));
  const manual = 'Manual contact correction\n' + contacts;
  fireEvent.change(screen.getByLabelText('Recruiter / contact notes'), {
    target: { value: manual },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByText('Changes saved');
  expect(screen.getByLabelText('Recruiter / contact notes')).toHaveValue(
    manual,
  );
});

test('JD office contacts stay in parsed source text while filtered recruiter suggestions respect manual edits', async () => {
  const contacts = 'recruiter@example.com\nZalo: 0900 123 456';
  const jd = 'Office phone: 028 1234 5678\nFax: 028 1234 5679';
  const result = preview(
    { title: 'Synthetic contact attribution', contactNotes: contacts },
    { jd },
  );
  result.fields.find((field) => field.field === 'contactNotes')!.candidates =
    contacts.split('\n').map((value) => ({
      field: 'contactNotes',
      value,
      source: 'post',
      quote: value,
    }));
  mock(result);
  mount();
  fireEvent.change(screen.getByLabelText('Recruitment post'), {
    target: { value: 'Email: recruiter@example.com\nZalo: 0900 123 456' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Upload JD/ }));
  await userEvent.upload(
    screen.getByLabelText('Upload JD document (PDF or DOCX)'),
    new File(['synthetic office-contact fixture'], 'synthetic-contacts.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Extract with AI' }),
    ).toBeEnabled(),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Extract with AI' }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Recruiter / contact notes')).toHaveValue(
      contacts,
    ),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Back to Import sources' }),
  );
  expect(screen.getByLabelText('Source JD text (read-only)')).toHaveValue(jd);
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue to Review & Save' }),
  );
  const manual = 'Manually corrected recruiter: 0900 555 444';
  fireEvent.change(screen.getByLabelText('Recruiter / contact notes'), {
    target: { value: manual },
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const back = screen.queryByRole('button', { name: 'Back to Import sources' });
  if (back) fireEvent.click(back);
  await userEvent.click(
    screen.getByRole('button', { name: 'Extract with AI' }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Recruiter / contact notes')).toHaveValue(
      manual,
    ),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm and save job' }),
  );
  await screen.findByRole('heading', { name: 'Job overview' });
  expect(screen.getByLabelText('Recruiter / contact notes')).toHaveValue(
    manual,
  );
});

test('manual URL survives extraction, save and reopen without fetching the URL', async () => {
  const fetch = mock(
    preview({
      title: 'Synthetic backend role',
      originalLink: 'https://example.com/model-link',
    }),
  );
  mount();
  const url = 'https://www.itviec.com/it-jobs/synthetic-role?utm_source=manual';
  fireEvent.click(screen.getByRole('button', { name: /Job URL/ }));
  fireEvent.change(screen.getByLabelText('Original Job URL (optional)'), {
    target: { value: url },
  });
  expect(screen.getByText(/Platform: ITviec/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /Paste JD/ }));
  fireEvent.change(screen.getByLabelText('Recruitment post'), {
    target: { value: post },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Extract with AI' }),
  );
  await screen.findByDisplayValue('Synthetic backend role');
  expect(screen.getByLabelText('Original link')).toHaveValue(url);
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm and save job' }),
  );
  await screen.findByRole('heading', { name: 'Job overview' });
  expect(
    screen.getByRole('link', { name: 'Open original job' }),
  ).toHaveAttribute('href', url);
  expect(screen.getByLabelText('Original link')).toHaveValue(url);
  expect(
    fetch.mock.calls.every(([request]) => request.startsWith('/api/v1/')),
  ).toBe(true);
});

test('invalid job URL blocks save with actionable feedback and retains inputs', async () => {
  const fetch = mock(preview({}));
  mount();
  fireEvent.click(screen.getByRole('button', { name: /Job URL/ }));
  fireEvent.change(screen.getByLabelText('Original Job URL (optional)'), {
    target: { value: 'javascript:alert(1)' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue to Review & Save' }),
  );
  fireEvent.change(screen.getByLabelText(/Job title/), {
    target: { value: 'Synthetic role' },
  });
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm and save job' }),
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Enter a full HTTP(S) job URL',
  );
  expect(screen.getByLabelText('Original link')).toHaveValue(
    'javascript:alert(1)',
  );
  expect(fetch).not.toHaveBeenCalled();
});

test.each(['failed', 'pending', 'valid'])(
  'upload %s cannot leak into Paste JD extraction or save',
  async (state) => {
    let release!: (response: Response) => void;
    const result = preview({ title: 'Paste recovery' });
    const fetch = mock(result);
    const normal = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (url, init) => {
      if (url.endsWith('/parse-document')) {
        if (state === 'pending')
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        if (state === 'failed')
          return Response.json(
            { message: 'Cannot parse synthetic document' },
            { status: 400 },
          );
      }
      return normal(url, init);
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Upload JD/ }));
    await userEvent.upload(
      screen.getByLabelText('Upload JD document (PDF or DOCX)'),
      new File(['synthetic'], 'recovery.pdf', { type: 'application/pdf' }),
    );
    if (state === 'failed') {
      await screen.findByText(/Cannot parse synthetic document/);
      expect(screen.queryByText('recovery.pdf')).not.toBeInTheDocument();
    }
    if (state === 'valid') await screen.findByText('recovery.pdf');
    expect(screen.getByRole('button', { name: /^Paste JD/ })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: /^Paste JD/ }));
    expect(screen.getByRole('button', { name: /^Paste JD/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    if (state === 'pending')
      release(Response.json({ text: 'Stale document', warnings: [] }));
    fireEvent.change(screen.getByLabelText('Recruitment post'), {
      target: { value: post },
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'Extract with AI' }),
    );
    await screen.findByDisplayValue('Paste recovery');
    const extracted = fetch.mock.calls.find(([url]) =>
      url.endsWith('/extract'),
    )![1]!.body as FormData;
    expect(extracted.get('document')).toBeNull();
    expect(JSON.parse(extracted.get('record') as string)).toEqual({
      postText: post,
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirm and save job' }),
    );
    await screen.findByRole('heading', { name: 'Job overview' });
    const saved = fetch.mock.calls.find(
      ([url, init]) =>
        url === '/api/v1/opportunities' && init?.method === 'POST',
    )![1]!.body;
    expect(typeof saved).toBe('string');
    expect(JSON.parse(saved as string)).toMatchObject({
      title: 'Paste recovery',
      postText: post,
    });
  },
);
