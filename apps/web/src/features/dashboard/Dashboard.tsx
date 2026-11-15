import { tr } from '../../app/i18n';
import { PageHeader } from '../../components/PageHeader';
import { useEffect, useRef } from 'react';
import {
  Alert,
  Box,
  CircularProgress,
  Link as MuiLink,
  Stack,
  Typography,
} from '@mui/material';
import { Link } from 'react-router-dom';
import { AnalysisForm } from './AnalysisForm';
import { AnalysisResult } from './AnalysisResult';
import { useAnalysis } from './useAnalysis';
export function Dashboard() {
  const { state, start, cancel, reset } = useAnalysis();
  const statusPanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (
      ['completed', 'incomplete', 'clientError', 'cancelled'].includes(
        state.status,
      )
    )
      statusPanel.current?.focus();
  }, [state.status]);
  return (
    <Stack spacing={3}>
      <MuiLink
        component={Link}
        to="/cv"
        variant="body2"
        sx={{ alignSelf: 'flex-start' }}
      >
        {tr('Back to My CV')}
      </MuiLink>
      <PageHeader
        title={tr('Quick CV and job analysis')}
        description={tr(
          'A one-off check of a CV against a job description. Nothing here changes your saved CV or jobs.',
        )}
      />
      <Box role="region" aria-label={tr('CV/JD analysis')}>
        <Typography color="text.secondary">
          {tr(
            'Files parse locally and extraction uses the configured AI provider; inputs and results stay in memory until cleared or you leave this page. API readiness does not guarantee AI service availability or extraction quality. Quote ambiguity, negation, uncertainty, source-instruction contamination and sensitivity to evidence annotations remain known limitations.',
          )}
        </Typography>
        <AnalysisForm
          busy={state.status === 'processing'}
          onStart={(file, text, parseOnly) => {
            void start(file, text, parseOnly);
          }}
          onEdit={reset}
          onCancel={cancel}
          onClear={reset}
        />
        <Box ref={statusPanel} tabIndex={-1} sx={{ outlineOffset: 4 }}>
          <Box role="status" aria-live="polite">
            {state.status === 'idle' && (
              <Typography>
                {tr(
                  'Choose a CV and enter a JD to start. No analysis results yet.',
                )}
              </Typography>
            )}
            {state.status === 'processing' && (
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <CircularProgress
                  size={24}
                  aria-label={tr('Analysis in progress')}
                />
                <Typography>
                  {tr(
                    'Processing locally… This can take several minutes. Cancel stops waiting, but may not immediately stop local extraction.',
                  )}
                </Typography>
              </Stack>
            )}
            {state.status === 'completed' && (
              <Typography>
                {tr(
                  'Analysis completed. Review the evidence and limitations below.',
                )}
              </Typography>
            )}
            {state.status === 'cancelled' && (
              <Typography>
                {tr(
                  'Stopped waiting for this analysis. Local extraction may still be finishing; another request may temporarily return busy. Your inputs were retained.',
                )}
              </Typography>
            )}
          </Box>
          {state.status === 'clientError' && (
            <Alert severity="error">
              {state.kind === 'network'
                ? tr(
                    'Could not reach the local analysis API. Check the local services and retry manually.',
                  )
                : tr(
                    'The API returned an invalid or incompatible analysis response. No result can be displayed.',
                  )}
            </Alert>
          )}
          {(state.status === 'completed' || state.status === 'incomplete') && (
            <AnalysisResult response={state.response} />
          )}
        </Box>
      </Box>
    </Stack>
  );
}
