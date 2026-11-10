import { createContext, useContext, type KeyboardEvent } from 'react';
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

// The CV page owns its presentation, independent of the app theme, so future
// CV templates can replace it without touching workspace styles.
const cvPaper = {
  p: { xs: 2, sm: 4 },
  bgcolor: '#fffdf8',
  color: '#1d1b17',
  fontFamily: '"Source Serif 4", Georgia, serif',
  fontSize: '0.9375rem',
  lineHeight: 1.55,
  '& .MuiTypography-root': { fontFamily: 'inherit' },
} as const;

export type FactAnchorState = 'pending' | 'decided' | 'excluded' | 'conflict';
/** Optional review overlay: facts with a suggestion become selectable anchors. */
export interface FactAnchors {
  states: Record<string, FactAnchorState>;
  activeId: string | null;
  onSelect: (factId: string) => void;
}
const visuallyHidden = {
  // Pixel strings: in sx a bare 1 means 100%.
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: 0,
  border: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;
const AnchorContext = createContext<FactAnchors | null>(null);
const anchorLabel: Record<FactAnchorState, string> = {
  pending: 'suggestion to review',
  decided: 'suggestion decided',
  excluded: 'excluded from download',
  conflict: 'needs your check',
};
// Distinct line styles so state never relies on color alone.
const anchorStyle: Record<FactAnchorState, object> = {
  pending: { textDecorationStyle: 'dashed', textDecorationColor: '#a35f00' },
  conflict: { textDecorationStyle: 'wavy', textDecorationColor: '#c2372e' },
  decided: { textDecorationStyle: 'solid', textDecorationColor: '#1f7a45' },
  excluded: { textDecorationLine: 'line-through', opacity: 0.6 },
};
function useAnchor(id: string) {
  const anchors = useContext(AnchorContext);
  const state = anchors?.states[id];
  if (!anchors || !state) return { props: {}, sx: {}, label: null };
  const active = anchors.activeId === id;
  return {
    props: {
      'data-fact-id': id,
      role: 'button',
      tabIndex: 0,
      'aria-pressed': active,
      onClick: () => anchors.onSelect(id),
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          anchors.onSelect(id);
        }
      },
    },
    sx: {
      cursor: 'pointer',
      borderRadius: '2px',
      textDecorationLine: 'underline',
      textDecorationThickness: '2px',
      textUnderlineOffset: '3px',
      scrollMarginTop: 96,
      ...anchorStyle[state],
      ...(active && {
        bgcolor: 'rgba(47, 91, 211, 0.10)',
        boxShadow: 'inset 3px 0 0 #2f5bd3',
      }),
      '&:focus-visible': { outline: '2px solid #2f5bd3', outlineOffset: 2 },
    },
    label: (
      <Box component="span" sx={visuallyHidden}>
        {` (${anchorLabel[state]})`}
      </Box>
    ),
  };
}
function FactText({
  id,
  children,
  sx,
  ...props
}: {
  id: string;
  children: React.ReactNode;
  sx?: object;
  component?: React.ElementType;
} & Omit<React.ComponentProps<typeof Typography>, 'id' | 'sx'>) {
  const anchor = useAnchor(id);
  return (
    <Typography {...props} {...anchor.props} sx={{ ...sx, ...anchor.sx }}>
      {children}
      {anchor.label}
    </Typography>
  );
}

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
    <FactText
      key={fact.id}
      id={fact.id}
      variant={variant}
      color={color}
      sx={{ ...text, fontWeight: weight }}
    >
      {display(fact)}
    </FactText>
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
          <FactText
            key={fact.id}
            id={fact.id}
            variant="h6"
            component="p"
            sx={{ ...text, fontWeight: 600 }}
          >
            {display(fact)}
          </FactText>
        ))}
        <Lines facts={headline} color="text.secondary" />
        {rest.map((fact) => {
          const href = professionalProfileHref(fact.acceptedText);
          return (
            <FactText key={fact.id} id={fact.id} variant="body2" sx={text}>
              {href ? (
                <Link href={href} target="_blank" rel="noopener noreferrer">
                  {display(fact)}
                </Link>
              ) : (
                display(fact)
              )}
            </FactText>
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
              <FactText
                id={row.id}
                sx={{ ...text, minWidth: 0, fontWeight: 600 }}
              >
                {row.text}
              </FactText>
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
            <FactText
              key={row.id}
              id={row.id}
              variant={row.style === 'detail' ? 'body2' : 'body1'}
              color={row.style === 'detail' ? 'text.secondary' : undefined}
              sx={text}
            >
              {row.text}
            </FactText>
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

export function TailoredCvPreview({
  document,
  anchors = null,
}: {
  document: Document;
  anchors?: FactAnchors | null;
}) {
  return (
    <AnchorContext.Provider value={anchors}>
      <Paper variant="outlined" sx={cvPaper}>
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
    </AnchorContext.Provider>
  );
}
