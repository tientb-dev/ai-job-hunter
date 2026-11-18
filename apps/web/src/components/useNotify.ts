import { createContext, useContext } from 'react';

/**
 * Mutation results: success/info is a compact centred dialog that closes after
 * SUCCESS_NOTIFICATION_MS; errors/warnings open a centred dialog that stays
 * until acknowledged, with Retry when the caller passes a safe `onRetry`.
 */
export type Notification = {
  severity: 'success' | 'error' | 'warning' | 'info';
  text: string;
  title?: string;
  onRetry?: () => void;
};
export const SUCCESS_NOTIFICATION_MS = 3500;
export const Notifications = createContext<
  ((message: Notification) => void) | null
>(null);
export function useNotify() {
  const notify = useContext(Notifications);
  if (!notify) throw new Error('NotificationProvider is required');
  return notify;
}
