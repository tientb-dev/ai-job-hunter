import { exportFixtures } from './cv-export-fixtures.js';
import { initialReview } from '../../src/tailored-cv/tailored-draft-review.policy.js';
import type { DraftFact } from '../../src/tailored-cv/tailored-draft.contract.js';

export function cvPolishFixture() {
  const document = exportFixtures()[0]!.document;
  let sequence = 0;
  const fact = (field: string, acceptedText: string): DraftFact => {
    const id = `polish-${sequence++}`;
    return {
      id,
      field,
      acceptedText,
      selected: true,
      proposedWording: null,
      relevance: [],
      provenance: {
        profileFactId: id,
        origin: 'user_entered',
        confirmation: 'field',
        evidence: [],
      },
    };
  };
  document.sections.find((s) => s.kind === 'experience')!.entries = [
    ['Junior Developer', 'role', 'Example Studio', '2020–2022'],
    [
      'Software Engineer — Kỹ sư phần mềm',
      'headline',
      'Example Research',
      '2022–2024',
    ],
    ['Senior Engineer', 'role', 'Example Products', '2024–present'],
  ].map(([role, field, employer, dates], index) => ({
    id: `role-${index}`,
    originalOrder: index,
    priorityFactIds: [],
    facts: [
      fact('employer', employer!),
      fact(field!, role!),
      fact('dates', dates!),
      fact(
        'description',
        'Hỗ trợ nhóm xây dựng công cụ nội bộ tại Hà Nội. ' +
          'Contributed to team Java prototypes and documented existing behavior. '.repeat(
            8,
          ),
      ),
    ],
  }));
  document.sections.find((s) => s.kind === 'skills')!.entries = [
    {
      id: 'technical-skills',
      originalOrder: 0,
      priorityFactIds: [],
      facts: [
        fact('skill_category', 'Programming, databases and development tools'),
        fact(
          'skill',
          'Java, TypeScript, PostgreSQL, Git, automated testing; SQL Server — academic coursework only.',
        ),
      ],
    },
    {
      id: 'communication-skills',
      originalOrder: 1,
      priorityFactIds: [],
      facts: [
        fact(
          'skill_category',
          'Collaboration, documentation and communication practices',
        ),
        fact(
          'skill',
          'Technical documentation, team coordination, delivery planning, requirements discussion, Stakeholder Communication, knowledge sharing; contributions within a team.',
        ),
      ],
    },
  ];
  document.review = initialReview(document);
  document.review.approval = {
    revision: 3,
    approvedAt: '2026-11-08T00:00:00.000Z',
  };
  return document;
}
