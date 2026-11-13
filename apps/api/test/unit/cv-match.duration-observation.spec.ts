import { expect, test } from '@jest/globals';
import {
  evaluateCoverage,
  requirementGroup,
} from '../../src/matching/cv-match.coverage.js';

// Synthetic CV mirroring docs/beta-samples/synthetic-cv.docx.
const used = '- Built REST APIs with Node.js, TypeScript and NestJS.';
const skills = 'Backend: Node.js, TypeScript, NestJS, PostgreSQL';
const cv = [
  'SUMMARY',
  'Backend developer with 4 years of experience building REST APIs.',
  'EXPERIENCE',
  'Software Engineer, Example Tech Ltd — Jan 2022 to Present',
  used,
  'SKILLS',
  skills,
].join('\n');
const evaluate = (requirement: string, source = cv, selected = [used]) =>
  evaluateCoverage(
    requirementGroup(requirement, 'skill'),
    selected,
    source,
    true,
  );
const requirement = '3+ years of experience with Node.js and TypeScript';

test('use without a stated duration is observed but not credited', () => {
  const result = evaluate(requirement);
  expect(result).toMatchObject({
    mode: 'AND',
    status: 'NOT_EVIDENCED',
    credit: 0,
  });
  for (const component of result.components) {
    expect(component).toMatchObject({ status: 'NOT_EVIDENCED', cvQuote: '' });
    expect(component.observations).toEqual([
      { kind: 'experience', cvQuote: used },
    ]);
    expect(component.qualificationReason).toBe(
      'Use is evidenced in the CV; the required 3+ years is not established.',
    );
  }
});

test('job tenure and a general summary never establish the duration', () => {
  const result = evaluate(requirement, cv, []);
  expect(result.credit).toBe(0);
  for (const component of result.components)
    expect(component.observations?.map((o) => o.cvQuote)).toEqual([used]);
});

test('a skills-list mention is observed as a mention', () => {
  const result = evaluate(requirement, `SKILLS\n${skills}`, [skills]);
  expect(result.credit).toBe(0);
  expect(result.components[0]!.observations).toEqual([
    { kind: 'mention', cvQuote: skills },
  ]);
});

test('explicit sufficient duration is still credited without observations', () => {
  const line = '4 years of experience with Node.js and TypeScript.';
  const result = evaluate(requirement, line, [line]);
  expect(result).toMatchObject({ status: 'EVIDENCED', credit: 1 });
  for (const component of result.components) {
    expect(component).toMatchObject({ status: 'EVIDENCED', cvQuote: line });
    expect(component.observations).toBeUndefined();
  }
});

test('insufficient stated duration earns no credit', () => {
  const line = '2 years of experience with Node.js and TypeScript.';
  expect(evaluate(requirement, line, [line])).toMatchObject({
    status: 'NOT_EVIDENCED',
    credit: 0,
  });
});

// Existing semantics: a denial without duration-qualified support is not a
// CONFLICT; it must still never gain an observation or credit.
test('a denied technology gets no observation', () => {
  const result = evaluate(requirement, `${cv}\nI have never used TypeScript.`);
  expect(result.credit).toBe(0);
  const typescript = result.components.find((c) => c.label === 'TypeScript')!;
  expect(typescript).toMatchObject({ status: 'NOT_EVIDENCED', cvQuote: '' });
  expect(typescript.observations).toBeUndefined();
  expect(
    result.components.find((c) => c.label === 'Node.js')!.observations,
  ).toEqual([{ kind: 'experience', cvQuote: used }]);
});

test('an absent technology gets no observation', () => {
  const result = evaluate('3+ years of experience with Node.js and Kubernetes');
  expect(result.credit).toBe(0);
  const kubernetes = result.components.find((c) => c.label === 'Kubernetes')!;
  expect(kubernetes).toMatchObject({ status: 'NOT_EVIDENCED', cvQuote: '' });
  expect(kubernetes.observations).toBeUndefined();
});
