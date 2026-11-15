import { tr } from '../../app/i18n';
import { importFields, type OpportunityInput } from './opportunities-api';

export function canFetchJobUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      value.length <= 2048 &&
      url.protocol === 'https:' &&
      !url.port &&
      !url.username &&
      !url.password &&
      ['itviec.com', 'www.itviec.com'].includes(url.hostname) &&
      url.pathname.startsWith('/it-jobs/')
    );
  } catch {
    return false;
  }
}
export function urlImportHelp(value: string): string {
  try {
    const host = new URL(value).hostname;
    if (host === 'vietnamworks.com' || host === 'www.vietnamworks.com')
      return tr(
        'VietnamWorks URL fetching is disabled. Use the installed page-import bookmark or paste an authorized JD.',
      );
    if (host === 'topcv.vn' || host === 'www.topcv.vn')
      return tr(
        'TopCV URL fetching is disabled due to published content-use restrictions. Use the installed page-import bookmark or paste an authorized JD.',
      );
  } catch {
    /* Use the general guidance. */
  }
  return tr(
    'Fetch supports individual HTTPS ITviec job URLs. Requests run only when clicked; manual paste and document upload remain available.',
  );
}
export interface UrlJobPreview {
  originalLink: string;
  platform: string;
  title: string;
  company: string;
  location: string;
  description: string;
  sourceText: string;
  validThrough: string | null;
  expired: boolean;
  domain?: string;
  sourceMetadata?: {
    skills: string[];
    jobExpertise: string[];
    jobDomains: string[];
  };
  salary?: string;
  experience?: string;
  workMode?: string;
  importWarnings?: string[];
  salaryDetails?: {
    originalText: string;
    currency: string | null;
    minimum: number | null;
    maximum: number | null;
    basis: 'net' | 'gross' | null;
    payPeriod: string | null;
  } | null;
}
// Reuse the paste/extract/review path; no AI call and no save happens here.
export function applyUrlJobPreview(
  form: OpportunityInput,
  preview: UrlJobPreview,
  edited: ReadonlySet<keyof OpportunityInput>,
  previous?: UrlJobPreview | null,
): OpportunityInput {
  let retainedText = form.postText;
  if (previous) {
    if (!retainedText.includes(previous.sourceText))
      throw new Error(
        tr(
          'The imported source text was edited. Keep your edits, or restore the previous source text before fetching again.',
        ),
      );
    retainedText = retainedText.replace(previous.sourceText, '').trim();
  }
  const postText = [retainedText, preview.sourceText]
    .filter(Boolean)
    .join('\n\n');
  if (postText.length > 12000)
    throw new Error(
      tr(
        'Combined sources exceed the paste limit. Your existing inputs are unchanged; paste the relevant JD content manually.',
      ),
    );
  const next = { ...form, postText, importReview: [] };
  const replacing = previous && previous.originalLink !== preview.originalLink;
  if (replacing)
    for (const field of importFields) if (!edited.has(field)) next[field] = '';
  for (const field of [
    'title',
    'company',
    'location',
    'description',
    'originalLink',
    'salary',
    'experience',
    'workMode',
    'domain',
  ] as const)
    if (
      !edited.has(field) &&
      (!form[field] ||
        replacing ||
        (previous && form[field] === previous[field]))
    )
      next[field] = preview[field] ?? '';
  return next;
}
