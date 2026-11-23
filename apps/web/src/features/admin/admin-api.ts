// Admin API client. Plaintext codes and the confirmation password only pass
// through memory: never URLs, storage, logs or notifications.

export type InviteStatus = 'active' | 'used' | 'revoked' | 'expired';
export interface Invite {
  id: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  status: InviteStatus;
}
export interface IssuedCode {
  code: string;
  expiresAt: string;
}
export interface AdminUser {
  id: string;
  email: string;
  createdAt: string;
}

const KNOWN = [
  'INVALID_INPUT',
  'NOT_FOUND',
  'REAUTH_FAILED',
  'SELF_RESET_FORBIDDEN',
  'TOO_MANY_ATTEMPTS',
  'UNAUTHENTICATED',
] as const;
export type AdminErrorCode =
  (typeof KNOWN)[number] | 'NO_ACCESS' | 'NETWORK' | 'UNEXPECTED';

export class AdminRequestError extends Error {
  constructor(readonly code: AdminErrorCode) {
    super(code);
  }
}

async function call<T>(path: string, body?: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/admin/${path}`, {
      method: body ? 'POST' : 'GET',
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new AdminRequestError('NETWORK');
  }
  if (response.ok)
    return (response.status === 204 ? undefined : await response.json()) as T;
  const payload: unknown = await response.json().catch(() => null);
  const code =
    typeof payload === 'object' && payload !== null && 'errorCode' in payload
      ? String(payload.errorCode)
      : '';
  if ((KNOWN as readonly string[]).includes(code))
    throw new AdminRequestError(code as AdminErrorCode);
  // The guard answers non-admins with a plain 404 (no errorCode).
  throw new AdminRequestError(
    response.status === 404 ? 'NO_ACCESS' : 'UNEXPECTED',
  );
}

export const listInvites = () =>
  call<{ invites: Invite[] }>('invites').then((r) => r.invites);
export const createInvite = (days: number) =>
  call<IssuedCode & { id: string }>('invites', { days });
export const revokeInvite = (id: string) =>
  call<void>(`invites/${encodeURIComponent(id)}/revoke`, {});
export const findUser = (email: string) =>
  call<AdminUser>(`users?email=${encodeURIComponent(email.trim())}`);
export const issueResetCode = (
  userId: string,
  hours: number,
  password: string,
) =>
  call<IssuedCode>(`users/${encodeURIComponent(userId)}/reset-code`, {
    hours,
    password,
  });
