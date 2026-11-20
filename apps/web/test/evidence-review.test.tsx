import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { CvMatchPanel } from '../src/features/inbox/CvMatchPanel';
import type { MatchResult } from '../src/features/inbox/cv-match.types';

const quote = 'Proficiency in PostgreSQL';
const reviewed = 'Wrote queries using PostgreSQL.';
const base: MatchResult = {
  matchId: 'synthetic',
  analyzedAt: '2026-01-01T00:00:00.000Z',
  score: 78,
  recommendation: 'Apply',
  explanation: 'Legacy explanation',
  advice: 'Add three years of Terraform experience.',
  requirements: [
    {
      requirement: quote,
      jdQuote: quote,
      priority: 'required',
      category: 'skill',
      cvQuote: reviewed,
      status: 'EVIDENCED',
    },
  ],
};

async function show(result: MatchResult) {
  const fetch = vi.fn(async (url: string) =>
    Response.json(
      url.endsWith('/cv/current')
        ? { id: 'cv', fileName: 'synthetic.pdf' }
        : result,
    ),
  );
  vi.stubGlobal('fetch', fetch);
  render(<CvMatchPanel jobId="job" revision="1" />);
  await screen.findByText('synthetic.pdf');
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
  return fetch;
}

test('Skill Match shows a weighted score, matched skills, missing skills and separate conditions', async () => {
  await show({
    ...base,
    skillMatch: {
      version: 1,
      score: 75,
      limitation: null,
      matchedCount: 1,
      totalCount: 2,
      rows: [
        {
          priority: 'required',
          source: { quote: 'PostgreSQL or MySQL' },
          skills: [
            {
              name: 'PostgreSQL',
              evidence: { quote: reviewed, origin: 'user_entered' },
            },
            { name: 'MySQL', evidence: null },
          ],
        },
        {
          priority: 'preferred',
          source: { quote: 'Terraform' },
          skills: [{ name: 'Terraform', evidence: null }],
        },
      ],
    },
    conditions: [
      {
        mode: 'SINGLE',
        kind: 'EXPERIENCE',
        jdQuote: '3 years of work experience',
        status: 'UNKNOWN',
        evidence: [],
      },
    ],
  });
  expect(
    await screen.findByText('75% weighted match across assessed requirements'),
  ).toBeVisible();
  expect(screen.getByText('1/2 assessed skill groups matched')).toBeVisible();
  expect(screen.getByText('PostgreSQL · Required')).toBeVisible();
  expect(screen.getByText('Terraform · Preferred')).toBeVisible();
  expect(
    screen.queryByText('MySQL · Required · Another alternative matched'),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Conditions' })).toHaveTextContent(
    'Evidence not established',
  );
  expect(
    screen.queryByText(/50%|Add three years of Terraform|Legacy explanation/),
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: /Conflict \/ Needs review \(/ }),
  ).toBeNull();
  const disclosure = screen.getByRole('button', { name: 'View skill sources' });
  disclosure.focus();
  await userEvent.keyboard('{Enter}');
  expect(disclosure).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText(reviewed)).toBeVisible();
  expect(screen.getByText(/Added by you in CV review/)).toBeVisible();
});

test('keeps a legacy assessment usable without exposing its old score', async () => {
  await show(base);
  expect(
    await screen.findByText(/JD–CV Skill Match is unavailable/),
  ).toBeVisible();
  expect(screen.queryByText(reviewed)).toBeNull();
  expect(screen.queryByText(/78%|Add three years/)).toBeNull();
});

test('shows the inventory limitation before analysis, without requesting inference', async () => {
  const revision = base.analyzedAt;
  const fetch = vi.fn(async (url: string) =>
    Response.json(
      url.endsWith('/cv/current')
        ? { id: 'cv', fileName: 'synthetic.pdf', updatedAt: revision }
        : url.endsWith('/match')
          ? {
              status: 'MISSING',
              cvUpdatedAt: revision,
              skillMatch: {
                version: 1,
                score: null,
                partialScore: 0,
                limitation: 'INCOMPLETE_INVENTORY',
                matchedCount: 0,
                totalCount: 1,
                unresolved: ['SyntheticTool'],
                rows: [
                  {
                    priority: 'required',
                    source: { quote: 'Java' },
                    skills: [{ name: 'Java', evidence: null }],
                  },
                ],
              },
            }
          : [],
    ),
  );
  vi.stubGlobal('fetch', fetch);
  render(<CvMatchPanel jobId="job" revision="1" jobUpdatedAt={revision} />);
  expect(await screen.findByText('JD–CV Skill Match')).toBeVisible();
  expect(screen.getByText('Java · Required')).toBeVisible();
  expect(screen.getByText('Unresolved JD requirements')).toBeVisible();
  expect(
    screen.getByText(/The score covers only the requirements assessed here/),
  ).toBeVisible();
  expect(
    screen.getByText('0% weighted match across assessed requirements'),
  ).toBeVisible();
  expect(
    fetch.mock.calls.filter(([url]) => url.endsWith('/match')),
  ).toHaveLength(1);
});

test.each([
  ['Spring', 'Spring Boot', 'experience', 'Work Experience'],
  ['Salesforce', undefined, 'skills', 'Skills'],
  ['GA4', undefined, 'projects', 'Projects'],
] as const)(
  'scopes a 100%% partial %s result and discloses provenance',
  async (name, from, sectionKind, sectionLabel) => {
    const long = 'Synthetic qualification ' + 'X'.repeat(150);
    await show({
      ...base,
      skillMatch: {
        version: 1,
        score: null,
        partialScore: 100,
        limitation: 'INCOMPLETE_INVENTORY',
        matchedCount: 1,
        totalCount: 1,
        unresolved: [long],
        unresolvedTechnicalGroupCount: 1,
        unclassifiedRequirementCount: 3,
        rows: [
          {
            priority: 'required',
            source: { quote: name },
            skills: [
              {
                name,
                evidence: {
                  quote: 'Synthetic reviewed evidence',
                  origin: 'source',
                  sectionKind,
                  ...(from && {
                    relationship: {
                      from,
                      reason: 'DIRECTIONAL_SKILL' as const,
                    },
                  }),
                },
              },
            ],
          },
        ],
      },
    });
    expect(
      await screen.findByText('1/1 assessed skill groups matched'),
    ).toBeVisible();
    expect(
      screen.getByText('100% weighted match across assessed requirements'),
    ).toBeVisible();
    expect(
      screen.getByText(/The score covers only the requirements assessed here/),
    ).toBeVisible();
    expect(screen.queryByText(/Unclassified JD items/)).toBeNull();
    await userEvent.click(
      screen.getByRole('button', { name: 'View unassessed requirements' }),
    );
    expect(screen.getByText(long)).toBeVisible();
    await userEvent.click(
      screen.getByRole('button', { name: 'View skill sources' }),
    );
    expect(
      screen.getByText(
        from
          ? `${sectionLabel} · From reviewed source · Directional evidence from ${from}`
          : `${sectionLabel} · From reviewed source · Direct or alias evidence`,
      ),
    ).toBeVisible();
  },
);
