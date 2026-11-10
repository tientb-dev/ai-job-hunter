import { expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from './render';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { App } from '../src/app/App';

vi.mock('../src/features/health/ApiReadiness', () => ({
  ApiReadiness: () => <span>API synthetic</span>,
}));

function mount(width = 1280, height = 900) {
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', height);
  let chromeHeight = 180;
  let resize!: () => void;
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const rect = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      const measuredHeight = this.hasAttribute('data-discovery-chrome')
        ? chromeHeight
        : this.hasAttribute('data-queue-chrome')
          ? 64
          : 0;
      return {
        top: 100,
        bottom: 100 + measuredHeight,
        left: 0,
        right: 800,
        width: 800,
        height: measuredHeight,
        x: 0,
        y: 100,
        toJSON() {},
      };
    });
  const rows = Array.from({ length: 10 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    title: `Synthetic role ${i + 1}`,
    company: 'Synthetic company',
    location: 'Vietnam',
    status: 'NEW',
    originalLink: 'https://example.com/job',
    sourceName: 'Synthetic feed',
    opportunityId: null,
    firstSeenAt: '2026-11-04T00:00:00Z',
    lastSeenAt: '2026-11-04T00:00:00Z',
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/runs'))
        return Response.json({
          found: 10,
          eligible: 10,
          fetched: 10,
          normalized: 10,
          added: 0,
          refreshed: 10,
          remaining: 0,
          sources: [],
          warnings: [],
          sourceFailures: 0,
          errors: [],
          scope: 'Synthetic',
        });
      if (url.includes('/candidates?'))
        return Response.json({
          items: rows,
          total: 20,
          page: 1,
          pageSize: 10,
          totalPages: 2,
        });
      return Response.json({
        ...rows[0],
        description: 'Synthetic description',
        skills: '',
        preferredSkills: '',
      });
    }),
  );
  const router = createMemoryRouter([{ path: '*', element: <App /> }], {
    initialEntries: ['/discover'],
  });
  const view = render(<RouterProvider router={router} />);
  return {
    ...view,
    router,
    expand(height: number) {
      chromeHeight = height;
      act(() => resize());
    },
    dispose() {
      view.unmount();
      rect.mockRestore();
    },
    disconnect,
  };
}
const shell = () => screen.getByRole('main').parentElement!.parentElement!;

test('desktop constrains only rows while controls, pagination, Review and notifications stay independent', async () => {
  const view = mount();
  try {
    const rows = screen.getByRole('region', {
      name: 'Discovery candidate rows',
    });
    await screen.findByRole('button', { name: 'Review Synthetic role 10' });
    expect(within(rows).getAllByRole('heading', { level: 3 })).toHaveLength(10);
    expect(shell()).toHaveStyle({ height: '100dvh' });
    expect(rows).toHaveStyle({
      overflowY: 'auto',
      minHeight: '0',
      scrollbarGutter: 'stable',
      overflowAnchor: 'none',
    });
    expect(rows).toHaveAttribute('tabindex', '0');
    for (const control of [
      screen.getByRole('heading', { name: 'Discovery queue' }),
      screen.getByRole('group', { name: 'Queue filter' }),
      screen.getByText('1–10 of 20'),
    ])
      expect(rows).not.toContainElement(control);
    let ancestor = rows.parentElement;
    while (ancestor && ancestor !== document.body) {
      expect(['auto', 'scroll', 'hidden']).not.toContain(
        getComputedStyle(ancestor).overflowY,
      );
      ancestor = ancestor.parentElement;
    }
    rows.scrollTop = 150;
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    await waitFor(() =>
      expect(view.router.state.location.search).toBe('?filter=new&page=1'),
    );
    await screen.findByRole('button', { name: 'Review Synthetic role 1' });
    expect(
      screen.getByRole('region', { name: 'Discovery candidate rows' }),
    ).toBe(rows);
    expect(rows.scrollTop).toBe(150);
    fireEvent.click(
      screen.getByRole('button', { name: 'Review Synthetic role 1' }),
    );
    await screen.findByText('Synthetic description');
    fireEvent.click(screen.getByRole('button', { name: 'Close review' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(rows.scrollTop).toBe(150);
    fireEvent.click(screen.getByRole('button', { name: 'Run discovery' }));
    const notice = await screen.findByText(/10 eligible · 0 added · 10 known/);
    expect(notice.closest('.MuiSnackbar-root')).toHaveStyle({
      position: 'fixed',
    });
    expect(rows.scrollTop).toBe(150);
    fireEvent.click(screen.getByRole('button', { name: 'Run details' }));
    expect(
      await screen.findByRole('dialog', { name: 'Discovery run details' }),
    ).toBeVisible();
    expect(rows.scrollTop).toBe(150);
  } finally {
    view.dispose();
  }
});

test.each([
  [360, 900],
  [1280, 480],
])('width %s height %s uses document scrolling', async (width, height) => {
  const view = mount(width, height);
  try {
    await screen.findByText('Synthetic role 10');
    expect(getComputedStyle(shell()).height).not.toBe('100dvh');
    const rows = screen.getByRole('region', {
      name: 'Discovery candidate rows',
    });
    expect(rows).toHaveStyle({ overflowY: 'visible' });
    expect(rows).not.toHaveAttribute('tabindex');
    expect(screen.getByText('1–10 of 20')).toBeVisible();
  } finally {
    view.dispose();
  }
});

test('expanded chrome and viewport resizing release and restore viewport constraints', async () => {
  const view = mount();
  try {
    await screen.findByText('Synthetic role 10');
    view.expand(600);
    expect(getComputedStyle(shell()).height).not.toBe('100dvh');
    expect(
      screen.getByRole('region', { name: 'Discovery candidate rows' }),
    ).toHaveStyle({ overflowY: 'visible' });
    view.expand(180);
    expect(shell()).toHaveStyle({ height: '100dvh' });
    vi.stubGlobal('innerWidth', 500);
    fireEvent(window, new Event('resize'));
    expect(getComputedStyle(shell()).height).not.toBe('100dvh');
  } finally {
    view.dispose();
  }
  expect(view.disconnect).toHaveBeenCalled();
});
