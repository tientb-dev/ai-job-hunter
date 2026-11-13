export const sources = [
  'Website',
  'Facebook',
  'Zalo',
  'Email',
  'Other',
] as const;
export const followUpStatuses = ['PENDING', 'DONE', 'DISMISSED'] as const;
export const statuses = [
  'SAVED',
  'CONTACTED',
  'JD_RECEIVED',
  'APPLIED',
  'INTERVIEW',
  'OFFER',
  'REJECTED',
  'CLOSED',
] as const;
export const importFields = [
  'title',
  'company',
  'agency',
  'contactNotes',
  'location',
  'workMode',
  'employmentType',
  'seniority',
  'skills',
  'experience',
  'preferredSkills',
  'domain',
  'salary',
  'originalLink',
] as const;
export type ImportFieldName = (typeof importFields)[number];
export const fieldLabels: Record<ImportFieldName, string> = {
  title: 'Job title',
  company: 'Company',
  agency: 'Recruitment agency',
  contactNotes: 'Recruiter / contact notes',
  location: 'Location',
  workMode: 'Work mode',
  employmentType: 'Employment type',
  seniority: 'Seniority',
  skills: 'Required skills',
  experience: 'Experience',
  preferredSkills: 'Preferred skills',
  domain: 'Domain',
  salary: 'Salary',
  originalLink: 'Original link',
};
export interface ImportField {
  field: ImportFieldName;
  value: string;
  status: 'SUPPORTED' | 'MISSING' | 'CONFLICT';
  reviewed: boolean;
  candidates: {
    field: ImportFieldName;
    value: string;
    source: 'post' | 'jd';
    quote: string;
  }[];
}
export interface ImportPreview {
  fields: ImportField[];
  postText: string;
  jdText: string;
  description: string;
  warnings: string[];
  rejected: number;
  error: string | null;
}
export interface OpportunityInput {
  agency: string;
  location: string;
  workMode: string;
  employmentType: string;
  seniority: string;
  skills: string;
  experience: string;
  preferredSkills: string;
  domain: string;
  salary: string;
  postText: string;
  importReview: ImportField[];
  title: string;
  company: string;
  source: (typeof sources)[number];
  status: (typeof statuses)[number];
  originalLink: string;
  contactNotes: string;
  description: string;
  notes: string;
  contactDates: string[];
  appliedDate: string | null;
  applicationChannel: string | null;
  followUpDate: string | null;
  followUpStatus: (typeof followUpStatuses)[number];
}
export interface Opportunity extends OpportunityInput {
  discovery?: {
    sourceName: string;
    sourceJobId: string;
    sourceUrl: string;
    discoveredAt: string;
    techStack?: string[];
  } | null;
  jdText: string;
  documentName: string | null;
  documentType: string | null;
  id: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}
export const emptyOpportunity = (): OpportunityInput => ({
  agency: '',
  location: '',
  workMode: '',
  employmentType: '',
  seniority: '',
  skills: '',
  experience: '',
  preferredSkills: '',
  domain: '',
  salary: '',
  postText: '',
  importReview: [],
  title: '',
  company: '',
  source: 'Website',
  status: 'SAVED',
  originalLink: '',
  contactNotes: '',
  description: '',
  notes: '',
  contactDates: [],
  appliedDate: null,
  applicationChannel: null,
  followUpDate: null,
  followUpStatus: 'PENDING',
});
export async function opportunityRequest<T>(
  path = '',
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api/v1/opportunities${path}`, {
    ...init,
    headers: {
      ...(typeof init?.body === 'string'
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let message =
      'Could not save or load opportunities. Check the local API and retry.';
    if (response.status < 500) {
      try {
        const body = (await response.json()) as { message?: unknown };
        if (typeof body.message === 'string') message = body.message;
      } catch {
        /* Use the safe fallback. */
      }
    }
    throw new Error(message);
  }
  // Nest sends an empty 200 body when a handler returns null (e.g. no saved CV).
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export function importUpload(record: unknown, file?: File): FormData {
  const data = new FormData();
  data.append('record', JSON.stringify(record));
  if (file) {
    const type = file.name.toLowerCase().endsWith('.pdf')
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    data.append('document', new Blob([file], { type }), file.name);
  }
  return data;
}

// Hostname recognition only: this never requests the supplied URL.
export function jobUrlInfo(value: string): {
  valid: boolean;
  platform: string | null;
} {
  if (!value) return { valid: true, platform: null };
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return { valid: false, platform: null };
    const host = url.hostname.toLowerCase();
    const platform =
      [
        ['itviec.com', 'ITviec'],
        ['topcv.vn', 'TopCV'],
        ['vietnamworks.com', 'VietnamWorks'],
      ].find(
        ([domain]) => host === domain || host.endsWith(`.${domain}`),
      )?.[1] ?? null;
    return { valid: true, platform };
  } catch {
    return { valid: false, platform: null };
  }
}
