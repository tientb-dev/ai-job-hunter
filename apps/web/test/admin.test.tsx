import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor, within } from './render';
import { theme } from '../src/app/theme';
import { setLocale } from '../src/app/i18n';
import { AuthGate } from '../src/features/auth/AuthGate';

const ADMIN = 'admin@example.test';
const CODE = 'ABCDE-FGHJK-LMNPQ-RSTUV';
const INVITE = {
  id: '11111111-1111-4111-8111-111111111111',
  createdAt: '2026-11-20T08:00:00.000Z',
  expiresAt: '2026-11-27T08:00:00.000Z',
  usedAt: null,
  revokedAt: null,
  status: 'active',
};
const MEMBER = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'member@example.test',
  createdAt: '2026-11-01T08:00:00.000Z',
};
const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

type Handler = (url: string, init?: RequestInit) => Response | undefined;
let calls: { url: string; method: string; body?: unknown }[];

function renderAt(
  path: string,
  isAdmin: boolean,
  handler: Handler = () => undefined,
) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url === '/api/v1/auth/me')
        return json(200, { email: ADMIN, isAdmin });
      return (
        handler(url, init) ??
        (url === '/api/v1/admin/invites'
          ? json(200, { invites: [INVITE] })
          : json(500))
      );
    }),
  );
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[path]}>
        <AuthGate />
      </MemoryRouter>
    </ThemeProvider>,
  );
}
const writes = () => calls.filter((c) => c.method === 'POST');

beforeEach(() => {
  setLocale('vi-VN');
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

test('non-admins get Not Found at /admin and no Admin navigation', async () => {
  renderAt('/admin', false);
  expect(
    await screen.findByRole('heading', { name: 'Không tìm thấy trang' }),
  ).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Quản trị' })).toBeNull();
  expect(calls.some((c) => c.url.startsWith('/api/v1/admin'))).toBe(false);
});

test('admins see the navigation item and the page; the list loads', async () => {
  renderAt('/admin', true);
  expect(await screen.findByRole('link', { name: 'Quản trị' })).toHaveAttribute(
    'href',
    '/admin',
  );
  expect(
    screen.getByRole('heading', { name: 'Quản trị', level: 1 }),
  ).toBeVisible();
  const table = await screen.findByRole('table', { name: 'Mã mời' });
  expect(within(table).getByText('Còn hiệu lực')).toBeVisible();
});

test('creating an invite shows the code once with Copy, then forgets it on close', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  renderAt('/admin', true, (url, init) =>
    url === '/api/v1/admin/invites' && init?.method === 'POST'
      ? json(201, { id: INVITE.id, code: CODE, expiresAt: INVITE.expiresAt })
      : undefined,
  );
  await userEvent.click(
    await screen.findByRole('button', { name: 'Tạo mã mời' }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Đã tạo mã mời' });
  expect(within(dialog).getByText(CODE)).toBeVisible();
  expect(writes()).toEqual([
    { url: '/api/v1/admin/invites', method: 'POST', body: { days: 7 } },
  ]);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Sao chép' }));
  expect(await within(dialog).findByText('Đã sao chép mã.')).toBeVisible();
  expect(writeText).toHaveBeenCalledWith(CODE);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Xong' }));
  await waitFor(() => expect(screen.queryByText(CODE)).toBeNull());
  expect(document.body.innerHTML).not.toContain(CODE);
  expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(
    CODE,
  );
});

test('revoking asks for confirmation, then reports success and reloads', async () => {
  renderAt('/admin', true, (url) =>
    url.endsWith('/revoke') ? json(204) : undefined,
  );
  await userEvent.click(
    await screen.findByRole('button', { name: /^Thu hồi mã mời tạo lúc/ }),
  );
  const confirm = await screen.findByRole('dialog', {
    name: 'Thu hồi mã mời này?',
  });
  expect(writes()).toEqual([]);
  await userEvent.click(
    within(confirm).getByRole('button', { name: 'Thu hồi' }),
  );
  expect(await screen.findByText('Đã thu hồi mã mời.')).toBeVisible();
  expect(writes()).toEqual([
    {
      url: `/api/v1/admin/invites/${INVITE.id}/revoke`,
      method: 'POST',
      body: {},
    },
  ]);
  await waitFor(() =>
    expect(calls.filter((c) => c.url === '/api/v1/admin/invites').length).toBe(
      2,
    ),
  );
});

test('a failed list load shows Retry inline', async () => {
  let fail = true;
  renderAt('/admin', true, (url) =>
    url === '/api/v1/admin/invites' && fail ? json(503) : undefined,
  );
  const alert = await screen.findByText(/Không tải được danh sách mã mời/);
  fail = false;
  await userEvent.click(
    within(alert.closest('[role="alert"]') as HTMLElement).getByRole('button', {
      name: 'Thử lại',
    }),
  );
  expect(await screen.findByRole('table', { name: 'Mã mời' })).toBeVisible();
  expect(screen.queryByText(/Không tải được danh sách mã mời/)).toBeNull();
});

test('reset: exact lookup, re-auth failure stays signed in, success shows the code once', async () => {
  let reauthOk = false;
  renderAt('/admin', true, (url, init) => {
    if (url.startsWith('/api/v1/admin/users?email='))
      return url.endsWith(encodeURIComponent(MEMBER.email))
        ? json(200, MEMBER)
        : json(404, { errorCode: 'NOT_FOUND' });
    if (url.endsWith('/reset-code') && init?.method === 'POST')
      return reauthOk
        ? json(201, { code: CODE, expiresAt: INVITE.expiresAt })
        : json(403, { errorCode: 'REAUTH_FAILED' });
    return undefined;
  });
  const email = await screen.findByLabelText('Email tài khoản');
  await userEvent.type(email, 'nobody@example.test');
  await userEvent.click(screen.getByRole('button', { name: 'Tìm tài khoản' }));
  expect(
    await screen.findByText('Không có tài khoản nào dùng email này.'),
  ).toBeVisible();

  await userEvent.clear(email);
  await userEvent.type(email, MEMBER.email);
  await userEvent.click(screen.getByRole('button', { name: 'Tìm tài khoản' }));
  expect(await screen.findByText(MEMBER.email)).toBeVisible();

  const issue = screen.getByRole('button', { name: 'Cấp mã đặt lại' });
  await userEvent.click(issue);
  expect(screen.getByText('Nhập mật khẩu của bạn.')).toBeVisible();
  expect(writes()).toEqual([]);

  const password = screen.getByLabelText('Mật khẩu quản trị của bạn');
  await userEvent.type(password, 'wrong-password-1');
  await userEvent.click(issue);
  expect(await screen.findByText('Mật khẩu của bạn không đúng.')).toBeVisible();
  expect(password).toHaveValue('');
  // Not treated as a lost session: still on the admin page.
  expect(
    screen.getByRole('heading', { name: 'Quản trị', level: 1 }),
  ).toBeVisible();
  expect(writes()[0]).toEqual({
    url: `/api/v1/admin/users/${MEMBER.id}/reset-code`,
    method: 'POST',
    body: { hours: 24, password: 'wrong-password-1' },
  });

  reauthOk = true;
  await userEvent.type(password, 'synthetic-password-1');
  await userEvent.click(issue);
  const dialog = await screen.findByRole('dialog', {
    name: 'Đã cấp mã đặt lại mật khẩu',
  });
  expect(within(dialog).getByText(CODE)).toBeVisible();
  expect(password).toHaveValue('');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByText(CODE)).toBeNull());
  const leaked =
    JSON.stringify({ ...localStorage, ...sessionStorage }) +
    window.location.href;
  for (const secret of [CODE, 'synthetic-password-1'])
    expect(leaked).not.toContain(secret);
});

test('the admin cannot issue a reset code for their own account', async () => {
  renderAt('/admin', true, (url) =>
    url.startsWith('/api/v1/admin/users?email=')
      ? json(200, { ...MEMBER, email: ADMIN })
      : undefined,
  );
  await userEvent.type(await screen.findByLabelText('Email tài khoản'), ADMIN);
  await userEvent.click(screen.getByRole('button', { name: 'Tìm tài khoản' }));
  expect(
    await screen.findByText(/Bạn không thể tự cấp mã đặt lại mật khẩu/),
  ).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Cấp mã đặt lại' })).toBeNull();
});

test('rate limiting is shown as an error popup, not inline as a password error', async () => {
  renderAt('/admin', true, (url, init) =>
    url === '/api/v1/admin/invites' && init?.method === 'POST'
      ? json(429, { errorCode: 'TOO_MANY_ATTEMPTS' })
      : undefined,
  );
  await userEvent.click(
    await screen.findByRole('button', { name: 'Tạo mã mời' }),
  );
  expect(await screen.findByText('Không tạo được mã mời')).toBeVisible();
  expect(screen.getByText(/Bạn đã thử quá nhiều lần/)).toBeVisible();
});

test('small screens list invites as cards with status and Revoke, without a table', async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  const used = {
    ...INVITE,
    id: '33333333-3333-4333-8333-333333333333',
    status: 'used',
  };
  renderAt('/admin', true, (url, init) =>
    url === '/api/v1/admin/invites' && init?.method === 'GET'
      ? json(200, { invites: [INVITE, used] })
      : url.endsWith('/revoke')
        ? json(204)
        : undefined,
  );
  const list = await screen.findByRole('list', { name: 'Mã mời' });
  expect(screen.queryByRole('table')).toBeNull();
  const [active, spent] = within(list).getAllByRole('listitem');
  expect(within(active!).getByText(/^Ngày tạo:/)).toBeVisible();
  expect(within(active!).getByText(/^Hết hạn:/)).toBeVisible();
  expect(within(active!).getByText('Còn hiệu lực')).toBeVisible();
  expect(within(spent!).getByText('Đã dùng')).toBeVisible();
  expect(within(spent!).queryByRole('button')).toBeNull();
  await userEvent.click(
    within(active!).getByRole('button', { name: /^Thu hồi mã mời tạo lúc/ }),
  );
  const confirm = await screen.findByRole('dialog', {
    name: 'Thu hồi mã mời này?',
  });
  await userEvent.click(
    within(confirm).getByRole('button', { name: 'Thu hồi' }),
  );
  expect(await screen.findByText('Đã thu hồi mã mời.')).toBeVisible();
  expect(writes()).toEqual([
    {
      url: `/api/v1/admin/invites/${INVITE.id}/revoke`,
      method: 'POST',
      body: {},
    },
  ]);
});

test('account menu: admins see email, role and an Admin link that navigates', async () => {
  renderAt('/jobs', true, (url) =>
    url.startsWith('/api/v1/opportunities') ? json(200, []) : undefined,
  );
  const trigger = await screen.findByRole('button', {
    name: 'Tài khoản: admin',
  });
  expect(trigger).toHaveTextContent('admin');
  await userEvent.click(trigger);
  const menu = await screen.findByRole('menu');
  expect(within(menu).getByText(ADMIN)).toBeVisible();
  expect(within(menu).getByText('Quản trị viên')).toBeVisible();
  // Keyboard: Escape closes and returns focus to the trigger.
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(trigger).toHaveFocus();
  await userEvent.click(trigger);
  await userEvent.click(
    await screen.findByRole('menuitem', { name: 'Quản trị' }),
  );
  expect(
    await screen.findByRole('heading', { name: 'Quản trị', level: 1 }),
  ).toBeVisible();
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
});

test('account menu: normal users see only email and Log out, which signs out', async () => {
  setLocale('en-US');
  renderAt('/jobs', false, (url) =>
    url === '/api/v1/auth/logout'
      ? json(204)
      : url.startsWith('/api/v1/opportunities')
        ? json(200, [])
        : undefined,
  );
  await userEvent.click(
    await screen.findByRole('button', { name: 'Account: admin' }),
  );
  const menu = await screen.findByRole('menu');
  expect(within(menu).getByText(ADMIN)).toBeVisible();
  expect(within(menu).queryByText('Administrator')).toBeNull();
  expect(within(menu).queryByRole('menuitem', { name: 'Admin' })).toBeNull();
  expect(
    within(menu)
      .getAllByRole('menuitem')
      .map((i) => i.textContent),
  ).toEqual(['Log out']);
  await userEvent.click(
    within(menu).getByRole('menuitem', { name: 'Log out' }),
  );
  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(writes().filter((c) => c.url.startsWith('/api/v1/auth/'))).toEqual([
    { url: '/api/v1/auth/logout', method: 'POST', body: {} },
  ]);
});
