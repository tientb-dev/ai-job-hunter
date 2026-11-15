import { useMemo, type ReactNode } from 'react';
import { createTheme, ThemeProvider } from '@mui/material';
import { enUS, viVN } from '@mui/material/locale';
import { useI18n } from './i18n';
import { theme } from './theme';

/** MUI's own labels (pagination, close buttons) follow the chosen language. */
export function LocalizedTheme({ children }: { children: ReactNode }) {
  const { locale } = useI18n();
  const localized = useMemo(
    () => createTheme(theme, locale === 'vi-VN' ? viVN : enUS),
    [locale],
  );
  return <ThemeProvider theme={localized}>{children}</ThemeProvider>;
}
