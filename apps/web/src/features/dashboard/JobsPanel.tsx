import { SearchIcon } from '../../components/icons';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Link,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import type { AnalysisResponse } from './analysis.types';
import type { JobsResponse } from './jobs.types';
import { loadJobs, parseJobsCv } from './jobs-api';
import { cvSkills, rankJobs } from './jobs-ranking';
import { validateFile, DOCX_MIME } from './analysis-validation';

type FeedState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; data: JobsResponse };
type CvState =
  | { status: 'idle' | 'loading' }
  | { status: 'parsed'; response: AnalysisResponse }
  | { status: 'error'; message: string };
export function JobsPanel({ analysis }: { analysis: AnalysisResponse | null }) {
  const [feed, setFeed] = useState<FeedState>({ status: 'loading' }),
    [revision, setRevision] = useState(0),
    [visible, setVisible] = useState(30);
  const [file, setFile] = useState<File | null>(null),
    [cv, setCv] = useState<CvState>({ status: 'idle' });
  const upload = useRef<AbortController | null>(null),
    generation = useRef(0);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    void loadJobs(controller.signal)
      .then((data) => {
        if (live) setFeed({ status: 'loaded', data });
      })
      .catch(() => {
        if (live) setFeed({ status: 'error' });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      live = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [revision]);
  useEffect(
    () => () => {
      generation.current++;
      upload.current?.abort();
    },
    [],
  );
  const response =
    cv.status === 'parsed'
      ? cv.response
      : cv.status === 'idle'
        ? analysis
        : null;
  const skills = cvSkills(response);
  const rows = feed.status === 'loaded' ? rankJobs(feed.data.jobs, skills) : [];
  return (
    <Stack spacing={3}>
      <Paper
        component="form"
        aria-label="CV job discovery"
        variant="outlined"
        sx={{ p: 2 }}
        onSubmit={(event) => {
          event.preventDefault();
          if (cv.status === 'loading') return;
          const error = validateFile(file ? [file] : []);
          if (error) {
            setCv({ status: 'error', message: error });
            return;
          }
          const controller = new AbortController(),
            id = ++generation.current;
          upload.current = controller;
          const timer = setTimeout(() => controller.abort(), 45000);
          setCv({ status: 'loading' });
          void parseJobsCv(file!, controller.signal)
            .then((result) => {
              if (id !== generation.current) return;
              if (result.outcome === 'PARSED' && result.documents?.cv)
                setCv({ status: 'parsed', response: result });
              else
                setCv({
                  status: 'error',
                  message:
                    'The CV could not be parsed. Review the file and try again. Jobs remain available without personalization.',
                });
            })
            .catch(() => {
              if (id === generation.current)
                setCv({
                  status: 'error',
                  message:
                    'The local CV parser is unavailable. Jobs remain available without personalization.',
                });
            })
            .finally(() => {
              clearTimeout(timer);
              if (id === generation.current) upload.current = null;
            });
        }}
      >
        <Stack spacing={2}>
          <Typography component="h2" variant="h6">
            Upload a CV to order real jobs by skill mentions
          </Typography>
          <Typography>
            No pasted job description or AI call required. Your CV stays local
            to this app and is never sent to the job source.
          </Typography>
          <label htmlFor="jobs-cv">CV for job discovery (PDF or DOCX)</label>
          <input
            id="jobs-cv"
            type="file"
            accept={`.pdf,.docx,application/pdf,${DOCX_MIME}`}
            disabled={cv.status === 'loading'}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              generation.current++;
              upload.current?.abort();
              setCv({ status: 'idle' });
            }}
          />
          <Box>
            <Button
              startIcon={<SearchIcon />}
              type="submit"
              variant="contained"
              disabled={cv.status === 'loading'}
            >
              Use CV to find jobs
            </Button>
          </Box>
          {cv.status === 'loading' && (
            <Typography role="status">Parsing CV without AI…</Typography>
          )}
          {cv.status === 'error' && (
            <Alert severity="warning">{cv.message}</Alert>
          )}
          {response?.documents?.cv && (
            <Box component="details">
              <summary>Parsed CV source</summary>
              <Typography
                sx={{
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  maxHeight: 300,
                  overflow: 'auto',
                }}
              >
                {response.documents.cv.text}
              </Typography>
            </Box>
          )}
        </Stack>
      </Paper>
      <Box>
        <Typography component="h2" variant="h5">
          Real job postings
        </Typography>
        <Typography>
          Source:{' '}
          <Link
            href="https://www.arbeitnow.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            Arbeitnow
          </Link>
          . Latest feed page, primarily Germany/Europe. Availability and
          application requirements must be checked on the original posting.
        </Typography>
      </Box>
      {skills.length > 0 ? (
        <Alert severity="info">
          CV terms used for ordering:{' '}
          {skills.map((skill) => skill.name).join(', ')}. Basis:{' '}
          {skills[0]!.origin}. More unique shared terms appear first; ties use
          newest source date. This is text overlap, not a suitability score or
          proof of experience.
        </Alert>
      ) : (
        <Alert severity="info">
          Not personalized: no usable CV skills are available. Jobs are ordered
          by source date. Upload a CV with an explicit Skills section, or use
          available validated CV skill facts from the CV/JD analysis below.
        </Alert>
      )}
      <Box>
        <Button
          disabled={feed.status === 'loading'}
          onClick={() => {
            setFeed({ status: 'loading' });
            setVisible(30);
            setRevision((value) => value + 1);
          }}
        >
          Refresh jobs
        </Button>
      </Box>
      {feed.status === 'loading' && (
        <Typography role="status">Loading real jobs from Arbeitnow…</Typography>
      )}
      {feed.status === 'error' && (
        <Alert severity="error">
          Could not retrieve jobs from Arbeitnow. Retry Refresh jobs later. No
          sample or fabricated jobs are shown.
        </Alert>
      )}
      {feed.status === 'loaded' && (
        <>
          <Typography variant="body2">
            {rows.length} listings. Source last fetched{' '}
            {new Date(feed.data.fetchedAt).toLocaleString()}. Cached for up to
            five minutes.
            {feed.data.omittedCount > 0
              ? ` ${feed.data.omittedCount} invalid or duplicate source rows omitted.`
              : ''}
          </Typography>
          {rows.length === 0 && (
            <Alert severity="info">
              Arbeitnow returned no job listings. Try Refresh jobs later.
            </Alert>
          )}
          <Stack
            component="ul"
            aria-label="Job listings"
            spacing={2}
            sx={{ listStyle: 'none', p: 0 }}
          >
            {rows.slice(0, visible).map(({ job, matchedSkills }) => (
              <Paper
                component="li"
                key={job.url}
                variant="outlined"
                sx={{ p: 2 }}
              >
                <Stack spacing={1}>
                  <Typography component="h3" variant="h6">
                    <Link
                      href={job.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {job.title}
                    </Link>
                  </Typography>
                  <Typography>
                    {job.company} · {job.location ?? 'Location not provided'}
                    {job.remote === true ? ' · Remote' : ''}
                  </Typography>
                  <Typography variant="body2">
                    Source: {job.source}
                    {job.publishedAt ? (
                      <>
                        {' '}
                        · Listed{' '}
                        <time dateTime={job.publishedAt}>
                          {new Date(job.publishedAt).toLocaleDateString()}
                        </time>
                      </>
                    ) : (
                      ''
                    )}
                  </Typography>
                  {matchedSkills.length > 0 ? (
                    <Stack
                      direction="row"
                      spacing={1}
                      useFlexGap
                      sx={{ flexWrap: 'wrap' }}
                    >
                      {matchedSkills.map((skill) => (
                        <Chip
                          key={skill.name}
                          label={skill.name}
                          size="small"
                        />
                      ))}
                    </Stack>
                  ) : null}
                  <Typography variant="body2">
                    {skills.length === 0
                      ? 'General listing; no CV personalization applied.'
                      : matchedSkills.length
                        ? `${matchedSkills.length} shared CV skill term(s) appear in the title, source tags or description.`
                        : 'No shared CV skill terms found in this listing; review the original posting.'}
                  </Typography>
                  <Link
                    href={job.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View original posting
                  </Link>
                </Stack>
              </Paper>
            ))}
          </Stack>
          {rows.length > visible && (
            <Button onClick={() => setVisible((value) => value + 30)}>
              Show more jobs
            </Button>
          )}
        </>
      )}
    </Stack>
  );
}
