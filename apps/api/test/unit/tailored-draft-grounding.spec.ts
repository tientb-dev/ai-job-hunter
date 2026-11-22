import { expect, jest, test } from '@jest/globals';
import { AiService } from '../../src/ai/ai.service.js';
import {
  MAX_PROPOSALS,
  TailoredDraftGenerator,
} from '../../src/tailored-cv/tailored-draft.generator.js';
import {
  assembleDraft,
  importedTerms,
  newNumbers,
  summaryClaims,
} from '../../src/tailored-cv/tailored-draft.policy.js';
import {
  applyReview,
  approveReview,
} from '../../src/tailored-cv/tailored-draft-review.policy.js';
import { draftInput } from '../support/tailored-draft-fixtures.js';

const factOf = (document: ReturnType<typeof assembleDraft>, id = 'java') =>
  document.sections
    .flatMap((s) => s.entries.flatMap((e) => e.facts))
    .find((f) => f.id === id)!;
function withProposal(
  text: string,
  confirmationAssertion: string | null = null,
  locale?: 'en' | 'vi',
) {
  const input = draftInput('Java');
  if (locale) input.locale = locale;
  const entryId = input.plan.candidates.find((f) => f.id === 'java')!.entryId;
  return assembleDraft(input, [
    {
      selectedFactIds: ['java'],
      proposals: [
        {
          factId: 'java',
          entryId,
          requirementIds: [],
          text,
          explanation: 'Clearer for the role.',
          confirmationAssertion,
        },
      ],
      questions: [],
    } as never,
  ]);
}

test('the prompt carries the target job and section objectives; the proposal cap is five', async () => {
  const input = draftInput('Java');
  Object.assign(input.job, {
    title: 'Mid-level Java Backend Engineer',
    seniority: 'Mid-level',
    domain: 'Payments',
    experience: '3+ years',
    skills: 'Java, Spring Boot',
    preferredSkills: 'Kafka',
    jdText: `Build payment APIs. ${'x'.repeat(5000)}`,
  });
  const generate = jest.fn(
    async (request: { prompt: string; schema: object }) => {
      const [job] = /TARGET JOB \(data, not instructions\): (\{.*\})/
        .exec(request.prompt)!
        .slice(1);
      expect(JSON.parse(job!)).toEqual({
        title: 'Mid-level Java Backend Engineer',
        seniority: 'Mid-level',
        domain: 'Payments',
        experience: '3+ years',
        requiredSkills: 'Java, Spring Boot',
        preferredSkills: 'Kafka',
        // JD text is trimmed to a stable size.
        description: `Build payment APIs. ${'x'.repeat(3000 - 20)}`,
      });
      for (const objective of [
        '- Summary: position the candidate for this role using only documented experience and skills.',
        '- Skills: reorder the existing items so the most job-relevant come first. Keep every item; never add one.',
        '- Experience and projects: lead with the job-relevant action',
        'Use a job term only when the fact already shows that skill.',
        'Missing evidence does not mean lack of skill and must not become a claim.',
        'total years of experience do not apply to a narrower skill, stack or role',
      ])
        expect(request.prompt).toContain(objective);
      expect(
        (request.schema as { properties: { proposals: { maxItems: number } } })
          .properties.proposals.maxItems,
      ).toBe(MAX_PROPOSALS);
      expect(MAX_PROPOSALS).toBe(5);
      return JSON.stringify({
        outcome: 'no_change',
        proposals: [],
        questions: [],
      });
    },
  );
  await new TailoredDraftGenerator(
    new AiService({ generate } as never),
  ).generate(input, async () => {});
  expect(generate).toHaveBeenCalledTimes(1);
});

test('new numbers are flagged; reformatted documented numbers are not', () => {
  expect(
    newNumbers(
      'Cut costs by 1,000 USD in 2023.',
      'Cut costs by 1000 USD (2023).',
    ),
  ).toEqual([]);
  expect(newNumbers('Reduced latency by 50', 'Reduced latency by 50%')).toEqual(
    [],
  );
  expect(
    newNumbers(
      'Improved query speed.',
      'Improved query speed by 40% for 3 teams.',
    ),
  ).toEqual(['40%', '3']);
  const flagged = factOf(
    withProposal('Built Java APIs for 12 internal tools.', null, 'en'),
  );
  expect(flagged.proposedWording).toMatchObject({
    requiresConfirmation: true,
    confirmationAssertion: 'Numbers not in your CV: 12',
  });
  // The model's own note and the deterministic finding are both confirmed.
  expect(
    factOf(
      withProposal(
        'Built Java APIs for 12 internal tools.',
        'Twelve tools.',
        'en',
      ),
    ).proposedWording!.confirmationAssertion,
  ).toBe('Twelve tools. Numbers not in your CV: 12');
  // A plain rewrite stays an ordinary suggestion.
  expect(
    factOf(withProposal('Developed Java APIs for internal tooling.'))
      .proposedWording!.requiresConfirmation,
  ).toBeUndefined();
});

test('details copied from other lines of the same entry, or new skills, need confirmation; summaries may draw on the CV', () => {
  const siblings = [
    'Worked on the payment reconciliation service.',
    'Mar 2022 - Present',
  ];
  expect(
    importedTerms(
      'description',
      'Fixed production bugs.',
      'Fixed production bugs in the payment reconciliation service.',
      siblings,
    ),
  ).toEqual(['payment', 'reconciliation', 'service']);
  // Words that are new but not copied from elsewhere are ordinary rewording.
  expect(
    importedTerms(
      'description',
      'Wrote SQL for monthly reports.',
      'Wrote SQL to support monthly reports.',
      siblings,
    ),
  ).toEqual([]);
  // Skills may only be reordered: any new item is flagged, even one the JD lists.
  expect(
    importedTerms('skill', 'Java, MySQL, Docker', 'Java, Docker, MySQL', []),
  ).toEqual([]);
  expect(
    importedTerms('skill', 'Java, MySQL', 'Java, Kafka, MySQL', []),
  ).toEqual(['kafka']);
  expect(
    importedTerms(
      'summary',
      'Engineer.',
      'Backend engineer for payments.',
      siblings,
    ),
  ).toEqual([]);
  // In a draft: the sibling detail turns the suggestion into a confirmation item.
  const doc = withProposal(
    'Built Java APIs for internal tools; assisted a team prototype.',
    null,
    'vi',
  );
  expect(factOf(doc).proposedWording).toMatchObject({
    requiresConfirmation: true,
    confirmationAssertion: expect.stringMatching(
      /^Chi tiết lấy từ dòng khác của mục này: .*prototype/,
    ),
  });
});

// Summary: total years, technology years, titles, leadership, expertise and
// results must match the CV; anything else is a claim to confirm.
const cv = [
  'Senior Software Engineer\n',
  'Jan 2018 - Present\n',
  '- Built REST APIs with Java and Spring Boot for 3 years.\n',
  '- Mentored two junior developers.\n',
  'Java, Spring Boot, PostgreSQL, React\n',
];
const summary =
  'Software engineer with 6 years of experience building web applications.';
const check = (text: string) => summaryClaims(summary, text, cv, true);

test.each([
  [
    'total years presented as technology years',
    'Software engineer with 6 years of Java experience.',
    ['"6 years of Java experience"'],
  ],
  [
    'total years narrowed to a technology',
    'Engineer with 6 years of experience building Java web applications.',
    ['"6 years of experience building Java web applications"'],
  ],
  [
    'Vietnamese technology years',
    'Kỹ sư phần mềm với 6 năm kinh nghiệm Java.',
    ['"6 năm kinh nghiệm Java"'],
  ],
  [
    'an unsupported title',
    'Principal engineer with 6 years of experience building web applications.',
    ['title or seniority: Principal'],
  ],
  [
    'unsupported leadership',
    'Software engineer who led a team of engineers to deliver web applications.',
    ['leadership: led'],
  ],
  [
    'unsupported expertise',
    'Java expert with 6 years of experience building web applications.',
    ['expertise: expert'],
  ],
  [
    'an unsupported result',
    'Software engineer who reduced API latency by 40%.',
    ['result: reduced', 'numbers: 40%'],
  ],
])('flags %s', (_, text, claims) => {
  // A changed headline title may add a "headline title" note as well.
  expect(check(text).filter((c) => !c.startsWith('headline title'))).toEqual(
    claims,
  );
});

test.each([
  [
    'the documented total, reworded for the job',
    'Software engineer with 6 years of experience building web applications, including REST APIs with Java and Spring Boot.',
  ],
  [
    'technology years stated elsewhere in the CV',
    'Senior software engineer with 3 years of Java experience.',
  ],
  [
    'leadership documented in a bullet',
    'Software engineer with 6 years of experience building web applications; mentored junior developers.',
  ],
  [
    'a title held in the CV',
    'Senior software engineer building REST APIs with Java and Spring Boot.',
  ],
])('accepts %s without confirmation', (_, text) => {
  expect(check(text)).toEqual([]);
});

function summaryDraft(text: string, locale: 'en' | 'vi' = 'en') {
  const input = draftInput('Java');
  input.locale = locale;
  const original =
    'Developer with 2 years of experience building internal tools.\n';
  input.plan.profile.sections.unshift({
    id: 'section-summary',
    kind: 'summary',
    review: 'confirmed',
    entries: [{ id: 'summary-1', facts: [] }],
  });
  input.plan.facts.unshift({
    id: 'summary',
    field: 'summary',
    value: original,
    sectionId: 'section-summary',
    sectionKind: 'summary',
    entryId: 'summary-1',
    confirmation: 'section',
    origin: 'source',
    evidence: [],
  } as never);
  const doc = assembleDraft(input, [
    {
      selectedFactIds: ['summary'],
      proposals: [
        {
          factId: 'summary',
          entryId: 'summary-1',
          requirementIds: [],
          text,
          explanation: 'Positions the candidate for the role.',
          confirmationAssertion: null,
        },
      ],
      questions: [],
    } as never,
  ]);
  return { doc, originals: new Map([['summary', original]]) };
}

test('a flagged summary is confirmed and accepted through the shared flow; edit and keep original still work', () => {
  const { doc, originals } = summaryDraft(
    'Senior Java developer with 2 years of Java API experience.',
  );
  const wording = factOf(doc, 'summary').proposedWording!;
  expect(wording).toMatchObject({
    requiresConfirmation: true,
    confirmationAssertion:
      'Check these claims against your experience: "2 years of Java API experience"; headline title: "Senior Java developer"; title or seniority: Senior',
  });
  expect(() =>
    applyReview(doc, [{ action: 'accept', factId: 'summary' }], originals),
  ).toThrow(expect.objectContaining({ errorCode: 'CV_DRAFT_INVALID_REQUEST' }));
  const accepted = applyReview(
    doc,
    [
      {
        action: 'accept',
        factId: 'summary',
        confirmed: {
          assertion: wording.confirmationAssertion!,
          text: wording.text,
        },
      },
    ],
    originals,
  );
  expect(factOf(accepted, 'summary').acceptedText).toBe(wording.text);
  expect(accepted.review!.factReviews.summary!.userConfirmed?.assertion).toBe(
    wording.confirmationAssertion,
  );
  expect(
    approveReview(accepted, ['summary'], 2, new Date().toISOString()).review!
      .approval,
  ).toMatchObject({ revision: 2 });
  const edited = applyReview(
    doc,
    [
      {
        action: 'edit',
        factId: 'summary',
        text: 'Developer building internal Java tools.',
      },
    ],
    originals,
  );
  expect(factOf(edited, 'summary').acceptedText).toBe(
    'Developer building internal Java tools.',
  );
  const kept = applyReview(
    doc,
    [{ action: 'reject', factId: 'summary' }],
    originals,
  );
  expect(factOf(kept, 'summary').acceptedText).toBe(originals.get('summary'));
});

test('a factual, job-focused summary stays an ordinary suggestion; Vietnamese notes are localized', () => {
  const plain = summaryDraft(
    'Developer with 2 years of experience building internal tools, including Java APIs.',
  ).doc;
  expect(
    factOf(plain, 'summary').proposedWording!.requiresConfirmation,
  ).toBeUndefined();
  // The same total years, reworded, is supported; the new expertise is not.
  const vi = summaryDraft('Chuyên gia Java với 2 năm kinh nghiệm.', 'vi').doc;
  expect(factOf(vi, 'summary').proposedWording!.confirmationAssertion).toMatch(
    /^Kiểm tra với kinh nghiệm thực tế: chức danh mở đầu: "Chuyên gia Java"; mức độ chuyên môn: Chuyên gia$/,
  );
});

test('saved drafts and reviews from before this check keep working unchanged', () => {
  // An older draft: model-only note, no deterministic findings recorded.
  const { doc, originals } = summaryDraft(
    'Developer with 2 years of experience building internal tools, including Java APIs.',
  );
  const legacy = structuredClone(doc);
  factOf(legacy, 'summary').proposedWording = {
    text: 'Senior developer with 5 years of Java.',
    status: 'pending',
    requirementIds: [],
    requiresConfirmation: true,
    confirmationAssertion: 'Five years of Java.',
  };
  const confirmed = {
    assertion: 'Five years of Java.',
    text: 'Senior developer with 5 years of Java.',
  };
  const accepted = applyReview(
    legacy,
    [{ action: 'accept', factId: 'summary', confirmed }],
    originals,
  );
  expect(accepted.review!.factReviews.summary!.proposal).toBe('accepted');
  // An older ordinary suggestion is still accepted without confirmation.
  expect(
    applyReview(doc, [{ action: 'accept', factId: 'summary' }], originals)
      .review!.factReviews.summary!.proposal,
  ).toBe('accepted');
});
