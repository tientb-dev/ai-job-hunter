import { expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from './render';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { App } from '../src/app/App';
import { emptyOpportunity } from '../src/features/inbox/opportunities-api';
vi.mock('../src/features/health/ApiReadiness', () => ({
  ApiReadiness: () => <span>API synthetic</span>,
}));
vi.mock('../src/features/inbox/CvMatchPanel', () => ({
  CvMatchPanel: () => <div>Synthetic CV match panel</div>,
}));
const id = '00000000-0000-4000-8000-123456789012';
function mount(path = '/jobs/new') {
  let row = {
    ...emptyOpportunity(),
    id,
    title: 'Synthetic engineer',
    jdText: '',
    documentName: null,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST' || init?.method === 'PUT')
        row = { ...row, ...JSON.parse(init.body as string) };
      return Response.json(row);
    }),
  );
  const mounted = render(
    <RouterProvider
      router={createMemoryRouter([{ path: '*', element: <App /> }], {
        initialEntries: [path],
      })}
    />,
  );
  if (path === '/jobs/new')
    fireEvent.click(screen.getByRole('button', { name: /Paste JD/ }));
  return mounted;
}
function shell() {
  return screen.getByRole('main').parentElement!.parentElement!;
}
test.each([360, 1280])(
  'Add Job uses page scroll and brings each new step into view at width %s',
  (width) => {
    vi.stubGlobal('innerWidth', width);
    const scrolled: Element[] = [];
    // jsdom has no scrollIntoView; record the targets instead.
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    mount();
    expect(
      screen.queryByRole('region', { name: 'Scrollable job fields' }),
    ).toBeNull();
    expect(shell().style.height).toBe('');
    expect(scrolled).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Recruitment post'), {
      target: { value: 'Unsaved synthetic source' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue to Review & Save' }),
    );
    const stepper = screen
      .getByText('Import sources')
      .closest('.MuiStepper-root');
    expect(scrolled).toEqual([stepper]);
    expect(
      screen.getByRole('region', { name: 'Job save actions' }),
    ).toContainElement(
      screen.getByRole('button', { name: 'Confirm and save job' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Back to Import sources' }),
    );
    expect(scrolled).toEqual([stepper, stepper]);
    expect(screen.getByLabelText('Recruitment post')).toHaveValue(
      'Unsaved synthetic source',
    );
    expect(screen.getByText('Unsaved changes')).toBeVisible();
  },
);

test('Edit JD and Application scroll only their form while preserving edits and save', async () => {
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('innerHeight', 900);
  applicationGeometry();
  mount(`/jobs/${id}`);
  await screen.findByRole('heading', { name: 'Synthetic engineer' });
  expect(shell().style.height).toBe('');
  fireEvent.click(screen.getByRole('link', { name: 'Edit JD' }));
  const editFields = screen.getByRole('region', {
    name: 'Scrollable job fields',
  });
  expect(editFields.closest('[role="tabpanel"]')).toBe(
    screen.getByRole('tabpanel', { name: 'Edit JD' }),
  );
  expect(editFields).not.toContainElement(screen.getByRole('tablist'));
  expect(editFields).not.toContainElement(
    screen.getByRole('button', { name: 'Save changes' }),
  );
  expect(shell().style.height).toBe('');
  fireEvent.change(screen.getByLabelText('Job description'), {
    target: { value: 'Reviewed synthetic JD' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Changes saved')).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: /^Application/ }));
  await waitFor(() => expect(shell().style.height).toBe(''));
  const applicationFields = screen.getByRole('region', {
    name: 'Scrollable job fields',
  });
  expect(applicationFields).toContainElement(
    screen.getByLabelText('Application notes'),
  );
  expect(applicationFields).not.toContainElement(
    screen.getByRole('heading', { name: 'Synthetic engineer' }),
  );
  expect(applicationFields).not.toContainElement(
    screen.getByRole('button', { name: 'Save changes' }),
  );
  fireEvent.click(screen.getByRole('link', { name: 'Edit JD' }));
  expect(
    screen.getByRole('region', { name: 'Scrollable job fields' }),
  ).toContainElement(screen.getByLabelText('Job description'));
  expect(screen.getByLabelText('Job description')).toHaveValue(
    'Reviewed synthetic JD',
  );
});

function applicationGeometry() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const tab = document.getElementById(
        this.getAttribute('aria-labelledby') ?? '',
      );
      const top =
        this.getAttribute('role') === 'tabpanel' &&
        // Edit JD is a header action now, so its panel is named directly.
        ['Application', 'Edit JD'].includes(
          tab?.textContent ?? this.getAttribute('aria-label') ?? '',
        )
          ? 430
          : 0;
      const height =
        this.getAttribute('aria-label') === 'Job save actions' ? 64 : 440;
      return {
        top,
        bottom: top + height,
        left: 0,
        right: 1152,
        width: 1152,
        height,
        x: 0,
        y: top,
        toJSON() {},
      };
    },
  );
}

test('Application keeps header and footer outside its desktop form scroller, preserves values across resize and saves', async () => {
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('innerHeight', 900);
  applicationGeometry();
  mount(`/jobs/${id}/application`);
  await screen.findByRole('heading', { name: 'Application details' });
  const fields = screen.getByRole('region', { name: 'Scrollable job fields' });
  const save = screen.getByRole('button', { name: 'Save changes' });
  expect(fields).toHaveStyle({ overflowY: 'auto' });
  expect(fields.closest('[role="tabpanel"]')).toBe(
    screen.getByRole('tabpanel', { name: 'Application' }),
  );
  expect(fields).not.toContainElement(screen.getByRole('tablist'));
  expect(fields).not.toContainElement(save);
  expect(save.closest('form')).toHaveAttribute('id', 'job-editor-form');
  fireEvent.change(screen.getByLabelText('Application notes'), {
    target: { value: 'Desktop notes survive resizing' },
  });
  fireEvent.change(screen.getByLabelText('Next follow-up date'), {
    target: { value: '2026-11-12' },
  });
  vi.stubGlobal('innerHeight', 600);
  fireEvent(window, new Event('resize'));
  expect(
    screen.queryByRole('region', { name: 'Scrollable job fields' }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText('Application notes')).toHaveValue(
    'Desktop notes survive resizing',
  );
  vi.stubGlobal('innerHeight', 900);
  fireEvent(window, new Event('resize'));
  expect(
    screen.getByRole('region', { name: 'Scrollable job fields' }),
  ).toContainElement(screen.getByLabelText('Application notes'));
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Changes saved')).toBeVisible();
  expect(screen.getByLabelText('Next follow-up date')).toHaveValue(
    '2026-11-12',
  );
  expect(screen.getByText('Unsaved changes')).not.toBeVisible();
});

test.each([
  { width: 390, height: 844, tab: 'Application' },
  { width: 1440, height: 600, tab: 'Application' },
  { width: 390, height: 844, tab: 'Edit JD' },
  { width: 1440, height: 600, tab: 'Edit JD' },
])(
  '$tab falls back to document scrolling at $width × $height',
  async ({ width, height, tab }) => {
    vi.stubGlobal('innerWidth', width);
    vi.stubGlobal('innerHeight', height);
    applicationGeometry();
    mount(`/jobs/${id}/application`);
    await screen.findByRole('heading', { name: 'Application details' });
    fireEvent.click(
      tab === 'Edit JD'
        ? screen.getByRole('link', { name: tab })
        : screen.getByRole('tab', { name: new RegExp(`^${tab}`) }),
    );
    expect(
      screen.queryByRole('region', { name: 'Scrollable job fields' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Job save actions' }),
    ).toContainElement(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      screen.getByLabelText(
        tab === 'Edit JD' ? 'Job description' : 'Application notes',
      ),
    ).toBeVisible();
    expect(shell().style.height).toBe('');
  },
);

test('Confirm and Save submits the original form from the persistent action row', async () => {
  mount();
  fireEvent.click(
    screen.getByRole('button', { name: 'Continue to Review & Save' }),
  );
  fireEvent.change(screen.getByLabelText(/Job title/), {
    target: { value: 'Saved through bounded shell' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and save job' }));
  expect(
    await screen.findByRole('heading', { name: 'Saved through bounded shell' }),
  ).toBeVisible();
  expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(shell().style.height).toBe('');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
