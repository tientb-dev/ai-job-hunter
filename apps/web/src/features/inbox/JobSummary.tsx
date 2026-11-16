import { tr } from '../../app/i18n';
import { Box, Link, Paper, Stack, Typography } from '@mui/material';
import type { OpportunityInput } from './opportunities-api';
import {
  displayExperience,
  displaySalary,
  requirementItems,
} from './job-display';

/** Read-only overview of the imported job; editing happens in the fields below. */
export function JobSummary({
  form,
  platform,
  showRequirements = false,
}: {
  form: OpportunityInput;
  platform?: string;
  showRequirements?: boolean;
}) {
  const facts = [
    [tr('Salary'), form.salary && displaySalary(form.salary)],
    [tr('Experience'), form.experience && displayExperience(form.experience)],
    [tr('Work mode'), form.workMode],
    [tr('Employment type'), form.employmentType],
    [tr('Seniority'), form.seniority],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  // Only a plain http(s) link is clickable; anything else is never an href.
  const link = /^https?:\/\/[^\s]+$/i.test(form.originalLink)
    ? form.originalLink
    : '';
  const required = requirementItems(form.skills);
  const preferred = requirementItems(form.preferredSkills);
  return (
    <Paper
      variant="outlined"
      component="section"
      aria-label={tr('Job summary')}
      sx={{ p: 2, minWidth: 0, overflowWrap: 'anywhere' }}
    >
      <Stack spacing={1.5}>
        <Box>
          <Typography
            variant="subtitle1"
            component="p"
            sx={{ fontWeight: 600 }}
          >
            {form.title || tr('Untitled job')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {[form.company, form.location].filter(Boolean).join(' · ') ||
              tr('Company and location not found')}
          </Typography>
        </Box>
        {facts.length > 0 && (
          <Box
            component="dl"
            sx={{
              m: 0,
              display: 'grid',
              gridTemplateColumns: 'max-content minmax(0, 1fr)',
              columnGap: 2,
              rowGap: 0.5,
            }}
          >
            {facts.map(([label, value]) => (
              <Box key={label} sx={{ display: 'contents' }}>
                <Typography
                  component="dt"
                  variant="body2"
                  color="text.secondary"
                >
                  {label}
                </Typography>
                <Typography component="dd" variant="body2" sx={{ m: 0 }}>
                  {value}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
        {showRequirements &&
          (
            [
              [tr('Required skills'), required],
              [tr('Preferred skills'), preferred],
            ] as const
          ).map(
            ([label, items]) =>
              items.length > 0 && (
                <Box key={label}>
                  <Typography variant="subtitle2" component="h4">
                    {label}
                  </Typography>
                  <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                    {items.map((item, index) => (
                      <Typography component="li" variant="body2" key={index}>
                        {item}
                      </Typography>
                    ))}
                  </Box>
                </Box>
              ),
          )}
        {(platform || link) && (
          <Typography variant="caption" color="text.secondary">
            {tr('Source')}: {platform ?? ''}
            {link && (
              <>
                {platform ? ' · ' : ''}
                <Link href={link} target="_blank" rel="noopener noreferrer">
                  {tr('Open original posting')}
                </Link>
              </>
            )}
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}
