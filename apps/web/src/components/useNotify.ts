import { createContext, useContext } from 'react';

/**
 * Mutation results (see AGENTS.md "Feedback"): success is a compact popup that
 * closes after SUCCESS_NOTIFICATION_MS; errors stay until the user dismisses
 * them and may add a title and details.
 */
export type Notification = {
  severity: 'success' | 'error' | 'warning' | 'info';
  text: string;
  title?: string;
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
