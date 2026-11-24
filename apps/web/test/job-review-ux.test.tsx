import { afterEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from './render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { setLocale } from '../src/app/i18n';
import { JobEditor } from '../src/features/inbox/JobEditor';
import {
  displayExperience,
  displaySalary,
} from '../src/features/inbox/job-display';
import { loadLinkSources } from '../src/features/inbox/link-sources';
import type { UrlJobPreview } from '../src/features/inbox/job-url-import';

afterEach(() => setLocale('en-US'));

const link = 'https://www.topcv.vn/viec-lam/synthetic-brand-manager/1.html';
const preview: UrlJobPreview = {
  originalLink: link,
  platform: 'TopCV',
  title: 'Synthetic Brand Manager',
  company: 'Synthetic Co',
  location: 'Hà Nội',
  description: 'Build the brand.\nRequirements:\nThree years in marketing',
  sourceText:
    'Job title: Synthetic Brand Manager\nBuild the brand.\nRequirements:\nThree years in marketing',
  validThrough: null,
  expired: false,
  salary: '25000000-30000000 VND per MONTH',
  experience: 'Minimum 3 years',
  fields: [
    {
      field: 'skills',
      value: 'Three years in marketing',
      status: 'SUPPORTED',
      reviewed: false,
      candidates: [],
    },
  ],
};
function mount() {
  render(
    <MemoryRouter>
      <JobEditor />
    </MemoryRouter>,
  );
}

test('salary and experience are formatted for display in both languages', () => {
  setLocale('en-US');
  expect(displaySalary('25000000-30000000 VND per MONTH')).toBe(
    '25M–30M VND/month',
  );
  expect(displaySalary('Up to 2500 USD')).toBe('Up to 2500 USD');
  expect(displayExperience('Minimum 3 years')).toBe('At least 3 year(s)');
  expect(displayExperience('24 months')).toBe('At least 2 year(s)');
  setLocale('vi-VN');
  expect(displaySalary('25000000-30000000 VND per MONTH')).toBe(
    '25–30 triệu VND/tháng',
  );
  expect(displaySalary('15500000-20000000 VND')).toBe('15,5–20 triệu VND');
  expect(displayExperience('Minimum 3 years')).toBe('Tối thiểu 3 năm');
  expect(displaySalary('Thỏa thuận')).toBe('Thỏa thuận');
});

test('URL is the primary method (no badge) and lists the sources the server enables', async () => {
  vi.mocked(loadLinkSources).mockResolvedValueOnce(['ITviec', 'TopCV']);
  vi.stubGlobal('fetch', vi.fn());
  mount();
  // Three equal method cards; the selected link panel holds the input and
  // Fetch JD. The bookmark is a collapsed fallback, not a card.
  const source = screen.getByRole('region', { name: 'Add the job posting' });
  expect(within(source).getAllByRole('button', { pressed: true })).toHaveLength(
    1,
  );
  const card = screen.getByRole('region', { name: 'Import method input' });
  expect(screen.queryByText('Recommended')).toBeNull();
  expect(
    await within(card).findByText('Supported: ITviec · TopCV'),
  ).toBeVisible();
  const fetchButton = within(card).getByRole('button', { name: 'Get content' });
  expect(fetchButton).toHaveClass('MuiButton-contained');
  expect(
    within(source).queryByRole('button', { name: /^Page-import bookmark/ }),
  ).not.toBeInTheDocument();
  const fallback = within(source)
    .getByText("Can't fetch the page? Use the page-import bookmark")
    .closest('details')!;
  expect(fallback).not.toHaveAttribute('open');
  // VietnamWorks is off on this server: Fetch stays disabled with guidance.
  fireEvent.change(screen.getByLabelText('Job posting link'), {
    target: {
      value: 'https://www.vietnamworks.com/synthetic-marketing-1-42-jv',
    },
  });
  expect(screen.getByRole('button', { name: 'Get content' })).toBeDisabled();
  expect(
    screen.getByText(/VietnamWorks link import is turned off/),
  ).toBeVisible();
  for (const name of [/^Paste content/, /^Upload document/])
    expect(within(source).getByRole('button', { name })).toBeEnabled();
});

test('fetch shows a compact summary, then Review groups fields and saves unchanged values', async () => {
  const fetch = vi.fn(async (url: string, init?: RequestInit) =>
    url.endsWith('/import-url')
      ? Response.json(preview)
      : url.includes('duplicate-url')
        ? Response.json({ duplicate: null })
        : Response.json({
            id: 'synthetic-id',
            ...JSON.parse(String(init?.body ?? '{}')),
          }),
  );
  vi.stubGlobal('fetch', fetch);
  mount();
  fireEvent.change(screen.getByLabelText('Job posting link'), {
    target: { value: link },
  });
  await userEvent.click(screen.getByRole('button', { name: 'Get content' }));
  const summary = await screen.findByRole('region', { name: 'Job summary' });
  expect(within(summary).getByText('Synthetic Brand Manager')).toBeVisible();
  expect(within(summary).getByText('25M–30M VND/month')).toBeVisible();
  expect(within(summary).getByText('At least 3 year(s)')).toBeVisible();
  expect(screen.getByLabelText('Source JD text (read-only)')).not.toBeVisible();

  fireEvent.click(screen.getByRole('button', { name: 'Continue without AI' }));
  // Review opens read-only: formatted content, no visible inputs, shown once.
  for (const name of [
    'Main details',
    'Candidate requirements',
    'Job description',
  ])
    expect(screen.getByRole('heading', { name })).toBeVisible();
  expect(
    screen.queryByRole('region', { name: 'Job summary' }),
  ).not.toBeInTheDocument();
  const section = (name: string) =>
    screen.getByRole('heading', { name }).closest('section')!;
  expect(
    within(section('Main details')).getByText('25M–30M VND/month'),
  ).toBeVisible();
  expect(
    within(section('Candidate requirements')).getByText('At least 3 year(s)'),
  ).toBeVisible();
  expect(
    screen.getByText('Three years in marketing', { selector: 'li' }),
  ).toBeVisible();
  expect(screen.getByLabelText(/Job title/)).not.toBeVisible();
  expect(screen.getByLabelText('Salary')).not.toBeVisible();
  const optional = screen
    .getByRole('heading', { name: 'Additional details' })
    .closest('details')!;
  expect(optional).not.toHaveAttribute('open');

  // Read → edit → read for one section, with focus moving into the inputs.
  await userEvent.click(
    screen.getByRole('button', { name: 'Edit Main details' }),
  );
  const title = screen.getByLabelText(/Job title/);
  expect(title).toBeVisible();
  await waitFor(() => expect(title).toHaveFocus());
  // Stored values are unchanged by display formatting.
  expect(screen.getByLabelText('Salary')).toHaveValue(
    '25000000-30000000 VND per MONTH',
  );
  // Other sections stay read-only.
  expect(screen.getByLabelText('Experience')).not.toBeVisible();
  fireEvent.change(title, { target: { value: 'Edited Brand Manager' } });
  await userEvent.click(
    screen.getByRole('button', { name: 'Done editing Main details' }),
  );
  expect(title).not.toBeVisible();
  expect(
    within(section('Main details')).getByText('Edited Brand Manager'),
  ).toBeVisible();
  // A missing title forces the section open so validation stays visible.
  await userEvent.click(
    screen.getByRole('button', { name: 'Edit Main details' }),
  );
  fireEvent.change(title, { target: { value: '' } });
  expect(
    screen.getByRole('button', { name: 'Done editing Main details' }),
  ).toBeDisabled();
  fireEvent.change(title, { target: { value: 'Edited Brand Manager' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save job' }));
  await waitFor(() =>
    expect(
      fetch.mock.calls.some(
        ([url, init]) =>
          url === '/api/v1/opportunities' && init?.method === 'POST',
      ),
    ).toBe(true),
  );
  const [, init] = fetch.mock.calls.find(
    ([url, request]) =>
      url === '/api/v1/opportunities' && request?.method === 'POST',
  )!;
  expect(JSON.parse(String(init!.body))).toMatchObject({
    title: 'Edited Brand Manager',
    company: 'Synthetic Co',
    salary: '25000000-30000000 VND per MONTH',
    experience: 'Minimum 3 years',
    skills: 'Three years in marketing',
    originalLink: link,
  });
});
