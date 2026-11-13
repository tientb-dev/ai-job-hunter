import { describe, expect, test } from '@jest/globals';
import {
  canonicalRequirements,
  matchJobText,
  matchQuoteChoices,
  scoreCvMatch,
  validateMatchAssessment,
  type MatchRequirement,
} from '../../src/matching/cv-match.js';
import { requirementGroup } from '../../src/matching/cv-match.coverage.js';
import { alignToPassage } from '../../src/matching/cv-match.evidence.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';

// Synthetic fixtures only. Gemini path: no schema enums, allowed passages enforced here.
const pairs = 'Experience with Docker and Kubernetes';
const job = {
  title: 'Backend Engineer',
  skills: `Kafka\n${pairs}`,
  preferredSkills: '',
  experience: '',
  domain: '',
  seniority: '',
  description: `Requirements: Kafka. ${pairs}.`,
  postText: '',
  jdText: '',
} as unknown as Opportunity;
const canonical = canonicalRequirements(job);
const jd = matchJobText(job);

function assess(cv: string, componentQuote: string, kafkaQuote = '') {
  const allowed = new Set(matchQuoteChoices(cv, canonical));
  const proposals: MatchRequirement[] = canonical.map((row) => ({
    ...row,
    cvQuote: row.requirement === 'Kafka' ? kafkaQuote : '',
    ...(row.requirement === pairs
      ? {
          components: requirementGroup(pairs, 'skill').components.map((c) => ({
            componentId: c.id,
            jdQuote: c.jdQuote,
            cvQuote: c.label === 'Docker' ? componentQuote : '',
          })),
        }
      : {}),
  }));
  const result = scoreCvMatch(
    validateMatchAssessment(proposals, cv, jd, canonical, allowed),
    cv,
    jd,
    canonical,
  );
  const row = result.requirements.find((r) => r.requirement === pairs)!;
  return {
    docker: row.coverage.components.find((c) => c.label === 'Docker')!,
    kafka: result.requirements.find((r) => r.requirement === 'Kafka')!,
  };
}
const verifiedDocker = (cv: string, quote: string) => {
  const proposals: MatchRequirement[] = canonical.map((row) => ({
    ...row,
    cvQuote: '',
    ...(row.requirement === pairs
      ? {
          components: requirementGroup(pairs, 'skill').components.map((c) => ({
            componentId: c.id,
            jdQuote: c.jdQuote,
            cvQuote: c.label === 'Docker' ? quote : '',
          })),
        }
      : {}),
  }));
  return validateMatchAssessment(
    proposals,
    cv,
    jd,
    canonical,
    new Set(matchQuoteChoices(cv, canonical)),
  )
    .find((row) => row.requirement === pairs)!
    .components!.find((c) => c.cvQuote)?.cvQuote;
};
const rejection = (cv: string, quote: string) => {
  try {
    assess(cv, quote);
  } catch (error) {
    return (error as { reasonCode?: string }).reasonCode;
  }
  return 'ACCEPTED';
};

describe('fragments are widened to their full allowed passage', () => {
  test('exact subspan of one line', () => {
    const line = '- Deployed services with Docker in AWS.';
    const { docker } = assess(`EXPERIENCE\n${line}`, 'services with Docker');
    expect(docker).toMatchObject({ status: 'EVIDENCED', cvQuote: line });
  });

  // Validation accepts the widened multi-line passage. Coverage scoring of a
  // multi-line component passage is existing policy, the same as when Gemini
  // selected that passage from the former enum, so only alignment is asserted.
  test.each([
    [
      'quote crossing a line boundary, joined by a space',
      'EXPERIENCE\n- Deployed services\nwith Docker in AWS.',
      'services with Docker',
      '- Deployed services\nwith Docker in AWS.',
    ],
    [
      'PDF-style wrapped line and extra spaces',
      'EXPERIENCE\n- Deployed   services with\r\nDocker for an example team.',
      'Deployed services with Docker',
      '- Deployed   services with\r\nDocker for an example team.',
    ],
  ])('%s', (_, cv, quote, passage) => {
    expect(verifiedDocker(cv, quote)).toBe(passage);
  });

  test('a top-level fragment is widened the same way', () => {
    const line = '- Built services consuming Kafka topics.';
    const { kafka } = assess(
      `EXPERIENCE\n${line}`,
      '',
      'consuming Kafka topics',
    );
    expect(kafka).toMatchObject({ status: 'EVIDENCED', cvQuote: line });
  });
});

describe('integrity: widening never drops negation or invents evidence', () => {
  test('a fragment that omits a negation is judged on the negated line', () => {
    const line = 'Never deployed services with Docker.';
    const { docker } = assess(
      `EXPERIENCE\n${line}`,
      'deployed services with Docker',
    );
    expect(docker.status).not.toBe('EVIDENCED');
  });

  test('a top-level fragment that omits a negation is not Matched', () => {
    const { kafka } = assess(
      'EXPERIENCE\nNever used Kafka in production.',
      '',
      'used Kafka in production',
    );
    expect(kafka.status).not.toBe('EVIDENCED');
  });

  test.each([
    [
      'fabricated quote',
      'EXPERIENCE\n- Deployed services with Docker.',
      'Ran Docker clusters at scale',
      'COMPONENT_CV_QUOTE_NOT_IN_CV',
    ],
    [
      'quote spanning more lines than any allowed passage',
      'A\n- Deployed\nservices\nwith Docker',
      'A - Deployed services with Docker',
      'COMPONENT_CV_QUOTE_NOT_ALLOWED_PASSAGE',
    ],
  ])('%s stays rejected', (_, cv, quote, reason) => {
    expect(rejection(cv, quote)).toBe(reason);
  });

  test('a fragment occurring twice is dropped, never credited (Gemini path)', () => {
    const cv = 'EXPERIENCE\n- Used Docker.\n- Used Docker.';
    expect(rejection(cv, 'Used Docker')).toBe('ACCEPTED');
    expect(assess(cv, 'Used Docker').docker.status).not.toBe('EVIDENCED');
  });

  test('alignToPassage returns only an allowed passage, never the fragment', () => {
    const cv = 'EXPERIENCE\n- Deployed services with Docker.';
    const allowed = new Set(matchQuoteChoices(cv, canonical));
    expect(alignToPassage(cv, 'with Docker', allowed)).toBe(
      '- Deployed services with Docker.',
    );
    expect(alignToPassage(cv, 'with Docker', new Set<string>())).toBeNull();
  });
});

test('without an allowed set (Ollama), resolution is unchanged', () => {
  const cv = 'EXPERIENCE\n- Deployed services with Docker.';
  const proposals = canonical.map((row) => ({
    ...row,
    cvQuote: row.requirement === 'Kafka' ? 'services with Docker' : '',
  }));
  const verified = validateMatchAssessment(proposals, cv, jd, canonical);
  expect(verified.find((r) => r.requirement === 'Kafka')!.cvQuote).toBe(
    'services with Docker',
  );
});
