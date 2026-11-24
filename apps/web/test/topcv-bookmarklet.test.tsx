import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from './render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import * as bridge from '../src/features/inbox/topcv-bookmarklet';
import { TopcvBookmarkletInstall } from '../src/features/inbox/TopcvBookmarkletInstall';
import {
  importFields,
  type ImportPreview,
} from '../src/features/inbox/opportunities-api';
import { JobEditor } from '../src/features/inbox/JobEditor';
const sourceUrl = 'https://www.topcv.vn/viec-lam/synthetic-java/123.html';
const origin = 'https://www.topcv.vn';
const local = 'http://127.0.0.1:5173';
const nonce = 'a'.repeat(32);
const payload: bridge.TopcvPagePayload = {
  version: 1,
  sourceUrl,
  jobPosting: {
    '@type': 'JobPosting',
    title: 'Synthetic Java Engineer',
    description: '<p>Java and SQL</p>',
  },
  visibleText: '',
  salaryText: '',
};
function receiver(sourceOrigin = origin) {
  const sender = { postMessage: vi.fn() };
  let listener: (event: MessageEvent) => void = () => {};
  const win = {
    location: new URL(
      `${local}/jobs/new#topcv-import=${nonce}&source=${encodeURIComponent(sourceOrigin)}`,
    ),
    opener: sender,
    history: { replaceState: vi.fn() },
    addEventListener: vi.fn((_type, callback) => {
      listener = callback;
    }),
    removeEventListener: vi.fn(),
  };
  const consume = vi.fn(),
    fail = vi.fn();
  const cleanup = bridge.receiveTopcvPage(
    win as unknown as Window,
    consume,
    fail,
  );
  return {
    win,
    sender,
    consume,
    fail,
    cleanup,
    send: (patch: Partial<MessageEvent> = {}) =>
      listener({
        origin: sourceOrigin,
        source: sender,
        data: { type: 'AJH_TOPCV_PAGE', nonce, payload },
        ...patch,
      } as MessageEvent),
  };
}
test('receiver binds origin, sender and nonce and consumes valid data once', () => {
  vi.useFakeTimers();
  const r = receiver();
  expect(r.sender.postMessage).toHaveBeenCalledWith(
    { type: 'AJH_TOPCV_READY', nonce },
    origin,
  );
  r.send({ origin: 'https://evil.example' });
  r.send({ source: {} as Window });
  r.send({ data: { type: 'AJH_TOPCV_PAGE', nonce: 'wrong', payload } });
  expect(r.consume).not.toHaveBeenCalled();
  r.send();
  r.send();
  expect(r.consume).toHaveBeenCalledTimes(1);
  expect(r.consume).toHaveBeenCalledWith(payload);
  expect(r.win.opener).toBeNull();
  expect(r.win.history.replaceState).toHaveBeenCalledWith(
    null,
    '',
    '/jobs/new',
  );
  expect(r.win.removeEventListener).toHaveBeenCalled();
  vi.runAllTimers();
  expect(r.fail).not.toHaveBeenCalled();
});
test.each([
  { ...payload, sourceUrl: sourceUrl.replace('www.topcv.vn', 'topcv.vn') },
  { ...payload, sourceUrl: 'https://topcv.vn.evil.example/viec-lam/a/1.html' },
  { ...payload, visibleText: 'x'.repeat(12001) },
  { ...payload, jobPosting: { description: 'x'.repeat(65536) } },
  { ...payload, cookies: 'not accepted' },
])('invalid payload never reaches API consumer', (value) => {
  vi.useFakeTimers();
  const r = receiver();
  r.send({ data: { type: 'AJH_TOPCV_PAGE', nonce, payload: value } });
  expect(r.consume).not.toHaveBeenCalled();
  expect(r.fail).toHaveBeenCalled();
  r.cleanup();
});
test('handshake timeout cleans listeners and imports nothing', () => {
  vi.useFakeTimers();
  const r = receiver();
  vi.advanceTimersByTime(30000);
  expect(r.consume).not.toHaveBeenCalled();
  expect(r.fail).toHaveBeenCalledWith(expect.stringContaining('timed out'));
  expect(r.win.removeEventListener).toHaveBeenCalled();
});
function sourceWindow(markup: string, pageUrl = sourceUrl) {
  vi.useFakeTimers();
  document.body.innerHTML = markup;
  const child = { postMessage: vi.fn() };
  let listener: (event: MessageEvent) => void = () => {};
  const win = {
    location: { href: `${pageUrl}?tracking=synthetic-token#unrelated` },
    open: vi.fn<(url: string, target: string) => typeof child>(() => child),
    addEventListener: vi.fn((_type, callback) => {
      listener = callback;
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('window', win);
  vi.stubGlobal('alert', vi.fn());
  return {
    win,
    child,
    ready: (patch: Partial<MessageEvent> = {}) => {
      const target = new URL(win.open.mock.calls[0]![0] as string);
      const token = new URLSearchParams(target.hash.slice(1)).get(
        'topcv-import',
      );
      listener({
        origin: local,
        source: child,
        data: { type: 'AJH_TOPCV_READY', nonce: token },
        ...patch,
      } as MessageEvent);
    },
  };
}
test('generated bookmark runs self-contained, selects JSON-LD fields and transfers no credentials or JD in URL', () => {
  const s = sourceWindow(
    `<div>UNRELATED_PRIVATE_MARKER</div><script type="application/ld+json">${JSON.stringify({ ...payload.jobPosting, '@type': 'JobPosting', cookie: 'SECRET_TOKEN', jobLocationType: 'TELECOMMUTE', hiringOrganization: { name: 'Synthetic Employer', token: 'SECRET_TOKEN' }, experienceRequirements: { monthsOfExperience: 36, token: 'SECRET_TOKEN' } })}</script>`,
  );
  const code = bridge.bookmarkletUrl(local);
  new Function(decodeURIComponent(code.slice('javascript:'.length)))();
  const opened = s.win.open.mock.calls[0]![0] as string;
  expect(opened).not.toContain('Java');
  expect(opened).not.toContain('tracking');
  expect(new URL(opened).search).toBe('');
  s.ready({ origin: 'https://evil.example' });
  s.ready({ source: {} as Window });
  s.ready({ data: { type: 'AJH_TOPCV_READY', nonce: 'wrong' } });
  expect(s.child.postMessage).not.toHaveBeenCalled();
  s.ready();
  expect(s.child.postMessage).toHaveBeenCalledTimes(1);
  const sent = s.child.postMessage.mock.calls[0]![0];
  expect(sent.payload.sourceUrl).toBe(sourceUrl);
  expect(sent.payload.jobPosting.title).toBe('Synthetic Java Engineer');
  expect(sent.payload.jobPosting.jobLocationType).toBe('TELECOMMUTE');
  expect(sent.payload.jobPosting.experienceRequirements).toEqual({
    monthsOfExperience: 36,
  });
  expect(JSON.stringify(sent)).not.toMatch(
    /SECRET_TOKEN|UNRELATED_PRIVATE_MARKER|tracking/,
  );
  expect(s.win.removeEventListener).toHaveBeenCalled();
});
test('visible JD fallback reads only the visible job container', () => {
  const s = sourceWindow(
    '<div class="job-description"></div><div>UNRELATED_PRIVATE_MARKER</div>',
  );
  Object.defineProperty(
    document.querySelector('.job-description'),
    'innerText',
    { value: 'Synthetic visible JD\nJava and SQL' },
  );
  bridge.runTopcvBookmarklet(local);
  s.ready();
  const sent = s.child.postMessage.mock.calls[0]![0];
  expect(sent.payload.jobPosting).toBeNull();
  expect(sent.payload.visibleText).toBe('Synthetic visible JD\nJava and SQL');
  expect(JSON.stringify(sent)).not.toContain('UNRELATED_PRIVATE_MARKER');
});
test('missing or oversized JD never opens an app window', () => {
  const s = sourceWindow('No job container');
  bridge.runTopcvBookmarklet(local);
  expect(s.win.open).not.toHaveBeenCalled();
  document.body.innerHTML = `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', description: 'x'.repeat(65536) })}</script>`;
  bridge.runTopcvBookmarklet(local);
  expect(s.win.open).not.toHaveBeenCalled();
});
test('installation link is draggable and bound to the local app origin', () => {
  vi.stubGlobal('window', { location: { origin: local } });
  render(<TopcvBookmarkletInstall />);
  const link = screen.getByRole('link', {
    name: 'Import to AI Job Hunter',
    hidden: true,
  });
  expect(link).toHaveAttribute('draggable', 'true');
  expect(link).toBeVisible();
  expect(
    screen
      .getByLabelText('Bookmark URL (installation fallback)')
      .closest('details'),
  ).not.toHaveAttribute('open');
  expect(
    screen.getByLabelText('Bookmark URL (installation fallback)'),
  ).not.toBeVisible();
  expect(link.getAttribute('href')).toMatch(/^javascript:/);
  expect(() => bridge.bookmarkletUrl('https://evil.example')).toThrow();
});
test('received page populates existing review without inference/save and preserves manual edits', async () => {
  let receive!: (payload: bridge.TopcvPagePayload) => void;
  vi.spyOn(bridge, 'receiveTopcvPage').mockImplementation((_win, consume) => {
    receive = consume;
    return () => {};
  });
  const result = {
    originalLink: sourceUrl,
    platform: 'TopCV',
    title: 'Synthetic Java Engineer',
    company: 'Synthetic Employer',
    location: 'Hà Nội, VN',
    description: 'Java and SQL',
    sourceText: 'Job title: Synthetic Java Engineer\nJava and SQL',
    salary: '18000000-24000000 VND per MONTH',
    experience: '36 months',
    expired: true,
    validThrough: '2020-01-01',
  };
  const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
    Response.json(
      init?.method === 'POST' && _url.endsWith('/import-page')
        ? result
        : { ...JSON.parse(init?.body as string), id: 'synthetic' },
    ),
  );
  vi.stubGlobal('fetch', fetch);
  render(
    <MemoryRouter>
      <JobEditor />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText(/Job title/), {
    target: { value: 'My edited title' },
  });
  receive(payload);
  await waitFor(() =>
    expect(screen.getByLabelText('Company')).toHaveValue('Synthetic Employer'),
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Continue without AI' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Edit Main details' }));
  expect(screen.getByLabelText('Company')).toBeVisible();
  expect(screen.getByLabelText(/Job title/)).toHaveValue('My edited title');
  expect(screen.getByLabelText('Experience')).toHaveValue('36 months');
  expect(screen.getByLabelText('Salary')).toHaveValue(result.salary);
  expect(screen.getByLabelText('Original link')).toHaveValue(sourceUrl);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]![0]).toBe('/api/v1/opportunities/import-page');
  if (screen.queryByRole('button', { name: 'Continue without AI' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Continue without AI' }),
    );
  await userEvent.click(
    screen.getByRole('button', { name: 'Confirm and save job' }),
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetch.mock.calls[1]![1]!.body as string)).toMatchObject({
    title: 'My edited title',
    originalLink: sourceUrl,
    experience: '36 months',
    postText: result.sourceText,
  });
});

test.each([false, true])(
  'imported experience can gain source-backed minimum semantics; manual values survive extraction (manual=%s)',
  async (manual) => {
    let receive!: (payload: bridge.TopcvPagePayload) => void;
    vi.spyOn(bridge, 'receiveTopcvPage').mockImplementation((_win, consume) => {
      receive = consume;
      return () => {};
    });
    const sourceText =
      'Job title: Synthetic Java Engineer\nít nhất 03 năm\nExperience: 36 months\nWork mode: Hybrid\nƯu tiên container, K8S, Microservice';
    const imported = {
      originalLink: sourceUrl,
      platform: 'TopCV',
      title: 'Synthetic Java Engineer',
      company: '',
      location: 'Hà Nội',
      description: sourceText,
      sourceText,
      experience: '36 months',
      workMode: 'Hybrid',
      expired: false,
      validThrough: null,
    };
    const values: Record<string, string> = {
      title: imported.title,
      experience: 'Minimum 3 years',
      workMode: 'Hybrid',
      skills: 'Java',
      preferredSkills: 'container\nK8S\nMicroservice',
    };
    const extracted: ImportPreview = {
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
    const fetch = vi.fn(async (url: string, init?: RequestInit) =>
      Response.json(
        url.endsWith('/import-page')
          ? imported
          : url.endsWith('/extract')
            ? extracted
            : { ...JSON.parse(init!.body as string), id: 'synthetic' },
      ),
    );
    vi.stubGlobal('fetch', fetch);
    render(
      <MemoryRouter>
        <JobEditor />
      </MemoryRouter>,
    );
    if (manual)
      for (const [label, value] of [
        ['Experience', 'My experience'],
        ['Work mode', 'Remote'],
        ['Preferred skills', 'My preferred skills'],
      ])
        fireEvent.change(screen.getByLabelText(label!), { target: { value } });
    receive(payload);
    await screen.findByDisplayValue(imported.title);
    await userEvent.click(
      screen.getByRole('button', { name: 'Fill in with AI' }),
    );
    await screen.findByDisplayValue('Java');
    expect(screen.getByLabelText('Experience')).toHaveValue(
      manual ? 'My experience' : 'Minimum 3 years',
    );
    expect(screen.getByLabelText('Work mode')).toHaveValue(
      manual ? 'Remote' : 'Hybrid',
    );
    expect(screen.getByLabelText('Preferred skills')).toHaveValue(
      manual ? 'My preferred skills' : values.preferredSkills,
    );
    expect(screen.queryByText('Conflicting evidence')).not.toBeInTheDocument();
    if (screen.queryByRole('button', { name: 'Continue without AI' }))
      await userEvent.click(
        screen.getByRole('button', { name: 'Continue without AI' }),
      );
    await userEvent.click(
      screen.getByRole('button', { name: 'Confirm and save job' }),
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetch.mock.calls[2]![1]!.body as string)).toMatchObject({
      originalLink: sourceUrl,
      experience: manual ? 'My experience' : 'Minimum 3 years',
      workMode: manual ? 'Remote' : 'Hybrid',
    });
  },
);
test.each(['Hybrid', 'Toàn thời gian'])(
  'bookmark only captures explicit Work Mode, not employment type: %s',
  (mode) => {
    const s = sourceWindow(
      `<script type="application/ld+json">${JSON.stringify(payload.jobPosting)}</script><div class="job-detail__info--section"></div>`,
    );
    Object.defineProperty(
      document.querySelector('.job-detail__info--section'),
      'innerText',
      { value: `Hình thức làm việc\n${mode}` },
    );
    bridge.runTopcvBookmarklet(local);
    s.ready();
    expect(s.child.postMessage.mock.calls[0]![0].payload.workModeText).toBe(
      mode === 'Hybrid' ? 'Hybrid' : '',
    );
  },
);

const vnUrl =
  'https://www.vietnamworks.com/synthetic-java-1793350235119486825-2126090-jv';
test('VietnamWorks generated bookmark extracts graph JSON-LD and keeps only selected job fields', () => {
  const sourceJob = {
    '@type': 'JobPosting',
    title: 'Synthetic VN Java Engineer',
    description: '<p>Requirements: Java</p>',
    hiringOrganization: { name: 'Synthetic Employer' },
    jobLocation: { address: { addressLocality: 'HCM', addressCountry: 'VN' } },
    baseSalary: {
      currency: 'USD',
      value: { minValue: 1500, maxValue: 2500, unitText: 'MONTH' },
    },
    experienceRequirements: { monthsOfExperience: 60 },
    jobLocationType: 'TELECOMMUTE',
    validThrough: '2020-01-01',
    sessionToken: 'SECRET_TOKEN',
  };
  const s = sourceWindow(
    `<div>UNRELATED_PRIVATE_MARKER</div><script type="application/ld+json">${JSON.stringify({ '@graph': [{ '@type': 'Organization', token: 'SECRET_TOKEN' }, sourceJob] })}</script>`,
    vnUrl,
  );
  new Function(
    decodeURIComponent(
      bridge.bookmarkletUrl(local).slice('javascript:'.length),
    ),
  )();
  expect(new URL(s.win.open.mock.calls[0]![0]).search).toBe('');
  s.ready();
  const sent = s.child.postMessage.mock.calls[0]![0].payload;
  expect(sent.sourceUrl).toBe(vnUrl);
  expect(sent.jobPosting.title).toBe(sourceJob.title);
  expect(sent.jobPosting.baseSalary).toEqual(sourceJob.baseSalary);
  expect(sent.jobPosting.jobLocation[0].address.addressLocality).toBe('HCM');
  expect(sent.jobPosting.experienceRequirements).toEqual({
    monthsOfExperience: 60,
  });
  expect(JSON.stringify(sent)).not.toMatch(
    /SECRET_TOKEN|UNRELATED_PRIVATE_MARKER|tracking/,
  );
  expect(bridge.validPagePayload(sent)).toBe(true);
});
test('VietnamWorks fallback is scoped to one semantic JobPosting, never document body', () => {
  const s = sourceWindow(
    '<div>UNRELATED_PRIVATE_MARKER</div><section itemtype="https://schema.org/JobPosting"><h1 itemprop="title"></h1><div itemprop="hiringOrganization"><span itemprop="name"></span></div><div itemprop="description"></div></section>',
    vnUrl,
  );
  for (const [selector, value] of [
    ['[itemprop="title"]', 'Synthetic VN Engineer'],
    ['[itemprop="name"]', 'Synthetic VN Company'],
    ['[itemprop="description"]', 'Requirements\nJava\nNice to have\nK8S'],
  ])
    Object.defineProperty(document.querySelector(selector!), 'innerText', {
      value,
    });
  bridge.runTopcvBookmarklet(local);
  s.ready();
  const sent = s.child.postMessage.mock.calls[0]![0].payload;
  expect(sent.jobPosting.title).toBe('Synthetic VN Engineer');
  expect(sent.jobPosting.hiringOrganization.name).toBe('Synthetic VN Company');
  expect(sent.visibleText).toContain('Nice to have');
  expect(JSON.stringify(sent)).not.toContain('UNRELATED_PRIVATE_MARKER');
});
test('VietnamWorks handshake is bound to its exact origin, sender window and nonce', () => {
  vi.useFakeTimers();
  const r = receiver('https://www.vietnamworks.com');
  expect(r.sender.postMessage).toHaveBeenCalledWith(
    { type: 'AJH_TOPCV_READY', nonce },
    'https://www.vietnamworks.com',
  );
  const vnPayload = { ...payload, sourceUrl: vnUrl };
  r.send({
    origin,
    data: { type: 'AJH_TOPCV_PAGE', nonce, payload: vnPayload },
  });
  r.send({
    source: {} as Window,
    data: { type: 'AJH_TOPCV_PAGE', nonce, payload: vnPayload },
  });
  r.send({
    data: { type: 'AJH_TOPCV_PAGE', nonce: 'wrong', payload: vnPayload },
  });
  expect(r.consume).not.toHaveBeenCalled();
  r.send({ data: { type: 'AJH_TOPCV_PAGE', nonce, payload: vnPayload } });
  expect(r.consume).toHaveBeenCalledTimes(1);
  expect(r.consume).toHaveBeenCalledWith(vnPayload);
});
test('a VietnamWorks window cannot claim a TopCV payload URL', () => {
  vi.useFakeTimers();
  const r = receiver('https://www.vietnamworks.com');
  r.send();
  expect(r.consume).not.toHaveBeenCalled();
  expect(r.fail).toHaveBeenCalled();
});

test('VietnamWorks microdata retains explicit salary, experience, Work Mode and expiry without guesses', () => {
  const s = sourceWindow(
    `<section itemtype="https://schema.org/JobPosting"><h1 itemprop="title"></h1><div itemprop="description"></div><meta itemprop="experienceRequirements" content="5 years"><meta itemprop="workMode" content="Hybrid"><meta itemprop="validThrough" content="2020-01-01"><div itemprop="baseSalary"><meta itemprop="currency" content="USD"><meta itemprop="minValue" content="1500"><meta itemprop="maxValue" content="2500"><meta itemprop="unitText" content="MONTH"></div></section>`,
    vnUrl,
  );
  Object.defineProperty(
    document.querySelector('[itemprop="title"]'),
    'innerText',
    { value: 'Synthetic VN Engineer' },
  );
  Object.defineProperty(
    document.querySelector('[itemprop="description"]'),
    'innerText',
    { value: 'Requirements\nJava\nNice to have\nK8S' },
  );
  bridge.runTopcvBookmarklet(local);
  s.ready();
  const sent = s.child.postMessage.mock.calls[0]![0].payload;
  expect(sent.jobPosting).toMatchObject({
    experienceRequirements: '5 years',
    workMode: 'Hybrid',
    validThrough: '2020-01-01',
    baseSalary: {
      currency: 'USD',
      value: { minValue: 1500, maxValue: 2500, unitText: 'MONTH' },
    },
  });
});
test('unsupported VietnamWorks DOM never falls back to body text', () => {
  const s = sourceWindow(
    '<main>UNRELATED_PRIVATE_MARKER Java developer job</main><div class="job-description">Unverified site selector</div>',
    vnUrl,
  );
  bridge.runTopcvBookmarklet(local);
  expect(s.win.open).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(
    expect.stringContaining('No job description found'),
  );
});

test('unsupported experience objects do not serialize an invalid empty experience requirement', () => {
  const s = sourceWindow(
    `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Synthetic VN Engineer', description: '<p>Java Developer</p>', experienceRequirements: { '@type': 'OccupationalExperienceRequirements', yearsOfExperience: 5 } })}</script>`,
    vnUrl,
  );
  bridge.runTopcvBookmarklet(local);
  s.ready();
  expect(
    s.child.postMessage.mock.calls[0]![0].payload.jobPosting
      .experienceRequirements,
  ).toBeUndefined();
});

test('VietnamWorks semantic Responsibilities and Requirements sections are both transferred in DOM order', () => {
  const s = sourceWindow(
    `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Synthetic VN Engineer', description: 'Key Responsibilities\nBuild software' })}</script><section itemtype="https://schema.org/JobPosting"><div itemprop="description"></div><div itemprop="qualifications"></div></section><aside>UNRELATED_PRIVATE_MARKER</aside>`,
    vnUrl,
  );
  Object.defineProperty(
    document.querySelector('[itemprop="description"]'),
    'innerText',
    { value: 'Key Responsibilities\nBuild software' },
  );
  Object.defineProperty(
    document.querySelector('[itemprop="qualifications"]'),
    'innerText',
    {
      value:
        'Yêu cầu công việc\n5 years Java Full Stack\nTOEIC 700+\nMicroservices, AWS/Azure/GCP, CI/CD',
    },
  );
  bridge.runTopcvBookmarklet(local);
  s.ready();
  const data = s.child.postMessage.mock.calls[0]![0].payload;
  expect(data.visibleText).toBe(
    'Key Responsibilities\nBuild software\n\nYêu cầu công việc\n5 years Java Full Stack\nTOEIC 700+\nMicroservices, AWS/Azure/GCP, CI/CD',
  );
  expect(JSON.stringify(data)).not.toContain('UNRELATED_PRIVATE_MARKER');
});

test('incomplete VietnamWorks content and negotiable salary warnings are visible before extraction/save', async () => {
  let receive!: (payload: bridge.TopcvPagePayload) => void;
  vi.spyOn(bridge, 'receiveTopcvPage').mockImplementation((_win, consume) => {
    receive = consume;
    return () => {};
  });
  const fetch = vi.fn(async () =>
    Response.json({
      originalLink: vnUrl,
      platform: 'VietnamWorks',
      title: 'Synthetic VN Engineer',
      company: 'Synthetic VN Company',
      location: '',
      description: 'Key Responsibilities\nBuild software',
      sourceText: 'Key Responsibilities\nBuild software',
      salary: '',
      experience: '',
      workMode: '',
      expired: false,
      validThrough: null,
      importWarnings: [
        'Requirements section was not captured or could not be identified. The JD may be incomplete.',
        'Salary is negotiable; numeric amount, currency and period are unknown.',
      ],
    }),
  );
  vi.stubGlobal('fetch', fetch);
  render(
    <MemoryRouter>
      <JobEditor />
    </MemoryRouter>,
  );
  receive({ ...payload, sourceUrl: vnUrl });
  expect(
    await screen.findByText(/Requirements section was not captured/),
  ).toBeVisible();
  expect(screen.getByText(/Salary is negotiable/)).toBeVisible();
  expect(screen.getByLabelText(/Job title/)).toHaveValue(
    'Synthetic VN Engineer',
  );
  expect(screen.getByLabelText('Salary')).toHaveValue('');
  expect(fetch).toHaveBeenCalledTimes(1);
});

// Structure confirmed by the user's AJH_DOM_V1 output; text is synthetic.
function expandedVietnamWorksFixture(
  options: { reverse?: boolean; missing?: boolean; hidden?: boolean } = {},
) {
  const responsibilities =
    '<div class="sc-1671001a-4 gDSEwb"><h2 class="sc-1671001a-5 cjuZti" data-heading="description"></h2><div class="sc-fd369c22-0 DhTmL">UNRELATED_TAG_JAVA_SWING</div><div class="sc-1671001a-6 dVvinc"><div data-body="description"><p>Synthetic responsibility</p></div></div></div>';
  const requirements =
    '<div class="sc-1671001a-4 gDSEwb"><h2 class="sc-1671001a-5 cjuZti" data-heading="requirements"></h2><div class="sc-1671001a-6 dVvinc"><div data-body="requirements"><p>Synthetic requirement</p></div></div></div>';
  const partial = {
    '@type': 'JobPosting',
    title: 'Synthetic VN Java Engineer',
    description: '<p>Design and develop Digital Distribution Channels</p>',
  };
  const sections = options.missing
    ? responsibilities
    : options.reverse
      ? requirements + responsibilities
      : responsibilities + requirements;
  const s = sourceWindow(
    `<script type="application/ld+json">${JSON.stringify(partial)}</script><div class="sc-1671001a-3 hmvhgA">${sections}</div><aside>UNRELATED_PRIVATE_MARKER</aside>`,
    vnUrl,
  );
  Object.defineProperty(
    document.querySelector('[data-heading="description"]'),
    'innerText',
    { value: 'Mô tả công việc' },
  );
  Object.defineProperty(
    document.querySelector('[data-body="description"]'),
    'innerText',
    {
      value:
        'Key Responsibilities\n- Design and develop Digital Distribution Channels\n- Collaborate globally',
    },
  );
  if (!options.missing) {
    Object.defineProperty(
      document.querySelector('[data-heading="requirements"]'),
      'innerText',
      { value: 'Yêu cầu công việc' },
    );
    Object.defineProperty(
      document.querySelector('[data-body="requirements"]'),
      'innerText',
      {
        value:
          '- 5 years of experience in Java Full Stack development\n- Business English, TOEIC 700+\n- Microservices, AWS/Azure/GCP, CI/CD',
      },
    );
    if (options.hidden)
      (
        document.querySelector('[data-body="requirements"]') as HTMLElement
      ).hidden = true;
  }
  return s;
}
test('confirmed expanded VietnamWorks siblings capture both acceptance phrases and bullet boundaries', () => {
  const s = expandedVietnamWorksFixture();
  new Function(
    decodeURIComponent(
      bridge.bookmarkletUrl(local).slice('javascript:'.length),
    ),
  )();
  s.ready();
  const sent = s.child.postMessage.mock.calls[0]![0].payload;
  expect(sent.visibleText).toContain(
    'Design and develop Digital Distribution Channels',
  );
  expect(sent.visibleText).toContain(
    '5 years of experience in Java Full Stack development',
  );
  expect(sent.visibleText).toContain('Yêu cầu công việc\n- 5 years');
  expect(sent.visibleText).toContain(
    '\n- Business English, TOEIC 700+\n- Microservices',
  );
  expect(sent.visibleText.indexOf('Mô tả công việc')).toBeLessThan(
    sent.visibleText.indexOf('Yêu cầu công việc'),
  );
  expect(JSON.stringify(sent)).not.toMatch(
    /UNRELATED_TAG_JAVA_SWING|UNRELATED_PRIVATE_MARKER/,
  );
  expect(sent.sourceUrl).toBe(vnUrl);
  expect(sent.jobPosting.title).toBe('Synthetic VN Java Engineer');
});
test('confirmed section collector follows DOM order rather than sorting section labels', () => {
  const s = expandedVietnamWorksFixture({ reverse: true });
  bridge.runTopcvBookmarklet(local);
  s.ready();
  const text = s.child.postMessage.mock.calls[0]![0].payload.visibleText;
  expect(text.indexOf('Yêu cầu công việc')).toBeLessThan(
    text.indexOf('Mô tả công việc'),
  );
});
test.each([{ missing: true }, { hidden: true }])(
  'recognized VietnamWorks layout never silently imports only Responsibilities: %j',
  (options) => {
    const s = expandedVietnamWorksFixture(options);
    bridge.runTopcvBookmarklet(local);
    expect(s.win.open).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(
      expect.stringMatching(/Requirements|Expand/),
    );
  },
);

// Bookmarklet request counts exclude the independently tested advisory lookup.
vi.mock('../src/features/inbox/DuplicateJobNotice', () => ({
  DuplicateJobNotice: () => null,
}));
