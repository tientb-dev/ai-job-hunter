import { expect, jest, test } from '@jest/globals';
import { Logger } from '@nestjs/common';
import { UrlImportError } from '../../src/opportunities/job-url-errors.js';
import {
  JobUrlImportService,
  parseJobPosting,
  previewJobUrl,
  validateJobUrl,
} from '../../src/opportunities/job-url-import.js';
const url = 'https://itviec.com/it-jobs/synthetic';
const job = {
  '@type': 'JobPosting',
  title: 'Backend Engineer',
  hiringOrganization: { name: 'Synthetic &amp; Co' },
  jobLocation: {
    address: { addressLocality: 'Ho Chi Minh City', addressCountry: 'VN' },
  },
  description: '<p>Build Java &amp; Spring services.</p><p>Use SQL.</p>',
  validThrough: '2026-11-06',
};
const html = (data: unknown = job) =>
  `<html><script type="application/ld+json">${JSON.stringify(data)}</script></html>`;
const transport = (response: Response) => ({
  get: jest.fn<
    (
      url: string,
      options: { signal: AbortSignal; redirect: 'error'; credentials: 'omit' },
    ) => Promise<Response>
  >(async () => response),
});
test.each([url, 'https://www.topcv.vn/viec-lam/synthetic.html'])(
  'extracts synthetic title/company/location/description and expiry: %s',
  (link) => {
    const result = parseJobPosting(
      html(),
      link,
      Date.parse('2026-11-06T12:00:00Z'),
    );
    expect(result).toMatchObject({
      originalLink: link,
      title: 'Backend Engineer',
      company: 'Synthetic & Co',
      location: 'Ho Chi Minh City, VN',
      description: 'Build Java & Spring services.\nUse SQL.',
      validThrough: '2026-11-06',
      expired: false,
    });
    expect(
      parseJobPosting(html(), link, Date.parse('2026-11-07')).expired,
    ).toBe(true);
  },
);
test('handles arrays and graphs, ignores malformed blocks, preserves unknown fields', () => {
  const result = parseJobPosting(
    '<script type="application/ld+json">bad json</script>' +
      html({
        '@graph': [
          { '@type': 'Organization' },
          { '@type': ['JobPosting'], description: 'Synthetic JD' },
        ],
      }),
    url,
  );
  expect(result).toMatchObject({
    title: '',
    company: '',
    location: '',
    validThrough: null,
    expired: false,
  });
  expect(parseJobPosting(html([job]), url).title).toBe(job.title);
});
test('rejects missing descriptions, ambiguous listings and oversized HTML', () => {
  for (const input of [
    html({ ...job, description: '' }),
    html([job, job]),
    'x'.repeat(2 * 1024 * 1024 + 1),
    '<html>no job</html>',
  ])
    expect(() => parseJobPosting(input, url)).toThrow();
});
test.each([
  'http://itviec.com/job',
  'https://127.0.0.1/job',
  'https://[::1]/job',
  'https://itviec.com.evil.example/job',
  'https://evil.itviec.com/job',
  'https://topcv.vn:8080/job',
  'https://user:pass@topcv.vn/job',
  'file:///etc/passwd',
  'https://constructor/job',
  '',
])('rejects unsafe URL before transport: %s', async (link) => {
  const source = transport(new Response(''));
  expect(() => validateJobUrl(link)).toThrow();
  await expect(previewJobUrl(link, source)).rejects.toThrow();
  expect(source.get).not.toHaveBeenCalled();
});
test('service uses fixture transport and sanitizes network errors', async () => {
  const source = transport(
    new Response(html(), { headers: { 'Content-Type': 'text/html' } }),
  );
  expect((await new JobUrlImportService(source).preview(url)).title).toBe(
    job.title,
  );
  const failing = {
    get: jest.fn(async () => {
      throw new Error('private network details');
    }),
  };
  await expect(new JobUrlImportService(failing).preview(url)).rejects.toThrow(
    'Could not retrieve the public job page',
  );
});
test('service rejects overlapping imports without starting a second request', async () => {
  let release!: (response: Response) => void;
  const source = {
    get: jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    ),
  };
  const service = new JobUrlImportService(source);
  const first = service.preview(url);
  await expect(service.preview(url)).rejects.toThrow('already running');
  release(new Response(html(), { headers: { 'Content-Type': 'text/html' } }));
  await first;
  expect(source.get).toHaveBeenCalledTimes(1);
});
test('fixture transport uses no cookies, refuses redirects and parses successful HTML', async () => {
  const source = transport(
    new Response(html(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }),
  );
  expect((await previewJobUrl(url, source)).title).toBe(job.title);
  expect(source.get).toHaveBeenCalledWith(url, {
    signal: expect.any(AbortSignal),
    redirect: 'error',
    credentials: 'omit',
  });
});
test.each([
  new Response(null, {
    status: 302,
    headers: { Location: 'http://127.0.0.1' },
  }),
  new Response('blocked', { status: 403 }),
  new Response('rate limit', { status: 429 }),
  new Response('{}', { headers: { 'Content-Type': 'application/json' } }),
  new Response(html(), {
    headers: { 'Content-Type': 'text/html', 'Content-Length': '3000000' },
  }),
  new Response('x'.repeat(2 * 1024 * 1024 + 1), {
    headers: { 'Content-Type': 'text/html' },
  }),
])('rejects unsafe or oversized responses', async (response) => {
  await expect(previewJobUrl(url, transport(response))).rejects.toThrow();
});
test('bounds a stalled transport even if it ignores AbortSignal', async () => {
  const source = { get: jest.fn(() => new Promise<Response>(() => {})) };
  await expect(previewJobUrl(url, source, 5)).rejects.toThrow('timed out');
});

test('bounds stalled body reads and cancels the fixture stream', async () => {
  const cancel = jest.fn(() => undefined);
  const body = new ReadableStream<Uint8Array>({ cancel });
  const response = new Response(body, {
    headers: { 'Content-Type': 'text/html' },
  });
  await expect(previewJobUrl(url, transport(response), 5)).rejects.toThrow(
    'timed out',
  );
  expect(cancel).toHaveBeenCalled();
});

const htmlResponse = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html' } });
test.each([
  '<html><head><title>Just a moment...</title></head><body></body></html>',
  // Managed challenge: the orchestrate script comes with its _cf_chl_opt config.
  '<html><script>window._cf_chl_opt={cType:"managed"}</script><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></html>',
  '<html><head><title>Attention Required! | Cloudflare</title></head></html>',
  '<html><body><div id="cf-browser-verification"></div></body></html>',
])('HTTP 200 bot challenge page is reported as blocked: %#', async (page) => {
  const error = await previewJobUrl(url, transport(htmlResponse(page))).catch(
    (e: unknown) => e,
  );
  expect((error as UrlImportError).errorCode).toBe('URL_IMPORT_BLOCKED');
  expect((error as UrlImportError).upstreamStatus).toBe(200);
});
test('a JD that mentions captcha, Cloudflare or bot checks is not a challenge', async () => {
  const preview = await previewJobUrl(
    url,
    transport(
      htmlResponse(
        html({
          ...job,
          description:
            '<p>Build CAPTCHA and bot-detection services behind Cloudflare. Just a moment of your time: attention required to detail.</p>',
        }),
      ),
    ),
  );
  expect(preview.description).toContain('CAPTCHA');
});
test.each([
  [403, 'URL_IMPORT_BLOCKED'],
  [500, 'URL_IMPORT_UNAVAILABLE'],
])(
  'non-OK %s from a fixture transport has a stable code',
  async (status, code) => {
    const error = await previewJobUrl(
      url,
      transport(htmlResponse('x', status)),
    ).catch((e: unknown) => e);
    expect((error as UrlImportError).errorCode).toBe(code);
  },
);
test('pages without one JobPosting report URL_IMPORT_NO_CONTENT', async () => {
  const error = await previewJobUrl(
    url,
    transport(htmlResponse('<html><p>No structured data</p></html>')),
  ).catch((e: unknown) => e);
  expect((error as UrlImportError).errorCode).toBe('URL_IMPORT_NO_CONTENT');
});
test('ITviec tracking parameters are removed and functional parameters kept', () => {
  expect(
    validateJobUrl(
      `${url}?utm_source=google&gclid=abc&lab_feature=preview&fbclid=x&UTM_Medium=cpc`,
    ).url,
  ).toBe(`${url}?lab_feature=preview`);
  expect(validateJobUrl(`${url}?utm_source=google`).url).toBe(url);
  expect(validateJobUrl(`${url}?click_source=x`).url).toBe(
    `${url}?click_source=x`,
  );
  const topcv = 'https://www.topcv.vn/viec-lam/synthetic/1.html?utm_source=x';
  expect(validateJobUrl(topcv).url).toBe(topcv);
});
test('cleaned ITviec URL is fetched and kept as the original link', async () => {
  const source = transport(htmlResponse(html()));
  const preview = await previewJobUrl(`${url}?gclid=abc`, source);
  expect(source.get.mock.calls[0]![0]).toBe(url);
  expect(preview.originalLink).toBe(url);
});
test('failures log platform, code and upstream status only', async () => {
  const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
  try {
    const service = new JobUrlImportService(
      transport(htmlResponse('blocked', 403)),
    );
    await expect(
      service.preview(`${url}?utm_source=secret-campaign`),
    ).rejects.toMatchObject({ errorCode: 'URL_IMPORT_BLOCKED' });
    expect(warn).toHaveBeenCalledWith(
      {
        event: 'JOB_URL_FETCH_FAILED',
        platform: 'ITviec',
        errorCode: 'URL_IMPORT_BLOCKED',
        upstreamStatus: 403,
      },
      'JobUrlImportService',
    );
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(
      /secret|it-jobs|blocked"/u,
    );
  } finally {
    warn.mockRestore();
  }
});

test('a valid job page with Cloudflare background JSD script is imported, not blocked', async () => {
  // Synthetic copy of the script Cloudflare injects into normal ITviec pages.
  const jsd = `<script>(function(){var u='/cdn-cgi/challenge-platform/scripts/jsd/main.js?ray=0000000000000000',a=document.createElement('script');a.src=u;document.head.appendChild(a);})();</script>`;
  const page = html().replace('</html>', `${jsd}</html>`);
  expect(page).toContain('/cdn-cgi/challenge-platform/');
  const preview = await previewJobUrl(url, transport(htmlResponse(page)));
  expect(preview.title).toBe(job.title);
  expect(preview.sourceText).toContain('Build Java');
});
