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
import type { AuthErrorCode } from './auth-api';
import { useI18n, type MessageKey } from '../../app/i18n';
import { LanguageSwitcher } from '../../app/LanguageSwitcher';

type T = ReturnType<typeof useI18n>['t'];

/** Signed-out shell: no workspace navigation, one centered card. */
export function AuthLayout({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
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
        <Stack
          direction="row"
          sx={{
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
            mb: 2,
          }}
        >
          <Typography
            variant="subtitle1"
            sx={{ fontWeight: 600, letterSpacing: '-0.01em' }}
          >
            {t('app.name')}
          </Typography>
          <LanguageSwitcher />
        </Stack>
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
  const { t } = useI18n();
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
                aria-label={t(
                  visible ? 'auth.hidePassword' : 'auth.showPassword',
                )}
              >
                {t(visible ? 'auth.hide' : 'auth.show')}
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
  const { t } = useI18n();
  const [formError, setFormError] = useState<AuthErrorCode | 'UNEXPECTED' | ''>(
    '',
  );
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
        error instanceof AuthRequestError ? error.code : 'UNEXPECTED',
      );
      setPending(false);
    }
  }

  return (
    <Box component="form" noValidate onSubmit={submit}>
      <Stack spacing={2}>
        {notice}
        {formError && (
          <Alert severity="error">{t(`auth.error.${formError}`)}</Alert>
        )}
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

const emailField = (t: T): Field => ({
  name: 'email',
  label: t('auth.email'),
  type: 'email',
  autoComplete: 'email',
  check: (v) => (validEmail(v) ? '' : t('auth.invalidEmail')),
});
const newPasswordFields = (t: T, label: MessageKey): Field[] => [
  {
    name: 'password',
    label: t(label),
    type: 'password',
    autoComplete: 'new-password',
    helper: t('auth.passwordHelper', { min: PASSWORD_MIN }),
    check: (v) =>
      v.length >= PASSWORD_MIN
        ? v.length <= 128
          ? ''
          : t('auth.passwordTooLong')
        : t('auth.passwordTooShort', { min: PASSWORD_MIN }),
  },
  {
    name: 'confirm',
    label: t('auth.confirmPassword'),
    type: 'password',
    autoComplete: 'new-password',
    check: (v, all) =>
      v && v === all.password ? '' : t('auth.passwordMismatch'),
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
  const { t } = useI18n();
  const notice = (useLocation().state as { notice?: MessageKey } | null)
    ?.notice;
  return (
    <AuthLayout title={t('auth.signIn')}>
      <AuthForm
        notice={notice && <Alert severity="success">{t(notice)}</Alert>}
        fields={[
          emailField(t),
          {
            name: 'password',
            label: t('auth.password'),
            type: 'password',
            autoComplete: 'current-password',
            check: required(t('auth.enterPassword')),
          },
        ]}
        submitLabel={t('auth.signIn')}
        pendingLabel={t('auth.signingIn')}
        onSubmit={async ({ email, password }) => {
          await login(email!, password!);
          await onSignedIn();
        }}
      />
      <FooterLinks>
        <Typography variant="body2">
          {t('auth.noAccount')}{' '}
          <Link component={RouterLink} to="/register">
            {t('auth.registerWithCode')}
          </Link>
        </Typography>
        <Typography variant="body2">
          <Link component={RouterLink} to="/reset-password">
            {t('auth.forgotPassword')}
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
  const { t } = useI18n();
  return (
    <AuthLayout title={t('auth.register')}>
      <AuthForm
        fields={[
          emailField(t),
          ...newPasswordFields(t, 'auth.password'),
          {
            name: 'invitationCode',
            label: t('auth.invitationCode'),
            type: 'text',
            autoComplete: 'off',
            helper: t('auth.invitationHelper'),
            check: required(t('auth.enterInvitation')),
          },
        ]}
        submitLabel={t('auth.register')}
        pendingLabel={t('auth.registering')}
        onSubmit={async ({ email, password, invitationCode }) => {
          await register(email!, password!, invitationCode!);
          await onSignedIn();
        }}
      />
      <FooterLinks>
        <Typography variant="body2">
          {t('auth.haveAccount')}{' '}
          <Link component={RouterLink} to="/login">
            {t('auth.signIn')}
          </Link>
        </Typography>
      </FooterLinks>
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <AuthLayout title={t('auth.reset')}>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        {t('auth.resetIntro')}
      </Typography>
      <AuthForm
        fields={[
          {
            name: 'resetCode',
            label: t('auth.resetCode'),
            type: 'text',
            autoComplete: 'one-time-code',
            check: required(t('auth.enterResetCode')),
          },
          ...newPasswordFields(t, 'auth.newPassword'),
        ]}
        submitLabel={t('auth.reset')}
        pendingLabel={t('auth.resetting')}
        onSubmit={async ({ resetCode, password }) => {
          await resetPassword(resetCode!, password!);
          void navigate('/login', {
            replace: true,
            state: { notice: 'auth.resetDone' satisfies MessageKey },
          });
        }}
      />
      <FooterLinks>
        <Typography variant="body2">
          <Link component={RouterLink} to="/login">
            {t('auth.backToSignIn')}
          </Link>
        </Typography>
      </FooterLinks>
    </AuthLayout>
  );
}
