import { ThemeProvider } from '@mui/material';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from './render';
import { theme } from '../src/app/theme';
import { JobEditor } from '../src/features/inbox/JobEditor';
import {
  emptyOpportunity,
  importFields,
  type ImportField,
} from '../src/features/inbox/opportunities-api';

vi.mock('../src/features/inbox/CvMatchPanel', () => ({
  CvMatchPanel: () => <span>Synthetic match panel</span>,
}));
const id = '00000000-0000-4000-8000-000000000099';
function setup(conflict = false, failSave = false) {
  const review: ImportField[] = importFields.map((field) => ({
    field,
    value: field === 'company' ? '' : '',
    status: conflict && field === 'company' ? 'CONFLICT' : 'MISSING',
    reviewed: false,
    candidates:
      conflict && field === 'company'
        ? [
            { field, value: 'Choice A', source: 'post', quote: 'Choice A' },
            { field, value: 'Choice B', source: 'jd', quote: 'Choice B' },
          ]
        : [],
  }));
  let saved = {
    ...emptyOpportunity(),
    id,
    title: 'Saved role',
    company: 'Saved company',
    description: 'Editable saved description',
    postText: 'Original source Choice A',
    jdText: 'Original parsed document Choice B',
    documentName: 'original.docx',
    importReview: review,
  };
  let failures = failSave ? 1 : 0;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/cv/current')) return Response.json(null);
    if (init?.method === 'PUT') {
      if (failures-- > 0)
        return Response.json(
          { message: 'Synthetic Save rejected' },
          { status: 400 },
        );
      saved = { ...saved, ...JSON.parse(init.body as string) };
    } else if (init?.method)
      throw new Error(`Unexpected processing request: ${url}`);
    return Response.json(saved);
  });
  vi.stubGlobal('fetch', fetch);
  const router = createMemoryRouter(
    [{ path: '/jobs/:id/*', element: <JobEditor /> }],
    { initialEntries: [`/jobs/${id}`] },
  );
  render(
    <ThemeProvider theme={theme}>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  return { fetch, review, saved: () => saved };
}
async function edit() {
  await screen.findByRole('heading', { name: 'Saved role' });
  fireEvent.click(screen.getByRole('link', { name: 'Edit JD' }));
}
const save = () => screen.getByRole('button', { name: 'Save changes' });
function lastPayload(fetch: ReturnType<typeof setup>['fetch']) {
  return JSON.parse(
    fetch.mock.calls.filter(([, init]) => init?.method === 'PUT').at(-1)![1]!
      .body as string,
  );
}

test('Edit JD exposes manual fields and no import controls, even for a job with an original document', async () => {
  const { fetch } = setup();
  await edit();
  expect(screen.getByRole('heading', { name: 'Job details' })).toBeVisible();
  expect(
    screen.queryByText('Replace JD from another source'),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('group', { name: 'Choose an import method' }),
  ).not.toBeInTheDocument();
  for (const name of ['Extract with AI', 'Fetch from URL'])
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Recruitment post')).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText('Original Job URL (optional)'),
  ).not.toBeInTheDocument();
  expect(document.querySelector('input[type=file]')).toBeNull();
  expect(screen.getByLabelText('Company')).toHaveValue('Saved company');
  expect(screen.getByLabelText('Source')).toBeVisible();
  expect(screen.getByLabelText('Job description')).toHaveValue(
    'Editable saved description',
  );
  expect(fetch.mock.calls.every(([, init]) => !init?.method)).toBe(true);
});

test('manual Save retains raw sources and evidence while persisting the current description and intentional blank', async () => {
  const { fetch, review, saved } = setup();
  await edit();
  fireEvent.change(screen.getByLabelText('Company'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Job description'), {
    target: { value: 'Manually reviewed description' },
  });
  expect(screen.getByText('Unsaved changes')).toBeVisible();
  expect(saved().description).toBe('Editable saved description');
  fireEvent.click(save());
  await screen.findByText('Changes saved');
  const payload = lastPayload(fetch);
  expect(payload).toMatchObject({
    company: '',
    description: 'Manually reviewed description',
    postText: 'Original source Choice A',
    importReview: review,
  });
  expect(payload).not.toHaveProperty('jdText');
  expect(payload).not.toHaveProperty('documentName');
  expect(saved().jdText).toBe('Original parsed document Choice B');
  expect(saved().documentName).toBe('original.docx');
  expect(screen.getByText('Unsaved changes')).not.toBeVisible();
});

test('manual description/source changes retain unresolved conflict gating; editing an acknowledged field resets it', async () => {
  const { fetch } = setup(true);
  await edit();
  expect(save()).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Job description'), {
    target: { value: 'Manual JD' },
  });
  fireEvent.change(screen.getByLabelText(/Job title/), {
    target: { value: 'Manual title' },
  });
  fireEvent.mouseDown(screen.getByLabelText('Source'));
  fireEvent.click(screen.getByRole('option', { name: 'Other' }));
  expect(
    screen.getByLabelText('I reviewed the conflict for Company'),
  ).not.toBeChecked();
  expect(save()).toBeDisabled();
  expect(fetch.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(
    false,
  );
  fireEvent.click(screen.getByLabelText('I reviewed the conflict for Company'));
  expect(save()).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Company'), {
    target: { value: 'Manual correction' },
  });
  expect(
    screen.getByLabelText('I reviewed the conflict for Company'),
  ).not.toBeChecked();
  expect(save()).toBeDisabled();
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Use this value for Company' })[1]!,
  );
  expect(screen.getByLabelText('Company')).toHaveValue('Choice B');
  expect(save()).toBeEnabled();
  fireEvent.click(save());
  await screen.findByText('Changes saved');
  expect(lastPayload(fetch)).toMatchObject({
    source: 'Other',
    company: 'Choice B',
    description: 'Manual JD',
    postText: 'Original source Choice A',
  });
  const field = lastPayload(fetch).importReview.find(
    (f: ImportField) => f.field === 'company',
  );
  expect(field).toMatchObject({ status: 'CONFLICT', reviewed: true });
  expect(field.candidates).toHaveLength(2);
});

test('failed manual Save retains description and evidence for explicit retry', async () => {
  const { fetch, review } = setup(false, true);
  await edit();
  fireEvent.change(screen.getByLabelText('Job description'), {
    target: { value: 'Retained on failure' },
  });
  fireEvent.click(save());
  await screen.findByText(/Synthetic Save rejected/);
  expect(screen.getByLabelText('Job description')).toHaveValue(
    'Retained on failure',
  );
  expect(screen.getByText('Unsaved changes')).toBeVisible();
  expect(lastPayload(fetch).importReview).toEqual(review);
  fireEvent.click(save());
  await waitFor(() =>
    expect(screen.getByText('Unsaved changes')).not.toBeVisible(),
  );
  expect(
    fetch.mock.calls.filter(([, init]) => init?.method === 'PUT'),
  ).toHaveLength(2);
});
