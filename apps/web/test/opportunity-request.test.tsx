import { afterEach, expect, test, vi } from 'vitest';
import { opportunityRequest } from '../src/features/inbox/opportunities-api';

const respond = (response: Response | Promise<Response>) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => response),
  );
afterEach(() => vi.unstubAllGlobals());

test('an empty successful body resolves to null', async () => {
  respond(new Response(null, { status: 200 }));
  await expect(opportunityRequest('/cv/current')).resolves.toBeNull();
});

test('a JSON body is parsed', async () => {
  respond(Response.json({ fileName: 'cv.pdf' }));
  await expect(opportunityRequest('/cv/current')).resolves.toEqual({
    fileName: 'cv.pdf',
  });
});

test('non-2xx, network errors and malformed JSON still fail', async () => {
  respond(new Response('', { status: 500 }));
  await expect(opportunityRequest('')).rejects.toThrow(/local API/);
  respond(Promise.reject(new TypeError('offline')));
  await expect(opportunityRequest('')).rejects.toThrow('offline');
  respond(new Response('{oops', { status: 200 }));
  await expect(opportunityRequest('')).rejects.toThrow(SyntaxError);
});
