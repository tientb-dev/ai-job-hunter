import { useEffect } from 'react';
import { useNotify } from '../../components/useNotify';

// Same wording as the API (ai.errors.ts); /analyses reports only the code.
const MESSAGES: Record<string, string> = {
  AI_DAILY_USER_LIMIT:
    'You have used today’s AI requests. The limit resets at midnight (Vietnam time).',
  AI_DAILY_GLOBAL_LIMIT:
    'The beta has used today’s AI requests. The limit resets at midnight (Vietnam time).',
  AI_BUSY: 'AI is busy with other requests. Try again in a minute.',
  AI_UNAVAILABLE: 'AI is unavailable. Try again later.',
};
const REPEAT_MS = 10_000;

/**
 * Hosted AI limits can stop any AI feature. Screens keep their own error
 * state; this adds one clear notice for whichever request hit the limit.
 */
export function AiLimitNotices() {
  const notify = useNotify();
  useEffect(() => {
    const original = window.fetch;
    const shown = new Map<string, number>();
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (response.status === 429 || response.status === 503)
        void response
          .clone()
          .json()
          .then((body: { errorCode?: unknown; error?: { code?: unknown } }) => {
            const code = String(body?.errorCode ?? body?.error?.code ?? '');
            const text = MESSAGES[code];
            if (!text || Date.now() - (shown.get(code) ?? 0) < REPEAT_MS)
              return;
            shown.set(code, Date.now());
            notify({ severity: 'warning', text });
          })
          .catch(() => undefined);
      return response;
    };
    return () => {
      window.fetch = original;
    };
  }, [notify]);
  return null;
}
