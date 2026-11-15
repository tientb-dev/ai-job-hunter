import { tr } from '../../app/i18n';
import { PartialFacts } from './PartialFacts';
import { useState } from 'react';
import { Alert, Box, Paper, Stack, Typography } from '@mui/material';
import type {
  AnalysisDocument,
  AnalysisResponse,
  Category,
} from './analysis.types';
import { RequirementCard } from './RequirementCard';
import {
  requirementFeedbackKeys,
  type RequirementFeedback,
} from './requirement-feedback';
const plainText = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as const;
const categoryNames: Record<Category, string> = {
  get technicalSkills() {
    return tr('Technical skills');
  },
  experience: 'Experience',
  architecture: 'Architecture',
  get engineeringPractices() {
    return tr('Engineering practices');
  },
  get domainKnowledge() {
    return tr('Domain knowledge');
  },
};
const score = (value: number | null) =>
  value === null ? tr('Not calculable') : tr('{value}%', { value: value });
function guidance(code: string): string {
  if (['ANALYSIS_BUSY', 'EXTRACTION_BUSY', 'PARSER_BUSY'].includes(code))
    return tr(
      'The local backend is busy, possibly finishing a cancelled request. Retry manually later.',
    );
  if (
    [
      'UPLOAD_TIMEOUT',
      'ANALYSIS_TIMEOUT',
      'TIMEOUT',
      'PARSING_TIMEOUT',
    ].includes(code)
  )
    return tr('The request timed out. Local work may still be finishing.');
  if (code === 'LOCAL_REQUEST_DENIED')
    return tr(
      'Open the dashboard at http://127.0.0.1:5173 to use the local API.',
    );
  if (
    [
      'ANALYSIS_UNAVAILABLE',
      'EXTRACTION_UNAVAILABLE',
      'PARSER_UNAVAILABLE',
      'CONNECTION_FAILURE',
      'CONTEXT_UNVERIFIED',
      'UPSTREAM_HTTP_FAILURE',
    ].includes(code)
  )
    return tr(
      'The local analysis service is unavailable. API readiness alone does not establish model availability.',
    );
  return tr(
    'The analysis could not complete. Review the input and retry only when ready.',
  );
}
export function AnalysisResult({ response }: { response: AnalysisResponse }) {
  return (
    <Stack spacing={3}>
      {response.documents &&
        (['cv', 'jd'] as const).map((kind) => (
          <DocumentSource
            key={`${response.requestId}:${kind}`}
            label={kind.toUpperCase()}
            document={response.documents![kind]}
          />
        ))}
      {response.outcome === 'COMPLETED' ? (
        <CompletedAnalysis key={response.requestId} response={response} />
      ) : (
        <IncompleteAnalysis response={response} />
      )}
    </Stack>
  );
}
function DocumentSource({
  label,
  document,
}: {
  label: string;
  document: AnalysisDocument | null;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography component="h2" variant="h6">
        {label} {tr('source')}
      </Typography>
      {!document ? (
        <Typography>
          {tr('Source unavailable. Review the file and parse again.')}
        </Typography>
      ) : (
        <Stack spacing={2}>
          <Typography sx={{ ...plainText, maxHeight: 400, overflow: 'auto' }}>
            {document.text}
          </Typography>
          {document.partial && (
            <PartialFacts
              key={JSON.stringify(document.partial)}
              partial={document.partial}
            />
          )}
          <Typography>
            {document.partial
              ? tr('Partial extraction only; matching is disabled.')
              : document.facts === null
                ? tr(
                    'Parsed source only. Facts are unverified; matching is disabled.',
                  )
                : tr(
                    'Evidence-validated facts. Completeness and semantic correctness still require review.',
                  )}
          </Typography>
          {document.facts !== null && (
            <Box component="ul">
              {document.facts.map((fact) => (
                <li key={fact.path}>
                  {fact.path}: {fact.value ?? tr('Not stated / review source')}
                </li>
              ))}
              {document.facts.length === 0 && (
                <li>{tr('No validated facts available.')}</li>
              )}
            </Box>
          )}
        </Stack>
      )}
    </Paper>
  );
}
function IncompleteAnalysis({
  response,
}: {
  response: Exclude<AnalysisResponse, { outcome: 'COMPLETED' }>;
}) {
  if (response.outcome === 'PARTIAL')
    return (
      <Alert severity="info">
        {tr(
          'Partial extraction finished. Review each field and its evidence above. Missing fields do not establish absence from the source. Matching is disabled.',
        )}
      </Alert>
    );
  if (response.outcome === 'PARSED')
    return (
      <Alert severity="info">
        {tr(
          'Parsed successfully without AI. No facts were validated and matching is disabled. Review the source above. Choose Analyze only when you are ready to run AI extraction.',
        )}
      </Alert>
    );
  if (response.outcome === 'INCOMPLETE')
    return (
      <Stack spacing={2}>
        <Alert severity="warning">
          <Typography component="h2" variant="h6">
            {tr('Analysis incomplete')}
          </Typography>
          {guidance(response.error.code)}
        </Alert>
        <Typography>
          {tr('Stage:')} {response.error.stage}
          {tr('. Error code:')} {response.error.code}.
        </Typography>
        <Typography>
          {tr(
            'Extraction can fail even when the document contains valid information.',
          )}
        </Typography>
        <Typography>
          {tr(
            'Matching is disabled. Review the retained source above, check local services, then choose Analyze to retry manually. Parse without AI lets you view source without running the model.',
          )}
        </Typography>
        <Box component="ul">
          {Object.entries(response.stages).map(([stage, status]) => (
            <li key={stage}>
              {stage}: {status}
            </li>
          ))}
        </Box>
        <Box component="details">
          <summary>{tr('Technical details')}</summary>
          <Typography>
            {tr('Request ID:')} {response.requestId}
          </Typography>
          {response.error.diagnostic && (
            <Typography>
              {response.error.diagnostic.stage} /{' '}
              {response.error.diagnostic.rule} /{' '}
              {response.error.diagnostic.field}
            </Typography>
          )}
        </Box>
      </Stack>
    );
  return null;
}

function CompletedAnalysis({
  response,
}: {
  response: Extract<AnalysisResponse, { outcome: 'COMPLETED' }>;
}) {
  const result = response.result;
  const feedbackKeys = requirementFeedbackKeys(result.requirements);
  const [feedback, setFeedback] = useState<
    Readonly<Record<string, RequirementFeedback>>
  >({});
  return (
    <Stack spacing={3}>
      <Box>
        <Typography component="h2" variant="h5">
          {tr('Documented requirement support')}
        </Typography>
        <Typography
          variant="h3"
          component="p"
          aria-label={tr('Overall documented requirement support')}
        >
          {score(result.overallScore)}
        </Typography>
      </Box>
      <Alert severity="warning">
        {tr(
          'Review required. This measures documented support, not candidate suitability. Missing evidence does not establish lack of ability. Extraction completeness and semantic correctness are not verified.',
        )}
      </Alert>
      <Alert severity="info">
        {tr(
          'Requirement feedback is local to this completed analysis. It is not submitted, saved, or used to improve the model automatically.',
        )}
      </Alert>
      {result.scoreExplanation !== null && (
        <Typography sx={plainText}>{result.scoreExplanation}</Typography>
      )}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
          gap: 2,
        }}
      >
        {result.categories.map((category) => (
          <Paper key={category.category} variant="outlined" sx={{ p: 2 }}>
            <Typography component="h3" variant="h6">
              {categoryNames[category.category]}
            </Typography>
            <Typography>{score(category.score)}</Typography>
            <Typography variant="body2">
              {tr('Eligible:')} {category.eligibleRequirementCount}
              {tr('; excluded:')} {category.excludedRequirementCount}
              {tr('; missing evidence:')} {category.missingEvidenceCount}
            </Typography>
            <Box component="details">
              <summary>{tr('Supplied score weights')}</summary>
              <Typography>
                {tr('Configured weight:')} {category.configuredWeight}
                {tr('; effective weight:')} {category.effectiveWeight}
                {tr('; earned weight:')} {category.earnedWeight}
                {tr('; denominator weight:')} {category.denominatorWeight}
              </Typography>
            </Box>
          </Paper>
        ))}
      </Box>
      <Box>
        <Typography component="h3" variant="h6">
          {tr('Coverage')}
        </Typography>
        <Typography>
          {tr('Input requirements:')} {result.coverage.inputRequirementCount}
          {tr('; canonical requirements:')}{' '}
          {result.coverage.canonicalRequirementCount}
        </Typography>
        <Typography>
          {tr('Evaluable:')} {result.coverage.evaluableRequirementCount}
          {tr('; excluded:')} {result.coverage.excludedRequirementCount}
          {tr('; unclassified:')} {result.coverage.unclassifiedRequirementCount}
        </Typography>
        <Typography>
          {tr('Active category weight:')} {result.coverage.activeCategoryWeight}{' '}
          {tr('/ 100; JD evaluability ratio:')}{' '}
          {result.coverage.jdEvaluabilityRatio ?? tr('Not calculable')}
        </Typography>
      </Box>
      <Box>
        <Typography component="h3" variant="h6">
          {tr('Warnings and uncertainty')}
        </Typography>
        {result.extractionWarnings.map(({ document, warning }, index) => (
          <Typography key={index}>
            {document.toUpperCase()}: {warning.code}
            {warning.code === 'PAGE_WITHOUT_TEXT'
              ? tr(' (page {page})', { page: warning.page })
              : ''}
          </Typography>
        ))}
        {result.extractionWarnings.length === 0 && (
          <Typography>
            {tr(
              'No extraction warning codes returned. This does not establish semantic correctness.',
            )}
          </Typography>
        )}
        <Typography sx={plainText}>
          {result.uncertainty.join(', ') ||
            tr('No additional uncertainty codes returned.')}
        </Typography>
      </Box>
      <Typography component="h3" variant="h6">
        {tr('Requirements')}
      </Typography>
      {result.requirements.length === 0 && (
        <Typography>
          {tr(
            'No requirements were returned; there is no requirement-level result to display.',
          )}
        </Typography>
      )}
      {result.requirements.map((item, index) => (
        <RequirementCard
          key={feedbackKeys[index]}
          item={item}
          position={index + 1}
          feedback={feedback[feedbackKeys[index]!] ?? null}
          onFeedbackChange={(value) => {
            const key = feedbackKeys[index]!;
            setFeedback((current) => {
              const next = { ...current };
              if (value === null) delete next[key];
              else next[key] = value;
              return next;
            });
          }}
        />
      ))}
      <Typography variant="caption">
        {tr('Contract:')} {response.contractVersion}
        {tr('; matching contract:')} {result.contractVersion}
        {tr('; policy:')} {result.policyVersion}
        {tr('; request ID:')} {response.requestId}
      </Typography>
    </Stack>
  );
}
