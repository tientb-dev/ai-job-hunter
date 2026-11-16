import { dateLocale, tr } from '../../app/i18n';

// Display-only formatting for imported values; stored values never change.
const PERIODS: Record<string, () => string> = {
  month: () => tr('/month'),
  year: () => tr('/year'),
  day: () => tr('/day'),
  hour: () => tr('/hour'),
};
function millions(raw: string): string {
  const value = Number(raw) / 1_000_000;
  const text = Number.isInteger(value)
    ? String(value)
    : value.toLocaleString(dateLocale(), { maximumFractionDigits: 1 });
  return dateLocale() === 'vi-VN' ? `${text} triệu` : `${text}M`;
}
/** "15000000-50000000 VND per MONTH" → "15–50 triệu VND/tháng" (vi) or "15M–50M VND/month". */
export function displaySalary(value: string): string {
  const range =
    /^(\d{7,})\s*-\s*(\d{7,})\s+([A-Z]{3})(?:\s+per\s+(\w+))?$/i.exec(
      value.trim(),
    );
  const single =
    /^(?:Up to\s+)?(\d{7,})\s+([A-Z]{3})(?:\s+per\s+(\w+))?$/i.exec(
      value.trim(),
    );
  const period = (name?: string) =>
    name ? (PERIODS[name.toLowerCase()]?.() ?? ` / ${name}`) : '';
  if (range) {
    const [, low, high, currency, per] = range;
    const lowText = millions(low!);
    const highText = millions(high!);
    const pair =
      dateLocale() === 'vi-VN'
        ? `${lowText.replace(' triệu', '')}–${highText}`
        : `${lowText}–${highText}`;
    return `${pair} ${currency!.toUpperCase()}${period(per)}`;
  }
  if (single) {
    const [, amount, currency, per] = single;
    const prefix = /^Up to/i.test(value.trim()) ? tr('Up to') + ' ' : '';
    return `${prefix}${millions(amount!)} ${currency!.toUpperCase()}${period(per)}`;
  }
  return value;
}
/** "Minimum 3 years" / "36 months" → localised "At least 3 years". */
export function displayExperience(value: string): string {
  const years = /^Minimum (\d+(?:\.\d+)?) years?$/i.exec(value.trim())?.[1];
  if (years) return tr('At least {n} year(s)', { n: years });
  const months = /^(\d+) months?$/i.exec(value.trim())?.[1];
  if (months) {
    const count = Number(months);
    return count % 12 === 0
      ? tr('At least {n} year(s)', { n: count / 12 })
      : tr('At least {n} month(s)', { n: count });
  }
  return value;
}
/** Requirement text as display lines (one qualification per line). */
export function requirementItems(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}
