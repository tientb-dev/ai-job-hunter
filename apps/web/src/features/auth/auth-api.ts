export interface CurrentUser {
  email: string;
  /** False until per-account data ownership ships (web beta PR 2). */
  dataAccess: boolean;
}

export const PASSWORD_MIN = 10;

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'Email hoặc mật khẩu không đúng.',
  REGISTRATION_FAILED:
    'Không thể tạo tài khoản. Mã mời có thể không hợp lệ, đã hết hạn hoặc đã được sử dụng, hoặc email này không dùng được.',
  RESET_FAILED:
    'Mã đặt lại mật khẩu không hợp lệ, đã hết hạn hoặc đã được sử dụng.',
  INVALID_INPUT: 'Vui lòng kiểm tra lại thông tin đã nhập.',
  TOO_MANY_ATTEMPTS:
    'Bạn đã thử quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.',
};
const FALLBACK = 'Không thể kết nối tới máy chủ. Vui lòng thử lại.';

export class AuthRequestError extends Error {}

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
    throw new AuthRequestError(MESSAGES[code] ?? FALLBACK);
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
