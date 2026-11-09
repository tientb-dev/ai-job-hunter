import type {
  CvProfile,
  CvSectionKind,
  CvSource,
} from '../../src/features/inbox/source-cv-review.contract';
const rows: [CvSectionKind, string, string, string][] = [
  ['contact', 'identity', 'name', 'Name: Synthetic Avery Chen\n'],
  ['contact', 'identity', 'headline', 'Senior Software Engineer\n'],
  ['contact', 'identity', 'email', 'Email: avery@example.invalid\n'],
  [
    'summary',
    'summary',
    'summary',
    'Builds Java APIs and supports\nteam testing. SQL Server is academic coursework only.\n',
  ],
  ['experience', 'alpha', 'employer', 'Employer: Example Alpha\n'],
  ['experience', 'alpha', 'role', 'Role: Developer\n'],
  ['experience', 'alpha', 'dates', 'Dates: 2021–2023\n'],
  [
    'experience',
    'alpha',
    'description',
    '• Improved API tests with the\nteam, without individual ownership.\n',
  ],
  ['experience', 'beta', 'employer', 'Employer: Example Beta\n'],
  ['experience', 'beta', 'role', 'Role: Junior Engineer\n'],
  ['experience', 'beta', 'dates', 'Dates: 2024–present\n'],
  ['experience', 'beta', 'description', '• Assisted a team prototype.\n'],
  ['skills', 'backend', 'skill_category', 'Backend:\n'],
  ['skills', 'backend', 'skill', 'Java, SQL Server (academic only)\n'],
  ['skills', 'tools', 'skill_category', 'Tools:\n'],
  ['skills', 'tools', 'skill', 'Git, Docker\n'],
  ['education', 'degree', 'institution', 'Institution: Example University\n'],
  [
    'education',
    'degree',
    'qualification',
    'Qualification: BSc studies in progress\n',
  ],
];
export const richSource: CvSource = {
  contractVersion: '1',
  id: '00000000-0000-4000-8000-000000000082',
  fileName: 'synthetic-source-cv.pdf',
  savedCvUpdatedAt: '2026-01-01T00:00:00.000Z',
  text: rows.map((r) => r[3]).join(''),
};
export function richProfile(): CvProfile {
  const document: CvProfile['document'] = {
    contractVersion: '1',
    reconstruction: { version: '3', previousRevisionId: null },
    sections: [],
    coverage: [],
  };
  let start = 0;
  rows.forEach(([kind, entryId, field, value], i) => {
    let section = document.sections.find((s) => s.kind === kind);
    if (!section) {
      section = { id: `section-${kind}`, kind, review: 'pending', entries: [] };
      document.sections.push(section);
    }
    let entry = section.entries.find((e) => e.id === `entry-${entryId}`);
    if (!entry) {
      entry = { id: `entry-${entryId}`, facts: [] };
      section.entries.push(entry);
    }
    const id = `field-${i}`,
      end = start + value.length;
    entry.facts.push({
      id,
      field,
      value,
      origin: 'source',
      review: 'pending',
      evidence: [{ sourceRevisionId: richSource.id, start, end, quote: value }],
    });
    document.coverage.push({
      start,
      end,
      disposition: 'mapped',
      factIds: [id],
      reason: null,
    });
    start = end;
  });
  return {
    contractVersion: '1',
    id: '00000000-0000-4000-8000-000000000083',
    profileId: '00000000-0000-4000-8000-000000000084',
    revision: 1,
    sourceRevisionId: richSource.id,
    document,
  };
}
