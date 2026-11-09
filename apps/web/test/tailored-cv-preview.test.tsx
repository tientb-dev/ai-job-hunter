import { expect, test } from 'vitest';
import { render, screen, within } from './render';
import { TailoredCvPreview } from '../src/features/inbox/TailoredCvPreview';
import { tailoredDraftFixture } from './fixtures/tailored-cv';

function withLinks(...urls: string[]) {
  const draft = tailoredDraftFixture();
  const doc = draft.document;
  const links = doc.sections.find((s) => s.kind === 'links')!;
  const base = doc.sections.flatMap((s) =>
    s.entries.flatMap((e) => e.facts),
  )[0]!;
  links.entries = [
    {
      ...structuredClone(
        doc.sections.find((s) => s.entries.length)!.entries[0]!,
      ),
      id: 'links-entry',
      facts: urls.map((url, i) => {
        const fact = {
          ...structuredClone(base),
          id: `link-${i}`,
          field: 'link',
          acceptedText: url,
          proposedWording: null,
          verification: null,
        };
        doc.review.factReviews[fact.id] = structuredClone(
          doc.review.factReviews[base.id]!,
        );
        return fact;
      }),
    },
  ];
  return doc;
}

test('a verified LinkedIn URL renders once, as a link in the header; other links stay in Links', () => {
  const linkedin = 'https://www.linkedin.com/in/synthetic-person';
  const other = 'https://synthetic.example/portfolio';
  const doc = withLinks(linkedin, other);
  const before = JSON.stringify(doc);
  const { container } = render(<TailoredCvPreview document={doc} />);
  expect(JSON.stringify(doc)).toBe(before);
  expect(screen.getAllByText(linkedin)).toHaveLength(1);
  expect(screen.getByRole('link', { name: linkedin })).toHaveAttribute(
    'href',
    linkedin,
  );
  const linksHeading = screen.getByRole('heading', { name: 'Links' });
  const linksBlock = linksHeading.parentElement!;
  expect(within(linksBlock).getByText(other)).toBeInTheDocument();
  expect(within(linksBlock).queryByText(linkedin)).toBeNull();
  const order = [...container.querySelectorAll('h3, p')].map(
    (el) => el.textContent,
  );
  expect(order.indexOf(linkedin)).toBeLessThan(order.indexOf('Links'));
});

test('when every link is a verified profile, no empty Links section is shown', () => {
  render(
    <TailoredCvPreview document={withLinks('github.com/synthetic-person')} />,
  );
  expect(
    screen.getByRole('link', { name: 'github.com/synthetic-person' }),
  ).toHaveAttribute('href', 'https://github.com/synthetic-person');
  expect(screen.queryByRole('heading', { name: 'Links' })).toBeNull();
});
