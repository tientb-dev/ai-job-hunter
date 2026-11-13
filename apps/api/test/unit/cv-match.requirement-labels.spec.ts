import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from '@jest/globals';
import { parsePdf } from '../../src/extraction/pdf.parser.js';
import { createExtractionSource } from '../../src/extraction/extraction.validation.js';
import {
  canonicalRequirements,
  matchJobText,
  scoreCvMatch,
  validateMatchAssessment,
} from '../../src/matching/cv-match.js';
import type { Opportunity } from '../../src/opportunities/opportunity.entity.js';

// Exact saved wording from the Windows beta job (Backend Engineer — Fictional Corp).
const nodeTs =
  '- 3+ years of experience with Node.js and TypeScript (required)';
const job = {
  title: 'Backend Engineer',
  skills: `${nodeTs}\n- Experience with PostgreSQL (required)`,
  preferredSkills:
    '- Familiarity with Docker (nice to have)\n* Experience with Kubernetes (preferred)',
  experience: '',
  domain: '',
  seniority: '',
  description: '',
  postText: '',
  jdText: '',
} as unknown as Opportunity;
const fixture = async (name: string) =>
  createExtractionSource(
    (
      await parsePdf(
        new Uint8Array(
          readFileSync(
            new URL(
              `../../../../../docs/beta-samples/${name}`,
              import.meta.url,
            ),
          ),
        ),
      )
    ).source,
  ).text;
const assess = (cv: string) => {
  const canonical = canonicalRequirements(job);
  const jd = matchJobText(job);
  // Empty model quotes: the result must not depend on Gemini's selection.
  const proposals = canonical.map((item) => ({ ...item }));
  return scoreCvMatch(
    validateMatchAssessment(proposals, cv, jd, canonical),
    cv,
    jd,
    canonical,
  ).requirements;
};

let scenarioA = '';
let scenarioB = '';
beforeAll(async () => {
  [scenarioA, scenarioB] = await Promise.all([
    fixture('synthetic-cv.pdf'),
    fixture('synthetic-cv-4-years.pdf'),
  ]);
});

test('labels drop bullets and priority annotations; JD quotes stay original', () => {
  expect(
    canonicalRequirements(job).map(({ requirement, jdQuote, priority }) => ({
      requirement,
      jdQuote,
      priority,
    })),
  ).toEqual([
    {
      requirement: '3+ years of experience with Node.js and TypeScript',
      jdQuote: nodeTs,
      priority: 'required',
    },
    {
      requirement: 'Experience with PostgreSQL',
      jdQuote: '- Experience with PostgreSQL (required)',
      priority: 'required',
    },
    {
      requirement: 'Familiarity with Docker',
      jdQuote: '- Familiarity with Docker (nice to have)',
      priority: 'preferred',
    },
    {
      requirement: 'Experience with Kubernetes',
      jdQuote: '* Experience with Kubernetes (preferred)',
      priority: 'preferred',
    },
  ]);
  for (const item of canonicalRequirements(job))
    expect(matchJobText(job)).toContain(item.jdQuote);
});

test('Scenario A: bulleted duration requirement is Unknown with observations for both technologies', () => {
  const row = assess(scenarioA)[0]!;
  expect(row).toMatchObject({
    requirement: '3+ years of experience with Node.js and TypeScript',
    jdQuote: nodeTs,
    status: 'NOT_EVIDENCED',
    credit: 0,
  });
  expect(row.coverage.components.map((c) => c.label)).toEqual([
    'Node.js',
    'TypeScript',
  ]);
  for (const component of row.coverage.components)
    expect(component.observations).toEqual([
      {
        kind: 'experience',
        cvQuote: '- Built REST APIs with Node.js, TypeScript and NestJS.',
      },
    ]);
});

test('Scenario B: bulleted duration requirement is Matched from explicit 4-year evidence', () => {
  const line =
    'Backend developer with 4 years of professional experience with Node.js and TypeScript.';
  const row = assess(scenarioB)[0]!;
  expect(row).toMatchObject({
    status: 'EVIDENCED',
    credit: 1,
    jdQuote: nodeTs,
  });
  for (const component of row.coverage.components)
    expect(component).toMatchObject({ status: 'EVIDENCED', cvQuote: line });
});

test('bulleted single skills use their named-skill rules', () => {
  const rows = Object.fromEntries(
    assess(scenarioA).map((row) => [row.requirement, row]),
  );
  expect(rows['Experience with PostgreSQL']).toMatchObject({
    status: 'EVIDENCED',
    cvQuote: '- Designed PostgreSQL schemas and wrote migrations.',
  });
  // A tools-list mention is not recovered; Kubernetes is absent from the CV.
  expect(rows['Familiarity with Docker']!.status).toBe('NOT_EVIDENCED');
  expect(rows['Experience with Kubernetes']!.status).toBe('NOT_EVIDENCED');
});
