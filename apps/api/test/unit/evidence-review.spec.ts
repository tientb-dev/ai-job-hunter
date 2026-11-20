import { expect, test } from '@jest/globals';
import { buildEvidenceReview } from '../../src/matching/evidence-review.js';
import { reviewedCvText } from '../../src/reviewed-cv/reviewed-cv.text.js';

const assemble = (
  jd: string,
  passages: string[],
  saved = '',
  proposal = '',
  skills = false,
  standalone = false,
) => {
  const job = {
    updatedAt: new Date('2026-01-01'),
    jdText: standalone ? jd : `Requirements\n${jd}`,
    skills: saved,
    description: '',
    postText: '',
    preferredSkills: '',
    experience: '',
    domain: '',
  };
  const cv = reviewedCvText(
    passages.map((value, index) => ({
      id: String(index),
      field: skills ? 'skill' : 'bullet',
      value,
      sectionId: 'synthetic',
      sectionKind: skills ? 'skills' : 'experience',
      entryId: `entry-${index}`,
      confirmation: 'field',
      origin: 'user_entered',
      evidence: [],
    })),
  );
  return buildEvidenceReview(
    job,
    cv,
    'review-1',
    proposal ? [{ jdQuote: jd, cvQuote: proposal }] : [],
  );
};

test('original technology AND survives saved-field differences and uses exact reviewed declarations', () => {
  const review = assemble(
    'Java and Spring Boot\nReact',
    ['Java, Spring Boot'],
    'Java',
    '',
    true,
  );
  expect(review.profileRevisionId).toBe('review-1');
  expect(review.rows.map(({ quote, status }) => [quote, status])).toEqual([
    ['Java and Spring Boot', 'VERIFIED_EVIDENCE'],
    ['React', 'NO_DOCUMENTED_EVIDENCE'],
    ['Java', 'NEEDS_REVIEW'],
  ]);
  expect(review.rows[0]?.evidence[0]).toMatchObject({
    quote: 'Skills: Java, Spring Boot',
    entryId: 'entry-0',
    origin: 'user_entered',
  });
  for (const row of review.rows.filter(({ field }) => field === 'jdText')) {
    expect(review.sources[0]?.text.slice(row.start, row.end)).toBe(row.quote);
  }
});

test('keeps a verified declaration when another AND term is missing', () => {
  expect(
    assemble('Java and Spring Boot', ['Java'], '', '', true).rows[0],
  ).toMatchObject({
    status: 'PARTIAL_EVIDENCE',
    missing: ['Spring Boot'],
    evidence: [{ quote: 'Skills: Java', kind: 'declaration' }],
  });
});

test('fresh review shows source-bound work context under a standalone original requirement', () => {
  const jd = 'Experience building REST APIs with Java and Spring Boot.';
  const quote =
    'Built REST APIs using Java and Spring Boot for an order management system.';
  const review = assemble(jd, [quote], '', '', false, true);
  expect(review.rows[0]).toMatchObject({
    quote: jd,
    status: 'NEEDS_REVIEW',
    reason: 'WORK_CONTEXT',
    evidence: [
      { quote, kind: 'context', entryId: 'entry-0', origin: 'user_entered' },
    ],
  });
  expect(
    assemble(jd, ['Built REST APIs. Used Java and Spring Boot on billing.'])
      .rows[0]?.evidence,
  ).toEqual([]);
});

test('team deployment remains visible as context without personal ownership credit', () => {
  const jd = 'Personally deploy ML models to production';
  const quote =
    'Our team deployed a forecasting model to production. I wrote evaluation reports.';
  expect(assemble(jd, [quote]).rows[0]).toMatchObject({
    status: 'NEEDS_REVIEW',
    reason: 'TEAM_DEPLOYMENT',
    evidence: [{ quote, kind: 'context' }],
  });
  const tooling = 'I used Copilot to draft tests.';
  expect(assemble(jd, [tooling], '', tooling).rows[0]).toMatchObject({
    status: 'NEEDS_REVIEW',
    evidence: [],
  });
});

test('shows the requested deployment context and excludes an unrelated production quote', () => {
  const jd = 'Deploy a ranking model to production';
  const sandbox = 'I deployed a ranking model to a sandbox.';
  const billing = 'I deployed a billing API to production.';
  expect(assemble(jd, [sandbox, billing], '', billing).rows[0]).toMatchObject({
    status: 'NEEDS_REVIEW',
    reason: 'PRODUCTION_SCOPE',
    evidence: [{ quote: sandbox, kind: 'context' }],
  });
  expect(assemble(jd, [billing], '', billing).rows[0]?.evidence).toEqual([]);
});

test('professional PostgreSQL use remains partial for proficiency', () => {
  expect(
    assemble('Proficiency in PostgreSQL', [
      'Implemented database queries using PostgreSQL.',
    ]).rows[0],
  ).toMatchObject({ status: 'PARTIAL_EVIDENCE', reason: 'PROFICIENCY' });
});

test('cross-project and invented CV quotes cannot become evidence', () => {
  const passages = [
    'I deployed a forecasting model to staging.',
    'I deployed a billing service to production.',
  ];
  for (const proposal of [
    passages.join('\n\n\n'),
    'I deployed a forecasting model to production.',
  ]) {
    expect(
      assemble('Deploy ML models to production', passages, '', proposal)
        .rows[0],
    ).toMatchObject({ status: 'NEEDS_REVIEW', reason: 'VERIFY', evidence: [] });
  }
});

test('mixed subjective technical content and conflicts cannot become fully supported', () => {
  expect(
    assemble('Java and exceptional judgment', ['Java'], '', '', true).rows[0],
  ).toMatchObject({
    status: 'NEEDS_REVIEW',
    evidence: [{ quote: 'Skills: Java', kind: 'declaration' }],
  });
  expect(
    assemble('Java', ['Java', 'No experience with Java'], '', '', true).rows[0]
      ?.status,
  ).toBe('NEEDS_REVIEW');
});
