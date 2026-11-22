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

test('CV headings stay in the document language when the UI is Vietnamese', async () => {
  const { setLocale } = await import('../src/app/i18n');
  setLocale('vi-VN');
  try {
    render(<TailoredCvPreview document={tailoredDraftFixture().document} />);
    expect(screen.getByRole('heading', { name: 'Experience' })).toHaveAttribute(
      'lang',
      'en',
    );
    expect(
      screen.queryByRole('heading', { name: 'Kinh nghiệm' }),
    ).not.toBeInTheDocument();
  } finally {
    setLocale('en-US');
  }
});

// jsdom cannot evaluate container queries, so this checks the generated CSS:
// Modern's side columns must follow the preview's width, never the viewport.
test('Modern preview: side columns depend on the preview width, so a narrow preview on a wide screen never squeezes titles', () => {
  const draft = tailoredDraftFixture();
  render(<TailoredCvPreview document={draft.document} template="modern" />);
  const paper = document.querySelector('[data-template="modern"]')!;
  const css = [...document.querySelectorAll('style')]
    .map((s) => s.textContent)
    .join('\n');
  const rulesFor = (el: Element) =>
    [...el.classList]
      .filter((c) => c.startsWith('css-'))
      .flatMap((c) => css.split('}').filter((r) => r.includes(`.${c}`)));
  // The paper is the measuring container.
  expect(rulesFor(paper).join('}')).toMatch(
    /container-type:inline-size;container-name:cv-modern/,
  );
  const section = paper.querySelector('h3')!.parentElement!;
  expect(getComputedStyle(section).gridTemplateColumns).toBe('1fr');
  const sideColumn = css
    .split(/(?=@)/)
    .filter((block) => block.includes('150px minmax(0, 1fr)'));
  expect(sideColumn.length).toBeGreaterThan(0);
  for (const block of sideColumn)
    expect(block).toMatch(/^@container cv-modern \(min-width: ?640px\)/);
  // Title and dates wrap onto two lines instead of squeezing the title.
  expect(css).toMatch(/\[data-cv-anchor\]\{[^}]*flex-wrap:wrap/);
  expect(css).toMatch(
    /@media \(min-width: ?600px\)\{[^{]*\[data-cv-anchor\]>:first-of-type\{[^}]*;flex:1 1 12rem/,
  );
  // Skills keep one column until the preview is wide enough.
  expect(css).toMatch(
    /@container cv-modern \(min-width: ?760px\)\{[^{]*\[data-cv-skills\]\{grid-template-columns:180px minmax\(0, 1fr\)/,
  );
});

test.each(['classic', 'compact'] as const)(
  '%s preview is unaffected by the Modern container rules',
  (template) => {
    render(
      <TailoredCvPreview
        document={tailoredDraftFixture().document}
        template={template}
      />,
    );
    const paper = document.querySelector(`[data-template="${template}"]`)!;
    expect(getComputedStyle(paper).getPropertyValue('container-type')).not.toBe(
      'inline-size',
    );
    expect(paper.closest('[data-template]')).toBe(paper);
  },
);
