import { createContext, useContext } from 'react';
import type { CurrentUser } from './auth-api';

interface Session {
  user: CurrentUser;
  signOut: () => Promise<void>;
}
export const SessionContext = createContext<Session | null>(null);
/** null outside the gate (e.g. isolated component tests). */
export const useSession = () => useContext(SessionContext);
