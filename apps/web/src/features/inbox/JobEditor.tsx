import { DuplicateJobNotice } from './DuplicateJobNotice';
import {
  ArrowBackIcon,
  ArrowForwardIcon,
  AutoAwesomeIcon,
  DeleteIcon,
  DownloadIcon,
  EditIcon,
  SaveIcon,
} from '../../components/icons';
import { StatusChip } from '../../components/StatusChip';
import { useNotify } from '../../components/useNotify';
import { JobInterviewTab } from './JobInterviewTab';
import { SourceJdPreview } from './SourceJdPreview';
import { ImportMethodCards, type ImportMethod } from './ImportMethodCards';
import { JobActionLayout } from './JobActionLayout';
import { nextJobAction } from './next-action';
import { WorkflowStepIcon } from '../../components/WorkflowStepIcon';
import {
  workflowStepState,
  workflowStepperSx,
} from '../../components/workflow-step';
import { RequirementInputs } from './RequirementInputs';
import { UnsavedJobGuard } from './UnsavedJobGuard';
import { TopcvBookmarkletInstall } from './TopcvBookmarkletInstall';
import { receiveTopcvPage } from './topcv-bookmarklet';
import {
  applyUrlJobPreview,
  canFetchJobUrl,
  urlImportHelp,
  type UrlJobPreview,
} from './job-url-import';
import { CvMatchPanel, type MatchPanelSummary } from './CvMatchPanel';
import { dueFollowUp, useLocalCalendarDate } from './follow-ups';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Link as MuiLink,
  Stack,
  Tabs,
  Tab,
  Stepper,
  Step,
  StepLabel,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import {
  emptyOpportunity,
  fieldLabels,
  importFields,
  importUpload,
  jobUrlInfo,
  opportunityRequest,
  sources,
  statuses,
  followUpStatuses,
} from './opportunities-api';
import type {
  ImportFieldName,
  ImportPreview,
  Opportunity,
  OpportunityInput,
} from './opportunities-api';
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : 'Request failed. Retry or enter fields manually.';
/** Tab labels with badges derived only from loaded data; absent data shows none. */
function workspaceTabs({
  summary,
  followUp,
  followUpDate,
  jobUpdatedAt,
}: {
  summary: MatchPanelSummary | null;
  followUp: string | null;
  followUpDate: string | null;
  jobUpdatedAt: string;
}) {
  const draft = summary?.draft;
  const badge = (text: string, warn = false) => ({ text, warn });
  return [
    { label: 'Overview', value: 'overview', badge: null },
    {
      label: 'Match',
      value: 'match',
      badge:
        summary?.matchStatus === 'VALID' && summary.score !== null
          ? badge(`${summary.score}%`)
          : ['STALE_CV', 'STALE_JOB', 'EXPIRED'].includes(
                summary?.matchStatus ?? '',
              )
            ? badge('Outdated', true)
            : null,
    },
    {
      label: 'Tailored CV',
      value: 'tailored-cv',
      // Revision numbers say nothing about review state, so only staleness shows.
      badge:
        draft && jobUpdatedAt && draft.jobUpdatedAt !== jobUpdatedAt
          ? badge('Outdated', true)
          : null,
    },
    {
      label: 'Application',
      value: 'application',
      badge: followUp
        ? badge(followUp, true)
        : followUpDate
          ? badge(
              new Date(`${followUpDate}T00:00`).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              }),
            )
          : null,
    },
    // Last, so existing tab and panel indices stay stable.
    { label: 'Interview', value: 'interview', badge: null },
  ] as const;
}
const latestContactDate = (dates: string[]) =>
  dates.reduce((latest, date) => (date > latest ? date : latest), '');

const workspaceViews = [
  'overview',
  'match',
  'tailored-cv',
  'application',
  'interview',
  'edit',
] as const;
type WorkspaceView = (typeof workspaceViews)[number];
// Pre-workspace links used ?tab=; Improve CV advice now lives under Match.
const legacyTabs: Record<string, WorkspaceView> = {
  match: 'match',
  improve: 'match',
  application: 'application',
};

export function JobEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  // Each workspace section has its own URL under /jobs/:id; the component stays
  // mounted across sections, so hidden form and review state is preserved.
  const base = `/jobs/${id}`;
  const segment = location.pathname.slice(base.length + 1).split('/')[0] ?? '';
  const view: WorkspaceView =
    id && (workspaceViews as readonly string[]).includes(segment)
      ? (segment as WorkspaceView)
      : 'overview';
  const legacyTab = new URLSearchParams(location.search).get('tab');
  const setView = (next: WorkspaceView) => {
    if (next !== view) navigate(next === 'overview' ? base : `${base}/${next}`);
  };
  const [savedRevision, setSavedRevision] = useState(0);
  const [savedJobUpdatedAt, setSavedJobUpdatedAt] = useState('');
  const [sourceCvDirty, setSourceCvDirty] = useState(false);
  const [tailoredDirty, setTailoredDirty] = useState(false);
  const [summary, setSummary] = useState<MatchPanelSummary | null>(null);
  // Re-read draft and source state each time Overview is shown.
  const [overviewVisits, setOverviewVisits] = useState(0);
  const previousView = useRef(view);
  useEffect(() => {
    // Returning to Overview, not the first render, triggers the re-read.
    if (view === 'overview' && previousView.current !== 'overview')
      setOverviewVisits((n) => n + 1);
    previousView.current = view;
  }, [view]);
  const today = useLocalCalendarDate();
  const [step, setStep] = useState(0);
  const stepper = useRef<HTMLDivElement>(null);
  const shownStep = useRef(step);
  useEffect(() => {
    // Page scroll: bring the new step into view, but not on first render.
    if (shownStep.current === step) return;
    shownStep.current = step;
    stepper.current?.scrollIntoView?.({ block: 'start' });
  }, [step]);
  const [importMethod, setImportMethod] = useState<ImportMethod>('url');
  const theme = useTheme();
  const phoneTabs = useMediaQuery(theme.breakpoints.down('sm'));
  const applicationPanel = useRef<HTMLDivElement>(null);
  const editPanel = useRef<HTMLDivElement>(null);
  const jobDetailsHeading = useRef<HTMLHeadingElement>(null);
  const [formHeight, setFormHeight] = useState<number | null>(null);
  const baseline = useRef(JSON.stringify(emptyOpportunity()));
  const savedNavigation = useRef(false);
  const [form, setForm] = useState<OpportunityInput>(emptyOpportunity);
  const formSnapshot = useRef(form);
  formSnapshot.current = form;
  const urlFetchRunning = useRef(false);
  const sourceGeneration = useRef(0);
  const fetchedJob = useRef<UrlJobPreview | null>(null);
  const editedFields = useRef(new Set<keyof OpportunityInput>());
  const [loading, setLoading] = useState(Boolean(id));
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [sourceErrors, setSourceErrors] = useState<
    Partial<Record<ImportMethod, string>>
  >({});
  const parseRequest = useRef<AbortController | null>(null);
  const parseGeneration = useRef(0);
  useEffect(
    () => () => {
      sourceGeneration.current++;
      parseGeneration.current++;
      parseRequest.current?.abort();
    },
    [],
  );
  const [file, setFile] = useState<File>();
  const [jdText, setJdText] = useState('');
  const [discovery, setDiscovery] = useState<Opportunity['discovery']>(null);
  const [error, setError] = useState('');
  const notify = useNotify();
  const saving = useRef(false);
  const [notice, setNotice] = useState('');
  const [contactDate, setContactDate] = useState('');
  useEffect(() => {
    if (!id) return;
    let active = true;
    opportunityRequest<Opportunity>(`/${id}`)
      .then(
        (row) => {
          if (!active) return;
          const defaults = emptyOpportunity();
          const editable = Object.fromEntries(
            Object.keys(defaults).map((key) => [
              key,
              row[key as keyof OpportunityInput] ??
                defaults[key as keyof OpportunityInput],
            ]),
          ) as unknown as OpportunityInput;
          editedFields.current.clear();
          baseline.current = JSON.stringify(editable);
          setForm(editable);
          setSavedJobUpdatedAt(row.updatedAt);
          setContactDate(latestContactDate(editable.contactDates));
          setDiscovery(row.discovery);
          setError('');
        },
        (error) => {
          if (active) {
            setError(message(error));
            setLoadFailed(true);
          }
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);
  useEffect(() => {
    if (id) return;
    return receiveTopcvPage(
      window,
      (payload) => {
        const generation = ++sourceGeneration.current;
        setBusy(true);
        setError('');
        setSourceErrors((errors) => ({ ...errors, bookmarklet: '' }));
        void opportunityRequest<UrlJobPreview>('/import-page', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
          .then((result) => {
            if (generation !== sourceGeneration.current) return;
            const next = applyUrlJobPreview(
              formSnapshot.current,
              result,
              editedFields.current,
              fetchedJob.current,
            );
            fetchedJob.current = result;
            setImportMethod('bookmarklet');
            setForm(next);
            setNotice(
              `${result.expired ? 'This listing is expired. ' : ''}JD loaded from ${result.platform}. ${(result.importWarnings ?? []).join(' ')}`,
            );
          })
          .catch((error) => {
            if (generation !== sourceGeneration.current) return;
            setError(message(error));
            setSourceErrors((errors) => ({
              ...errors,
              bookmarklet: message(error),
            }));
          })
          .finally(() => {
            if (generation === sourceGeneration.current) setBusy(false);
          });
      },
      (error) => setError(error),
    );
  }, [id]);
  const change = <K extends keyof OpportunityInput>(
    key: K,
    value: OpportunityInput[K],
  ) => {
    if (key === 'originalLink' && urlFetchRunning.current) {
      sourceGeneration.current++;
      urlFetchRunning.current = false;
      setBusy(false);
    }
    if (importFields.includes(key as ImportFieldName) || key === 'description')
      editedFields.current.add(key);
    setForm((row) => ({ ...row, [key]: value }));
  };
  const sourcesChanged = () => {
    setForm((row) => ({ ...row, importReview: [] }));
    setNotice(
      'Sources changed. Extract again or review the current fields manually before saving.',
    );
  };
  const conflicts = form.importReview.filter(
    (field) => field.status === 'CONFLICT' && !field.reviewed,
  );
  async function extract() {
    if (id) return;
    if (
      form.importReview.length &&
      !window.confirm(
        'Refresh the AI suggestions? Your manually edited values will be kept.',
      )
    )
      return;
    setExtracting(true);
    setError('');
    setNotice('');
    try {
      const result = await opportunityRequest<ImportPreview>('/extract', {
        method: 'POST',
        body: importUpload({ postText: form.postText }, file),
      });
      setJdText(result.jdText);
      if (result.error) {
        setError(result.error);
        setForm((row) => ({
          ...row,
          description: row.description || result.description,
          importReview: [],
        }));
      } else {
        const suggested = Object.fromEntries(
          result.fields.map((field) => [field.field, field.value]),
        ) as Record<ImportFieldName, string>;
        setForm((row) => ({
          ...row,
          ...Object.fromEntries(
            Object.entries(suggested).filter(([key, value]) => {
              if (editedFields.current.has(key as ImportFieldName))
                return false;
              // Clear obsolete automatic domain/work-mode suggestions when no
              // supporting evidence remains. Intentional edits stay protected.
              if (!value.trim()) {
                if (
                  ['workMode', 'domain'].includes(key) &&
                  fetchedJob.current?.[key as 'workMode' | 'domain'] &&
                  row.postText.includes(fetchedJob.current.sourceText)
                )
                  return false;
                return (
                  ['domain', 'workMode'].includes(key) &&
                  result.fields.find((field) => field.field === key)?.status ===
                    'MISSING'
                );
              }
              // URL source fields remain available even if AI omits them,
              // shortens them, or returns an unresolved conflict.
              const fetched = fetchedJob.current;
              if (
                key === 'experience' &&
                result.fields.find((field) => field.field === key)?.status ===
                  'SUPPORTED'
              )
                return true;
              return !(
                fetched &&
                row.postText.includes(fetched.sourceText) &&
                [
                  'title',
                  'company',
                  'location',
                  'originalLink',
                  'salary',
                  'experience',
                  'workMode',
                  'domain',
                ].includes(key) &&
                row[key as ImportFieldName]
              );
            }),
          ),
          description:
            editedFields.current.has('description') ||
            (fetchedJob.current &&
              row.postText.includes(fetchedJob.current.sourceText) &&
              row.description)
              ? row.description
              : result.description || row.description,
          importReview: result.fields,
        }));
        setNotice(
          `Review every suggestion before saving. Manually edited values are kept.${result.rejected ? ` ${result.rejected} unsupported proposal(s) were discarded.` : ''}`,
        );
      }
      setStep(1);
      if (result.warnings.length)
        setNotice(
          (previous) =>
            `${previous} Document warnings: ${result.warnings.join(', ')}. Check the original for missing content.`,
        );
    } catch (error) {
      setError(message(error));
    } finally {
      setExtracting(false);
    }
  }
  async function fetchFromUrl() {
    if (
      id ||
      urlFetchRunning.current ||
      disabled ||
      !canFetchJobUrl(form.originalLink)
    )
      return;
    if (
      fetchedJob.current &&
      fetchedJob.current.originalLink !== form.originalLink &&
      !window.confirm(
        'Replace the previously fetched job with this URL? Manually edited fields and separately entered text will be kept.',
      )
    )
      return;
    const generation = ++sourceGeneration.current;
    const requestedUrl = form.originalLink;
    urlFetchRunning.current = true;
    setSourceErrors((errors) => ({ ...errors, url: '' }));
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await opportunityRequest<UrlJobPreview>('/import-url', {
        method: 'POST',
        body: JSON.stringify({ url: form.originalLink }),
      });
      if (
        generation !== sourceGeneration.current ||
        formSnapshot.current.originalLink !== requestedUrl
      )
        return;
      const next = applyUrlJobPreview(
        formSnapshot.current,
        result,
        editedFields.current,
        fetchedJob.current,
      );
      fetchedJob.current = result;
      setForm(next);
      setNotice(
        `${result.expired ? 'This listing is expired. ' : ''}JD loaded from ${result.platform}. Review it, then use Extract with AI when ready.`,
      );
    } catch (error) {
      if (generation !== sourceGeneration.current) return;
      setError(message(error));
      setSourceErrors((errors) => ({ ...errors, url: message(error) }));
    } finally {
      if (generation === sourceGeneration.current) {
        urlFetchRunning.current = false;
        setBusy(false);
      }
    }
  }
  async function save() {
    if (saving.current) return;
    const reportSaveError = (text: string) => {
      if (id) {
        notify({
          severity: 'error',
          text: `${text} Your inputs are retained; you can edit fields manually.`,
        });
      } else {
        setError(text);
      }
    };
    if (!form.title.trim()) {
      reportSaveError('Enter a job title before saving.');
      if (id) setView('edit');
      else setStep(1);
      return;
    }
    if (!jobUrlInfo(form.originalLink).valid) {
      reportSaveError(
        'Enter a full HTTP(S) job URL without credentials, or leave it blank.',
      );
      return;
    }
    if (conflicts.length) {
      reportSaveError('Review every conflicting field before saving.');
      return;
    }
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      const payload = {
        ...form,
        // Replace only the previously displayed latest entry; hidden history survives.
        contactDates:
          contactDate === latestContactDate(form.contactDates)
            ? form.contactDates
            : [
                ...new Set([
                  ...form.contactDates.filter(
                    (date) => date !== latestContactDate(form.contactDates),
                  ),
                  ...(contactDate ? [contactDate] : []),
                ]),
              ],
      };
      const record = JSON.stringify(payload);
      const row = await opportunityRequest<Opportunity>(id ? `/${id}` : '', {
        method: id ? 'PUT' : 'POST',
        body:
          file || record.length > 20000 ? importUpload(payload, file) : record,
      });
      if (id) {
        setSavedRevision((value) => value + 1);
        setSavedJobUpdatedAt(row.updatedAt);
        baseline.current = JSON.stringify({
          ...form,
          contactDates: row.contactDates,
        });
        setForm((current) => ({ ...current, contactDates: row.contactDates }));
        setContactDate(latestContactDate(row.contactDates));
        setFile(undefined);
        notify({ severity: 'success', text: 'Changes saved' });
      } else {
        savedNavigation.current = true;
        navigate(`/jobs/${row.id}`, { replace: true });
      }
    } catch (error) {
      reportSaveError(message(error));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function attach(document: File) {
    if (id) return;
    setFile(undefined);
    setJdText('');
    if (
      !/\.(pdf|docx)$/i.test(document.name) ||
      !document.size ||
      document.size > 5 * 1024 * 1024
    ) {
      setError('Use a PDF or DOCX up to 5 MiB, or paste text instead.');
      return;
    }
    setError('');
    sourcesChanged();
    setSourceErrors((errors) => ({ ...errors, upload: '' }));
    const generation = ++parseGeneration.current;
    parseRequest.current?.abort();
    const controller = new AbortController();
    parseRequest.current = controller;
    setParsing(true);
    try {
      const type = /\.pdf$/iu.test(document.name)
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const parsed = await opportunityRequest<{
        text: string;
        warnings: { code: string }[];
      }>('/parse-document', {
        method: 'POST',
        body: new Blob([document], { type }),
        headers: { 'Content-Type': type },
        signal: controller.signal,
      });
      if (generation !== parseGeneration.current) return;
      if (typeof parsed.text !== 'string' || !parsed.text.trim())
        throw new Error(
          'No readable document text found. Paste the JD or choose another supported document.',
        );
      setFile(document);
      setJdText(parsed.text);
      if (parsed.warnings?.length)
        setNotice(
          `Document warnings: ${parsed.warnings.map((warning) => warning.code).join(', ')}. Check the original document.`,
        );
    } catch (error) {
      if (generation === parseGeneration.current)
        setSourceErrors((errors) => ({ ...errors, upload: message(error) }));
    } finally {
      if (generation === parseGeneration.current) setParsing(false);
    }
  }
  const dirty =
    JSON.stringify(form) !== baseline.current ||
    Boolean(file) ||
    contactDate !== latestContactDate(form.contactDates);
  const disabled = busy || extracting || parsing || loadFailed;
  // The Tailored CV review only exists while its tab is mounted.
  const reviewDirty = view === 'tailored-cv' && tailoredDirty;
  const saved = JSON.parse(baseline.current) as OpportunityInput;
  const nextAction =
    id && summary
      ? nextJobAction({
          followUp: dueFollowUp(
            saved.followUpDate,
            saved.status,
            today,
            saved.followUpStatus,
          ),
          status: saved.status,
          cvSaved: summary.cvSaved,
          sourceReason: summary.sourceReason,
          matchStatus: summary.matchStatus,
          draft: summary.draft && {
            pending: summary.draft.pending,
            approved: summary.draft.approved,
            outdated:
              !!savedJobUpdatedAt &&
              summary.draft.jobUpdatedAt !== savedJobUpdatedAt,
          },
        })
      : null;
  useLayoutEffect(() => {
    if (!id || view !== 'edit' || loading) return;
    // The mobile shell can leave the details heading below the field viewport.
    // Reveal it once on entry, after the existing bounded shell has settled.
    const frame = requestAnimationFrame(() => {
      const heading = jobDetailsHeading.current;
      const fields = heading?.closest<HTMLElement>(
        '[aria-label="Scrollable job fields"]',
      );
      if (!heading || !fields) return;
      const headingRect = heading.getBoundingClientRect();
      const fieldsRect = fields.getBoundingClientRect();
      if (headingRect.bottom > fieldsRect.bottom)
        fields.scrollTop += headingRect.top - fieldsRect.top;
    });
    return () => cancelAnimationFrame(frame);
  }, [id, view, loading]);
  useLayoutEffect(() => {
    const panel =
      view === 'edit' ? editPanel.current : applicationPanel.current;
    const main = panel?.closest('main');
    const actions = panel?.querySelector<HTMLElement>(
      '[aria-label="Job save actions"]',
    );
    if (
      !id ||
      (view !== 'application' && view !== 'edit') ||
      !panel ||
      !main ||
      !actions
    ) {
      setFormHeight(null);
      return;
    }
    const measure = () => {
      const rem =
        parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const style = getComputedStyle(panel);
      const available = Math.floor(
        window.innerHeight -
          (panel.getBoundingClientRect().top + window.scrollY) -
          parseFloat(getComputedStyle(main).paddingBottom),
      );
      const chrome =
        parseFloat(style.paddingTop) +
        parseFloat(style.paddingBottom) +
        parseFloat(style.borderTopWidth) +
        parseFloat(style.borderBottomWidth) +
        actions.getBoundingClientRect().height;
      // Keep a usable form region; narrow/short windows use one document scroller.
      setFormHeight(
        window.innerWidth >= theme.breakpoints.values.md &&
          available - chrome >= 12 * rem
          ? available
          : null,
      );
    };
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(measure);
    [panel, main, actions].forEach((element) => observer?.observe(element));
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [id, view, loading, theme.breakpoints.values.md]);
  if (loading) return <CircularProgress aria-label="Loading job" />;
  const importSources = (
    <Box hidden={!id && step !== 0}>
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack spacing={2}>
          {!id && (
            <Typography variant="h6" component="h2">
              How would you like to add this job?
            </Typography>
          )}
          <ImportMethodCards
            value={importMethod}
            onChange={(method) => {
              if (method === importMethod) return;
              sourceGeneration.current++;
              urlFetchRunning.current = false;
              setBusy(false);
              parseGeneration.current++;
              parseRequest.current?.abort();
              setParsing(false);
              if (importMethod === 'upload') {
                setSourceErrors((errors) => ({ ...errors, upload: '' }));
                setFile(undefined);
                setJdText('');
                sourcesChanged();
              }
              setError('');
              setNotice('');
              setImportMethod(method);
            }}
            panelId="job-import-panel"
            disabled={extracting || loadFailed || saving.current}
          />
          <Box
            id="job-import-panel"
            role="region"
            aria-label="Import method input"
            sx={{ minWidth: 0 }}
          >
            {importMethod === 'url' && (
              <Stack spacing={1.5}>
                <TextField
                  label="Original Job URL (optional)"
                  type="url"
                  value={form.originalLink}
                  onChange={(e) => change('originalLink', e.target.value)}
                  error={!jobUrlInfo(form.originalLink).valid}
                  slotProps={{ htmlInput: { maxLength: 2048 } }}
                  helperText={
                    !jobUrlInfo(form.originalLink).valid
                      ? 'Enter a full HTTP(S) URL without credentials, or leave it blank.'
                      : jobUrlInfo(form.originalLink).platform &&
                        `Platform: ${jobUrlInfo(form.originalLink).platform}.`
                  }
                />
                <Button
                  startIcon={<DownloadIcon />}
                  variant="outlined"
                  sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
                  disabled={disabled || !canFetchJobUrl(form.originalLink)}
                  onClick={() => void fetchFromUrl()}
                  aria-describedby="url-import-help"
                >
                  {urlFetchRunning.current ? 'Fetching JD…' : 'Fetch from URL'}
                </Button>
                <Typography
                  id="url-import-help"
                  variant="body2"
                  color="text.secondary"
                >
                  {!form.originalLink || canFetchJobUrl(form.originalLink)
                    ? 'Direct fetch supports ITviec only and runs when you click Fetch from URL.'
                    : urlImportHelp(form.originalLink)}
                </Typography>
              </Stack>
            )}
            {importMethod === 'bookmarklet' && <TopcvBookmarkletInstall />}
            {importMethod === 'paste' && (
              <Stack spacing={1.5}>
                <TextField
                  label="Recruitment post"
                  multiline
                  minRows={4}
                  maxRows={12}
                  value={form.postText}
                  onChange={(e) => {
                    change('postText', e.target.value);
                    sourcesChanged();
                  }}
                  slotProps={{ htmlInput: { maxLength: 12000 } }}
                  helperText="Paste the entire post, including contact details and links. Up to 12,000 characters. The original text is preserved when saved."
                />
              </Stack>
            )}
            {importMethod === 'upload' && (
              <Stack spacing={1.5}>
                <Box>
                  <Typography component="label" htmlFor="jd-document">
                    Upload JD document (PDF or DOCX)
                  </Typography>
                  <input
                    id="jd-document"
                    type="file"
                    accept=".pdf,.docx"
                    disabled={disabled}
                    onChange={(e) => {
                      const selected = e.target.files?.[0];
                      if (selected) void attach(selected);
                      e.target.value = '';
                    }}
                  />
                  {file && (
                    <Stack direction="row" spacing={1}>
                      <Typography>{file.name}</Typography>
                      <Button
                        startIcon={<DeleteIcon />}
                        variant="outlined"
                        type="button"
                        onClick={() => {
                          parseGeneration.current++;
                          parseRequest.current?.abort();
                          setSourceErrors((errors) => ({
                            ...errors,
                            upload: '',
                          }));
                          setFile(undefined);
                          setJdText('');
                          sourcesChanged();
                        }}
                      >
                        Remove selected document
                      </Button>
                    </Stack>
                  )}
                </Box>
                <Typography variant="body2" color="text.secondary">
                  Optional PDF/DOCX up to 5 MiB and 20 PDF pages. Original
                  document is preserved on save. Scans/OCR, images and legacy
                  DOC are unsupported; paste text instead.
                </Typography>
              </Stack>
            )}
          </Box>
          {importMethod !== 'paste' && (
            <SourceJdPreview
              text={importMethod === 'upload' ? jdText : form.postText}
              source={
                importMethod === 'upload'
                  ? `Document${file?.name ? ` · ${file.name}` : ''}`
                  : (fetchedJob.current?.platform ??
                    jobUrlInfo(form.originalLink).platform ??
                    (importMethod === 'bookmarklet'
                      ? 'Bookmarklet'
                      : 'Job URL'))
              }
              loading={
                importMethod === 'upload' ? parsing : urlFetchRunning.current
              }
              error={
                sourceErrors[importMethod] &&
                sourceErrors[importMethod] === error
                  ? 'Loading this source failed. See the request error above, or use Paste JD.'
                  : sourceErrors[importMethod]
              }
            />
          )}
          <TextField
            select
            label="Source"
            value={form.source}
            onChange={(e) =>
              change('source', e.target.value as OpportunityInput['source'])
            }
            helperText="Choose the platform yourself; AI does not infer it. Use Other for LinkedIn or another platform."
          >
            {sources.map((value) => (
              <MenuItem key={value} value={value}>
                {value}
              </MenuItem>
            ))}
          </TextField>
          {(form.postText.trim() || file) && (
            <Typography variant="body2" color="text.secondary">
              Source text is retained when switching methods. Leaving Upload JD
              removes the selected document.
            </Typography>
          )}
          <Button
            startIcon={<AutoAwesomeIcon />}
            type="button"
            variant="outlined"
            sx={{ alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
            disabled={disabled || (!form.postText.trim() && !file)}
            onClick={() => void extract()}
          >
            {extracting ? 'Extracting…' : 'Extract with AI'}
          </Button>
          <Typography variant="body2" color="text.secondary">
            Uses the configured local Ollama model only when you click Extract.
            You can also enter fields manually and save without AI.
          </Typography>
          {extracting && (
            <Typography role="status">
              Reading sources and extracting suggestions… This may take up to 90
              seconds after document parsing.
            </Typography>
          )}
          {notice && <Alert severity="info">{notice}</Alert>}
        </Stack>
      </Paper>
      {!id && (
        <Button
          endIcon={<ArrowForwardIcon />}
          sx={{ mt: 2 }}
          variant="contained"
          onClick={() => setStep(1)}
        >
          Continue to Review &amp; Save
        </Button>
      )}
    </Box>
  );
  const saveActions = (
    <Stack
      spacing={1}
      direction={{ xs: 'column', sm: 'row' }}
      sx={{
        display: id
          ? view === 'edit'
            ? undefined
            : 'none'
          : step === 1
            ? undefined
            : 'none',
        bgcolor: 'background.paper',
        ...(id
          ? {
              alignItems: 'flex-end',
              justifyContent: 'flex-end',
            }
          : { justifyContent: 'flex-end' }),
      }}
    >
      {!id && (
        <Button
          startIcon={<ArrowBackIcon />}
          variant="outlined"
          disabled={disabled}
          onClick={() => setStep(0)}
        >
          Back to Import sources
        </Button>
      )}
      <Button
        startIcon={<SaveIcon />}
        type="submit"
        form="job-editor-form"
        variant="contained"
        disabled={disabled || conflicts.length > 0}
        sx={id ? { minHeight: { xs: 44, sm: 36 } } : undefined}
      >
        {busy ? 'Saving…' : id ? 'Save changes' : 'Confirm and save job'}
      </Button>
    </Stack>
  );
  return (
    <Stack spacing={3} sx={{ minWidth: 0 }}>
      {id && legacyTab && (
        <Navigate
          replace
          to={
            legacyTabs[legacyTab] && legacyTabs[legacyTab] !== 'overview'
              ? `${base}/${legacyTabs[legacyTab]}`
              : base
          }
        />
      )}
      <UnsavedJobGuard
        dirty={dirty || sourceCvDirty}
        sourceCvDirty={sourceCvDirty || reviewDirty}
        savedNavigation={savedNavigation}
        allowPath={(path) =>
          // Sections share one mounted editor; only the Tailored CV review
          // unmounts when its tab is left.
          id !== undefined &&
          (path === base || path.startsWith(`${base}/`)) &&
          !(reviewDirty && path !== `${base}/tailored-cv`)
        }
      />
      <JobActionLayout
        scrollable={false}
        scrollKey={id ? view : String(step)}
        feedbackKey={error}
        active={!id && step === 1}
        actions={!id ? saveActions : null}
      >
        <Stack spacing={id ? 1.5 : 3} sx={{ minWidth: 0 }}>
          {id ? (
            <Breadcrumbs
              aria-label="Job breadcrumb"
              sx={{ alignSelf: 'flex-start', minWidth: 0, maxWidth: '100%' }}
            >
              <MuiLink
                component={Link}
                to="/jobs"
                aria-label="Back to Jobs"
                color="text.secondary"
                underline="hover"
                variant="body2"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.5,
                  minHeight: { xs: 44, sm: 32 },
                  '&:focus-visible': {
                    outline: '2px solid',
                    outlineColor: 'primary.main',
                    outlineOffset: 2,
                    borderRadius: 0.5,
                  },
                }}
              >
                <ArrowBackIcon sx={{ fontSize: 20 }} />
                Jobs
              </MuiLink>
              <Typography
                variant="body2"
                color="text.secondary"
                aria-current="page"
              >
                Job details
              </Typography>
            </Breadcrumbs>
          ) : (
            <Button
              component={Link}
              to="/jobs"
              variant="outlined"
              startIcon={<ArrowBackIcon sx={{ fontSize: 20 }} />}
              sx={{ alignSelf: 'flex-start', minHeight: { xs: 44, sm: 36 } }}
            >
              Back to Jobs
            </Button>
          )}
          <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            <Typography variant="h4" component="h1">
              {id ? form.title || 'Job details' : 'Add job'}
            </Typography>
            <Typography variant={id ? 'body2' : 'body1'} color="text.secondary">
              {id ? (
                <>
                  <Box
                    component="span"
                    sx={{ color: 'text.primary', fontWeight: 500 }}
                  >
                    {form.company}
                  </Box>
                  {form.company && form.location ? ' · ' : ''}
                  {form.location}
                </>
              ) : (
                'Import your sources, then review and save. You can also enter a job manually.'
              )}
            </Typography>
            {id && (
              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                sx={{ flexWrap: 'wrap', alignItems: 'center', mt: 0.5 }}
              >
                {form.status && <StatusChip status={form.status} />}
                {[form.seniority, form.workMode, form.salary]
                  .filter(
                    (value) => value.trim() && !/^unknown\b/iu.test(value),
                  )
                  .map((value, index) => (
                    <Typography
                      key={index}
                      variant="body2"
                      color="text.secondary"
                      sx={{ lineHeight: '1.5rem' }}
                    >
                      {value}
                    </Typography>
                  ))}
                <Chip
                  label="Unsaved changes"
                  size="small"
                  color="warning"
                  aria-hidden={!dirty}
                  sx={{ display: dirty ? 'inline-flex' : 'none' }}
                />
              </Stack>
            )}
            {!id && dirty && (
              <Chip
                label="Unsaved changes"
                size="small"
                color="warning"
                sx={{ mt: 1 }}
              />
            )}
            {id &&
              (discovery ||
                (form.originalLink && jobUrlInfo(form.originalLink).valid)) && (
                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  sx={{ flexWrap: 'wrap', alignItems: 'center', mt: 0.5 }}
                  aria-label={discovery ? 'Discovery provenance' : 'Job source'}
                >
                  <Typography variant="body2" color="text.secondary">
                    {discovery
                      ? `Source: ${discovery.sourceName} · ${new Date(discovery.discoveredAt).toLocaleDateString()}`
                      : `Source: ${form.source}`}
                  </Typography>
                  {form.originalLink && jobUrlInfo(form.originalLink).valid && (
                    <MuiLink
                      href={form.originalLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        minHeight: { xs: 44, sm: 24 },
                        typography: 'body2',
                      }}
                    >
                      Open original job
                    </MuiLink>
                  )}
                </Stack>
              )}
          </Box>
          {id ? (
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{
                alignItems: { xs: 'stretch', sm: 'center' },
                minWidth: 0,
                borderBottom: 1,
                borderColor: 'divider',
                pb: { xs: 1, sm: 0 },
              }}
            >
              <Tabs
                value={view === 'edit' ? false : view}
                onChange={(_, value: WorkspaceView) => setView(value)}
                // Phones: all four tabs in a 2x2 grid, so none hide behind
                // scroll arrows; wider screens keep the single scrollable row.
                variant={phoneTabs ? 'standard' : 'scrollable'}
                scrollButtons={phoneTabs ? false : true}
                allowScrollButtonsMobile={!phoneTabs}
                sx={{
                  minWidth: 0,
                  maxWidth: '100%',
                  '& .MuiTabs-scroller': {
                    overflowX: 'auto',
                    overscrollBehaviorX: 'contain',
                    scrollPaddingInline: '2px',
                  },
                  '& .MuiTabs-list': {
                    width: 'max-content',
                    minWidth: '100%',
                    px: '2px',
                  },
                  minHeight: 44,
                  flex: 1,
                  '& .MuiTab-root': {
                    flexShrink: 0,
                    minHeight: 44,
                    textTransform: 'none',
                    px: 2,
                    py: 1,
                    fontWeight: 500,
                    color: 'text.secondary',
                  },
                  '& .MuiTab-root.Mui-selected': {
                    bgcolor: 'action.selected',
                    color: 'primary.main',
                    fontWeight: 600,
                    borderRadius: '6px 6px 0 0',
                  },
                  '& .MuiTab-root.Mui-focusVisible': {
                    outline: '2px solid',
                    outlineColor: 'primary.main',
                    outlineOffset: -3,
                  },
                  '& .MuiTabs-scrollButtons': {
                    display: { xs: 'inline-flex', md: 'none' },
                  },
                  '& .MuiTabs-scrollButtons.Mui-disabled': { opacity: 0.3 },
                  // Badges wrap under the label rather than clipping it.
                  '& .MuiTab-root .MuiStack-root': { flexWrap: 'wrap' },
                  // Last, so these replace the scrollable-row rules above.
                  ...(phoneTabs && {
                    '& .MuiTabs-list': {
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 0.5,
                    },
                    '& .MuiTabs-indicator': { display: 'none' },
                    '& .MuiTab-root.MuiTab-root': {
                      maxWidth: 'none',
                      borderRadius: 1.5,
                      border: 1,
                      borderColor: 'divider',
                    },
                    '& .MuiTab-root.Mui-selected': {
                      borderColor: 'primary.main',
                      borderRadius: 1.5,
                    },
                  }),
                }}
                aria-label="Job sections"
              >
                {workspaceTabs({
                  summary,
                  followUp: dueFollowUp(
                    saved.followUpDate,
                    saved.status,
                    today,
                    saved.followUpStatus,
                  ),
                  followUpDate: saved.followUpDate,
                  jobUpdatedAt: savedJobUpdatedAt,
                }).map(({ label, value, badge }, index) => (
                  <Tab
                    key={value}
                    value={value}
                    id={`job-tab-${index}`}
                    aria-controls={`job-panel-${index}`}
                    label={
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center' }}
                      >
                        <span>{label}</span>
                        {badge && (
                          <Typography
                            component="span"
                            variant="caption"
                            sx={{
                              color: badge.warn
                                ? 'error.dark'
                                : 'text.secondary',
                              fontWeight: 500,
                            }}
                          >
                            {badge.text}
                          </Typography>
                        )}
                      </Stack>
                    }
                  />
                ))}
              </Tabs>
              <Button
                startIcon={<EditIcon />}
                component={Link}
                to={`${base}/edit`}
                size="small"
                variant="outlined"
                aria-current={view === 'edit' ? 'page' : undefined}
                sx={{
                  flexShrink: 0,
                  minHeight: 36,
                  alignSelf: { xs: 'flex-end', sm: 'center' },
                  // One primary per view: Save stays the only filled button.
                  '&[aria-current="page"]': {
                    bgcolor: 'action.selected',
                    fontWeight: 600,
                  },
                }}
              >
                Edit JD
              </Button>
            </Stack>
          ) : (
            <Stepper
              activeStep={step}
              alternativeLabel
              ref={stepper}
              aria-label="Add job steps"
              sx={workflowStepperSx}
            >
              {['Import sources', 'Review & Save'].map((label, index) => {
                const state = workflowStepState(index, step, index < step);
                return (
                  <Step
                    key={label}
                    aria-current={state === 'current' ? 'step' : undefined}
                  >
                    <StepLabel
                      icon={
                        <WorkflowStepIcon number={index + 1} state={state} />
                      }
                      optional={
                        <Typography component="span" variant="caption">
                          {state === 'current'
                            ? 'Current'
                            : state === 'completed'
                              ? 'Complete'
                              : 'Next'}
                        </Typography>
                      }
                    >
                      {label}
                    </StepLabel>
                  </Step>
                );
              })}
            </Stepper>
          )}
          {id && (
            <Box
              role="tabpanel"
              id="job-panel-0"
              aria-labelledby="job-tab-0"
              hidden={view !== 'overview'}
            >
              {nextAction && (
                <Paper
                  variant="outlined"
                  component="section"
                  aria-labelledby="next-action-title"
                  sx={{
                    p: 2,
                    mb: 2,
                    borderLeft: 4,
                    borderLeftColor: 'primary.main',
                    display: 'flex',
                    flexDirection: { xs: 'column', sm: 'row' },
                    gap: 1.5,
                    alignItems: { sm: 'center' },
                    justifyContent: 'space-between',
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      id="next-action-title"
                      variant="subtitle2"
                      component="h2"
                    >
                      Next suggested action
                    </Typography>
                    <Typography>{nextAction.text}</Typography>
                  </Box>
                  <Button
                    component={Link}
                    to={
                      nextAction.to === '/cv'
                        ? '/cv'
                        : `${base}/${nextAction.to}`
                    }
                    variant="contained"
                    sx={{
                      flexShrink: 0,
                      alignSelf: { xs: 'stretch', sm: 'center' },
                    }}
                  >
                    {nextAction.label}
                  </Button>
                </Paper>
              )}
              <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
                <Stack spacing={2}>
                  <Typography
                    variant="h6"
                    component="h2"
                    sx={{ fontWeight: 600 }}
                  >
                    Job overview
                  </Typography>
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                      gap: 2,
                    }}
                  >
                    {(
                      [
                        'experience',
                        'domain',
                        'skills',
                        'preferredSkills',
                        'contactNotes',
                      ] as const
                    ).map((field) => (
                      <Box key={field}>
                        <Typography
                          variant="subtitle2"
                          color="text.secondary"
                          sx={{ mb: 0.5 }}
                        >
                          {fieldLabels[field]}
                        </Typography>
                        <Typography
                          sx={{
                            whiteSpace: 'pre-line',
                            overflowWrap: 'anywhere',
                          }}
                        >
                          {form[field]
                            ? form[field].split('\n').slice(0, 5).join('\n')
                            : 'Unknown'}
                        </Typography>
                        {form[field].split('\n').length > 5 && (
                          <Box component="details">
                            <Typography component="summary" variant="body2">
                              Show all {fieldLabels[field].toLowerCase()}
                            </Typography>
                            <Typography
                              sx={{
                                whiteSpace: 'pre-line',
                                overflowWrap: 'anywhere',
                              }}
                            >
                              {form[field]}
                            </Typography>
                          </Box>
                        )}
                      </Box>
                    ))}
                  </Box>
                  <Box component="details">
                    <Typography
                      component="summary"
                      variant="subtitle1"
                      sx={{ fontWeight: 600 }}
                    >
                      Full job description
                    </Typography>
                    <Typography
                      sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                    >
                      {form.description || 'Unknown'}
                    </Typography>
                  </Box>
                </Stack>
              </Paper>
            </Box>
          )}

          {!id && <DuplicateJobNotice url={form.originalLink} />}
          {error && (
            <Alert severity="error">
              {error} Your inputs are retained; you can edit fields manually.
            </Alert>
          )}
          {id && !loading && !loadFailed && (
            <CvMatchPanel
              key={id}
              jobId={id}
              revision={`${savedRevision}:${JSON.stringify(form)}`}
              jobUpdatedAt={savedJobUpdatedAt}
              jobDirty={dirty}
              onReviewDirtyChange={setSourceCvDirty}
              view={view === 'match' ? 'match' : 'hidden'}
              onSummary={setSummary}
              summaryRefresh={overviewVisits}
              onGoToMatch={() => {
                setView('match');
                document
                  .getElementById('job-tab-1')
                  ?.focus({ preventScroll: true });
              }}
            />
          )}
          {id && !loading && !loadFailed && view === 'tailored-cv' && (
            <Box role="tabpanel" id="job-panel-2" aria-labelledby="job-tab-2">
              {dirty ? (
                <Alert severity="info">
                  Save job changes in Edit JD before opening Tailored CV.
                </Alert>
              ) : (
                <CvMatchPanel
                  key={id}
                  jobId={id}
                  revision={savedJobUpdatedAt}
                  jobUpdatedAt={savedJobUpdatedAt}
                  view="improve"
                  wizard
                  onReviewDirtyChange={setTailoredDirty}
                />
              )}
            </Box>
          )}
          {id && !loading && !loadFailed && view === 'interview' && (
            <JobInterviewTab
              key={`interview-${id}`}
              jobId={id}
              jobDirty={dirty}
            />
          )}
          <Box
            component="form"
            id="job-editor-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (!id && step === 0) {
                setStep(1);
                return;
              }
              void save();
            }}
          >
            <Stack
              component="fieldset"
              disabled={extracting || loadFailed || saving.current}
              spacing={3}
              useFlexGap
              sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}
            >
              <Stack
                ref={editPanel}
                role={id ? 'tabpanel' : undefined}
                id="job-panel-4"
                aria-label={id ? 'Edit JD' : undefined}
                spacing={3}
                sx={{
                  display: id && view !== 'edit' ? 'none' : undefined,
                  ...(id && {
                    border: 1,
                    borderColor: 'divider',
                    borderRadius: 1,
                    bgcolor: 'background.paper',
                    p: { xs: 2, sm: 3 },
                    minWidth: 0,
                    height: formHeight ?? undefined,
                  }),
                }}
              >
                <JobActionLayout
                  active={Boolean(id) && view === 'edit'}
                  scrollable={
                    Boolean(id) && view === 'edit' && formHeight !== null
                  }
                  feedbackKey={error}
                  actions={id ? saveActions : null}
                >
                  {!id && importSources}
                  <Stack
                    spacing={2}
                    sx={{
                      display: (id ? view === 'edit' : step === 1)
                        ? undefined
                        : 'none',
                    }}
                  >
                    <Typography
                      ref={jobDetailsHeading}
                      variant="h6"
                      component="h2"
                    >
                      {id ? 'Job details' : 'Review & Save'}
                    </Typography>
                    <Typography color="text.secondary">
                      Unknown values can stay blank. Only job title is required.
                      Quotes show textual support; verify that each value
                      describes this job.
                    </Typography>
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: {
                          xs: '1fr',
                          sm: 'repeat(2, minmax(0, 1fr))',
                        },
                        gap: 2,
                      }}
                    >
                      {importFields.map((field) => {
                        const review = form.importReview.find(
                          (item) => item.field === field,
                        );
                        const conflict = review?.status === 'CONFLICT';
                        const multiline = [
                          'contactNotes',
                          'skills',
                          'preferredSkills',
                        ].includes(field);
                        const maxLength =
                          field === 'title' || field === 'company'
                            ? 300
                            : field === 'originalLink'
                              ? 2048
                              : multiline
                                ? 10000
                                : 2000;
                        return (
                          <Stack
                            spacing={1}
                            key={field}
                            sx={{
                              minWidth: 0,
                              gridColumn: multiline ? '1 / -1' : undefined,
                            }}
                          >
                            {field === 'skills' ||
                            field === 'preferredSkills' ? (
                              <RequirementInputs
                                label={fieldLabels[field]}
                                value={form[field]}
                                maxLength={maxLength}
                                error={Boolean(conflict && !review.reviewed)}
                                helperText={
                                  conflict
                                    ? 'Review conflicting source values below.'
                                    : review?.status === 'MISSING'
                                      ? 'Missing / unknown — no supported value found.'
                                      : undefined
                                }
                                onChange={(value) => {
                                  change(field, value);
                                  if (conflict)
                                    change(
                                      'importReview',
                                      form.importReview.map((item) =>
                                        item.field === field
                                          ? { ...item, reviewed: false }
                                          : item,
                                      ),
                                    );
                                }}
                              />
                            ) : (
                              <TextField
                                label={fieldLabels[field]}
                                placeholder={
                                  field === 'title' ? undefined : 'Unknown'
                                }
                                required={field === 'title'}
                                type={field === 'originalLink' ? 'url' : 'text'}
                                multiline={multiline}
                                minRows={multiline ? 2 : undefined}
                                maxRows={multiline ? 8 : undefined}
                                value={form[field]}
                                onChange={(e) => {
                                  change(field, e.target.value);
                                  if (conflict)
                                    change(
                                      'importReview',
                                      form.importReview.map((item) =>
                                        item.field === field
                                          ? { ...item, reviewed: false }
                                          : item,
                                      ),
                                    );
                                }}
                                slotProps={{ htmlInput: { maxLength } }}
                                error={Boolean(conflict && !review.reviewed)}
                                helperText={
                                  conflict
                                    ? 'Conflicting source values. Choose a value, type a correction, or leave unknown; acknowledge below.'
                                    : review?.status === 'MISSING'
                                      ? 'Missing / unknown — no supported value found.'
                                      : review
                                        ? field === 'company'
                                          ? 'Suggested company or JD issuer. This does not identify an unnamed end-client.'
                                          : undefined
                                        : undefined
                                }
                              />
                            )}
                            {review && review.candidates.length > 0 && (
                              <Box component="details" open={conflict}>
                                <Typography
                                  component="summary"
                                  variant="subtitle2"
                                >
                                  {conflict
                                    ? 'Conflicting evidence'
                                    : 'Source evidence'}
                                </Typography>
                                <Stack spacing={1}>
                                  {review.candidates.map((candidate, index) => (
                                    <Box
                                      key={index}
                                      sx={{
                                        p: 1,
                                        bgcolor: 'action.hover',
                                        overflowWrap: 'anywhere',
                                      }}
                                    >
                                      <Typography variant="body2">
                                        {candidate.source === 'post'
                                          ? 'Recruitment post'
                                          : 'JD document'}
                                        : {candidate.value}
                                      </Typography>
                                      <Typography
                                        component="blockquote"
                                        variant="body2"
                                        sx={{ m: 1, whiteSpace: 'pre-wrap' }}
                                      >
                                        {candidate.quote}
                                      </Typography>
                                      {conflict && (
                                        <Button
                                          variant="outlined"
                                          type="button"
                                          onClick={() => {
                                            change(field, candidate.value);
                                            change(
                                              'importReview',
                                              form.importReview.map((item) =>
                                                item.field === field
                                                  ? { ...item, reviewed: true }
                                                  : item,
                                              ),
                                            );
                                          }}
                                        >
                                          Use this value for{' '}
                                          {fieldLabels[field]}
                                        </Button>
                                      )}
                                    </Box>
                                  ))}
                                </Stack>
                              </Box>
                            )}
                            {conflict && (
                              <FormControlLabel
                                control={
                                  <Checkbox
                                    checked={review.reviewed}
                                    onChange={(e) =>
                                      change(
                                        'importReview',
                                        form.importReview.map((item) =>
                                          item.field === field
                                            ? {
                                                ...item,
                                                reviewed: e.target.checked,
                                              }
                                            : item,
                                        ),
                                      )
                                    }
                                  />
                                }
                                label={`I reviewed the conflict for ${fieldLabels[field]}`}
                              />
                            )}
                          </Stack>
                        );
                      })}
                    </Box>
                    {id && (
                      <TextField
                        select
                        label="Source"
                        value={form.source}
                        onChange={(e) =>
                          change(
                            'source',
                            e.target.value as OpportunityInput['source'],
                          )
                        }
                        helperText="Where this job was originally found."
                      >
                        {sources.map((value) => (
                          <MenuItem key={value} value={value}>
                            {value}
                          </MenuItem>
                        ))}
                      </TextField>
                    )}
                    <TextField
                      label="Job description"
                      multiline
                      minRows={6}
                      maxRows={14}
                      value={form.description}
                      onChange={(e) => change('description', e.target.value)}
                      slotProps={{ htmlInput: { maxLength: 26000 } }}
                      helperText={
                        id
                          ? 'Edit this job description manually. Original imported source text and documents are preserved separately.'
                          : 'Both source texts are included after extraction; edit the description as needed. The original sources are preserved separately.'
                      }
                    />
                  </Stack>
                  <Stack
                    spacing={2}
                    sx={{
                      display: id
                        ? view === 'edit'
                          ? undefined
                          : 'none'
                        : step === 1
                          ? undefined
                          : 'none',
                    }}
                  >
                    {conflicts.length > 0 && (
                      <Alert severity="warning">
                        Review {conflicts.length} conflicting field(s) before
                        saving.
                        {id && view !== 'edit' && (
                          <Button
                            variant="outlined"
                            onClick={() => setView('edit')}
                          >
                            Review conflicts in Edit JD
                          </Button>
                        )}
                      </Alert>
                    )}
                    <Typography variant="body2" color="text.secondary">
                      Save confirms your reviewed values. Nothing is sent to
                      recruiters and no application is submitted. Changes across
                      sections are saved together.
                    </Typography>
                  </Stack>
                </JobActionLayout>
              </Stack>
              <Paper
                ref={applicationPanel}
                role="tabpanel"
                id="job-panel-3"
                aria-labelledby="job-tab-3"
                variant="outlined"
                sx={{
                  display: id && view === 'application' ? 'flex' : 'none',
                  flexDirection: 'column',
                  height: formHeight ?? undefined,
                  p: { xs: 2, sm: 3 },
                  minWidth: 0,
                  '& .MuiInputLabel-root': { color: 'text.secondary' },
                  '& .MuiInputLabel-root.Mui-focused': {
                    color: 'primary.main',
                  },
                  '& .MuiInputLabel-root.Mui-error': { color: 'error.main' },
                  '& .MuiOutlinedInput-root:not(.MuiInputBase-multiline)': {
                    minHeight: 44,
                  },
                  '& .MuiFormHelperText-root': { mx: 0, mt: 0.5 },
                }}
              >
                <JobActionLayout
                  active={Boolean(id) && view === 'application'}
                  scrollable={formHeight !== null}
                  feedbackKey={error}
                  actions={
                    <Stack spacing={2}>
                      {conflicts.length > 0 && (
                        <Alert severity="warning">
                          Review {conflicts.length} conflicting field(s) before
                          saving.
                          <Button
                            variant="outlined"
                            onClick={() => setView('edit')}
                          >
                            Review conflicts in Edit JD
                          </Button>
                        </Alert>
                      )}
                      <Button
                        startIcon={<SaveIcon />}
                        type="submit"
                        variant="contained"
                        disabled={disabled || conflicts.length > 0}
                        sx={{
                          alignSelf: { xs: 'stretch', sm: 'flex-end' },
                          minHeight: { xs: 44, sm: 36 },
                        }}
                      >
                        {busy ? 'Saving…' : 'Save changes'}
                      </Button>
                    </Stack>
                  }
                >
                  <Stack spacing={2} divider={<Divider />}>
                    <Stack spacing={2}>
                      <Typography
                        variant="subtitle1"
                        component="h2"
                        sx={{ fontWeight: 600, lineHeight: 1.5 }}
                      >
                        Application details
                      </Typography>
                      <Box
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: {
                            xs: 'minmax(0, 1fr)',
                            sm: 'repeat(2, minmax(0, 1fr))',
                            md: 'repeat(3, minmax(0, 1fr))',
                          },
                          gap: 2,
                        }}
                      >
                        <TextField
                          select
                          size="small"
                          label="Application status"
                          value={form.status}
                          onChange={(e) =>
                            change(
                              'status',
                              e.target.value as OpportunityInput['status'],
                            )
                          }
                        >
                          {statuses.map((value) => (
                            <MenuItem key={value} value={value}>
                              {value.replaceAll('_', ' ')}
                            </MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          size="small"
                          label="Applied date"
                          type="date"
                          value={form.appliedDate ?? ''}
                          onChange={(e) =>
                            change('appliedDate', e.target.value || null)
                          }
                          helperText="Actual submission date; leave blank if unknown."
                          slotProps={{ inputLabel: { shrink: true } }}
                        />
                        <TextField
                          size="small"
                          label="Application channel"
                          value={form.applicationChannel ?? ''}
                          onChange={(e) =>
                            change('applicationChannel', e.target.value || null)
                          }
                          helperText="How you applied, separate from job source."
                          slotProps={{ htmlInput: { maxLength: 200 } }}
                        />
                      </Box>
                    </Stack>
                    <Stack spacing={2}>
                      <Typography
                        variant="subtitle1"
                        component="h2"
                        sx={{ fontWeight: 600, lineHeight: 1.5 }}
                      >
                        Recruiter contact &amp; follow-up
                      </Typography>
                      <Box
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: {
                            xs: 'minmax(0, 1fr)',
                            sm: 'repeat(2, minmax(0, 1fr))',
                          },
                          gap: 2,
                        }}
                      >
                        <TextField
                          size="small"
                          label="Last HR contact date"
                          helperText="When HR last contacted you. Earlier dates are retained."
                          type="date"
                          value={contactDate}
                          onChange={(e) => {
                            setContactDate(e.target.value);
                          }}
                          slotProps={{ inputLabel: { shrink: true } }}
                        />
                        <TextField
                          size="small"
                          label="Next follow-up date"
                          helperText="When you plan to contact HR; independent of actual contact."
                          type="date"
                          value={form.followUpDate ?? ''}
                          onChange={(e) => {
                            change('followUpDate', e.target.value || null);
                            // Mirrors the server: a new date is a new, pending follow-up.
                            if (e.target.value)
                              change('followUpStatus', 'PENDING');
                          }}
                          slotProps={{ inputLabel: { shrink: true } }}
                        />
                        {form.followUpDate && (
                          <TextField
                            select
                            size="small"
                            label="Follow-up status"
                            helperText="Done or Dismissed hides it from due follow-ups. Application status is unchanged."
                            value={form.followUpStatus}
                            onChange={(e) =>
                              change(
                                'followUpStatus',
                                e.target
                                  .value as OpportunityInput['followUpStatus'],
                              )
                            }
                          >
                            {followUpStatuses.map((value) => (
                              <MenuItem key={value} value={value}>
                                {value[0] + value.slice(1).toLowerCase()}
                              </MenuItem>
                            ))}
                          </TextField>
                        )}
                      </Box>
                    </Stack>
                    <Stack spacing={2}>
                      <Typography
                        variant="subtitle1"
                        component="h2"
                        sx={{ fontWeight: 600, lineHeight: 1.5 }}
                      >
                        Notes
                      </Typography>
                      <TextField
                        size="small"
                        label="Application notes"
                        multiline
                        minRows={3}
                        value={form.notes}
                        onChange={(e) => change('notes', e.target.value)}
                        slotProps={{ htmlInput: { maxLength: 20000 } }}
                      />
                    </Stack>
                  </Stack>
                </JobActionLayout>
              </Paper>
            </Stack>
          </Box>
        </Stack>
      </JobActionLayout>
    </Stack>
  );
}
