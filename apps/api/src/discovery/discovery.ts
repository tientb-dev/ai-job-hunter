import { BadRequestException } from '@nestjs/common';
export const STACKS = ['Java', 'Spring Boot', 'Node.js', 'React'] as const;
export interface DiscoveryFilters {
  location: 'Ho Chi Minh City' | 'Vietnam';
  stacks: (typeof STACKS)[number][];
  workMode: 'All' | 'Onsite' | 'Hybrid' | 'Remote';
  seniority: 'Senior' | 'Technical Lead' | 'All';
}
export interface DiscoveredJob {
  title: string;
  company: string;
  location: string;
  workMode: string;
  seniority: string;
  skills: string;
  preferredSkills: string;
  description: string;
  originalLink: string;
  discovery: {
    sourceName: string;
    sourceJobId: string;
    sourceUrl: string;
    discoveredAt: string;
    techStack?: string[];
    requirementSkills?: { required: string; preferred: string };
  };
}
export function validateFilters(value: unknown): DiscoveryFilters {
  const row = value as Partial<DiscoveryFilters> | null;
  if (
    !row ||
    typeof row !== 'object' ||
    Array.isArray(row) ||
    Object.keys(row).some(
      (key) => !['location', 'stacks', 'workMode', 'seniority'].includes(key),
    ) ||
    !['Ho Chi Minh City', 'Vietnam'].includes(row.location ?? '') ||
    !['All', 'Onsite', 'Hybrid', 'Remote'].includes(row.workMode ?? '') ||
    !['Senior', 'Technical Lead', 'All'].includes(row.seniority ?? '') ||
    !Array.isArray(row.stacks) ||
    row.stacks.length > 4 ||
    row.stacks.some((stack) => !STACKS.includes(stack))
  )
    throw new BadRequestException(
      'Choose a supported location, optional tech stacks, work mode and seniority.',
    );
  return row as DiscoveryFilters;
}
export const folded = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gu, 'd')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
const stackPatterns: Record<(typeof STACKS)[number], RegExp> = {
  Java: /\bjava\b|\bspring\s*boot\b/iu,
  'Spring Boot': /\bspring\s*boot\b/iu,
  'Node.js':
    /\bnode(?:\.?js|\.js)\b|\bnode[ -]?(?:backend|back-end)\b|\bnestjs\b/iu,
  React: /\breact(?:\.?js)?\b/iu,
};
export function supportedStacks(text: string): string[] {
  // Spring Boot supports the Java search equivalent without claiming Java was literally listed.
  return STACKS.filter((stack) =>
    (stack === 'Java' ? /\bjava\b/iu : stackPatterns[stack]).test(text),
  );
}
export function rankJob(
  job: DiscoveredJob,
  filters: DiscoveryFilters,
): number | null {
  const evidence = `${job.title}\n${job.skills}\n${job.description}`;
  // No stacks selected means any job family (IT, Marketing, Sales…) stays eligible.
  if (
    filters.stacks.length &&
    !filters.stacks.some((stack) => stackPatterns[stack].test(evidence))
  )
    return null;
  const location = folded(job.location);
  const local = /ho chi minh|hcmc|\bhcm\b|sai gon/iu.test(location);
  const vietnam =
    local || /viet nam|vietnam|ha noi|hanoi|da nang/iu.test(location);
  const unlocatedRemote = /^(?:remote|anywhere|worldwide|global)$/iu.test(
    location,
  );
  // Explicit foreign on-site locations are out of scope; unknown and remote stay eligible.
  if (
    location &&
    !vietnam &&
    !unlocatedRemote &&
    !/anywhere|worldwide|global/iu.test(location)
  )
    return null;
  let score =
    10 +
    (filters.location === 'Ho Chi Minh City'
      ? local
        ? 8
        : !location
          ? 2
          : 0
      : vietnam
        ? 8
        : 0);
  if (filters.workMode === 'All')
    score += local && ['Onsite', 'Hybrid'].includes(job.workMode) ? 3 : 0;
  else score += job.workMode === filters.workMode ? 5 : !job.workMode ? 1 : 0;
  if (filters.seniority !== 'All')
    score +=
      job.seniority === filters.seniority
        ? 5
        : filters.seniority === 'Senior' && job.seniority === 'Technical Lead'
          ? 5
          : !job.seniority
            ? 1
            : 0;
  return score;
}
export function normalizedUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()])
      if (/^utm_|^(?:gh_src|source|ref|src)$/iu.test(key))
        url.searchParams.delete(key);
    url.searchParams.sort();
    return `${url.hostname.toLowerCase().replace(/^www\./u, '')}${url.pathname.replace(/\/$/u, '')}${url.search}`;
  } catch {
    return '';
  }
}
export function duplicateJob(
  job: DiscoveredJob,
  existing: Pick<
    DiscoveredJob,
    'title' | 'company' | 'location' | 'originalLink'
  > & { discovery?: DiscoveredJob['discovery'] | null },
): boolean {
  if (
    existing.discovery?.sourceName === job.discovery.sourceName &&
    existing.discovery.sourceJobId === job.discovery.sourceJobId
  )
    return true;
  const url = normalizedUrl(job.originalLink);
  if (url && url === normalizedUrl(existing.originalLink)) return true;
  const locationKey = (value: string) =>
    /ho chi minh|hcmc|\bhcm\b|sai gon/iu.test(folded(value))
      ? 'hcmc'
      : folded(value);
  return (
    Boolean(job.company && existing.company) &&
    folded(job.company) === folded(existing.company) &&
    folded(job.title) === folded(existing.title) &&
    locationKey(job.location) === locationKey(existing.location)
  );
}
