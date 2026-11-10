import { parentPort, workerData } from 'node:worker_threads';
import { ExtractionError } from './extraction.errors.js';
import { parserErrorCodes, validateParseRequest } from './parser.protocol.js';
import { diagnosticFromError } from './pdf-parser.diagnostics.js';
import { isLateStreamEnqueue } from './pdf-stream-race.js';
import type { ParseRequest } from './parser.protocol.js';
import type { ParseResponse } from './parser.protocol.js';

if (!parentPort) throw new Error('Parser worker requires a parent port');
for (const event of ['uncaughtException', 'unhandledRejection'] as const)
  process.on(event, (error: unknown) => {
    if (!isLateStreamEnqueue(error)) throw error;
  });
let response: ParseResponse;
let request: ParseRequest | undefined;
try {
  request = validateParseRequest(workerData);
  // Import inside the guarded path. Parent captures/discards library startup diagnostics.
  const result =
    request.format === 'pdf'
      ? await (await import('./pdf.parser.js')).parsePdf(request.bytes)
      : await (await import('./docx.parser.js')).parseDocx(request.bytes);
  response = { version: 1, ok: true, result };
} catch (error: unknown) {
  const code =
    error instanceof ExtractionError
      ? parserErrorCodes.find((code) => code === error.code)
      : undefined;
  response = {
    version: 1,
    ok: false,
    code: code ?? 'PARSING_FAILED',
    ...(request?.format === 'docx' &&
    (code ?? 'PARSING_FAILED') === 'PARSING_FAILED'
      ? {
          docxFailure:
            error instanceof ExtractionError
              ? (error.docxFailure ?? 'WORKER_FAILED')
              : 'WORKER_FAILED',
        }
      : {}),
    diagnostic:
      request?.format === 'pdf' && request.diagnostics
        ? (diagnosticFromError(error) ?? {
            phase: 'WORKER_STARTUP',
            category: 'OTHER',
            recoveryAttempted: false,
          })
        : null,
  };
}
parentPort.postMessage(response);
parentPort.close();
