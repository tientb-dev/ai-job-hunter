import { Box, Chip, Stack, Typography } from '@mui/material';
import { tr } from '../../app/i18n';
import {
  type ApplicationGuidance as ApplicationGuidanceData,
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

/** Primary takeaway of the Match Summary. Advisory, never a hiring prediction. */
export function GuidanceVerdict({ result }: { result: MatchResult }) {
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
    </Box>
  );
}

// Identical instructions (after whitespace/case normalization) share one item
// and keep every JD reference; first-seen order is preserved.
function groupActions(actions: readonly GuidanceAction[]) {
  const groups = new Map<string, { text: string; labels: string[] }>();
  for (const action of actions) {
    const text = actionText(action);
    const key = text.replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
    const group = groups.get(key) ?? { text, labels: [] };
    // Capability sentences already name the skill; no JD quote shown, as before.
    if (!(action.capability && CAPABILITY[action.capability]))
      group.labels.push(action.label);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Up to three API-ranked actions; never padded with invented ones. */
export function GuidanceActions({
  guidance,
}: {
  guidance: ApplicationGuidanceData;
}) {
  if (!guidance.actions.length) return null;
  return (
    <Box component="section" aria-label={tr('Before you apply')}>
      <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
        {tr('Before you apply')}
      </Typography>
      <Box
        component="ol"
        aria-label={tr('Before you apply')}
        sx={{ m: 0, mt: 0.5, pl: 2.5 }}
      >
        {groupActions(guidance.actions).map(({ text, labels }) => (
          <Box component="li" key={text} sx={{ mb: 0.75 }}>
            <Typography variant="body2">{text}</Typography>
            {labels.map((label, index) => (
              <Typography
                key={index}
                variant="caption"
                color="text.secondary"
                component="p"
                sx={{ overflowWrap: 'anywhere' }}
              >
                {tr('JD: “{v0}”', { v0: label })}
              </Typography>
            ))}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
