import { beforeEach, expect, test, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, within } from './render';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
  );
});

async function renderLogin() {
  // Fresh modules so the stored locale is read as on a real page load.
  const { AuthGate } = await import('../src/features/auth/AuthGate');
  render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthGate />
    </MemoryRouter>,
  );
}

test('defaults to Vietnamese and persists the chosen language', async () => {
  await renderLogin();
  expect(
    await screen.findByRole('heading', { name: 'Đăng nhập' }),
  ).toBeVisible();
  expect(document.documentElement.lang).toBe('vi');

  await userEvent.click(screen.getByRole('combobox', { name: 'Ngôn ngữ' }));
  await userEvent.click(
    within(screen.getByRole('listbox')).getByRole('option', {
      name: 'English',
    }),
  );
  expect(screen.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Show password' })).toBeVisible();
  expect(document.documentElement.lang).toBe('en');
  expect(localStorage.getItem('ajh.locale')).toBe('en-US');
});

test('restores a stored language', async () => {
  localStorage.setItem('ajh.locale', 'en-US');
  await renderLogin();
  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('falls back to Vietnamese for an unsupported stored value', async () => {
  localStorage.setItem('ajh.locale', 'fr-FR');
  await renderLogin();
  expect(
    await screen.findByRole('heading', { name: 'Đăng nhập' }),
  ).toBeVisible();
});
