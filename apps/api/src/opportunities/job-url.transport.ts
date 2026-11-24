import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import type { RequestOptions } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { BlockList, isIP } from 'node:net';
import { Readable } from 'node:stream';
import { checkServerIdentity } from 'node:tls';
import { UrlImportError, type UrlImportErrorCode } from './job-url-errors.js';
import { validateJobUrl, type JobPageTransport } from './job-url-import.js';

const denied = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  denied.addSubnet(network, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [network, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const)
  denied.addSubnet(network, prefix, 'ipv6');
export function isPublicJobAddress(address: string): boolean {
  if (isIP(address) === 4) return !denied.check(address, 'ipv4');
  if (isIP(address) === 6)
    return globalV6.check(address, 'ipv6') && !denied.check(address, 'ipv6');
  return false;
}
/** ITviec is always on; TopCV/VietnamWorks need JOB_URL_FETCH_<SOURCE>=1 (content-use review pending). */
export function liveJobSources(
  env: NodeJS.ProcessEnv = process.env,
): ReadonlySet<string> {
  return new Set([
    'ITviec',
    ...(env.JOB_URL_FETCH_TOPCV === '1' ? ['TopCV'] : []),
    ...(env.JOB_URL_FETCH_VIETNAMWORKS === '1' ? ['VietnamWorks'] : []),
  ]);
}
const JOB_PATHS: Record<string, { pattern: RegExp; hint: string }> = {
  ITviec: {
    pattern: /^\/it-jobs\//u,
    hint: 'an individual ITviec job URL under /it-jobs/',
  },
  TopCV: {
    pattern: /^\/viec-lam\/[^/]+\/\d+\.html$/u,
    hint: 'an individual TopCV job URL such as /viec-lam/<title>/<id>.html',
  },
  VietnamWorks: {
    pattern: /^\/[^/]+-\d+-jv$/u,
    hint: 'an individual VietnamWorks job URL ending in -jv',
  },
};
export function permittedLiveJobUrl(
  value: unknown,
  sources: ReadonlySet<string> = liveJobSources(),
): string {
  const { url, platform } = validateJobUrl(value);
  if (!sources.has(platform))
    throw new UrlImportError(
      'URL_IMPORT_SOURCE_OFF',
      `${platform} link import is turned off on this server. Use the page-import bookmark or paste the JD.`,
      403,
    );
  const rule = JOB_PATHS[platform]!;
  if (!rule.pattern.test(new URL(url).pathname))
    throw new UrlImportError(
      'URL_IMPORT_INVALID_URL',
      `Use ${rule.hint}, or paste the JD.`,
    );
  return url;
}
type Destination = { address: string; family: number };
export interface JobHttpDependencies {
  resolve(hostname: string): Promise<Destination[]>;
  open(
    options: RequestOptions,
    callback: (response: IncomingMessage) => void,
  ): ClientRequest;
}
const liveDependencies: JobHttpDependencies = {
  resolve: (hostname) => lookup(hostname, { all: true, verbatim: true }),
  open: (options, callback) => request(options, callback),
};

export class PinnedJobPageTransport implements JobPageTransport {
  constructor(
    private readonly dependencies: JobHttpDependencies = liveDependencies,
    private readonly sources: ReadonlySet<string> = liveJobSources(),
  ) {}
  async get(
    value: string,
    options: Parameters<JobPageTransport['get']>[1],
  ): Promise<Response> {
    const url = new URL(permittedLiveJobUrl(value, this.sources));
    options.signal.throwIfAborted();
    const addresses = await this.dependencies.resolve(url.hostname);
    options.signal.throwIfAborted();
    // Reject the entire DNS answer if it includes a non-public destination.
    if (
      !addresses.length ||
      addresses.some(
        (row) =>
          !isPublicJobAddress(row.address) || isIP(row.address) !== row.family,
      )
    )
      throw new UrlImportError(
        'URL_IMPORT_INVALID_URL',
        'Job hostname did not resolve exclusively to public addresses. Paste the JD instead.',
      );
    const destination = addresses[0]!;
    return new Promise<Response>((resolve, reject) => {
      const req = this.dependencies.open(
        {
          protocol: 'https:',
          hostname: destination.address,
          family: destination.family,
          port: 443,
          servername: url.hostname,
          // Connect to the checked literal IP. No second DNS lookup, reused socket,
          // proxy, redirect, cookie jar, or caller-supplied headers are involved.
          agent: false,
          method: 'GET',
          // Tracking parameters are dropped for TopCV/VietnamWorks; ITviec keeps its query.
          path: [
            'topcv.vn',
            'www.topcv.vn',
            'vietnamworks.com',
            'www.vietnamworks.com',
          ].includes(url.hostname)
            ? url.pathname
            : `${url.pathname}${url.search}`,
          signal: options.signal,
          rejectUnauthorized: true,
          checkServerIdentity: (_hostname, certificate) =>
            checkServerIdentity(url.hostname, certificate),
          headers: {
            Host: url.hostname,
            Accept: 'text/html',
            'Accept-Encoding': 'identity',
            'User-Agent': 'AI-Job-Hunter/0.1 (personal URL import)',
          },
        },
        (response) => {
          const status = response.statusCode ?? 502;
          const fail = (code: UrlImportErrorCode, message: string) => {
            response.destroy();
            reject(new UrlImportError(code, message, 400, status));
          };
          if (status >= 300 && status < 400)
            return fail(
              'URL_IMPORT_REDIRECT',
              'Redirected job pages are not supported. Use the final public job URL or paste the JD.',
            );
          if (status === 404 || status === 410)
            return fail(
              'URL_IMPORT_NOT_FOUND',
              'This job page is no longer available. Paste the JD if you have it.',
            );
          // A Cloudflare challenge header marks a bot check even on a 200 response.
          if (
            response.headers['cf-mitigated'] ||
            [401, 403, 429, 451].includes(status)
          )
            return fail(
              'URL_IMPORT_BLOCKED',
              'The job site blocked automated access. No retry was attempted; paste the JD instead.',
            );
          if (status !== 200)
            return fail(
              'URL_IMPORT_UNAVAILABLE',
              'Job page is temporarily unavailable. Try again later or paste the JD.',
            );
          if (
            !/^text\/html(?:\s*;|$)/i.test(
              response.headers['content-type'] ?? '',
            )
          )
            return fail(
              'URL_IMPORT_UNSUPPORTED_CONTENT',
              'Expected an HTML job page. Paste the JD instead.',
            );
          if (
            response.headers['content-encoding'] &&
            response.headers['content-encoding'] !== 'identity'
          )
            return fail(
              'URL_IMPORT_UNSUPPORTED_CONTENT',
              'Unsupported job page encoding. Paste the JD instead.',
            );
          if (Number(response.headers['content-length']) > 2 * 1024 * 1024)
            return fail(
              'URL_IMPORT_TOO_LARGE',
              'Job page exceeds the import size limit. Paste the JD instead.',
            );
          const headers = new Headers();
          headers.set('Content-Type', response.headers['content-type']!);
          if (response.headers['content-length'])
            headers.set('Content-Length', response.headers['content-length']);
          resolve(
            new Response(
              Readable.toWeb(response) as ReadableStream<Uint8Array>,
              { status, headers },
            ),
          );
        },
      );
      req.once('error', reject);
      req.end();
    });
  }
}
