import { validateImportReview } from './job-import.contract.js';
import type { ImportField } from './job-import.contract.js';
import { BadRequestException } from '@nestjs/common';
import { FOLLOW_UP_STATUSES, SOURCES, STATUSES } from './opportunity.entity.js';
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
  source: (typeof SOURCES)[number];
  status: (typeof STATUSES)[number];
  originalLink: string;
  contactNotes: string;
  description: string;
  notes: string;
  contactDates: string[];
  appliedDate: string | null;
  applicationChannel: string | null;
  followUpDate: string | null;
  followUpStatus: (typeof FOLLOW_UP_STATUSES)[number];
}
export function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number(value.slice(0, 4)) > 0 &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function validateOpportunity(
  value: unknown,
  jdText = '',
): OpportunityInput {
  const fail = (): never => {
    throw new BadRequestException(
      'Invalid opportunity. Check required fields, dates and HTTP(S) link.',
    );
  };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail();
  const original = value as Record<string, unknown>;
  const row = {
    appliedDate: null,
    applicationChannel: null,
    followUpStatus: 'PENDING',
    company: '',
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
    ...original,
  } as Record<string, unknown>;
  const fields = [
    'agency',
    'location',
    'workMode',
    'employmentType',
    'seniority',
    'skills',
    'experience',
    'preferredSkills',
    'domain',
    'salary',
    'postText',
    'importReview',
    'title',
    'company',
    'source',
    'status',
    'originalLink',
    'contactNotes',
    'description',
    'notes',
    'contactDates',
    'followUpDate',
    'followUpStatus',
    'appliedDate',
    'applicationChannel',
  ];
  if (
    Object.keys(row).some((key) => !fields.includes(key)) ||
    fields.some((key) => !Object.hasOwn(row, key))
  )
    return fail();
  for (const [key, max] of Object.entries({
    title: 300,
    company: 300,
    originalLink: 2048,
    contactNotes: 10000,
    description: 26000,
    agency: 2000,
    location: 2000,
    workMode: 2000,
    employmentType: 2000,
    seniority: 2000,
    skills: 10000,
    experience: 2000,
    preferredSkills: 10000,
    domain: 2000,
    salary: 2000,
    postText: 12000,
    notes: 20000,
  })) {
    if (typeof row[key] !== 'string' || row[key].length > max) return fail();
  }
  if (
    !(row.title as string).trim() ||
    !SOURCES.includes(row.source as (typeof SOURCES)[number]) ||
    !STATUSES.includes(row.status as (typeof STATUSES)[number])
  )
    return fail();
  if (row.originalLink) {
    try {
      const url = new URL(row.originalLink as string);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return fail();
    } catch {
      return fail();
    }
  }
  if (
    (row.appliedDate !== null && !validDate(row.appliedDate)) ||
    (row.applicationChannel !== null &&
      (typeof row.applicationChannel !== 'string' ||
        row.applicationChannel.length > 200)) ||
    !Array.isArray(row.contactDates) ||
    row.contactDates.length > 100 ||
    !row.contactDates.every(validDate) ||
    new Set(row.contactDates).size !== row.contactDates.length ||
    (row.followUpDate !== null && !validDate(row.followUpDate)) ||
    !FOLLOW_UP_STATUSES.includes(
      row.followUpStatus as (typeof FOLLOW_UP_STATUSES)[number],
    )
  )
    return fail();
  return {
    ...row,
    applicationChannel:
      typeof row.applicationChannel === 'string'
        ? row.applicationChannel.trim() || null
        : null,
    importReview: validateImportReview(
      row.importReview,
      row.postText as string,
      jdText,
    ),
    title: (row.title as string).trim(),
    company: (row.company as string).trim(),
  } as unknown as OpportunityInput;
}
