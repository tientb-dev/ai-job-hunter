import { assembleDraft } from '../../src/tailored-cv/tailored-draft.policy.js';
import { initialReview } from '../../src/tailored-cv/tailored-draft-review.policy.js';
import type {
  CvSectionKind,
  TailoredDraftDocument,
} from '../../src/tailored-cv/tailored-draft.contract.js';
import { draftInput } from './tailored-draft-fixtures.js';
export function exportFixtures(): {
  id: string;
  document: TailoredDraftDocument;
}[] {
  const source: [CvSectionKind, string, string][] = [
    ['contact', 'name', 'Nguyễn Thị Minh Anh'],
    ['contact', 'email', 'minh.anh@example.invalid | Hà Nội, Việt Nam'],
    [
      'summary',
      'summary',
      'Developer with academic SQL Server coursework and Java team contributions.',
    ],
    [
      'skills',
      'skill',
      'Java, Git; SQL Server — academic coursework only, no professional proficiency claim.',
    ],
    ['experience', 'employer', 'Example Studio'],
    ['experience', 'role', 'Junior developer'],
    ['experience', 'dates', '2023–2025'],
    [
      'experience',
      'description',
      'Assisted a team with internal Java prototypes; team contribution only.',
    ],
    ['projects', 'project', 'University database project'],
    [
      'projects',
      'description',
      'Used SQL Server for university coursework; no production administration.',
    ],
    [
      'education',
      'qualification',
      'BSc Computer Science studies in progress, 2022–present',
    ],
    ['certifications', 'text', 'University participation certificate, 2024'],
    ['languages', 'language', 'Vietnamese; English'],
    ['links', 'link', 'https://example.invalid/minh-anh'],
    ['additional', 'text', 'Volunteer mentor for a university study group.'],
  ];
  function make(id: string, rows: typeof source) {
    const document = assembleDraft(draftInput(), []);
    document.sections = [];
    document.reviewIssues = [];
    for (const [kind, field, text] of rows) {
      let section = document.sections.find((s) => s.kind === kind);
      if (!section) {
        section = {
          id: kind,
          kind,
          entries: [
            {
              id: `${kind}-entry`,
              originalOrder: 0,
              priorityFactIds: [],
              facts: [],
            },
          ],
        };
        document.sections.push(section);
      }
      const factId = `fact-${document.sections.flatMap((s) => s.entries.flatMap((e) => e.facts)).length}`;
      section.entries[0]!.facts.push({
        id: factId,
        field,
        acceptedText: text,
        selected: true,
        provenance: {
          profileFactId: factId,
          origin: 'user_entered',
          confirmation: 'field',
          evidence: [],
        },
        relevance: [],
        proposedWording: null,
      });
    }
    document.review = initialReview(document);
    document.review.approval = {
      revision: 3,
      approvedAt: '2026-11-06T00:00:00.000Z',
    };
    return { id, document };
  }
  return [
    make('standard', source),
    make('multi-page', [
      ...source,
      ...Array.from(
        { length: 24 },
        (_, i) =>
          [
            'experience',
            'description',
            `Project ${i + 1}, 2023–2025: ` +
              'Contributed to team Java prototype testing and documented existing behavior. '.repeat(
                8,
              ),
          ] as (typeof source)[number],
      ),
    ]),
    make(
      'vietnamese',
      source.map((row) =>
        row[0] === 'summary'
          ? [
              'summary',
              'summary',
              'Kỹ sư phần mềm tại Hà Nội. Hỗ trợ nhóm xây dựng công cụ nội bộ, không tự nhận quyền sở hữu toàn bộ dự án.',
            ]
          : row,
      ),
    ),
    make('long-urls', [
      ...source,
      [
        'links',
        'link',
        'https://example.invalid/portfolio/' +
          'long-project-path-'.repeat(45) +
          '?reference=synthetic',
      ],
      [
        'additional',
        'text',
        'Sở thích: đọc sách, nghiên cứu cơ sở dữ liệu trong môi trường học thuật.',
      ],
    ]),
    make(
      'academic',
      source.filter((row) => row[0] !== 'experience'),
    ),
  ];
}
