import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Dashboard } from '../src/features/dashboard/Dashboard';
import { JobsPanel } from '../src/features/dashboard/JobsPanel';
import { decodeJobs } from '../src/features/dashboard/jobs-api';
import { decodeAnalysis } from '../src/features/dashboard/analysis-api';
import { cvSkills, rankJobs } from '../src/features/dashboard/jobs-ranking';
const enabled = process.env.REAL_JOBS_SMOKE === '1';
const nativeFetch = globalThis.fetch;
const endpoint = 'http://127.0.0.1:5173';
function liveHttp() {
  // Real production HTTP, not mocked job data. No Analyze or AI request occurs.
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (url !== '/api/v1/jobs')
      throw Error('Only public jobs may be fetched by this smoke');
    return nativeFetch(endpoint + url, init);
  });
}
test.runIf(enabled)(
  'normal dashboard renders live source jobs with original URLs',
  async () => {
    const response = await nativeFetch(endpoint + '/api/v1/jobs');
    expect(response.ok).toBe(true);
    const feed = decodeJobs(await response.json());
    expect(feed.jobs.length).toBeGreaterThan(0);
    liveHttp();
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );
    const links = await screen.findAllByRole(
      'link',
      { name: feed.jobs[0]!.title },
      { timeout: 15000 },
    );
    expect(
      links.some((link) => link.getAttribute('href') === feed.jobs[0]!.url),
    ).toBe(true);
    expect(
      screen.getByRole('list', { name: 'Job listings' }).children.length,
    ).toBeGreaterThan(0);
  },
);
test.runIf(enabled)(
  'live job ordering uses a production-parsed synthetic CV without AI',
  async () => {
    const cv = decodeAnalysis(
      JSON.parse(readFileSync(process.env.JOBS_SYNTHETIC_CV_RESULT!, 'utf8')),
      true,
    );
    if (!cv.documents?.cv?.text.includes('Alex Example'))
      throw Error('Synthetic fixture required');
    const response = await nativeFetch(endpoint + '/api/v1/jobs');
    const feed = decodeJobs(await response.json());
    const skills = cvSkills(cv),
      ranked = rankJobs(feed.jobs, skills);
    expect(skills.map((skill) => skill.name)).toContain('TypeScript');
    expect(ranked[0]!.matchedSkills.length).toBeGreaterThan(0);
    liveHttp();
    render(<JobsPanel analysis={cv} />);
    await screen.findByText(/CV terms used for ordering:/);
    const list = await screen.findByRole(
      'list',
      { name: 'Job listings' },
      { timeout: 15000 },
    );
    expect(within(list).getAllByRole('heading')[0]).toHaveTextContent(
      ranked[0]!.job.title,
    );
  },
);
