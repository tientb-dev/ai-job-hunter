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

// The action sentence is in the UI language; the JD wording it refers to is
// shown separately, verbatim, so sentences never mix languages.
function actionText(action: GuidanceAction): string {
  const capability = action.capability && CAPABILITY[action.capability];
  if (capability) return tr(capability);
  switch (action.code) {
    case 'STATE_DURATION':
      return tr(
        'If you have at least {v0} years of this experience, show the dates of the roles or projects where you did it.',
        { v0: String(action.years ?? '') },
      );
    case 'SHOW_IN_WORK':
      return tr(
        'Listed only as a skill. If you used it at work, describe how in that role.',
      );
    case 'REVIEW_REQUIREMENT':
      return tr(
        'This could not be interpreted reliably. Check it against your experience yourself.',
      );
    default:
      return tr(
        'If you have done this, add one concrete example to the role or project where you did it.',
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

function RequirementList({
  title,
  items,
}: {
  title: string;
  items: readonly string[];
}) {
  if (!items.length) return null;
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="subtitle2" component="h4">
        {title}
      </Typography>
      <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
        {items.map((item) => (
          <Typography
            key={item}
            component="li"
            variant="body2"
            sx={{ overflowWrap: 'anywhere' }}
          >
            {item}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}

/** Primary takeaway of the Match Summary. Advisory, never a hiring prediction. */
export function ApplicationGuidance({ result }: { result: MatchResult }) {
  const guidance = result.guidance;
  if (!guidance) return null;
  const { core, confidence, recommendation } = guidance;
  const low = confidence === 'LOW';
  return (
    <Box component="section" aria-label={tr('Application guidance')}>
      <Typography variant="overline" color="text.secondary" component="p">
        {tr('Application guidance')}
      </Typography>
      <Stack
        direction="row"
        spacing={1.5}
        useFlexGap
        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
      >
        <Typography
          id="application-guidance-title"
          variant="h5"
          component="h3"
          sx={{
            fontWeight: 600,
            color:
              COLOR[recommendation] === 'success'
                ? 'success.dark'
                : 'text.primary',
          }}
        >
          {guidanceLabel(recommendation)}
        </Typography>
        {low && (
          <Chip size="small" variant="outlined" label={tr('Low confidence')} />
        )}
      </Stack>
      <Typography variant="body2" sx={{ mt: 1 }}>
        {[
          low
            ? tr(
                'Only part of this JD could be interpreted, so this is a cautious read. Check the items marked Could not interpret requirement yourself.',
              )
            : tr('Your CV documents {v0} of {v1} core requirements.', {
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
      {(guidance.strengths.length > 0 || guidance.gaps.length > 0) && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'minmax(0, 1fr)',
              sm: 'repeat(2, minmax(0, 1fr))',
            },
            gap: 2,
            mt: 1.5,
          }}
        >
          <RequirementList
            title={tr('Documented in your CV')}
            items={guidance.strengths}
          />
          <RequirementList
            title={tr('Not yet shown in your CV')}
            items={guidance.gaps}
          />
        </Box>
      )}
      {guidance.actions.length > 0 && (
        <>
          <Typography variant="subtitle2" component="h4" sx={{ mt: 1.5 }}>
            {tr('Before you apply')}
          </Typography>
          <Box
            component="ol"
            aria-label={tr('Before you apply')}
            sx={{ m: 0, mt: 0.5, pl: 2.5 }}
          >
            {guidance.actions.map((action, index) => (
              <Box component="li" key={index} sx={{ mb: 0.75 }}>
                <Typography variant="body2">{actionText(action)}</Typography>
                {!(action.capability && CAPABILITY[action.capability]) && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    component="p"
                    sx={{ overflowWrap: 'anywhere' }}
                  >
                    {tr('JD: “{v0}”', { v0: action.label })}
                  </Typography>
                )}
              </Box>
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
