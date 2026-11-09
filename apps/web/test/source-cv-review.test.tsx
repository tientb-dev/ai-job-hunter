import {
  contactSkillsProfile,
  profileReferenceFixture,
  contactSkillsCvSource,
  contactSkillGroups,
} from './fixtures/contact-skills-review';
import { richSource, richProfile } from './fixtures/structured-source-review';
import { useRef, useState } from 'react';
import { ThemeProvider } from '@mui/material';
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from './render';
import { theme } from '../src/app/theme';
import { SourceCvReview } from '../src/features/inbox/SourceCvReview';
import { UnsavedJobGuard } from '../src/features/inbox/UnsavedJobGuard';
import { decodeCvProfile } from '../src/features/inbox/source-cv-review.contract';
import {
  cvProfileFixture,
  sourceCvFixture,
  structuredCvFixture,
} from './fixtures/source-cv-review';
const noop = () => {};
function setup(
  empty = false,
  previouslySavedNavigation = false,
  legacy = false,
  rich = false,
  contact: boolean | 'reference' = false,
) {
  const reference = contact === 'reference' ? profileReferenceFixture() : null;
  let profile = reference
    ? reference.profile
    : contact
      ? contactSkillsProfile()
      : rich
        ? richProfile()
        : cvProfileFixture(empty);
  const currentSource = reference
    ? reference.source
    : contact
      ? contactSkillsCvSource
      : rich
        ? richSource
        : sourceCvFixture;
  if (legacy) delete profile.document.reconstruction;
  const history = new Map<string, typeof profile>();
  let conflict = false;
  let aiFailed = false;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/sources') || url.endsWith('/content'))
      return Response.json(currentSource);
    if (url.endsWith('/profile')) return Response.json(profile);
    if (url.includes('/profile-revisions/'))
      return Response.json(history.get(url.split('/').at(-1)!));
    if (url.endsWith('/proposal') || url.endsWith('/rebuild')) {
      if (aiFailed)
        return Response.json(
          { errorCode: 'CV_PROFILE_INVALID_OUTPUT' },
          { status: 502 },
        );
      const old = structuredClone(profile);
      const document = structuredCvFixture();
      if (url.endsWith('/rebuild')) {
        history.set(old.id, old);
        document.reconstruction!.previousRevisionId = old.id;
      }
      profile = {
        ...profile,
        id: crypto.randomUUID(),
        revision: profile.revision + 1,
        document,
      };
      return Response.json(profile);
    }
    if (url.endsWith('/revisions')) {
      if (conflict)
        return Response.json(
          { errorCode: 'CV_FOUNDATION_409' },
          { status: 409 },
        );
      profile = {
        ...profile,
        revision: profile.revision + 1,
        document: JSON.parse(init!.body as string).document,
      };
      return Response.json(profile);
    }
    throw new Error(`Unexpected test request: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  function Harness() {
    const [dirty, setDirty] = useState(false);
    const saved = useRef(previouslySavedNavigation);
    return (
      <ThemeProvider theme={theme}>
        <UnsavedJobGuard
          dirty={dirty}
          sourceCvDirty={dirty}
          savedNavigation={saved}
        />
        <SourceCvReview
          cv={{
            fileName: sourceCvFixture.fileName,
            updatedAt: sourceCvFixture.savedCvUpdatedAt,
          }}
          disabled={false}
          onDirtyChange={setDirty}
          onBusyChange={noop}
        />
        <Link to="/away">Leave review</Link>
      </ThemeProvider>
    );
  }
  const router = createMemoryRouter([
    { path: '/', element: <Harness /> },
    { path: '/away', element: <p>Away from review</p> },
  ]);
  render(<RouterProvider router={router} />);
  return {
    fetch,
    profile: () => profile,
    history,
    conflict: () => {
      conflict = true;
    },
    failAi: (value: boolean) => {
      aiFailed = value;
    },
  };
}
async function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Review source CV' }));
  await screen.findByText(/Source: synthetic-source-cv.pdf/);
}
test('section review is lightweight, ambiguous fields require individual confirmation and revisions save explicitly', async () => {
  const state = setup();
  await open();
  expect(
    screen.getByRole('button', { name: 'Mark Experience section as checked' }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Mark Personal details section as checked',
    }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Review issues in Experience' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Role' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Mark Experience section as checked' }),
  );
  expect(screen.getByText(/2 of 2 sections reviewed/)).toBeVisible();
  expect(
    state.fetch.mock.calls.filter(([url]) => url.endsWith('/revisions')),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Draft saved. You can finish the review later.');
  expect(state.profile().revision).toBe(2);
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
});
test('editing keeps exact source evidence and stores a distinct user-entered replacement', async () => {
  const state = setup();
  await open();
  fireEvent.click(
    screen.getByRole('button', { name: 'Edit Personal details' }),
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Full name' }), {
    target: { value: 'User supplied name' },
  });
  expect(
    screen.getByText(
      /Your correction; it does not become original-source evidence/,
    ),
  ).toBeVisible();
  const summary = screen.getByText('View source evidence');
  fireEvent.click(summary);
  expect(screen.getByText('Name: Synthetic Person')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Draft saved. You can finish the review later.');
  const facts = state.profile().document.sections[0]!.entries[0]!.facts;
  expect(facts[0]!.value).toBe('Name: Synthetic Person\n');
  expect(facts[1]).toMatchObject({
    origin: 'user_entered',
    evidence: [],
    replacesFactId: 'name',
    value: 'User supplied name',
  });
});
test('unresolved passages require explicit mapping or exclusion with a reason', async () => {
  const state = setup();
  await open();
  fireEvent.click(
    screen.getByRole('button', { name: 'Review unassigned content' }),
  );
  const exclude = screen.getByRole('button', {
    name: 'Exclude with reason',
  });
  expect(exclude).toBeDisabled();
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Reason for excluding this content' }),
    { target: { value: 'User chose to exclude this award' } },
  );
  fireEvent.click(exclude);
  expect(
    screen.getByText('All source content is accounted for.'),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Draft saved. You can finish the review later.');
  expect(state.profile().document.coverage.at(-1)).toMatchObject({
    disposition: 'excluded',
    reason: 'User chose to exclude this award',
  });
});
test('manual mapping retains exact offsets and requires focused clarification', async () => {
  const state = setup();
  await open();
  fireEvent.click(
    screen.getByRole('button', { name: 'Review unassigned content' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Keep in Other information' }),
  );
  expect(
    screen.getByRole('button', {
      name: 'Mark Other information section as checked',
    }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Review issues in Other information' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Content' }));
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Mark Other information section as checked',
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Draft saved. You can finish the review later.');
  const fact = state
    .profile()
    .document.sections.find((s) => s.kind === 'additional')!.entries[0]!
    .facts[0]!;
  expect(fact.evidence[0]!.quote).toBe(
    sourceCvFixture.text.slice(fact.evidence[0]!.start, fact.evidence[0]!.end),
  );
});
test('invalid AI output retains the unresolved profile and permits an explicit retry', async () => {
  const state = setup(true);
  state.failAi(true);
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Organize my CV' }));
  await screen.findByText(/model could not organize this CV safely/);
  expect(state.profile().revision).toBe(1);
  fireEvent.click(
    screen.getByRole('button', { name: 'Review unassigned content' }),
  );
  expect(
    screen.getByText(/Name: Synthetic Person/, { selector: 'blockquote' }),
  ).toBeVisible();
  state.failAi(false);
  fireEvent.click(screen.getByRole('button', { name: 'Organize my CV' }));
  await screen.findByText('Synthetic Person', { selector: 'p' });
  expect(state.profile().revision).toBe(2);
});
test('conflicting save preserves edits and navigation guard supports keyboard Stay and discard', async () => {
  const state = setup();
  const user = userEvent.setup();
  await open();
  fireEvent.click(
    screen.getByRole('button', { name: 'Edit Personal details' }),
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Full name' }), {
    target: { value: 'Retained edit' },
  });
  state.conflict();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText(/CV or profile changed/);
  expect(screen.getByRole('textbox', { name: 'Full name' })).toHaveValue(
    'Retained edit',
  );
  fireEvent.click(screen.getByRole('link', { name: 'Leave review' }));
  const stay = await screen.findByRole('button', { name: 'Stay and edit' });
  await waitFor(() => expect(stay).toHaveFocus());
  await user.keyboard('{Enter}');
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(screen.getByRole('textbox', { name: 'Full name' })).toHaveValue(
    'Retained edit',
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Discard unsaved changes' }),
  );
  fireEvent.click(screen.getByRole('link', { name: 'Leave review' }));
  await screen.findByText('Away from review');
});
test('pending user input is guarded and no private CV is written to browser storage', async () => {
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  setup();
  await open();
  fireEvent.click(screen.getByText('Add missing details'));
  fireEvent.change(screen.getByRole('textbox', { name: 'New detail' }), {
    target: { value: 'Private synthetic draft input' },
  });
  fireEvent.click(screen.getByRole('link', { name: 'Leave review' }));
  await screen.findByRole('dialog');
  expect(storage).not.toHaveBeenCalled();
  storage.mockRestore();
});
test('source evidence disclosures and controls are keyboard accessible', async () => {
  setup();
  await open();
  const user = userEvent.setup();
  fireEvent.click(
    screen.getByRole('button', { name: 'Review issues in Experience' }),
  );
  const summary = screen.getByText(
    'View source evidence for Check employer attribution',
  );
  summary.focus();
  // jsdom does not implement native summary keyboard activation; Chromium smoke
  // checks the actual Enter toggle. Here verify native semantics and focus order.
  expect(summary.tagName).toBe('SUMMARY');
  expect(summary).toHaveFocus();
  await user.tab();
  expect(
    screen.getByText('Adjust field type or record grouping'),
  ).toHaveFocus();
  const confirm = screen.getByRole('button', { name: 'Confirm Role' });
  confirm.focus();
  expect(confirm).toHaveFocus();
  await user.keyboard(' ');
  expect(
    screen.getByRole('button', { name: 'Mark Experience section as checked' }),
  ).toBeEnabled();
});
test('response validation rejects evidence from a different offset or source revision', () => {
  const profile = cvProfileFixture();
  profile.document.sections[0]!.entries[0]!.facts[0]!.evidence[0]!.start = 1;
  expect(() => decodeCvProfile(profile, sourceCvFixture)).toThrow();
});

test('field type corrections require focused confirmation without changing original words', async () => {
  const state = setup();
  await open();
  fireEvent.click(
    screen.getByRole('button', { name: 'Review issues in Experience' }),
  );
  fireEvent.click(screen.getByText('Adjust field type or record grouping'));
  fireEvent.mouseDown(
    screen.getByRole('combobox', { name: 'Detail to adjust' }),
  );
  fireEvent.click(
    await screen.findByRole('option', {
      name: /Role: Role: Developer at Example/,
    }),
  );
  fireEvent.mouseDown(
    screen.getByRole('combobox', { name: 'Correct detail type' }),
  );
  fireEvent.click(
    await screen.findByRole('option', { name: 'Contribution or description' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Apply detail type' }));
  expect(
    screen.getByRole('button', { name: 'Mark Experience section as checked' }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Confirm Contribution or description' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Draft saved. You can finish the review later.');
  const fact = state.profile().document.sections[1]!.entries[0]!.facts[0]!;
  expect(fact.field).toBe('description');
  expect(fact.value).toBe('Role: Developer at Example\n');
  expect(fact.evidence[0]!.quote).toBe(fact.value);
});

test('source edits remain guarded after an earlier successful job navigation', async () => {
  setup(false, true);
  await open();
  fireEvent.click(
    screen.getByRole('button', { name: 'Edit Personal details' }),
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Full name' }), {
    target: { value: 'Guarded source edit' },
  });
  fireEvent.click(screen.getByRole('link', { name: 'Leave review' }));
  await screen.findByRole('dialog');
});

test('legacy review rebuild is explicit, creates a pending revision and keeps earlier corrections accessible', async () => {
  const state = setup(false, false, true);
  await open();
  const old = structuredClone(state.profile());
  expect(screen.getByText(/Choose Organize my CV/)).toBeVisible();
  expect(screen.queryByRole('textbox', { name: 'Full name' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'New detail' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Organize my CV' }));
  await screen.findByRole('dialog', { name: 'Organize your CV?' });
  expect(state.history.size).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(state.profile().revision).toBe(1);
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Organize my CV' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Organize as new review' }),
  );
  await screen.findByText(/Your CV is organized/);
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(state.profile().revision).toBe(2);
  expect(state.history.get(old.id)).toEqual(old);
  expect(state.profile().document.reconstruction!.previousRevisionId).toBe(
    old.id,
  );
  fireEvent.click(screen.getByText('Earlier review and corrections'));
  fireEvent.click(screen.getByRole('button', { name: 'Load earlier review' }));
  await screen.findByText('Earlier revision 1; preserved without changes.');
});

test('default review is readable cards; corrections require explicit confirmation and Continue waits for saved review', async () => {
  const state = setup();
  await open();
  expect(screen.queryByRole('textbox', { name: 'Full name' })).toBeNull();
  expect(screen.getByRole('textbox', { name: 'New detail' })).not.toBeVisible();
  expect(screen.queryByText(/description \(additional, entry/)).toBeNull();
  expect(
    screen.getByRole('progressbar', { name: 'Source review progress' }),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole('button', { name: 'Edit Personal details' }),
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Full name' }), {
    target: { value: 'A corrected synthetic name' },
  });
  expect(
    screen.getByRole('button', {
      name: 'Mark Personal details section as checked',
    }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Full name' }));
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Mark Personal details section as checked',
    }),
  );
  expect(
    screen.getByRole('region', { name: 'Before you can complete the review' }),
  ).toBeInTheDocument();
  expect(state.profile().revision).toBe(1);
});

test('logical sections show identity, one summary editor, employer cards and skill categories without passage forms', async () => {
  setup(false, false, false, true);
  await open();
  expect(
    screen.getByText('Synthetic Avery Chen', { selector: 'p' }),
  ).toBeVisible();
  expect(
    screen.getByText('Senior Software Engineer', { selector: 'p' }),
  ).toBeVisible();
  expect(screen.getByRole('article', { name: 'Example Alpha' })).toBeVisible();
  expect(screen.getByRole('article', { name: 'Example Beta' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Backend' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Tools' })).toBeVisible();
  expect(
    screen.getByText('Java, SQL Server (academic only)', { selector: 'p' }),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole('button', { name: 'Edit Professional summary' }),
  );
  expect(
    screen.getAllByRole('textbox', { name: 'Professional summary' }),
  ).toHaveLength(1);
  expect(
    screen.getByRole('textbox', { name: 'Professional summary' }),
  ).toHaveValue(
    'Builds Java APIs and supports\nteam testing. SQL Server is academic coursework only.\n',
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Mark Experience section as checked' }),
  );
  expect(
    screen.queryByRole('button', {
      name: 'Confirm Contribution or description',
    }),
  ).toBeNull();
});

test('previous reconstruction offers one primary organize action, safely retries failure and unlocks review after success', async () => {
  const state = setup();
  state.profile().document.reconstruction = {
    version: '2',
    previousRevisionId: null,
  };
  state.failAi(true);
  await open();
  const old = structuredClone(state.profile());
  expect(
    screen.queryByRole('button', { name: 'Edit Personal details' }),
  ).toBeNull();
  expect(
    screen.queryByRole('button', {
      name: 'Mark Personal details section as checked',
    }),
  ).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Organize my CV' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Organize as new review' }),
  );
  await screen.findByText(/model could not organize this CV safely/);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(state.profile()).toEqual(old);
  expect(state.history.size).toBe(0);
  expect(screen.getByRole('button', { name: 'Organize my CV' })).toBeEnabled();
  expect(screen.queryByText(/review manually/)).toBeNull();
  state.failAi(false);
  fireEvent.click(screen.getByRole('button', { name: 'Organize my CV' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Organize as new review' }),
  );
  await screen.findByText(/Your CV is organized/);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(
    screen.getByRole('button', { name: 'Edit Personal details' }),
  ).toBeEnabled();
  expect(state.history.get(old.id)).toEqual(old);
});

test('experience renders nested project names alongside employer, role and contributions', async () => {
  const state = setup(false, false, false, true);
  state
    .profile()
    .document.sections.find((s) => s.kind === 'experience')!
    .entries[0]!.facts.push({
      id: 'nested-project',
      field: 'project',
      value: 'Synthetic nested project',
      origin: 'user_entered',
      review: 'confirmed',
      evidence: [],
    });
  await open();
  expect(screen.getByText('Synthetic nested project')).toBeVisible();
  expect(
    screen.getByRole('article', { name: 'Example Alpha' }),
  ).toHaveTextContent('Synthetic nested project');
});

test('all skill groups render in order with their lists; glyph fragments remain explicit and exclusions require user action and save', async () => {
  const state = setup(false, false, false, false, true);
  await open();
  for (const [category, list] of contactSkillGroups) {
    const card = screen.getByRole('article', { name: category });
    expect(card).toBeVisible();
    expect(card).toHaveTextContent(list);
  }
  const names = screen
    .getAllByRole('heading', { level: 4 })
    .map((e) => e.textContent);
  expect(
    names.filter((name) => contactSkillGroups.some((g) => g[0] === name)),
  ).toEqual(contactSkillGroups.map((g) => g[0]));
  expect(
    screen.getAllByText('Example City').find((e) => e.tagName === 'P')!,
  ).toBeVisible();
  expect(
    screen.getAllByText('(+84) 900 000 123').find((e) => e.tagName === 'P')!,
  ).toBeVisible();
  expect(screen.getByText(/Some contact text needs review/)).toBeVisible();
  expect(screen.getByText(/Unclear contact fragment/)).toBeVisible();
  expect(
    state
      .profile()
      .document.coverage.filter((c) => c.disposition === 'excluded'),
  ).toHaveLength(0);
  fireEvent.click(
    screen.getByRole('button', { name: 'Exclude reviewed separator symbols' }),
  );
  expect(
    state
      .profile()
      .document.coverage.filter((c) => c.disposition === 'excluded'),
  ).toHaveLength(0);
  fireEvent.click(
    screen.getByRole('button', { name: 'Review unassigned contact text' }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('heading', { name: 'Unassigned source content' }),
    ).toHaveFocus(),
  );
  expect(
    screen.getAllByText('Unclear contact fragment: example-handle', {
      exact: false,
    })[0]!,
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText(/Draft saved\. You can finish/);
  expect(
    state
      .profile()
      .document.coverage.filter((c) => c.disposition === 'excluded'),
  ).toHaveLength(1);
  expect(
    state
      .profile()
      .document.coverage.some((c) => c.disposition === 'unresolved'),
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved review' }));
  await waitFor(() =>
    expect(screen.getByText(/Profile revision 4/)).toBeVisible(),
  );
  for (const [category, list] of contactSkillGroups)
    expect(screen.getByRole('article', { name: category })).toHaveTextContent(
      list,
    );
  expect(
    screen.getByRole('button', { name: 'Mark Skills section as checked' }),
  ).toBeEnabled();
  expect(
    screen.getByRole('region', { name: 'Before you can complete the review' }),
  ).toBeInTheDocument();
});

test('contact icons exclude independently; LinkedIn URL requires confirmation and keeps source provenance', async () => {
  const state = setup(false, false, false, false, 'reference');
  await open();
  fireEvent.click(
    screen.getByRole('button', { name: 'Exclude reviewed separator symbols' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Review unassigned contact text' }),
  );
  const useUrl = screen.getByRole('button', {
    name: 'Confirm LinkedIn and use URL',
  });
  expect(useUrl).toBeDisabled();
  expect(
    screen.queryByText('https://www.linkedin.com/in/synthetic-person-123'),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: 'I confirm this is my LinkedIn profile reference',
    }),
  );
  expect(useUrl).toBeEnabled();
  fireEvent.click(useUrl);
  expect(
    state
      .profile()
      .document.coverage.filter((c) => c.disposition === 'excluded'),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText(/Draft saved\. You can finish/);
  const document = state.profile().document;
  expect(
    document.coverage.filter((c) => c.disposition === 'excluded'),
  ).toHaveLength(2);
  const facts = document.sections.flatMap((s) =>
    s.entries.flatMap((e) => e.facts),
  );
  expect(facts.find((f) => f.id === 'email')!.value).toBe(
    'person@example.invalid ',
  );
  const original = facts.find((f) => f.value === 'synthetic-person-123\n')!;
  expect(original.origin).toBe('source');
  expect(original.evidence[0]!.quote).toBe(original.value);
  expect(facts.find((f) => f.replacesFactId === original.id)).toMatchObject({
    field: 'link',
    origin: 'user_entered',
    review: 'confirmed',
    evidence: [],
    value: 'https://www.linkedin.com/in/synthetic-person-123',
  });
});

test('a possible profile can be kept as exact link text without constructing a URL', async () => {
  const state = setup(false, false, false, false, 'reference');
  await open();
  fireEvent.click(
    screen.getByRole('button', { name: 'Exclude reviewed separator symbols' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Review unassigned contact text' }),
  );
  fireEvent.mouseDown(
    screen.getByRole('combobox', { name: 'Detail type for this content' }),
  );
  fireEvent.click(screen.getByRole('option', { name: 'Link' }));
  fireEvent.mouseDown(
    screen.getByRole('combobox', { name: 'Section for this content' }),
  );
  fireEvent.click(screen.getByRole('option', { name: 'Links' }));
  fireEvent.click(screen.getByRole('button', { name: 'Keep in Links' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText(/Draft saved\. You can finish/);
  const facts = state
    .profile()
    .document.sections.flatMap((s) => s.entries.flatMap((e) => e.facts));
  expect(facts.find((f) => f.value === 'synthetic-person-123\n')).toMatchObject(
    { field: 'link', origin: 'source', review: 'needs_clarification' },
  );
  expect(
    facts.some((f) => f.value.startsWith('https://www.linkedin.com')),
  ).toBe(false);
});

const linkBetaToAlpha = (
  document: ReturnType<typeof richProfile>['document'],
) => {
  const experience = document.sections.find((s) => s.kind === 'experience')!;
  const beta = experience.entries.find((e) => e.id === 'entry-beta')!;
  beta.facts = beta.facts.filter((f) => f.field !== 'employer');
  const row = document.coverage.find((r) => r.factIds.includes('field-8'))!;
  Object.assign(row, {
    disposition: 'unresolved',
    factIds: [],
    reason: 'Synthetic unassigned employer line.',
  });
  beta.employerFactId = 'field-4';
};

test('linked positions show the shared employer read-only and keep the link through save', async () => {
  const state = setup(false, false, false, true);
  linkBetaToAlpha(state.profile().document);
  await open();
  const beta = screen.getByRole('article', {
    name: /^Employer: .*Example Alpha \(shared\)$/u,
  });
  expect(beta).toHaveTextContent('Junior Engineer');
  expect(
    screen.getAllByRole('article', { name: /Example Alpha/u }),
  ).toHaveLength(2);
  fireEvent.click(
    screen.getByRole('button', { name: 'Mark Experience section as checked' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText(/Draft saved\. You can finish/);
  const saved = state
    .profile()
    .document.sections.find((s) => s.kind === 'experience')!;
  expect(saved.entries.find((e) => e.id === 'entry-beta')!.employerFactId).toBe(
    'field-4',
  );
  expect(
    saved.entries.flatMap((e) => e.facts).filter((f) => f.field === 'employer'),
  ).toHaveLength(1);
});

test('response validation rejects dangling or mistyped shared employer links; legacy entries remain valid', () => {
  const valid = richProfile();
  linkBetaToAlpha(valid.document);
  expect(() => decodeCvProfile(valid, richSource)).not.toThrow();
  for (const target of ['field-missing', 'field-5']) {
    const profile = richProfile();
    linkBetaToAlpha(profile.document);
    profile.document.sections
      .find((s) => s.kind === 'experience')!
      .entries.find((e) => e.id === 'entry-beta')!.employerFactId = target;
    expect(() => decodeCvProfile(profile, richSource)).toThrow();
  }
  expect(() => decodeCvProfile(richProfile(), richSource)).not.toThrow();
});
