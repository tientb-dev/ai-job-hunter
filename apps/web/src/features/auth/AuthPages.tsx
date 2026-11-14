import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  InputAdornment,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import {
  AuthRequestError,
  login,
  PASSWORD_MIN,
  register,
  resetPassword,
  validEmail,
} from './auth-api';

/** Signed-out shell: no workspace navigation, one centered card. */
export function AuthLayout({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Box
      component="main"
      sx={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        px: 2,
        py: 4,
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 420 }}>
        <Typography
          variant="subtitle1"
          sx={{ fontWeight: 600, letterSpacing: '-0.01em', mb: 2 }}
        >
          AI Job Hunter
        </Typography>
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h4" component="h1" sx={{ mb: 3 }}>
            {title}
          </Typography>
          {children}
        </Paper>
      </Box>
    </Box>
  );
}

interface Field {
  name: string;
  label: string;
  type: 'email' | 'password' | 'text';
  autoComplete: string;
  helper?: string;
  /** Returns an error message, or '' when valid. */
  check: (value: string, values: Record<string, string>) => string;
}

function PasswordInput(props: Omit<Parameters<typeof TextField>[0], 'type'>) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      slotProps={{
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <Button
                size="small"
                onClick={() => setVisible((v) => !v)}
                aria-pressed={visible}
                aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              >
                {visible ? 'Ẩn' : 'Hiện'}
              </Button>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

function AuthForm({
  fields,
  submitLabel,
  pendingLabel,
  onSubmit,
  notice,
}: {
  fields: Field[];
  submitLabel: string;
  pendingLabel: string;
  onSubmit: (values: Record<string, string>) => Promise<void>;
  notice?: ReactNode;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, ''])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const found = Object.fromEntries(
      fields.map((f) => [f.name, f.check(values[f.name] ?? '', values)]),
    );
    setErrors(found);
    setFormError('');
    const firstInvalid = fields.find((f) => found[f.name]);
    if (firstInvalid) {
      document.getElementById(`auth-${firstInvalid.name}`)?.focus();
      return;
    }
    setPending(true);
    try {
      await onSubmit(values);
    } catch (error) {
      setFormError(
        error instanceof AuthRequestError
          ? error.message
          : 'Đã có lỗi xảy ra. Vui lòng thử lại.',
      );
      setPending(false);
    }
  }

  return (
    <Box component="form" noValidate onSubmit={submit}>
      <Stack spacing={2}>
        {notice}
        {formError && <Alert severity="error">{formError}</Alert>}
        {fields.map((field, index) => {
          const shared = {
            id: `auth-${field.name}`,
            name: field.name,
            label: field.label,
            value: values[field.name] ?? '',
            autoComplete: field.autoComplete,
            autoFocus: index === 0,
            required: true,
            fullWidth: true,
            error: Boolean(errors[field.name]),
            helperText: errors[field.name] || field.helper,
            onChange: (e: { target: { value: string } }) =>
              setValues((v) => ({ ...v, [field.name]: e.target.value })),
          };
          return field.type === 'password' ? (
            <PasswordInput key={field.name} {...shared} />
          ) : (
            <TextField key={field.name} type={field.type} {...shared} />
          );
        })}
        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={pending}
          fullWidth
        >
          {pending ? pendingLabel : submitLabel}
        </Button>
      </Stack>
    </Box>
  );
}

const emailField: Field = {
  name: 'email',
  label: 'Email',
  type: 'email',
  autoComplete: 'email',
  check: (v) => (validEmail(v) ? '' : 'Nhập địa chỉ email hợp lệ.'),
};
const newPasswordFields: Field[] = [
  {
    name: 'password',
    label: 'Mật khẩu',
    type: 'password',
    autoComplete: 'new-password',
    helper: `Ít nhất ${PASSWORD_MIN} ký tự.`,
    check: (v) =>
      v.length >= PASSWORD_MIN
        ? v.length <= 128
          ? ''
          : 'Mật khẩu tối đa 128 ký tự.'
        : `Mật khẩu cần ít nhất ${PASSWORD_MIN} ký tự.`,
  },
  {
    name: 'confirm',
    label: 'Xác nhận mật khẩu',
    type: 'password',
    autoComplete: 'new-password',
    check: (v, all) =>
      v && v === all.password ? '' : 'Mật khẩu xác nhận không khớp.',
  },
];
const required = (message: string) => (v: string) => (v.trim() ? '' : message);

function FooterLinks({ children }: { children: ReactNode }) {
  return (
    <Stack spacing={1} sx={{ mt: 3 }}>
      {children}
    </Stack>
  );
}

export function LoginPage({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  return (
    <AuthLayout title="Đăng nhập">
      <AuthForm
        notice={notice && <Alert severity="success">{notice}</Alert>}
        fields={[
          emailField,
          {
            name: 'password',
            label: 'Mật khẩu',
            type: 'password',
            autoComplete: 'current-password',
            check: required('Nhập mật khẩu.'),
          },
        ]}
        submitLabel="Đăng nhập"
        pendingLabel="Đang đăng nhập…"
        onSubmit={async ({ email, password }) => {
          await login(email!, password!);
          await onSignedIn();
        }}
      />
      <FooterLinks>
        <Typography variant="body2">
          Chưa có tài khoản?{' '}
          <Link component={RouterLink} to="/register">
            Đăng ký bằng mã mời
          </Link>
        </Typography>
        <Typography variant="body2">
          <Link component={RouterLink} to="/reset-password">
            Quên mật khẩu?
          </Link>
        </Typography>
      </FooterLinks>
    </AuthLayout>
  );
}

export function RegisterPage({
  onSignedIn,
}: {
  onSignedIn: () => Promise<void>;
}) {
  return (
    <AuthLayout title="Tạo tài khoản">
      <AuthForm
        fields={[
          emailField,
          ...newPasswordFields,
          {
            name: 'invitationCode',
            label: 'Mã mời',
            type: 'text',
            autoComplete: 'off',
            helper: 'Mã do quản trị viên gửi cho bạn.',
            check: required('Nhập mã mời.'),
          },
        ]}
        submitLabel="Tạo tài khoản"
        pendingLabel="Đang tạo tài khoản…"
        onSubmit={async ({ email, password, invitationCode }) => {
          await register(email!, password!, invitationCode!);
          await onSignedIn();
        }}
      />
      <FooterLinks>
        <Typography variant="body2">
          Đã có tài khoản?{' '}
          <Link component={RouterLink} to="/login">
            Đăng nhập
          </Link>
        </Typography>
      </FooterLinks>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  return (
    <AuthLayout title="Đặt lại mật khẩu">
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Liên hệ quản trị viên để nhận mã đặt lại mật khẩu, sau đó nhập mã và mật
        khẩu mới bên dưới.
      </Typography>
      <AuthForm
        fields={[
          {
            name: 'resetCode',
            label: 'Mã đặt lại mật khẩu',
            type: 'text',
            autoComplete: 'one-time-code',
            check: required('Nhập mã đặt lại mật khẩu.'),
          },
          ...newPasswordFields.map((f) =>
            f.name === 'password' ? { ...f, label: 'Mật khẩu mới' } : f,
          ),
        ]}
        submitLabel="Đặt lại mật khẩu"
        pendingLabel="Đang đặt lại…"
        onSubmit={async ({ resetCode, password }) => {
          await resetPassword(resetCode!, password!);
          void navigate('/login', {
            replace: true,
            state: { notice: 'Đã đặt lại mật khẩu. Vui lòng đăng nhập.' },
          });
        }}
      />
      <FooterLinks>
        <Typography variant="body2">
          <Link component={RouterLink} to="/login">
            Quay lại đăng nhập
          </Link>
        </Typography>
      </FooterLinks>
    </AuthLayout>
  );
}
