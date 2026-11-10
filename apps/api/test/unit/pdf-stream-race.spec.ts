import { expect, test } from '@jest/globals';
import { isLateStreamEnqueue } from '../../src/extraction/pdf-stream-race.js';

function closedEnqueueError(): unknown {
  let caught: unknown;
  new ReadableStream({
    start(controller) {
      controller.close();
      try {
        controller.enqueue('late');
      } catch (error: unknown) {
        caught = error;
      }
    },
  });
  return caught;
}

test('matches only the real late enqueue into a closed stream', () => {
  expect(isLateStreamEnqueue(closedEnqueueError())).toBe(true);
});

test.each([
  [
    'other ERR_INVALID_STATE',
    Object.assign(new TypeError('Invalid state: other'), {
      code: 'ERR_INVALID_STATE',
    }),
  ],
  [
    'same message, no code',
    new TypeError('Invalid state: Controller is already closed'),
  ],
  [
    'same code and message, not a TypeError',
    Object.assign(new Error('Invalid state: Controller is already closed'), {
      code: 'ERR_INVALID_STATE',
    }),
  ],
  ['generic parser failure', new Error('PARSING_FAILED')],
  ['non-error value', 'Invalid state: Controller is already closed'],
])('does not hide %s', (_, error) => {
  expect(isLateStreamEnqueue(error)).toBe(false);
});
