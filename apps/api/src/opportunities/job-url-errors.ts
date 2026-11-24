import { HttpException } from '@nestjs/common';

/** Stable codes the web client localises; messages stay as English fallbacks. */
export type UrlImportErrorCode =
  | 'URL_IMPORT_INVALID_URL'
  | 'URL_IMPORT_SOURCE_OFF'
  | 'URL_IMPORT_BLOCKED'
  | 'URL_IMPORT_NOT_FOUND'
  | 'URL_IMPORT_REDIRECT'
  | 'URL_IMPORT_UNAVAILABLE'
  | 'URL_IMPORT_TIMEOUT'
  | 'URL_IMPORT_UNREACHABLE'
  | 'URL_IMPORT_BUSY'
  | 'URL_IMPORT_UNSUPPORTED_CONTENT'
  | 'URL_IMPORT_TOO_LARGE'
  | 'URL_IMPORT_NO_CONTENT';

export class UrlImportError extends HttpException {
  constructor(
    readonly errorCode: UrlImportErrorCode,
    message: string,
    status = 400,
    /** Upstream HTTP status for logs only; never sent to the client. */
    readonly upstreamStatus?: number,
  ) {
    super({ statusCode: status, errorCode, message }, status);
  }
}

// Anti-bot interstitial markers (Cloudflare challenge/block pages). They are
// page-template identifiers, not words a job description would contain.
const CHALLENGE_MARKERS = [
  /<title>\s*(?:just a moment|attention required)/iu,
  // Not /cdn-cgi/challenge-platform/: Cloudflare also injects that background
  // detection script (jsd/main.js) into normal pages, e.g. real ITviec jobs.
  /window\._cf_chl_opt\b/u,
  /\bcf-browser-verification\b/u,
];
export function isBotChallenge(html: string): boolean {
  return CHALLENGE_MARKERS.some((marker) => marker.test(html));
}
