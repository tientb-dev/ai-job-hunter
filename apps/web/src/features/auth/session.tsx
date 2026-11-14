import { useState } from 'react';
import { Button } from '@mui/material';
import { LogoutIcon } from '../../components/icons';
import { useSession } from './session-context';

export function SignOutButton() {
  const session = useSession();
  const [pending, setPending] = useState(false);
  if (!session) return null;
  return (
    <Button
      startIcon={<LogoutIcon />}
      disabled={pending}
      onClick={() => {
        setPending(true);
        void session.signOut();
      }}
      sx={{ justifyContent: 'flex-start', color: 'text.secondary' }}
    >
      Đăng xuất
    </Button>
  );
}
