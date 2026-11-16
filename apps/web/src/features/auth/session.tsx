import { useState } from 'react';
import { Button, IconButton } from '@mui/material';
import { LogoutIcon } from '../../components/icons';
import { useSession } from './session-context';
import { useI18n } from '../../app/i18n';

export function SignOutButton({ iconOnly = false }: { iconOnly?: boolean }) {
  const session = useSession();
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  if (!session) return null;
  const signOut = () => {
    setPending(true);
    void session.signOut();
  };
  return iconOnly ? (
    <IconButton
      aria-label={t('common.signOut')}
      title={t('common.signOut')}
      disabled={pending}
      onClick={signOut}
      sx={{ width: 44, height: 44 }}
    >
      <LogoutIcon sx={{ fontSize: 20 }} />
    </IconButton>
  ) : (
    <Button
      startIcon={<LogoutIcon />}
      disabled={pending}
      onClick={signOut}
      sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}
    >
      {t('common.signOut')}
    </Button>
  );
}
