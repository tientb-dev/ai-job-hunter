import {
  ArrowForwardIcon,
  AutoAwesomeIcon,
  CheckIcon,
  DownloadIcon,
  RefreshIcon,
  SaveIcon,
} from '../../components/icons';
import { DialogCloseButton } from '../../components/DialogCloseButton';
import { ProposalComparison } from './ProposalComparison';
import type { Theme } from '@mui/material/styles';
import { useNotify } from '../../components/useNotify';
import { DraftPanel } from './DraftPanel';
import {
  CvSectionView,
  TailoredCvPreview,
  type FactAnchorState,
} from './TailoredCvPreview';
import {
  displayEntries,
  includedEntries,
  promotedLinks,
  sortSections,
  structuredRows,
} from './cv-layout';
import {
  decodeReadiness,
  generationReadiness,
  type DraftReadiness,
} from './tailored-cv-readiness';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControlLabel,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  decodeDraft,
  downloadDraft,
  draftRequest,
  issueBlocksApproval,
  type DraftOperation,
  type SavedDraft,
} from './tailored-cv.contract';
import { decodeCvProfile, decodeCvSource } from './source-cv-review.contract';

export function TailoredCvReview({
  jobId,
  jobRevision,
  cv,
  matchId,
  disabled,
  onDirtyChange,
  onBusyChange,
  active = true,
  readinessRevision = 0,
  continued = false,
  blockedReason,
  onRefreshMatch,
  onReviewSource,
  matchRefreshError,
  wizardStep,
  resumeRef,
  onDraftAvailability,
  onDraftDiscovery,
  onReadinessChange,
  onDraftChange,
  onContinueDraft,
  onApprovalReadyChange,
  onContinueToApproval,
}: {
  /** Wizard: open Approve & Export once the saved draft has no review work left. */
  onContinueToApproval?: () => void;
  /** Saved draft has no remaining review work; only approval is left (or done). */
  onApprovalReadyChange?: (ready: boolean) => void;
  resumeRef?: Ref<(() => void) | null>;
  onDraftAvailability?: (available: boolean) => void;
  onDraftDiscovery?: (state: 'loading' | 'empty' | 'loaded' | 'error') => void;
  wizardStep?: number;
  onReadinessChange?: (
    value: DraftReadiness | null,
    matchId?: string,
    error?: string,
  ) => void;
  onDraftChange?: (loaded: boolean, approved: boolean) => void;
  onContinueDraft?: () => void;
  jobId: string;
  jobRevision: string;
  cv: { fileName: string; updatedAt: string } | null;
  matchId?: string;
  disabled: boolean;
  onDirtyChange: (value: boolean) => void;
  onBusyChange: (value: boolean) => void;
  active?: boolean;
  readinessRevision?: number;
  continued?: boolean;
  blockedReason?: string;
  onRefreshMatch?: () => void;
  onReviewSource?: () => void;
  matchRefreshError?: string;
}) {
  const [saved, setSaved] = useState<SavedDraft | null>(null);
  const [operations, setOperations] = useState<DraftOperation[]>([]);
  // Document-first review: the suggestion selected in the CV or the panel.
  const [activeId, setActiveId] = useState<string | null>(null);
  const mobile = useMediaQuery(useTheme().breakpoints.down('md'));
  const dirty = operations.length > 0;
  const [items, setItems] = useState<
    { id: string; revision: number; updatedAt: string }[]
  >([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  // Transient completion messages are toasts; persistent workflow states
  // (approval, readiness, blockers) stay inline below.
  const notify = useNotify();
  const setMessage = (
    text: string,
    severity: 'success' | 'info' = 'success',
  ) => {
    if (text) notify({ severity, text });
  };
  const [editing, setEditing] = useState<string | null>(null);
  // Fact whose wording is being edited from its suggestion card.
  const [contextEdit, setContextEdit] = useState<string | null>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const keptOriginal = useRef(false);
  const [keepOriginalOpen, setKeepOriginalOpen] = useState(false);
  const keepCancel = useRef<HTMLButtonElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [listFailed, setListFailed] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  // null: follow the default (open right after Source CV Review).
  const [generateOpen, setGenerateOpen] = useState<boolean | null>(null);
  const [generatedAfterSource, setGeneratedAfterSource] = useState(false);
  const sourceJustSaved = continued && !generatedAfterSource;
  const [cvOpen, setCvOpen] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [exporting, setExporting] = useState<'docx' | 'pdf' | null>(null);
  const [recoverable, setRecoverable] = useState<string[] | null>(null);
  const [refresh, setRefresh] = useState(0);
  // Context without the recheck counter: a focus/timer recheck keeps the last
  // answer for the same context, so dependent banners do not unmount and remount.
  const readinessContext = JSON.stringify([
    jobId,
    jobRevision,
    cv?.updatedAt,
    matchId,
    readinessRevision,
    active,
  ]);
  const readinessKey = JSON.stringify([readinessContext, refresh]);
  const [preflight, setPreflight] = useState<{
    key: string;
    context: string;
    server: DraftReadiness | null;
    error: string;
    checking: boolean;
  }>({ key: '', context: '', server: null, error: '', checking: false });
  useEffect(() => {
    let cancelled = false;
    if (!active || !cv || !jobRevision) return;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setPreflight((previous) => ({
        key: readinessKey,
        context: readinessContext,
        server: previous.context === readinessContext ? previous.server : null,
        error: '',
        checking: true,
      }));
      try {
        const value = decodeReadiness(
          await draftRequest(`/jobs/${jobId}/drafts/readiness`, {
            expectedJobUpdatedAt: jobRevision,
            expectedSavedCvUpdatedAt: cv.updatedAt,
            matchId: matchId ?? null,
          }),
        );
        if (!cancelled)
          setPreflight({
            key: readinessKey,
            context: readinessContext,
            server: value,
            error: '',
            checking: false,
          });
      } catch (error) {
        if (!cancelled)
          setPreflight({
            key: readinessKey,
            context: readinessContext,
            server: null,
            error:
              error instanceof Error
                ? error.message
                : 'Readiness check failed. Retry.',
            checking: false,
          });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [active, cv, jobId, jobRevision, matchId, readinessContext, readinessKey]);
  const server =
    preflight.context === readinessContext ? preflight.server : null;
  useEffect(() => {
    onReadinessChange?.(
      server,
      matchId,
      preflight.key === readinessKey ? preflight.error : '',
    );
  }, [
    server,
    matchId,
    onReadinessChange,
    preflight.key,
    preflight.error,
    readinessKey,
  ]);
  useEffect(() => {
    onDraftChange?.(
      !!saved,
      !!saved &&
        !dirty &&
        saved.document.review.approval?.revision === saved.revision,
    );
  }, [saved, dirty, onDraftChange]);
  useEffect(() => {
    if (!active) return;
    // Focus also rechecks a previously blocked/error state. Match refresh no
    // longer deactivates this panel while checking the server.
    const timer = server?.ready
      ? setTimeout(() => setRefresh((n) => n + 1), server.matchValidForMs)
      : undefined;
    const focus = () => setRefresh((n) => n + 1);
    window.addEventListener('focus', focus);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', focus);
    };
  }, [active, server]);
  const epoch = useRef(0);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  // In-app navigation is guarded elsewhere; also warn before reload/close.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );
  async function run(action: (token: number) => Promise<void>) {
    const token = ++epoch.current;
    setBusy(true);
    onBusyChange(true);
    setError('');
    setMessage('');
    try {
      await action(token);
    } catch (failure) {
      if (token === epoch.current) {
        setRefresh((n) => n + 1);
        setError(
          failure instanceof Error
            ? failure.message
            : 'Request failed. Your edits are retained.',
        );
      }
    } finally {
      if (token === epoch.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }
  const blocked = disabled || busy;
  const readiness = generationReadiness({
    cv: !!cv,
    jobRevision: !!jobRevision,
    disabled: blocked,
    dirty,
    // Show "checking" only when there is no answer yet for this context; a
    // focus/timer recheck keeps the last answer instead of flashing.
    checking:
      active &&
      !server &&
      (preflight.key !== readinessKey || preflight.checking),
    error: preflight.key === readinessKey ? preflight.error : '',
    server,
    blockedReason,
  });
  // Depend on wizard presence, not the step: a step change must not recreate
  // accept() and re-run the initial draft load, which would wipe local edits.
  const isWizard = wizardStep !== undefined;
  const accept = useCallback(
    (value: unknown) => {
      const draft = decodeDraft(value, jobId);
      setSaved(draft);
      // Keep the switcher in sync: a generated draft joins the list (newest
      // first); a saved one updates its revision and time in place.
      const meta = {
        id: draft.id,
        revision: draft.revision,
        updatedAt: draft.updatedAt,
      };
      setItems((old) =>
        old.some((item) => item.id === meta.id)
          ? old.map((item) => (item.id === meta.id ? meta : item))
          : // Outside the wizard the list may be unloaded; never fake a count.
            isWizard || old.length
            ? [meta, ...old]
            : old,
      );
      setOperations([]);
      setReviewed(false);
      setRecoverable(null);
      setEditing(null);
      return draft;
    },
    [jobId, isWizard],
  );
  async function list(token: number, before?: string) {
    const value = (await draftRequest(`/jobs/${jobId}/drafts/list`, {
      before: before ?? null,
    })) as { items: typeof items; nextCursor: string | null };
    if (
      !Array.isArray(value.items) ||
      value.items.length > 20 ||
      value.items.some(
        (item) =>
          !item ||
          typeof item.id !== 'string' ||
          !/^[0-9a-f-]{36}$/iu.test(item.id) ||
          !Number.isSafeInteger(item.revision) ||
          typeof item.updatedAt !== 'string',
      ) ||
      (value.nextCursor !== null &&
        (typeof value.nextCursor !== 'string' ||
          !/^[0-9a-f-]{36}$/iu.test(value.nextCursor)))
    )
      throw new Error('Invalid draft list.');
    if (token === epoch.current) {
      setItems((old) => (before ? [...old, ...value.items] : value.items));
      setCursor(value.nextCursor);
      setMessage(
        value.items.length
          ? `Loaded ${value.items.length} saved draft${value.items.length === 1 ? '' : 's'}. Open a draft below.`
          : 'No saved drafts for this job yet. Generate your first draft when ready.',
        value.items.length ? 'success' : 'info',
      );
    }
  }
  useEffect(() => {
    if (!isWizard) return;
    let cancelled = false;
    const token = epoch.current;
    draftRequest(`/jobs/${jobId}/drafts/list`, { before: null })
      .then(async (value) => {
        const result = value as {
          items: typeof items;
          nextCursor: string | null;
        };
        if (
          !Array.isArray(result.items) ||
          result.items.some(
            (item) =>
              !item ||
              typeof item.id !== 'string' ||
              !/^[0-9a-f-]{36}$/iu.test(item.id) ||
              !Number.isSafeInteger(item.revision) ||
              typeof item.updatedAt !== 'string',
          )
        )
          throw Error('Invalid draft list.');
        if (!cancelled) {
          setItems(result.items);
          setCursor(result.nextCursor);
          if (result.items.length) {
            const draft = await draftRequest(`/drafts/${result.items[0]!.id}`);
            if (!cancelled && token === epoch.current) accept(draft);
            if (!cancelled) onDraftDiscovery?.('loaded');
          } else onDraftDiscovery?.('empty');
        }
      })
      .catch(() => {
        if (!cancelled) {
          onDraftDiscovery?.('error');
          setListFailed(true);
          setError('Could not load saved drafts. Choose Retry loading drafts.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, isWizard, accept, onDraftDiscovery]);
  useEffect(() => {
    onDraftAvailability?.(items.length > 0);
  }, [items.length, onDraftAvailability]);
  useImperativeHandle(resumeRef, () => () => {
    if (!items.length || blocked || dirty) return;
    onContinueDraft?.();
    void run(async (token) => {
      const value = await draftRequest(`/drafts/${items[0]!.id}`);
      if (token === epoch.current) {
        accept(value);
      }
    });
  });
  const document = saved ? structuredClone(saved.document) : null;
  if (document)
    for (const op of operations) {
      if (op.action === 'acknowledge') {
        if (!document.review.acknowledgedIssues.includes(op.issueIndex))
          document.review.acknowledgedIssues.push(op.issueIndex);
        continue;
      }
      const fact = document.sections
        .flatMap((s) => s.entries.flatMap((e) => e.facts))
        .find((f) => f.id === op.factId)!;
      const state = document.review.factReviews[fact.id]!;
      if (op.action === 'include') {
        state.exportIncluded = op.included;
        continue;
      }
      if (op.action === 'edit') {
        fact.acceptedText = op.text;
        state.wording = 'user_edited';
        if (state.proposal === 'pending') state.proposal = 'rejected';
      }
      if (op.action === 'accept') {
        fact.acceptedText = fact.proposedWording!.text;
        state.proposal = 'accepted';
        state.wording = 'ai_accepted';
      }
      if (op.action === 'reject') {
        state.proposal = 'rejected';
        state.wording = 'reviewed_profile';
        fact.acceptedText = state.reviewedText;
      }
    }
  function queue(op: DraftOperation) {
    setOperations((old) => [
      ...old.filter((x) =>
        op.action === 'acknowledge'
          ? x.action !== 'acknowledge' || x.issueIndex !== op.issueIndex
          : x.action === 'acknowledge' ||
            x.factId !== op.factId ||
            (op.action === 'include') !== (x.action === 'include'),
      ),
      op,
    ]);
    setReviewed(false);
    setMessage('');
  }
  const pending = document
    ? Object.values(document.review.factReviews).filter(
        (s) => s.proposal === 'pending',
      ).length
    : 0;
  // Same rule as the API: only conflicting source evidence must be confirmed.
  // Every other issue stays recorded and is shown as a note.
  const indexedIssues = (document?.reviewIssues ?? []).map((issue, index) => ({
    issue,
    index,
  }));
  const blockingIssues = indexedIssues.filter(({ issue }) =>
    issueBlocksApproval(issue),
  );
  const openBlocking = blockingIssues.filter(
    ({ index }) => !document?.review.acknowledgedIssues.includes(index),
  ).length;
  const issuesRemaining = openBlocking > 0;
  const facts =
    document?.sections.flatMap((s) => s.entries.flatMap((e) => e.facts)) ?? [];
  // Same rule as the API: new [placeholders] in changed wording block approval;
  // brackets already in the source wording (e.g. "[Remote]") do not.
  const openPlaceholders = facts.filter((fact) => {
    const state = document?.review.factReviews[fact.id];
    return (
      fact.verification?.details.some(
        (d) => d.startsWith('[') && fact.acceptedText.includes(d),
      ) ||
      (!!state &&
        state.wording !== 'reviewed_profile' &&
        [...fact.acceptedText.matchAll(/\[[^\]\n]{1,40}\]/gu)].some(
          (m) => !state.reviewedText.includes(m[0]),
        ))
    );
  }).length;
  const editedIds = document
    ? Object.entries(document.review.factReviews)
        .filter(([, s]) => s.wording !== 'reviewed_profile')
        .map(([id]) => id)
    : [];
  const approvedRevision =
    !!saved && document?.review.approval?.revision === saved.revision;
  const approvedUnchanged = approvedRevision && !dirty;
  const approvalReady =
    !!saved &&
    !dirty &&
    pending === 0 &&
    !issuesRemaining &&
    openPlaceholders === 0;
  useEffect(() => {
    onApprovalReadyChange?.(approvalReady);
  }, [approvalReady, onApprovalReadyChange]);
  const blank = facts.some((f) => !f.acceptedText.trim());
  // Phase 1 Review: group existing proposals into decision cards. Grouping is
  // presentation only; decisions still flow through the same queued operations.
  const humanize = (text: string) => {
    const value = text.replaceAll('_', ' ');
    return value.charAt(0).toUpperCase() + value.slice(1);
  };
  const cards = document
    ? document.sections.flatMap((section) =>
        section.entries.flatMap((entry, index) =>
          entry.facts.map((fact) => {
            const where = `${humanize(section.kind)}${section.entries.length > 1 ? ` ${index + 1}` : ''}${section.kind.toLowerCase().startsWith(fact.field.toLowerCase()) ? '' : ` · ${humanize(fact.field)}`}`;
            // SEMANTIC_REVIEW_REQUIRED accompanies every pending rewrite that
            // passed the claim checks: it is a meaning reminder, not a factual
            // gap. Factual gaps arrive as fact.verification; any other issue
            // tied to the fact still escalates to "Needs your check".
            const issues = document.reviewIssues.filter(
              (issue) => issue.factId === fact.id,
            );
            const checkReasons = issues
              .filter((issue) => issue.code !== 'SEMANTIC_REVIEW_REQUIRED')
              .map((issue) => issue.reason);
            const reviewNotes = issues
              .filter((issue) => issue.code === 'SEMANTIC_REVIEW_REQUIRED')
              .map((issue) => issue.reason);
            return { section, fact, where, checkReasons, reviewNotes };
          }),
        ),
      )
    : [];
  const proposalCards = cards
    .filter((card) => card.fact.proposedWording)
    .map((card) => {
      const state = document!.review.factReviews[card.fact.id]!;
      const group: 'check' | 'recommended' = card.checkReasons.length
        ? 'check'
        : 'recommended';
      return { ...card, state, group };
    });
  const verificationCards = cards.filter((card) => card.fact.verification);
  const decided = proposalCards.filter(
    (card) => card.state.proposal !== 'pending',
  ).length;
  const excluded = facts.filter(
    (f) => document?.review.factReviews[f.id]?.exportIncluded === false,
  ).length;
  const evidenceFor = (fact: (typeof facts)[number]) =>
    fact.provenance.evidence.length ? (
      <Stack spacing={1}>
        <Typography variant="subtitle2">From your source CV</Typography>
        {fact.provenance.evidence.map((ref) => (
          <Typography
            key={`${ref.start}:${ref.end}`}
            component="blockquote"
            variant="body2"
            sx={{
              m: 0,
              pl: 1.5,
              borderLeft: 2,
              borderColor: 'divider',
              whiteSpace: 'pre-wrap',
            }}
          >
            {ref.quote}
          </Typography>
        ))}
      </Stack>
    ) : (
      <Typography variant="body2">
        User-entered fact; no original-source evidence.
      </Typography>
    );
  const notes = indexedIssues
    .filter(({ issue }) => !issueBlocksApproval(issue))
    .map(({ issue, index }) => {
      const where = cards.find((c) => c.fact.id === issue.factId)?.where;
      const handled =
        issue.code === 'SEMANTIC_REVIEW_REQUIRED' ||
        issue.code === 'CV_DRAFT_UNSAFE_REWRITE';
      return {
        index,
        kind: handled ? ('handled' as const) : ('job' as const),
        text:
          issue.code === 'CV_DRAFT_UNSAFE_REWRITE'
            ? `${where ?? 'A fact'}: an unsafe AI rewrite was blocked; your original wording is kept.`
            : issue.code === 'SEMANTIC_REVIEW_REQUIRED'
              ? `${where ?? 'A fact'}: ${issue.reason}`
              : issue.code === 'SECTION_NOT_IN_PROFILE'
                ? `${humanize(issue.sectionKind ?? 'section')}: not in your CV, so nothing was added.`
                : issue.reason,
      };
    });
  const decisionHint =
    'Every suggestion needs a decision, but you do not have to accept any. “Keep original” is a complete decision that keeps your CV wording unchanged.';
  const approvalSteps = [
    ...(pending > 0
      ? [
          `Decide ${pending} remaining suggestion${pending === 1 ? '' : 's'} (${decided} of ${proposalCards.length} decided). Accept or Keep original both count.`,
        ]
      : []),
    ...(openBlocking > 0
      ? [
          `Confirm ${openBlocking} conflicting fact${openBlocking === 1 ? '' : 's'} above.`,
        ]
      : []),
    ...(openPlaceholders > 0
      ? [
          'Replace every [placeholder] in your adopted wording with your own facts.',
        ]
      : []),
    ...(dirty ? ['Save draft.'] : []),
    ...(!reviewed ? ['Tick “I reviewed the complete saved CV”.'] : []),
  ];
  // Review queue: cards in display order (Needs your check, then Recommended).
  const queueOrder = ['check', 'recommended'].flatMap((key) =>
    proposalCards.filter((card) => card.group === key),
  );
  const undecidedIds = queueOrder
    .filter((card) => card.state.proposal === 'pending')
    .map((card) => card.fact.id);
  const reducedMotion = () =>
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Suggestions in panel order: unproposed checks first, then the queue.
  const navIds = [
    ...verificationCards
      .filter((card) => !card.fact.proposedWording)
      .map((card) => card.fact.id),
    ...queueOrder.map((card) => card.fact.id),
  ];
  const openConflicts = new Set(
    blockingIssues
      .filter(
        ({ index }) => !document?.review.acknowledgedIssues.includes(index),
      )
      .map(({ issue }) => issue.factId),
  );
  const anchorStates: Record<string, FactAnchorState> = Object.fromEntries([
    ...verificationCards
      .filter((card) => !card.fact.proposedWording)
      .map(({ fact }) => [
        fact.id,
        document?.review.factReviews[fact.id]?.wording === 'user_edited'
          ? 'decided'
          : 'conflict',
      ]),
    ...proposalCards.map(({ fact, state, group }) => [
      fact.id,
      state.exportIncluded === false
        ? 'excluded'
        : openConflicts.has(fact.id) ||
            (group === 'check' && state.proposal === 'pending')
          ? 'conflict'
          : state.proposal === 'pending'
            ? 'pending'
            : 'decided',
    ]),
  ]);
  const docReview = isWizard && wizardStep === 2 && navIds.length > 0;
  // Same layout helpers as the preview: facts merged into another line (dates)
  // or excluded from download have no anchor of their own.
  const anchored = new Set(
    document
      ? sortSections(document.sections).flatMap((section) =>
          displayEntries(document, section).flatMap((entry) =>
            ['experience', 'projects', 'education'].includes(section.kind)
              ? structuredRows(section.kind, entry.facts).map((row) => row.id)
              : entry.facts.map((fact) => fact.id),
          ),
        )
      : [],
  );
  // Bring a CV line into the upper-middle of what is actually visible: above the
  // mobile sheet when it is open. A line already comfortably visible stays put.
  const revealAnchor = (id: string) =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = window.document.querySelector<HTMLElement>(
          `[data-fact-id="${CSS.escape(id)}"]`,
        );
        if (!el) return;
        const sheet = window.document
          .getElementById('review-sheet-title')
          ?.closest<HTMLElement>('[role="dialog"]');
        const top = 16;
        const bottom = sheet
          ? sheet.getBoundingClientRect().top
          : window.innerHeight;
        const rect = el.getBoundingClientRect();
        const margin = 48;
        if (rect.top >= top + margin && rect.bottom <= bottom - margin) return;
        window.scrollBy?.({
          top: rect.top - (top + (bottom - top) * 0.3),
          behavior: reducedMotion() ? 'auto' : 'smooth',
        });
      }),
    );
  // Selecting from the CV opens the matching card in the panel or sheet.
  const selectSuggestion = (id: string) => {
    setActiveId(id);
    if (docReview) revealAnchor(id);
    requestAnimationFrame(() => {
      const el = window.document.getElementById(`suggestion-${id}`);
      const panel = window.document.getElementById('review-panel');
      if (docReview && panel && el && panel.contains(el))
        panel.scrollTo?.({
          // Clear the sticky Previous/Next header at the top of the panel.
          top:
            el.offsetTop -
            ((panel.firstElementChild as HTMLElement | null)?.offsetHeight ??
              0) -
            8,
          behavior: reducedMotion() ? 'auto' : 'smooth',
        });
      else if (!(docReview && mobile))
        el?.scrollIntoView?.({
          block: 'start',
          behavior: reducedMotion() ? 'auto' : 'smooth',
        });
      (docReview && mobile
        ? window.document.getElementById('review-sheet-title')
        : el
      )?.focus({ preventScroll: true });
    });
  };
  const showSuggestion = (id: string) => selectSuggestion(id);
  const step = (delta: number) => {
    const at = activeId ? navIds.indexOf(activeId) : -1;
    const next =
      navIds[(at + delta + navIds.length) % navIds.length] ?? navIds[0]!;
    showSuggestion(next);
  };
  const closeSuggestion = () => {
    const id = activeId;
    setActiveId(null);
    if (id)
      requestAnimationFrame(() =>
        window.document
          .querySelector<HTMLElement>(`[data-fact-id="${CSS.escape(id)}"]`)
          ?.focus(),
      );
  };
  // After a decision, offer the next undecided suggestion (wrapping), or the
  // action bar once every suggestion is decided.
  function advanceFrom(id: string) {
    const rest = undecidedIds.filter((x) => x !== id);
    if (!rest.length) {
      requestAnimationFrame(() =>
        window.document.getElementById('review-action-bar')?.focus(),
      );
      return;
    }
    const at = undecidedIds.indexOf(id);
    const next = undecidedIds.slice(at + 1).find((x) => x !== id) ?? rest[0]!;
    showSuggestion(next);
  }
  // One editor for a fact's wording, used by the Full CV editor and by the
  // suggestion cards. Both read the same derived draft and queue the same edit.
  const factField = (
    fact: (typeof facts)[number],
    label: string,
    autoFocus = false,
  ) => (
    <TextField
      label={label}
      fullWidth
      multiline
      autoFocus={autoFocus}
      value={fact.acceptedText}
      disabled={blocked}
      error={!fact.acceptedText.trim()}
      slotProps={{
        htmlInput: { maxLength: 4000 },
      }}
      onChange={(e) =>
        queue({
          action: 'edit',
          factId: fact.id,
          text: e.target.value,
        })
      }
      helperText="Edits are user-authored wording, not original-source evidence."
    />
  );
  // Accurate wording status: an edit is the user's own wording, never a
  // confirmation of the claim, and is only persisted by Save draft.
  const unsavedEdit = (id: string) =>
    operations.some((op) => op.action === 'edit' && op.factId === id);
  const savedEdit = (id: string) =>
    saved?.document.review.factReviews[id]?.wording === 'user_edited';
  const unsavedNote = (fact: (typeof facts)[number]) =>
    unsavedEdit(fact.id) ? (
      <Alert
        severity="info"
        variant="outlined"
        sx={{ mt: 1 }}
        action={
          <Button
            size="small"
            variant="contained"
            startIcon={<SaveIcon />}
            aria-label={`Save draft with your wording for ${fact.field}`}
            disabled={blocked || blank || operations.length > 384}
            onClick={saveDraft}
          >
            Save draft
          </Button>
        }
      >
        Edited by you — not saved. Save the draft to keep this wording.
      </Alert>
    ) : null;
  const contextualEdit = (fact: (typeof facts)[number], where: string) =>
    contextEdit === fact.id ? (
      <Stack spacing={1} sx={{ mt: 1.5 }}>
        {factField(fact, `Your wording: ${where}`, true)}
        <Box>
          <Button size="small" onClick={() => setContextEdit(null)}>
            Done editing
          </Button>
        </Box>
      </Stack>
    ) : (
      <Box sx={{ mt: 1 }}>
        {unsavedNote(fact)}
        <Button
          size="small"
          disabled={blocked}
          aria-label={`Edit wording for ${where}`}
          onClick={() => setContextEdit(fact.id)}
        >
          Edit wording
        </Button>
      </Box>
    );
  const renderCheck = (card: (typeof verificationCards)[number]) => {
    const { fact, where } = card;
    const adopted = unsavedEdit(fact.id)
      ? 'Edited by you — not saved'
      : savedEdit(fact.id)
        ? 'Saved — user-authored wording'
        : null;
    if (!adopted) return renderVerify(card);
    // Already acted on: show the user's wording and status; the original AI
    // provenance warning stays available below, marked as history.
    return (
      <Alert
        key={`verify-${fact.id}`}
        id={fact.proposedWording ? undefined : `suggestion-${fact.id}`}
        tabIndex={-1}
        severity="info"
        variant="outlined"
        aria-label={`Your wording for ${fact.field}`}
      >
        <Stack spacing={1}>
          <Typography
            variant="subtitle1"
            component="h4"
            sx={{ fontWeight: 600 }}
          >
            {where} · {adopted}
          </Typography>
          <Typography sx={{ whiteSpace: 'pre-wrap' }}>
            {fact.acceptedText}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Your own wording, not evidence from your original CV. Approval
            records your review, not verification of this claim.
          </Typography>
          <Box component="details">
            <Typography component="summary" variant="body2">
              Original AI suggestion (not in your CV:{' '}
              {fact.verification!.details.join(', ')})
            </Typography>
            <Typography
              variant="body2"
              sx={{ whiteSpace: 'pre-wrap', mt: 0.5 }}
            >
              {fact.verification!.text}
            </Typography>
          </Box>
          {docReview
            ? !fact.proposedWording && contextualEdit(fact, where)
            : unsavedNote(fact)}
        </Stack>
      </Alert>
    );
  };
  const renderVerify = ({
    fact,
    section,
    where,
  }: (typeof verificationCards)[number]) => (
    <Alert
      key={`verify-${fact.id}`}
      id={fact.proposedWording ? undefined : `suggestion-${fact.id}`}
      tabIndex={-1}
      severity="warning"
      variant="outlined"
      aria-label={`Needs your verification for ${fact.field}`}
    >
      <Stack spacing={1}>
        <Typography variant="subtitle1" component="h4" sx={{ fontWeight: 600 }}>
          {where} · not in your CV: {fact.verification!.details.join(', ')}
        </Typography>
        <Typography sx={{ whiteSpace: 'pre-wrap' }}>
          {fact.verification!.text}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Not included or exported. Use it only if you can confirm the details;
          replace every [placeholder] with your own facts.
        </Typography>
        <Box>
          <Button
            variant="outlined"
            disabled={blocked}
            onClick={() => {
              // In document review, edit in place; otherwise open Full CV.
              if (docReview) setContextEdit(fact.id);
              else {
                setEditing(section.id);
                setCvOpen(true);
              }
              queue({
                action: 'edit',
                factId: fact.id,
                text: fact.verification!.text,
              });
            }}
          >
            Use as my draft
          </Button>
        </Box>
        {docReview && contextEdit === fact.id && contextualEdit(fact, where)}
      </Stack>
    </Alert>
  );
  const renderProposal = ({
    fact,
    state,
    where,
    checkReasons,
    reviewNotes,
  }: (typeof proposalCards)[number]) => (
    <Box
      key={fact.id}
      id={`suggestion-${fact.id}`}
      tabIndex={-1}
      sx={{
        scrollMarginTop: 16,
        scrollMarginBottom: 96,
        borderRadius: 1,
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: 2,
        },
      }}
    >
      <ProposalComparison
        original={state.reviewedText}
        suggestion={fact.proposedWording!.text}
        proposal={state.proposal}
        manuallyEdited={state.wording === 'user_edited'}
        where={where}
        why={fact.proposedWording!.explanation}
        needsCheck={checkReasons.join(' ') || undefined}
        reviewNote={reviewNotes.join(' ') || undefined}
        evidence={evidenceFor(fact)}
        disabled={blocked}
        onDecision={(action) => {
          const wasPending = state.proposal === 'pending';
          queue({ action, factId: fact.id });
          if (isWizard && wasPending) advanceFrom(fact.id);
        }}
      />
      {docReview && contextualEdit(fact, where)}
    </Box>
  );
  const position = activeId ? navIds.indexOf(activeId) + 1 : 0;
  const reviewNav = (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        alignItems: 'center',
        position: 'sticky',
        top: 0,
        zIndex: 3,
        bgcolor: 'background.default',
        py: 1,
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {position
            ? `Suggestion ${position} of ${navIds.length}`
            : `${navIds.length} suggestions`}
        </Typography>
        <LinearProgress
          variant="determinate"
          value={
            proposalCards.length ? (decided / proposalCards.length) * 100 : 100
          }
          aria-label="Suggestions decided"
          sx={{ mt: 0.5, height: 4, borderRadius: 2 }}
        />
      </Box>
      <Button
        size="small"
        variant="outlined"
        aria-label="Previous suggestion"
        onClick={() => step(-1)}
      >
        Previous
      </Button>
      <Button
        size="small"
        variant="outlined"
        aria-label="Next suggestion"
        onClick={() => step(1)}
      >
        Next
      </Button>
    </Stack>
  );
  const unanchored = navIds.filter((id) => !anchored.has(id));
  const unanchoredNote =
    docReview && unanchored.length > 0 ? (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {unanchored.length} suggestion
        {unanchored.length === 1 ? ' is' : 's are'} not shown in the CV
        (excluded from download or not placed). Review{' '}
        {unanchored.length === 1 ? 'it' : 'them'} in this list.
      </Typography>
    ) : null;
  const activeProposal = proposalCards.find(
    (card) => card.fact.id === activeId,
  );
  const activeCheck = verificationCards.find(
    (card) => card.fact.id === activeId,
  );
  const reviewSheet = mobile ? (
    <>
      {!activeId && (
        <Button variant="outlined" sx={{ mb: 2 }} onClick={() => step(1)}>
          Review suggestions ({navIds.length})
        </Button>
      )}
      {activeId && (
        <Paper
          role="dialog"
          aria-modal="false"
          aria-labelledby="review-sheet-title"
          elevation={8}
          onKeyDown={(event) => {
            if (event.key === 'Escape') closeSuggestion();
          }}
          sx={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 1200,
            maxHeight: '70vh',
            overflowY: 'auto',
            borderRadius: '12px 12px 0 0',
            p: 2,
            pt: 1,
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            sx={{
              alignItems: 'center',
              mb: 1,
              position: 'sticky',
              top: -8,
              zIndex: 1,
              bgcolor: 'background.paper',
              py: 1,
            }}
          >
            <Typography
              id="review-sheet-title"
              tabIndex={-1}
              variant="subtitle2"
              sx={{ flex: 1 }}
            >
              Suggestion {position} of {navIds.length}
            </Typography>
            <Button
              size="small"
              aria-label="Previous suggestion"
              onClick={() => step(-1)}
            >
              Previous
            </Button>
            <Button
              size="small"
              aria-label="Next suggestion"
              onClick={() => step(1)}
            >
              Next
            </Button>
            <Button size="small" onClick={closeSuggestion}>
              Close
            </Button>
          </Stack>
          {activeProposal
            ? renderProposal(activeProposal)
            : activeCheck
              ? renderCheck(activeCheck)
              : null}
        </Paper>
      )}
    </>
  ) : null;
  // Set on a successful wizard save; Continue takes focus as soon as it renders.
  const focusContinue = useRef(false);
  function saveDraft() {
    if (!saved) return;
    const wasApproved =
      saved.document.review.approval?.revision === saved.revision;
    void run(async (token) => {
      const value = await draftRequest(`/drafts/${saved.id}/review`, {
        expectedRevision: saved.revision,
        operations,
      });
      if (token === epoch.current) {
        const draft = accept(value);
        setMessage(
          `Draft saved as revision ${draft.revision}.${wasApproved ? ' Approval cleared.' : ''}`,
        );
        if (isWizard) focusContinue.current = true;
      }
    });
  }
  const groups = [
    {
      key: 'check',
      title: 'Needs your check',
      hint: 'claims that could not be confirmed from your CV',
    },
    {
      key: 'recommended',
      title: 'Recommended',
      hint: 'rewrites of your own CV wording for this job',
    },
  ] as const;
  function approveSaved(id: string, revision: number) {
    void run(async (token) => {
      const value = await draftRequest(`/drafts/${id}/approve`, {
        expectedRevision: revision,
        reviewedFactIds: editedIds,
      });
      if (token === epoch.current) {
        accept(value);
        // In the wizard the export panel states approval.
        if (!isWizard) setMessage('This saved draft revision is approved.');
      }
    });
  }
  const renderApproval = (
    doc: NonNullable<typeof document>,
    s: NonNullable<typeof saved>,
  ) =>
    approvedUnchanged ? null : (
      <>
        <FormControlLabel
          control={
            <Checkbox
              checked={reviewed}
              disabled={blocked || dirty}
              onChange={(e) => setReviewed(e.target.checked)}
            />
          }
          label="I reviewed the complete saved CV, including all user-entered and edited claims. Approval records my review, not independent verification."
        />
        <Box>
          <Button
            variant={
              isWizard &&
              !dirty &&
              reviewed &&
              pending === 0 &&
              !issuesRemaining &&
              openPlaceholders === 0
                ? 'contained'
                : 'outlined'
            }
            aria-describedby={
              approvalSteps.length ? 'approve-needs' : undefined
            }
            disabled={
              blocked ||
              dirty ||
              !reviewed ||
              pending > 0 ||
              issuesRemaining ||
              openPlaceholders > 0 ||
              doc.review.approval?.revision === s.revision
            }
            onClick={() => approveSaved(s.id, s.revision)}
          >
            Approve saved draft
          </Button>
        </Box>
        {approvalSteps.length > 0 && (
          <Alert
            id="approve-needs"
            severity="info"
            variant="outlined"
            sx={{ mt: 1 }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              To approve:
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 3, typography: 'body2' }}>
              {approvalSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </Box>
            {/* Decisions belong to Tailor & Review; Approve & Export only reads the saved revision. */}
            {pending > 0 && wizardStep !== 3 && (
              <>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  {decisionHint}
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={blocked}
                  sx={{ mt: 1 }}
                  onClick={() => setKeepOriginalOpen(true)}
                >
                  Keep all remaining originals
                </Button>
              </>
            )}
          </Alert>
        )}
      </>
    );
  // Only a missing match is fully covered by the CV Match card above; a stale
  // match can still look current there, so its readiness message stays.
  const matchOwnedAbove =
    isWizard && !saved && server?.reason === 'CV_DRAFT_MATCH_REQUIRED';
  const generateSection = wizardStep !== 3 && (
    <Box
      component={isWizard && saved ? 'details' : 'div'}
      id="generate-new-draft"
      // Space the readiness alert, actions and messages (they touched).
      // Margins, not flex gap: <details> content ignores the host's gap.
      sx={{ '& > * + *': { mt: 1.5 } }}
      {...(isWizard && saved
        ? {
            open: generateOpen ?? sourceJustSaved,
            onToggle: (event: React.SyntheticEvent<HTMLElement>) =>
              setGenerateOpen((event.currentTarget as HTMLDetailsElement).open),
          }
        : {})}
    >
      {isWizard && saved && (
        <Typography component="summary">
          Generate a new draft instead
        </Typography>
      )}
      {isWizard && saved && (
        <Typography variant="body2" color="text.secondary">
          Creates a separate draft from your current CV and match. The open
          draft and its decisions stay unchanged.
        </Typography>
      )}
      {/* In the workflow without a draft, the CV Match card above already
          explains a missing match and offers Analyze. */}
      {!matchOwnedAbove && (
        <Alert severity={readiness.ready ? 'success' : 'info'} role="status">
          {readiness.text}
        </Alert>
      )}
      {readiness.action === 'match' && !matchOwnedAbove && (
        <Button
          startIcon={<RefreshIcon />}
          variant={saved ? 'outlined' : 'contained'}
          disabled={blocked || dirty || !onRefreshMatch}
          onClick={onRefreshMatch}
        >
          Refresh CV Match
        </Button>
      )}
      {readiness.action === 'review' && onReviewSource && (
        <Button endIcon={<ArrowForwardIcon />} onClick={onReviewSource}>
          Go to Source CV Review
        </Button>
      )}
      {readiness.action === 'check' && (
        <Button
          startIcon={<RefreshIcon />}
          disabled={blocked || dirty}
          onClick={() => setRefresh((n) => n + 1)}
        >
          Check readiness again
        </Button>
      )}
      {readiness.action === 'reload' && (
        <Button
          startIcon={<RefreshIcon />}
          disabled={blocked || dirty}
          onClick={() => window.location.reload()}
        >
          Reload job
        </Button>
      )}
      {readiness.action === 'match' && matchRefreshError && (
        <Alert severity="error">{matchRefreshError}</Alert>
      )}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        {(!isWizard || listFailed) && (
          <Button
            startIcon={<RefreshIcon />}
            variant="outlined"
            disabled={blocked || dirty}
            onClick={() =>
              void run(async (token) => {
                await list(token);
                if (token === epoch.current) setListFailed(false);
              })
            }
          >
            {listFailed ? 'Retry loading drafts' : 'Load saved drafts'}
          </Button>
        )}
        <Button
          startIcon={<AutoAwesomeIcon />}
          variant={
            saved || items.length > 0 || !readiness.ready
              ? 'outlined'
              : 'contained'
          }
          // Same-context rechecks keep the last valid answer (no disabled
          // flash); a changed context clears it, and the server rejects
          // stale job, CV, profile or match pins at generation.
          disabled={!readiness.ready}
          onClick={() =>
            void run(async (token) => {
              if (!server?.ready || !server.pins) return;
              const { sourceRevisionId: _sourceRevisionId, ...pins } =
                server.pins;
              void _sourceRevisionId;
              const value = await draftRequest(`/jobs/${jobId}/drafts`, pins);
              if (token === epoch.current) {
                accept(value);
                setGeneratedAfterSource(true);
                setGenerateOpen(false);
                setMessage(
                  'New draft generated and opened. Existing drafts are unchanged.',
                );
              }
            })
          }
        >
          Generate new draft
        </Button>
      </Stack>
    </Box>
  );
  return (
    <Stack
      component="section"
      spacing={2}
      sx={{
        mt: isWizard ? 0 : 3,
        minWidth: 0,
        overflowWrap: 'anywhere',
        '& .MuiButton-root': { minHeight: 44 },
      }}
      aria-labelledby={isWizard ? 'wizard-step-title' : 'tailored-cv-title'}
    >
      {!isWizard && (
        <>
          <Divider />
          <Typography
            id="tailored-cv-title"
            tabIndex={-1}
            variant="h6"
            component="h2"
          >
            Tailored CV
          </Typography>
          <Typography color="text.secondary">
            Review your complete CV, decide wording proposals, then save and
            approve a specific revision. Approval means you reviewed the
            content.
          </Typography>
        </>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {sourceJustSaved && (
        <Typography role="status">
          Check readiness below, then choose Generate new draft. Existing drafts
          can be loaded separately.
        </Typography>
      )}
      {!(isWizard && saved) && generateSection}
      {busy && exporting && (
        <Typography role="status">
          Preparing {exporting.toUpperCase()} download…
        </Typography>
      )}
      {items.length > 0 && (
        <DraftPanel
          items={items}
          saved={saved}
          opening={opening}
          latestReview={
            saved && server?.currentProfileRevisionId
              ? saved.document.pins.profileRevisionId ===
                server.currentProfileRevisionId
              : null
          }
          // Switching lives in Tailor & Review only; Approve & Export links there.
          canSwitch={wizardStep !== 3}
          onGoToSwitch={wizardStep === 3 ? onContinueDraft : undefined}
          disabled={blocked || dirty}
          dirty={dirty}
          hasMore={!!cursor}
          onLoadMore={() => void run((token) => list(token, cursor!))}
          onOpen={(item, label) => {
            setOpening(item.id);
            void run(async (token) => {
              const value = await draftRequest(`/drafts/${item.id}`);
              if (token === epoch.current) {
                accept(value);
                setMessage(`Opened ${label}. Showing its saved decisions.`);
              }
            }).finally(() => setOpening(null));
          }}
        />
      )}
      {isWizard && saved && generateSection}
      {document && saved && (
        <>
          {wizardStep !== 3 && (
            <Paper
              variant="outlined"
              component="section"
              aria-label="Review progress"
              sx={{ p: { xs: 2, sm: 2.5 } }}
            >
              <Stack spacing={1.5}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  sx={{
                    alignItems: { sm: 'center' },
                    justifyContent: 'space-between',
                  }}
                >
                  <Typography
                    variant="subtitle1"
                    component="p"
                    sx={{ fontWeight: 600 }}
                  >
                    {decided} of {proposalCards.length} suggestions decided
                    {pending > 0 ? ` · ${pending} remaining` : ''}
                  </Typography>
                  <Typography
                    role="status"
                    variant="body2"
                    color="text.secondary"
                  >
                    {/* The draft card shows revision and approval; repeat them
                        only when the draft list (and so the card) is absent. */}
                    {dirty
                      ? 'Unsaved changes — approval will be cleared'
                      : items.length === 0
                        ? `Saved revision ${saved.revision} · ${approvedUnchanged ? 'Approved' : 'Not approved'}`
                        : ''}
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  aria-label="Suggestions decided"
                  value={
                    proposalCards.length
                      ? (decided / proposalCards.length) * 100
                      : 100
                  }
                  sx={{ height: 8, borderRadius: 4 }}
                />
                <Typography variant="body2" color="text.secondary">
                  {decisionHint} Then read the full CV, save, and approve.
                </Typography>
                {pending > 0 && !isWizard && (
                  <Button
                    variant="outlined"
                    disabled={blocked}
                    sx={{ alignSelf: 'flex-start' }}
                    onClick={() => setKeepOriginalOpen(true)}
                  >
                    Keep all remaining originals
                  </Button>
                )}
              </Stack>
            </Paper>
          )}
          <Dialog
            open={keepOriginalOpen}
            onClose={() => setKeepOriginalOpen(false)}
            aria-labelledby="keep-original-title"
            slotProps={{
              transition: {
                // autoFocus loses to the modal's own surface focus; land on the safe action.
                onEntered: () => keepCancel.current?.focus(),
                onExited: () => {
                  if (keptOriginal.current) {
                    saveButton.current?.focus({ preventScroll: true });
                    keptOriginal.current = false;
                  }
                },
              },
            }}
          >
            <DialogCloseButton onClick={() => setKeepOriginalOpen(false)} />
            <DialogTitle id="keep-original-title" sx={{ pr: 7 }}>
              Keep your original wording for the {pending} remaining suggestion
              {pending === 1 ? '' : 's'}?
            </DialogTitle>
            <DialogContent>
              <Typography>
                Each undecided suggestion will use your original CV wording.
                Suggestions you already accepted or kept, content inclusion and
                review issues stay unchanged. Nothing is saved or approved
                automatically: save the draft, then review and approve it.
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button
                ref={keepCancel}
                onClick={() => setKeepOriginalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="contained"
                startIcon={<CheckIcon />}
                disabled={blocked || pending === 0}
                onClick={() => {
                  for (const fact of facts)
                    if (
                      document.review.factReviews[fact.id]?.proposal ===
                      'pending'
                    )
                      queue({ action: 'reject', factId: fact.id });
                  keptOriginal.current = true;
                  setKeepOriginalOpen(false);
                }}
              >
                Keep {pending} original{pending === 1 ? '' : 's'}
              </Button>
            </DialogActions>
          </Dialog>
          {approvedUnchanged && wizardStep === 2 && (
            <Alert severity="success" role="status">
              <Typography sx={{ fontWeight: 600 }}>
                Approved — Ready to export
              </Typography>
              <Typography variant="body2">
                Saved revision {saved.revision} is approved. Download it in
                Approve &amp; Export.
              </Typography>
            </Alert>
          )}
          {approvedRevision && dirty && (
            <Alert severity="warning">
              Local edits are not approved. The approved saved revision remains
              unchanged until you save. Save and approve the changed revision
              before exporting.
            </Alert>
          )}
          {saved &&
            server?.currentProfileRevisionId &&
            document.pins.profileRevisionId !==
              server.currentProfileRevisionId && (
              <Alert
                severity="info"
                aria-label="Earlier CV review"
                action={
                  isWizard ? (
                    <Button
                      startIcon={<AutoAwesomeIcon />}
                      disabled={blocked || dirty}
                      onClick={() => {
                        if (wizardStep === 3) onContinueDraft?.();
                        setGenerateOpen(true);
                        requestAnimationFrame(() =>
                          window.document
                            .getElementById('generate-new-draft')
                            ?.scrollIntoView?.({ block: 'start' }),
                        );
                      }}
                    >
                      Generate a new draft
                    </Button>
                  ) : undefined
                }
              >
                This draft uses an earlier review of your CV. Generate a new
                draft to include your latest corrections.
              </Alert>
            )}
          {document.pins.jobUpdatedAt !== jobRevision && (
            <Alert severity="warning">
              This draft uses an older saved job snapshot. Reviewing it does not
              update its pinned context. Generate a separate draft for the
              current job.
            </Alert>
          )}
          <Paper
            variant="outlined"
            component="section"
            aria-label="Download"
            hidden={wizardStep !== undefined && wizardStep !== 3}
            sx={{ p: { xs: 2, sm: 2.5 } }}
          >
            <Stack spacing={1.5}>
              {approvedUnchanged ? (
                <Alert severity="success" role="status">
                  Revision {saved.revision} is approved and ready to download.
                </Alert>
              ) : (
                <Alert
                  severity="info"
                  action={
                    isWizard &&
                    onContinueDraft &&
                    (dirty ||
                      pending > 0 ||
                      issuesRemaining ||
                      openPlaceholders > 0) ? (
                      <Button onClick={onContinueDraft}>
                        Finish review in Tailor &amp; Review
                      </Button>
                    ) : undefined
                  }
                >
                  {isWizard
                    ? dirty ||
                      pending > 0 ||
                      issuesRemaining ||
                      openPlaceholders > 0
                      ? dirty
                        ? 'You have unsaved review changes. They are kept: finish and save them in Tailor & Review, then approve the saved revision here.'
                        : pending > 0
                          ? `Approval is blocked: ${pending} of ${proposalCards.length} suggestions still need a decision in Tailor & Review. Accept or Keep original both count.`
                          : 'Finish Tailor & Review first: confirm any conflicting facts and save.'
                      : 'Confirm you reviewed the complete CV, then approve this revision to unlock downloads.'
                    : 'Downloads unlock after you decide every suggestion, confirm any conflicting facts, save, and approve this draft.'}
                </Alert>
              )}
              {isWizard && renderApproval(document, saved)}
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                aria-label="Download approved CV"
              >
                {(['docx', 'pdf'] as const).map((format) => (
                  <Button
                    startIcon={<DownloadIcon />}
                    key={format}
                    variant={
                      isWizard && format === 'docx' ? 'contained' : 'outlined'
                    }
                    disabled={
                      blocked ||
                      dirty ||
                      document.review.approval?.revision !== saved.revision
                    }
                    onClick={() =>
                      void run(async (token) => {
                        setExporting(format);
                        try {
                          await downloadDraft(
                            saved.id,
                            saved.revision,
                            format,
                            () => token === epoch.current,
                          );
                          if (token === epoch.current)
                            setMessage(
                              `${format.toUpperCase()} download prepared from approved revision ${saved.revision}.`,
                            );
                        } finally {
                          if (token === epoch.current) setExporting(null);
                        }
                      })
                    }
                  >
                    Download {format.toUpperCase()}
                  </Button>
                ))}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Downloads contain only included, accepted wording. Any later
                edit needs a new save and approval.
              </Typography>
            </Stack>
          </Paper>
          {wizardStep === 3 && (
            <Stack
              component="section"
              spacing={1}
              aria-labelledby="final-preview-title"
            >
              <Typography id="final-preview-title" variant="h6" component="h3">
                Final preview
              </Typography>
              <TailoredCvPreview document={document} />
            </Stack>
          )}
          {!isWizard && (
            <Box
              component="details"
              onToggle={(event) => setPreviewOpen(event.currentTarget.open)}
            >
              <Typography component="summary">Preview assembled CV</Typography>
              {previewOpen && (
                <Stack spacing={1} sx={{ mt: 2 }}>
                  <Typography variant="body2">
                    Content preview reflects your current wording and inclusion
                    choices, including unsaved edits. Downloads require the
                    saved, approved revision.
                  </Typography>
                  <TailoredCvPreview document={document} />
                </Stack>
              )}
            </Box>
          )}
          <Box hidden={wizardStep === 3}>
            {docReview ? (
              <>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: {
                      xs: '1fr',
                      md: 'minmax(0, 1fr) minmax(320px, 400px)',
                    },
                    gap: 3,
                    alignItems: 'start',
                    mb: 2,
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <TailoredCvPreview
                      document={document}
                      anchors={{
                        states: anchorStates,
                        activeId,
                        onSelect: selectSuggestion,
                      }}
                    />
                  </Box>
                  {!mobile && (
                    <Box
                      id="review-panel"
                      component="aside"
                      aria-label="Suggestions"
                      onFocus={(event) => {
                        const id = (event.target as HTMLElement)
                          .closest<HTMLElement>('[id^="suggestion-"]')
                          ?.id.slice('suggestion-'.length);
                        if (id && id !== activeId) setActiveId(id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape' && activeId)
                          closeSuggestion();
                      }}
                      sx={{
                        position: 'sticky',
                        top: 16,
                        maxHeight: 'calc(100vh - 32px)',
                        overflowY: 'auto',
                        overscrollBehavior: 'contain',
                        minWidth: 0,
                        '& [id^="suggestion-"]': { borderRadius: 1 },
                        ...(activeId && {
                          [`& [id="suggestion-${activeId}"]`]: {
                            boxShadow: (t: Theme) =>
                              `0 0 0 2px ${t.palette.primary.main}`,
                          },
                        }),
                      }}
                    >
                      {reviewNav}
                      {unanchoredNote}
                      <Stack spacing={3} sx={{ mb: 2, mt: 2 }}>
                        {groups.map((group) => {
                          const proposals = proposalCards.filter(
                            (card) => card.group === group.key,
                          );
                          const checks =
                            group.key === 'check' ? verificationCards : [];
                          if (!proposals.length && !checks.length) return null;
                          return (
                            <Stack
                              key={group.key}
                              component="section"
                              spacing={1.5}
                              aria-labelledby={`review-group-${group.key}`}
                            >
                              <Typography
                                id={`review-group-${group.key}`}
                                variant="h6"
                                component="h3"
                              >
                                {group.title} (
                                {proposals.length + checks.length})
                                <Typography
                                  component="span"
                                  variant="body2"
                                  color="text.secondary"
                                >
                                  {' '}
                                  · {group.hint}
                                </Typography>
                              </Typography>
                              {checks.map(renderCheck)}
                              {proposals.map(renderProposal)}
                            </Stack>
                          );
                        })}
                      </Stack>
                      {isWizard && wizardStep === 2 && (
                        <Box
                          id="review-action-bar"
                          tabIndex={-1}
                          component="section"
                          aria-label="Review actions"
                          sx={{
                            // Sticky from sm up; on phones it stays in the page flow so it
                            // never covers suggestion text.
                            position: { xs: 'static', sm: 'sticky' },
                            bottom: 0,
                            zIndex: 2,
                            mb: 2,
                            px: { xs: 1.5, sm: 2 },
                            py: 1.25,
                            bgcolor: 'background.paper',
                            border: 1,
                            borderColor: 'divider',
                            borderRadius: 1,
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 1,
                            alignItems: 'center',
                            '&:focus-visible': {
                              outline: '2px solid',
                              outlineColor: 'primary.main',
                            },
                            '& .MuiButton-root': {
                              minHeight: { xs: 44, sm: 40 },
                            },
                          }}
                        >
                          <Typography
                            variant="body2"
                            role="status"
                            sx={{ fontWeight: 600, mr: 'auto', minWidth: 0 }}
                          >
                            {decided} of {proposalCards.length} decided
                            {dirty ? ' · unsaved changes' : ''}
                          </Typography>
                          {pending > 0 && (
                            <>
                              <Button
                                size="small"
                                variant="outlined"
                                disabled={blocked}
                                onClick={() => showSuggestion(undecidedIds[0]!)}
                              >
                                Next undecided
                              </Button>
                              <Button
                                size="small"
                                disabled={blocked}
                                onClick={() => setKeepOriginalOpen(true)}
                              >
                                Keep remaining originals
                              </Button>
                            </>
                          )}
                          {dirty && (
                            <Button
                              startIcon={<SaveIcon />}
                              ref={saveButton}
                              size="small"
                              variant="contained"
                              disabled={
                                blocked || blank || operations.length > 384
                              }
                              onClick={saveDraft}
                            >
                              Save draft
                            </Button>
                          )}
                          {!dirty &&
                            (approvalReady || approvedUnchanged) &&
                            onContinueToApproval && (
                              <Button
                                endIcon={<ArrowForwardIcon />}
                                ref={(el: HTMLButtonElement | null) => {
                                  if (el && focusContinue.current) {
                                    focusContinue.current = false;
                                    el.focus();
                                  }
                                }}
                                size="small"
                                variant="contained"
                                disabled={blocked}
                                onClick={onContinueToApproval}
                              >
                                Continue to Approve &amp; Export
                              </Button>
                            )}
                        </Box>
                      )}
                    </Box>
                  )}
                </Box>
                {mobile && (
                  <>
                    {isWizard && wizardStep === 2 && (
                      <Box
                        id="review-action-bar"
                        tabIndex={-1}
                        component="section"
                        aria-label="Review actions"
                        sx={{
                          // Sticky from sm up; on phones it stays in the page flow so it
                          // never covers suggestion text.
                          position: { xs: 'static', sm: 'sticky' },
                          bottom: 0,
                          zIndex: 2,
                          mb: 2,
                          px: { xs: 1.5, sm: 2 },
                          py: 1.25,
                          bgcolor: 'background.paper',
                          border: 1,
                          borderColor: 'divider',
                          borderRadius: 1,
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 1,
                          alignItems: 'center',
                          '&:focus-visible': {
                            outline: '2px solid',
                            outlineColor: 'primary.main',
                          },
                          '& .MuiButton-root': {
                            minHeight: { xs: 44, sm: 40 },
                          },
                        }}
                      >
                        <Typography
                          variant="body2"
                          role="status"
                          sx={{ fontWeight: 600, mr: 'auto', minWidth: 0 }}
                        >
                          {decided} of {proposalCards.length} decided
                          {dirty ? ' · unsaved changes' : ''}
                        </Typography>
                        {pending > 0 && (
                          <>
                            <Button
                              size="small"
                              variant="outlined"
                              disabled={blocked}
                              onClick={() => showSuggestion(undecidedIds[0]!)}
                            >
                              Next undecided
                            </Button>
                            <Button
                              size="small"
                              disabled={blocked}
                              onClick={() => setKeepOriginalOpen(true)}
                            >
                              Keep remaining originals
                            </Button>
                          </>
                        )}
                        {dirty && (
                          <Button
                            startIcon={<SaveIcon />}
                            ref={saveButton}
                            size="small"
                            variant="contained"
                            disabled={
                              blocked || blank || operations.length > 384
                            }
                            onClick={saveDraft}
                          >
                            Save draft
                          </Button>
                        )}
                        {!dirty &&
                          (approvalReady || approvedUnchanged) &&
                          onContinueToApproval && (
                            <Button
                              endIcon={<ArrowForwardIcon />}
                              ref={(el: HTMLButtonElement | null) => {
                                if (el && focusContinue.current) {
                                  focusContinue.current = false;
                                  el.focus();
                                }
                              }}
                              size="small"
                              variant="contained"
                              disabled={blocked}
                              onClick={onContinueToApproval}
                            >
                              Continue to Approve &amp; Export
                            </Button>
                          )}
                      </Box>
                    )}
                    {reviewSheet}
                  </>
                )}
              </>
            ) : (
              <>
                <Stack spacing={3} sx={{ mb: 2 }}>
                  {groups.map((group) => {
                    const proposals = proposalCards.filter(
                      (card) => card.group === group.key,
                    );
                    const checks =
                      group.key === 'check' ? verificationCards : [];
                    if (!proposals.length && !checks.length) return null;
                    return (
                      <Stack
                        key={group.key}
                        component="section"
                        spacing={1.5}
                        aria-labelledby={`review-group-${group.key}`}
                      >
                        <Typography
                          id={`review-group-${group.key}`}
                          variant="h6"
                          component="h3"
                        >
                          {group.title} ({proposals.length + checks.length})
                          <Typography
                            component="span"
                            variant="body2"
                            color="text.secondary"
                          >
                            {' '}
                            · {group.hint}
                          </Typography>
                        </Typography>
                        {checks.map(renderCheck)}
                        {proposals.map(renderProposal)}
                      </Stack>
                    );
                  })}
                </Stack>
                {isWizard && wizardStep === 2 && (
                  <Box
                    id="review-action-bar"
                    tabIndex={-1}
                    component="section"
                    aria-label="Review actions"
                    sx={{
                      // Sticky from sm up; on phones it stays in the page flow so it
                      // never covers suggestion text.
                      position: { xs: 'static', sm: 'sticky' },
                      bottom: 0,
                      zIndex: 2,
                      mb: 2,
                      px: { xs: 1.5, sm: 2 },
                      py: 1.25,
                      bgcolor: 'background.paper',
                      border: 1,
                      borderColor: 'divider',
                      borderRadius: 1,
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 1,
                      alignItems: 'center',
                      '&:focus-visible': {
                        outline: '2px solid',
                        outlineColor: 'primary.main',
                      },
                      '& .MuiButton-root': { minHeight: { xs: 44, sm: 40 } },
                    }}
                  >
                    <Typography
                      variant="body2"
                      role="status"
                      sx={{ fontWeight: 600, mr: 'auto', minWidth: 0 }}
                    >
                      {decided} of {proposalCards.length} decided
                      {dirty ? ' · unsaved changes' : ''}
                    </Typography>
                    {pending > 0 && (
                      <>
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={blocked}
                          onClick={() => showSuggestion(undecidedIds[0]!)}
                        >
                          Next undecided
                        </Button>
                        <Button
                          size="small"
                          disabled={blocked}
                          onClick={() => setKeepOriginalOpen(true)}
                        >
                          Keep remaining originals
                        </Button>
                      </>
                    )}
                    {dirty && (
                      <Button
                        startIcon={<SaveIcon />}
                        ref={saveButton}
                        size="small"
                        variant="contained"
                        disabled={blocked || blank || operations.length > 384}
                        onClick={saveDraft}
                      >
                        Save draft
                      </Button>
                    )}
                    {!dirty &&
                      (approvalReady || approvedUnchanged) &&
                      onContinueToApproval && (
                        <Button
                          endIcon={<ArrowForwardIcon />}
                          ref={(el: HTMLButtonElement | null) => {
                            if (el && focusContinue.current) {
                              focusContinue.current = false;
                              el.focus();
                            }
                          }}
                          size="small"
                          variant="contained"
                          disabled={blocked}
                          onClick={onContinueToApproval}
                        >
                          Continue to Approve &amp; Export
                        </Button>
                      )}
                  </Box>
                )}
              </>
            )}
            <Box
              component="details"
              open={cvOpen}
              onToggle={(event) => setCvOpen(event.currentTarget.open)}
              sx={{ mt: 2, '& > summary': { cursor: 'pointer', py: 1 } }}
            >
              <Typography component="summary">
                Full CV: read your tailored CV
                {excluded > 0
                  ? ` · ${excluded} item${excluded === 1 ? '' : 's'} hidden from download`
                  : ''}
              </Typography>
              <Paper
                variant="outlined"
                sx={{ p: { xs: 2, sm: 3 }, mt: 1, minWidth: 0 }}
              >
                <Stack spacing={3}>
                  {sortSections(document.sections)
                    .filter(
                      (section) =>
                        section.entries.length > 0 ||
                        editing === section.id ||
                        (section.kind === 'contact' &&
                          promotedLinks(document).length > 0),
                    )
                    .map((section) => (
                      <Box
                        key={section.id}
                        component="section"
                        aria-labelledby={`cv-${section.id}`}
                      >
                        <Stack
                          direction={{ xs: 'column', sm: 'row' }}
                          spacing={1}
                          sx={{
                            alignItems: { xs: 'flex-start', sm: 'center' },
                            justifyContent: 'space-between',
                          }}
                        >
                          <Typography
                            id={`cv-${section.id}`}
                            variant="subtitle1"
                            component="h3"
                            sx={{
                              textTransform: 'capitalize',
                              fontWeight: 600,
                            }}
                          >
                            {section.kind}
                          </Typography>
                          <Button
                            disabled={blocked}
                            onClick={() =>
                              setEditing(
                                editing === section.id ? null : section.id,
                              )
                            }
                          >
                            {editing === section.id ? 'Finish editing' : 'Edit'}{' '}
                            {section.kind}
                          </Button>
                        </Stack>
                        {editing !== section.id && (
                          <>
                            <CvSectionView
                              document={document}
                              section={section}
                            />
                            {(() => {
                              const hidden =
                                section.entries.flatMap((e) => e.facts).length -
                                includedEntries(document, section).flatMap(
                                  (e) => e.facts,
                                ).length;
                              return hidden > 0 ? (
                                <Typography
                                  variant="body2"
                                  color="text.secondary"
                                  sx={{ mt: 1 }}
                                >
                                  {hidden} item{hidden === 1 ? '' : 's'} hidden
                                  from download. Choose Edit {section.kind} to
                                  change.
                                </Typography>
                              ) : null;
                            })()}
                          </>
                        )}
                        {editing === section.id && (
                          <Stack spacing={2}>
                            {section.entries.map((entry, index) => (
                              <Stack key={entry.id} spacing={1} sx={{ pt: 1 }}>
                                {section.entries.length > 1 && (
                                  <Typography variant="subtitle2">
                                    Entry {index + 1}
                                  </Typography>
                                )}
                                {entry.facts.map((fact) => {
                                  const state =
                                    document.review.factReviews[fact.id]!;
                                  return (
                                    <Stack spacing={1} key={fact.id}>
                                      {editing === section.id ? (
                                        factField(
                                          fact,
                                          `${fact.field} (${section.kind}, entry ${index + 1})`,
                                        )
                                      ) : (
                                        <Typography
                                          sx={{ whiteSpace: 'pre-wrap' }}
                                        >
                                          {fact.acceptedText}
                                        </Typography>
                                      )}
                                      <Typography
                                        variant="body2"
                                        color="text.secondary"
                                      >
                                        {state.wording === 'user_edited'
                                          ? 'Manually edited'
                                          : state.wording === 'ai_accepted'
                                            ? 'AI wording accepted by you'
                                            : fact.provenance.origin ===
                                                'source'
                                              ? 'Source-derived'
                                              : 'User-entered confirmed fact'}
                                        {!fact.selected
                                          ? ' · Retained, not AI-prioritized'
                                          : ''}
                                      </Typography>
                                      <FormControlLabel
                                        control={
                                          <Checkbox
                                            checked={
                                              state.exportIncluded !== false
                                            }
                                            disabled={blocked}
                                            onChange={(event) =>
                                              queue({
                                                action: 'include',
                                                factId: fact.id,
                                                included: event.target.checked,
                                              })
                                            }
                                          />
                                        }
                                        label={`Include ${fact.field} in download (${section.kind}, entry ${index + 1}) · optional`}
                                      />
                                      {state.exportIncluded === false && (
                                        <Typography variant="body2">
                                          Excluded from downloads; retained in
                                          this saved draft.
                                        </Typography>
                                      )}
                                      <Box component="details">
                                        <Typography
                                          component="summary"
                                          variant="body2"
                                        >
                                          Evidence and wording for {fact.field},
                                          entry {index + 1}
                                        </Typography>
                                        {fact.provenance.evidence.length ? (
                                          fact.provenance.evidence.map(
                                            (ref) => (
                                              <Typography
                                                key={`${ref.start}:${ref.end}`}
                                                component="blockquote"
                                                sx={{
                                                  m: 0,
                                                  p: 1,
                                                  whiteSpace: 'pre-wrap',
                                                }}
                                              >
                                                {ref.quote}
                                              </Typography>
                                            ),
                                          )
                                        ) : (
                                          <Typography variant="body2">
                                            User-entered fact; no
                                            original-source evidence.
                                          </Typography>
                                        )}
                                        {state.wording !==
                                          'reviewed_profile' && (
                                          <Typography variant="body2">
                                            Evidence describes the pinned
                                            profile fact. It does not
                                            independently support your edited
                                            wording.
                                          </Typography>
                                        )}
                                        {state.wording !==
                                          'reviewed_profile' && (
                                          <Button
                                            disabled={blocked || dirty}
                                            onClick={() =>
                                              void run(async (token) => {
                                                const value =
                                                  await draftRequest(
                                                    `/drafts/${saved.id}/review`,
                                                    {
                                                      expectedRevision:
                                                        saved.revision,
                                                      operations: [
                                                        {
                                                          action: 'restore',
                                                          factId: fact.id,
                                                        },
                                                      ],
                                                    },
                                                  );
                                                if (token === epoch.current) {
                                                  accept(value);
                                                  setMessage(
                                                    'Reviewed profile wording restored and saved. Approval cleared.',
                                                  );
                                                }
                                              })
                                            }
                                          >
                                            Restore reviewed wording and save
                                          </Button>
                                        )}
                                      </Box>
                                      {fact.proposedWording &&
                                        state.proposal === 'pending' && (
                                          <Typography
                                            variant="body2"
                                            color="text.secondary"
                                          >
                                            Suggestion waiting for your decision
                                            above.
                                          </Typography>
                                        )}
                                    </Stack>
                                  );
                                })}
                              </Stack>
                            ))}
                          </Stack>
                        )}
                      </Box>
                    ))}
                  {document.sections.some((s) => !s.entries.length) && (
                    <Typography variant="body2" color="text.secondary">
                      Not in your source CV, so nothing was added:{' '}
                      {document.sections
                        .filter((s) => !s.entries.length)
                        .map((s) => s.kind.replaceAll('_', ' '))
                        .join(', ')}
                      .
                    </Typography>
                  )}
                </Stack>
              </Paper>
            </Box>
            <Paper
              variant="outlined"
              component="section"
              aria-label="Save and approve"
              sx={{ p: { xs: 2, sm: 2.5 }, mt: 2 }}
            >
              <Stack spacing={1.5}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  {dirty && (
                    <>
                      {!isWizard && (
                        <Button
                          startIcon={<SaveIcon />}
                          ref={saveButton}
                          variant={dirty ? 'contained' : 'outlined'}
                          disabled={
                            blocked ||
                            !dirty ||
                            blank ||
                            operations.length > 384
                          }
                          onClick={saveDraft}
                        >
                          Save draft
                        </Button>
                      )}
                      <Button
                        variant="outlined"
                        disabled={blocked || !dirty}
                        onClick={() => {
                          setOperations([]);
                          setReviewed(false);
                          setError('');
                        }}
                      >
                        Discard local draft edits
                      </Button>
                    </>
                  )}
                  {/* Drafts load automatically; reload is a recovery step after an error. */}
                  {(!isWizard || !!error) && (
                    <Button
                      startIcon={<RefreshIcon />}
                      disabled={blocked || dirty}
                      onClick={() =>
                        void run(async (token) => {
                          const value = await draftRequest(
                            `/drafts/${saved.id}`,
                          );
                          if (token === epoch.current) accept(value);
                        })
                      }
                    >
                      Reload saved draft
                    </Button>
                  )}
                </Stack>
                {blockingIssues.length > 0 && (
                  <Alert
                    severity="warning"
                    variant="outlined"
                    sx={{ mt: 2 }}
                    aria-label="Conflicting facts to confirm"
                  >
                    <Typography variant="subtitle2" component="h3">
                      Confirm conflicting facts ({blockingIssues.length})
                    </Typography>
                    <Typography variant="body2">
                      Your source CV gives different versions of these facts.
                      Check each one in the full CV below and edit it if needed.
                    </Typography>
                    {blockingIssues.map(({ issue, index }) => (
                      <FormControlLabel
                        key={index}
                        sx={{ display: 'flex', mt: 1 }}
                        control={
                          <Checkbox
                            checked={document.review.acknowledgedIssues.includes(
                              index,
                            )}
                            disabled={
                              blocked ||
                              document.review.acknowledgedIssues.includes(index)
                            }
                            onChange={() =>
                              queue({
                                action: 'acknowledge',
                                issueIndex: index,
                              })
                            }
                          />
                        }
                        label={`I checked this fact against my CV: ${
                          cards.find((c) => c.fact.id === issue.factId)
                            ?.where ?? 'unnamed fact'
                        }`}
                      />
                    ))}
                  </Alert>
                )}
                {!isWizard && renderApproval(document, saved)}
              </Stack>
            </Paper>
            {notes.length > 0 && (
              <Box component="details">
                <Typography component="summary">
                  Review notes ({notes.length}) · no action needed
                </Typography>
                <Stack spacing={2} sx={{ mt: 1 }}>
                  {(
                    [
                      ['handled', 'Handled by your decisions'],
                      ['job', 'About this job match'],
                    ] as const
                  ).map(([kind, title]) => {
                    const items = notes.filter((n) => n.kind === kind);
                    if (!items.length) return null;
                    return (
                      <Box key={kind}>
                        <Typography variant="subtitle2" component="h3">
                          {title} ({items.length})
                        </Typography>
                        <Box
                          component="ul"
                          sx={{ m: 0, pl: 3, typography: 'body2' }}
                        >
                          {items.map((n) => (
                            <li key={n.index}>{n.text}</li>
                          ))}
                        </Box>
                      </Box>
                    );
                  })}
                </Stack>
              </Box>
            )}
            <Box component="details">
              <Typography component="summary">
                Recoverable source content
              </Typography>
              <Typography variant="body2">
                All unselected eligible facts remain in the CV above.
                Structural, superseded and excluded passages remain in the
                pinned source profile.
              </Typography>
              <Button
                disabled={blocked}
                onClick={() =>
                  void run(async (token) => {
                    const source = decodeCvSource(
                      await draftRequest(
                        `/sources/${document.pins.sourceRevisionId}/content`,
                      ),
                    );
                    const profile = decodeCvProfile(
                      await draftRequest(
                        `/profile-revisions/${document.pins.profileRevisionId}`,
                      ),
                      source,
                    );
                    const retained = new Set(
                      facts.map((f) => f.provenance.profileFactId),
                    );
                    const values = profile.document.sections.flatMap((s) =>
                      s.entries.flatMap((e) =>
                        e.facts
                          .filter((f) => !retained.has(f.id))
                          .map((f) => `${s.kind} · ${f.field}: ${f.value}`),
                      ),
                    );
                    values.push(
                      ...profile.document.coverage
                        .filter((r) => r.disposition !== 'mapped')
                        .map(
                          (r) =>
                            `${r.disposition}: ${source.text.slice(r.start, r.end)} — ${r.reason ?? ''}`,
                        ),
                    );
                    if (token === epoch.current) setRecoverable(values);
                  })
                }
              >
                Show pinned recoverable passages
              </Button>
              {recoverable?.map((text, i) => (
                <Typography key={i} sx={{ whiteSpace: 'pre-wrap', my: 1 }}>
                  {text}
                </Typography>
              ))}
              {recoverable?.length === 0 && (
                <Typography>
                  No additional passages outside accepted content.
                </Typography>
              )}
            </Box>
            <Box component="details">
              <Typography component="summary">Draft details</Typography>
              <Typography variant="body2" color="text.secondary">
                Draft {saved.id.slice(0, 8)} · Pinned source{' '}
                {document.pins.sourceRevisionId.slice(0, 8)} · Profile revision{' '}
                {document.pins.profileRevision} · Job snapshot{' '}
                {document.pins.jobUpdatedAt}
              </Typography>
            </Box>
          </Box>
        </>
      )}
    </Stack>
  );
}
