import { describe, expect, test } from '@jest/globals';
import { compileOutputSchema } from '../../src/ai/ai.schema.js';
import {
  JOB_QUESTIONS_SCHEMA,
  ACTIVE_SET_OVERLAP,
  DUPLICATE_OVERLAP,
  jdSnapshot,
  jobQuestionsPrompt,
  parseFamily,
  validateQuestions,
} from '../../src/interview-prep/job-questions.policy.js';

// Synthetic JD only.
const job = {
  title: 'Backend Engineer',
  description:
    'You will build event-driven services.\nStrong experience with PostgreSQL and Kafka is required.\nDesign REST APIs for high traffic.',
  skills: 'Node.js, TypeScript, PostgreSQL',
  preferredSkills: 'Kubernetes is a plus',
  experience: '3+ years building backend services',
  domain: 'Fintech',
  seniority: 'Mid',
};
const snap = jdSnapshot(job);
const item = (over: Record<string, unknown> = {}) => ({
  question: 'How does PostgreSQL MVCC handle concurrent updates?',
  category: 'skill',
  kind: 'general',
  why: 'The JD requires strong PostgreSQL experience.',
  evidence: 'Strong experience with PostgreSQL and Kafka is required',
  ...over,
});
const check = (...items: Record<string, unknown>[]) =>
  validateQuestions({ questions: items }, snap.source);

describe('JD snapshot', () => {
  test('is deterministic, labelled, and hashes only JD fields', () => {
    expect(jdSnapshot({ ...job }).hash).toBe(snap.hash);
    expect(snap.hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(snap.text).toContain('Required skills:\nNode.js, TypeScript');
    expect(jdSnapshot({ ...job, description: 'Changed.' }).hash).not.toBe(
      snap.hash,
    );
    // CRLF and trailing whitespace do not change the snapshot.
    expect(jdSnapshot({ ...job, skills: `${job.skills}  \r\n` }).hash).toBe(
      snap.hash,
    );
  });
  test('a title alone, or a tiny JD, is empty', () => {
    const blank = {
      ...job,
      description: '',
      skills: '',
      preferredSkills: '',
      experience: '',
      domain: '',
      seniority: '',
    };
    expect(jdSnapshot(blank).empty).toBe(true);
    expect(jdSnapshot({ ...blank, skills: 'Java' }).empty).toBe(true);
    expect(snap.empty).toBe(false);
  });
});

describe('prompt and schema', () => {
  test('fences the JD as untrusted data and asks for questions only', () => {
    const prompt = jobQuestionsPrompt(snap.text);
    expect(prompt).toContain(`"""\n${snap.text}\n"""`);
    expect(prompt).toMatch(/untrusted text/u);
    expect(prompt).toMatch(/Never assume the candidate has used/u);
    expect(prompt).toMatch(/Do not write answers/u);
    expect(prompt).not.toMatch(/already chosen/u);
  });
  test('asks for a specific why, not a generic restatement', () => {
    const prompt = jobQuestionsPrompt(snap.text);
    expect(prompt).toMatch(
      /why: [^\n]*specific skill, concept or reasoning[^\n]*why this role needs it/u,
    );
    expect(prompt).toMatch(/Do not write generic text/u);
  });
  test('initial prompt has no avoid list; an avoid list adds new-angle guidance', () => {
    expect(jobQuestionsPrompt(snap.text)).not.toMatch(/other angles/u);
    expect(jobQuestionsPrompt(snap.text, ['Q?'])).toMatch(
      /Explore other angles of the same JD[^\n]*grounded in the JD/u,
    );
  });
  test('illustrative numbers must be framed as hypothetical', () => {
    expect(jobQuestionsPrompt(snap.text)).toMatch(
      /number the JD does not state[^\n]*hypothetical scenario, not as a job requirement[^\n]*"Suppose a campaign's cost per lead doubled in one month\. How would you find the cause\?"[^\n]*implies the JD states a number it does not/u,
    );
  });
  test('the retry prompt lists questions to avoid', () => {
    expect(jobQuestionsPrompt(snap.text, ['Q one?', 'Q two?'])).toContain(
      'write DIFFERENT ones:\n  - Q one?\n  - Q two?',
    );
  });
  test('the schema compiles with the shared AI schema validator', () => {
    expect(() => compileOutputSchema(JOB_QUESTIONS_SCHEMA)).not.toThrow();
  });
});

describe('question validation', () => {
  test('accepts a grounded concept question and normalizes whitespace', () => {
    const { valid, rejected } = check(
      item({
        question: '  How does PostgreSQL   MVCC handle concurrent updates? ',
      }),
    );
    expect(rejected).toEqual([]);
    expect(valid).toEqual([
      expect.objectContaining({
        question: 'How does PostgreSQL MVCC handle concurrent updates?',
      }),
    ]);
  });
  test('evidence must be a verbatim JD phrase (case, spacing and punctuation folded)', () => {
    expect(
      check(item({ evidence: 'strong EXPERIENCE with postgresql   and kafka' }))
        .valid,
    ).toHaveLength(1);
    for (const evidence of [
      'Deep experience with PostgreSQL is required', // paraphrase
      'Strong experience with MySQL and Kafka', // altered
      'Required skills: Node.js', // our label, not JD text
      'PostgreSQL Kafka', // too short
    ])
      expect(check(item({ evidence })).rejected).toEqual([
        evidence.length < 15 ? 'SHAPE' : 'EVIDENCE',
      ]);
    // Matching must align to word boundaries.
    expect(
      check(item({ evidence: 'trong experience with PostgreSQL' })).rejected,
    ).toEqual(['EVIDENCE']);
  });
  test('rejects technologies that the JD never mentions', () => {
    expect(
      check(
        item({ question: 'How would you tune MongoDB indexes for writes?' }),
      ).rejected,
    ).toEqual(['TECHNOLOGY']);
    expect(
      check(item({ why: 'Redis caching is central to this role.' })).rejected,
    ).toEqual(['TECHNOLOGY']);
    expect(
      check(
        item({
          question: 'How would you run Node.js services on Kubernetes?',
          kind: 'hypothetical',
        }),
      ).valid,
    ).toHaveLength(1);
  });
  test('rejects wording that presumes the candidate used a technology', () => {
    for (const [question, kind] of [
      ['Tell me about your experience with Kafka in production.', 'general'],
      ['How did you scale PostgreSQL in your last project?', 'general'],
      ['What challenges did you face when you used Kafka?', 'hypothetical'],
      [
        'Describe how you have used Kafka for event-driven services.',
        'personal',
      ],
      ['Which Kafka partitioning strategy did your team choose?', 'general'],
      ['How would we design our REST APIs for high traffic?', 'hypothetical'],
      ['Have you used Kafka? How did you handle consumer lag?', 'personal'],
    ] as const)
      expect(check(item({ question, kind })).rejected).toEqual([
        'PRESUMES_EXPERIENCE',
      ]);
  });
  test('accepts neutral and conditionally worded experience questions', () => {
    const { valid, rejected } = check(
      item({
        question:
          'Have you worked with Kafka? If so, how did you handle consumer lag?',
        kind: 'personal',
        category: 'experience',
      }),
      item({
        question:
          'If you have designed REST APIs for high traffic, what trade-offs mattered most?',
        kind: 'personal',
        category: 'experience',
        evidence: 'Design REST APIs for high traffic',
      }),
      item({
        question:
          'How would you design REST APIs for high traffic with Node.js?',
        kind: 'hypothetical',
        category: 'architecture',
        evidence: 'Design REST APIs for high traffic',
      }),
    );
    expect(rejected).toEqual([]);
    expect(valid).toHaveLength(3);
  });
  test('rejects generic HR questions', () => {
    for (const question of [
      'What are your greatest strengths as a backend engineer?',
      'What are your salary expectations for this PostgreSQL role?',
      'Where do you see your career goals in five years?',
      'What motivates you to work with TypeScript every day?',
    ])
      expect(check(item({ question })).rejected).toEqual(['HR']);
  });
  test('rejects duplicates, near-duplicates and curated catalog questions', () => {
    const { valid, rejected } = check(
      item(),
      item({ question: 'How does PostgreSQL MVCC handle concurrent updates?' }),
      item({
        question: 'How does PostgreSQL MVCC handle the concurrent updates?',
      }),
      item({ question: 'Why is MVCC used by PostgreSQL?' }),
    );
    expect(valid.map((q) => q.question)).toEqual([
      'How does PostgreSQL MVCC handle concurrent updates?',
      'Why is MVCC used by PostgreSQL?',
    ]);
    expect(rejected).toEqual(['DUPLICATE', 'DUPLICATE']);
    // Pooling: items already accepted by an earlier attempt count as seen.
    expect(
      validateQuestions({ questions: [item()] }, snap.source, valid).rejected,
    ).toEqual(['DUPLICATE']);
  });
  test('rejects bad shapes, enums, lengths and control characters', () => {
    for (const bad of [
      { category: 'hr' },
      { kind: 'behavioural' },
      { question: 'Why?' },
      { question: `${'x'.repeat(200)}?` },
      { why: '' },
      { why: 'y'.repeat(201) },
      { evidence: 'x'.repeat(301) },
      { question: 'How does PostgreSQL\u0007 MVCC work?' },
      { question: 42 },
    ])
      expect(check(item(bad)).rejected).toEqual(['SHAPE']);
    expect(validateQuestions(null, snap.source).valid).toEqual([]);
    expect(validateQuestions({ questions: 'no' }, snap.source).valid).toEqual(
      [],
    );
  });
});

describe('evidence relevance', () => {
  test('the prompt asks for the most specific JD line', () => {
    expect(jobQuestionsPrompt(snap.text)).toMatch(
      /MOST SPECIFIC JD line[^\n]*names a technology[^\n]*copy the line that names it/u,
    );
  });
  test('a personal question about a named technology must cite a line naming it', () => {
    const personal = (evidence: string) =>
      check(
        item({
          question: 'Have you used TypeScript for backend services?',
          kind: 'personal',
          category: 'experience',
          evidence,
        }),
      ).rejected;
    expect(personal('3+ years building backend services')).toEqual([
      'UNSUPPORTED_EVIDENCE',
    ]);
    expect(personal('Node.js, TypeScript, PostgreSQL')).toEqual([]);
    // One of several named technologies is enough.
    expect(
      check(
        item({
          question:
            'Have you run Node.js services on Kubernetes? If so, what was hard?',
          kind: 'personal',
          category: 'experience',
          evidence: 'Kubernetes is a plus',
        }),
      ).rejected,
    ).toEqual([]);
  });
  test('concept, design and troubleshooting questions may cite indirect evidence', () => {
    for (const [question, kind, category] of [
      [
        'How would you debug slow Node.js services in production?',
        'hypothetical',
        'troubleshooting',
      ],
      [
        'How would you design PostgreSQL tables for high traffic?',
        'hypothetical',
        'architecture',
      ],
      [
        'What does TypeScript strict mode catch at compile time?',
        'general',
        'skill',
      ],
    ] as const)
      expect(
        check(
          item({
            question,
            kind,
            category,
            evidence: 'Design REST APIs for high traffic',
          }),
        ).rejected,
      ).toEqual([]);
    // A personal question that names no technology is unaffected.
    expect(
      check(
        item({
          question:
            'Have you designed REST APIs for high traffic? If so, what mattered?',
          kind: 'personal',
          category: 'experience',
          evidence: '3+ years building backend services',
        }),
      ).rejected,
    ).toEqual([]);
  });
});

describe('regeneration duplicate checks', () => {
  const active = check(item()).valid;
  test('exact and near-duplicates of the active set are rejected; new grounded questions pass', () => {
    const { valid, rejected } = validateQuestions(
      {
        questions: [
          item(),
          item({
            question: 'How does PostgreSQL MVCC handle the concurrent updates?',
          }),
          item({
            question:
              'How would you design REST APIs for high traffic with Node.js?',
            kind: 'hypothetical',
            category: 'architecture',
            evidence: 'Design REST APIs for high traffic',
          }),
        ],
      },
      snap.source,
      [],
      active,
    );
    expect(rejected).toEqual(['DUPLICATE', 'DUPLICATE']);
    expect(valid.map((q) => q.question)).toEqual([
      'How would you design REST APIs for high traffic with Node.js?',
    ]);
  });
  test('active-set questions do not relax grounding for new ones', () => {
    expect(
      validateQuestions(
        {
          questions: [
            item({ question: 'How would you tune MongoDB for writes?' }),
          ],
        },
        snap.source,
        [],
        active,
      ).rejected,
    ).toEqual(['TECHNOLOGY']);
  });
});

describe('active-set overlap threshold', () => {
  const kafka = (question: string, kind = 'hypothetical') =>
    item({
      question,
      kind,
      category: 'architecture',
      evidence: 'Strong experience with PostgreSQL and Kafka is required',
    });
  // Real-model pair from the PR15 regeneration run (~0.61 word overlap).
  const activeQ = kafka(
    'How would you design a Kafka consumer group to handle 100k events per second without lag?',
  );
  const paraphrase = kafka(
    'How would you design a Kafka consumer group to handle high event volumes without lag?',
  );
  const active = check(activeQ).valid;
  test('thresholds are explicit: active set is stricter than everything else', () => {
    expect(ACTIVE_SET_OVERLAP).toBe(0.6);
    expect(DUPLICATE_OVERLAP).toBe(0.75);
  });
  test('a close paraphrase of an active-set question is rejected', () => {
    expect(
      validateQuestions({ questions: [paraphrase] }, snap.source, [], active)
        .rejected,
    ).toEqual(['DUPLICATE']);
  });
  test('the same pair within one generation still uses the 0.75 threshold', () => {
    expect(
      validateQuestions({ questions: [activeQ, paraphrase] }, snap.source)
        .valid,
    ).toHaveLength(2);
    // ...and as a previously accepted (same-generation) question.
    expect(
      validateQuestions({ questions: [paraphrase] }, snap.source, active).valid,
    ).toHaveLength(1);
  });
  test('same technology, genuinely different concept passes against the active set', () => {
    const { valid, rejected } = validateQuestions(
      {
        questions: [
          kafka(
            'Why do Kafka partitions matter for message ordering guarantees?',
            'general',
          ),
          kafka(
            'How would you handle a poison message that keeps failing in Kafka?',
          ),
        ],
      },
      snap.source,
      [],
      active,
    );
    expect(rejected).toEqual([]);
    expect(valid).toHaveLength(2);
  });
});

describe('job family (multi-industry)', () => {
  // Synthetic JDs; no real postings.
  const marketing = jdSnapshot({
    title: 'Synthetic Performance Marketing Specialist',
    description:
      'Plan and run paid social campaigns on Facebook Ads and TikTok Ads.\nOwn the monthly budget and optimise cost per lead.\nReport campaign results to stakeholders every week.',
    skills: 'Facebook Ads, Google Analytics, A/B testing',
    preferredSkills: '',
    experience: '2+ years in digital marketing',
    domain: '',
    seniority: '',
  });
  const sales = jdSnapshot({
    title: 'Synthetic B2B Account Executive',
    description:
      'Prospect and close new mid-market accounts.\nManage a pipeline in the CRM and forecast monthly revenue.\nHandle pricing objections and negotiate contracts.',
    skills: 'B2B sales, negotiation, CRM pipeline management',
    preferredSkills: '',
    experience: '3+ years in B2B sales',
    domain: '',
    seniority: '',
  });
  const item = (
    question: string,
    category: string,
    kind: string,
    evidence: string,
  ) => ({
    question,
    category,
    kind,
    why: 'Checks a JD requirement.',
    evidence,
  });

  test('valid families pass; missing, invalid or differently cased values become "other", never "it"', () => {
    for (const f of ['it', 'marketing', 'sales', 'other'])
      expect(parseFamily({ family: f, questions: [] })).toBe(f);
    for (const output of [
      { questions: [] },
      { family: 'IT', questions: [] },
      { family: 'engineering', questions: [] },
      { family: null },
      { family: ['it'] },
      null,
      'it',
      ['it'],
    ])
      expect(parseFamily(output)).toBe('other');
  });

  test('the schema requires a family string without an enum, so an odd value never discards questions', () => {
    expect(JOB_QUESTIONS_SCHEMA.required).toEqual(['family', 'questions']);
    const family = (JOB_QUESTIONS_SCHEMA.properties as Record<string, object>)
      .family;
    expect(family).toEqual({ type: 'string', maxLength: 20 });
  });

  test('the prompt is role-aware: it asks for a family and defines each slot per family', () => {
    const prompt = jobQuestionsPrompt(marketing.text);
    expect(prompt).not.toMatch(/software job|Technical questions only/u);
    expect(prompt).toMatch(/never software-engineering assumptions/u);
    expect(prompt).toMatch(
      /family: [^\n]*"it"[^\n]*"marketing"[^\n]*"sales"[^\n]*"other"[^\n]*if you are unsure/u,
    );
    expect(prompt).toMatch(
      /"architecture": it = system or software design; marketing = strategy and planning[^\n]*sales = sales strategy and planning[^\n]*other = approach and planning/u,
    );
    expect(prompt).toMatch(
      /"troubleshooting": [^\n]*marketing = diagnosing and fixing an underperforming campaign[^\n]*sales = handling objections/u,
    );
    // HR exclusion and grounding rules are kept for every family.
    expect(prompt).toMatch(/No HR or behavioural questions/u);
    expect(prompt).toMatch(
      /Mention only technologies, tools, platforms and channels that appear in the JD/u,
    );
    expect(prompt).toMatch(/EXACT phrase copied character for character/u);
  });

  test('Marketing and Sales prompts fence their own JD', () => {
    expect(jobQuestionsPrompt(marketing.text)).toContain(
      `"""\n${marketing.text}\n"""`,
    );
    expect(jobQuestionsPrompt(sales.text)).toContain(`"""\n${sales.text}\n"""`);
  });

  test('grounded Marketing and Sales questions pass the unchanged validation; ungrounded ones do not', () => {
    const m = validateQuestions(
      {
        family: 'marketing',
        questions: [
          item(
            'How would you reallocate a monthly paid social budget when cost per lead rises?',
            'architecture',
            'hypothetical',
            'Own the monthly budget and optimise cost per lead',
          ),
          item(
            'How would you find why a TikTok Ads campaign suddenly stopped converting?',
            'troubleshooting',
            'hypothetical',
            'Plan and run paid social campaigns on Facebook Ads and TikTok Ads',
          ),
          item(
            'What makes an A/B test result trustworthy enough to act on?',
            'skill',
            'general',
            'Facebook Ads, Google Analytics, A/B testing',
          ),
          // Evidence that is not in the JD.
          item(
            'How would you plan an influencer campaign for a product launch?',
            'architecture',
            'hypothetical',
            'Run influencer partnerships across Instagram',
          ),
        ],
      },
      marketing.source,
    );
    expect(m.valid.map((q) => q.category)).toEqual([
      'architecture',
      'troubleshooting',
      'skill',
    ]);
    expect(m.rejected).toEqual(['EVIDENCE']);

    const s = validateQuestions(
      {
        family: 'sales',
        questions: [
          item(
            'How would you respond when a mid-market prospect says your price is too high?',
            'troubleshooting',
            'hypothetical',
            'Handle pricing objections and negotiate contracts',
          ),
          item(
            'Have you managed a pipeline in a CRM? If so, how did you keep the forecast accurate?',
            'experience',
            'personal',
            'Manage a pipeline in the CRM and forecast monthly revenue',
          ),
          // Behavioural question: still rejected for every family.
          item(
            'What motivates you to hit your sales targets every month?',
            'experience',
            'general',
            'Prospect and close new mid-market accounts',
          ),
        ],
      },
      sales.source,
    );
    expect(s.valid.map((q) => q.category)).toEqual([
      'troubleshooting',
      'experience',
    ]);
    expect(s.rejected).toEqual(['HR']);
  });
});
