import { tr } from '../../app/i18n';
import { useState } from 'react';
import { FactReviewControls } from './FactReviewControls';
import type { UserFactReview } from './FactReviewControls';
import { Alert, Box, Chip, Stack, Typography } from '@mui/material';
import type {
  PartialDocument,
  PartialField,
  PartialFact,
} from './partial.types';
const labels: Record<PartialField, string> = {
  get name() {
    return tr('Name');
  },
  get email() {
    return tr('Email');
  },
  get phone() {
    return tr('Phone');
  },
  get skills() {
    return tr('Skills');
  },
  get title() {
    return tr('Job title');
  },
  get requirements() {
    return tr('Main skill requirements');
  },
};
const factKey = (field: PartialField, index: number, fact: PartialFact) =>
  JSON.stringify([field, index, fact]);
const factLabel = (kind: string, field: PartialField, index: number) =>
  `${kind.toUpperCase()} ${labels[field]}${field === 'skills' || field === 'requirements' ? ` occurrence ${index + 1}` : ''}`;
export function PartialFacts({ partial }: { partial: PartialDocument }) {
  const [reviews, setReviews] = useState<
    Record<string, readonly UserFactReview[]>
  >({});
  const fields = Object.entries(partial.fields) as [
    PartialField,
    readonly PartialFact[],
  ][];
  const accepted = fields.flatMap(([field, facts]) =>
    facts.flatMap((fact, index) => {
      const key = factKey(field, index, fact),
        review = reviews[key]?.at(-1);
      return review?.status === 'confirmed' || review?.status === 'edited'
        ? [{ key, label: factLabel(partial.kind, field, index), review }]
        : [];
    }),
  );
  return (
    <Stack spacing={2}>
      <Typography component="h3" variant="h6">
        {partial.kind.toUpperCase()} {tr('basic facts')}
      </Typography>
      <Typography>
        {tr(
          'AI VALID means exact source evidence was independently checked, not that you confirmed its meaning. AI NEEDS_REVIEW means evidence or attribution needs review. Only Confirm or Save adds a value to accepted user facts. No matching score is generated.',
        )}
      </Typography>
      <Alert severity="info">
        {tr(
          "Review changes stay only in this page's memory. Refresh, leaving the page, editing inputs, clearing or starting another analysis may lose them. No review action runs AI or saves data to the backend.",
        )}
      </Alert>
      {partial.generationError && (
        <Alert severity="warning">
          {partial.kind.toUpperCase()} {tr('AI extraction failed:')}{' '}
          {partial.generationError}
          {tr(
            '. Parsed source is retained. Review the source, check the AI service, then choose Analyze to retry manually. Parse without AI remains available.',
          )}
        </Alert>
      )}
      {fields.map(([field, facts]) => (
        <Box key={field}>
          <Typography component="h4" variant="subtitle1">
            {labels[field]}
          </Typography>
          <Box component="ul" sx={{ pl: 3 }}>
            {facts.map((fact, index) => (
              <li key={factKey(field, index, fact)}>
                <Stack spacing={1} sx={{ mb: 2 }}>
                  <Typography variant="caption">
                    {tr('Original AI proposal (preserved)')}
                  </Typography>
                  <Box>
                    <Chip
                      size="small"
                      label={fact.status}
                      color={
                        fact.status === 'VALID'
                          ? 'success'
                          : fact.status === 'NEEDS_REVIEW'
                            ? 'warning'
                            : 'default'
                      }
                    />{' '}
                    {fact.status === 'MISSING'
                      ? tr('No usable candidate.')
                      : (fact.value ?? tr('Candidate rejected.'))}
                  </Box>
                  {fact.status === 'NEEDS_REVIEW' && (
                    <Typography variant="body2">
                      {fact.reason === 'JD_TITLE_GENERIC_HEADING'
                        ? tr(
                            'This looks like a document heading, not a role title. Verify the actual job title in the source.',
                          )
                        : fact.reason === 'JD_TITLE_AMBIGUOUS'
                          ? tr(
                              'This title is a field label or includes a label. Verify the role title; the proposal has been kept unchanged.',
                            )
                          : tr(
                              'Unverified suggestion — {reason}. Review the original source; this is not a trusted fact.',
                              { reason: fact.reason },
                            )}
                    </Typography>
                  )}
                  {fact.evidence !== null && (
                    <Box>
                      {fact.status === 'NEEDS_REVIEW' && (
                        <Typography variant="body2">
                          {tr(
                            'Exact source evidence is retained below. The title interpretation is unverified.',
                          )}
                        </Typography>
                      )}
                      <Typography
                        component="blockquote"
                        sx={{
                          whiteSpace: 'pre-wrap',
                          overflowWrap: 'anywhere',
                          ml: 2,
                        }}
                      >
                        {fact.evidence.quote}
                      </Typography>
                      <Typography variant="caption">
                        {tr('Source:')} {fact.evidence.segmentId}
                        {tr(', UTF-16 [')}
                        {fact.evidence.start}, {fact.evidence.end})
                      </Typography>
                    </Box>
                  )}
                  {fact.status !== 'MISSING' && (
                    <FactReviewControls
                      original={fact}
                      label={factLabel(partial.kind, field, index)}
                      review={reviews[factKey(field, index, fact)]?.at(-1)}
                      canUndo={Boolean(
                        reviews[factKey(field, index, fact)]?.length,
                      )}
                      onReview={(review) => {
                        const key = factKey(field, index, fact);
                        setReviews((previous) => ({
                          ...previous,
                          [key]: [...(previous[key] ?? []), review],
                        }));
                      }}
                      onUndo={() => {
                        const key = factKey(field, index, fact);
                        setReviews((previous) => ({
                          ...previous,
                          [key]: (previous[key] ?? []).slice(0, -1),
                        }));
                      }}
                    />
                  )}
                </Stack>
              </li>
            ))}
          </Box>
        </Box>
      ))}
      <Box>
        <Typography component="h4" variant="h6">
          {tr('Accepted user facts (')}
          {accepted.length})
        </Typography>
        {accepted.length === 0 && (
          <Typography>
            {tr(
              'No user-confirmed facts yet. AI validation alone does not accept a fact.',
            )}
          </Typography>
        )}
        <Box
          component="ul"
          aria-label={tr('{v0} accepted user facts', {
            v0: partial.kind.toUpperCase(),
          })}
        >
          {accepted.map(({ key, label, review }) => (
            <li key={key}>
              <Typography
                sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
              >
                {label}: {review.value} —{' '}
                {review.status === 'edited'
                  ? tr('User edited')
                  : tr('User confirmed')}
              </Typography>
            </li>
          ))}
        </Box>
      </Box>
      {partial.rejectedProposals && partial.rejectedProposals.length > 0 && (
        <Alert severity="warning">
          <Typography>
            {tr('Some proposals were rejected before evidence validation:')}
          </Typography>
          <Box component="ul">
            {partial.rejectedProposals.map((item) => (
              <li key={item.index}>
                {tr('Proposal')} {item.index + 1}: {item.reason}
                {tr('. Untrusted; no fact was accepted from this proposal.')}
              </li>
            ))}
          </Box>
        </Alert>
      )}
      {partial.rejectedCandidateCount > 0 && (
        <Typography>
          {partial.rejectedCandidateCount}{' '}
          {tr(
            'candidate(s) require review or were rejected. No failed candidate is trusted.',
          )}
        </Typography>
      )}
    </Stack>
  );
}
