// pdf.js can enqueue into a text stream we already cancelled (e.g. after
// DOCUMENT_TOO_LARGE). That late error escapes every await, so on slow CPUs it
// would crash the parser worker before it reports the real result. Match only
// that exact error; anything else must still crash the worker (fail closed).
export function isLateStreamEnqueue(error: unknown): boolean {
  // Compare by name, not instanceof: stream errors may come from another realm.
  if (typeof error !== 'object' || error === null) return false;
  const { name, code, message } = error as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
  };
  return (
    name === 'TypeError' &&
    code === 'ERR_INVALID_STATE' &&
    message === 'Invalid state: Controller is already closed'
  );
}
