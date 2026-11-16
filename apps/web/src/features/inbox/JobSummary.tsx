import { tr } from '../../app/i18n';
import { useState } from 'react';
import { Box, Button, Link, Paper, Stack, Typography } from '@mui/material';
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
}: {
  form: OpportunityInput;
  platform?: string;
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

function Facts({ rows }: { rows: [string, string][] }) {
  if (!rows.length) return null;
  return (
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
      {rows.map(([label, value]) => (
        <Box key={label} sx={{ display: 'contents' }}>
          <Typography component="dt" variant="body2" color="text.secondary">
            {label}
          </Typography>
          <Typography
            component="dd"
            variant="body2"
            sx={{ m: 0, whiteSpace: 'pre-line' }}
          >
            {value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
const present = (rows: [string, string][]) =>
  rows.filter(([, value]) => value.trim());
function Empty({ children }: { children: string }) {
  return (
    <Typography variant="body2" color="text.secondary">
      {children}
    </Typography>
  );
}
function Items({ label, value }: { label: string; value: string }) {
  const items = requirementItems(value);
  if (!items.length) return null;
  return (
    <Box>
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
  );
}
function Description({ text }: { text: string }) {
  const [full, setFull] = useState(false);
  const long = text.length > 600 || text.split('\n').length > 8;
  return (
    <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
      <Typography
        variant="body2"
        sx={{
          whiteSpace: 'pre-line',
          ...(long && !full
            ? {
                display: '-webkit-box',
                WebkitLineClamp: 8,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }
            : {}),
        }}
      >
        {text}
      </Typography>
      {long && (
        <Button size="small" onClick={() => setFull((value) => !value)}>
          {full ? tr('Show less') : tr('Show full description')}
        </Button>
      )}
    </Stack>
  );
}
export type ReviewSection =
  'overview' | 'requirements' | 'description' | 'optional';
/** Read-only Review & Save content for one section; inputs live in the editor. */
export function SectionReadView({
  section,
  form,
  platform,
}: {
  section: ReviewSection;
  form: OpportunityInput;
  platform?: string;
}) {
  const link = /^https?:\/\/[^\s]+$/i.test(form.originalLink)
    ? form.originalLink
    : '';
  if (section === 'overview')
    return (
      <Stack spacing={1} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
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
        <Facts
          rows={present([
            [tr('Salary'), form.salary && displaySalary(form.salary)],
            [tr('Work mode'), form.workMode],
            [tr('Employment type'), form.employmentType],
            [tr('Seniority'), form.seniority],
          ])}
        />
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
    );
  if (section === 'requirements') {
    const any =
      form.experience || form.skills.trim() || form.preferredSkills.trim();
    return any ? (
      <Stack spacing={1.5} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        <Facts
          rows={present([
            [
              tr('Experience'),
              form.experience && displayExperience(form.experience),
            ],
          ])}
        />
        <Items label={tr('Required skills')} value={form.skills} />
        <Items label={tr('Preferred skills')} value={form.preferredSkills} />
      </Stack>
    ) : (
      <Empty>{tr('No requirements found. Use Edit to add them.')}</Empty>
    );
  }
  if (section === 'description')
    return form.description.trim() ? (
      <Description text={form.description} />
    ) : (
      <Empty>{tr('No job description yet. Use Edit to add it.')}</Empty>
    );
  const rows = present([
    [tr('Recruitment agency'), form.agency],
    [tr('Recruiter / contact notes'), form.contactNotes],
    [tr('Domain'), form.domain],
  ]);
  return rows.length ? (
    <Facts rows={rows} />
  ) : (
    <Empty>{tr('Nothing added.')}</Empty>
  );
}
