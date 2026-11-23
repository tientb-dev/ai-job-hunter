import { useId, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Divider,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import { Link } from 'react-router-dom';
import { AdminIcon, ExpandMoreIcon, LogoutIcon } from '../../components/icons';
import { useSession } from './session-context';
import { useI18n } from '../../app/i18n';

/**
 * Account trigger (avatar, name from the email prefix, chevron) opening a menu
 * with the full email, the admin role and links, and sign-out. Accounts only
 * store an email, so its prefix is the display name.
 */
export function AccountMenu() {
  const session = useSession();
  const { t } = useI18n();
  const menuId = useId();
  const [pending, setPending] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!session) return null;
  const { email, isAdmin } = session.user;
  const name = email.split('@')[0] || email;
  const close = () => setAnchor(null);
  const signOut = () => {
    setPending(true);
    close();
    void session.signOut();
  };
  return (
    <>
      <Button
        // Visible name included in the accessible name (label in name).
        aria-label={`${t('account.menu')}: ${name}`}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        aria-controls={anchor ? menuId : undefined}
        onClick={(event) => setAnchor(event.currentTarget)}
        endIcon={<ExpandMoreIcon />}
        sx={{ color: 'text.primary', minWidth: 0, px: 1, gap: 0.5 }}
      >
        <Avatar
          aria-hidden="true"
          sx={{ width: 28, height: 28, fontSize: '0.8125rem' }}
        >
          {name.charAt(0).toUpperCase()}
        </Avatar>
        <Box
          component="span"
          // Phones keep the header on one row: avatar and chevron only; the menu shows the email.
          sx={{
            display: { xs: 'none', sm: 'block' },
            maxWidth: 180,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </Box>
      </Button>
      <Menu
        id={menuId}
        anchorEl={anchor}
        open={!!anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ px: 2, py: 1, maxWidth: 280 }}>
          <Typography variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>
            {email}
          </Typography>
          {isAdmin && (
            <Typography variant="body2" color="text.secondary">
              {t('account.administrator')}
            </Typography>
          )}
        </Box>
        <Divider />
        {isAdmin && (
          <MenuItem
            component={Link}
            to="/admin"
            onClick={close}
            sx={{ minHeight: 44 }}
          >
            <AdminIcon sx={{ fontSize: 20, mr: 1.5 }} />
            {t('nav.admin')}
          </MenuItem>
        )}
        <MenuItem disabled={pending} onClick={signOut} sx={{ minHeight: 44 }}>
          <LogoutIcon sx={{ fontSize: 20, mr: 1.5 }} />
          {t('common.signOut')}
        </MenuItem>
      </Menu>
    </>
  );
}
