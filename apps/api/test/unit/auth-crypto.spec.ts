import { expect, test } from '@jest/globals';
import {
  hashPassword,
  newCode,
  normalizeCode,
  normalizeEmail,
  verifyPassword,
} from '../../src/auth/auth.crypto.js';
import { sessionCookie } from '../../src/auth/auth.http.js';

test('passwords are salted scrypt hashes that verify only the original password', async () => {
  const a = await hashPassword('correct horse battery');
  const b = await hashPassword('correct horse battery');
  expect(a).toMatch(/^scrypt\$15\$8\$3\$/);
  expect(a).not.toBe(b);
  expect(a).not.toContain('correct horse');
  expect(await verifyPassword('correct horse battery', a)).toBe(true);
  expect(await verifyPassword('correct horse batterY', a)).toBe(false);
  expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
});

test('codes are unambiguous, unique, and normalize when retyped', () => {
  const code = newCode();
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}$/);
  expect(new Set(Array.from({ length: 200 }, newCode)).size).toBe(200);
  expect(normalizeCode(` ${code.toLowerCase().replaceAll('-', ' ')} `)).toBe(
    code.replaceAll('-', ''),
  );
});

test('emails normalize case and surrounding space', () => {
  expect(normalizeEmail('  Tester@Example.COM ')).toBe('tester@example.com');
});

test('session cookies are httpOnly, SameSite=Lax, and Secure with __Host- in production', () => {
  const dev = sessionCookie('tok', false);
  expect(dev).toMatch(
    /^ajh_session=tok; Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800$/,
  );
  const prod = sessionCookie('tok', true);
  expect(prod).toMatch(
    /^__Host-ajh_session=tok;.*HttpOnly.*SameSite=Lax.*; Secure$/,
  );
  expect(sessionCookie(null, false)).toContain('Max-Age=0');
});
