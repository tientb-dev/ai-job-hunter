import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, CircularProgress, Stack } from '@mui/material';
import { Navigate, Route, Routes } from 'react-router-dom';
import { App } from '../../app/App';
import { RefreshIcon } from '../../components/icons';
import { useI18n } from '../../app/i18n';
import { SessionContext } from './session-context';
import { fetchCurrentUser, logout } from './auth-api';
import type { CurrentUser } from './auth-api';
import {
  AuthLayout,
  LoginPage,
  RegisterPage,
  ResetPasswordPage,
} from './AuthPages';

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; user: CurrentUser | null };

export function AuthGate() {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ status: 'loading' });
  const refresh = useCallback(async () => {
    try {
      setState({ status: 'ready', user: await fetchCurrentUser() });
    } catch {
      setState({ status: 'error' });
    }
  }, []);
  const signOut = useCallback(async () => {
    try {
      await logout();
    } finally {
      setState({ status: 'ready', user: null });
    }
  }, []);
  useEffect(() => {
    let stopped = false;
    fetchCurrentUser().then(
      (user) => !stopped && setState({ status: 'ready', user }),
      () => !stopped && setState({ status: 'error' }),
    );
    return () => {
      stopped = true;
    };
  }, []);

  if (state.status === 'loading')
    return (
      <Stack
        sx={{
          minHeight: '100dvh',
          placeItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CircularProgress aria-label={t('common.loading')} />
      </Stack>
    );
  if (state.status === 'error')
    return (
      <AuthLayout title={t('connect.title')}>
        <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
          <Alert severity="error" sx={{ alignSelf: 'stretch' }}>
            {t('auth.error.NETWORK')}
          </Alert>
          <Button
            variant="contained"
            startIcon={<RefreshIcon />}
            onClick={() => {
              setState({ status: 'loading' });
              void refresh();
            }}
          >
            {t('common.retry')}
          </Button>
        </Stack>
      </AuthLayout>
    );
  const { user } = state;
  if (!user)
    return (
      <Routes>
        <Route path="/login" element={<LoginPage onSignedIn={refresh} />} />
        <Route
          path="/register"
          element={<RegisterPage onSignedIn={refresh} />}
        />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  return (
    <SessionContext.Provider value={{ user, signOut }}>
      <Routes>
        {['/login', '/register', '/reset-password'].map((path) => (
          <Route key={path} path={path} element={<Navigate to="/" replace />} />
        ))}
        <Route path="*" element={<App />} />
      </Routes>
    </SessionContext.Provider>
  );
}
