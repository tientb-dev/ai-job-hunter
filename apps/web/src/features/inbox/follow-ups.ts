import { useEffect, useState } from 'react';

export function localCalendarDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function dueFollowUp(
  date: string | null,
  status: string,
  today: string,
  followUpStatus: string,
) {
  if (
    !date ||
    followUpStatus !== 'PENDING' ||
    status === 'REJECTED' ||
    status === 'CLOSED'
  )
    return null;
  // Persisted dates are validated YYYY-MM-DD values. Never parse them as UTC.
  if (date < today) return 'Overdue';
  if (date === today) return 'Due today';
  return null;
}

export function useLocalCalendarDate() {
  const [today, setToday] = useState(localCalendarDate);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      const now = new Date();
      setToday(localCalendarDate(now));
      const midnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );
      // Local midnight handles DST. The cap also catches clock/timezone changes.
      timer = setTimeout(
        refresh,
        Math.min(60_000, midnight.getTime() - now.getTime()),
      );
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return today;
}
