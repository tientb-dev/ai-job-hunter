import { expect, test, vi } from 'vitest';
import { render, screen } from './render';
import { AiLimitNotices } from '../src/features/ai/AiLimitNotices';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

test('an AI limit response shows one clear notice and the caller still gets the response', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      json(429, {
        statusCode: 429,
        errorCode: 'AI_DAILY_USER_LIMIT',
        message: 'x',
      }),
    ),
  );
  render(<AiLimitNotices />);
  const first = await fetch('/api/v1/interview-prep/feedback');
  expect(first.status).toBe(429);
  await fetch('/api/v1/opportunities/x/match');
  expect(await screen.findByText(/used today’s AI requests/)).toBeVisible();
  expect(screen.getAllByText(/used today’s AI requests/)).toHaveLength(1);
});

test('/analyses limit codes are recognised; other errors are left to the screen', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(json(429, { errorCode: 'TOO_MANY_ATTEMPTS' }))
      .mockResolvedValueOnce(json(429, { error: { code: 'AI_BUSY' } })),
  );
  render(<AiLimitNotices />);
  await fetch('/api/v1/auth/login');
  await fetch('/api/v1/analyses');
  expect(await screen.findByText(/AI is busy/)).toBeVisible();
  expect(screen.queryByText(/used today/)).toBeNull();
});
