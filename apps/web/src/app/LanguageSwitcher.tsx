import { MenuItem, TextField } from '@mui/material';
import { LOCALES, setLocale, useI18n, type Locale } from './i18n';

export function LanguageSwitcher() {
  const { locale, t } = useI18n();
  return (
    <TextField
      select
      size="small"
      label={t('language.label')}
      value={locale}
      onChange={(event) => setLocale(event.target.value as Locale)}
      sx={{ minWidth: 140 }}
    >
      {Object.entries(LOCALES).map(([value, name]) => (
        <MenuItem key={value} value={value} lang={value.slice(0, 2)}>
          {name}
        </MenuItem>
      ))}
    </TextField>
  );
}
