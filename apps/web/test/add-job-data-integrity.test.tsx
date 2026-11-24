import { expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from './render';
import { MemoryRouter } from 'react-router-dom';
import { JobEditor } from '../src/features/inbox/JobEditor';
import { setLocale } from '../src/app/i18n';
import { importFields } from '../src/features/inbox/opportunities-api';
import * as bridge from '../src/features/inbox/topcv-bookmarklet';

vi.mock('../src/features/inbox/DuplicateJobNotice', () => ({
  DuplicateJobNotice: () => null,
}));

// Synthetic fixtures only.
const javaJd =
  'Rakuten FinTech Synthetic\nJava Backend Engineer\nRequired: Java, Spring';
const marketingUrl =
  'https://www.topcv.vn/viec-lam/marketing-executive/123.html';
const marketing = {
  originalLink: marketingUrl,
  platform: 'TopCV',
  title: 'Marketing Executive',
  company: 'GO ON GROUP Synthetic',
  location: 'Ha Noi',
  salary: '12 - 15 triệu',
  description: 'Plan synthetic marketing campaigns',
  sourceText: 'Marketing Executive\nPlan synthetic marketing campaigns',
  expired: false,
  validThrough: null,
};
const otherUrl = 'https://www.topcv.vn/viec-lam/sales-lead/456.html';
const sales = {
  ...marketing,
  originalLink: otherUrl,
  title: 'Sales Lead',
  company: 'Other Synthetic',
  salary: '',
  description: 'Lead synthetic sales',
  sourceText: 'Sales Lead\nLead synthetic sales',
};

type Body = Record<string, unknown>;
// Reads JSON or the multipart `record` part, as the API does.
async function body(init?: RequestInit): Promise<Body> {
  if (init?.body instanceof FormData)
    return JSON.parse(init.body.get('record') as string) as Body;
  return JSON.parse(init?.body as string) as Body;
}
function aiFields(values: Partial<Record<string, string>>) {
  return importFields.map((field) => ({
    field,
    value: values[field] ?? '',
    status: values[field] ? 'SUPPORTED' : 'MISSING',
    candidates: [],
    reviewed: false,
  }));
}
function api(
  overrides: {
    extract?: () => Promise<Response>;
    page?: Record<string, unknown>;
  } = {},
) {
  const extracts: Body[] = [];
  const saves: { body: Body; document: boolean }[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/sources')) return Response.json({ sources: ['TopCV'] });
    if (url.endsWith('/import-url')) {
      const { url: link } = await body(init);
      return Response.json(link === otherUrl ? sales : marketing);
    }
    if (url.endsWith('/import-page'))
      return Response.json(overrides.page ?? marketing);
    if (url.endsWith('/parse-document'))
      return Response.json({ text: 'Parsed synthetic document', warnings: [] });
    if (url.endsWith('/extract')) {
      const record = await body(init);
      extracts.push(record);
      if (overrides.extract) return overrides.extract();
      const java = String(record.postText).includes('Rakuten');
      return Response.json({
        postText: record.postText,
        jdText: '',
        description: java ? 'Java backend description' : 'AI description',
        warnings: [],
        rejected: 0,
        error: null,
        fields: aiFields(
          java
            ? {
                title: 'Java Backend Engineer',
                company: 'Rakuten FinTech Synthetic',
                skills: 'Java, Spring',
              }
            : { title: 'AI title' },
        ),
      });
    }
    if (url === '/api/v1/opportunities' && init?.method === 'POST') {
      saves.push({
        body: await body(init),
        document: init.body instanceof FormData && init.body.has('document'),
      });
      return Response.json({ id: 'synthetic' });
    }
    return Response.json({});
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, extracts, saves };
}
function mount() {
  render(
    <MemoryRouter>
      <JobEditor />
    </MemoryRouter>,
  );
}
const click = (name: string | RegExp) =>
  fireEvent.click(screen.getByRole('button', { name }));
const select = (method: string) => click(new RegExp(`^${method}`));
const paste = (text: string) =>
  fireEvent.change(screen.getByLabelText('Job posting content'), {
    target: { value: text },
  });
async function fetchLink(link: string) {
  fireEvent.change(screen.getByLabelText('Job posting link'), {
    target: { value: link },
  });
  click('Get content');
  await screen.findByText(/loaded from TopCV/);
}
async function saveJob(saves: unknown[]) {
  click('Confirm and save job');
  await waitFor(() => expect(saves).toHaveLength(1));
}

test('Paste → Continue without AI shows and saves the pasted text as the description', async () => {
  const { saves } = api();
  mount();
  select('Paste content');
  paste(javaJd);
  click('Continue without AI');
  expect(screen.getByLabelText('Job description')).toHaveValue(javaJd);
  fireEvent.change(screen.getByLabelText(/Job title/), {
    target: { value: 'Manual title' },
  });
  await saveJob(saves);
  expect(saves[0]!.body).toMatchObject({
    title: 'Manual title',
    description: javaJd,
    postText: javaJd,
    company: '',
  });
});

test('Upload → Continue without AI uses only the parsed document', async () => {
  const { saves } = api();
  mount();
  select('Paste content');
  paste(javaJd);
  select('Upload document');
  fireEvent.change(screen.getByLabelText('Upload JD document (PDF or DOCX)'), {
    target: { files: [new File(['%PDF'], 'synthetic.pdf')] },
  });
  await screen.findByText(/Parsed synthetic document/);
  click('Continue without AI');
  expect(screen.getByLabelText('Job description')).toHaveValue(
    'Parsed synthetic document',
  );
  fireEvent.change(screen.getByLabelText(/Job title/), {
    target: { value: 'Doc title' },
  });
  await saveJob(saves);
  expect(saves[0]).toMatchObject({
    document: true,
    body: { postText: '', description: 'Parsed synthetic document' },
  });
});

test('Link → Continue without AI keeps the fetched metadata without AI', async () => {
  const { saves, extracts } = api();
  mount();
  await fetchLink(marketingUrl);
  click('Continue without AI');
  expect(screen.getByLabelText(/Job title/)).toHaveValue('Marketing Executive');
  await saveJob(saves);
  expect(extracts).toHaveLength(0);
  expect(saves[0]!.body).toMatchObject({
    title: marketing.title,
    company: marketing.company,
    salary: marketing.salary,
    description: marketing.description,
    postText: marketing.sourceText,
    originalLink: marketingUrl,
  });
});

test('Rakuten Java JD + AI, then a TopCV marketing link: no stale company, skills, description or source', async () => {
  const { saves, extracts } = api();
  mount();
  select('Paste content');
  paste(javaJd);
  click('Fill in with AI');
  await screen.findByRole('button', { name: 'Confirm and save job' });
  expect(screen.getByLabelText('Company')).toHaveValue(
    'Rakuten FinTech Synthetic',
  );
  click('Back to Add content');
  select('Paste link');
  await fetchLink(marketingUrl);
  click('Fill in with AI');
  await waitFor(() => expect(extracts).toHaveLength(2));
  // AI only sees the active link source.
  expect(extracts[1]!.postText).toBe(marketing.sourceText);
  await screen.findByRole('button', { name: 'Confirm and save job' });
  await saveJob(saves);
  const saved = saves[0]!.body;
  expect(saved).toMatchObject({
    title: marketing.title,
    company: marketing.company,
    salary: marketing.salary,
    skills: '',
    description: marketing.description,
    postText: marketing.sourceText,
  });
  expect(JSON.stringify(saved)).not.toMatch(/Rakuten|Java/);
});

test('URL A → URL B replaces the job; edits require confirmation', async () => {
  const { saves } = api();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  mount();
  await fetchLink(marketingUrl);
  // No manual edits: the new link replaces silently.
  fireEvent.change(screen.getByLabelText('Job posting link'), {
    target: { value: otherUrl },
  });
  click('Get content');
  await waitFor(() =>
    expect(screen.getByLabelText(/Job title/)).toHaveValue('Sales Lead'),
  );
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Recruiter / contact notes'), {
    target: { value: 'Contact for sales' },
  });
  fireEvent.change(screen.getByLabelText('Job posting link'), {
    target: { value: marketingUrl },
  });
  // A typed but unfetched link never pairs with the previous job's content.
  expect(
    screen.getByRole('button', { name: 'Continue without AI' }),
  ).toBeDisabled();
  click('Get content');
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText(/Job title/)).toHaveValue('Sales Lead');
  confirm.mockReturnValue(true);
  click('Get content');
  await waitFor(() =>
    expect(screen.getByLabelText(/Job title/)).toHaveValue(
      'Marketing Executive',
    ),
  );
  click('Continue without AI');
  await saveJob(saves);
  expect(saves[0]!.body).toMatchObject({
    company: marketing.company,
    contactNotes: '',
    postText: marketing.sourceText,
  });
});

test('switching methods keeps each draft and AI/save use only the active one', async () => {
  const { extracts, saves } = api();
  mount();
  await fetchLink(marketingUrl);
  select('Paste content');
  expect(screen.getByLabelText('Job posting content')).toHaveValue('');
  paste(javaJd);
  select('Upload document');
  expect(
    screen.getByRole('button', { name: 'Continue without AI' }),
  ).toBeDisabled();
  select('Paste link');
  expect(screen.getByLabelText('Job posting link')).toHaveValue(marketingUrl);
  select('Paste content');
  expect(screen.getByLabelText('Job posting content')).toHaveValue(javaJd);
  click('Fill in with AI');
  await screen.findByRole('button', { name: 'Confirm and save job' });
  expect(extracts[0]!.postText).toBe(javaJd);
  await saveJob(saves);
  expect(saves[0]!.body).toMatchObject({
    company: 'Rakuten FinTech Synthetic',
    postText: javaJd,
    originalLink: '',
  });
});

test('editing the pasted source after AI clears stale suggestions but keeps manual edits', async () => {
  const { saves } = api();
  mount();
  select('Paste content');
  paste(javaJd);
  click('Fill in with AI');
  await screen.findByRole('button', { name: 'Confirm and save job' });
  fireEvent.change(screen.getByLabelText('Location'), {
    target: { value: 'Manual location' },
  });
  click('Back to Add content');
  paste('Synthetic replacement JD');
  click('Continue without AI');
  expect(screen.getByLabelText('Company')).toHaveValue('');
  expect(screen.getByLabelText('Location')).toHaveValue('Manual location');
  fireEvent.change(screen.getByLabelText(/Job title/), {
    target: { value: 'New title' },
  });
  await saveJob(saves);
  expect(saves[0]!.body).toMatchObject({
    company: '',
    skills: '',
    location: 'Manual location',
    description: 'Synthetic replacement JD',
    importReview: [],
  });
});

test('a late AI response is dropped after a bookmark import replaces the source', async () => {
  let receive!: (payload: bridge.TopcvPagePayload) => void;
  vi.spyOn(bridge, 'receiveTopcvPage').mockImplementation((_win, consume) => {
    receive = consume;
    return () => {};
  });
  let release!: (response: Response) => void;
  api({
    extract: () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  });
  mount();
  select('Paste content');
  paste(javaJd);
  click('Fill in with AI');
  act(() =>
    receive({
      version: 1,
      sourceUrl: marketingUrl,
      jobPosting: { '@type': 'JobPosting', description: 'Synthetic' },
      visibleText: '',
      salaryText: '',
    }),
  );
  await screen.findByText(/JD loaded from TopCV/);
  await act(async () =>
    release(
      Response.json({
        postText: javaJd,
        jdText: '',
        description: 'Java backend description',
        warnings: [],
        rejected: 0,
        error: null,
        fields: aiFields({ company: 'Rakuten FinTech Synthetic' }),
      }),
    ),
  );
  expect(screen.getByLabelText('Company')).toHaveValue(marketing.company);
  expect(screen.getByLabelText('Job description')).toHaveValue(
    marketing.description,
  );
});

test('a bookmark import for a different job asks before discarding edits', async () => {
  let receive!: (payload: bridge.TopcvPagePayload) => void;
  vi.spyOn(bridge, 'receiveTopcvPage').mockImplementation((_win, consume) => {
    receive = consume;
    return () => {};
  });
  api({ page: sales });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  mount();
  await fetchLink(marketingUrl);
  fireEvent.change(screen.getByLabelText('Company'), {
    target: { value: 'Manual company' },
  });
  act(() =>
    receive({
      version: 1,
      sourceUrl: otherUrl,
      jobPosting: { '@type': 'JobPosting', description: 'Synthetic' },
      visibleText: '',
      salaryText: '',
    }),
  );
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText('Company')).toHaveValue('Manual company');
  expect(screen.getByLabelText(/Job title/)).toHaveValue('Marketing Executive');
});

test('replacing pasted content after editing asks before discarding the edits', async () => {
  const { saves } = api();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  mount();
  select('Paste content');
  paste(javaJd);
  click('Continue without AI');
  fireEvent.change(screen.getByLabelText('Company'), {
    target: { value: 'Rakuten FinTech Synthetic' },
  });
  click('Back to Add content');
  // Same content again: no question.
  click('Continue without AI');
  expect(confirm).not.toHaveBeenCalled();
  click('Back to Add content');
  paste('Different synthetic marketing JD');
  click('Continue without AI');
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Company')).toHaveValue('');
  fireEvent.change(screen.getByLabelText(/Job title/), {
    target: { value: 'Marketing' },
  });
  await saveJob(saves);
  expect(saves[0]!.body).toMatchObject({
    company: '',
    description: 'Different synthetic marketing JD',
    postText: 'Different synthetic marketing JD',
  });
});

test('keeping edits after replacing content is an explicit choice', async () => {
  api();
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  mount();
  select('Paste content');
  paste(javaJd);
  click('Continue without AI');
  fireEvent.change(screen.getByLabelText('Company'), {
    target: { value: 'Kept company' },
  });
  click('Back to Add content');
  paste('Different synthetic JD');
  click('Continue without AI');
  expect(window.confirm).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Company')).toHaveValue('Kept company');
});

test('replacing an uploaded document after editing asks before AI runs', async () => {
  const { extracts } = api();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  mount();
  select('Upload document');
  const upload = (name: string) =>
    fireEvent.change(
      screen.getByLabelText('Upload JD document (PDF or DOCX)'),
      { target: { files: [new File(['%PDF'], name)] } },
    );
  upload('first.pdf');
  await screen.findByText(/Parsed synthetic document/);
  click('Continue without AI');
  fireEvent.change(screen.getByLabelText('Company'), {
    target: { value: 'First company' },
  });
  click('Back to Add content');
  upload('second.pdf');
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Fill in with AI' }),
    ).toBeEnabled(),
  );
  click('Fill in with AI');
  expect(confirm).toHaveBeenCalledTimes(1);
  await screen.findByRole('button', { name: 'Confirm and save job' });
  expect(extracts[0]!.postText).toBe('');
  expect(screen.getByLabelText('Company')).toHaveValue('');
});

test('an unfetched link is never attached to pasted content without an explicit action', async () => {
  const { saves } = api();
  mount();
  fireEvent.change(screen.getByLabelText('Job posting link'), {
    target: { value: marketingUrl },
  });
  select('Paste content');
  expect(screen.getByText(/Link entered earlier:/)).toBeVisible();
  paste(javaJd);
  click('Continue without AI');
  expect(screen.getByLabelText('Original link')).toHaveValue('');
  fireEvent.change(screen.getByLabelText(/Job title/), {
    target: { value: 'Java' },
  });
  await saveJob(saves);
  expect(saves[0]!.body).toMatchObject({ originalLink: '' });
});

test('the Paste JD fallback shows the carried link and lets the user remove it', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/import-url')
        ? Response.json(
            { errorCode: 'URL_IMPORT_BLOCKED', message: 'Blocked' },
            { status: 400 },
          )
        : Response.json({ sources: ['TopCV'] }),
    ),
  );
  mount();
  fireEvent.change(screen.getByLabelText('Job posting link'), {
    target: { value: marketingUrl },
  });
  click('Get content');
  await screen.findByRole('button', { name: 'Paste JD' });
  click('Paste JD');
  expect(screen.getByText(`Original link: ${marketingUrl}`)).toBeVisible();
  click('Remove link');
  expect(screen.queryByText(/Original link:/)).toBeNull();
  expect(screen.getByText(/Link entered earlier:/)).toBeVisible();
});

test.each([
  ['en-US', 'What should you copy?', 'Paste the copied job posting here...'],
  [
    'vi-VN',
    'Nên sao chép những nội dung nào?',
    'Dán nội dung tuyển dụng đã sao chép vào đây...',
  ],
] as const)(
  'paste guidance is shown in %s and stays after pasting',
  (locale, heading, placeholder) => {
    setLocale(locale);
    api();
    mount();
    fireEvent.click(
      screen.getByRole('button', {
        name: locale === 'en-US' ? /^Paste content/ : /^Dán nội dung/,
      }),
    );
    const content = screen.getByRole('textbox', {
      name: locale === 'en-US' ? 'Job posting content' : /Nội dung/,
    });
    expect(content).toHaveAttribute('placeholder', placeholder);
    expect(content).toHaveAttribute('maxlength', '12000');
    fireEvent.change(content, { target: { value: javaJd } });
    expect(screen.getByRole('heading', { name: heading })).toBeVisible();
    expect(
      screen.getByText(
        locale === 'en-US'
          ? 'Salary, location and benefits (if available).'
          : 'Mức lương, địa điểm và quyền lợi (nếu có).',
      ),
    ).toBeVisible();
  },
);
