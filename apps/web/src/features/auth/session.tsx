import { useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from '@mui/material';
import { LogoutIcon } from '../../components/icons';
import { useSession } from './session-context';
import { useI18n } from '../../app/i18n';

/**
 * Signed-in account with a greeting and sign-out. Accounts only store an
 * email, so the email is the display name. `compact` (phones) collapses it
 * into an avatar button whose menu holds the details and sign-out.
 */
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const session = useSession();
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!session) return null;
  const name = session.user.email;
  const greeting = t('account.greeting', { name });
  const signOut = () => {
    setPending(true);
    void session.signOut();
  };
  if (!compact)
    return (
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', minWidth: 0 }}
      >
        <Typography
          variant="body2"
          title={name}
          sx={{
            maxWidth: 260,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {greeting}
        </Typography>
        <Button
          startIcon={<LogoutIcon />}
          disabled={pending}
          onClick={signOut}
          sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}
        >
          {t('common.signOut')}
        </Button>
      </Stack>
    );
  return (
    <>
      <IconButton
        aria-label={t('account.menu')}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{ width: 44, height: 44 }}
      >
        <Avatar sx={{ width: 30, height: 30, fontSize: '0.875rem' }}>
          {name.charAt(0).toUpperCase()}
        </Avatar>
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ px: 2, py: 1, maxWidth: 280 }}>
          <Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>
            {greeting}
          </Typography>
        </Box>
        <Divider />
        <MenuItem disabled={pending} onClick={signOut} sx={{ minHeight: 44 }}>
          <LogoutIcon sx={{ fontSize: 20, mr: 1.5 }} />
          {t('common.signOut')}
        </MenuItem>
      </Menu>
    </>
  );
}
