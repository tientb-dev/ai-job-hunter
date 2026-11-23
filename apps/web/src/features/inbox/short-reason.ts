/** Main suggestion reason: first sentence, at most `max` words. Full text stays in the details. */
export function shortReason(text: string, max = 25): string {
  const clean = text.trim().replace(/\s+/gu, ' ');
  const first = /^.+?[.!?。](?=\s|$)/u.exec(clean)?.[0] ?? clean;
  const words = first.split(' ');
  return words.length <= max
    ? first
    : `${words
        .slice(0, max)
        .join(' ')
        .replace(/[,;:]$/u, '')}…`;
}
