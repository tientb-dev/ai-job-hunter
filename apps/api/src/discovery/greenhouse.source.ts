import { jdRequirementLines } from '../extraction/jd-requirements.js';
import { Injectable } from '@nestjs/common';
import { supportedStacks, type DiscoveredJob } from './discovery.js';
import {
  DISCOVERY_SOURCES,
  greenhouseSourceKey,
} from './greenhouse-registry.js';
export { DISCOVERY_SOURCES } from './greenhouse-registry.js';
export function discoverySourceKey(
  discovery: DiscoveredJob['discovery'],
): string | undefined {
  return greenhouseSourceKey(discovery.sourceUrl);
}
type Source = { name: string; url: string };
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown, max: number): string =>
  typeof value === 'string' && value.length <= max ? value.trim() : '';
export function plainDescription(html: string): string {
  // Greenhouse content may encode HTML entities once or twice. Never render it as HTML.
  let value = html;
  for (let i = 0; i < 2; i++)
    value = value.replace(
      /&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/giu,
      (entity) => {
        const known: Record<string, string> = {
          '&amp;': '&',
          '&lt;': '<',
          '&gt;': '>',
          '&quot;': '"',
          '&apos;': "'",
          '&nbsp;': ' ',
        };
        if (known[entity]) return known[entity]!;
        const number = entity.toLowerCase().startsWith('&#x')
          ? parseInt(entity.slice(3, -1), 16)
          : Number(entity.slice(2, -1));
        return Number.isInteger(number) && number > 0 && number <= 0x10ffff
          ? String.fromCodePoint(number)
          : '';
      },
    );
  return value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, '')
    .replace(/<\/(?:p|div|li|h[1-6])\s*>|<br\s*\/?\s*>/giu, '\n')
    .replace(/<[^>]*>/gu, '')
    .replace(/[\t ]+/gu, ' ')
    .replace(/\n\s*\n/gu, '\n')
    .trim();
}
export function normalizeGreenhouse(
  payload: unknown,
  source: Source,
  at: string,
) {
  const data = object(payload);
  if (!Array.isArray(data.jobs) || data.jobs.length > 5000)
    throw new Error('Invalid feed');
  const jobs: DiscoveredJob[] = [];
  let invalid = 0;
  for (const raw of data.jobs) {
    const row = object(raw);
    const title = text(row.title, 300);
    const company = text(row.company_name, 300);
    const link = text(row.absolute_url, 2048);
    let safe = false;
    try {
      const url = new URL(link);
      safe =
        url.protocol === 'https:' &&
        ['job-boards.greenhouse.io', 'boards.greenhouse.io'].includes(
          url.hostname,
        ) &&
        !url.username &&
        !url.password &&
        !url.port &&
        /\/jobs\/\d+/u.test(url.pathname);
    } catch {
      /* Invalid source row. */
    }
    const content = text(row.content, 150000);
    const description = plainDescription(content);
    const id =
      Number.isSafeInteger(row.id) && Number(row.id) > 0 ? String(row.id) : '';
    // Some boards (e.g. Thoughtworks) link to their own careers site; use the
    // hosted Greenhouse URL built from the trusted board token, which redirects there.
    const token = /\/v1\/boards\/([a-z0-9-]+)\/jobs/u.exec(source.url)?.[1];
    let applyLink = link;
    if (!safe && id && token && /^https:\/\//u.test(link)) {
      applyLink = `https://job-boards.greenhouse.io/${token}/jobs/${id}`;
      safe = true;
    }
    if (!title || !id || !safe || !content || description.length > 26000) {
      invalid++;
      continue;
    }
    const location = text(object(row.location).name, 2000);
    const workMode =
      /\bhybrid (?:work|schedule|model|role|position)|\bwork(?:ing)? (?:mode|model|location)\s*[:—-]?\s*hybrid/iu.test(
        description,
      )
        ? 'Hybrid'
        : /(?:work(?:ing)? (?:mode|model|location)\s*[:—-]?\s*remote|fully remote|100% remote|remote (?:role|position))/iu.test(
              description,
            ) || /\bremote\b/iu.test(location)
          ? 'Remote'
          : /(?:work (?:location|mode)\s*[:—-]?[^\n]*onsite|on[- ]site (?:role|position)|office[- ]based)/iu.test(
                description,
              )
            ? 'Onsite'
            : '';
    let seniority =
      /\b(?:technical|tech) lead\b|\blead (?:software|backend|frontend|fullstack|engineer)/iu.test(
        title,
      )
        ? 'Technical Lead'
        : /\bsenior\b|\bsr\.?\s/iu.test(title)
          ? 'Senior'
          : /\bmid[- ]level\b/iu.test(title)
            ? 'Mid-level'
            : /\bjunior\b|\bintern(?:ship)?\b/iu.test(title)
              ? /intern/iu.test(title)
                ? 'Intern'
                : 'Junior'
              : '';
    if (!seniority) {
      const role =
        /\b(junior|mid[- ]level|senior|technical lead|tech lead)\s+(?:(?:software|backend|frontend|full[- ]?stack)\s+)?(?:engineer|developer)\b/iu
          .exec(description)?.[1]
          ?.toLowerCase();
      seniority =
        role === 'junior'
          ? 'Junior'
          : role === 'senior'
            ? 'Senior'
            : role?.startsWith('mid')
              ? 'Mid-level'
              : role
                ? 'Technical Lead'
                : '';
    }
    const requirements = jdRequirementLines(description);
    const requiredText = requirements.required.join('\n');
    const preferredText = requirements.preferred.join('\n');
    const skills = requiredText.length <= 10000 ? requiredText : '';
    const preferredSkills = preferredText.length <= 10000 ? preferredText : '';
    jobs.push({
      title,
      company,
      location,
      workMode,
      seniority,
      skills,
      preferredSkills,
      description,
      originalLink: applyLink,
      discovery: {
        sourceName: source.name,
        sourceJobId: id,
        sourceUrl: source.url,
        discoveredAt: at,
        requirementSkills: { required: skills, preferred: preferredSkills },
        techStack: supportedStacks(`${title}\n${description}`),
      },
    });
  }
  return { jobs, invalid, fetched: data.jobs.length };
}
export interface SourceReadMetadata {
  cacheHit: boolean;
  fetchedAt: string | null;
}
@Injectable()
export class GreenhouseSource {
  private cache = new Map<
    string,
    { until: number; payload: unknown; fetchedAt: string }
  >();
  private blocked = new Map<string, number>();
  async read(source: Source, metadata?: SourceReadMetadata): Promise<unknown> {
    if (
      !DISCOVERY_SOURCES.some((item) => item.enabled && item.url === source.url)
    )
      throw new Error('Unsupported source');
    const cached = this.cache.get(source.url);
    if (cached && cached.until > Date.now()) {
      if (metadata)
        Object.assign(metadata, {
          cacheHit: true,
          fetchedAt: cached.fetchedAt,
        });
      return cached.payload;
    }
    if ((this.blocked.get(source.url) ?? 0) > Date.now())
      throw new Error('Source cooldown');
    // Fixed allowlist: no caller-controlled destinations and no redirects.
    this.blocked.set(source.url, Date.now() + 300000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch(source.url, {
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent':
            'AI-Job-Hunter-Local/1.0 (on-demand public job discovery)',
        },
      });
      if (!response.ok || !response.body) {
        if (response.status === 429 || response.status === 503) {
          const retry = response.headers.get('retry-after');
          const delay =
            retry && /^\d+$/u.test(retry)
              ? Number(retry) * 1000
              : retry
                ? Date.parse(retry) - Date.now()
                : 300000;
          this.blocked.set(
            source.url,
            Date.now() +
              Math.max(300000, Number.isFinite(delay) ? delay : 300000),
          );
        }
        await response.body?.cancel();
        throw new Error('Source unavailable');
      }
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 16 * 1024 * 1024) throw new Error('Feed too large');
        chunks.push(chunk.value);
      }
      const payload: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
      );
      const fetchedAt = new Date().toISOString();
      this.cache.set(source.url, {
        until: Date.now() + 300000,
        payload,
        fetchedAt,
      });
      if (metadata) Object.assign(metadata, { cacheHit: false, fetchedAt });
      return payload;
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (reader) await reader.cancel().catch(() => {});
    }
  }
}
