import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/600.css';
import { NotificationProvider } from './components/Notifications';
import { AiLimitNotices } from './features/ai/AiLimitNotices';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { CssBaseline } from '@mui/material';
import { AuthGate } from './features/auth/AuthGate';
import { LocalizedTheme } from './app/LocalizedTheme';

const router = createBrowserRouter([{ path: '*', element: <AuthGate /> }]);

const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing');

createRoot(root).render(
  <StrictMode>
    <LocalizedTheme>
      <CssBaseline />
      <NotificationProvider>
        <AiLimitNotices />
        <RouterProvider router={router} />
      </NotificationProvider>
    </LocalizedTheme>
  </StrictMode>,
);
