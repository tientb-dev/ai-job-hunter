import { tr } from '../../app/i18n';
import { useEffect, useState } from 'react';
import { Alert, Link } from '@mui/material';
import { jobUrlInfo, opportunityRequest } from './opportunities-api';

interface DuplicateMatch {
  id: string;
  title: string;
  company: string;
}

export function DuplicateJobNotice({ url }: { url: string }) {
  const [result, setResult] = useState<{
    url: string;
    match?: DuplicateMatch | null;
    failed?: boolean;
  }>();
  useEffect(() => {
    if (!url || url.length > 2048 || !jobUrlInfo(url).valid) return;
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void opportunityRequest<{ match: DuplicateMatch | null }>(
        `/duplicate-url?url=${encodeURIComponent(url)}`,
        { signal: controller.signal },
      ).then(
        ({ match }) => {
          if (active) setResult({ url, match });
        },
        () => {
          if (active) setResult({ url, failed: true });
        },
      );
    }, 500);
    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [url]);

  if (result?.url !== url) return null;
  if (result.failed)
    return (
      <Alert severity="info">
        {tr(
          'Could not check for an existing job. You can continue; Save will still check for a duplicate URL.',
        )}
      </Alert>
    );
  if (!result.match) return null;
  return (
    <Alert severity="warning" sx={{ overflowWrap: 'anywhere' }}>
      {tr('This URL is already saved in Jobs')}
      {result.match.title || result.match.company
        ? `: ${[result.match.title, result.match.company].filter(Boolean).join(' · ')}`
        : ''}
      .{' '}
      <Link
        href={`/jobs/${encodeURIComponent(result.match.id)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        {tr('Open existing job')}
      </Link>{' '}
      {tr(
        'in a new tab to keep this draft. You can continue reviewing; Save still checks for duplicates.',
      )}
    </Alert>
  );
}
