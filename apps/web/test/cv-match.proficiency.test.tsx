import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { CvMatchPanel } from '../src/features/inbox/CvMatchPanel';
const requirement =
  'Thành thạo ít nhất một hệ quản trị cơ sở dữ liệu: MySQL, Oracle OR SQL Server';
const quote =
  'Project: Synthetic billing\nDeveloped enterprise features using SQL Server.';
const mention = 'Databases: MySQL, Oracle, SQL Server';
function fixture(partial: boolean) {
  const status = partial ? 'PARTIAL' : 'NOT_EVIDENCED';
  return {
    score: partial ? 50 : 0,
    recommendation: 'Consider',
    explanation: 'Synthetic coverage',
    advice: 'Review evidence.',
    requirements: [
      {
        requirement,
        priority: 'required',
        category: 'skill',
        jdQuote: requirement,
        cvQuote: partial ? quote : '',
        status,
        credit: partial ? 0.5 : 0,
        coverage: {
          mode: 'OR',
          status,
          credit: partial ? 0.5 : 0,
          reason:
            'SQL Server project experience is evidenced; proficiency at the requested level remains unverified.',
          components: ['MySQL', 'Oracle', 'SQL Server'].map((label, i) => ({
            id: `c${i + 1}`,
            label,
            jdQuote: label,
            cvQuote: partial && i === 2 ? quote : '',
            status: partial && i === 2 ? 'PARTIAL' : 'NOT_EVIDENCED',
            conflictingQuotes: [],
            observations: [
              {
                kind: partial && i === 2 ? 'experience' : 'mention',
                cvQuote: partial && i === 2 ? quote : mention,
              },
            ],
            qualificationReason: 'Proficiency is not fully verified.',
          })),
        },
      },
    ],
  };
}
async function mount(result: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(
        url.endsWith('/cv/current')
          ? { id: 'synthetic-cv', fileName: 'synthetic.pdf' }
          : result,
      ),
    ),
  );
  render(<CvMatchPanel jobId="synthetic-job" revision="1" />);
  expect(
    await screen.findByRole('combobox', { name: 'CV for this job' }),
  ).toHaveTextContent('synthetic.pdf');
  fireEvent.click(screen.getByRole('button', { name: 'Analyze CV Match' }));
}
test('Partial database evidence displays exact attributed work, mentions and unverified proficiency without claiming absence', async () => {
  await mount(fixture(true));
  const region = await screen.findByRole('region', { name: 'Requirements' });
  const button = within(region).getByRole('button', {
    name: `Partial: ${requirement}`,
  });
  button.focus();
  expect(button).toHaveFocus();
  fireEvent.click(button);
  expect(button).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('SQL Server · Partial')).toBeVisible();
  expect(screen.getByText('Verified professional experience')).toBeVisible();
  expect(
    screen.getByLabelText('Professional experience: SQL Server').textContent,
  ).toBe(quote);
  expect(screen.getAllByText('Verified technology mention')).toHaveLength(2);
  expect(
    screen.getAllByText('Proficiency is not fully verified.'),
  ).toHaveLength(3);
  expect(screen.queryByText('Not evidenced in CV')).toBeNull();
  expect(
    screen.getByText(/proficiency at the requested level remains unverified/),
  ).toBeVisible();
});
test('bare database mentions remain Unknown with exact original mention quotes', async () => {
  await mount(fixture(false));
  const region = await screen.findByRole('region', { name: 'Requirements' });
  fireEvent.click(
    within(region).getByRole('button', {
      name: `Not clearly shown in CV: ${requirement}`,
    }),
  );
  expect(
    screen.getByLabelText('Technology mention: SQL Server').textContent,
  ).toBe(mention);
  expect(screen.queryByText('Verified professional experience')).toBeNull();
  expect(screen.queryByText('Not evidenced in CV')).toBeNull();
});
test('malformed observation references are rejected at the UI boundary', async () => {
  const result = fixture(true);
  result.requirements[0]!.coverage.components[2]!.observations[0]!.kind =
    'fabricated';
  await mount(result);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    /could not|invalid|try again/i,
  );
  expect(
    screen.queryByLabelText('Professional experience: SQL Server'),
  ).toBeNull();
});
