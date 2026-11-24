import { expect, jest, test } from '@jest/globals';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ClientRequest } from 'node:http';
import type { RequestOptions } from 'node:https';
import {
  isPublicJobAddress,
  PinnedJobPageTransport,
  type JobHttpDependencies,
} from '../../src/opportunities/job-url.transport.js';
import { previewJobUrl } from '../../src/opportunities/job-url-import.js';
import { UrlImportError } from '../../src/opportunities/job-url-errors.js';
const url = 'https://itviec.com/it-jobs/synthetic?ref=personal';
const html =
  '<script type="application/ld+json">{"@type":"JobPosting","title":"Synthetic engineer","description":"Build Java services"}</script>';
const options = () => ({
  signal: new AbortController().signal,
  redirect: 'error' as const,
  credentials: 'omit' as const,
});
function fixture(
  status = 200,
  headers: Record<string, string> = { 'content-type': 'text/html' },
) {
  const stream = new PassThrough();
  const response = Object.assign(stream, {
    statusCode: status,
    headers,
  }) as unknown as IncomingMessage;
  const req = Object.assign(new EventEmitter(), {
    end: jest.fn(() => {
      queueMicrotask(() => {
        callback(response);
        if (!response.destroyed) stream.end(html);
      });
    }),
  }) as unknown as ClientRequest;
  let callback!: (response: IncomingMessage) => void;
  let captured!: RequestOptions;
  const resolve = jest.fn<
    (hostname: string) => Promise<{ address: string; family: number }[]>
  >(async () => [{ address: '8.8.8.8', family: 4 }]);
  const open = jest.fn(
    (request: RequestOptions, cb: (response: IncomingMessage) => void) => {
      captured = request;
      callback = cb;
      return req;
    },
  );
  return {
    dependencies: { resolve, open } satisfies JobHttpDependencies,
    response,
    captured: () => captured,
  };
}
test.each([
  '127.0.0.1',
  '10.0.0.1',
  '172.16.0.1',
  '192.168.1.1',
  '169.254.169.254',
  '100.100.100.200',
  '0.0.0.0',
  '192.0.2.1',
  '198.18.0.1',
  '198.51.100.1',
  '203.0.113.1',
  '224.0.0.1',
  '255.255.255.255',
  '::',
  '::1',
  'fc00::1',
  'fe80::1',
  'ff02::1',
  '::ffff:127.0.0.1',
  '::ffff:8.8.8.8',
  '64:ff9b::a00:1',
  '2001:db8::1',
  '2002:7f00:1::',
  '3fff::1',
  'invalid',
])('rejects nonpublic or translated destinations: %s', (address) => {
  expect(isPublicJobAddress(address)).toBe(false);
});
test.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])(
  'accepts public destinations: %s',
  (address) => {
    expect(isPublicJobAddress(address)).toBe(true);
  },
);
test('pins checked IP without second DNS lookup and retains TLS hostname and Host', async () => {
  const f = fixture();
  const result = await previewJobUrl(
    url,
    new PinnedJobPageTransport(f.dependencies),
  );
  expect(result.title).toBe('Synthetic engineer');
  expect(result.originalLink).toBe(url);
  expect(f.dependencies.resolve).toHaveBeenCalledTimes(1);
  expect(f.dependencies.resolve).toHaveBeenCalledWith('itviec.com');
  expect(f.dependencies.open).toHaveBeenCalledTimes(1);
  expect(f.captured()).toMatchObject({
    hostname: '8.8.8.8',
    family: 4,
    port: 443,
    servername: 'itviec.com',
    rejectUnauthorized: true,
    agent: false,
    method: 'GET',
    path: '/it-jobs/synthetic?ref=personal',
    headers: {
      Host: 'itviec.com',
      Accept: 'text/html',
      'Accept-Encoding': 'identity',
    },
  });
  expect(f.captured().lookup).toBeUndefined();
  expect(f.captured().checkServerIdentity).toEqual(expect.any(Function));
  const headerNames = Object.keys(f.captured().headers!).map((key) =>
    key.toLowerCase(),
  );
  for (const forbidden of [
    'cookie',
    'authorization',
    'proxy-authorization',
    'referer',
  ])
    expect(headerNames).not.toContain(forbidden);
});
test.each(
  [
    [],
    [{ address: '127.0.0.1', family: 4 }],
    [
      { address: '8.8.8.8', family: 4 },
      { address: '::1', family: 6 },
    ],
    [{ address: '8.8.8.8', family: 6 }],
  ].map((addresses) => ({ addresses })),
)(
  'rejects empty, mixed, private or malformed DNS answers before connecting',
  async ({ addresses }) => {
    const f = fixture();
    f.dependencies.resolve.mockResolvedValue(addresses);
    await expect(
      new PinnedJobPageTransport(f.dependencies).get(url, options()),
    ).rejects.toThrow('public addresses');
    expect(f.dependencies.open).not.toHaveBeenCalled();
  },
);
test.each([
  'https://topcv.vn/viec-lam/synthetic',
  'https://www.topcv.vn/viec-lam/synthetic',
  'https://itviec.com.evil.example/it-jobs/a',
  'http://itviec.com/it-jobs/a',
  'https://itviec.com:3000/it-jobs/a',
  'https://user:pass@itviec.com/it-jobs/a',
  'https://itviec.com/customer',
  'https://127.0.0.1/',
])('rejects prohibited sources/URLs before DNS: %s', (link) => {
  const f = fixture();
  return expect(new PinnedJobPageTransport(f.dependencies).get(link, options()))
    .rejects.toThrow()
    .then(() => {
      expect(f.dependencies.resolve).not.toHaveBeenCalled();
      expect(f.dependencies.open).not.toHaveBeenCalled();
    });
});
test.each([
  [302, { location: 'https://itviec.com/it-jobs/another' }],
  [302, { location: 'http://127.0.0.1' }],
  [403, {}],
  [429, {}],
  [404, {}],
  [410, {}],
  [204, {}],
  [206, {}],
  [200, { 'content-type': 'application/json' }],
  [200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }],
  [200, { 'content-type': 'text/html', 'content-length': '3000000' }],
] as [number, Record<string, string>][])(
  'rejects response %s without retry and closes body',
  async (status, headers) => {
    const f = fixture(status, headers);
    await expect(
      new PinnedJobPageTransport(f.dependencies).get(url, options()),
    ).rejects.toThrow();
    expect(f.dependencies.open).toHaveBeenCalledTimes(1);
    expect(f.response.destroyed).toBe(true);
  },
);
test('aborting during DNS prevents any later connection', async () => {
  const f = fixture();
  let release!: (addresses: { address: string; family: number }[]) => void;
  f.dependencies.resolve.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const controller = new AbortController();
  const pending = new PinnedJobPageTransport(f.dependencies).get(url, {
    ...options(),
    signal: controller.signal,
  });
  controller.abort();
  release([{ address: '8.8.8.8', family: 4 }]);
  await expect(pending).rejects.toThrow();
  expect(f.dependencies.open).not.toHaveBeenCalled();
});
test.each([
  [403, {}, 'URL_IMPORT_BLOCKED'],
  [429, {}, 'URL_IMPORT_BLOCKED'],
  [
    200,
    { 'content-type': 'text/html', 'cf-mitigated': 'challenge' },
    'URL_IMPORT_BLOCKED',
  ],
  [503, {}, 'URL_IMPORT_UNAVAILABLE'],
  [404, {}, 'URL_IMPORT_NOT_FOUND'],
  [302, { location: 'https://itviec.com/it-jobs/x' }, 'URL_IMPORT_REDIRECT'],
] as [number, Record<string, string>, string][])(
  'response %s maps to a stable error code with the upstream status',
  async (status, headers, errorCode) => {
    const f = fixture(status, headers);
    const error = await new PinnedJobPageTransport(f.dependencies)
      .get(url, options())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UrlImportError);
    expect((error as UrlImportError).errorCode).toBe(errorCode);
    expect((error as UrlImportError).upstreamStatus).toBe(status);
    expect((error as UrlImportError).getResponse()).toEqual(
      expect.objectContaining({ errorCode }),
    );
    expect(f.dependencies.open).toHaveBeenCalledTimes(1);
  },
);
test('turned-off source reports URL_IMPORT_SOURCE_OFF', async () => {
  const f = fixture();
  const error = await new PinnedJobPageTransport(f.dependencies, new Set())
    .get(url, options())
    .catch((e: unknown) => e);
  expect((error as UrlImportError).errorCode).toBe('URL_IMPORT_SOURCE_OFF');
  expect(f.dependencies.open).not.toHaveBeenCalled();
});
