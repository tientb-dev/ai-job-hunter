import { expect, jest, test } from '@jest/globals';
import { AiService } from '../../src/ai/ai.service.js';
import { TailoredDraftGenerator } from '../../src/tailored-cv/tailored-draft.generator.js';
import {
  assembleDraft,
  lowValue,
  summaryClaims,
  weakened,
} from '../../src/tailored-cv/tailored-draft.policy.js';
import { draftInput } from '../support/tailored-draft-fixtures.js';

const javaJd =
  'senior java developer\njava, spring boot, hibernate/jpa, rest apis, postgresql, git\nbuild rest apis with java and spring boot.';

test('rewrites that drop verified leadership, ownership, titles or figures are weakening', () => {
  expect(
    weakened(
      'Led the development of core features using Java Spring Boot.',
      'Developed core features using Java Spring Boot.',
    ),
  ).toEqual(['leadership']);
  expect(
    weakened('Architected the payments API.', 'Worked on the payments API.'),
  ).toEqual(['ownership']);
  expect(
    weakened(
      'Reduced p95 latency from 800 ms to 200 ms with Redis caching.',
      'Improved API latency with Redis caching.',
    ),
  ).toEqual(['figures: 95, 800, 200']);
  // Another leadership word keeps the family; stronger wording is fine.
  expect(
    weakened('Led a team of 5 developers.', 'Managed a team of 5 developers.'),
  ).toEqual([]);
  expect(
    weakened(
      'Built the REST layer.',
      'Designed and built the REST layer for the accounting modules.',
    ),
  ).toEqual([]);
  // A summary may leave a figure to the bullet that documents it, but not a title.
  expect(
    weakened(
      'Technical Lead with 6+ years of experience. Completed Scrum Master training in 2025.',
      'Technical Lead with 6+ years of experience building Java services.',
      'summary',
    ),
  ).toEqual([]);
  expect(
    weakened(
      'Senior Full-Stack Engineer and Technical Lead with 6+ years of experience.',
      'Senior Software Engineer with 6+ years of experience.',
      'summary',
    ),
  ).toEqual(['leadership']); // "Technical Lead" dropped; "Senior" kept
});

test('skills: only reorders that put job-relevant items first are worth showing', () => {
  const original =
    'Java, Spring Boot, Hibernate, MyBatis, Node.js, NestJS, PHP, PostgreSQL';
  // Node.js moved ahead of Hibernate: worse for a Java JD.
  expect(
    lowValue(
      'skill',
      original,
      'Java, Spring Boot, Node.js, Hibernate, MyBatis, NestJS, PHP, PostgreSQL',
      javaJd,
    ),
  ).toBe(true);
  // A swap among already well-placed items.
  expect(
    lowValue(
      'skill',
      'Java, Spring Boot, Hibernate/JPA, REST APIs, PostgreSQL, Docker, Git, JavaScript',
      'Java, Spring Boot, Hibernate/JPA, REST APIs, PostgreSQL, Git, Docker, JavaScript',
      `${javaJd}\nnice to have: docker`,
    ),
  ).toBe(true);
  // PostgreSQL moved ahead of unrelated items: a real gain.
  expect(
    lowValue(
      'skill',
      original,
      'Java, Spring Boot, Hibernate, PostgreSQL, MyBatis, Node.js, NestJS, PHP',
      javaJd,
    ),
  ).toBe(false);
  // Dropping a skill loses content; a layout change of the same order is kept.
  expect(lowValue('skill', 'Java, SQL, PHP', 'Java, SQL', javaJd)).toBe(true);
  expect(lowValue('skill', 'Java, SQL', '• Java\n• SQL', javaJd)).toBe(false);
});

test('text: synonym swaps and small edits are low value; relevance, figures and real rewrites are not', () => {
  for (const [original, proposed] of [
    [
      'Fixed production bugs and took part in the on-call rotation.',
      'Fixed production bugs and participated in the on-call rotation.',
    ],
    [
      'Phát triển các API thanh toán bằng Java, dùng PostgreSQL.',
      'Phát triển các API thanh toán bằng Java, sử dụng PostgreSQL.',
    ],
    [
      'Reviewed pull requests and helped two new developers onboard.',
      'Reviewed pull requests and helped onboard two new developers.',
    ],
  ] as const)
    expect(lowValue('description', original, proposed, javaJd)).toBe(true);
  expect(
    lowValue(
      'description',
      'Worked on backend tasks for the team.',
      'Built REST APIs with Spring Boot for the team.',
      javaJd,
    ),
  ).toBe(false);
  expect(
    lowValue(
      'description',
      'Improved query speed.',
      'Improved query speed by 40%.',
      javaJd,
    ),
  ).toBe(false);
  expect(
    lowValue(
      'description',
      'Prepared weekly reports and maintained the Java billing service.',
      'Maintained the Java billing service and prepared weekly reports.',
      javaJd,
    ),
  ).toBe(false);
});

test('summary: a new headline title the CV never shows needs confirmation; held titles do not', () => {
  const cv = [
    'Software Developer\n',
    'Technical Lead\n',
    'Built APIs with Java.\n',
  ];
  expect(
    summaryClaims(
      'Software developer with 6 years of experience.',
      'Senior Java Developer with 6 years of experience.',
      cv,
      true,
    ),
  ).toContain('headline title: "Senior Java Developer"');
  expect(
    summaryClaims(
      'Software developer with 6 years of experience.',
      'Technical Lead with 6 years of experience. Builds APIs with Java.',
      cv,
      true,
    ),
  ).toEqual([]);
  // "5 years, 4 of them with Java" supports "4 years with Java".
  expect(
    summaryClaims(
      'Backend engineer with 5 years of experience, 4 of them with Java and Spring Boot.',
      'Backend engineer with 5 years of experience, including 4 years with Java and Spring Boot.',
      [],
      true,
    ),
  ).toEqual([]);
});

test('a draft keeps only worthwhile suggestions; weakened and cosmetic ones leave the original', async () => {
  const input = draftInput(
    'Java',
    false,
    'Led the development of Java APIs for internal tools.\n',
  );
  const entryId = input.plan.candidates.find((f) => f.id === 'java')!.entryId;
  const doc = assembleDraft(input, [
    {
      selectedFactIds: ['java'],
      proposals: [
        {
          factId: 'java',
          entryId,
          requirementIds: [],
          text: 'Developed Java APIs for internal tools.',
          explanation: 'Clearer.',
          confirmationAssertion: null,
        },
      ],
      questions: [],
    } as never,
  ]);
  const fact = doc.sections
    .flatMap((s) => s.entries.flatMap((e) => e.facts))
    .find((f) => f.id === 'java')!;
  expect(fact.proposedWording).toBeNull();
  expect(fact.acceptedText).toBe(
    'Led the development of Java APIs for internal tools.\n',
  );

  // Through the generator: 2 of 3 returned proposals are hidden and counted.
  const gen = draftInput(
    'Java',
    false,
    'Built Java APIs for internal tools.\n',
  );
  const id = gen.plan.candidates.find((f) => f.id === 'java')!.entryId;
  const scope = gen.plan.candidates.find((f) => f.id === 'scope')!;
  const generate = jest.fn(async ({ prompt }: { prompt: string }) => {
    expect(prompt).toContain(
      'Objective: produce a stronger, more relevant, concise and credible CV for this particular job, using only evidence supported by the candidate',
    );
    expect(prompt).toContain('Five is a maximum, not a target');
    expect(prompt).toContain(
      'never move a less relevant technology ahead of a more relevant one',
    );
    expect(prompt).toContain(
      'Keep or strengthen verified verbs (led, owned, designed, architected)',
    );
    expect(prompt).toContain('Do not list the job');
    return JSON.stringify({
      outcome: 'opportunities',
      questions: [],
      proposals: [
        {
          factId: 'java',
          entryId: id,
          requirementIds: [],
          text: 'Designed and built Java REST APIs that internal tools depend on.',
          explanation: 'Names the API design work first.',
          confirmationAssertion: null,
        },
        {
          factId: 'scope',
          entryId: scope.entryId,
          requirementIds: [],
          text: 'Assisted a team prototype only; individual production ownership is not stated.',
          explanation: 'Synonym.',
          confirmationAssertion: null,
        },
      ],
    });
  });
  const { document, decisions } = await new TailoredDraftGenerator(
    new AiService({ generate } as never),
  ).generate(gen, async () => {});
  const shown = document.sections
    .flatMap((s) => s.entries.flatMap((e) => e.facts))
    .filter((f) => f.proposedWording)
    .map((f) => f.id);
  expect(shown).toEqual(['java']);
  expect(decisions.suggestionsReturned).toBe(2);
  expect(decisions.formattingOnlySuppressed).toBe(1);
});

const skillsInput = (lines: string[]) => {
  const input = draftInput('Java');
  input.job.skills = 'Java, Spring Boot, Hibernate, PostgreSQL, RabbitMQ';
  const section = {
    id: 'section-skills',
    kind: 'skills' as const,
    review: 'confirmed' as const,
    entries: lines.map((_, i) => ({ id: `k${i}`, facts: [] })),
  };
  input.plan.profile.sections.push(section);
  lines.forEach((value, i) =>
    input.plan.facts.push({
      id: `k${i}`,
      field: 'skill',
      value,
      sectionId: section.id,
      sectionKind: 'skills',
      entryId: `k${i}`,
      confirmation: 'section',
      origin: 'source',
      evidence: [],
    } as never),
  );
  return input;
};
const propose = (factId: string, entryId: string, text: string) => ({
  factId,
  entryId,
  requirementIds: [],
  text,
  explanation: 'Puts the most relevant technologies first for this role.',
  confirmationAssertion: null,
});

test('skills: labelled groups are compared without the label; neighbour swaps are hidden, real promotions shown', () => {
  expect(
    lowValue(
      'skill',
      'Databases: PostgreSQL, MySQL, SQL Server, Oracle',
      'Databases: MySQL, PostgreSQL, SQL Server, Oracle',
      'postgresql mysql sql server oracle',
    ),
  ).toBe(true);
  expect(
    lowValue(
      'skill',
      'Architecture: Microservices, REST APIs, Asynchronous Messaging, RabbitMQ',
      'Architecture: RabbitMQ, Microservices, REST APIs, Asynchronous Messaging',
      'microservices rest apis rabbitmq',
    ),
  ).toBe(true); // fixes one misplaced pair only
  // Brings a required job skill into the first three items.
  expect(
    lowValue(
      'skill',
      'Backend: PHP, Laravel, Node.js, NestJS, Java, Spring Boot',
      'Backend: Java, Spring Boot, PHP, Laravel, Node.js, NestJS',
      'java spring boot',
      'Java, Spring Boot',
    ),
  ).toBe(false);
});

test('section budget: at most one Summary and two Skills suggestions are shown, in the model order; the rest go to Experience', () => {
  const input = skillsInput([
    'PHP, Laravel, Node.js, Java, Spring Boot',
    'MySQL, MongoDB, Redis, PostgreSQL, Hibernate',
    'Docker, Kafka, Git, RabbitMQ, Jenkins',
  ]);
  const diagnostics = {};
  const entryId = input.plan.candidates.find((f) => f.id === 'java')!.entryId;
  const doc = assembleDraft(
    input,
    [
      {
        selectedFactIds: ['k0', 'k1', 'k2', 'java'],
        proposals: [
          propose('k0', 'k0', 'Java, Spring Boot, PHP, Laravel, Node.js'),
          propose('k1', 'k1', 'PostgreSQL, Hibernate, MySQL, MongoDB, Redis'),
          propose('k2', 'k2', 'RabbitMQ, Docker, Kafka, Git, Jenkins'),
          propose(
            'java',
            entryId,
            'Built Java REST APIs that internal tools rely on for daily operations.',
          ),
        ],
        questions: [],
      } as never,
    ],
    diagnostics,
  );
  const shown = doc.sections
    .flatMap((s) => s.entries.flatMap((e) => e.facts))
    .filter((f) => f.proposedWording)
    .map((f) => f.id);
  expect(shown).toEqual(['java', 'k0', 'k1']);
  expect(diagnostics).toMatchObject({
    skills: { candidates: 3, shown: 2, hidden: 1, reasons: { section_cap: 1 } },
    experience: { candidates: 1, shown: 1, hidden: 0 },
  });
});

test('diagnostics are text-free: counts and stable reason codes only', () => {
  const input = draftInput(
    'Java',
    false,
    'Led the development of Java APIs for internal tools.\n',
  );
  const entryId = input.plan.candidates.find((f) => f.id === 'java')!.entryId;
  const diagnostics = {};
  assembleDraft(
    input,
    [
      {
        selectedFactIds: ['java', 'scope'],
        proposals: [
          propose('java', entryId, 'Developed Java APIs for internal tools.'),
          propose(
            'scope',
            entryId,
            'Assisted a team prototype only; individual production ownership is not claimed.',
          ),
        ],
        questions: [],
      } as never,
    ],
    diagnostics,
  );
  expect(diagnostics).toEqual({
    experience: {
      candidates: 2,
      shown: 0,
      confirm: 0,
      hidden: 2,
      reasons: { weakened_leadership: 1, identical: 1 },
      reasonWordsAvg: 0,
    },
  });
  const json = JSON.stringify(diagnostics);
  for (const fact of input.plan.facts)
    for (const word of fact.value.match(/\p{L}{5,}/gu) ?? [])
      expect(json).not.toContain(word);
  expect(json).not.toContain('Developed');
});

test('no forced suggestions: "no_change" shows nothing; diagnostics stay empty', async () => {
  const input = draftInput('Java');
  const generate = jest.fn(async ({ prompt }: { prompt: string }) => {
    expect(prompt).toContain('Work Experience-first');
    // Experience guidance comes before Summary and Skills guidance.
    expect(prompt.indexOf('- Experience and projects:')).toBeLessThan(
      prompt.indexOf('- Summary:'),
    );
    expect(prompt.indexOf('- Summary:')).toBeLessThan(
      prompt.indexOf('- Skills:'),
    );
    expect(prompt).toContain(
      'at most one Summary proposal and at most two Skills proposals',
    );
    expect(prompt).toContain(
      'never return a fact with its original or nearly identical wording',
    );
    expect(prompt).toContain('fewer proposals are correct for a strong CV');
    expect(prompt).toContain('exactly one sentence of 15 to 25 words');
    expect(prompt).toContain(
      'instead of "6+ years building Java backend applications"',
    );
    return JSON.stringify({
      outcome: 'no_change',
      proposals: [],
      questions: [],
    });
  });
  const { document, decisions } = await new TailoredDraftGenerator(
    new AiService({ generate } as never),
  ).generate(input, async () => {});
  expect(
    document.sections
      .flatMap((s) => s.entries.flatMap((e) => e.facts))
      .some((f) => f.proposedWording),
  ).toBe(false);
  expect(decisions.sections).toEqual({});
});

test('text: deleting a word in front of a job term does not count as moving it forward', () => {
  expect(
    lowValue(
      'description',
      'Led the development of core features using Java Spring Boot and SQL Server.',
      'Led the development of core features with Java Spring Boot and SQL Server.',
      'java spring boot sql server',
    ),
  ).toBe(true);
});
