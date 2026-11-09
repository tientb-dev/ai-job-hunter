import type { ProfileDocument } from '../../src/tailored-cv/tailored-cv.contract.js';
import { Opportunity } from '../../src/opportunities/opportunity.entity.js';
import {
  canonicalRequirements,
  scoreCvMatch,
} from '../../src/matching/cv-match.js';
import { MatchContexts } from '../../src/matching/match-context.js';
import {
  reviewedPlan,
  draftHash,
} from '../../src/tailored-cv/tailored-draft.policy.js';
import type { DraftInput } from '../../src/tailored-cv/tailored-draft.contract.js';
export const draftOwner = '00000000-0000-4000-8000-000000000001';
export const draftSourceId = '00000000-0000-4000-8000-000000000083';
export const draftTime = '2026-01-01T00:00:00.000Z';
export function draftFixture(
  academic = false,
  javaText = 'Built Java APIs for internal tools.\n',
  javaField = 'description',
  skillsList?: string,
) {
  const rows = [
    ['contact', 'contact-1', 'name', 'name', 'Name: Synthetic Quinn\n'],
    [
      'contact',
      'contact-1',
      'email',
      'email',
      'Email: quinn@example.invalid\n',
    ],
    ['experience', 'role-1', 'employer', 'employer', 'Employer: Example Ltd\n'],
    ['experience', 'role-1', 'role', 'role', 'Role: Developer\n'],
    [
      'experience',
      'role-1',
      'dates',
      'dates',
      'Dates: January 2023 - December 2024\n',
    ],
    ['experience', 'role-1', 'java', javaField, javaText],
    [
      academic ? 'education' : 'experience',
      academic ? 'course-1' : 'role-1',
      'scope',
      'description',
      academic
        ? 'Used SQL Server for academic coursework only; no professional production experience.\n'
        : 'Assisted a team prototype only; individual production ownership is not claimed.\n',
    ],
    ...(skillsList
      ? [['skills', 'skills-1', 'stack', 'skill', skillsList]]
      : []),
  ];
  const document: ProfileDocument = {
    contractVersion: '1',
    sections: [],
    coverage: [],
  };
  let text = '';
  for (const [kind, entryId, id, field, value] of rows as [
    ProfileDocument['sections'][number]['kind'],
    string,
    string,
    string,
    string,
  ][]) {
    let section = document.sections.find((s) => s.kind === kind);
    if (!section) {
      section = {
        id: `section-${kind}`,
        kind,
        review: 'confirmed',
        entries: [],
      };
      document.sections.push(section);
    }
    let entry = section.entries.find((e) => e.id === entryId);
    if (!entry) {
      entry = { id: entryId, facts: [] };
      section.entries.push(entry);
    }
    const start = text.length;
    text += value;
    entry.facts.push({
      id,
      field,
      value,
      origin: 'source',
      review: 'pending',
      evidence: [
        {
          sourceRevisionId: draftSourceId,
          start,
          end: text.length,
          quote: value,
        },
      ],
    });
    document.coverage.push({
      start,
      end: text.length,
      disposition: 'mapped',
      factIds: [id],
      reason: null,
    });
  }
  return { text, document };
}
export function draftJob(skills = 'Java') {
  return Object.assign(new Opportunity(), {
    id: '00000000-0000-4000-8000-000000000084',
    ownerId: draftOwner,
    title: 'Synthetic API developer',
    company: 'Example Hiring',
    skills,
    preferredSkills: '',
    experience: '',
    domain: '',
    seniority: '',
    description: `${skills} required`,
    postText: '',
    jdText: '',
    discovery: null,
    updatedAt: new Date(draftTime),
  });
}
export function draftInput(
  requirement = 'Java',
  academic = false,
  javaText?: string,
  javaField?: string,
): DraftInput {
  const fixture = draftFixture(
      academic,
      javaText ??
        (requirement.includes('designing APIs')
          ? 'Designed APIs.\n'
          : 'Built Java APIs for internal tools.\n'),
      javaField,
    ),
    job = draftJob(requirement);
  const canonical = canonicalRequirements(job);
  const assessment = scoreCvMatch(
    canonical.map((row) => ({
      ...row,
      cvQuote: fixture.document.sections
        .flatMap((s) => s.entries.flatMap((e) => e.facts))
        .find((f) => f.id === 'java')!
        .value.trim()
        .split('\n')[0]!,
    })),
    fixture.text,
    requirement,
    canonical,
  );
  const match = new MatchContexts().create(
    draftOwner,
    job.id,
    { cvUpdatedAt: draftTime, jobUpdatedAt: draftTime },
    assessment,
  );
  const snapshot = {
    title: job.title,
    company: job.company,
    skills: job.skills,
    preferredSkills: '',
    experience: '',
    domain: '',
    seniority: '',
    description: job.description,
    postText: '',
    jdText: '',
    hasDiscovery: false,
    discoveryRequirements: null,
  };
  return {
    plan: reviewedPlan(fixture.document),
    match,
    job: snapshot,
    pins: {
      sourceRevisionId: draftSourceId,
      sourceHash: draftHash(fixture.text),
      profileRevisionId: '00000000-0000-4000-8000-000000000085',
      profileId: '00000000-0000-4000-8000-000000000086',
      profileRevision: 2,
      profileHash: draftHash(fixture.document),
      jobId: job.id,
      jobUpdatedAt: draftTime,
      jobHash: draftHash(snapshot),
      matchId: match.matchId,
    },
  };
}
