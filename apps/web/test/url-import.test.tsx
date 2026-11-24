import { expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from './render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { setLocale } from '../src/app/i18n';
import { JobEditor } from '../src/features/inbox/JobEditor';
import {
  emptyOpportunity,
  jobUrlInfo,
} from '../src/features/inbox/opportunities-api';
import {
  applyUrlJobPreview,
  canFetchJobUrl,
  type UrlJobPreview,
} from '../src/features/inbox/job-url-import';

// The link card is always shown; returning to it closes the open alternative.
function showLinkImport() {
  const open = screen
    .queryAllByRole('button', { pressed: true })
    .find((button) => /^(Paste JD|Upload JD)/.test(button.textContent ?? ''));
  if (open) fireEvent.click(open);
}
const preview: UrlJobPreview = {
  title: 'Synthetic backend engineer',
  company: 'Synthetic company',
  location: 'HCMC',
  originalLink: 'https://www.topcv.vn/viec-lam/synthetic',
  platform: 'TopCV',
  description: 'Build Java services',
  sourceText: 'Job title: Synthetic backend engineer\nBuild Java services',
  validThrough: null,
  expired: false,
};
test('fixture import populates editable fields and provides text for existing extraction', () => {
  const form = applyUrlJobPreview(emptyOpportunity(), preview, new Set());
  expect(form).toMatchObject({
    title: preview.title,
    company: preview.company,
    description: preview.description,
    originalLink: preview.originalLink,
    postText: preview.sourceText,
    source: 'Website',
  });
  expect(jobUrlInfo(form.originalLink).platform).toBe('TopCV');
});
test('preserves user fields, contacts, tracker and original sources, including intentional blanks', () => {
  const form = {
    ...emptyOpportunity(),
    title: 'User title',
    contactNotes: 'User contact',
    notes: 'User notes',
    postText: 'Original post',
    status: 'INTERVIEW' as const,
    contactDates: ['2026-10-30'],
  };
  const next = applyUrlJobPreview(form, preview, new Set(['company']));
  expect(next).toMatchObject({
    title: form.title,
    company: '',
    contactNotes: form.contactNotes,
    notes: form.notes,
    status: 'INTERVIEW',
    contactDates: form.contactDates,
  });
  expect(next.postText).toBe(`Original post\n\n${preview.sourceText}`);
});
test('rejects oversized combined sources without mutating existing inputs', () => {
  const form = { ...emptyOpportunity(), postText: 'x'.repeat(12000) };
  const before = structuredClone(form);
  expect(() => applyUrlJobPreview(form, preview, new Set())).toThrow(
    'paste limit',
  );
  expect(form).toEqual(before);
});
test('fetch enables only for single-job URLs on supported sites, never on paste', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(
    <MemoryRouter>
      <JobEditor />
    </MemoryRouter>,
  );
  const button = screen.getByRole('button', { name: 'Fetch JD' });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Original Job URL (optional)'), {
    target: { value: 'https://itviec.com/it-jobs/synthetic' },
  });
  expect(button).toBeEnabled();
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Original Job URL (optional)'), {
    target: { value: preview.originalLink },
  });
  expect(button).toBeDisabled();
  // Sources arrive asynchronously from the server (stubbed in setup).
  expect(
    await screen.findByText(
      /single job posting on ITviec, TopCV, VietnamWorks/,
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /Paste JD/ }));
  expect(screen.getByLabelText('Recruitment post')).toBeEnabled();
});
test.each([
  'https://itviec.com/it-jobs/a',
  'https://www.topcv.vn/viec-lam/brand-manager/2353489.html?ta_source=x',
  'https://www.vietnamworks.com/business-development-staff-2130695-jv',
])('supported single-job URLs enable fetch: %s', (value) => {
  expect(canFetchJobUrl(value)).toBe(true);
});
test.each([
  'https://www.topcv.vn/tim-viec-lam-it',
  'https://www.vietnamworks.com/viec-lam?q=marketing',
  'https://topcv.vn.evil.example/viec-lam/a/1.html',
  'https://itviec.com.evil.example/it-jobs/a',
  'http://itviec.com/it-jobs/a',
  'https://itviec.com:3000/it-jobs/a',
  'https://user:password@itviec.com/it-jobs/a',
  'https://itviec.com/customer',
  'invalid',
])('unsupported URLs cannot enable fetch: %s', (value) => {
  expect(canFetchJobUrl(value)).toBe(false);
});
test('click imports fixture content into review, preserves edits, warns about expiry, and saves original URL', async () => {
  const link = 'https://itviec.com/it-jobs/synthetic';
  const result = {
    ...preview,
    originalLink: link,
    platform: 'ITviec',
    expired: true,
  };
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.includes('/duplicate-url?')) return Response.json({ match: null });
    if (path.endsWith('/import-url')) return Response.json(result);
    return Response.json({
      ...JSON.parse(init?.body as string),
      id: 'synthetic',
    });
  });
  vi.stubGlobal('fetch', fetch);
  render(
    <MemoryRouter>
      <JobEditor />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText('Original Job URL (optional)'), {
    target: { value: link },
  });
  fireEvent.change(screen.getByLabelText(/Job title/), {
    target: { value: 'My edited title' },
  });
  fireEvent.change(screen.getByLabelText('Recruiter / contact notes'), {
    target: { value: 'My contact' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Fetch JD' }));
  expect(await screen.findByText(/This listing is expired/)).toBeVisible();
  expect(screen.getByLabelText(/Job title/)).toHaveValue('My edited title');
  expect(screen.getByLabelText('Company')).toHaveValue(result.company);
  expect(screen.getByLabelText('Location')).toHaveValue(result.location);
  expect(screen.getByLabelText('Job description')).toHaveValue(
    result.description,
  );
  fireEvent.click(screen.getByRole('button', { name: /Paste JD/ }));
  expect(screen.getByLabelText('Recruitment post')).toHaveValue(
    result.sourceText,
  );
  expect(screen.getByRole('button', { name: 'Extract with AI' })).toBeEnabled();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({
    url: link,
  });
  if (screen.queryByRole('button', { name: 'Continue to Review & Save' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Continue to Review & Save' }),
    );
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm and save job' }),
  );
  const saveCalls = () =>
    fetch.mock.calls.filter(([path]) => path === '/api/v1/opportunities');
  await waitFor(() => expect(saveCalls()).toHaveLength(1));
  expect(JSON.parse(saveCalls()[0]![1]!.body as string)).toMatchObject({
    originalLink: link,
    company: result.company,
    title: 'My edited title',
    contactNotes: 'My contact',
    postText: result.sourceText,
  });
});
test('busy fetch prevents overlap and blocked response preserves manual inputs', async () => {
  let release!: (response: Response) => void;
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetch);
  render(
    <MemoryRouter>
      <JobEditor />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText('Original Job URL (optional)'), {
    target: { value: 'https://itviec.com/it-jobs/synthetic' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Paste JD/ }));
  fireEvent.change(screen.getByLabelText('Recruitment post'), {
    target: { value: 'Original post' },
  });
  showLinkImport();
  const button = screen.getByRole('button', { name: 'Fetch JD' });
  await userEvent.click(button);
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(fetch).toHaveBeenCalledTimes(1);
  release(
    Response.json(
      {
        errorCode: 'URL_IMPORT_BLOCKED',
        message: 'The job site blocked automated access.',
      },
      { status: 400 },
    ),
  );
  const alert = (
    await screen.findByText(/Could not load the job posting from ITviec/)
  ).closest('[role="alert"]') as HTMLElement;
  expect(alert).toBeVisible();
  expect(screen.queryByText(/blocked automated access/)).toBeNull();
  // Blocks are not retried: only open-source and paste actions are offered.
  expect(within(alert).queryByRole('button', { name: 'Try again' })).toBeNull();
  expect(
    within(alert).getByRole('link', { name: 'Open job posting' }),
  ).toHaveAttribute('href', 'https://itviec.com/it-jobs/synthetic');
  fireEvent.click(within(alert).getByRole('button', { name: 'Paste JD' }));
  expect(screen.getByLabelText('Original Job URL (optional)')).toHaveValue(
    'https://itviec.com/it-jobs/synthetic',
  );
  expect(screen.getByLabelText('Recruitment post')).toHaveValue(
    'Original post',
  );
  showLinkImport();
  expect(screen.getByRole('button', { name: 'Fetch JD' })).toBeEnabled();
});

test('repeat preview replaces tracked source without duplication; replacement preserves manual fields and separate text', () => {
  const original = { ...emptyOpportunity(), postText: 'Separate post' };
  const first = applyUrlJobPreview(original, preview, new Set());
  expect(applyUrlJobPreview(first, preview, new Set(), preview)).toEqual(first);
  const second = {
    ...preview,
    title: 'Job B',
    company: 'Company B',
    description: 'Description B',
    sourceText: 'Source B',
    originalLink: 'https://itviec.com/it-jobs/b',
  };
  const next = applyUrlJobPreview(
    { ...first, title: 'Manual title' },
    second,
    new Set(['title']),
    preview,
  );
  expect(next).toMatchObject({
    title: 'Manual title',
    company: 'Company B',
    description: 'Description B',
    postText: 'Separate post\n\nSource B',
    originalLink: second.originalLink,
  });
  expect(() =>
    applyUrlJobPreview(
      { ...first, postText: 'Manually rewritten source' },
      second,
      new Set(),
      preview,
    ),
  ).toThrow('source text was edited');
});

test('failed fetch retains draft and retry is idempotent; different URL requires replacement approval', async () => {
  const first = {
    ...preview,
    domain: 'IT Services and IT Consulting',
    originalLink: 'https://itviec.com/it-jobs/a',
  };
  const second = {
    ...first,
    title: 'Job B',
    domain: 'Banking; Financial Services',
    description: 'Description B',
    sourceText: 'Source B',
    originalLink: 'https://itviec.com/it-jobs/b',
  };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json(first))
    .mockResolvedValueOnce(
      Response.json({ message: 'Retry fetch' }, { status: 400 }),
    )
    .mockResolvedValueOnce(Response.json(first))
    .mockResolvedValueOnce(Response.json(second));
  vi.stubGlobal('fetch', fetch);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(
    <MemoryRouter>
      <JobEditor />
    </MemoryRouter>,
  );
  const url = screen.getByLabelText('Original Job URL (optional)');
  const run = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Fetch JD' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Fetch JD' })).toBeEnabled(),
    );
  };
  fireEvent.change(url, { target: { value: first.originalLink } });
  await run();
  expect(screen.getByLabelText('Domain')).toHaveValue(first.domain);
  fireEvent.change(screen.getByLabelText('Domain'), {
    target: { value: 'Manual domain' },
  });
  await run();
  expect(screen.getByLabelText('Job description')).toHaveValue(
    first.description,
  );
  await run();
  fireEvent.change(url, { target: { value: second.originalLink } });
  await run();
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(screen.getByLabelText('Domain')).toHaveValue('Manual domain');
  confirm.mockReturnValue(true);
  await run();
  expect(screen.getByLabelText('Domain')).toHaveValue('Manual domain');
  expect(screen.getByLabelText('Job description')).toHaveValue(
    second.description,
  );
  fireEvent.click(screen.getByRole('button', { name: /Paste JD/ }));
  expect(screen.getByLabelText('Recruitment post')).toHaveValue('Source B');
});

test.each(['method', 'url'])(
  'late URL response is ignored after changing %s',
  async (target) => {
    let release!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );
    render(
      <MemoryRouter>
        <JobEditor />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Original Job URL (optional)'), {
      target: { value: 'https://itviec.com/it-jobs/a' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Fetch JD' }));
    if (target === 'method') {
      expect(screen.getByRole('button', { name: /Paste JD/ })).toBeEnabled();
      await userEvent.click(screen.getByRole('button', { name: /Paste JD/ }));
    } else
      fireEvent.change(screen.getByLabelText('Original Job URL (optional)'), {
        target: { value: 'https://itviec.com/it-jobs/b' },
      });
    fireEvent.change(screen.getByLabelText(/Job title/), {
      target: { value: 'Manual while pending' },
    });
    await act(async () => release(Response.json(preview)));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Extract with AI' }),
      ).toBeDisabled(),
    );
    expect(screen.getByLabelText(/Job title/)).toHaveValue(
      'Manual while pending',
    );
    expect(screen.getByLabelText('Job description')).toHaveValue('');
  },
);

test('successful pending fetch preserves edits made after the request began', async () => {
  let release!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    ),
  );
  render(
    <MemoryRouter>
      <JobEditor />
    </MemoryRouter>,
  );
  const originalLink = 'https://itviec.com/it-jobs/a';
  fireEvent.change(screen.getByLabelText('Original Job URL (optional)'), {
    target: { value: originalLink },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Fetch JD' }));
  fireEvent.change(screen.getByLabelText(/Job title/), {
    target: { value: 'Title edited while fetching' },
  });
  fireEvent.change(screen.getByLabelText('Job description'), {
    target: { value: 'Description edited while fetching' },
  });
  fireEvent.change(screen.getByLabelText('Recruiter / contact notes'), {
    target: { value: 'Contact edited while fetching' },
  });
  await act(async () => release(Response.json({ ...preview, originalLink })));
  expect(screen.getByLabelText(/Job title/)).toHaveValue(
    'Title edited while fetching',
  );
  expect(screen.getByLabelText('Job description')).toHaveValue(
    'Description edited while fetching',
  );
  expect(screen.getByLabelText('Recruiter / contact notes')).toHaveValue(
    'Contact edited while fetching',
  );
  expect(screen.getByLabelText('Company')).toHaveValue(preview.company);
});

// Isolate source-import requests from the separately tested duplicate lookup timer.
vi.mock('../src/features/inbox/DuplicateJobNotice', () => ({
  DuplicateJobNotice: () => null,
}));

test('domain taxonomy maps atomically, protects manual edits and clears obsolete source domains', () => {
  const domain =
    'Media, Advertising and Entertainment; IT Services and IT Consulting';
  const first = {
    ...preview,
    domain,
    sourceMetadata: {
      skills: ['Java'],
      jobExpertise: ['Architect'],
      jobDomains: domain.split('; '),
    },
  };
  const form = applyUrlJobPreview(emptyOpportunity(), first, new Set());
  expect(form.domain).toBe(domain);
  expect(form.skills).toBe('');
  expect(form.preferredSkills).toBe('');
  expect(form).not.toHaveProperty('sourceMetadata');
  const same = { ...first, domain: 'Banking', sourceText: 'Updated source' };
  expect(applyUrlJobPreview(form, same, new Set(), first).domain).toBe(
    'Banking',
  );
  for (const manual of ['Manual domain', ''])
    expect(
      applyUrlJobPreview(
        { ...form, domain: manual },
        same,
        new Set(['domain']),
        first,
      ).domain,
    ).toBe(manual);
  const replacement = {
    ...preview,
    originalLink: 'https://itviec.com/it-jobs/other',
  };
  expect(applyUrlJobPreview(form, replacement, new Set(), first).domain).toBe(
    '',
  );
});

test('a source turned off on the server shows localised bookmark/paste guidance and keeps the form', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(
        {
          errorCode: 'URL_IMPORT_SOURCE_OFF',
          message:
            'TopCV link import is turned off on this server. Use the page-import bookmark or paste the JD.',
        },
        { status: 403 },
      ),
    ),
  );
  render(
    <MemoryRouter>
      <JobEditor />
    </MemoryRouter>,
  );
  const link = 'https://www.topcv.vn/viec-lam/synthetic-brand-manager/1.html';
  fireEvent.change(screen.getByLabelText('Original Job URL (optional)'), {
    target: { value: link },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Fetch JD' }));
  expect(
    (await screen.findAllByText(/TopCV link import is turned off/))[0],
  ).toBeVisible();
  expect(screen.getByLabelText('Original Job URL (optional)')).toHaveValue(
    link,
  );
});

test('parser suggestions fill blank fields only; structured values, edits and domain are kept', () => {
  const next = applyUrlJobPreview(
    { ...emptyOpportunity(), seniority: 'User level' },
    {
      ...preview,
      experience: 'Minimum 3 years',
      fields: [
        ['title', 'Shortened title'],
        ['skills', 'Từ 3 năm kinh nghiệm Marketing\nCó Portfolio'],
        ['preferredSkills', 'Biết tiếng Nhật'],
        ['seniority', 'Parser level'],
        ['domain', 'Ngân hàng'],
        ['experience', 'Parser experience'],
      ].map(([field, value]) => ({
        field: field as 'title',
        value: value!,
        status: 'SUPPORTED' as const,
        reviewed: false,
        candidates: [],
      })),
    },
    new Set(['seniority']),
  );
  expect(next).toMatchObject({
    title: preview.title,
    experience: 'Minimum 3 years',
    skills: 'Từ 3 năm kinh nghiệm Marketing\nCó Portfolio',
    preferredSkills: 'Biết tiếng Nhật',
    seniority: 'User level',
    domain: '',
    postText: preview.sourceText,
  });
});
test('Continue to Review stays disabled without JD content, even with a URL', () => {
  vi.stubGlobal('fetch', vi.fn());
  render(
    <MemoryRouter>
      <JobEditor />
    </MemoryRouter>,
  );
  const next = () =>
    screen.getByRole('button', { name: 'Continue to Review & Save' });
  expect(next()).toBeDisabled();
  expect(screen.getByText(/Add the JD first/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('Original Job URL (optional)'), {
    target: { value: 'https://itviec.com/it-jobs/synthetic' },
  });
  expect(next()).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: /Paste JD/ }));
  fireEvent.change(screen.getByLabelText('Recruitment post'), {
    target: { value: '   ' },
  });
  expect(next()).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Recruitment post'), {
    target: { value: 'Synthetic JD' },
  });
  expect(next()).toBeEnabled();
  expect(screen.queryByText(/Add the JD first/)).not.toBeInTheDocument();
});

const failFetch = (body: Record<string, string>, status = 400) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(body, { status })),
  );
test('blocked fetch shows one localised inline error in Vietnamese', async () => {
  setLocale('vi-VN');
  failFetch({ errorCode: 'URL_IMPORT_BLOCKED', message: 'raw english' });
  render(
    <MemoryRouter>
      <JobEditor />
    </MemoryRouter>,
  );
  const link = 'https://www.topcv.vn/viec-lam/synthetic-brand-manager/1.html';
  fireEvent.change(screen.getByLabelText('URL việc làm gốc (tùy chọn)'), {
    target: { value: link },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Tải JD' }));
  const text =
    'Không thể tự động tải nội dung tuyển dụng từ TopCV. Bạn vẫn có thể sao chép và dán nội dung để tiếp tục.';
  expect(await screen.findAllByText(new RegExp(text))).toHaveLength(1);
  expect(screen.queryByText(/raw english/)).toBeNull();
  expect(
    screen.getByRole('link', { name: 'Mở tin tuyển dụng' }),
  ).toHaveAttribute('href', link);
  expect(screen.queryByText('Đề xuất')).toBeNull();
  // Editing the URL to anything unsupported removes the external link.
  for (const unsafe of [
    'javascript:alert(1)',
    'http://www.topcv.vn/viec-lam/x/1.html',
    'https://evil.example/viec-lam/x/1.html',
    'https://user:pw@www.topcv.vn/viec-lam/x/1.html',
  ]) {
    fireEvent.change(screen.getByLabelText('URL việc làm gốc (tùy chọn)'), {
      target: { value: unsafe },
    });
    expect(
      screen.queryByRole('link', { name: 'Mở tin tuyển dụng' }),
    ).toBeNull();
  }
});
test.each([
  ['URL_IMPORT_TIMEOUT', true],
  ['URL_IMPORT_UNAVAILABLE', true],
  ['URL_IMPORT_NOT_FOUND', false],
  ['URL_IMPORT_SOMETHING_NEW', false],
])('%s offers manual retry: %s', async (errorCode, retry) => {
  failFetch({ errorCode, message: 'raw english' });
  render(
    <MemoryRouter>
      <JobEditor />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText('Original Job URL (optional)'), {
    target: { value: 'https://itviec.com/it-jobs/synthetic' },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Fetch JD' }));
  await screen.findByRole('link', { name: 'Open job posting' });
  expect(screen.queryByText(/raw english/)).toBeNull();
  const again = screen.queryByRole('button', { name: 'Try again' });
  expect(Boolean(again)).toBe(retry);
  if (again) {
    await userEvent.click(again);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  }
});
