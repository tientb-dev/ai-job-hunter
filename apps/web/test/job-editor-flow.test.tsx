import { ThemeProvider } from '@mui/material';
import { theme } from '../src/app/theme';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import {
  act,
  closeSuccess,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from './render';
import {
  createMemoryRouter,
  RouterProvider,
  Routes,
  Route,
} from 'react-router-dom';
import { JobEditor, JobEditorForJob } from '../src/features/inbox/JobEditor';
import {
  emptyOpportunity,
  importFields,
} from '../src/features/inbox/opportunities-api';
const wizardMounts = vi.hoisted(() => ({ count: 0 }));
vi.mock('../src/features/inbox/CvMatchPanel', async () => {
  const { useEffect, useState } = await import('react');
  // Stands in for the Tailored CV workflow: local state + mount counter.
  function Wizard({
    jobId,
    revision,
    onReviewDirtyChange,
  }: {
    jobId: string;
    revision: string;
    onReviewDirtyChange?: (dirty: boolean) => void;
  }) {
    const [note, setNote] = useState('');
    useEffect(() => {
      wizardMounts.count++;
    }, []);
    // Only this value counts as an unsaved review edit.
    useEffect(() => {
      onReviewDirtyChange?.(note === 'unsaved review');
    }, [note, onReviewDirtyChange]);
    return (
      <label>
        Tailored wizard {jobId} {revision}
        <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
    );
  }
  return {
    CvMatchPanel: (props: {
      view: string;
      wizard?: boolean;
      jobId: string;
      revision: string;
      onReviewDirtyChange?: (dirty: boolean) => void;
    }) =>
      props.wizard ? <Wizard {...props} /> : <MatchMock view={props.view} />,
  };
});
function MatchMock({ view }: { view: string }) {
  return (
    <>
      <div
        role="tabpanel"
        id="job-panel-1"
        aria-labelledby="job-tab-1"
        hidden={view !== 'match'}
      >
        Saved CV matching workflow
      </div>
      <div
        role="tabpanel"
        id="job-panel-5"
        aria-labelledby="job-tab-5"
        hidden={view !== 'improve'}
      >
        CV improvement workflow
      </div>
    </>
  );
}
vi.mock('../src/features/inbox/JobInterviewTab', () => ({
  JobInterviewTab: ({
    jobDirty,
    hidden,
  }: {
    jobDirty: boolean;
    hidden?: boolean;
  }) => (
    <div
      role="tabpanel"
      id="job-panel-4"
      aria-labelledby="job-tab-4"
      hidden={hidden}
    >
      Interview questions workflow{jobDirty ? ' (unsaved job edits)' : ''}
    </div>
  ),
}));
const id = '00000000-0000-4000-8000-123456789012';
const row = () => ({
  ...emptyOpportunity(),
  id,
  title: 'Synthetic engineer',
  company: 'Example',
  description: 'Synthetic complete JD',
  location: 'HCMC',
  jdText: '',
  documentName: null,
  status: 'SAVED',
});
function mount(path = '/jobs/new') {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <Routes>
            <Route path="/jobs" element={<div>Inbox destination</div>} />
            <Route path="/jobs/new" element={<JobEditor key="new" />} />
            <Route path="/jobs/:id/*" element={<JobEditorForJob />} />
          </Routes>
        ),
      },
    ],
    { initialEntries: ['/jobs', path], initialIndex: 1 },
  );
  const mounted = render(
    <ThemeProvider theme={theme}>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  if (path === '/jobs/new')
    fireEvent.click(screen.getByRole('button', { name: /Paste JD/ }));
  return { ...mounted, router };
}
function mockApi() {
  let saved = row();
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/parse-document'))
      return Response.json({ text: 'Parsed synthetic document', warnings: [] });
    if (url.endsWith('/extract'))
      return Response.json({
        postText: 'Synthetic post',
        jdText: '',
        description: 'Synthetic complete JD',
        error: null,
        warnings: [],
        rejected: 0,
        fields: importFields.map((field) => ({
          field,
          value: field === 'title' ? 'Synthetic engineer' : '',
          status: field === 'title' ? 'SUPPORTED' : 'MISSING',
          candidates: [],
          reviewed: false,
        })),
      });
    if (init?.method === 'POST' || init?.method === 'PUT')
      saved = { ...saved, ...JSON.parse(init.body as string) };
    return Response.json(saved);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
const tab = (name: string) =>
  fireEvent.click(
    name === 'Edit JD'
      ? screen.getByRole('link', { name })
      : screen.getByRole('tab', {
          name: new RegExp(`^${name}`),
        }),
  );

test('creation is import then review; extraction advances, back preserves edits, saves SAVED without tracker', async () => {
  const fetch = mockApi();
  mount();
  expect(screen.getByLabelText('Recruitment post')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Extract with AI' })).toHaveClass(
    'MuiButton-outlined',
  );
  expect(
    screen.getByRole('button', { name: 'Continue to Review & Save' }),
  ).toHaveClass('MuiButton-contained');
  expect(
    screen.queryByRole('button', { name: 'Confirm and save job' }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText('Application status')).not.toBeVisible();
  fireEvent.change(screen.getByLabelText('Recruitment post'), {
    target: { value: 'Synthetic post' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Extract with AI' }));
  expect(
    await screen.findByRole('button', { name: 'Confirm and save job' }),
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText(/Job title/), {
    target: { value: 'Reviewed engineer' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Back to Import sources' }),
  );
  expect(screen.getByLabelText('Recruitment post')).toHaveValue(
    'Synthetic post',
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue to Review & Save' }),
  );
  expect(screen.getByLabelText(/Job title/)).toHaveValue('Reviewed engineer');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save job' }));
  expect(await screen.findByRole('tab', { name: 'Overview' })).toBeVisible();
  const save = fetch.mock.calls.find(
    ([url, init]) => url === '/api/v1/opportunities' && init?.method === 'POST',
  )!;
  expect(JSON.parse(save[1]!.body as string)).toMatchObject({
    title: 'Reviewed engineer',
    status: 'SAVED',
    notes: '',
    contactDates: [],
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('detail defaults to overview, match stays mounted, application and JD edits survive switching/save/reload', async () => {
  const fetch = mockApi();
  const first = mount(`/jobs/${id}`);
  await screen.findByRole('heading', { name: 'Synthetic engineer' });
  expect(screen.getByRole('heading', { name: 'Job overview' })).toBeVisible();
  expect(screen.getByText('Saved CV matching workflow')).not.toBeVisible();
  tab('CV Match');
  expect(screen.getByText('Saved CV matching workflow')).toBeVisible();
  tab('Application');
  fireEvent.change(screen.getByLabelText('Application notes'), {
    target: { value: 'Synthetic note' },
  });
  fireEvent.change(screen.getByLabelText('Last HR contact date'), {
    target: { value: '2026-11-02' },
  });
  fireEvent.change(screen.getByLabelText('Next follow-up date'), {
    target: { value: '2026-11-09' },
  });
  fireEvent.mouseDown(screen.getByLabelText('Application status'));
  fireEvent.click(await screen.findByRole('option', { name: 'APPLIED' }));
  tab('Edit JD');
  fireEvent.change(screen.getByLabelText('Job description'), {
    target: { value: 'Updated synthetic JD' },
  });
  tab('Application');
  expect(screen.getByLabelText('Application notes')).toHaveValue(
    'Synthetic note',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Changes saved')).toBeVisible();
  const save = fetch.mock.calls.find(([, init]) => init?.method === 'PUT')!;
  expect(JSON.parse(save[1]!.body as string)).toMatchObject({
    status: 'APPLIED',
    notes: 'Synthetic note',
    description: 'Updated synthetic JD',
    contactDates: ['2026-11-02'],
    followUpDate: '2026-11-09',
  });
  first.unmount();
  mount(`/jobs/${id}`);
  await screen.findByRole('heading', { name: 'Synthetic engineer' });
  tab('Edit JD');
  expect(screen.getByLabelText('Job description')).toHaveValue(
    'Updated synthetic JD',
  );
  tab('Application');
  expect(screen.getByLabelText('Application notes')).toHaveValue(
    'Synthetic note',
  );
  fireEvent.click(screen.getByRole('link', { name: 'Back to Jobs' }));
  expect(await screen.findByText('Inbox destination')).toBeVisible();
});

test('follow-up status resets to Pending on a new date and hides when the date is cleared', async () => {
  const fetch = mockApi();
  fetch.mockResolvedValueOnce(
    Response.json({
      ...row(),
      status: 'APPLIED',
      followUpDate: '2026-11-02',
      followUpStatus: 'DONE',
    }),
  );
  mount(`/jobs/${id}`);
  await screen.findByRole('heading', { name: 'Synthetic engineer' });
  tab('Application');
  const status = () =>
    screen.queryByRole('combobox', { name: 'Follow-up status' });
  expect(status()).toHaveTextContent('Done');
  fireEvent.change(screen.getByLabelText('Next follow-up date'), {
    target: { value: '2026-11-09' },
  });
  expect(status()).toHaveTextContent('Pending');
  fireEvent.change(screen.getByLabelText('Next follow-up date'), {
    target: { value: '' },
  });
  expect(status()).toBeNull();
  expect(screen.getByLabelText('Application status')).toHaveTextContent(
    'APPLIED',
  );
});

test('manual creation validates title and keeps fields after save failure', async () => {
  const fetch = mockApi();
  mount();
  expect(
    screen.getByRole('button', { name: 'Continue to Review & Save' }),
  ).toHaveClass('MuiButton-contained');
  const back = screen.getByRole('link', { name: 'Back to Jobs' });
  expect(back).toHaveClass('MuiButton-outlined');
  expect(back.querySelector('.MuiButton-startIcon svg')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  // Continue requires JD content (PR87); mount() already opened Paste JD.
  fireEvent.change(screen.getByLabelText('Recruitment post'), {
    target: { value: 'Synthetic JD' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue to Review & Save' }),
  );
  expect(fetch.mock.calls.some(([url]) => url.endsWith('/extract'))).toBe(
    false,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save job' }));
  expect(
    await screen.findByText(/Enter a job title before saving/),
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText(/Job title/), {
    target: { value: 'Manual engineer' },
  });
  fetch.mockRejectedValueOnce(new Error('Synthetic save failure'));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save job' }));
  expect(await screen.findByText(/Synthetic save failure/)).toBeVisible();
  expect(screen.getByLabelText(/Job title/)).toHaveValue('Manual engineer');
});

test('unsaved link navigation, browser back, and refresh are guarded; stay retains edits', async () => {
  mockApi();
  const { router } = mount();
  fireEvent.change(screen.getByLabelText('Recruitment post'), {
    target: { value: 'Unsaved source' },
  });
  const indicator = screen
    .getByText('Unsaved changes')
    .closest('.MuiChip-root');
  // Subtle outlined indicator, not a filled warning colour.
  expect(indicator).toHaveClass('MuiChip-outlined');
  expect(indicator).not.toHaveStyle({
    backgroundColor: theme.palette.warning.main,
  });
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole('link', { name: 'Back to Jobs' }));
  expect(await screen.findByRole('dialog')).toBeVisible();
  const stay = screen.getByRole('button', { name: 'Stay and edit' });
  const discard = screen.getByRole('button', { name: 'Discard and leave' });
  await waitFor(() => expect(stay).toHaveFocus());
  // Stay is the primary action; Discard is neutral until hovered.
  expect(stay).toHaveClass('MuiButton-contained', 'MuiButton-colorPrimary');
  expect(discard).toHaveClass('MuiButton-outlined', 'MuiButton-colorError');
  expect(
    stay.compareDocumentPosition(discard) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  fireEvent.click(stay);
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(screen.getByLabelText('Recruitment post')).toHaveValue(
    'Unsaved source',
  );
  void router.navigate(-1);
  expect(await screen.findByRole('dialog')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Discard and leave' }));
  expect(await screen.findByText('Inbox destination')).toBeVisible();
});

test('review keeps genuine conflicts blocking until explicitly resolved', async () => {
  const fetch = mockApi();
  mount();
  const candidates = ['HCMC', 'Hanoi'].map((value) => ({
    field: 'location',
    value,
    source: 'post',
    quote: value,
  }));
  fetch.mockResolvedValueOnce(
    Response.json({
      postText: 'Synthetic source',
      jdText: '',
      description: 'Synthetic JD',
      warnings: [],
      error: null,
      rejected: 0,
      fields: importFields.map((field) => ({
        field,
        value: field === 'title' ? 'Synthetic engineer' : '',
        status:
          field === 'location'
            ? 'CONFLICT'
            : field === 'title'
              ? 'SUPPORTED'
              : 'MISSING',
        candidates: field === 'location' ? candidates : [],
        reviewed: false,
      })),
    }),
  );
  fireEvent.change(screen.getByLabelText('Recruitment post'), {
    target: { value: 'Synthetic source' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Extract with AI' }));
  const save = await screen.findByRole('button', {
    name: 'Confirm and save job',
  });
  expect(save).toBeDisabled();
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Use this value for Location' })[0]!,
  );
  expect(screen.getByLabelText('Location')).toHaveValue('HCMC');
  expect(save).toBeEnabled();
  fireEvent.click(save);
  expect(await screen.findByRole('tab', { name: 'Overview' })).toBeVisible();
});

test('synthetic document stays attached across steps and reaches extraction unchanged', async () => {
  const fetch = mockApi();
  mount();
  const document = new File(['synthetic fixture'], 'synthetic.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  fireEvent.click(screen.getByRole('button', { name: /Upload JD/ }));
  fireEvent.change(screen.getByLabelText('Upload JD document (PDF or DOCX)'), {
    target: { files: [document] },
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Extract with AI' }),
    ).toBeEnabled(),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue to Review & Save' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Back to Import sources' }),
  );
  expect(screen.getByText('synthetic.docx')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Extract with AI' }));
  await screen.findByRole('button', { name: 'Confirm and save job' });
  const call = fetch.mock.calls.find(([url]) => url.endsWith('/extract'))!;
  const uploaded = (call[1]!.body as FormData).get('document') as File;
  expect(uploaded.name).toBe(document.name);
  expect(uploaded.size).toBe(document.size);
  expect(uploaded.type).toBe(document.type);
});

test('review actions occupy a separate row below the language fields', async () => {
  const fetch = mockApi();
  mount();
  fetch.mockResolvedValueOnce(
    Response.json({
      postText: 'Synthetic source',
      jdText: '',
      description: 'Synthetic JD',
      warnings: [],
      error: null,
      rejected: 0,
      fields: importFields.map((field) => ({
        field,
        value:
          field === 'title'
            ? 'Synthetic engineer'
            : field === 'skills'
              ? 'RESTful API\nEnglish technical reading'
              : '',
        status: ['title', 'skills'].includes(field) ? 'SUPPORTED' : 'MISSING',
        candidates: [],
        reviewed: false,
      })),
    }),
  );
  fireEvent.change(screen.getByLabelText('Recruitment post'), {
    target: { value: 'Synthetic source' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Extract with AI' }));
  const save = await screen.findByRole('button', {
    name: 'Confirm and save job',
  });
  const actions = screen.getByRole('region', { name: 'Job save actions' });
  expect(actions).toContainElement(save);
  expect(actions).not.toContainElement(
    screen.getByLabelText('Required language requirements'),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Edit Candidate requirements' }),
  );
  expect(screen.getByLabelText('Required language requirements')).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Back to Import sources' }),
  ).toBeVisible();
});

test('missing work-mode evidence clears obsolete automatic values but preserves manual edits', async () => {
  const fetch = mockApi();
  mount();
  const extraction = (mode: string) =>
    Response.json({
      postText: 'Synthetic',
      jdText: '',
      description: 'Synthetic JD',
      warnings: [],
      error: null,
      rejected: 0,
      fields: importFields.map((field) => ({
        field,
        value:
          field === 'title'
            ? 'Synthetic engineer'
            : field === 'workMode'
              ? mode
              : '',
        status:
          field === 'title' || (field === 'workMode' && mode)
            ? 'SUPPORTED'
            : 'MISSING',
        candidates: [],
        reviewed: false,
      })),
    });
  fetch.mockResolvedValueOnce(extraction('Remote'));
  fireEvent.change(screen.getByLabelText('Recruitment post'), {
    target: { value: 'Fully remote position' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Extract with AI' }));
  await screen.findByRole('button', { name: 'Confirm and save job' });
  expect(screen.getByLabelText('Work mode')).toHaveValue('Remote');
  fireEvent.click(
    screen.getByRole('button', { name: 'Back to Import sources' }),
  );
  fireEvent.change(screen.getByLabelText('Recruitment post'), {
    target: { value: 'Remote attestation and desktop agent work' },
  });
  fetch.mockResolvedValueOnce(extraction(''));
  fireEvent.click(screen.getByRole('button', { name: 'Extract with AI' }));
  await screen.findByRole('button', { name: 'Confirm and save job' });
  expect(screen.getByLabelText('Work mode')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('Work mode'), {
    target: { value: 'Hybrid (manually reviewed)' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Back to Import sources' }),
  );
  fireEvent.change(screen.getByLabelText('Recruitment post'), {
    target: { value: 'Remote device management' },
  });
  fetch.mockResolvedValueOnce(extraction(''));
  fireEvent.click(screen.getByRole('button', { name: 'Extract with AI' }));
  await screen.findByRole('button', { name: 'Confirm and save job' });
  expect(screen.getByLabelText('Work mode')).toHaveValue(
    'Hybrid (manually reviewed)',
  );
});

test('narrow tab strip supports all workspace tabs and keyboard selection without losing edits', async () => {
  vi.stubGlobal('innerWidth', 360);
  mockApi();
  mount(`/jobs/${id}`);
  await screen.findByRole('heading', { name: 'Synthetic engineer' });
  const user = userEvent.setup();
  const tabs = screen.getAllByRole('tab');
  expect(tabs.map((tab) => tab.textContent)).toEqual([
    'Overview',
    'CV Match',
    'Tailored CV',
    'Application',
    'Interview',
  ]);
  const strip = screen
    .getByRole('tablist', { name: 'Job sections' })
    .closest('.MuiTabs-root')!;
  expect(strip).toHaveStyle({ maxWidth: '100%', minWidth: '0' });
  expect(strip.querySelector('.MuiTabs-scrollButtonsHideMobile')).toBeNull();
  await user.click(tabs[0]!);
  await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{Enter}');
  expect(screen.getByRole('tab', { name: /^Application/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await user.click(screen.getByRole('link', { name: 'Edit JD' }));
  expect(screen.getByRole('link', { name: 'Edit JD' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(
    screen.getByRole('region', { name: 'Job save actions' }),
  ).toContainElement(screen.getByRole('button', { name: 'Save changes' }));
  fireEvent.change(screen.getByLabelText('Job description'), {
    target: { value: 'Unsaved mobile JD' },
  });
  tab('Overview');
  tab('Edit JD');
  expect(screen.getByLabelText('Job description')).toHaveValue(
    'Unsaved mobile JD',
  );
  expect(screen.getByText('Unsaved changes')).toBeVisible();
  expect(screen.getAllByRole('button', { name: 'Save changes' })).toHaveLength(
    1,
  );
  tab('Application');
  expect(
    screen.getByRole('region', { name: 'Job save actions' }),
  ).toContainElement(screen.getByRole('button', { name: 'Save changes' }));
});

test('Job header keeps one original-job link and an accessible Jobs breadcrumb', async () => {
  const fetch = mockApi();
  fetch.mockResolvedValueOnce(
    Response.json({
      ...row(),
      originalLink: 'https://example.com/synthetic-job',
    }),
  );
  mount('/jobs/' + id);
  const original = await screen.findByRole('link', {
    name: 'Open original job',
  });
  expect(original).toHaveClass('MuiLink-root');
  expect(original).not.toHaveClass('MuiButton-root');
  expect(original).toHaveAttribute('href', 'https://example.com/synthetic-job');
  expect(original).toHaveAttribute('rel', 'noopener noreferrer');
  const breadcrumb = screen.getByRole('navigation', { name: 'Job breadcrumb' });
  const jobs = within(breadcrumb).getByRole('link', { name: 'Back to Jobs' });
  expect(jobs).toHaveTextContent('Jobs');
  expect(jobs).toHaveAttribute('href', '/jobs');
  expect(jobs).not.toHaveClass('MuiButton-root');
  expect(jobs.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  expect(within(breadcrumb).getByText('Job details')).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('discovery provenance appears once between the tabs and every active panel', async () => {
  const discoveredAt = '2026-11-04T00:00:00Z';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        ...row(),
        originalLink: 'https://example.com/synthetic-job',
        discovery: {
          sourceName: 'Axon · Greenhouse',
          sourceJobId: 'synthetic-source-id',
          sourceUrl: 'https://boards-api.greenhouse.io/v1/boards/axon/jobs',
          discoveredAt,
        },
      }),
    ),
  );
  mount(`/jobs/${id}`);
  await screen.findByRole('heading', { name: 'Synthetic engineer' });
  for (const name of [
    'Overview',
    'CV Match',
    'Tailored CV',
    'Application',
    'Edit JD',
  ]) {
    tab(name);
    const banner = screen.getByLabelText('Discovery provenance');
    expect(screen.getAllByLabelText('Discovery provenance')).toHaveLength(1);
    expect(banner).toHaveTextContent('Axon · Greenhouse');
    expect(banner).toHaveTextContent(
      new Date(discoveredAt).toLocaleDateString(),
    );
    expect(banner.closest('[role="tabpanel"]')).toBeNull();
    const strip = screen.getByRole('tablist', { name: 'Job sections' });
    const panel = screen.getByRole('tabpanel', {
      name: new RegExp(`^${name}`),
    });
    expect(
      banner.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      banner.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Open original job' });
    expect(link).toHaveAttribute('href', 'https://example.com/synthetic-job');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
});

test.each(['', 'javascript:alert(1)', 'https://user:secret@example.com/job'])(
  'discovery provenance omits an unsafe or missing original job link: %s',
  async (originalLink) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ...row(),
          originalLink,
          discovery: {
            sourceName: 'Axon · Greenhouse',
            sourceJobId: 'synthetic',
            sourceUrl: 'https://boards-api.greenhouse.io/v1/boards/axon/jobs',
            discoveredAt: '2026-11-04T00:00:00Z',
          },
        }),
      ),
    );
    mount(`/jobs/${id}`);
    expect(await screen.findByLabelText('Discovery provenance')).toBeVisible();
    expect(
      screen.queryByRole('link', { name: 'Open original job' }),
    ).not.toBeInTheDocument();
  },
);

test('jobs without discovery provenance have no banner on any tab', async () => {
  mockApi();
  mount(`/jobs/${id}`);
  await screen.findByRole('heading', { name: 'Synthetic engineer' });
  for (const name of [
    'Overview',
    'CV Match',
    'Tailored CV',
    'Application',
    'Edit JD',
  ]) {
    tab(name);
    expect(
      screen.queryByLabelText('Discovery provenance'),
    ).not.toBeInTheDocument();
  }
});

test('Edit JD contains its heading, fields and save guidance in one outlined surface', async () => {
  mockApi();
  mount(`/jobs/${id}`);
  await screen.findByDisplayValue('Synthetic engineer');
  fireEvent.click(screen.getByRole('link', { name: 'Edit JD' }));
  const panel = screen.getByRole('tabpanel', { name: 'Edit JD' });
  expect(panel).toHaveStyle({ borderWidth: '1px', borderStyle: 'solid' });
  expect(panel).toContainElement(
    screen.getByRole('heading', { name: 'Job details' }),
  );
  expect(panel).toContainElement(screen.getByLabelText('Job description'));
  expect(panel).toHaveTextContent('Save confirms your reviewed values.');
  const save = screen.getByRole('button', { name: 'Save changes' });
  expect(save).toHaveAttribute('form', 'job-editor-form');
  expect(panel).toContainElement(save);
});

test('the Interview tab has its own URL and stays mounted (hidden) after it is left', async () => {
  mockApi();
  const { router } = mount(`/jobs/${id}/interview`);
  await screen.findByRole('heading', { name: 'Synthetic engineer' });
  expect(screen.getByRole('tab', { name: 'Interview' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getByRole('tabpanel', { name: 'Interview' })).toHaveTextContent(
    'Interview questions workflow',
  );
  const panel = screen.getByText('Interview questions workflow');
  tab('Overview');
  await waitFor(() => expect(panel).not.toBeVisible());
  expect(
    screen.queryByRole('tabpanel', { name: 'Interview' }),
  ).not.toBeInTheDocument();
  tab('Interview');
  // Same element: kept mounted, not remounted.
  await waitFor(() => expect(panel).toBeVisible());
  expect(screen.getAllByText('Interview questions workflow')).toHaveLength(1);
  expect(router.state.location.pathname).toBe(`/jobs/${id}/interview`);
});

test('Tailored CV keeps wizard state across tabs, restarts after a JD save, and never leaks across jobs', async () => {
  const fetch = mockApi();
  const base = fetch.getMockImplementation()!;
  let revision = 0;
  // A real save returns a new updatedAt, the Tailored CV revision.
  fetch.mockImplementation(async (url, init) => {
    const body = (await (await base(url, init)).json()) as object;
    if (init?.method === 'PUT') revision++;
    return Response.json({
      ...body,
      updatedAt: `2026-11-0${revision + 1}T00:00:00Z`,
    });
  });
  wizardMounts.count = 0;
  const { router } = mount(`/jobs/${id}/tailored-cv`);
  const wizard = await screen.findByLabelText(/^Tailored wizard/u);
  fireEvent.change(wizard, { target: { value: 'local edit' } });
  const calls = fetch.mock.calls.length;
  tab('Overview');
  await waitFor(() => expect(wizard).not.toBeVisible());
  tab('Tailored CV');
  expect(screen.getByLabelText(/^Tailored wizard/u)).toHaveValue('local edit');
  expect(wizardMounts.count).toBe(1);
  expect(fetch.mock.calls.length).toBe(calls);
  // A saved JD revision invalidates the workflow.
  tab('Edit JD');
  fireEvent.change(screen.getByLabelText('Job description'), {
    target: { value: 'Revised synthetic JD' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Changes saved')).toBeVisible();
  await closeSuccess();
  await waitFor(() => expect(wizardMounts.count).toBe(2));
  expect(screen.getByLabelText(/^Tailored wizard/u)).toHaveValue('');
  // Another job never sees this job's panels or state.
  const other = '00000000-0000-4000-8000-999999999999';
  await act(() => router.navigate(`/jobs/${other}`));
  await screen.findByRole('heading', { name: 'Synthetic engineer' });
  await waitFor(() =>
    expect(
      screen.queryByLabelText(/^Tailored wizard/u),
    ).not.toBeInTheDocument(),
  );
  await act(() => router.navigate(`/jobs/${other}/tailored-cv`));
  expect(
    await screen.findByLabelText(new RegExp(`^Tailored wizard ${other}`, 'u')),
  ).toHaveValue('');
});

test('unsaved Tailored CV review edits allow Overview but guard CV Match and Edit JD', async () => {
  mockApi();
  const { router } = mount(`/jobs/${id}/tailored-cv`);
  const wizard = await screen.findByLabelText(/^Tailored wizard/u);
  fireEvent.change(wizard, { target: { value: 'unsaved review' } });
  tab('Overview');
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(`/jobs/${id}`),
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  tab('CV Match');
  expect(
    await screen.findByRole('dialog', { name: 'Leave unsaved changes?' }),
  ).toBeVisible();
  expect(router.state.location.pathname).toBe(`/jobs/${id}`);
});
