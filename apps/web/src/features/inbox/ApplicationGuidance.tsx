import { Box, Chip, Stack, Typography } from '@mui/material';
import { tr } from '../../app/i18n';
import {
  guidanceLabel,
  type GuidanceAction,
  type MatchResult,
} from './cv-match.types';

const COLOR = {
  WORTH_APPLYING: 'success',
  CONSIDER_CAREFULLY: 'default',
  STRETCH_OPPORTUNITY: 'default',
} as const;
const CAPABILITY: Record<string, string> = {
  'sql-writing':
    'If you have written SQL queries in production, add a specific example to the relevant project.',
  'data-analysis':
    'If you have analyzed data in your work, describe what you analyzed and the result.',
  'business-logic':
    'If you implemented business logic, describe one concrete example in the relevant role.',
  'source-control':
    'If you have used Git or another version-control tool for branching or code reviews, clarify that experience in your CV.',
  oop: 'If you applied OOP principles in a project, describe a concrete example.',
  'java-core':
    'If you have core Java experience, name it in the role where you used it.',
  'maintain-debug-enhance':
    'If you maintained, debugged or enhanced existing applications, add a concrete example.',
};

function actionText(action: GuidanceAction): string {
  const capability = action.capability && CAPABILITY[action.capability];
  if (capability) return tr(capability);
  switch (action.code) {
    case 'STATE_DURATION':
      return tr(
        'If you have {v1}+ years with “{v0}”, state the duration or dates in your CV.',
        { v0: action.label, v1: String(action.years ?? '') },
      );
    case 'SHOW_IN_WORK':
      return tr(
        '“{v0}” appears only in a list. If you used it in a role, describe how.',
        { v0: action.label },
      );
    case 'REVIEW_REQUIREMENT':
      return tr(
        'Check “{v0}” yourself — it could not be interpreted reliably.',
        { v0: action.label },
      );
    default:
      return tr(
        'If you have experience with “{v0}”, add a concrete example to the relevant role.',
        { v0: action.label },
      );
  }
}

const CLOSING = {
  WORTH_APPLYING:
    'Some requirements are not shown in your CV yet — that does not mean you lack them.',
  CONSIDER_CAREFULLY: 'Important requirements are not yet shown in your CV.',
  STRETCH_OPPORTUNITY:
    'Many core requirements are not shown in your CV. Apply if you have this experience and can describe it.',
} as const;

/** Primary takeaway of the Match Summary. Advisory, never a hiring prediction. */
export function ApplicationGuidance({ result }: { result: MatchResult }) {
  const guidance = result.guidance;
  if (!guidance) return null;
  const { core, confidence, recommendation } = guidance;
  const low = confidence === 'LOW';
  return (
    <Box component="section" aria-labelledby="application-guidance-title">
      <Stack
        direction="row"
        spacing={1.5}
        useFlexGap
        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
      >
        <Typography
          id="application-guidance-title"
          variant="subtitle1"
          component="h3"
          sx={{ fontWeight: 600 }}
        >
          {tr('Application guidance')}
        </Typography>
        <Chip
          size="small"
          color={COLOR[recommendation]}
          label={guidanceLabel(recommendation)}
        />
        {low && (
          <Chip size="small" variant="outlined" label={tr('Low confidence')} />
        )}
      </Stack>
      <Typography variant="body2" sx={{ mt: 1 }}>
        {low
          ? tr(
              'Only part of this JD could be interpreted, so this is a cautious read. Check the items marked Could not interpret requirement yourself.',
            )
          : [
              tr('Your CV documents {v0} of {v1} core requirements.', {
                v0: String(core.withEvidence),
                v1: String(core.evaluated),
              }),
              core.withEvidence
                ? guidance.demonstratedWork
                  ? tr('Relevant experience appears in your work history.')
                  : tr(
                      'This evidence comes mainly from skills lists, not described work.',
                    )
                : '',
              tr(CLOSING[recommendation]),
            ]
              .filter(Boolean)
              .join(' ')}
      </Typography>
      {guidance.actions.length > 0 && (
        <>
          <Typography variant="subtitle2" component="h4" sx={{ mt: 1.5 }}>
            {tr('Before you apply')}
          </Typography>
          <Box component="ol" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
            {guidance.actions.map((action, index) => (
              <Typography
                key={index}
                component="li"
                variant="body2"
                sx={{ mb: 0.5 }}
              >
                {actionText(action)}
              </Typography>
            ))}
          </Box>
        </>
      )}
      <Typography variant="caption" color="text.secondary" component="p">
        {tr(
          'Advisory only, not a hiring prediction. Add only experience you actually have.',
        )}
      </Typography>
    </Box>
  );
}
