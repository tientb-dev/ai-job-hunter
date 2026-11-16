import { expect, test, vi } from 'vitest';

vi.unmock('../src/features/inbox/link-sources');
const { loadLinkSources } = await import('../src/features/inbox/link-sources');

test('reads enabled link sources from the server', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({ sources: ['ITviec', 'TopCV', 42] }),
  );
  vi.stubGlobal('fetch', fetch);
  expect(await loadLinkSources()).toEqual(['ITviec', 'TopCV']);
  expect(fetch.mock.calls[0]![0]).toBe('/api/v1/opportunities/import-sources');
});
test('falls back to ITviec only when the request fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('', { status: 500 })),
  );
  expect(await loadLinkSources()).toEqual(['ITviec']);
});
