import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material';
import { Navigate, Route, Routes } from 'react-router-dom';
import { App } from '../../app/App';
import { RefreshIcon } from '../../components/icons';
import { SignOutButton } from './session';
import { SessionContext, useSession } from './session-context';
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
        <CircularProgress aria-label="Đang tải" />
      </Stack>
    );
  if (state.status === 'error')
    return (
      <AuthLayout title="Không thể kết nối">
        <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
          <Alert severity="error" sx={{ alignSelf: 'stretch' }}>
            Không thể kết nối tới máy chủ. Vui lòng thử lại.
          </Alert>
          <Button
            variant="contained"
            startIcon={<RefreshIcon />}
            onClick={() => {
              setState({ status: 'loading' });
              void refresh();
            }}
          >
            Thử lại
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
        <Route
          path="*"
          element={user.dataAccess ? <App /> : <AccessPending />}
        />
      </Routes>
    </SessionContext.Provider>
  );
}

/** Until PR 2 isolates data per account, only the local owner may use the workspace. */
function AccessPending() {
  return (
    <AuthLayout title="Tài khoản đã sẵn sàng">
      <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
        <Typography>
          Bản beta đang hoàn thiện việc tách riêng dữ liệu cho từng tài khoản.
          Các tính năng sẽ được mở cho bạn ngay khi bước này hoàn tất.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Đã đăng nhập với {useSession()?.user.email}
        </Typography>
        <SignOutButton />
      </Stack>
    </AuthLayout>
  );
}
