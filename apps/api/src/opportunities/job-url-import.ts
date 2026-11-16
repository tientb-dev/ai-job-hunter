import { itviecMetadata, type ItviecMetadata } from './itviec-metadata.js';
import {
  salaryEvidence,
  structuredSalaryEvidence,
  type SalaryEvidence,
} from './job-import.salary.js';
import { BadRequestException, HttpException } from '@nestjs/common';
import { vietnamworksJsonLd } from './vietnamworks-page.js';
import { mergeCandidates, type ImportField } from './job-import.contract.js';
import {
  recruiterContactCandidates,
  sourceCandidates,
} from './job-import.evidence.js';

const MAX_BYTES = 2 * 1024 * 1024;
export function validateJobUrl(value: unknown): {
  url: string;
  platform: string;
} {
  try {
    if (typeof value !== 'string' || value.length > 2048) throw new Error();
    const url = new URL(value);
    const hosts: Record<string, string> = {
      'itviec.com': 'ITviec',
      'www.itviec.com': 'ITviec',
      'topcv.vn': 'TopCV',
      'www.topcv.vn': 'TopCV',
      'vietnamworks.com': 'VietnamWorks',
      'www.vietnamworks.com': 'VietnamWorks',
    };
    if (
      url.protocol !== 'https:' ||
      url.port ||
      url.username ||
      url.password ||
      !Object.hasOwn(hosts, url.hostname)
    )
      throw new Error();
    return { url: value, platform: hosts[url.hostname]! };
  } catch {
    throw new BadRequestException(
      'Use a public HTTPS ITviec, TopCV or VietnamWorks job URL without credentials or a custom port.',
    );
  }
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
// Strip markup, including executable content; the result is always rendered as text.
function plain(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(
      /<\s*(?:br\b[^>]*|\/p|\/div|\/li|\/?h[1-6]|\/?ul|\/?ol)\s*>/gi,
      '\n',
    )
    .replace(/<[^>]*>/g, '')
    .replace(
      /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
      (entity, key: string) => {
        const named: Record<string, string> = {
          amp: '&',
          lt: '<',
          gt: '>',
          quot: '"',
          apos: "'",
          nbsp: ' ',
        };
        if (!key.startsWith('#')) return named[key.toLowerCase()] ?? entity;
        const number = key.toLowerCase().startsWith('#x')
          ? parseInt(key.slice(2), 16)
          : Number(key.slice(1));
        return number > 0 &&
          number <= 0x10ffff &&
          !(number >= 0xd800 && number <= 0xdfff)
          ? String.fromCodePoint(number)
          : entity;
      },
    )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}
export interface UrlJobPreview {
  originalLink: string;
  platform: string;
  title: string;
  company: string;
  location: string;
  description: string;
  validThrough: string | null;
  expired: boolean;
  sourceText: string;
  salary: string;
  salaryDetails: SalaryEvidence | null;
  sourceMetadata?: ItviecMetadata;
  domain?: string;
}
export function parseJobPosting(
  html: string,
  originalLink: string,
  now = Date.now(),
): UrlJobPreview {
  const { platform } = validateJobUrl(originalLink);
  if (Buffer.byteLength(html) > MAX_BYTES)
    throw new BadRequestException(
      'Job page exceeds the import size limit. Paste the JD instead.',
    );
  const jobs: Record<string, unknown>[] = [];
  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const row = record(value);
    if (!row) return;
    if ([row['@type']].flat().includes('JobPosting')) jobs.push(row);
    if (row['@graph']) visit(row['@graph']);
  }
  for (const script of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
  )) {
    if (!/\btype\s*=\s*["']application\/ld\+json["']/i.test(script[1]!))
      continue;
    try {
      visit(JSON.parse(script[2]!));
    } catch {
      /* Ignore invalid JSON-LD blocks, never execute them. */
    }
  }
  if (jobs.length !== 1)
    throw new BadRequestException(
      'Expected one JobPosting on this page. Paste the specific JD instead.',
    );
  const job = jobs[0]!;
  const sourceMetadata =
    platform === 'ITviec' ? itviecMetadata(html) : undefined;
  const descriptionParts = [plain(job.description)];
  // JobPosting may keep the actual requirements outside its description.
  for (const [key, label] of [
    ['qualifications', 'Requirements'],
    ['skills', 'Supplemental skill tags (not requirements)'],
    ['responsibilities', 'Responsibilities'],
    ['industry', 'Source industry'],
  ] as const) {
    if (key === 'skills' && sourceMetadata?.skills.length) continue;
    const content = [job[key]].flat().map(plain).filter(Boolean).join('\n');
    if (content && !descriptionParts.join('\n').includes(content)) {
      const evidence =
        key === 'skills' ? content.replace(/\n/gu, ', ') : content;
      descriptionParts.push(
        `${label}:${key === 'skills' ? ' ' : '\n'}${evidence}`,
      );
    }
  }
  if (sourceMetadata?.skills.length)
    descriptionParts.push(
      `Supplemental skill tags (not requirements): ${sourceMetadata.skills.join('; ')}`,
    );
  if (sourceMetadata?.jobExpertise.length)
    descriptionParts.push(
      `ITviec Job Expertise: ${sourceMetadata.jobExpertise.join('; ')}`,
    );
  if (sourceMetadata?.jobDomains.length)
    descriptionParts.push(
      `ITviec Job Domain:\n${sourceMetadata.jobDomains.join('\n')}\nEnd ITviec Job Domain`,
    );
  const domain = sourceMetadata?.jobDomains.join('; ');
  if (domain && domain.length > 2000)
    throw new BadRequestException(
      'Job domains exceed the field limit. Paste the relevant JD content manually.',
    );
  const description = descriptionParts.filter(Boolean).join('\n');
  if (!description)
    throw new BadRequestException(
      'No job description found. Paste the JD instead.',
    );
  const title = plain(job.title);
  const company = plain(record(job.hiringOrganization)?.name);
  const locations = [job.jobLocation]
    .flat()
    .map((entry: unknown) => {
      const place = record(entry);
      const address = record(place?.address);
      return address
        ? [
            'streetAddress',
            'addressLocality',
            'addressRegion',
            'addressCountry',
          ]
            .map((key) => {
              const value = address[key];
              return plain(
                typeof value === 'string' ? value : record(value)?.name,
              );
            })
            .filter(Boolean)
            .join(', ')
        : plain(place?.name);
    })
    .filter(Boolean);
  const location = [...new Set(locations)].join('; ');
  const validThrough =
    typeof job.validThrough === 'string' &&
    Number.isFinite(Date.parse(job.validThrough))
      ? job.validThrough
      : null;
  // Date-only validity includes the stated day; no expiry is invented when absent.
  const expiry =
    validThrough && /^\d{4}-\d{2}-\d{2}$/.test(validThrough)
      ? Date.parse(`${validThrough}T23:59:59.999Z`)
      : Date.parse(validThrough ?? '');
  // Inspect explicitly named salary metadata only; never scan arbitrary page
  // numbers, benefits, scripts, login prompts or market-rate widgets.
  const baseSalary = record(job.baseSalary);
  const structured = structuredSalaryEvidence(baseSalary);
  const salaryTexts = [
    typeof job.baseSalary === 'string' ? job.baseSalary : '',
    baseSalary?.description,
    baseSalary?.name,
  ]
    .map(plain)
    .filter(Boolean);
  const quantity = record(baseSalary?.value);
  const statedValue = quantity?.value;
  const rawAmount =
    typeof statedValue === 'string'
      ? plain(statedValue)
      : typeof statedValue === 'number' &&
          Number.isFinite(statedValue) &&
          statedValue > 0
        ? String(statedValue)
        : '';
  const amount = salaryEvidence(rawAmount);
  if (amount) {
    let display = rawAmount;
    // Currency and period come only from explicit adjacent salary metadata.
    if (
      !amount.currency &&
      typeof baseSalary?.currency === 'string' &&
      /^[A-Z]{3}$/i.test(baseSalary.currency)
    ) {
      const numeric =
        amount.maximum !== null
          ? amount.minimum !== null
            ? `${amount.minimum}-${amount.maximum}`
            : `Up to ${amount.maximum}`
          : /^\d[\d,.]*/u.exec(rawAmount)?.[0];
      if (numeric)
        display = `${numeric} ${baseSalary.currency}${amount.basis ? ` ${amount.basis}` : ''}${amount.payPeriod ? ` per ${amount.payPeriod}` : ''}`;
    }
    if (
      !amount.payPeriod &&
      typeof quantity?.unitText === 'string' &&
      /^(?:MONTH|YEAR|HOUR|DAY)$/i.test(quantity.unitText)
    )
      display += ` per ${quantity.unitText}`;
    salaryTexts.push(display);
  }

  const structuredText = structured
    ? `${structured.minimum === null ? 'Up to ' : `${structured.minimum}-`}${structured.maximum} ${structured.currency}${structured.payPeriod ? ` per ${structured.payPeriod}` : ''}`
    : '';
  // Prefer usable JobPosting data; the header supplements missing details or
  // supplies a salary when metadata is absent/undisclosed. Keep contradictions.

  const publicHtml = html
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  for (const match of publicHtml.matchAll(
    /<([a-z][a-z0-9]*)\b([^>]*(?:\bitemprop\s*=\s*["']baseSalary["']|\bclass\s*=\s*["'][^"']*\bsalary\b[^"']*["'])[^>]*)>([\s\S]*?)<\/\1\s*>/gi,
  )) {
    const attributes = match[2]!;
    const semantic = /\bitemprop\s*=\s*["']baseSalary["']/i.test(attributes);
    const classes =
      /\bclass\s*=\s*["']([^"']*)["']/i.exec(attributes)?.[1]?.split(/\s+/) ??
      [];
    // A literal salary field is accepted; market-salary/bonus widgets are not.
    if (!semantic && !classes.includes('salary')) continue;
    if (
      /\bhidden(?:\s|=|$)|aria-hidden\s*=\s*["']true["']|display\s*:\s*none/i.test(
        attributes,
      )
    )
      continue;
    salaryTexts.push(plain(match[3]));
  }
  const verifiedSalaries = [
    ...new Set(
      [...salaryTexts, structuredText].filter((text) => salaryEvidence(text)),
    ),
  ];
  // A complete source text may add net/gross to an otherwise identical value.
  // Different numeric amounts remain conflicts; placeholders never enter this list.
  const normalizedSalary = (value: string) =>
    value.toLowerCase().replace(/\s+/g, ' ').trim();
  const salary =
    verifiedSalaries.find((value) =>
      verifiedSalaries.every((part) =>
        normalizedSalary(value).includes(normalizedSalary(part)),
      ),
    ) ?? '';
  const salaryDetails =
    salary === structuredText && structured && !salaryTexts.includes(salary)
      ? structured
      : salaryEvidence(salary);
  const salarySources = verifiedSalaries.map((text) => `Salary: ${text}`);
  if (salary && !salarySources.length) salarySources.push(`Salary: ${salary}`);
  if (baseSalary)
    salarySources.push(`Salary metadata: ${JSON.stringify(baseSalary)}`);
  const sourceText = [
    title && `Job title: ${title}`,
    company && `Company: ${company}`,
    location && `Location: ${location}`,
    `Original URL: ${originalLink}`,
    ...salarySources,
    description,
  ]
    .filter(Boolean)
    .join('\n');
  if (sourceText.length > 12000)
    throw new BadRequestException(
      'Job content exceeds the paste limit. Paste the relevant JD content manually.',
    );
  return {
    ...(sourceMetadata ? { sourceMetadata } : {}),
    ...(domain ? { domain } : {}),
    originalLink,
    platform,
    title,
    company,
    location,
    description,
    salary,
    salaryDetails,
    validThrough,
    expired: Boolean(validThrough && expiry < now),
    sourceText,
  };
}

// The production adapter pins a validated public IP; fixtures inject an in-memory transport.
export interface JobPageTransport {
  get(
    url: string,
    options: { signal: AbortSignal; redirect: 'error'; credentials: 'omit' },
  ): Promise<Response>;
}
export async function previewJobUrl(
  value: unknown,
  transport: JobPageTransport,
  timeoutMs = 5000,
): Promise<UrlJobPreview> {
  const { url, platform } = validateJobUrl(value);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const operation = async () => {
    const response = await transport.get(url, {
      signal: controller.signal,
      redirect: 'error',
      credentials: 'omit',
    });
    if (
      (response.status >= 300 && response.status < 400) ||
      response.redirected
    )
      throw new BadRequestException(
        'Redirected job pages are not supported. Paste the JD instead.',
      );
    if (!response.ok)
      throw new BadRequestException(
        'Job page is unavailable or access is blocked. Paste the JD instead.',
      );
    if (
      !/^text\/html(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')
    )
      throw new BadRequestException(
        'Expected an HTML job page. Paste the JD instead.',
      );
    if (Number(response.headers.get('content-length')) > MAX_BYTES)
      throw new BadRequestException('Job page exceeds the import size limit.');
    const reader = response.body?.getReader();
    if (!reader) throw new BadRequestException('Job page is empty.');
    const cancel = () => {
      void reader.cancel().catch(() => undefined);
    };
    controller.signal.addEventListener('abort', cancel, { once: true });
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_BYTES)
          throw new BadRequestException(
            'Job page exceeds the import size limit.',
          );
        chunks.push(chunk.value);
      }
    } finally {
      controller.signal.removeEventListener('abort', cancel);
      await reader.cancel();
    }
    const html = Buffer.concat(chunks).toString('utf8');
    return parseJobPosting(
      platform === 'VietnamWorks' ? vietnamworksJsonLd(html) : html,
      url,
    );
  };
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            new BadRequestException(
              'Job page request timed out. Paste the JD instead.',
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
export class JobUrlImportService {
  private busy = false;
  constructor(private readonly transport: JobPageTransport) {}
  async preview(value: unknown): Promise<UrlJobPreview> {
    validateJobUrl(value);
    if (this.busy)
      throw new HttpException(
        'A job URL import is already running. Wait before trying again.',
        429,
      );
    this.busy = true;
    try {
      return await previewJobUrl(value, this.transport);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(
        'Could not retrieve the public job page. Check the URL or paste the JD instead.',
      );
    } finally {
      this.busy = false;
    }
  }
}

/**
 * Field suggestions from the imported text with the extraction's deterministic
 * parsers only (its no-AI fallback path); values are quoted source evidence.
 */
export function withSourceFields<T extends { sourceText: string }>(
  preview: T,
): T & { fields: ImportField[] } {
  const text = preview.sourceText;
  const candidates = recruiterContactCandidates(sourceCandidates(text, ''), '');
  return {
    ...preview,
    fields: mergeCandidates({ candidates }, text, '').fields,
  };
}
