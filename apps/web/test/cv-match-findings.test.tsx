import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { compareRequirements } from '../src/features/inbox/requirement-comparison';
import { FindingsOverview } from '../src/features/inbox/CvMatchSection';
import type {
  MatchCondition,
  MatchResult,
  SkillMatch,
} from '../src/features/inbox/cv-match.types';

const frontend = 'VueJS/NuxtJS and JavaScript or comparable HTML/CSS tools';
const source = [
  'Java',
  'Spring Boot or a comparable framework',
  frontend,
  'Write SQL queries for reporting',
].join('\n');
type Finding = NonNullable<SkillMatch['findings']>[number];
function finding(kind: Finding['kind'], label: string, jd = label): Finding {
  const start = Math.max(0, source.indexOf(jd));
  return {
    kind,
    label,
    sources: [{ field: 'jdText', quote: jd, start, end: start + jd.length }],
    evidence:
      kind === 'skill'
        ? {
            quote: 'Confirmed project using ' + label,
            origin: 'user_entered',
            sectionKind: 'projects',
          }
        : null,
  };
}
const skills = ['Java', 'Spring Boot', 'VueJS', 'NuxtJS', 'JavaScript'].map(
  (s) => finding('skill', s),
);
const condition: MatchCondition = {
  kind: 'EXPERIENCE',
  mode: 'SINGLE',
  status: 'UNKNOWN',
  jdQuote: 'Two years in Java delivery',
  parentId: 'scoped',
  evidence: [],
};
function requirement(
  jdQuote: string,
  status: MatchResult['requirements'][number]['status'],
) {
  return {
    requirement: jdQuote,
    priority: 'required',
    category: 'skill',
    jdQuote,
    cvQuote: '',
    status,
  };
}

test('Job C regression fixture uses requirement counts and opens the right evidence and condition cards', async () => {
  const user = userEvent.setup();
  const { container } = render(
    <FindingsOverview
      findings={[
        ...skills,
        finding('clause', frontend),
        finding('clause', 'Spring Boot or a comparable framework'),
        finding('requirement', 'SQL', 'Write SQL queries for reporting'),
      ]}
      requirements={[
        requirement('Java', 'EVIDENCED'),
        requirement('Spring Boot or a comparable framework', 'EVIDENCED'),
        requirement(frontend, 'PARTIAL'),
        requirement('Write SQL queries for reporting', 'NOT_EVIDENCED'),
        requirement('Two years overall', 'UNDECOMPOSED'),
        requirement('Two years in Java delivery', 'PARTIAL'),
        requirement('IT qualification', 'CONFLICT'),
        {
          ...requirement('Required skills', 'UNDECOMPOSED'),
          notAssessed: 'HEADING',
        },
      ]}
      conditions={[
        { ...condition, parentId: 'general', jdQuote: 'Two years overall' },
        condition,
        condition,
      ]}
    />,
  );
  expect(
    [...container.querySelectorAll('dd')].map((el) => el.textContent),
  ).toEqual(['2', '2', '1', '1', '1']);
  expect(screen.getByText('7 JD requirements')).toBeVisible();
  expect(container.textContent).not.toContain('%');
  const left = screen.getByRole('heading', {
    name: 'JD requirements with evidence',
  }).parentElement!;
  expect(within(left).getAllByRole('button')).toHaveLength(2);
  const front = within(left).getByRole('button', { name: /VueJS\/NuxtJS/ });
  expect(front).toHaveTextContent('View details');
  front.focus();
  await user.keyboard('{Enter}');
  await waitFor(() =>
    expect(document.activeElement).toHaveAttribute('aria-expanded', 'true'),
  );
  expect(
    [...container.querySelectorAll('mark')].map((e) => e.textContent),
  ).toEqual(['VueJS', 'NuxtJS', 'JavaScript']);
  expect(container.querySelector('blockquote')).toHaveTextContent(frontend);
  const right = screen.getByRole('heading', {
    name: 'Points to review',
  }).parentElement!;
  await user.click(within(right).getByRole('button', { name: /Write SQL/ }));
  await waitFor(() =>
    expect(document.activeElement).toHaveTextContent(
      'Write SQL queries for reporting',
    ),
  );
  await user.click(
    within(right).getByRole('button', { name: /Two years in Java delivery/ }),
  );
  expect(
    screen.getByRole('region', { name: /Two years in Java delivery/ }),
  ).toHaveTextContent('Two years overall');
});
test('marketing requirements follow source spans and refreshed findings close the comparison', async () => {
  const user = userEvent.setup();
  const clause = 'Google Ads or equivalent channels';
  const data = [finding('skill', 'Google Ads'), finding('clause', clause)];
  const requirements = [
    requirement(clause, 'EVIDENCED'),
    requirement('Lead generation', 'NOT_EVIDENCED'),
    {
      ...requirement('Forecasting', 'NOT_EVIDENCED'),
      evidence: { modelQuote: 'REJECTED', review: false },
    },
    {
      ...requirement('Campaign strategy', 'PARTIAL'),
      evidence: { modelQuote: 'UNSUPPORTING', review: true },
    },
    {
      ...requirement('Enthusiasm', 'UNDECOMPOSED'),
      notAssessed: 'SUBJECTIVE' as const,
    },
  ];
  const { rerender, container } = render(
    <FindingsOverview findings={data} requirements={requirements} />,
  );
  expect(
    [...container.querySelectorAll('dd')].map((el) => el.textContent),
  ).toEqual(['1', '0', '1', '1', '2']);
  expect(screen.getByText('5 JD requirements')).toBeVisible();
  const left = screen.getByRole('heading', {
    name: 'JD requirements with evidence',
  }).parentElement!;
  await user.click(
    within(left).getByRole('button', { name: /Google Ads or equivalent/ }),
  );
  await waitFor(() =>
    expect(document.activeElement).toHaveAttribute('aria-expanded', 'true'),
  );
  rerender(<FindingsOverview key="new-review" findings={[...data]} />);
  expect(document.querySelector('[aria-expanded="true"]')).toBeNull();
  rerender(<FindingsOverview findings={[]} />);
  expect(
    screen.getByText('No findings available for this review.'),
  ).toBeVisible();
  expect(
    screen.queryByRole('region', { name: 'Requirement evidence coverage' }),
  ).toBeNull();
});

test('reports unavailable coverage when the requirement data cannot be trusted', () => {
  const data = [finding('skill', 'CRM')];
  const { rerender } = render(<FindingsOverview findings={data} />);
  expect(screen.getByText(/Requirement coverage is unavailable/)).toBeVisible();
  rerender(
    <FindingsOverview
      findings={data}
      requirements={[requirement('CRM', 'EVIDENCED')]}
      coverageLimited
    />,
  );
  expect(screen.getByText(/Requirement coverage is unavailable/)).toBeVisible();
  rerender(
    <FindingsOverview
      findings={data}
      requirements={[
        {
          ...requirement('CRM', 'EVIDENCED'),
          coverage: {
            status: 'NOT_EVIDENCED',
            mode: 'SINGLE',
            reason: '',
            credit: 0,
            components: [],
          },
        },
      ]}
    />,
  );
  expect(screen.getByText(/Requirement coverage is unavailable/)).toBeVisible();
  expect(
    screen.queryByRole('region', { name: 'Requirement evidence coverage' }),
  ).toBeNull();
});

test('shows an all-unassessed inventory with four zero-count categories', () => {
  render(
    <FindingsOverview
      findings={[]}
      requirements={[
        requirement('Uninterpretable wording', 'UNDECOMPOSED'),
        {
          ...requirement('Enthusiasm', 'UNDECOMPOSED'),
          notAssessed: 'SUBJECTIVE',
        },
      ]}
    />,
  );
  const coverage = screen.getByRole('region', {
    name: 'Requirement evidence coverage',
  });
  expect(within(coverage).getByText('2 JD requirements')).toBeVisible();
  expect(
    [...coverage.querySelectorAll('dd')].map((el) => el.textContent),
  ).toEqual(['0', '0', '0', '0', '2']);
  expect(
    coverage.querySelector('div[aria-hidden="true"]')?.children,
  ).toHaveLength(1);
});

test('one supported name keeps both distinct clause anchors; a mismatched span stays separate', () => {
  const first = finding('clause', 'CRM and lead generation');
  const second = finding('clause', 'CRM and forecasting');
  second.sources[0]!.start = 40;
  second.sources[0]!.end = 40 + second.label.length;
  const crm = finding('skill', 'CRM');
  crm.sources.push({ ...crm.sources[0]!, start: 40, end: 43 });
  const misleading = finding('skill', 'SEO');
  const rows = compareRequirements([crm, first, second, misleading], [], []);
  expect(
    rows.filter((r) => r.findings.includes(crm)).map((r) => r.title),
  ).toEqual([first.label, second.label]);
  expect(
    rows.filter((r) => r.findings.includes(misleading)).map((r) => r.title),
  ).toEqual(['SEO']);
});

test('scored tokens stay inside the clause and matching duration conditions stay with their JD source', () => {
  const clause = 'Two years in Java delivery';
  const anchored = finding('clause', clause);
  const java = finding('skill', 'Java');
  java.sources = [{ field: 'jdText', quote: 'Java', start: 13, end: 17 }];
  const tokens = skills.slice(2).map((f) => ({
    priority: 'required' as const,
    source: f.sources[0]!,
    skills: [],
  }));
  const rows = compareRequirements(
    [finding('clause', frontend), ...skills.slice(2), java, anchored],
    [condition, { ...condition, componentId: 'second' }],
    tokens,
  );
  expect(rows).toHaveLength(2);
  const duration = rows.find((r) => r.title === clause)!;
  expect(duration.findings).toContain(java);
  expect(duration.supported).toBe(false);
  expect(duration.conditions).toHaveLength(2);
  expect(duration.status).toBe('More CV evidence is needed');
});

test('links scoped duration text through its saved parent and keeps unrelated conditions separate', () => {
  const full = 'Two years in Java delivery';
  const f = finding('clause', full);
  const requirements = [
    {
      parentId: 'jd-a',
      requirement: full,
      jdQuote: full,
      priority: 'required',
      category: 'experience',
      cvQuote: '',
      status: 'PARTIAL' as const,
    },
  ];
  const scoped = { ...condition, parentId: 'jd-a', jdQuote: 'Two years' };
  const other = { ...scoped, parentId: 'jd-b' };
  const rows = compareRequirements(
    [f],
    [scoped, other],
    [],
    undefined,
    requirements,
  );
  expect(rows).toHaveLength(2);
  expect(rows[0]!.conditions).toEqual([scoped]);
  expect(rows[1]!.conditions).toEqual([other]);
  expect(rows[0]!.supported).toBe(false);
});

test('ignores a saved skill mirror while keeping independent source occurrences', () => {
  const clause = finding('clause', frontend);
  const skill = finding('skill', 'VueJS');
  skill.sources.push({ field: 'skills', quote: 'VueJS', start: 0, end: 5 });
  expect(compareRequirements([clause, skill], [], [])).toHaveLength(1);
  skill.sources.push({
    field: 'postText',
    quote: 'VueJS',
    start: 100,
    end: 105,
  });
  const rows = compareRequirements([clause, skill], [], []);
  expect(rows.filter((row) => row.unmapped)).toHaveLength(1);
  const { rerender } = render(<FindingsOverview findings={[clause, skill]} />);
  expect(screen.queryByText('Other relevant CV experience')).toBeNull();

  const additional = finding('skill', 'VueJS');
  additional.sources = [skill.sources.at(-1)!];
  additional.evidence = {
    quote: 'Built a separate VueJS dashboard.',
    origin: 'source',
    sectionKind: 'experience',
  };
  rerender(<FindingsOverview findings={[clause, skill, additional]} />);
  const fallback = screen.getByText(
    'Other relevant CV experience',
  ).parentElement!;
  expect(fallback).toHaveTextContent('Built a separate VueJS dashboard.');
  expect(fallback).toHaveTextContent('From reviewed source');
  expect(fallback).not.toHaveTextContent('Confirmed project using VueJS');
  expect(screen.queryByText(/characters|postText/)).toBeNull();
});
