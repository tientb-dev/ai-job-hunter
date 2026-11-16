import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import { setLocale, useI18n, type Locale } from './i18n';

const OPTIONS: [Locale, string][] = [
  ['vi-VN', 'VI'],
  ['en-US', 'EN'],
];

/** Compact VI / EN switch; setLocale persists the choice across reloads. */
export function LanguageSwitcher() {
  const { locale, t } = useI18n();
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={locale}
      aria-label={t('language.label')}
      onChange={(_, value: Locale | null) => value && setLocale(value)}
      sx={{
        '& .MuiToggleButton-root': {
          px: 1.25,
          py: 0.25,
          minWidth: 40,
          minHeight: { xs: 36, md: 32 },
          fontWeight: 600,
          lineHeight: 1.2,
        },
      }}
    >
      {OPTIONS.map(([value, label]) => (
        <ToggleButton
          key={value}
          value={value}
          lang={value.slice(0, 2)}
          aria-label={value === 'vi-VN' ? 'Tiếng Việt' : 'English'}
        >
          {label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
