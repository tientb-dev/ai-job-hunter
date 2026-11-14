import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// OWASP scrypt profile N=2^15, r=8, p=3 (32 MiB per hash). Parameters are
// stored with each hash so they can be raised later without a migration.
const LOG_N = 15;
const R = 8;
const P = 3;
const KEY_BYTES = 32;
const MAX_MEM = 64 * 1024 * 1024;

function derive(
  password: string,
  salt: Buffer,
  logN: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password.normalize('NFKC'),
      salt,
      KEY_BYTES,
      { N: 2 ** logN, r, p, maxmem: MAX_MEM },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, LOG_N, R, P);
  return `scrypt$${LOG_N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [algorithm, logN, r, p, salt, key] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await derive(
    password,
    Buffer.from(salt, 'base64'),
    Number(logN),
    Number(r),
    Number(p),
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A valid hash for an unguessable password, so unknown emails cost the same as wrong passwords. */
export const DUMMY_PASSWORD_HASH = hashPassword(
  randomBytes(32).toString('hex'),
);

/** Opaque, high-entropy secrets (sessions, codes) need a fast hash, not a password KDF. */
export const sha256 = (value: string): Buffer =>
  createHash('sha256').update(value).digest();

export const newSessionToken = (): string =>
  randomBytes(32).toString('base64url');

// No I, O, 0 or 1: codes are typed by hand. 32 symbols divide 256, so `& 31` is unbiased.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 20 symbols × 5 bits = 100 bits, shown as XXXXX-XXXXX-XXXXX-XXXXX. */
export function newCode(): string {
  const chars = [...randomBytes(20)].map((b) => CODE_ALPHABET[b & 31]);
  return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join('')).join('-');
}

/** Case, spaces and dashes do not matter when a person retypes a code. */
export const normalizeCode = (code: string): string =>
  code.toUpperCase().replace(/[^A-Z0-9]/g, '');

export const normalizeEmail = (email: string): string =>
  email.normalize('NFKC').trim().toLowerCase();

export const validEmail = (email: string): boolean =>
  email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;
export const validPassword = (password: string): boolean =>
  password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX;
