import { Box, Link, Paper, Stack, Typography } from '@mui/material';
import type { DraftFact } from './tailored-cv.contract';
import {
  displayEntries,
  reflow,
  professionalProfileHref,
  promotedLinks,
  sectionTitle,
  sortSections,
  structuredRows,
  type Document,
  type Section,
} from './cv-layout';

// Text is rendered exactly as saved (including line breaks); this view only
// arranges included facts, it never rewrites them.
const text = {
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
} as const;

// Display text: reflowed; skills categories lose a trailing colon, as in export.
const display = (fact: DraftFact) =>
  fact.field === 'skill_category'
    ? reflow(fact.acceptedText).replace(/:\s*$/u, '')
    : reflow(fact.acceptedText);

function pick(facts: DraftFact[], field: string) {
  return facts.filter((fact) => fact.field === field);
}

function Lines({
  facts,
  variant = 'body1',
  color,
  weight,
}: {
  facts: DraftFact[];
  variant?: 'body1' | 'body2';
  color?: string;
  weight?: number;
}) {
  return facts.map((fact) => (
    <Typography
      key={fact.id}
      variant={variant}
      color={color}
      sx={{ ...text, fontWeight: weight }}
    >
      {display(fact)}
    </Typography>
  ));
}

function EntryView({ kind, facts }: { kind: string; facts: DraftFact[] }) {
  if (kind === 'contact') {
    const name = pick(facts, 'name');
    const headline = pick(facts, 'headline');
    const rest = facts.filter((f) => !['name', 'headline'].includes(f.field));
    return (
      <Box>
        {name.map((fact) => (
          <Typography
            key={fact.id}
            variant="h6"
            component="p"
            sx={{ ...text, fontWeight: 600 }}
          >
            {display(fact)}
          </Typography>
        ))}
        <Lines facts={headline} color="text.secondary" />
        {rest.map((fact) => {
          const href = professionalProfileHref(fact.acceptedText);
          return (
            <Typography key={fact.id} variant="body2" sx={text}>
              {href ? (
                <Link href={href} target="_blank" rel="noopener noreferrer">
                  {display(fact)}
                </Link>
              ) : (
                display(fact)
              )}
            </Typography>
          );
        })}
      </Box>
    );
  }
  if (kind === 'skills') {
    const category = pick(facts, 'skill_category');
    const values = facts.filter((f) => f.field !== 'skill_category');
    return (
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '180px minmax(0, 1fr)' },
          columnGap: 2,
        }}
      >
        <Box>
          <Lines facts={category} weight={600} />
        </Box>
        <Box>
          <Lines facts={values} />
        </Box>
      </Box>
    );
  }
  if (['experience', 'projects', 'education'].includes(kind)) {
    // Same rows as the PDF/DOCX export: a title with its date range, then text.
    return (
      <Stack spacing={0.5}>
        {structuredRows(kind, facts).map((row) =>
          row.style === 'anchor' ? (
            <Stack
              key={row.id}
              direction={{ xs: 'column', sm: 'row' }}
              spacing={{ xs: 0, sm: 2 }}
              sx={{ justifyContent: 'space-between', pt: 0.5 }}
            >
              <Typography sx={{ ...text, minWidth: 0, fontWeight: 600 }}>
                {row.text}
              </Typography>
              {row.aside && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ ...text, flexShrink: 0, textAlign: { sm: 'right' } }}
                >
                  {row.aside}
                </Typography>
              )}
            </Stack>
          ) : (
            <Typography
              key={row.id}
              variant={row.style === 'detail' ? 'body2' : 'body1'}
              color={row.style === 'detail' ? 'text.secondary' : undefined}
              sx={text}
            >
              {row.text}
            </Typography>
          ),
        )}
      </Stack>
    );
  }
  return (
    <Stack spacing={0.5}>
      <Lines facts={facts} />
    </Stack>
  );
}

/** Read-only rendering of one section's included content. */
export function CvSectionView({
  document,
  section,
}: {
  document: Document;
  section: Section;
}) {
  const entries = displayEntries(document, section);
  if (!entries.length)
    return section.kind === 'links' && promotedLinks(document).length ? (
      <Typography variant="body2" color="text.secondary">
        Profile links are shown in the contact header.
      </Typography>
    ) : null;
  return (
    <Stack spacing={section.kind === 'skills' ? 1 : 2}>
      {entries.map((entry) => (
        <EntryView key={entry.id} kind={section.kind} facts={entry.facts} />
      ))}
    </Stack>
  );
}

export function TailoredCvPreview({ document }: { document: Document }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={3}>
        {sortSections(document.sections).map((section) =>
          displayEntries(document, section).length ? (
            <Box key={section.id}>
              {section.kind !== 'contact' && (
                <Typography
                  variant="subtitle1"
                  component="h3"
                  sx={{
                    fontWeight: 600,
                    pb: 0.5,
                    mb: 1,
                    borderBottom: 1,
                    borderColor: 'divider',
                  }}
                >
                  {sectionTitle(section.kind)}
                </Typography>
              )}
              <CvSectionView document={document} section={section} />
            </Box>
          ) : null,
        )}
      </Stack>
    </Paper>
  );
}
