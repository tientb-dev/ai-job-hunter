import {
  boundedPdfLayout,
  PDF_LAYOUT_ITEMS,
  type PdfTextItem,
} from './pdf-layout.js';
import {
  getDocument,
  PasswordResponses,
  Util,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ExtractionError } from './extraction.errors.js';
import { EXTRACTION_LIMITS as limits } from './extraction.limits.js';
import { BundledPdfResources } from './pdf.resources.js';
import { createExtractionSource } from './extraction.validation.js';
import type {
  PdfFailureCategory,
  PdfFailurePhase,
  PdfWorkerFailureDiagnostic,
} from './pdf-parser.diagnostics.js';
import type { SourceSegment } from './extraction.types.js';
import type { ParsedDocument } from './parser.protocol.js';

class RecoverablePdfTextStreamError extends Error {}
const PDF_HEADER_SCAN_BYTES = 1024;
const PDF_HEADER_SIGNATURE = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
class PdfParserFailure extends ExtractionError {
  constructor(
    code: ConstructorParameters<typeof ExtractionError>[0],
    readonly parserDiagnostic: PdfWorkerFailureDiagnostic,
  ) {
    super(code);
  }
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  const scanEnd = Math.min(bytes.length, PDF_HEADER_SCAN_BYTES);
  const lastStart = scanEnd - PDF_HEADER_SIGNATURE.length;
  for (let start = 0; start <= lastStart; start++) {
    let matched = true;
    for (let index = 0; index < PDF_HEADER_SIGNATURE.length; index++) {
      if (bytes[start + index] !== PDF_HEADER_SIGNATURE[index]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

function isRecoverableTextStreamError(error: unknown): boolean {
  return error instanceof Error && error.name === 'UnknownErrorException';
}
function category(error: unknown): PdfFailureCategory {
  if (!(error instanceof Error)) return 'OTHER';
  if (error.name === 'InvalidPDFException') return 'PDFJS_DOCUMENT_REJECTED';
  if (error.name === 'UnknownErrorException') return 'UNKNOWN_PDFJS';
  if (error.name === 'PasswordException') return 'PASSWORD';
  if (error.name === 'AbortException') return 'ABORT';
  return 'OTHER';
}
function failure(
  error: unknown,
  phase: PdfFailurePhase,
  recoveryAttempted: boolean,
  code: ConstructorParameters<typeof ExtractionError>[0] = error instanceof
  ExtractionError
    ? error.code
    : 'PARSING_FAILED',
  categoryOverride?: PdfFailureCategory,
): PdfParserFailure {
  if (error instanceof PdfParserFailure) return error;
  return new PdfParserFailure(code, {
    phase,
    category: categoryOverride ?? category(error),
    recoveryAttempted,
  });
}

async function parsePdfAttempt(
  bytes: Uint8Array,
  stopAtErrors: boolean,
  recoveryUsed: boolean,
): Promise<ParsedDocument> {
  const resources = new BundledPdfResources();
  let phase: PdfFailurePhase = 'DOCUMENT_LOAD';
  class ResourceFactory {
    fetch(input: { kind: string; filename: string }) {
      return resources.fetch(input);
    }
  }
  const loading = (() => {
    try {
      return getDocument({
        data: bytes,
        BinaryDataFactory: ResourceFactory,
        useWorkerFetch: false,
        useSystemFonts: false,
        disableFontFace: true,
        useWasm: false,
        enableXfa: false,
        stopAtErrors,
        disableAutoFetch: true,
        disableRange: true,
        disableStream: true,
        isOffscreenCanvasSupported: false,
        isImageDecoderSupported: false,
        verbosity: 0,
      });
    } catch (error: unknown) {
      throw failure(error, 'DOCUMENT_LOAD', recoveryUsed);
    }
  })();
  let passwordRequested = false;
  loading.onPassword = () => {
    passwordRequested = true;
    void loading.destroy().catch(() => {});
  };
  try {
    const document = await loading.promise;
    if (document.numPages > limits.pdfPages)
      throw new ExtractionError('DOCUMENT_TOO_LARGE');
    let text = '';
    let textBytes = 0;
    const items: PdfTextItem[] = [];
    let layoutComplete = true;
    const segments: SourceSegment[] = [];
    const warnings: ParsedDocument['warnings'][number][] = [
      { code: 'IMAGE_CONTENT_NOT_INTERPRETED' },
      ...(recoveryUsed ? [{ code: 'PDF_RECOVERY_USED' as const }] : []),
    ];
    const append = (value: string) => {
      textBytes += Buffer.byteLength(value, 'utf8');
      if (
        text.length + value.length > limits.textUnits ||
        textBytes > limits.textBytes
      )
        throw new ExtractionError('DOCUMENT_TOO_LARGE');
      text += value;
    };
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      if (pageNumber > 1) append('\n\n');
      const start = text.length;
      phase = 'PAGE_LOAD';
      const page = await document.getPage(pageNumber);
      phase = 'TEXT_STREAM';
      const viewport = page.getViewport({ scale: 1 });
      const reader = page
        .streamTextContent({
          disableNormalization: true,
          includeMarkedContent: false,
        })
        .getReader();
      try {
        while (true) {
          let chunk;
          try {
            chunk = await reader.read();
          } catch (error: unknown) {
            if (
              stopAtErrors &&
              !resources.failed &&
              isRecoverableTextStreamError(error)
            )
              throw new RecoverablePdfTextStreamError();
            throw error;
          }
          const { done, value } = chunk;
          if (done) break;
          for (const item of value.items) {
            if ('str' in item) {
              const start = text.length;
              append(item.str);
              if (item.str.trim() && layoutComplete) {
                if (items.length >= PDF_LAYOUT_ITEMS) {
                  layoutComplete = false;
                  items.length = 0;
                } else {
                  const t = Util.transform(viewport.transform, item.transform);
                  const round = (n: number) => Math.round(n * 1000) / 1000;
                  items.push({
                    start,
                    end: text.length,
                    page: pageNumber,
                    x: round(t[4]!),
                    y: round(t[5]!),
                    width: round(item.width),
                    height: round(item.height),
                    horizontal:
                      item.dir === 'ltr' &&
                      t[0]! > 0 &&
                      Math.abs(t[1]!) < 0.01 &&
                      Math.abs(t[2]!) < 0.01,
                  });
                }
              }
              if (item.hasEOL) append('\n');
            }
          }
          if (resources.failed)
            throw new ExtractionError('RESOURCE_ACCESS_DENIED');
        }
      } finally {
        try {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
          page.cleanup();
        } catch (error: unknown) {
          // Preserve the existing fail-closed cleanup precedence.
          // eslint-disable-next-line no-unsafe-finally
          throw failure(error, 'CLEANUP', recoveryUsed);
        }
      }
      if (text.slice(start).trim())
        segments.push({
          id: `page-${pageNumber}`,
          start,
          end: text.length,
          page: pageNumber,
        });
      else warnings.push({ code: 'PAGE_WITHOUT_TEXT', page: pageNumber });
    }
    phase = 'RESULT_VALIDATION';
    if (resources.failed) throw new ExtractionError('RESOURCE_ACCESS_DENIED');
    if (!text.trim()) throw new ExtractionError('NO_EXTRACTABLE_TEXT');
    return {
      source: createExtractionSource({ format: 'pdf', text, segments }),
      pdfLayout: boundedPdfLayout(text, items, layoutComplete),
      pageCount: document.numPages,
      warnings,
    };
  } catch (error: unknown) {
    if (
      passwordRequested ||
      (error instanceof Error &&
        error.name === 'PasswordException' &&
        'code' in error &&
        (error.code === PasswordResponses.NEED_PASSWORD ||
          error.code === PasswordResponses.INCORRECT_PASSWORD))
    )
      throw failure(
        error,
        'DOCUMENT_LOAD',
        recoveryUsed,
        'PASSWORD_PROTECTED_DOCUMENT',
      );
    if (resources.failed)
      throw failure(error, phase, recoveryUsed, 'RESOURCE_ACCESS_DENIED');
    if (error instanceof RecoverablePdfTextStreamError) throw error;
    throw failure(error, phase, recoveryUsed);
  } finally {
    try {
      await loading.destroy();
    } catch (error: unknown) {
      // Preserve the existing fail-closed cleanup precedence.
      // eslint-disable-next-line no-unsafe-finally
      throw failure(error, 'CLEANUP', recoveryUsed);
    }
  }
}

// Called only inside the short-lived parser worker. Both attempts remain under
// the parent DocumentParser's single deadline and worker resource limits.
export async function parsePdf(bytes: Uint8Array): Promise<ParsedDocument> {
  if (!bytes.length || bytes.length > limits.fileBytes)
    throw failure(
      new ExtractionError('DOCUMENT_TOO_LARGE'),
      'DOCUMENT_LOAD',
      false,
    );
  if (!hasPdfHeader(bytes))
    throw failure(
      new Error(),
      'DOCUMENT_LOAD',
      false,
      'PARSING_FAILED',
      'HEADER_SIGNATURE_REJECTED',
    );
  const recoveryBytes = bytes.slice();
  try {
    return await parsePdfAttempt(bytes, true, false);
  } catch (error: unknown) {
    if (!(error instanceof RecoverablePdfTextStreamError)) throw error;
    return parsePdfAttempt(recoveryBytes, false, true);
  }
}
