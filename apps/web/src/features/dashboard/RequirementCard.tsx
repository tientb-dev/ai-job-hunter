import { tr } from '../../app/i18n';
import {
  Box,
  Chip,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useId } from 'react';
import type { RequirementResult } from './analysis.types';
import type { RequirementFeedback } from './requirement-feedback';

const plainText = {
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
} as const;
export function RequirementCard({
  item,
  position,
  feedback,
  onFeedbackChange,
}: {
  item: RequirementResult;
  position: number;
  feedback: RequirementFeedback | null;
  onFeedbackChange: (value: RequirementFeedback | null) => void;
}) {
  const feedbackLabelId = useId();

  return (
    <Paper component="article" variant="outlined" sx={{ p: 2, minWidth: 0 }}>
      <Stack spacing={1}>
        <Typography component="h3" variant="h6" sx={plainText}>
          {item.originalTexts.join('\n')}
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Chip label={item.status} size="small" />
          <Chip label={item.evaluability} size="small" />
          <Chip
            label={
              item.includedInScore
                ? tr('Included in score')
                : tr('Excluded from score')
            }
            size="small"
          />
        </Stack>
        <Typography>
          {tr('Priority:')} {item.priority}
        </Typography>
        {item.status === 'MISSING_EVIDENCE' && (
          <Typography>
            {item.evaluability === 'EVALUABLE'
              ? tr('No usable supporting evidence found.')
              : tr('This requirement could not be evaluated.')}{' '}
            {tr('This does not establish that the candidate lacks the skill.')}
          </Typography>
        )}
        <Typography sx={plainText}>{item.explanation.text}</Typography>
        {item.uncertainty.length > 0 && (
          <Typography sx={plainText}>
            {tr('Uncertainty:')} {item.uncertainty.join(', ')}
          </Typography>
        )}
        <Box>
          <Typography id={feedbackLabelId} variant="body2" sx={{ mb: 1 }}>
            {tr('Feedback for requirement')} {position}
          </Typography>
          <ToggleButtonGroup
            aria-labelledby={feedbackLabelId}
            exclusive
            size="small"
            value={feedback}
            onChange={(_event, value: RequirementFeedback | null) => {
              onFeedbackChange(value);
            }}
          >
            <ToggleButton value="CORRECT">{tr('Correct')}</ToggleButton>
            <ToggleButton value="INCORRECT">{tr('Incorrect')}</ToggleButton>
            <ToggleButton value="UNSURE">{tr('Unsure')}</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        <Box component="details">
          <Box component="summary" sx={{ cursor: 'pointer' }}>
            {tr('Evidence (')}
            {item.evidence.length}
            {tr(') and matching details')}
          </Box>
          {item.evidence.length === 0 && (
            <Typography>
              {tr('No evidence links returned for this requirement.')}
            </Typography>
          )}
          {item.evidence.map((link, index) => (
            <Box key={index} sx={{ my: 2 }}>
              <Typography>
                {link.document.toUpperCase()} {tr('evidence —')} {link.role}
              </Typography>
              <Box
                component="blockquote"
                sx={{
                  ...plainText,
                  m: 0,
                  pl: 2,
                  borderLeft: 2,
                  borderColor: 'divider',
                }}
              >
                {link.reference.quote}
              </Box>
              <Typography variant="caption" sx={plainText}>
                {tr('Segment:')} {link.reference.segmentId}
                {tr('; UTF-16 offsets:')} {link.reference.start}–
                {link.reference.end}
                {tr('; field:')} {link.factPath}
              </Typography>
            </Box>
          ))}
          <Typography sx={plainText}>
            {tr('Requirement ID:')} {item.id || tr('Not supplied')}
            {tr('; JD indexes:')} {item.jdRequirementIndexes.join(', ')}
            {tr('; category:')} {item.category ?? tr('Unclassified')}
            {tr('; canonical term:')}{' '}
            {item.canonicalTerm ?? tr('Not available')}
          </Typography>
          <Typography>
            {tr('Predicate:')} {item.predicate}
            {tr('; minimum months:')} {item.minimumMonths ?? tr('Not stated')}
            {tr('; observed months:')} {item.observedMonths ?? tr('Unknown')}
          </Typography>
          <Typography>
            {tr('Importance weight:')} {item.importanceWeight}
            {tr('; credit:')} {item.credit ?? tr('Not calculable')}
          </Typography>
          <Typography sx={plainText}>
            {tr('Rules:')} {item.ruleIds.join(', ') || tr('None')}
            {tr('; explanation code:')} {item.explanation.code}
          </Typography>
          {Object.entries(item.explanation.params).map(([key, value]) => (
            <Typography key={key} sx={plainText}>
              {key}: {value}
            </Typography>
          ))}
        </Box>
      </Stack>
    </Paper>
  );
}
