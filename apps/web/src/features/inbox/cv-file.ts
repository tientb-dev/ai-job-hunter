import { tr } from '../../app/i18n';

export const CV_PDF_ONLY =
  'Only PDF CVs are supported. Export your Word CV to PDF and upload it again.';
const CV_MAX_BYTES = 5 * 1024 * 1024;

/** Checks a CV before upload: PDF name, type and %PDF- header. The API re-checks. */
export async function cvUploadError(file: File): Promise<string | null> {
  if (
    !/\.pdf$/iu.test(file.name) ||
    file.type !== 'application/pdf' ||
    !new TextDecoder('latin1')
      .decode(await file.slice(0, 1024).arrayBuffer())
      .includes('%PDF-')
  )
    return tr(CV_PDF_ONLY);
  if (file.size > CV_MAX_BYTES)
    return tr('The CV must be 5 MiB (5,242,880 bytes) or smaller.');
  return null;
}

/** Saved CVs get a browser preview only when the original is a PDF. */
export const canPreviewOriginal = (cv: {
  fileName: string;
  originalAvailable?: boolean;
}) => !!cv.originalAvailable && /\.pdf$/iu.test(cv.fileName);
