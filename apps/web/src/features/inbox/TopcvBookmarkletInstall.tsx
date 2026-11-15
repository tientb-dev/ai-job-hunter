import { tr } from '../../app/i18n';
import { useEffect, useRef } from 'react';
import { Box, Stack, TextField, Typography } from '@mui/material';
import { bookmarkletUrl, isLocalImportOrigin } from './topcv-bookmarklet';
export function TopcvBookmarkletInstall() {
  const link = useRef<HTMLAnchorElement>(null);
  const code = isLocalImportOrigin(window.location.origin)
    ? bookmarkletUrl(window.location.origin)
    : '';
  useEffect(() => {
    // Locally generated javascript bookmark URLs are installed explicitly;
    // never use page-provided code or change the secure transfer protocol.
    if (code) link.current?.setAttribute('href', code);
  }, [code]);
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2">
        {tr(
          'Drag this link to your bookmarks bar. Open a TopCV or VietnamWorks job page and click the bookmark while this local app is running.',
        )}
      </Typography>
      {code ? (
        <>
          <a
            ref={link}
            href="#topcv-bookmark-install"
            draggable
            onClick={(event) => event.preventDefault()}
          >
            {tr('Import to AI Job Hunter')}
          </a>
          <Box component="details">
            <summary>{tr('Manual bookmark installation')}</summary>
            <TextField
              label={tr('Bookmark URL (installation fallback)')}
              value={code}
              multiline
              maxRows={3}
              fullWidth
              slotProps={{ input: { readOnly: true } }}
              helperText={tr(
                'Create a bookmark and paste this code into its URL/address field.',
              )}
            />
            <Typography variant="body2">
              {tr(
                'Browser popup, CSP or opener policies may prevent transfer. Manual paste remains available; do not bypass login, CAPTCHA or site restrictions.',
              )}
            </Typography>
          </Box>
        </>
      ) : (
        <Typography variant="body2">
          {tr('Open http://127.0.0.1:5173/jobs/new to install the bookmark.')}
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary">
        {tr(
          'Import only content you have appropriate rights to store. Only job fields are transferred, without cookies or credentials. Review before saving; AI runs only when you click Extract.',
        )}
      </Typography>
    </Stack>
  );
}
