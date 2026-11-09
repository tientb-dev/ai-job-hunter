import type {
  CvProfile,
  CvSource,
  CvSectionKind,
} from '../../src/features/inbox/source-cv-review.contract';
export const contactSkillGroups = [
  [
    'Backend',
    'Java, Spring Boot, Hibernate, MyBatis, Node.js, NestJS, Express.js, PHP, Laravel',
  ],
  ['Frontend', 'React, Next.js, Vue.js, Nuxt.js, TypeScript, JavaScript'],
  ['Leadership & Communication', 'Team mentoring and communication'],
  ['Architecture', 'Modular monoliths, API design'],
  ['Databases', 'PostgreSQL; SQL Server (academic only)'],
  ['Cloud & DevOps', 'Docker, CI pipelines'],
] as const;
const rows: [CvSectionKind | null, string, string, string][] = [
  ['contact', 'identity', 'name', 'Synthetic Morgan Example\n'],
  [
    'contact',
    'identity',
    'headline',
    'Senior Full-Stack Software Engineer | Technical Lead\n',
  ],
  [
    null,
    '',
    'PDF icon or separator artifact. Review before excluding.',
    '\u25A1 ',
  ],
  ['contact', 'identity', 'location', 'Example City\n'],
  ['contact', 'identity', 'phone', '(+84) 900 000 123\n'],
  ['contact', 'identity', 'email', 'morgan@example.invalid\n'],
  ['links', 'links', 'link', 'https://example.invalid/morgan\n'],
  [
    null,
    '',
    'Unrecognized contact fragment. Assign it explicitly or exclude it after review.',
    'Unclear contact fragment: example-handle\n',
  ],
  ...contactSkillGroups.flatMap(
    ([category, list]): [CvSectionKind, string, string, string][] => [
      ['skills', category, 'skill_category', category + ':\n'],
      ['skills', category, 'skill', list + '\n'],
    ],
  ),
  ['experience', 'alpha', 'employer', 'Employer: Example Alpha\n'],
  ['experience', 'alpha', 'role', 'Role: Engineer\n'],
  ['experience', 'alpha', 'description', '• Assisted a team prototype.\n'],
];
export const contactSkillsCvSource: CvSource = {
  contractVersion: '1',
  id: '00000000-0000-4000-8000-000000000082',
  fileName: 'synthetic-source-cv.pdf',
  savedCvUpdatedAt: '2026-01-01T00:00:00.000Z',
  text: rows.map((r) => r[3]).join(''),
};
export function contactSkillsProfile(): CvProfile {
  const document: CvProfile['document'] = {
    contractVersion: '1',
    reconstruction: { version: '3', previousRevisionId: null },
    sections: [],
    coverage: [],
  };
  let start = 0;
  for (const [i, [kind, record, field, value]] of rows.entries()) {
    const end = start + value.length;
    if (!kind)
      document.coverage.push({
        start,
        end,
        disposition: 'unresolved',
        factIds: [],
        reason: field,
      });
    else {
      let section = document.sections.find((s) => s.kind === kind);
      if (!section) {
        section = {
          id: 'section-' + kind,
          kind,
          review: 'pending',
          entries: [],
        };
        document.sections.push(section);
      }
      let entry = section.entries.find((e) => e.id === 'record-' + record);
      if (!entry) {
        entry = { id: 'record-' + record, facts: [] };
        section.entries.push(entry);
      }
      const id = 'fact-' + i;
      entry.facts.push({
        id,
        field,
        value,
        origin: 'source',
        review: 'pending',
        evidence: [
          {
            sourceRevisionId: contactSkillsCvSource.id,
            start,
            end,
            quote: value,
          },
        ],
      });
      document.coverage.push({
        start,
        end,
        disposition: 'mapped',
        factIds: [id],
        reason: null,
      });
    }
    start = end;
  }
  return {
    contractVersion: '1',
    id: '00000000-0000-4000-8000-000000000083',
    profileId: '00000000-0000-4000-8000-000000000084',
    revision: 3,
    sourceRevisionId: contactSkillsCvSource.id,
    document,
  };
}

export function profileReferenceFixture(): {
  source: CvSource;
  profile: CvProfile;
} {
  const pieces = [
    '✉ ',
    'person@example.invalid ',
    '\uf05a ',
    'synthetic-person-123\n',
  ];
  const source = { ...contactSkillsCvSource, text: pieces.join('') };
  const profile = contactSkillsProfile();
  profile.document.sections = [
    {
      id: 'contact',
      kind: 'contact',
      review: 'pending',
      entries: [
        {
          id: 'email-record',
          facts: [
            {
              id: 'email',
              field: 'email',
              value: pieces[1]!,
              origin: 'source',
              review: 'pending',
              evidence: [
                {
                  sourceRevisionId: source.id,
                  start: pieces[0]!.length,
                  end: pieces[0]!.length + pieces[1]!.length,
                  quote: pieces[1]!,
                },
              ],
            },
          ],
        },
      ],
    },
  ];
  let start = 0;
  profile.document.coverage = pieces.map((value, index) => {
    const end = start + value.length;
    const row = {
      start,
      end,
      disposition: index === 1 ? ('mapped' as const) : ('unresolved' as const),
      factIds: index === 1 ? ['email'] : [],
      reason:
        index === 1
          ? null
          : index === 2
            ? 'PDF icon or separator artifact. Review before excluding.'
            : index === 3
              ? 'Possible LinkedIn profile reference beside a contact icon. Confirm the platform before creating a URL.'
              : 'Unrecognized contact fragment. Assign it explicitly or exclude it after review.',
    };
    start = end;
    return row;
  });
  return { source, profile };
}
