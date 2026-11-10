import { StrictMode, useRef, useState } from 'react';
import { ThemeProvider } from '@mui/material';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { act, render, screen, waitFor, within } from './render';
import { theme } from '../src/app/theme';
import { App } from '../src/app/App';
import { emptyOpportunity } from '../src/features/inbox/opportunities-api';
import { UnsavedJobGuard } from '../src/features/inbox/UnsavedJobGuard';

function Editor() {
  const [text, setText] = useState('');
  const saved = useRef(false);
  return (
    <>
      <UnsavedJobGuard dirty={Boolean(text)} savedNavigation={saved} />
      <label>
        Draft
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <Link to="/inbox">Back to Inbox</Link>
    </>
  );
}
function mount() {
  const router = createMemoryRouter(
    [
      { path: '/edit', element: <Editor /> },
      { path: '/inbox', element: <h1>Inbox destination</h1> },
    ],
    { initialEntries: ['/edit'] },
  );
  render(
    <ThemeProvider theme={theme}>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
  return router;
}
async function openWithKeyboard(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByRole('textbox', { name: 'Draft' }),
    'Unsaved synthetic draft',
  );
  await user.tab();
  expect(screen.getByRole('link', { name: 'Back to Inbox' })).toHaveFocus();
  await user.keyboard('{Enter}');
  const dialog = await screen.findByRole('dialog', {
    name: 'Leave unsaved changes?',
  });
  const stay = screen.getByRole('button', { name: 'Stay and edit' });
  await waitFor(() => expect(stay).toHaveFocus());
  return { dialog, stay };
}

test.each(['{Enter}', ' '])(
  'initial safe native button responds to %s and returns focus without discarding',
  async (key) => {
    const router = mount();
    const user = userEvent.setup();
    const { stay } = await openWithKeyboard(user);
    expect(stay.tagName).toBe('BUTTON');
    expect(stay).toHaveAttribute('type', 'button');
    await user.keyboard(key);
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(router.state.location.pathname).toBe('/edit');
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue(
      'Unsaved synthetic draft',
    );
    const link = screen.getByRole('link', { name: 'Back to Inbox' });
    expect(link).toHaveFocus();
    // Reopening must establish safe focus again, not only on the first mount.
    await user.keyboard('{Enter}');
    await screen.findByRole('dialog');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Stay and edit' }),
      ).toHaveFocus(),
    );
    await user.keyboard(key);
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(link).toHaveFocus();
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  },
);

test('Escape preserves the blocked dialog, Tab stays trapped, and only explicit Discard navigates', async () => {
  const router = mount();
  const user = userEvent.setup();
  const { dialog, stay } = await openWithKeyboard(user);
  const discard = screen.getByRole('button', { name: 'Discard and leave' });
  expect(stay).toHaveClass('MuiButton-outlined', 'MuiButton-colorPrimary');
  expect(discard).toHaveClass('MuiButton-outlined', 'MuiButton-colorError');
  await user.keyboard('{Escape}');
  expect(dialog).toBeVisible();
  expect(router.state.location.pathname).toBe('/edit');
  expect(stay).toHaveFocus();
  await user.tab();
  expect(discard).toHaveFocus();
  await user.tab();
  expect(stay).toHaveFocus();
  await user.tab({ shift: true });
  expect(discard).toHaveFocus();
  await user.keyboard(' ');
  expect(
    await screen.findByRole('heading', { name: 'Inbox destination' }),
  ).toBeVisible();
  expect(router.state.location.pathname).toBe('/inbox');
});

test('MUI surface autofocus hands focus to Stay without mount autofocus or transition retries', async () => {
  const nativeFocus = HTMLElement.prototype.focus;
  const targets: HTMLElement[] = [];
  const focus = vi
    .spyOn(HTMLElement.prototype, 'focus')
    .mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      targets.push(this);
      nativeFocus.call(this, options);
    });
  try {
    mount();
    const user = userEvent.setup();
    const { dialog, stay } = await openWithKeyboard(user);
    const surfaceFocus = targets.indexOf(dialog);
    expect(surfaceFocus).toBeGreaterThanOrEqual(0);
    expect(targets.indexOf(stay)).toBeGreaterThan(surfaceFocus);
    expect(targets.filter((target) => target === stay)).toHaveLength(1);
    expect(stay).not.toHaveAttribute('autofocus');
    const discard = within(dialog).getByRole('button', {
      name: 'Discard and leave',
    });
    await user.tab();
    expect(document.activeElement).toBe(discard);
    // A modal render does not give initial-focus ownership back to Stay.
    await user.keyboard('{Escape}');
    await act(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, theme.transitions.duration.enteringScreen + 30),
      );
    });
    expect(document.activeElement).toBe(discard);
    expect(targets.filter((target) => target === stay)).toHaveLength(1);
  } finally {
    focus.mockRestore();
  }
});

test.each(['{Enter}', ' '])(
  'B01: keyboard sidebar navigation from edited Application focuses Stay and %s retains edits in StrictMode',
  async (key) => {
    const id = '00000000-0000-4000-8000-123456789012';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/health/')
          ? Response.json({ status: 'ok' })
          : Response.json({
              ...emptyOpportunity(),
              id,
              title: 'Synthetic job',
              jdText: '',
              documentName: null,
            }),
      ),
    );
    const router = createMemoryRouter([{ path: '*', element: <App /> }], {
      initialEntries: [`/jobs/${id}?tab=application`],
    });
    render(
      <StrictMode>
        <ThemeProvider theme={theme}>
          <RouterProvider router={router} />
        </ThemeProvider>
      </StrictMode>,
    );
    const user = userEvent.setup();
    await user.type(
      await screen.findByRole('textbox', { name: 'Application notes' }),
      'Unsaved Application notes',
    );
    // Reach the actual sidebar through keyboard navigation, without focusing the
    // dialog action from the test or substituting a local editor Back link.
    const sidebar = within(
      screen.getByRole('navigation', { name: 'Main navigation' }),
    ).getByRole('link', { name: 'My CV' });
    for (let i = 0; document.activeElement !== sidebar && i < 50; i++)
      await user.tab();
    expect(document.activeElement).toBe(sidebar);
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', {
      name: 'Leave unsaved changes?',
    });
    const stay = within(dialog).getByRole('button', { name: 'Stay and edit' });
    expect(document.activeElement).toBe(stay);
    expect(sidebar).not.toHaveFocus();
    expect(router.state.location.pathname).toBe(`/jobs/${id}`);
    const discard = within(dialog).getByRole('button', {
      name: 'Discard and leave',
    });
    await user.tab();
    expect(document.activeElement).toBe(discard);
    await user.tab();
    expect(document.activeElement).toBe(stay);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(discard);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(stay);
    await user.keyboard(key);
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(sidebar);
    expect(router.state.location.pathname).toBe(`/jobs/${id}`);
    expect(
      screen.getByRole('textbox', { name: 'Application notes' }),
    ).toHaveValue('Unsaved Application notes');
  },
  // Full StrictMode keyboard traversal can exceed 5s on hosted CI.
  10000,
);

test('Stay shows the same outline for programmatic focus and removes it when focus leaves', async () => {
  mount();
  const user = userEvent.setup();
  await user.type(
    screen.getByRole('textbox', { name: 'Draft' }),
    'Unsaved draft',
  );
  // Mouse navigation causes programmatic dialog focus, rather than relying on
  // keyboard modality to give Stay a Mui-focusVisible class.
  await user.click(screen.getByRole('link', { name: 'Back to Inbox' }));
  const stay = await screen.findByRole('button', { name: 'Stay and edit' });
  const discard = screen.getByRole('button', { name: 'Discard and leave' });
  expect(stay).toHaveFocus();
  expect(stay.matches(':focus')).toBe(true);
  // JSDOM's modality heuristic differs from browsers. Check the independent
  // :focus rule too, so a Mui-focusVisible outline cannot hide a regression.
  const focusRules = Array.from(document.styleSheets)
    .flatMap((sheet) => Array.from(sheet.cssRules))
    .filter((rule): rule is CSSStyleRule => 'selectorText' in rule)
    .filter(
      (rule) =>
        rule.selectorText.endsWith(':focus') && stay.matches(rule.selectorText),
    );
  expect(
    focusRules.some(
      (rule) =>
        rule.style.outline === '2px solid ' + theme.palette.primary.main &&
        rule.style.outlineOffset === '2px',
    ),
  ).toBe(true);

  expect(stay).toHaveStyle({
    outline: '2px solid ' + theme.palette.primary.main,
    outlineOffset: '2px',
  });
  await user.tab();
  expect(discard).toHaveFocus();
  expect(stay.matches(':focus')).toBe(false);
  expect(getComputedStyle(stay).outline).not.toBe(
    '2px solid ' + theme.palette.primary.main,
  );
  await user.tab({ shift: true });
  expect(stay).toHaveFocus();
  expect(stay).toHaveStyle({
    outline: '2px solid ' + theme.palette.primary.main,
    outlineOffset: '2px',
  });
  await user.click(stay);
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(screen.getByRole('link', { name: 'Back to Inbox' })).toHaveFocus();
  expect(stay.matches(':focus')).toBe(false);
  expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue(
    'Unsaved draft',
  );
});
