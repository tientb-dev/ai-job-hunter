import { CheckIcon, SaveIcon } from '../../components/icons';
import { DialogCloseButton } from '../../components/DialogCloseButton';
import { useNotify } from '../../components/useNotify';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Checkbox,
  FormControlLabel,
  Box,
  Button,
  Chip,
  Divider,
  MenuItem,
  Skeleton,
  Stack,
  TextField,
  Typography,
  Paper,
  LinearProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  cvSectionKinds,
  cvFactFields,
  decodeCvProfile,
  decodeCvSource,
  pruneEmployerLinks,
  sharedEmployer,
  sourceCvRequest,
  splitDates,
  type CvFact,
  type CvProfile,
  type CvProfileDocument,
  type CvSectionKind,
  type CvSource,
} from './source-cv-review.contract';

export function SourceCvReview({
  cv,
  disabled,
  onDirtyChange,
  onBusyChange,
  onContinue,
  onSaved,
  wizardEntry = false,
  entryState,
  myCv = false,
}: {
  wizardEntry?: boolean;
  /** My CV: review progress is still loading, or failed so the entry point is unknown. */
  entryState?: 'loading' | 'unknown';
  /** Shared My CV page: shorter intro, safeguard shown once the review opens. */
  myCv?: boolean;
  cv: { fileName: string; updatedAt: string } | null;
  disabled: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  onContinue?: () => void;
  onSaved?: () => void;
}) {
  const [source, setSource] = useState<CvSource | null>(null);
  const [profile, setProfile] = useState<CvProfile | null>(null);
  const [document, setDocument] = useState<CvProfileDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Transient completion messages are toasts; persistent workflow states
  // (approval, readiness, blockers) stay inline below.
  const notify = useNotify();
  const setMessage = (
    text: string,
    severity: 'success' | 'info' = 'success',
  ) => {
    if (text) notify({ severity, text });
  };
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [rebuildOpen, setRebuildOpen] = useState(false);
  const [previous, setPrevious] = useState<CvProfile | null>(null);
  const [completeAttempted, setCompleteAttempted] = useState(false);
  const [reuseOffer, setReuseOffer] = useState<{
    source: CvSource;
    profileRevisionId: string;
    savedAt: string;
    checkedSections: number;
    totalSections: number;
  } | null>(null);
  const [targetRecord, setTargetRecord] = useState('');
  const [fieldSelection, setFieldSelection] = useState({
    key: '',
    field: 'source_passage',
  });
  const [confirmedProfileKey, setConfirmedProfileKey] = useState('');
  const [newField, setNewField] = useState('text');
  const [focusField, setFocusField] = useState<{ id: string } | null>(null);
  useEffect(() => {
    if (focusField) {
      window.document.getElementById(`source-field-${focusField.id}`)?.focus();
    }
  }, [focusField]);
  const [targetKind, setTargetKind] = useState<CvSectionKind>('additional');
  const [newValue, setNewValue] = useState('');
  const epoch = useRef(0);
  const documentDirty =
    !!document &&
    !!profile &&
    JSON.stringify(document) !== JSON.stringify(profile.document);
  const dirty = documentDirty || Boolean(newValue || reason);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );
  async function run(action: () => Promise<void>) {
    const request = ++epoch.current;
    setBusy(true);
    onBusyChange(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (failure) {
      if (request === epoch.current)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Source review failed. Your inputs are retained.',
        );
    } finally {
      if (request === epoch.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }
  function accept(value: unknown, pinned: CvSource) {
    const next = decodeCvProfile(value, pinned);
    setSource(pinned);
    setProfile(next);
    setDocument(structuredClone(next.document));
    setEditing(null);
    setPrevious(null);
    onSaved?.();
  }
  async function openReview() {
    if (!cv) return;
    const request = epoch.current;
    const captured = await sourceCvRequest('/sources', {
      expectedSavedCvUpdatedAt: cv.updatedAt,
    });
    if (
      !captured ||
      typeof captured !== 'object' ||
      !('id' in captured) ||
      typeof captured.id !== 'string' ||
      !/^[0-9a-f-]{36}$/iu.test(captured.id)
    )
      throw new Error('Invalid captured source identity. Retry.');
    const pinned = decodeCvSource(
      await sourceCvRequest(`/sources/${captured.id}/content`),
    );
    const existing = await sourceCvRequest(`/sources/${pinned.id}/profile`);
    if (!existing) {
      // The same CV text was reviewed under an earlier upload: offer to
      // continue that review instead of silently starting an empty one.
      const offer = await sourceCvRequest(
        `/sources/${pinned.id}/reusable-review`,
      );
      if (
        offer &&
        typeof offer === 'object' &&
        'profileRevisionId' in offer &&
        typeof offer.profileRevisionId === 'string' &&
        /^[0-9a-f-]{36}$/iu.test(offer.profileRevisionId)
      ) {
        const o = offer as Record<string, unknown>;
        if (request === epoch.current)
          setReuseOffer({
            source: pinned,
            profileRevisionId: offer.profileRevisionId,
            savedAt: typeof o.savedAt === 'string' ? o.savedAt : '',
            checkedSections: Number(o.checkedSections) || 0,
            totalSections: Number(o.totalSections) || 0,
          });
        return;
      }
    }
    const next = existing ?? (await createProfile(pinned, null));
    if (request === epoch.current) accept(next, pinned);
  }
  async function createProfile(pinned: CvSource, reuseId: string | null) {
    return sourceCvRequest('/profiles', {
      sourceRevisionId: pinned.id,
      expectedSavedCvUpdatedAt: pinned.savedCvUpdatedAt,
      ...(reuseId ? { reuseProfileRevisionId: reuseId } : {}),
    });
  }
  function startReview(reuseId: string | null) {
    const offer = reuseOffer;
    if (!offer) return;
    void run(async () => {
      const token = epoch.current;
      const next = await createProfile(offer.source, reuseId);
      if (token !== epoch.current) return;
      setReuseOffer(null);
      accept(next, offer.source);
      setMessage(
        reuseId
          ? 'Your earlier review was carried over. Checked details stay checked.'
          : 'A fresh review was started. Your earlier review is unchanged.',
      );
    });
  }
  function change(edit: (next: CvProfileDocument) => void) {
    if (!document) return;
    const next = structuredClone(document);
    edit(next);
    pruneEmployerLinks(next);
    setDocument(next);
    setMessage('');
  }
  function editFact(
    sectionId: string,
    entryId: string,
    id: string,
    value: string,
    // Optional extra change applied in the same update (e.g. a split field).
    alsoInEntry?: (
      entry: CvProfileDocument['sections'][number]['entries'][number],
    ) => void,
  ) {
    change((next) => {
      const section = next.sections.find((s) => s.id === sectionId)!;
      const entry = section.entries.find((e) => e.id === entryId)!;
      const fact = entry.facts.find((f) => f.id === id)!;
      if (fact.origin === 'source') {
        let replacement = entry.facts.find((f) => f.replacesFactId === id);
        if (value === fact.value) {
          entry.facts = entry.facts.filter((f) => f.replacesFactId !== id);
        } else {
          if (!replacement) {
            replacement = {
              id: crypto.randomUUID(),
              field: fact.field,
              value,
              origin: 'user_entered',
              review: 'pending',
              evidence: [],
              replacesFactId: id,
            };
            entry.facts.push(replacement);
          }
          replacement.value = value;
          replacement.review = 'pending';
        }
      } else {
        fact.value = value;
        fact.review = 'pending';
      }
      if (fact.review !== 'needs_clarification') fact.review = 'pending';
      alsoInEntry?.(entry);
      section.review = 'pending';
    });
  }
  function addFact(
    next: CvProfileDocument,
    fact: CvFact,
    kind = targetKind,
    record = targetRecord,
  ) {
    let section =
      next.sections.find(
        (s) => s.kind === kind && s.entries.some((e) => e.id === record),
      ) ?? next.sections.find((s) => s.kind === kind);
    if (!section) {
      section = {
        id: crypto.randomUUID(),
        kind,
        review: 'pending',
        entries: [],
      };
      next.sections.push(section);
    }
    const entry = section.entries.find((e) => e.id === record);
    if (entry) entry.facts.push(fact);
    else section.entries.push({ id: crypto.randomUUID(), facts: [fact] });
    section.review = 'pending';
  }
  const unresolved =
    document?.coverage.filter((row) => row.disposition === 'unresolved') ?? [];
  const contactFragments = unresolved.filter((row) =>
    /^(?:Possible LinkedIn profile reference|PDF icon or separator artifact|Unrecognized contact fragment|Contact text contains an unreadable character)/u.test(
      row.reason ?? '',
    ),
  );
  const separatorFragments = contactFragments.filter(
    (row) =>
      row.reason?.startsWith('PDF icon or separator artifact') ||
      /^[\uFFFD\u25A1\u25AF\u25A0\uE000-\uF8FF\u2709]\uFE0F?$/u.test(
        source?.text.slice(row.start, row.end).trim() ?? '',
      ),
  );
  const first = unresolved[0];
  const contactKey = `${source?.id}:${first?.start}`;
  const retainedField =
    fieldSelection.key === contactKey ? fieldSelection.field : 'source_passage';
  const linkedinConfirmed = confirmedProfileKey === contactKey;
  let selectedEnd = first ? Math.min(first.end, first.start + 4000) : 0;
  const finalUnit = source?.text.charCodeAt(selectedEnd - 1) ?? 0;
  if (
    source &&
    selectedEnd < source.text.length &&
    finalUnit >= 0xd800 &&
    finalUnit <= 0xdbff
  )
    selectedEnd--;

  const selectedText =
    first && source ? source.text.slice(first.start, selectedEnd) : '';
  const possibleProfile =
    /^(?:Possible LinkedIn profile reference|Unrecognized contact fragment)/u.test(
      first?.reason ?? '',
    ) &&
    /^[a-z0-9]+(?:-[a-z0-9]+){1,8}$/u.test(selectedText.trim()) &&
    selectedText.trim().length <= 100;
  const blocked = disabled || busy;
  const blank =
    document?.sections.some((s) =>
      s.entries.some((e) => e.facts.some((f) => !f.value.trim())),
    ) ?? false;
  const legacy = Boolean(
    document?.sections.length && document.reconstruction?.version !== '3',
  );
  const reviewed =
    document?.sections.filter((s) => s.review === 'confirmed').length ?? 0;
  const needs = (fact: CvFact) =>
    fact.review === 'needs_clarification' ||
    (fact.origin === 'user_entered' && fact.review !== 'confirmed');
  const issuesFor = (facts: CvFact[]) =>
    facts.filter(
      (f) =>
        !f.replacesFactId &&
        (needs(f) ||
          facts.some(
            (replacement) =>
              replacement.replacesFactId === f.id && needs(replacement),
          )),
    );
  const attention =
    document?.sections.flatMap((s) =>
      s.entries.flatMap((e) => issuesFor(e.facts)),
    ).length ?? 0;
  const focusById = (id: string) =>
    requestAnimationFrame(() => {
      const el = window.document.getElementById(id);
      el?.scrollIntoView?.({ block: 'center' });
      el?.focus({ preventScroll: true });
    });
  const blockers: { key: string; label: string; go?: () => void }[] =
    !document || legacy
      ? []
      : [
          ...document.sections.flatMap((section) => {
            const items = section.entries.flatMap((e) => issuesFor(e.facts));
            if (items.length)
              return items.map((fact) => ({
                key: fact.id,
                label: `Check ${fieldTitle(fact.field)} in ${sectionTitles[section.kind]}`,
                go: () => {
                  setEditing(section.id);
                  setFocusField({ id: fact.id });
                },
              }));
            return section.review === 'confirmed'
              ? []
              : [
                  {
                    key: `section-${section.id}`,
                    label: `Mark ${sectionTitles[section.kind]} as checked`,
                    go: () => focusById(`source-section-${section.id}`),
                  },
                ];
          }),
          ...(unresolved.length
            ? [
                {
                  key: 'unassigned',
                  label: `Assign or exclude ${unresolved.length} unassigned passage${unresolved.length === 1 ? '' : 's'}`,
                  go: () => {
                    setIssuesOpen(true);
                    focusById('unassigned-source-content');
                  },
                },
              ]
            : []),
          ...(blank
            ? [{ key: 'blank', label: 'Fill in or remove empty details' }]
            : []),
          ...(newValue || reason
            ? [
                {
                  key: 'adding',
                  label: 'Finish or clear the content you are adding',
                },
              ]
            : []),
        ];
  const visibleFacts = (facts: CvFact[]) =>
    facts
      .filter((f) => f.field !== 'heading' && !f.replacesFactId)
      .map((original) => ({
        original,
        shown: facts.find((f) => f.replacesFactId === original.id) ?? original,
      }));
  function confirm(sectionId: string, id: string) {
    change((next) => {
      const section = next.sections.find((s) => s.id === sectionId)!;
      for (const entry of section.entries) {
        const fact = entry.facts.find((f) => f.id === id);
        if (fact) {
          fact.review = 'confirmed';
          const user = entry.facts.find((f) => f.replacesFactId === id);
          if (user) user.review = 'confirmed';
        }
      }
      section.review = 'pending';
    });
  }
  return (
    <Stack
      component="section"
      spacing={2}
      sx={{
        mt: onContinue ? 3 : 0,
        minWidth: 0,
        overflowWrap: 'anywhere',
        '& .MuiButton-root': { minHeight: 44 },
      }}
      aria-labelledby="source-cv-review-title"
    >
      {onContinue && <Divider />}
      <Typography
        id="source-cv-review-title"
        tabIndex={-1}
        variant="h6"
        component="h2"
      >
        Source CV review
      </Typography>
      <Typography>
        {legacy
          ? 'Organize your saved CV first. Then check highlighted details and mark each section as checked.'
          : !myCv
            ? 'Check that your CV is organized correctly and mark each section as checked. Save draft keeps unfinished work; Complete review saves and continues to your tailored CV.'
            : 'Check and correct your CV details before using them to tailor applications. Your review is shared across jobs.'}
      </Typography>
      {/* My CV keeps this safeguard inside the opened review; the job flow always shows it. */}
      {(!myCv || profile) && (
        <Typography variant="body2" color="text.secondary">
          Confirmation records your review, not independent verification.
          Original text and evidence are kept when you make corrections.
        </Typography>
      )}
      {!profile && reuseOffer && (
        <Alert severity="info" aria-label="Earlier review found">
          <Stack spacing={1.5}>
            <Typography sx={{ fontWeight: 600 }}>
              You already reviewed this exact CV
            </Typography>
            <Typography variant="body2">
              Saved{' '}
              {reuseOffer.savedAt
                ? new Date(reuseOffer.savedAt).toLocaleString()
                : 'earlier'}{' '}
              · {reuseOffer.checkedSections} of {reuseOffer.totalSections}{' '}
              sections checked. The text is identical, so your checks and
              corrections can carry over.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button
                variant="contained"
                disabled={blocked}
                onClick={() => startReview(reuseOffer.profileRevisionId)}
              >
                Continue earlier review
              </Button>
              <Button
                variant="outlined"
                disabled={blocked}
                onClick={() => startReview(null)}
              >
                Start a fresh review
              </Button>
            </Stack>
          </Stack>
        </Alert>
      )}
      {!profile && !reuseOffer && entryState === 'loading' && (
        // Same footprint as the action, so it appears without moving anything.
        <Skeleton
          variant="rounded"
          height={44}
          aria-hidden="true"
          sx={{ width: { xs: '100%', sm: 180 } }}
        />
      )}
      {!profile && !reuseOffer && entryState === 'unknown' && (
        <Button
          variant="outlined"
          sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
          disabled={blocked || !cv}
          onClick={() => void run(openReview)}
        >
          Open review
        </Button>
      )}
      {!profile && !reuseOffer && !entryState && (
        <Button
          variant={wizardEntry ? 'contained' : 'outlined'}
          sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
          disabled={blocked || !cv}
          onClick={() => void run(openReview)}
        >
          {myCv && !wizardEntry ? 'View / Edit review' : 'Review source CV'}
        </Button>
      )}
      {!cv && (
        <Typography>Save a source CV to begin reviewing its facts.</Typography>
      )}
      {disabled && (
        <Typography role="status">
          Save or discard your job changes to enable CV review actions.
        </Typography>
      )}
      {busy && (
        <Typography role="status">
          {legacy
            ? 'Organizing your CV in small steps. Your previous work is safe…'
            : 'Preparing source review…'}
        </Typography>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {profile && source && document && (
        <>
          <Typography variant="body2">
            Source: {source.fileName} · Profile revision {profile.revision}
          </Typography>
          {!legacy && (
            <>
              <LinearProgress
                variant="determinate"
                value={
                  document.sections.length
                    ? (100 * reviewed) / document.sections.length
                    : 0
                }
                aria-label="Source review progress"
              />
              <Typography role="status">
                {reviewed} of {document.sections.length} sections reviewed ·{' '}
                {attention} details need attention · {unresolved.length}{' '}
                unassigned passages{dirty ? ' · Unsaved review changes' : ''}
              </Typography>
            </>
          )}
          {cv?.updatedAt !== source.savedCvUpdatedAt && (
            <Alert severity="warning">
              The current CV changed. This review still uses its captured
              source. Save or discard edits before reopening the current CV.
            </Alert>
          )}
          {!legacy && contactFragments.length > 0 && (
            <Alert severity="warning" variant="outlined">
              <Typography>
                Some contact text needs review. Recognized details are kept
                separate from unreadable symbols and unassigned text.
              </Typography>
              {contactFragments.map((row) => (
                <Typography
                  component="blockquote"
                  key={row.start}
                  sx={{ whiteSpace: 'pre-wrap', m: 1 }}
                >
                  {source.text.slice(row.start, row.end)}
                </Typography>
              ))}
              {!!separatorFragments.length && (
                <Typography variant="body2">
                  Icon-only fragments, including email icons, can be excluded
                  separately from their contact values.
                </Typography>
              )}
              {!!separatorFragments.length && (
                <Button
                  disabled={blocked}
                  onClick={() =>
                    change((next) => {
                      for (const row of next.coverage)
                        if (
                          row.disposition === 'unresolved' &&
                          separatorFragments.some(
                            (fragment) => fragment.start === row.start,
                          )
                        ) {
                          row.disposition = 'excluded';
                          row.reason =
                            'User reviewed and excluded PDF icon/separator artifacts; no contact information inferred.';
                        }
                    })
                  }
                >
                  Exclude reviewed separator symbols
                </Button>
              )}
              <Button
                disabled={blocked}
                onClick={() => {
                  setIssuesOpen(true);
                  requestAnimationFrame(() =>
                    window.document
                      .getElementById('unassigned-source-content')
                      ?.focus(),
                  );
                }}
              >
                Review unassigned contact text
              </Button>
            </Alert>
          )}
          {legacy && (
            <Alert severity="info">
              Choose Organize my CV to group your work history and contact
              details. This creates a new review to check and confirm. Your
              previous reviews, corrections and tailored CVs are preserved.
              Editing and confirmation become available after organizing
              succeeds.
            </Alert>
          )}
          {!document.sections.length ? (
            <Button
              variant="contained"
              disabled={
                blocked || dirty || cv?.updatedAt !== source.savedCvUpdatedAt
              }
              onClick={() =>
                void run(async () => {
                  const token = epoch.current;
                  const value = await sourceCvRequest(
                    `/profiles/${profile.profileId}/proposal`,
                    {
                      expectedRevision: profile.revision,
                      expectedSavedCvUpdatedAt: source.savedCvUpdatedAt,
                    },
                  );
                  if (token === epoch.current) {
                    accept(value, source);
                    setMessage(
                      'Your organized CV is ready to review. Start with highlighted details, then confirm each section.',
                    );
                  }
                })
              }
            >
              Organize my CV
            </Button>
          ) : (
            <Box>
              <Button
                variant={legacy ? 'contained' : 'outlined'}
                disabled={
                  blocked || dirty || cv?.updatedAt !== source.savedCvUpdatedAt
                }
                onClick={() => setRebuildOpen(true)}
              >
                {legacy ? 'Organize my CV' : 'Reorganize from source'}
              </Button>
            </Box>
          )}
          {legacy && (error || cv?.updatedAt !== source.savedCvUpdatedAt) && (
            <Button disabled={blocked} onClick={() => void run(openReview)}>
              Reload saved review
            </Button>
          )}
          <Dialog
            open={rebuildOpen}
            onClose={() => !busy && setRebuildOpen(false)}
            aria-labelledby="rebuild-source-title"
          >
            <DialogCloseButton
              disabled={busy}
              onClick={() => setRebuildOpen(false)}
            />
            <DialogTitle id="rebuild-source-title" sx={{ pr: 7 }}>
              Organize your CV?
            </DialogTitle>
            <DialogContent>
              <Typography>
                Your saved CV text will be organized into a new review. Previous
                reviews, corrections and tailored CVs remain unchanged. Check
                highlighted details and confirm the new sections before
                continuing.
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button
                autoFocus
                disabled={busy}
                onClick={() => setRebuildOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="contained"
                disabled={busy}
                onClick={() => {
                  setRebuildOpen(false);
                  void run(async () => {
                    const token = epoch.current;
                    const value = await sourceCvRequest(
                      `/profiles/${profile.profileId}/rebuild`,
                      {
                        expectedRevision: profile.revision,
                        expectedSavedCvUpdatedAt: source.savedCvUpdatedAt,
                      },
                    );
                    if (token === epoch.current) {
                      accept(value, source);
                      setMessage(
                        'Your CV is organized. Review highlighted details, confirm each section, then save. Earlier reviews and corrections are preserved.',
                      );
                    }
                  });
                }}
              >
                Organize as new review
              </Button>
            </DialogActions>
          </Dialog>
          {legacy && (
            <Box component="details">
              <Typography component="summary">
                View previous saved review
              </Typography>
              {document.sections.map((section) => (
                <Box key={section.id} sx={{ my: 2 }}>
                  <Typography component="h3">
                    {sectionTitles[section.kind]}
                  </Typography>
                  {section.entries.flatMap((entry) =>
                    visibleFacts(entry.facts).map(({ shown }) => (
                      <Typography
                        key={shown.id}
                        sx={{ whiteSpace: 'pre-wrap' }}
                      >
                        {shown.value}
                      </Typography>
                    )),
                  )}
                </Box>
              ))}
            </Box>
          )}
          {!legacy && (
            <>
              {document.sections.map((section) => {
                const issues = section.entries.flatMap((e) =>
                  issuesFor(e.facts),
                );
                const canConfirm =
                  !legacy &&
                  !blocked &&
                  !section.entries.some((entry) =>
                    entry.facts.some((fact) => !fact.value.trim()),
                  ) &&
                  !issues.length &&
                  section.review !== 'confirmed';
                return (
                  <Paper
                    component="section"
                    id={`source-section-${section.id}`}
                    tabIndex={-1}
                    aria-label={`${sectionTitles[section.kind]} section`}
                    key={section.id}
                    variant="outlined"
                    sx={{ p: { xs: 2, sm: 3 }, minWidth: 0 }}
                  >
                    <Stack spacing={2}>
                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={1}
                        sx={{
                          justifyContent: 'space-between',
                          alignItems: { sm: 'center' },
                        }}
                      >
                        <Typography
                          variant="subtitle1"
                          component="h3"
                          sx={{ fontWeight: 600 }}
                        >
                          {sectionTitles[section.kind]}
                        </Typography>
                        <Chip
                          variant="outlined"
                          size="small"
                          label={
                            section.review === 'confirmed'
                              ? 'Reviewed'
                              : issues.length
                                ? `${issues.length} details to check`
                                : 'Ready to review'
                          }
                        />
                      </Stack>
                      {section.entries.map((entry, index) => {
                        const fields = visibleFacts(entry.facts);
                        if (!fields.length) return null;
                        const value = (field: string) => {
                          const fact = fields.find(
                            (f) => f.shown.field === field,
                          )?.shown;
                          return fact ? displayText(fact) : undefined;
                        };
                        const shared = sharedEmployer(section, entry);
                        const titleField = (
                          {
                            experience: 'employer',
                            projects: 'project',
                            education: 'institution',
                            skills: 'skill_category',
                            certifications: 'certification',
                          } as Partial<Record<CvSectionKind, string>>
                        )[section.kind];
                        const title =
                          section.kind === 'experience'
                            ? (value('employer') ??
                              (shared
                                ? `Employer: ${displayText(
                                    section.entries
                                      .flatMap((e) => e.facts)
                                      .find(
                                        (f) => f.replacesFactId === shared.id,
                                      ) ?? shared,
                                  ).trim()} (shared)`
                                : 'Check employer attribution'))
                            : section.kind === 'projects'
                              ? (value('project') ?? 'Project')
                              : section.kind === 'education'
                                ? (value('institution') ?? 'Education record')
                                : section.kind === 'skills'
                                  ? (value('skill_category')?.replace(
                                      /:\s*$/u,
                                      '',
                                    ) ?? 'Skills')
                                  : section.kind === 'certifications'
                                    ? (value('certification') ??
                                      'Certification')
                                    : null;
                        return (
                          <Stack
                            key={entry.id}
                            spacing={1}
                            component="article"
                            aria-label={
                              title ??
                              `${sectionTitles[section.kind]} details ${index + 1}`
                            }
                            sx={{
                              borderTop: index ? '1px solid' : 'none',
                              borderColor: 'divider',
                              pt: index ? 2 : 0,
                            }}
                          >
                            {title && (
                              <Typography
                                component="h4"
                                variant="subtitle2"
                                sx={{ fontWeight: 600 }}
                              >
                                {title}
                              </Typography>
                            )}
                            {!legacy &&
                              section.kind === 'education' &&
                              fields
                                .filter(
                                  ({ original, shown }) =>
                                    shown === original &&
                                    original.field === 'institution' &&
                                    splitDates(original.value),
                                )
                                .map(({ original }) => {
                                  const split = splitDates(original.value)!;
                                  return (
                                    <Alert
                                      key={`split-${original.id}`}
                                      severity="info"
                                      variant="outlined"
                                    >
                                      <Typography variant="body2">
                                        This line also contains dates (
                                        {split.dates}). You can keep it as is or
                                        split it. Your original text is kept
                                        either way.
                                      </Typography>
                                      <Button
                                        size="small"
                                        sx={{ mt: 1 }}
                                        disabled={blocked}
                                        onClick={() => {
                                          editFact(
                                            section.id,
                                            entry.id,
                                            original.id,
                                            split.name,
                                            // Dates go right after the institution, as in the source.
                                            (target) =>
                                              target.facts.splice(
                                                target.facts.findIndex(
                                                  (f) => f.id === original.id,
                                                ) + 1,
                                                0,
                                                {
                                                  id: crypto.randomUUID(),
                                                  field: 'dates',
                                                  value: split.dates,
                                                  origin: 'user_entered',
                                                  review: 'pending',
                                                  evidence: [],
                                                },
                                              ),
                                          );
                                        }}
                                      >
                                        Split into institution and dates
                                      </Button>
                                    </Alert>
                                  );
                                })}
                            {!legacy &&
                              fields.some(
                                ({ original, shown }) =>
                                  needs(original) || needs(shown),
                              ) && (
                                <Alert severity="warning" variant="outlined">
                                  Check{' '}
                                  {fields
                                    .filter(
                                      ({ original, shown }) =>
                                        needs(original) || needs(shown),
                                    )
                                    .map(({ shown }) => fieldTitle(shown.field))
                                    .join(', ')}{' '}
                                  before confirming this section.
                                </Alert>
                              )}
                            {editing === section.id && !legacy
                              ? fields.map(({ original, shown }) => (
                                  <Stack key={original.id} spacing={1}>
                                    <TextField
                                      id={`source-field-${original.id}`}
                                      label={fieldTitle(shown.field)}
                                      value={shown.value}
                                      multiline
                                      fullWidth
                                      disabled={blocked}
                                      error={!shown.value.trim()}
                                      onChange={(event) =>
                                        editFact(
                                          section.id,
                                          entry.id,
                                          original.id,
                                          event.target.value,
                                        )
                                      }
                                      helperText={
                                        needs(original)
                                          ? 'Check this detail and its attribution against the source, then confirm it.'
                                          : shown.origin === 'user_entered'
                                            ? 'Your correction; it does not become original-source evidence.'
                                            : undefined
                                      }
                                      slotProps={{
                                        htmlInput: { maxLength: 4000 },
                                      }}
                                    />
                                    {(needs(original) || needs(shown)) && (
                                      <Button
                                        variant="outlined"
                                        disabled={
                                          blocked || !shown.value.trim()
                                        }
                                        onClick={() =>
                                          confirm(section.id, original.id)
                                        }
                                      >
                                        Confirm {fieldTitle(shown.field)}
                                      </Button>
                                    )}
                                  </Stack>
                                ))
                              : fields
                                  .filter(
                                    ({ shown }) =>
                                      !(title && shown.field === titleField),
                                  )
                                  .map(({ original, shown }) => (
                                    <Box key={original.id}>
                                      <Typography
                                        sx={{
                                          fontWeight: [
                                            'name',
                                            'headline',
                                            'role',
                                            'qualification',
                                            'project',
                                          ].includes(shown.field)
                                            ? 600
                                            : 400,
                                          whiteSpace:
                                            section.kind === 'summary'
                                              ? 'normal'
                                              : 'pre-line',
                                        }}
                                      >
                                        {displayText(shown)}
                                      </Typography>
                                      {needs(original) && (
                                        <Typography
                                          variant="body2"
                                          color="text.secondary"
                                        >
                                          Needs your review:{' '}
                                          {fieldTitle(shown.field)}
                                        </Typography>
                                      )}
                                      {shown.origin === 'user_entered' && (
                                        <Typography
                                          variant="body2"
                                          color="text.secondary"
                                        >
                                          Your correction — separate from
                                          original wording
                                        </Typography>
                                      )}
                                    </Box>
                                  ))}
                            <Box component="details">
                              <Typography component="summary" variant="body2">
                                View source evidence
                                {title ? ` for ${title}` : ''}
                              </Typography>
                              <Stack spacing={1} sx={{ mt: 1 }}>
                                {entry.facts
                                  .filter((f) => f.origin === 'source')
                                  .flatMap((f) => f.evidence)
                                  .map((ref, i) => (
                                    <Box key={i}>
                                      <Typography variant="caption">
                                        Original text · offsets {ref.start}–
                                        {ref.end}
                                      </Typography>
                                      <Typography
                                        component="blockquote"
                                        sx={{
                                          m: 0,
                                          p: 1,
                                          bgcolor: 'action.hover',
                                          whiteSpace: 'pre-wrap',
                                        }}
                                      >
                                        {ref.quote}
                                      </Typography>
                                    </Box>
                                  ))}
                              </Stack>
                            </Box>
                            {editing === section.id && !legacy && (
                              <RecordAdjustments
                                sectionId={section.id}
                                entryId={entry.id}
                                document={document}
                                blocked={blocked}
                                change={change}
                              />
                            )}
                          </Stack>
                        );
                      })}
                      {(issues.length > 0 ||
                        section.review === 'confirmed') && (
                        <Typography variant="body2" color="text.secondary">
                          {issues.length
                            ? 'Review and confirm the highlighted details to enable section confirmation. Editing is available below.'
                            : 'This section is confirmed. Edit it if you need to make a correction.'}
                        </Typography>
                      )}
                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={1}
                      >
                        {section.review !== 'confirmed' && (
                          <Button
                            variant="outlined"
                            disabled={!canConfirm}
                            aria-label={`Mark ${sectionTitles[section.kind]} section as checked`}
                            onClick={() =>
                              change((next) => {
                                next.sections.find(
                                  (s) => s.id === section.id,
                                )!.review = 'confirmed';
                              })
                            }
                          >
                            Mark section as checked
                          </Button>
                        )}
                        <Button
                          disabled={blocked || legacy}
                          onClick={() =>
                            setEditing(
                              editing === section.id ? null : section.id,
                            )
                          }
                        >
                          {editing === section.id ? 'Finish editing' : 'Edit'}{' '}
                          {sectionTitles[section.kind]}
                        </Button>
                        {!!issues.length && (
                          <Button
                            disabled={blocked || legacy}
                            onClick={() => {
                              setEditing(section.id);
                              setFocusField({
                                id: issues[0]!.replacesFactId ?? issues[0]!.id,
                              });
                            }}
                          >
                            Review issues in {sectionTitles[section.kind]}
                          </Button>
                        )}
                      </Stack>
                    </Stack>
                  </Paper>
                );
              })}
              <Box>
                <Typography
                  id="unassigned-source-content"
                  tabIndex={-1}
                  component="h3"
                  variant="subtitle1"
                >
                  Unassigned source content
                </Typography>
                {first ? (
                  <Stack spacing={1}>
                    <Typography>
                      {unresolved.length} passages still need a decision.
                      Nothing has been dropped.
                    </Typography>
                    <Button
                      variant="outlined"
                      disabled={blocked || legacy}
                      onClick={() => setIssuesOpen(!issuesOpen)}
                    >
                      {issuesOpen
                        ? 'Hide unassigned content'
                        : 'Review unassigned content'}
                    </Button>
                    {issuesOpen && (
                      <>
                        <Typography
                          component="blockquote"
                          sx={{
                            m: 0,
                            p: 1.5,
                            bgcolor: 'action.hover',
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          {selectedText.trim()
                            ? selectedText
                            : '(Whitespace separator)'}
                        </Typography>
                        <Typography variant="body2">
                          {first.reason ??
                            'Choose where this content belongs, or explicitly exclude it.'}
                        </Typography>
                        {possibleProfile && (
                          <Stack spacing={1}>
                            <Typography variant="body2">
                              Possible LinkedIn profile reference. Keep the
                              original text using the Link detail type, or
                              confirm the platform to create a URL. The URL will
                              be user-entered wording, not a verified PDF link.
                            </Typography>
                            <FormControlLabel
                              control={
                                <Checkbox
                                  checked={linkedinConfirmed}
                                  disabled={blocked}
                                  onChange={(event) =>
                                    setConfirmedProfileKey(
                                      event.target.checked ? contactKey : '',
                                    )
                                  }
                                />
                              }
                              label="I confirm this is my LinkedIn profile reference"
                            />
                            <Button
                              disabled={blocked || !linkedinConfirmed}
                              onClick={() =>
                                change((next) => {
                                  const fact: CvFact = {
                                    id: crypto.randomUUID(),
                                    field: 'link',
                                    value: selectedText,
                                    origin: 'source',
                                    review: 'confirmed',
                                    evidence: [
                                      {
                                        sourceRevisionId: source.id,
                                        start: first.start,
                                        end: selectedEnd,
                                        quote: selectedText,
                                      },
                                    ],
                                  };
                                  addFact(next, fact, 'links', '');
                                  const entry = next.sections
                                    .flatMap((s) => s.entries)
                                    .find((e) =>
                                      e.facts.some((f) => f.id === fact.id),
                                    )!;
                                  entry.facts.push({
                                    id: crypto.randomUUID(),
                                    field: 'link',
                                    value: `https://www.linkedin.com/in/${selectedText.trim()}`,
                                    origin: 'user_entered',
                                    review: 'confirmed',
                                    evidence: [],
                                    replacesFactId: fact.id,
                                  });
                                  const index = next.coverage.findIndex(
                                    (row) => row.start === first.start,
                                  );
                                  next.coverage.splice(
                                    index,
                                    1,
                                    {
                                      start: first.start,
                                      end: selectedEnd,
                                      disposition: 'mapped',
                                      factIds: [fact.id],
                                      reason: null,
                                    },
                                    ...(selectedEnd < first.end
                                      ? [{ ...first, start: selectedEnd }]
                                      : []),
                                  );
                                })
                              }
                            >
                              Confirm LinkedIn and use URL
                            </Button>
                          </Stack>
                        )}
                        <TextField
                          select
                          label="Detail type for this content"
                          value={retainedField}
                          disabled={blocked}
                          onChange={(event) =>
                            setFieldSelection({
                              key: contactKey,
                              field: event.target.value,
                            })
                          }
                        >
                          {[
                            'source_passage',
                            'email',
                            'phone',
                            'location',
                            'link',
                            'text',
                          ].map((field) => (
                            <MenuItem key={field} value={field}>
                              {fieldTitle(field)}
                            </MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          select
                          label="Section for this content"
                          value={targetKind}
                          disabled={blocked}
                          onChange={(event) => {
                            setTargetKind(event.target.value as CvSectionKind);
                            setTargetRecord('');
                          }}
                        >
                          {cvSectionKinds.map((kind) => (
                            <MenuItem key={kind} value={kind}>
                              {sectionTitles[kind]}
                            </MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          select
                          label="Record for this content"
                          value={targetRecord}
                          disabled={blocked}
                          onChange={(event) =>
                            setTargetRecord(event.target.value)
                          }
                        >
                          <MenuItem value="">
                            New record — attribution requires review
                          </MenuItem>
                          {document.sections
                            .filter((s) => s.kind === targetKind)
                            .flatMap((s) =>
                              s.entries
                                .filter((e) =>
                                  e.facts.some((f) => f.field !== 'heading'),
                                )
                                .map((e) => (
                                  <MenuItem key={e.id} value={e.id}>
                                    {recordTitle(e.facts)}
                                  </MenuItem>
                                )),
                            )}
                        </TextField>
                        <Button
                          variant="outlined"
                          disabled={blocked || !selectedText.trim()}
                          onClick={() =>
                            change((next) => {
                              const fact: CvFact = {
                                id: crypto.randomUUID(),
                                field: retainedField,
                                value: selectedText,
                                origin: 'source',
                                review: 'needs_clarification',
                                evidence: [
                                  {
                                    sourceRevisionId: source.id,
                                    start: first.start,
                                    end: selectedEnd,
                                    quote: selectedText,
                                  },
                                ],
                              };
                              addFact(next, fact);
                              const index = next.coverage.findIndex(
                                (row) => row.start === first.start,
                              );
                              next.coverage.splice(
                                index,
                                1,
                                {
                                  start: first.start,
                                  end: selectedEnd,
                                  disposition: 'mapped',
                                  factIds: [fact.id],
                                  reason: null,
                                },
                                ...(selectedEnd < first.end
                                  ? [{ ...first, start: selectedEnd }]
                                  : []),
                              );
                            })
                          }
                        >
                          Keep in {sectionTitles[targetKind]}
                        </Button>
                        <TextField
                          label="Reason for excluding this content"
                          value={reason}
                          disabled={blocked}
                          onChange={(event) => setReason(event.target.value)}
                          slotProps={{ htmlInput: { maxLength: 1000 } }}
                        />
                        <Button
                          disabled={blocked || !reason.trim()}
                          onClick={() => {
                            change((next) => {
                              const index = next.coverage.findIndex(
                                (row) => row.start === first.start,
                              );
                              next.coverage.splice(
                                index,
                                1,
                                {
                                  start: first.start,
                                  end: selectedEnd,
                                  disposition: 'excluded',
                                  factIds: [],
                                  reason,
                                },
                                ...(selectedEnd < first.end
                                  ? [{ ...first, start: selectedEnd }]
                                  : []),
                              );
                            });
                            setReason('');
                          }}
                        >
                          Exclude with reason
                        </Button>
                        <Box component="details">
                          <Typography component="summary">
                            All remaining unassigned content
                          </Typography>
                          {unresolved.map((row) => (
                            <Typography
                              key={row.start}
                              sx={{ whiteSpace: 'pre-wrap', my: 1 }}
                            >
                              {source.text.slice(row.start, row.end) ||
                                '(Whitespace separator)'}
                            </Typography>
                          ))}
                        </Box>
                      </>
                    )}
                  </Stack>
                ) : (
                  <Typography>All source content is accounted for.</Typography>
                )}
              </Box>
              <Box component="details">
                <Typography component="summary">Add missing details</Typography>
                <Stack spacing={1} sx={{ mt: 1 }}>
                  <Typography variant="body2">
                    New details are user-entered facts and need your explicit
                    confirmation.
                  </Typography>
                  <TextField
                    select
                    label="Section for new detail"
                    value={targetKind}
                    disabled={blocked || legacy}
                    onChange={(event) => {
                      setTargetKind(event.target.value as CvSectionKind);
                      setTargetRecord('');
                    }}
                  >
                    {cvSectionKinds.map((kind) => (
                      <MenuItem key={kind} value={kind}>
                        {sectionTitles[kind]}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    select
                    label="Type of detail"
                    value={newField}
                    disabled={blocked || legacy}
                    onChange={(event) => setNewField(event.target.value)}
                  >
                    {cvFactFields
                      .filter((f) => f !== 'heading' && f !== 'source_passage')
                      .map((field) => (
                        <MenuItem key={field} value={field}>
                          {fieldTitle(field)}
                        </MenuItem>
                      ))}
                  </TextField>
                  <TextField
                    label="New detail"
                    multiline
                    value={newValue}
                    disabled={blocked || legacy}
                    onChange={(event) => setNewValue(event.target.value)}
                    slotProps={{ htmlInput: { maxLength: 4000 } }}
                  />
                  <Button
                    variant="outlined"
                    disabled={blocked || legacy || !newValue.trim()}
                    onClick={() => {
                      change((next) =>
                        addFact(next, {
                          id: crypto.randomUUID(),
                          field: newField,
                          value: newValue,
                          origin: 'user_entered',
                          review: 'pending',
                          evidence: [],
                        }),
                      );
                      setNewValue('');
                    }}
                  >
                    Add detail for review
                  </Button>
                </Stack>
              </Box>
              <Box component="details">
                <Typography component="summary">
                  Excluded source content
                </Typography>
                {document.coverage
                  .filter((row) => row.disposition === 'excluded')
                  .map((row) => (
                    <Box key={row.start} sx={{ my: 1 }}>
                      <Typography variant="body2">{row.reason}</Typography>
                      <Typography sx={{ whiteSpace: 'pre-wrap' }}>
                        {source.text.slice(row.start, row.end)}
                      </Typography>
                    </Box>
                  ))}
              </Box>
              {document.reconstruction?.previousRevisionId && (
                <Box component="details">
                  <Typography component="summary">
                    Earlier review and corrections
                  </Typography>
                  <Button
                    disabled={blocked}
                    onClick={() =>
                      void run(async () => {
                        const token = epoch.current;
                        const value = decodeCvProfile(
                          await sourceCvRequest(
                            `/profile-revisions/${document.reconstruction!.previousRevisionId}`,
                          ),
                          source,
                        );
                        if (token === epoch.current) setPrevious(value);
                      })
                    }
                  >
                    Load earlier review
                  </Button>
                  {previous && (
                    <Stack spacing={1}>
                      <Typography>
                        Earlier revision {previous.revision}; preserved without
                        changes.
                      </Typography>
                      {previous.document.sections.flatMap((s) =>
                        s.entries.flatMap((e) =>
                          e.facts
                            .filter((f) => f.field !== 'heading')
                            .map((f) => (
                              <Typography key={f.id}>
                                {f.origin === 'user_entered'
                                  ? 'Your earlier correction: '
                                  : ''}
                                {f.value}
                              </Typography>
                            )),
                        ),
                      )}
                    </Stack>
                  )}
                </Box>
              )}
              {blockers.length > 0 && (
                <Box
                  id="source-review-blockers"
                  tabIndex={-1}
                  component="section"
                  aria-label="Before you can complete the review"
                  sx={{
                    p: 2,
                    borderRadius: 1,
                    border: 1,
                    borderColor: completeAttempted ? 'warning.main' : 'divider',
                  }}
                >
                  <Typography variant="subtitle2" component="h3">
                    Before you can complete the review
                  </Typography>
                  <Box component="ul" sx={{ m: 0, pl: 3 }}>
                    {blockers.map((item) => (
                      <li key={item.key}>
                        {item.go ? (
                          <Button
                            variant="text"
                            size="small"
                            sx={{ minHeight: 32, p: 0.5, textAlign: 'left' }}
                            onClick={item.go}
                          >
                            {item.label}
                          </Button>
                        ) : (
                          <Typography variant="body2">{item.label}</Typography>
                        )}
                      </li>
                    ))}
                  </Box>
                </Box>
              )}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button
                  startIcon={<CheckIcon />}
                  variant="contained"
                  disabled={blocked}
                  onClick={() => {
                    if (blockers.length) {
                      setCompleteAttempted(true);
                      focusById('source-review-blockers');
                      return;
                    }
                    setCompleteAttempted(false);
                    void run(async () => {
                      const token = epoch.current;
                      if (documentDirty) {
                        const value = await sourceCvRequest(
                          `/profiles/${profile.profileId}/revisions`,
                          { expectedRevision: profile.revision, document },
                        );
                        if (token !== epoch.current) return;
                        accept(value, source);
                      }
                      setEditing(null);
                      // The app-level toast outlives the step change.
                      setMessage(
                        onContinue
                          ? 'Source CV review complete.'
                          : 'Source review complete. Tailored CVs will use this review.',
                      );
                      onContinue?.();
                    });
                  }}
                >
                  Complete review
                </Button>
                {completeAttempted && blockers.length > 0 && (
                  <Alert severity="warning" role="alert" sx={{ flex: 1 }}>
                    Not ready yet: {blockers.length} item
                    {blockers.length === 1 ? '' : 's'} left. Choose an item in
                    the list above to go straight to it.
                  </Alert>
                )}
                <Button
                  startIcon={<SaveIcon />}
                  variant="outlined"
                  disabled={
                    blocked ||
                    !documentDirty ||
                    blank ||
                    Boolean(newValue || reason)
                  }
                  onClick={() =>
                    void run(async () => {
                      const token = epoch.current;
                      const value = await sourceCvRequest(
                        `/profiles/${profile.profileId}/revisions`,
                        { expectedRevision: profile.revision, document },
                      );
                      if (token === epoch.current) {
                        accept(value, source);
                        setMessage(
                          'Draft saved. You can finish the review later.',
                        );
                      }
                    })
                  }
                >
                  Save draft
                </Button>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {dirty
                  ? 'You have unsaved changes. Save draft keeps them; Complete review saves and continues when everything is checked.'
                  : 'All changes saved.'}
              </Typography>
              <Box component="details">
                <Typography component="summary" variant="body2">
                  More actions
                </Typography>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  sx={{ mt: 1 }}
                >
                  <Button
                    disabled={blocked || !dirty}
                    onClick={() => {
                      setDocument(structuredClone(profile.document));
                      setReason('');
                      setNewValue('');
                      setError('');
                      setEditing(null);
                    }}
                  >
                    Discard unsaved changes
                  </Button>
                  <Button
                    disabled={blocked || dirty}
                    onClick={() => void run(openReview)}
                  >
                    Reload saved review
                  </Button>
                </Stack>
              </Box>
            </>
          )}
        </>
      )}
    </Stack>
  );
}
// Read-only presentation strips explicit field labels, never the stored wording or evidence.
const displayText = (fact: CvFact) =>
  fact.value
    .replace(
      /^\s*(?:Name|Full name|Headline|Professional headline|Email|Phone|Location|Employer|Company|Role|Title|Position|Dates|Date|Institution|University|School|Qualification|Degree|Project|Certification):[ \t]*/iu,
      '',
    )
    .trim();
const sectionTitles: Record<CvSectionKind, string> = {
  contact: 'Personal details',
  summary: 'Professional summary',
  skills: 'Skills',
  experience: 'Experience',
  projects: 'Projects',
  education: 'Education',
  certifications: 'Certifications',
  languages: 'Languages',
  links: 'Links',
  additional: 'Other information',
};
const fieldTitles: Record<string, string> = {
  name: 'Full name',
  headline: 'Professional headline',
  email: 'Email',
  phone: 'Phone',
  location: 'Location',
  link: 'Link',
  summary: 'Professional summary',
  skill: 'Skills',
  skill_category: 'Skill category',
  employer: 'Employer',
  role: 'Role',
  dates: 'Dates',
  qualification: 'Qualification',
  institution: 'Institution',
  project: 'Project',
  certification: 'Certification',
  language: 'Language',
  description: 'Contribution or description',
  text: 'Content',
  source_passage: 'Content',
};
const fieldTitle = (field: string) => fieldTitles[field] ?? 'Content';
const recordTitle = (facts: CvFact[]) =>
  facts
    .find((f) =>
      ['employer', 'institution', 'project', 'skill_category', 'name'].includes(
        f.field,
      ),
    )
    ?.value.trim() ??
  facts.find((f) => f.field !== 'heading')?.value.slice(0, 90) ??
  'New record';
function RecordAdjustments({
  sectionId,
  entryId,
  document,
  blocked,
  change,
}: {
  sectionId: string;
  entryId: string;
  document: CvProfileDocument;
  blocked: boolean;
  change: (edit: (next: CvProfileDocument) => void) => void;
}) {
  const entry = document.sections
    .find((s) => s.id === sectionId)!
    .entries.find((e) => e.id === entryId)!;
  const [selected, setSelected] = useState(''),
    [field, setField] = useState('description'),
    [destination, setDestination] = useState('');
  const facts = entry.facts.filter(
    (f) => f.field !== 'heading' && !f.replacesFactId,
  );
  return (
    <Box component="details">
      <Typography component="summary" variant="body2">
        Adjust field type or record grouping
      </Typography>
      <Stack spacing={1} sx={{ mt: 1 }}>
        <TextField
          select
          label="Detail to adjust"
          value={selected}
          disabled={blocked}
          onChange={(e) => setSelected(e.target.value)}
        >
          <MenuItem value="">Choose a detail</MenuItem>
          {facts.map((f) => (
            <MenuItem key={f.id} value={f.id}>
              {fieldTitle(f.field)}: {f.value.slice(0, 70)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label="Correct detail type"
          value={field}
          disabled={blocked}
          onChange={(e) => setField(e.target.value)}
        >
          {cvFactFields
            .filter((f) => f !== 'heading')
            .map((f) => (
              <MenuItem key={f} value={f}>
                {fieldTitle(f)}
              </MenuItem>
            ))}
        </TextField>
        <Button
          disabled={blocked || !selected}
          onClick={() =>
            change((next) => {
              const section = next.sections.find((s) => s.id === sectionId)!;
              const current = section.entries.find((e) => e.id === entryId)!;
              for (const fact of current.facts.filter(
                (f) => f.id === selected || f.replacesFactId === selected,
              )) {
                fact.field = field;
                fact.review = 'needs_clarification';
              }
              section.review = 'pending';
            })
          }
        >
          Apply detail type
        </Button>
        <TextField
          select
          label="Move detail to record"
          value={destination}
          disabled={blocked}
          onChange={(e) => setDestination(e.target.value)}
        >
          <MenuItem value="">Choose a record</MenuItem>
          <MenuItem value="new">Start a new record in this section</MenuItem>
          {cvSectionKinds.map((kind) => (
            <MenuItem key={`section:${kind}`} value={`section:${kind}`}>
              {sectionTitles[kind]} — new record
            </MenuItem>
          ))}
          {document.sections.flatMap((s) =>
            s.entries
              .filter((e) => e.id !== entryId)
              .map((e) => (
                <MenuItem key={e.id} value={e.id}>
                  {sectionTitles[s.kind]} · {recordTitle(e.facts)}
                </MenuItem>
              )),
          )}
        </TextField>
        <Button
          disabled={blocked || !selected || !destination}
          onClick={() =>
            change((next) => {
              const originalSection = next.sections.find(
                (s) => s.id === sectionId,
              )!;
              const original = originalSection.entries.find(
                (e) => e.id === entryId,
              )!;
              let targetSection = next.sections.find((s) =>
                s.entries.some((e) => e.id === destination),
              );
              if (destination.startsWith('section:')) {
                const kind = destination.slice(8) as CvSectionKind;
                targetSection = next.sections.find((s) => s.kind === kind);
                if (!targetSection) {
                  targetSection = {
                    id: crypto.randomUUID(),
                    kind,
                    review: 'pending',
                    entries: [],
                  };
                  next.sections.push(targetSection);
                }
              }
              if (!targetSection) targetSection = originalSection;
              let target = targetSection.entries.find(
                (e) => e.id === destination,
              );
              if (!target) {
                target = { id: crypto.randomUUID(), facts: [] };
                targetSection.entries.push(target);
              }
              const moved = original.facts.filter(
                (f) => f.id === selected || f.replacesFactId === selected,
              );
              original.facts = original.facts.filter((f) => !moved.includes(f));
              for (const fact of moved) {
                fact.review = 'needs_clarification';
                target.facts.push(fact);
              }
              originalSection.review = 'pending';
              targetSection.review = 'pending';
            })
          }
        >
          Move detail for review
        </Button>
      </Stack>
    </Box>
  );
}
