import { BadRequestException } from '@nestjs/common';

const unavailable = () =>
  new BadRequestException(
    'Could not find job details on this VietnamWorks page. Use the page-import bookmark or paste the JD instead.',
  );

/**
 * VietnamWorks job pages carry no JSON-LD; the job is server-rendered into the
 * Next.js flight stream (`self.__next_f.push([1, "..."])`). Rows are either
 * `<hex id>:<json>\n` or `<hex id>:T<hex byte length>,<text>` and values point at
 * other rows with "$<id>". Unknown row kinds are skipped, never evaluated.
 * shortcut: depends on an undocumented Next.js format; tests pin it, and an
 * unrecognised page fails closed with a paste fallback.
 */
function flightRows(html: string): Map<string, unknown> {
  let stream = '';
  for (const match of html.matchAll(
    /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g,
  )) {
    try {
      stream += JSON.parse(match[1]!) as string;
    } catch {
      /* Ignore malformed chunks. */
    }
  }
  const bytes = Buffer.from(stream, 'utf8');
  const rows = new Map<string, unknown>();
  let at = 0;
  while (at < bytes.length) {
    const colon = bytes.indexOf(0x3a, at);
    if (colon < 0) break;
    const id = bytes.toString('utf8', at, colon);
    if (!/^[0-9a-f]+$/.test(id)) {
      // Not a row start: resynchronise at the next line.
      const next = bytes.indexOf(0x0a, at);
      if (next < 0) break;
      at = next + 1;
      continue;
    }
    if (bytes[colon + 1] === 0x54 /* T */) {
      const comma = bytes.indexOf(0x2c, colon);
      const length = parseInt(bytes.toString('utf8', colon + 2, comma), 16);
      if (comma < 0 || !Number.isFinite(length)) break;
      rows.set(id, bytes.toString('utf8', comma + 1, comma + 1 + length));
      at = comma + 1 + length;
      continue;
    }
    let end = bytes.indexOf(0x0a, colon);
    if (end < 0) end = bytes.length;
    try {
      rows.set(id, JSON.parse(bytes.toString('utf8', colon + 1, end)));
    } catch {
      /* Non-JSON row kinds (HL, I, ...) are irrelevant. */
    }
    at = end + 1;
  }
  return rows;
}

function resolve(
  value: unknown,
  rows: Map<string, unknown>,
  depth = 0,
): unknown {
  if (depth > 5) return undefined;
  if (typeof value === 'string') {
    if (value.startsWith('$$')) return value.slice(1);
    const reference = /^\$([0-9a-f]+)$/.exec(value)?.[1];
    return reference ? resolve(rows.get(reference), rows, depth + 1) : value;
  }
  if (Array.isArray(value))
    return value.map((item) => resolve(item, rows, depth + 1));
  return value;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** Returns a single JSON-LD JobPosting script for the shared parser. */
export function vietnamworksJsonLd(html: string): string {
  const rows = flightRows(html);
  const jobs = [...rows.values()].filter(
    (row): row is Record<string, unknown> =>
      !!row &&
      typeof row === 'object' &&
      !Array.isArray(row) &&
      typeof (row as Record<string, unknown>).jobId === 'number' &&
      'jobDescription' in row,
  );
  const ids = new Set(jobs.map((job) => job.jobId));
  if (ids.size !== 1) throw unavailable();
  const job = jobs[0]!;
  const description = text(resolve(job.jobDescription, rows));
  if (!text(job.jobTitle) || !description.trim()) throw unavailable();
  const skills = resolve(job.skills, rows);
  const pretty = text(job.prettySalaryEN);
  const posting: Record<string, unknown> = {
    '@type': 'JobPosting',
    title: job.jobTitle,
    description,
    qualifications: text(resolve(job.jobRequirement, rows)) || undefined,
    skills: Array.isArray(skills)
      ? skills
          .map((skill) =>
            skill && typeof skill === 'object'
              ? text((skill as Record<string, unknown>).skillName)
              : '',
          )
          .filter(Boolean)
      : undefined,
    hiringOrganization: { name: text(job.companyName) },
    jobLocation: text(job.address) ? { name: job.address } : undefined,
    validThrough: text(job.expiredOn) || undefined,
    // Hidden salaries are "negotiable"; only a visible, stated range is kept.
    baseSalary:
      job.isSalaryVisible === true &&
      typeof job.salaryMax === 'number' &&
      job.salaryMax > 0
        ? {
            currency: text(job.salaryCurrency),
            value: {
              minValue: job.salaryMin,
              maxValue: job.salaryMax,
              ...(/\/month$/i.test(pretty) ? { unitText: 'MONTH' } : {}),
            },
          }
        : undefined,
  };
  return `<script type="application/ld+json">${JSON.stringify(posting).replace(/</g, '\\u003c')}</script>`;
}
