import { expect, test, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from './render';
import { theme } from '../src/app/theme';
import { AuthGate } from '../src/features/auth/AuthGate';

const json = (status: number, body: unknown) =>
  new Response(body === null ? null : JSON.stringify(body), { status });

function renderAt(path: string, fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[path]}>
        <AuthGate />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

test('signed-out visitors are sent to login; empty submit shows field errors without calling the API', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(json(401, { errorCode: 'UNAUTHENTICATED' }));
  renderAt('/jobs', fetchMock);
  expect(
    await screen.findByRole('heading', { name: 'Đăng nhập' }),
  ).toBeVisible();
  expect(
    screen.queryByRole('navigation', { name: 'Main navigation' }),
  ).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
  expect(screen.getByText('Nhập địa chỉ email hợp lệ.')).toBeVisible();
  expect(screen.getByText('Nhập mật khẩu.')).toBeVisible();
  expect(screen.getByLabelText(/Email/)).toHaveFocus();
  expect(fetchMock).toHaveBeenCalledTimes(1); // only the session check
});

test('a rejected login shows a generic message and keeps the entered email', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json(401, { errorCode: 'UNAUTHENTICATED' }))
    .mockResolvedValueOnce(json(401, { errorCode: 'INVALID_CREDENTIALS' }));
  renderAt('/login', fetchMock);
  await userEvent.type(await screen.findByLabelText(/Email/), 'a@example.test');
  const password = screen.getByLabelText(/Mật khẩu/, { selector: 'input' });
  await userEvent.type(password, 'wrong-password');
  expect(password).toHaveAttribute('type', 'password');
  await userEvent.click(screen.getByRole('button', { name: 'Hiện mật khẩu' }));
  expect(password).toHaveAttribute('type', 'text');
  await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Email hoặc mật khẩu không đúng.',
  );
  expect(screen.getByLabelText(/Email/)).toHaveValue('a@example.test');
  expect(fetchMock.mock.calls[1]![0]).toBe('/api/v1/auth/login');
});

test('registration validates password length, confirmation and invitation code', async () => {
  const fetchMock = vi.fn().mockResolvedValue(json(401, null));
  renderAt('/register', fetchMock);
  await userEvent.type(await screen.findByLabelText(/Email/), 'a@example.test');
  await userEvent.type(
    screen.getByLabelText(/^Mật khẩu/, { selector: 'input' }),
    'short',
  );
  await userEvent.type(
    screen.getByLabelText(/Xác nhận mật khẩu/, { selector: 'input' }),
    'different',
  );
  await userEvent.click(screen.getByRole('button', { name: 'Tạo tài khoản' }));
  expect(screen.getByText('Mật khẩu cần ít nhất 10 ký tự.')).toBeVisible();
  expect(screen.getByText('Mật khẩu xác nhận không khớp.')).toBeVisible();
  expect(screen.getByText('Nhập mã mời.')).toBeVisible();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
