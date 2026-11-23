import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
  type Theme,
} from '@mui/material';
import { dateLocale, tr } from '../../app/i18n';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DialogCloseButton } from '../../components/DialogCloseButton';
import { PageHeader } from '../../components/PageHeader';
import { StatusChip } from '../../components/StatusChip';
import {
  AddIcon,
  ContentCopyIcon,
  RefreshIcon,
  SearchIcon,
} from '../../components/icons';
import { useNotify } from '../../components/useNotify';
import { validEmail } from '../auth/auth-api';
import { useSession } from '../auth/session-context';
import {
  AdminRequestError,
  createInvite,
  findUser,
  issueResetCode,
  listInvites,
  revokeInvite,
  type AdminErrorCode,
  type AdminUser,
  type Invite,
  type IssuedCode,
} from './admin-api';

const INVITE_DAYS = [1, 3, 7, 14, 30, 90];
const RESET_HOURS = [1, 4, 24, 72, 168];

const codeOf = (error: unknown): AdminErrorCode =>
  error instanceof AdminRequestError ? error.code : 'UNEXPECTED';

function message(code: AdminErrorCode): string {
  switch (code) {
    case 'NETWORK':
      return tr(
        'Could not reach the server. Check your connection and try again.',
      );
    case 'TOO_MANY_ATTEMPTS':
      return tr('Too many attempts. Wait a few minutes and try again.');
    case 'UNAUTHENTICATED':
      return tr('Your session has ended. Sign in again to continue.');
    case 'NO_ACCESS':
      return tr('This account no longer has admin access.');
    case 'INVALID_INPUT':
      return tr('Check the entered values and try again.');
    case 'SELF_RESET_FORBIDDEN':
      return tr(
        'You cannot issue a reset code for your own account here. Use the CLI instead.',
      );
    default:
      return tr('Something went wrong. Try again.');
  }
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(dateLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

/** Shows a freshly issued code once. The parent drops it after the dialog closes. */
function CodeDialog({
  open,
  title,
  text,
  issued,
  onClose,
  onExited,
}: {
  open: boolean;
  title: string;
  text: string;
  issued: IssuedCode | null;
  onClose: () => void;
  onExited: () => void;
}) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copyCode = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.code);
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  };
  return (
    <Dialog
      open={open}
      // A stray backdrop click must not lose a code that is never shown again.
      onClose={(_, reason) => reason !== 'backdropClick' && onClose()}
      aria-labelledby="admin-code-title"
      aria-describedby="admin-code-text"
      slotProps={{
        transition: {
          onExited: () => {
            setCopy('idle');
            onExited();
          },
        },
      }}
    >
      <DialogCloseButton onClick={onClose} />
      <DialogTitle id="admin-code-title" sx={{ pr: 7 }}>
        {title}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText id="admin-code-text">{text}</DialogContentText>
          <Box
            component="p"
            sx={{
              display: 'block',
              px: 2,
              py: 1.5,
              bgcolor: 'background.default',
              borderRadius: 1,
              fontFamily: 'monospace',
              fontSize: '1.125rem',
              letterSpacing: '0.06em',
              textAlign: 'center',
              overflowWrap: 'anywhere',
              userSelect: 'all',
            }}
          >
            {issued?.code}
          </Box>
          {issued && (
            <Typography variant="body2" color="text.secondary">
              {tr('Valid until {date}.', { date: when(issued.expiresAt) })}
            </Typography>
          )}
          <Alert severity="warning">
            {tr('This code is shown only once. Copy it before closing.')}
          </Alert>
          <Typography variant="body2" role="status" aria-live="polite">
            {copy === 'copied'
              ? tr('Code copied.')
              : copy === 'failed'
                ? tr('Could not copy. Select the code and copy it manually.')
                : ''}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="outlined" onClick={onClose}>
          {tr('Done')}
        </Button>
        <Button
          variant="contained"
          startIcon={<ContentCopyIcon />}
          onClick={() => void copyCode()}
        >
          {tr('Copy')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function useIssuedCode() {
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  const [open, setOpen] = useState(false);
  return {
    issued,
    open,
    show: (code: IssuedCode) => {
      setIssued({ code: code.code, expiresAt: code.expiresAt });
      setOpen(true);
    },
    close: () => setOpen(false),
    clear: () => setIssued(null),
  };
}

function InvitesSection() {
  const notify = useNotify();
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [loadError, setLoadError] = useState<AdminErrorCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const [creating, setCreating] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<Invite | null>(null);
  const [revoking, setRevoking] = useState(false);
  const code = useIssuedCode();
  const compact = useMediaQuery((t: Theme) => t.breakpoints.down('sm'));
  const revokeButton = (invite: Invite) =>
    invite.status === 'active' && (
      <Button
        color="error"
        onClick={() => setRevokeTarget(invite)}
        aria-label={tr('Revoke invite created {date}', {
          date: when(invite.createdAt),
        })}
      >
        {tr('Revoke')}
      </Button>
    );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setInvites(await listInvites());
      setLoadError(null);
    } catch (error) {
      setLoadError(codeOf(error));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let stopped = false;
    listInvites().then(
      (list) => {
        if (stopped) return;
        setInvites(list);
        setLoading(false);
      },
      (error: unknown) => {
        if (stopped) return;
        setLoadError(codeOf(error));
        setLoading(false);
      },
    );
    return () => {
      stopped = true;
    };
  }, []);

  async function create() {
    setCreating(true);
    try {
      code.show(await createInvite(days));
      void load();
    } catch (error) {
      notify({
        severity: 'error',
        title: tr('Could not create invite'),
        text: message(codeOf(error)),
      });
    } finally {
      setCreating(false);
    }
  }

  async function revoke() {
    const target = revokeTarget;
    if (!target) return;
    setRevoking(true);
    try {
      await revokeInvite(target.id);
      setRevokeTarget(null);
      notify({ severity: 'success', text: tr('Invite revoked.') });
    } catch (error) {
      const failure = codeOf(error);
      setRevokeTarget(null);
      notify({
        severity: 'error',
        title: tr('Could not revoke invite'),
        text:
          failure === 'NOT_FOUND'
            ? tr(
                'This invite was already used or revoked. The list has been refreshed.',
              )
            : message(failure),
        onRetry:
          failure === 'NOT_FOUND' ? undefined : () => void revokeAgain(target),
      });
    } finally {
      setRevoking(false);
      void load();
    }
  }
  const revokeAgain = (target: Invite) => setRevokeTarget(target);

  return (
    <Paper
      component="section"
      aria-labelledby="admin-invites-title"
      sx={{ p: { xs: 2, sm: 3 } }}
    >
      <Stack spacing={2}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{
            alignItems: { md: 'center' },
            justifyContent: 'space-between',
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography id="admin-invites-title" variant="h6" component="h2">
              {tr('Invitation codes')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {tr(
                'Each code creates one account. Send it to the tester privately.',
              )}
            </Typography>
          </Box>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1.5}
            sx={{ alignItems: { sm: 'center' }, flexShrink: 0 }}
          >
            <TextField
              select
              size="small"
              label={tr('Valid for')}
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              sx={{ minWidth: 140 }}
            >
              {INVITE_DAYS.map((n) => (
                <MenuItem key={n} value={n}>
                  {tr('{n} days', { n })}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="contained"
              startIcon={
                creating ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <AddIcon />
                )
              }
              // aria-disabled, not disabled: keeps focus so the code dialog can return it here.
              aria-disabled={creating}
              onClick={() => !creating && void create()}
            >
              {tr('Create invite')}
            </Button>
          </Stack>
        </Stack>
        {loadError && (
          <Alert
            severity="error"
            action={
              <Button
                color="inherit"
                size="small"
                startIcon={<RefreshIcon />}
                onClick={() => void load()}
              >
                {tr('Retry')}
              </Button>
            }
          >
            {tr('Could not load invites.')} {message(loadError)}
          </Alert>
        )}
        {invites === null ? (
          loading && (
            <Stack spacing={1} aria-label={tr('Loading invites')}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} variant="rounded" height={40} />
              ))}
            </Stack>
          )
        ) : invites.length === 0 ? (
          <Typography color="text.secondary">
            {tr('No invites yet.')}
          </Typography>
        ) : compact ? (
          // Small screens: a divided list instead of a table that scrolls sideways.
          <Box
            component="ul"
            aria-labelledby="admin-invites-title"
            aria-busy={loading}
            sx={{ listStyle: 'none', m: 0, p: 0 }}
          >
            {invites.map((invite) => (
              <Box
                component="li"
                key={invite.id}
                sx={{
                  py: 1.5,
                  borderTop: 1,
                  borderColor: 'divider',
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  gap: 1,
                  alignItems: 'center',
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600 }}>
                    {tr('Created')}: {when(invite.createdAt)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {tr('Expires')}: {when(invite.expiresAt)}
                  </Typography>
                  <Box sx={{ mt: 1 }}>
                    <StatusChip status={invite.status.toUpperCase()} />
                  </Box>
                </Box>
                {revokeButton(invite)}
              </Box>
            ))}
          </Box>
        ) : (
          <Box sx={{ overflowX: 'auto' }} aria-busy={loading}>
            <Table
              size="small"
              aria-labelledby="admin-invites-title"
              // Fixed widths keep Revoke next to Status instead of the far edge.
              sx={{
                tableLayout: 'fixed',
                minWidth: 600,
                '& th': { fontWeight: 600, color: 'text.secondary' },
              }}
            >
              <colgroup>
                <col style={{ width: '28%' }} />
                <col style={{ width: '28%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '22%' }} />
              </colgroup>
              <TableHead>
                <TableRow>
                  <TableCell>{tr('Created')}</TableCell>
                  <TableCell>{tr('Expires')}</TableCell>
                  <TableCell>{tr('Status')}</TableCell>
                  <TableCell>{tr('Actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {invites.map((invite) => (
                  <TableRow key={invite.id}>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {when(invite.createdAt)}
                    </TableCell>
                    <TableCell
                      sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}
                    >
                      {when(invite.expiresAt)}
                    </TableCell>
                    <TableCell>
                      <StatusChip status={invite.status.toUpperCase()} />
                    </TableCell>
                    <TableCell sx={{ py: 0.5 }}>
                      {revokeButton(invite) || (
                        <Box
                          component="span"
                          aria-hidden="true"
                          sx={{ color: 'text.disabled' }}
                        >
                          —
                        </Box>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Stack>
      <ConfirmDialog
        open={revokeTarget !== null}
        title={tr('Revoke this invite?')}
        text={tr(
          'Nobody will be able to register with this code. This cannot be undone.',
        )}
        safeLabel={tr('Keep invite')}
        confirmLabel={revoking ? tr('Revoking…') : tr('Revoke')}
        destructive
        onSafe={() => !revoking && setRevokeTarget(null)}
        onConfirm={() => !revoking && void revoke()}
      />
      <CodeDialog
        open={code.open}
        issued={code.issued}
        title={tr('Invitation code created')}
        text={tr(
          'Send this code to the tester privately. They enter it at registration.',
        )}
        onClose={code.close}
        onExited={code.clear}
      />
    </Paper>
  );
}

/** Numbered step caption for the reset flow; the text carries the order, not colour. */
function Step({ n, label }: { n: number; label: string }) {
  return (
    <Typography
      component="h3"
      variant="subtitle2"
      sx={{ mb: 1.5, color: 'text.secondary', fontWeight: 600 }}
    >
      {tr('Step {n}', { n })} · {label}
    </Typography>
  );
}

function ResetSection() {
  const notify = useNotify();
  const self = useSession()?.user.email;
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [searching, setSearching] = useState(false);
  const [user, setUser] = useState<AdminUser | null>(null);
  const [hours, setHours] = useState(24);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [issuing, setIssuing] = useState(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  const code = useIssuedCode();

  async function search(event?: FormEvent) {
    event?.preventDefault();
    if (!validEmail(email)) {
      setEmailError(tr('Enter a valid email address.'));
      return;
    }
    setEmailError('');
    setSearching(true);
    setUser(null);
    setPassword('');
    setPasswordError('');
    try {
      setUser(await findUser(email));
    } catch (error) {
      const failure = codeOf(error);
      if (failure === 'NOT_FOUND')
        setEmailError(tr('No account uses this email.'));
      else
        notify({
          severity: 'error',
          title: tr('Could not find account'),
          text: message(failure),
          onRetry: failure === 'NETWORK' ? () => void search() : undefined,
        });
    } finally {
      setSearching(false);
    }
  }

  async function issue(event: FormEvent) {
    event.preventDefault();
    if (!user || issuing) return;
    if (!password) {
      setPasswordError(tr('Enter your password.'));
      passwordInput.current?.focus();
      return;
    }
    setPasswordError('');
    setIssuing(true);
    try {
      const issued = await issueResetCode(user.id, hours, password);
      setPassword('');
      code.show(issued);
    } catch (error) {
      const failure = codeOf(error);
      setPassword('');
      // A wrong confirmation password is a field error, not a lost session.
      if (failure === 'REAUTH_FAILED') {
        setPasswordError(tr('Your password is incorrect.'));
        passwordInput.current?.focus();
      } else
        notify({
          severity: 'error',
          title: tr('Could not issue reset code'),
          text:
            failure === 'NOT_FOUND'
              ? tr('This account no longer exists.')
              : message(failure),
        });
    } finally {
      setIssuing(false);
    }
  }

  const ownAccount = user !== null && user.email === self;
  return (
    <Paper
      component="section"
      aria-labelledby="admin-reset-title"
      sx={{ p: { xs: 2, sm: 3 } }}
    >
      <Stack spacing={2}>
        <Box>
          <Typography id="admin-reset-title" variant="h6" component="h2">
            {tr('Password reset')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {tr(
              'Find the account by its exact email, then issue a one-time reset code.',
            )}
          </Typography>
        </Box>
        <Box>
          <Step n={1} label={tr('Find the account')} />
          <Stack
            component="form"
            method="post"
            noValidate
            onSubmit={(event) => void search(event)}
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ alignItems: { sm: 'flex-start' } }}
          >
            <TextField
              label={tr('Account email')}
              type="email"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={Boolean(emailError)}
              helperText={emailError || undefined}
              sx={{ flex: 1, maxWidth: { sm: 420 } }}
            />
            <Button
              type="submit"
              variant="outlined"
              disabled={searching}
              startIcon={
                searching ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <SearchIcon />
                )
              }
              sx={{ mt: { sm: 1 } }}
            >
              {tr('Find account')}
            </Button>
          </Stack>
        </Box>
        {user && (
          <Stack
            spacing={2}
            sx={{ borderTop: 1, borderColor: 'divider', pt: 2 }}
          >
            <Box>
              <Step n={2} label={tr('Check the account')} />
              <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                {user.email}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {tr('Account created {date}', { date: when(user.createdAt) })}
              </Typography>
            </Box>
            {ownAccount ? (
              <Alert severity="info">
                {tr(
                  'You cannot issue a reset code for your own account here. Use the CLI instead.',
                )}
              </Alert>
            ) : (
              <Box>
                <Step n={3} label={tr('Issue a reset code')} />
                <Stack
                  component="form"
                  method="post"
                  noValidate
                  onSubmit={(event) => void issue(event)}
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={2}
                  sx={{ alignItems: { sm: 'flex-start' } }}
                >
                  <TextField
                    select
                    label={tr('Valid for')}
                    value={hours}
                    onChange={(event) => setHours(Number(event.target.value))}
                    sx={{ minWidth: 160 }}
                  >
                    {RESET_HOURS.map((n) => (
                      <MenuItem key={n} value={n}>
                        {tr('{n} hours', { n })}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label={tr('Your admin password')}
                    type="password"
                    autoComplete="current-password"
                    inputRef={passwordInput}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    error={Boolean(passwordError)}
                    helperText={
                      passwordError || tr('Required to confirm it is you.')
                    }
                    sx={{ flex: 1, maxWidth: { sm: 320 } }}
                  />
                  <Button
                    type="submit"
                    variant="contained"
                    aria-disabled={issuing}
                    startIcon={
                      issuing ? (
                        <CircularProgress size={16} color="inherit" />
                      ) : undefined
                    }
                    sx={{ mt: { sm: 1 } }}
                  >
                    {tr('Issue reset code')}
                  </Button>
                </Stack>
              </Box>
            )}
          </Stack>
        )}
      </Stack>
      <CodeDialog
        open={code.open}
        issued={code.issued}
        title={tr('Reset code issued')}
        text={tr(
          'Send this code to the user privately. They enter it at the password reset page. Earlier unused reset codes no longer work.',
        )}
        onClose={code.close}
        onExited={code.clear}
      />
    </Paper>
  );
}

export function AdminPage() {
  return (
    <Stack spacing={3}>
      <PageHeader
        title={tr('Admin')}
        description={tr(
          'Invite testers and help users reset their password. Codes are shown only once.',
        )}
      />
      <InvitesSection />
      <ResetSection />
    </Stack>
  );
}
