import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from './render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { JobEditor } from '../src/features/inbox/JobEditor';
import {
  importFields,
  type ImportPreview,
} from '../src/features/inbox/opportunities-api';

// The link card is always shown; returning to it closes the open alternative.
function showLinkImport() {
  fireEvent.click(screen.getByRole('button', { name: /^Paste link/ }));
}
const title = 'Java Backend Developer Java 17+, Spring Boot, English';
const location = 'Anna Building, QTSC, Quận 12, Hồ Chí Minh, VN';
const link = 'https://itviec.com/it-jobs/synthetic-bbv';
const fetched = {
  originalLink: link,
  platform: 'ITviec',
  title,
  company: 'Synthetic bbv Vietnam',
  location,
  description: 'Build Java backend services.',
  sourceText: `Job title: ${title}\nCompany: Synthetic bbv Vietnam\nLocation: ${location}\nBuild Java backend services.`,
  expired: false,
  validThrough: null,
};
function setup(conflict = false, missing = false) {
  const values: Record<string, string> = {
    title: missing || conflict ? '' : 'Java Backend Developer',
    company: '',
    location: missing || conflict ? '' : 'Ho Chi Minh City',
    skills: 'Java',
    workMode: 'Hybrid',
    contactNotes: 'AI proposed contact',
  };
  const result: ImportPreview = {
    postText: fetched.sourceText,
    jdText: '',
    description: 'AI-generated source wrapper',
    warnings: [],
    rejected: 0,
    error: null,
    fields: importFields.map((field) => ({
      field,
      value: values[field] ?? '',
      status:
        conflict && field === 'location'
          ? 'CONFLICT'
          : values[field]
            ? 'SUPPORTED'
            : 'MISSING',
      reviewed: false,
      candidates:
        conflict && field === 'location'
          ? [
              { field, value: location, source: 'post', quote: location },
              { field, value: 'Hà Nội', source: 'post', quote: 'Hà Nội' },
            ]
          : [],
    })),
  };
  const fetch = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.endsWith('/import-url'))
      return Response.json({
        ...fetched,
        domain: 'IT Services and IT Consulting; Financial Services',
      });
    if (path.endsWith('/extract')) return Response.json(result);
    return Response.json({
      ...JSON.parse(init!.body as string),
      id: 'synthetic',
    });
  });
  vi.stubGlobal('fetch', fetch);
  render(
    <MemoryRouter>
      <JobEditor />
    </MemoryRouter>,
  );
  if (conflict) {
    pasteSource();
    fireEvent.change(screen.getByLabelText('Job posting content'), {
      target: { value: 'Location: Hà Nội' },
    });
  }
  return fetch;
}
function pasteSource() {
  const back = screen.queryByRole('button', { name: 'Back to Add content' });
  if (back) fireEvent.click(back);
  // Cards toggle; only open Paste JD when it is not already open.
  const paste = screen.getByRole('button', { name: /Paste content/ });
  if (paste.getAttribute('aria-pressed') !== 'true') fireEvent.click(paste);
}
async function fetchJob() {
  showLinkImport();
  fireEvent.change(screen.getByLabelText('Job posting link'), {
    target: { value: link },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Get content' }));
  await screen.findByDisplayValue(title);
}
async function extract() {
  if (screen.queryByRole('button', { name: 'Back to Add content' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Back to Add content' }),
    );
  await userEvent.click(
    screen.getByRole('button', { name: 'Fill in with AI' }),
  );
  await screen.findByDisplayValue('Java');
}
test.each([false, true])(
  'Fetch → Extract keeps complete title/address/company/JD when AI shortens or omits fields (missing=%s)',
  async (missing) => {
    const fetch = setup(false, missing);
    await fetchJob();
    await extract();
    expect(screen.getByLabelText(/Job title/)).toHaveValue(title);
    expect(screen.getByLabelText('Location')).toHaveValue(location);
    expect(screen.getByLabelText('Company')).toHaveValue(fetched.company);
    expect(screen.getByLabelText('Job description')).toHaveValue(
      fetched.description,
    );
    expect(screen.getByLabelText('Work mode')).toHaveValue('Hybrid');
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirm and save job' }),
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetch.mock.calls[2]![1]!.body as string)).toMatchObject({
      title,
      domain: 'IT Services and IT Consulting; Financial Services',
      location,
      company: fetched.company,
      originalLink: link,
    });
    const payload = JSON.parse(
      (fetch.mock.calls[1]![1]!.body as FormData).get('record') as string,
    );
    expect(payload.postText).toContain(fetched.sourceText);
  },
);
test('genuine city conflict remains populated and unsaveable until explicitly resolved', async () => {
  const fetch = setup(true);
  await fetchJob();
  await extract();
  expect(screen.getByLabelText('Location')).toHaveValue(location);
  expect(screen.getByLabelText(/Job title/)).toHaveValue(title);
  expect(screen.getByLabelText('Company')).toHaveValue(fetched.company);
  expect(
    screen.getByRole('button', { name: 'Confirm and save job' }),
  ).toBeDisabled();
  const choose = screen.getAllByRole('button', {
    name: 'Use this value for Location',
  });
  await userEvent.click(choose[1]!);
  expect(screen.getByLabelText('Location')).toHaveValue('Hà Nội');
  expect(
    screen.getByRole('checkbox', {
      name: 'I reviewed the conflict for Location',
    }),
  ).toBeChecked();
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm and save job' }),
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  const saved = JSON.parse(fetch.mock.calls[2]![1]!.body as string);
  expect(saved).toMatchObject({
    title,
    location: 'Hà Nội',
    company: fetched.company,
  });
  expect(
    saved.importReview.find(
      (field: { field: string }) => field.field === 'location',
    ),
  ).toMatchObject({ status: 'CONFLICT', reviewed: true });
});
test('manual title/location/contact/URL and tracker edits survive extraction', async () => {
  const fetch = setup();
  await fetchJob();
  for (const [label, value] of [
    ['Location', 'My location'],
    ['Recruiter / contact notes', 'My contact'],
    ['Next follow-up date', '2026-11-05'],
  ])
    fireEvent.change(screen.getByLabelText(label!), { target: { value } });
  fireEvent.change(screen.getByLabelText(/Job title/), {
    target: { value: 'My title' },
  });
  await extract();
  expect(screen.getByLabelText(/Job title/)).toHaveValue('My title');
  expect(screen.getByLabelText('Location')).toHaveValue('My location');
  expect(screen.getByLabelText('Recruiter / contact notes')).toHaveValue(
    'My contact',
  );
  expect(screen.getByLabelText('Job posting link')).toHaveValue(link);
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm and save job' }),
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(JSON.parse(fetch.mock.calls[2]![1]!.body as string)).toMatchObject({
    title: 'My title',
    location: 'My location',
    contactNotes: 'My contact',
    originalLink: link,
    followUpDate: '2026-11-05',
  });
});

test.each(['known', 'unknown', 'manual'])(
  'skills/domain/salary survive Fetch → Extract → Review → Save (salary=%s)',
  async (salaryCase) => {
    const salary = salaryCase === 'unknown' ? '' : 'Up to 1700 usd net';
    const required =
      'Java\nSpring Boot\nREST APIs\nJPA/Hibernate\nSQL\nAngular\nTypeScript\nKafka\nDocker\nKubernetes\nCI/CD';
    const preferred =
      'DDD\nHexagonal Architecture\nMulti-Tenancy\nARC42\nTDD\nPair Programming\nAI-assisted development tools';
    const domain =
      'Real Estate, Facility Management, Healthcare, MedTech, Insurance';
    const sourceText = `${fetched.sourceText}\nMust have\n${required}\nNice to have\n${preferred}\nDomain: ${domain}${salary ? `\nSalary: ${salary}` : ''}`;
    const values: Record<string, string> = {
      title: 'Java Backend Developer',
      skills: required,
      preferredSkills: preferred,
      domain,
      salary,
    };
    const result: ImportPreview = {
      postText: sourceText,
      jdText: '',
      description: sourceText,
      warnings: [],
      rejected: 0,
      error: null,
      fields: importFields.map((field) => ({
        field,
        value: values[field] ?? '',
        status: values[field] ? 'SUPPORTED' : 'MISSING',
        reviewed: false,
        candidates: [],
      })),
    };
    const fetch = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith('/import-url'))
        return Response.json({
          ...fetched,
          sourceText,
          salary,
          salaryDetails: salary
            ? {
                originalText: salary,
                currency: 'USD',
                minimum: null,
                maximum: 1700,
                basis: 'net',
                payPeriod: null,
              }
            : null,
        });
      if (path.endsWith('/extract')) return Response.json(result);
      return Response.json({
        ...JSON.parse(init!.body as string),
        id: 'synthetic',
      });
    });
    vi.stubGlobal('fetch', fetch);
    render(
      <MemoryRouter>
        <JobEditor />
      </MemoryRouter>,
    );
    await fetchJob();
    expect(screen.getByLabelText('Salary')).toHaveValue(salary);
    if (salaryCase === 'manual') {
      fireEvent.change(screen.getByLabelText('Salary'), {
        target: { value: 'My negotiated salary' },
      });
      fireEvent.change(screen.getByLabelText('Required skills'), {
        target: { value: 'My required skills' },
      });
      fireEvent.change(screen.getByLabelText('Preferred skills'), {
        target: { value: 'My preferred skills' },
      });
      fireEvent.change(screen.getByLabelText('Domain'), {
        target: { value: 'My domain' },
      });
    }
    if (screen.queryByRole('button', { name: 'Back to Add content' }))
      await userEvent.click(
        screen.getByRole('button', { name: 'Back to Add content' }),
      );
    await userEvent.click(
      screen.getByRole('button', { name: 'Fill in with AI' }),
    );
    await screen.findByText(/Review every suggestion before saving/);
    expect(screen.getByLabelText('Required skills')).toHaveValue(
      salaryCase === 'manual' ? 'My required skills' : required,
    );
    expect(screen.getByLabelText('Preferred skills')).toHaveValue(
      salaryCase === 'manual' ? 'My preferred skills' : preferred,
    );
    expect(screen.getByLabelText('Domain')).toHaveValue(
      salaryCase === 'manual' ? 'My domain' : domain,
    );
    expect(screen.getByLabelText('Salary')).toHaveValue(
      salaryCase === 'manual' ? 'My negotiated salary' : salary,
    );
    expect(screen.getByLabelText(/Job title/)).toHaveValue(title);
    expect(screen.getByLabelText('Location')).toHaveValue(location);
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirm and save job' }),
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    const input = JSON.parse(
      (fetch.mock.calls[1]![1]!.body as FormData).get('record') as string,
    );
    expect(input.postText).toBe(sourceText);
    const saved = JSON.parse(fetch.mock.calls[2]![1]!.body as string);
    expect(saved).toMatchObject({
      originalLink: link,
      title,
      location,
      skills: salaryCase === 'manual' ? 'My required skills' : required,
      preferredSkills:
        salaryCase === 'manual' ? 'My preferred skills' : preferred,
      domain: salaryCase === 'manual' ? 'My domain' : domain,
      salary: salaryCase === 'manual' ? 'My negotiated salary' : salary,
    });
  },
);

test('manual Domain survives a genuine conflict and still requires explicit acknowledgment', async () => {
  const post = 'Domain: Insurance';
  const result: ImportPreview = {
    postText: post,
    jdText: 'Domain: Real Estate',
    description: post,
    warnings: [],
    rejected: 0,
    error: null,
    fields: importFields.map((field) => ({
      field,
      value: field === 'title' ? 'Synthetic engineer' : '',
      status:
        field === 'domain'
          ? 'CONFLICT'
          : field === 'title'
            ? 'SUPPORTED'
            : 'MISSING',
      reviewed: false,
      candidates:
        field === 'domain'
          ? [
              { field, value: 'Insurance', source: 'post', quote: post },
              {
                field,
                value: 'Real Estate',
                source: 'jd',
                quote: 'Domain: Real Estate',
              },
            ]
          : [],
    })),
  };
  const fetch = vi.fn(async (path: string, init?: RequestInit) =>
    path.endsWith('/extract')
      ? Response.json(result)
      : Response.json({ ...JSON.parse(init!.body as string), id: 'synthetic' }),
  );
  vi.stubGlobal('fetch', fetch);
  render(
    <MemoryRouter>
      <JobEditor />
    </MemoryRouter>,
  );
  pasteSource();
  fireEvent.change(screen.getByLabelText('Job posting content'), {
    target: { value: post },
  });
  fireEvent.change(screen.getByLabelText('Domain'), {
    target: { value: 'My manual domain' },
  });
  if (screen.queryByRole('button', { name: 'Back to Add content' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Back to Add content' }),
    );
  await userEvent.click(
    screen.getByRole('button', { name: 'Fill in with AI' }),
  );
  await screen.findByText('Conflicting evidence');
  expect(screen.getByLabelText('Domain')).toHaveValue('My manual domain');
  expect(
    screen.getByRole('button', { name: 'Confirm and save job' }),
  ).toBeDisabled();
  await userEvent.click(
    screen.getByRole('checkbox', {
      name: 'I reviewed the conflict for Domain',
    }),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm and save job' }),
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetch.mock.calls[1]![1]!.body as string).domain).toBe(
    'My manual domain',
  );
});

test.each([false, true])(
  'unknown Domain clears an obsolete automatic value but preserves a manual edit (manual=%s)',
  async (manual) => {
    let calls = 0;
    const fetch = vi.fn(async () => {
      calls++;
      const domain = calls === 1 ? 'enterprise software architecture' : '';
      const result: ImportPreview = {
        postText: 'Synthetic source',
        jdText: '',
        description: 'Synthetic source',
        warnings: [],
        rejected: 0,
        error: null,
        fields: importFields.map((field) => ({
          field,
          value:
            field === 'domain'
              ? domain
              : field === 'title'
                ? 'Synthetic engineer'
                : '',
          status:
            (field === 'domain' && domain) || field === 'title'
              ? 'SUPPORTED'
              : 'MISSING',
          reviewed: false,
          candidates: [],
        })),
      };
      return Response.json(result);
    });
    vi.stubGlobal('fetch', fetch);
    render(
      <MemoryRouter>
        <JobEditor />
      </MemoryRouter>,
    );
    pasteSource();
    fireEvent.change(screen.getByLabelText('Job posting content'), {
      target: { value: 'Synthetic source' },
    });
    if (screen.queryByRole('button', { name: 'Back to Add content' }))
      await userEvent.click(
        screen.getByRole('button', { name: 'Back to Add content' }),
      );
    await userEvent.click(
      screen.getByRole('button', { name: 'Fill in with AI' }),
    );
    await screen.findByDisplayValue('enterprise software architecture');
    if (manual)
      fireEvent.change(screen.getByLabelText('Domain'), {
        target: { value: 'My manual business domain' },
      });
    pasteSource();
    fireEvent.change(screen.getByLabelText('Job posting content'), {
      target: { value: 'Only engineering skills, no business industry' },
    });
    if (screen.queryByRole('button', { name: 'Back to Add content' }))
      await userEvent.click(
        screen.getByRole('button', { name: 'Back to Add content' }),
      );
    await userEvent.click(
      screen.getByRole('button', { name: 'Fill in with AI' }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Domain')).toHaveValue(
        manual ? 'My manual business domain' : '',
      ),
    );
    expect(screen.getByLabelText(/Job title/)).toHaveValue(
      'Synthetic engineer',
    );
  },
);

test.each([false, true])(
  'compatible reanalysis replaces stale location conflict without acknowledgment (manual=%s)',
  async (manual) => {
    const locations = ['Quận 12, Hồ Chí Minh, VN', location, 'Quận 12'];
    const postText = locations.map((value) => `Location: ${value}`).join('\n');
    let analyses = 0;
    const fetch = vi.fn(async (path: string, init?: RequestInit) => {
      if (!path.endsWith('/extract'))
        return Response.json({
          ...JSON.parse(init!.body as string),
          id: 'synthetic',
        });
      analyses++;
      const result: ImportPreview = {
        postText,
        jdText: '',
        description: postText,
        warnings: [],
        rejected: 0,
        error: null,
        fields: importFields.map((field) => ({
          field,
          value:
            field === 'title'
              ? 'Synthetic engineer'
              : field === 'location' && analyses > 1
                ? location
                : '',
          status:
            field === 'location'
              ? analyses === 1
                ? 'CONFLICT'
                : 'SUPPORTED'
              : field === 'title'
                ? 'SUPPORTED'
                : 'MISSING',
          reviewed: false,
          candidates:
            field === 'location'
              ? locations.map((value) => ({
                  field,
                  value,
                  source: 'post',
                  quote: `Location: ${value}`,
                }))
              : [],
        })),
      };
      return Response.json(result);
    });
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <MemoryRouter>
        <JobEditor />
      </MemoryRouter>,
    );
    pasteSource();
    fireEvent.change(screen.getByLabelText('Job posting content'), {
      target: { value: postText },
    });
    if (manual)
      fireEvent.change(screen.getByLabelText('Location'), {
        target: { value: 'My manual address' },
      });
    if (screen.queryByRole('button', { name: 'Back to Add content' }))
      await userEvent.click(
        screen.getByRole('button', { name: 'Back to Add content' }),
      );
    await userEvent.click(
      screen.getByRole('button', { name: 'Fill in with AI' }),
    );
    await screen.findByText('Conflicting evidence');
    expect(
      screen.getByRole('button', { name: 'Confirm and save job' }),
    ).toBeDisabled();
    if (screen.queryByRole('button', { name: 'Back to Add content' }))
      await userEvent.click(
        screen.getByRole('button', { name: 'Back to Add content' }),
      );
    await userEvent.click(
      screen.getByRole('button', { name: 'Fill in with AI' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText('Conflicting evidence'),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('checkbox', {
        name: 'I reviewed the conflict for Location',
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Location')).toHaveValue(
      manual ? 'My manual address' : location,
    );
    expect(
      screen.getByRole('button', { name: 'Confirm and save job' }),
    ).toBeEnabled();
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirm and save job' }),
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    const saved = JSON.parse(fetch.mock.calls[2]![1]!.body as string);
    expect(saved.location).toBe(manual ? 'My manual address' : location);
    expect(
      saved.importReview.find(
        (field: { field: string }) => field.field === 'location',
      ),
    ).toMatchObject({ status: 'SUPPORTED', reviewed: false });
  },
);

// Keep import orchestration assertions independent of the advisory lookup timer.
vi.mock('../src/features/inbox/DuplicateJobNotice', () => ({
  DuplicateJobNotice: () => null,
}));
