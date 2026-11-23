export interface CurrentUser {
  email: string;
  /** UI hint only; the server authorizes every admin request. */
  isAdmin?: boolean;
}

export const PASSWORD_MIN = 10;

const KNOWN = [
  'INVALID_CREDENTIALS',
  'REGISTRATION_FAILED',
  'RESET_FAILED',
  'INVALID_INPUT',
  'TOO_MANY_ATTEMPTS',
] as const;
export type AuthErrorCode = (typeof KNOWN)[number] | 'NETWORK';
const FALLBACK: AuthErrorCode = 'NETWORK';

/** Carries a code; the UI shows the message in the current language. */
export class AuthRequestError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
  }
}

async function send(path: string, body?: object): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new AuthRequestError(FALLBACK);
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const code =
      typeof payload === 'object' && payload !== null && 'errorCode' in payload
        ? String(payload.errorCode)
        : '';
    throw new AuthRequestError(
      (KNOWN as readonly string[]).includes(code)
        ? (code as AuthErrorCode)
        : FALLBACK,
    );
  }
  return response;
}

/** null when signed out; throws when the server cannot answer. */
export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const response = await fetch('/api/v1/auth/me', { cache: 'no-store' });
  if (response.status === 401) return null;
  if (!response.ok) throw new AuthRequestError(FALLBACK);
  return (await response.json()) as CurrentUser;
}

export const login = (email: string, password: string) =>
  send('login', { email, password });
export const register = (
  email: string,
  password: string,
  invitationCode: string,
) => send('register', { email, password, invitationCode });
export const resetPassword = (resetCode: string, password: string) =>
  send('reset-password', { resetCode, password });
export const logout = () => send('logout');

export const validEmail = (email: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
