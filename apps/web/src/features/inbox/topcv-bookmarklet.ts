import { tr } from '../../app/i18n';
export const TOPCV_ORIGINS = ['https://topcv.vn', 'https://www.topcv.vn'];
export const PAGE_IMPORT_ORIGINS = [
  ...TOPCV_ORIGINS,
  'https://vietnamworks.com',
  'https://www.vietnamworks.com',
];
export const PAGE_IMPORT_BYTES = 64 * 1024;
export interface TopcvPagePayload {
  version: 1;
  sourceUrl: string;
  jobPosting: Record<string, unknown> | null;
  visibleText: string;
  salaryText: string;
  workModeText?: string;
}
export function validTopcvPageUrl(value: unknown): value is string {
  try {
    if (typeof value !== 'string' || value.length > 2048) return false;
    const url = new URL(value);
    return (
      PAGE_IMPORT_ORIGINS.includes(url.origin) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (TOPCV_ORIGINS.includes(url.origin)
        ? /^\/viec-lam\/[^/]+\/\d+\.html$/u.test(url.pathname)
        : /^\/[^/]+-\d+-jv$/u.test(url.pathname))
    );
  } catch {
    return false;
  }
}
export function validPagePayload(value: unknown): value is TopcvPagePayload {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false;
    const row = value as TopcvPagePayload;
    return (
      Object.keys(row).every((key) =>
        [
          'version',
          'sourceUrl',
          'jobPosting',
          'visibleText',
          'salaryText',
          'workModeText',
        ].includes(key),
      ) &&
      row.version === 1 &&
      validTopcvPageUrl(row.sourceUrl) &&
      typeof row.visibleText === 'string' &&
      row.visibleText.length <= 12000 &&
      typeof row.salaryText === 'string' &&
      row.salaryText.length <= 300 &&
      (row.workModeText === undefined ||
        (typeof row.workModeText === 'string' &&
          row.workModeText.length <= 200)) &&
      (row.jobPosting === null ||
        (typeof row.jobPosting === 'object' &&
          !Array.isArray(row.jobPosting))) &&
      new TextEncoder().encode(JSON.stringify(value)).byteLength <=
        PAGE_IMPORT_BYTES
    );
  } catch {
    return false;
  }
}
export function isLocalImportOrigin(origin: string): boolean {
  return ['http://127.0.0.1:5173', 'http://localhost:5173'].includes(origin);
}
// Intentionally self-contained: its compiled function body is the bookmarklet.
export function runTopcvBookmarklet(appOrigin: string): void {
  try {
    const url = new URL(window.location.href);
    const topcv = ['https://topcv.vn', 'https://www.topcv.vn'].includes(
      url.origin,
    );
    const vietnamworks = [
      'https://vietnamworks.com',
      'https://www.vietnamworks.com',
    ].includes(url.origin);
    if (
      (!topcv && !vietnamworks) ||
      url.username ||
      url.password ||
      !(topcv
        ? /^\/viec-lam\/[^/]+\/\d+\.html$/.test(url.pathname)
        : /^\/[^/]+-\d+-jv$/.test(url.pathname))
    )
      throw new Error(
        tr('Open an individual public TopCV or VietnamWorks job page first.'),
      );
    if (!['http://127.0.0.1:5173', 'http://localhost:5173'].includes(appOrigin))
      throw new Error(tr('Unsupported local app address.'));
    const jobs: Record<string, unknown>[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== 'object') return;
      const row = value as Record<string, unknown>;
      if ([row['@type']].flat().includes('JobPosting')) jobs.push(row);
      if (row['@graph']) visit(row['@graph']);
    };
    for (const node of document.querySelectorAll(
      'script[type="application/ld+json"]',
    )) {
      try {
        visit(JSON.parse(node.textContent ?? ''));
      } catch {
        /* Never execute page scripts. */
      }
    }
    const object = (value: unknown): Record<string, unknown> =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const pick = (value: unknown, keys: string[]): Record<string, unknown> =>
      Object.fromEntries(
        Object.entries(object(value)).filter(
          ([key, field]) =>
            keys.includes(key) &&
            (typeof field === 'string' ||
              (typeof field === 'number' && Number.isFinite(field)) ||
              (Array.isArray(field) &&
                field.every((item) => typeof item === 'string'))),
        ),
      );
    let jobPosting: Record<string, unknown> | null = null;
    if (jobs.length === 1) {
      const job = jobs[0]!;
      jobPosting = {
        '@type': 'JobPosting',
        ...pick(job, [
          'title',
          'description',
          'qualifications',
          'skills',
          'responsibilities',
          'industry',
          'validThrough',
          'jobLocationType',
          'workMode',
        ]),
      };
      jobPosting.hiringOrganization = pick(job.hiringOrganization, ['name']);
      jobPosting.jobLocation = [job.jobLocation]
        .flat()
        .filter(Boolean)
        .map((location) => {
          const place = object(location),
            address = object(place.address);
          return {
            ...pick(place, ['name']),
            address: {
              ...pick(address, [
                'streetAddress',
                'addressLocality',
                'addressRegion',
              ]),
              addressCountry:
                typeof address.addressCountry === 'string'
                  ? address.addressCountry
                  : pick(address.addressCountry, ['name']),
            },
          };
        });
      if (typeof job.baseSalary === 'string')
        jobPosting.baseSalary = job.baseSalary;
      else if (job.baseSalary)
        jobPosting.baseSalary = {
          ...pick(job.baseSalary, ['currency', 'name', 'description']),
          value: pick(object(job.baseSalary).value, [
            'minValue',
            'maxValue',
            'value',
            'unitText',
          ]),
        };
      if (typeof job.experienceRequirements === 'string')
        jobPosting.experienceRequirements = job.experienceRequirements;
      else if (job.experienceRequirements) {
        const experience = object(job.experienceRequirements);
        const months = experience.monthsOfExperience;
        if (
          typeof months === 'number' &&
          Number.isFinite(months) &&
          months >= 0
        )
          jobPosting.experienceRequirements = { monthsOfExperience: months };
      }
    }
    const visibleNode = (node: HTMLElement): string => {
      for (
        let parent: HTMLElement | null = node;
        parent;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent);
        if (
          parent.hidden ||
          parent.getAttribute('aria-hidden') === 'true' ||
          style.display === 'none' ||
          style.visibility === 'hidden'
        )
          return '';
      }
      return node.innerText?.trim() ?? '';
    };
    const visible = (selector: string): string => {
      for (const node of document.querySelectorAll<HTMLElement>(selector)) {
        const text = visibleNode(node);
        if (text) return text;
      }
      return '';
    };
    const semanticDescription =
      '[itemtype="https://schema.org/JobPosting"] [itemprop="description"], [itemtype="http://schema.org/JobPosting"] [itemprop="description"]';
    let visibleText = visible(
      topcv
        ? `.job-description, .job-detail__information-detail, ${semanticDescription}`
        : semanticDescription,
    );
    if (vietnamworks) {
      // Semantic job fields are actual content containers, collected together
      // in document order. Do not stop after the Responsibilities description.
      const sections = document.querySelectorAll<HTMLElement>(
        '[itemtype="https://schema.org/JobPosting"] [itemprop="description"], [itemtype="https://schema.org/JobPosting"] [itemprop="responsibilities"], [itemtype="https://schema.org/JobPosting"] [itemprop="qualifications"], [itemtype="http://schema.org/JobPosting"] [itemprop="description"], [itemtype="http://schema.org/JobPosting"] [itemprop="responsibilities"], [itemtype="http://schema.org/JobPosting"] [itemprop="qualifications"]',
      );
      const texts: string[] = [];
      for (const node of sections) {
        if (
          [...sections].some((other) => other !== node && other.contains(node))
        )
          continue;
        const text = visibleNode(node);
        if (!text) continue;
        const property = node.getAttribute('itemprop');
        texts.push(
          property === 'qualifications' &&
            !/requirements|yêu cầu công việc/iu.test(text)
            ? `Requirements\n${text}`
            : property === 'responsibilities' &&
                !/responsibilities|mô tả công việc/iu.test(text)
              ? `Responsibilities\n${text}`
              : text,
        );
      }
      if (texts.length) visibleText = texts.join('\n\n');
      // Confirmed expanded VietnamWorks DOM supplied by the user: sibling
      // section blocks, each with a direct H2 and a separate rich-text wrapper.
      // Read the wrapper only, never the adjacent skill-tag/analytics box.
      const layouts: {
        kind: 'description' | 'requirements';
        text: string;
      }[][] = [];
      for (const root of document.querySelectorAll<HTMLElement>(
        'div.sc-1671001a-3',
      )) {
        const captured: {
          kind: 'description' | 'requirements';
          text: string;
        }[] = [];
        for (const block of root.children) {
          if (!block.matches('div.sc-1671001a-4')) continue;
          const heading = block.querySelector<HTMLElement>(
            ':scope > h2.sc-1671001a-5',
          );
          if (!heading) continue;
          const label = visibleNode(heading);
          const kind =
            /^(?:yêu cầu công việc|job requirements|requirements)$/iu.test(
              label,
            )
              ? 'requirements'
              : /^(?:mô tả công việc|job description|key responsibilities|responsibilities)$/iu.test(
                    label,
                  )
                ? 'description'
                : null;
          if (!kind) continue;
          const body = block.querySelector<HTMLElement>(
            ':scope > div.sc-1671001a-6 > div',
          );
          const content = body ? visibleNode(body) : '';
          if (!content)
            throw new Error(
              tr(
                'Expand the full VietnamWorks job description and Requirements, then click the bookmark again.',
              ),
            );
          captured.push({ kind, text: `${label}\n${content}` });
        }
        if (captured.length) {
          if (
            !captured.some((section) => section.kind === 'description') ||
            !captured.some((section) => section.kind === 'requirements')
          )
            throw new Error(
              tr(
                'Both VietnamWorks Responsibilities and Requirements must be visible. Expand the full JD and retry the bookmark.',
              ),
            );
          layouts.push(captured);
        }
      }
      if (layouts.length > 1)
        throw new Error(
          tr(
            'Multiple job-content containers found. Open one VietnamWorks job and retry.',
          ),
        );
      if (layouts.length === 1)
        visibleText = layouts[0]!.map((section) => section.text).join('\n\n');
    }
    if (!jobPosting) {
      const roots = document.querySelectorAll<HTMLElement>(
        '[itemtype="https://schema.org/JobPosting"], [itemtype="http://schema.org/JobPosting"]',
      );
      if (roots.length === 1) {
        const root = roots[0]!;
        const field = (selector: string) => {
          const node = root.querySelector<HTMLElement>(selector);
          return (
            node?.getAttribute('content')?.trim() ||
            node?.innerText?.trim() ||
            ''
          );
        };
        // Standards-based single-job DOM only, never body text or unrelated
        // application state. No unverified VietnamWorks-specific CSS selectors.
        jobPosting = {
          '@type': 'JobPosting',
          title: field('[itemprop="title"]'),
          hiringOrganization: {
            name: field('[itemprop="hiringOrganization"] [itemprop="name"]'),
          },
          jobLocation: [
            {
              address: Object.fromEntries(
                [
                  'streetAddress',
                  'addressLocality',
                  'addressRegion',
                  'addressCountry',
                ].map((key) => [
                  key,
                  field(`[itemprop="jobLocation"] [itemprop="${key}"]`),
                ]),
              ),
            },
          ],
          experienceRequirements: field('[itemprop="experienceRequirements"]'),
          validThrough: field('[itemprop="validThrough"]'),
          jobLocationType: field('[itemprop="jobLocationType"]'),
          workMode: field('[itemprop="workMode"]'),
        };
        const currency = field('[itemprop="baseSalary"] [itemprop="currency"]');
        const max = field('[itemprop="baseSalary"] [itemprop="maxValue"]');
        const min = field('[itemprop="baseSalary"] [itemprop="minValue"]');
        const period = field('[itemprop="baseSalary"] [itemprop="unitText"]');
        if (
          /^[A-Z]{3}$/i.test(currency) &&
          /^\d+(?:\.\d+)?$/.test(max) &&
          Number.isFinite(Number(max))
        ) {
          const amount: Record<string, string | number> = {
            maxValue: Number(max),
          };
          if (/^\d+(?:\.\d+)?$/.test(min) && Number.isFinite(Number(min)))
            amount.minValue = Number(min);
          if (period) amount.unitText = period;
          jobPosting.baseSalary = { currency, value: amount };
        }
      }
    }
    const salaryText = visible(
      topcv
        ? '[itemprop="baseSalary"], .job-detail__info--salary .job-detail__info--content-value'
        : '[itemtype="https://schema.org/JobPosting"] [itemprop="baseSalary"], [itemtype="http://schema.org/JobPosting"] [itemprop="baseSalary"]',
    );
    if (!jobPosting?.description && !visibleText)
      throw new Error(
        tr(
          'No job description found. Open the full JD; do not bypass a login or CAPTCHA.',
        ),
      );
    let workModeText = '';
    for (const node of document.querySelectorAll<HTMLElement>(
      topcv
        ? '.job-detail__info--section, .job-detail__info--item'
        : '[itemtype="https://schema.org/JobPosting"] [itemprop="workMode"], [itemtype="http://schema.org/JobPosting"] [itemprop="workMode"]',
    )) {
      const text = node.innerText?.trim() ?? '';
      const explicit =
        /^(?:work mode|hình thức làm việc)\s*[:：\n]\s*(on[- ]?site|remote|hybrid|tại văn phòng|làm việc tại văn phòng|từ xa|kết hợp)$/iu.exec(
          text,
        );
      if (explicit && !node.hidden && getComputedStyle(node).display !== 'none')
        workModeText = explicit[1]!;
    }
    const payload = {
      version: 1,
      sourceUrl: url.origin + url.pathname,
      jobPosting,
      visibleText,
      salaryText,
      workModeText,
    };
    if (
      visibleText.length > 12000 ||
      salaryText.length > 300 ||
      new TextEncoder().encode(JSON.stringify(payload)).byteLength > 65536
    )
      throw new Error(
        tr('Job content exceeds the import limit. Use manual import instead.'),
      );
    const nonce = Array.from(
      crypto.getRandomValues(new Uint8Array(16)),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
    let child: Window | null = null;
    const listener = (event: MessageEvent) => {
      if (
        event.origin !== appOrigin ||
        event.source !== child ||
        !event.data ||
        event.data.type !== 'AJH_TOPCV_READY' ||
        event.data.nonce !== nonce
      )
        return;
      child!.postMessage({ type: 'AJH_TOPCV_PAGE', nonce, payload }, appOrigin);
      window.removeEventListener('message', listener);
      clearTimeout(timer);
    };
    window.addEventListener('message', listener);
    child = window.open(
      `${appOrigin}/jobs/new#topcv-import=${nonce}&source=${encodeURIComponent(url.origin)}`,
      '_blank',
    );
    if (!child) {
      window.removeEventListener('message', listener);
      throw new Error(
        tr('Allow the bookmark to open the local app window, then try again.'),
      );
    }
    const timer = setTimeout(() => {
      window.removeEventListener('message', listener);
      alert(
        tr(
          'Import connection timed out. Start the local app. If browser policy blocks the connection, use manual import; do not bypass site restrictions.',
        ),
      );
    }, 30000);
  } catch (error) {
    alert(
      error instanceof Error
        ? error.message
        : tr('Could not import this job page. Use manual import.'),
    );
  }
}
export function bookmarkletUrl(origin: string): string {
  if (!isLocalImportOrigin(origin))
    throw new Error(
      tr('Use the local app on port 5173 to install this bookmark.'),
    );
  return `javascript:void(${encodeURIComponent(`(${runTopcvBookmarklet.toString()})(${JSON.stringify(origin)})`)})`;
}
export function receiveTopcvPage(
  win: Window,
  consume: (payload: TopcvPagePayload) => void,
  fail: (message: string) => void,
): () => void {
  const params = new URLSearchParams(win.location.hash.slice(1));
  // Retain v1 message/hash names so already installed TopCV bookmarks work.
  const nonce = params.get('topcv-import'),
    origin = params.get('source');
  if (!nonce) return () => {};
  if (
    !isLocalImportOrigin(win.location.origin) ||
    !/^[a-f0-9]{32}$/u.test(nonce) ||
    !origin ||
    !PAGE_IMPORT_ORIGINS.includes(origin) ||
    !win.opener
  ) {
    fail(
      tr(
        'Invalid bookmark import connection. Open the supported job page and click your installed bookmark again.',
      ),
    );
    return () => {};
  }
  const sender = win.opener as Window;
  let used = false;
  const cleanup = () => {
    win.removeEventListener('message', listener);
    clearTimeout(timer);
  };
  const listener = (event: MessageEvent) => {
    if (
      used ||
      event.origin !== origin ||
      event.source !== sender ||
      !event.data ||
      event.data.type !== 'AJH_TOPCV_PAGE' ||
      event.data.nonce !== nonce
    )
      return;
    used = true;
    cleanup();
    win.history.replaceState(
      null,
      '',
      win.location.pathname + win.location.search,
    );
    win.opener = null;
    if (
      !validPagePayload(event.data.payload) ||
      new URL(event.data.payload.sourceUrl).origin !== origin
    ) {
      fail(
        tr(
          'Invalid or oversized job-page payload. Your existing inputs are unchanged.',
        ),
      );
      return;
    }
    consume(event.data.payload);
  };
  win.addEventListener('message', listener);
  const timer = setTimeout(() => {
    cleanup();
    fail(
      tr(
        'Bookmark import timed out. Reopen the source page and try again, or use manual import.',
      ),
    );
  }, 30000);
  sender.postMessage({ type: 'AJH_TOPCV_READY', nonce }, origin);
  return cleanup;
}
