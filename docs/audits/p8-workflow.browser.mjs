// Run through Playwright MCP against p8-workflow.probe.mjs's isolated fixture.
// Records only boolean diagnostics, reason codes and opaque revision IDs.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
export async function runWorkflowAcceptance(page, url) {
  const output = '/home/tientb/projects/ai-job-hunter/artifacts/p8-workflow/';
  const errors = [];
  page.on('pageerror', () => errors.push('PAGE_ERROR'));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE_ERROR');
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await page.evaluate(() => {
    Date.now = () => new Date().getTime() + 16 * 60 * 1000;
  });
  await page.getByRole('tab', { name: 'Improve CV' }).click();
  await page
    .getByRole('button', { name: 'Review source CV', exact: true })
    .click();
  for (const section of [
    'Personal details',
    'Links',
    'Professional summary',
    'Skills',
    'Experience',
    'Education',
  ])
    await page
      .getByRole('button', { name: `Confirm ${section} section`, exact: true })
      .click();
  await page
    .getByRole('button', { name: 'Save source review', exact: true })
    .click();
  await page.getByText(/6 of 6 sections reviewed/).waitFor();
  await page
    .getByRole('button', { name: 'Continue to tailored CV', exact: true })
    .click();
  await page.getByText(/Source review saved. Check readiness below/).waitFor();
  assert.equal(
    await page
      .locator('#tailored-cv-title')
      .evaluate((e) => e === globalThis.document.activeElement),
    true,
  );
  await page.getByRole('tab', { name: 'CV Match', exact: true }).click();
  await page
    .getByRole('button', { name: 'Analyze CV Match', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Reanalyze CV Match', exact: true })
    .waitFor({ timeout: 180000 });
  await page.getByRole('tab', { name: 'Improve CV', exact: true }).click();
  await page.waitForFunction(
    () =>
      [...globalThis.document.querySelectorAll('button')].some(
        (b) => b.textContent.trim() === 'Generate new draft' && !b.disabled,
      ),
    {},
    { timeout: 30000 },
  );
  assert.equal(
    await page
      .getByRole('button', { name: 'Suggest improvements', exact: true })
      .isDisabled(),
    true,
  );
  const generationStarted = Date.now();
  const generated = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      /\/jobs\/[^/]+\/drafts$/.test(new URL(r.url()).pathname),
    { timeout: 210000 },
  );
  await page
    .getByRole('button', { name: 'Generate new draft', exact: true })
    .click();
  const response = await generated;
  assert.equal(response.ok(), true);
  const draft = await response.json();
  const generationLatencyMs = Date.now() - generationStarted;
  await page
    .getByText('New draft generated. Existing drafts are unchanged.')
    .waitFor();
  await page
    .getByRole('button', { name: 'Load saved drafts', exact: true })
    .click();
  await page.getByText(/Loaded 1 saved draft/).waitFor();
  const open = page.getByRole('button', { name: /^Open [0-9a-f]{8}/ });
  await open.waitFor();
  await open.click();
  await page.getByRole('tab', { name: 'CV Match', exact: true }).click();
  await page.getByRole('tab', { name: 'Improve CV', exact: true }).click();
  await page.waitForFunction(() =>
    [...globalThis.document.querySelectorAll('button')].some(
      (b) => b.textContent.trim() === 'Generate new draft' && !b.disabled,
    ),
  );
  // Replace the real server match while the UI still holds the old ID. This
  // exercises the same authoritative rejection path as TTL expiry, without a wait.
  const jobId = new URL(url).pathname.split('/').at(-1);
  const replacement = await page.request.post(
    `http://127.0.0.1:3001/api/v1/opportunities/${jobId}/match`,
    { headers: { Origin: 'http://127.0.0.1:3001' }, data: {}, timeout: 180000 },
  );
  assert.equal(replacement.ok(), true);
  await page.evaluate(() =>
    globalThis.window.dispatchEvent(new Event('focus')),
  );
  await page.getByText(/CV Match expired, was replaced/).waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: 'Generate new draft', exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByRole('button', { name: 'Refresh CV Match', exact: true })
    .click();
  await page.waitForFunction(
    () =>
      [...globalThis.document.querySelectorAll('button')].some(
        (b) => b.textContent.trim() === 'Generate new draft' && !b.disabled,
      ),
    {},
    { timeout: 180000 },
  );
  const section = page.getByRole('region', {
    name: 'Tailored CV',
    exact: true,
  });
  await section.screenshot({ path: output + 'review-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.evaluate(() => ({
    width: globalThis.innerWidth,
    scrollWidth: globalThis.document.documentElement.scrollWidth,
  }));
  assert.equal(mobile.width, mobile.scrollWidth);
  await section.screenshot({ path: output + 'review-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => (globalThis.document.body.style.zoom = '2'));
  const zoom = await page.evaluate(() => ({
    width: globalThis.innerWidth,
    scrollWidth: globalThis.document.documentElement.scrollWidth,
  }));
  assert.equal(zoom.width, zoom.scrollWidth);
  await section.screenshot({ path: output + 'review-zoom.png' });
  await page.evaluate(() => (globalThis.document.body.style.zoom = '1'));
  assert.deepEqual(errors, []);
  const report = {
    syntheticOnly: true,
    pass: true,
    sourceSectionsReviewed: 6,
    generateEnabledAfterTabNavigation: true,
    clientClockSkewMs: 16 * 60 * 1000,
    generationLatencyMs,
    persistedDraftId: draft.id,
    pinnedProfileRevisionId: draft.document.pins.profileRevisionId,
    serverMismatchRecovery: true,
    sourceReviewRepeated: false,
    cvUploadRepeated: false,
    continueFeedback: true,
    savedDraftListFeedback: true,
    mobile,
    zoom,
    errors,
  };
  await writeFile(
    output + 'browser-results.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  return report;
}
