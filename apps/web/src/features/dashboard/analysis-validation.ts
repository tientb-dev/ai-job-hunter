import { tr } from '../../app/i18n';
export const CV_BYTES = 5_242_880;
export const JD_UNITS = 12_000;
export const JD_BYTES = 49_152;
export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export interface FormErrors {
  cv?: string;
  jdText?: string;
}
export function validateFile(files: readonly File[]): string | undefined {
  if (files.length !== 1) return tr('Choose exactly one PDF or DOCX file.');
  const file = files[0]!;
  if (!file.size) return tr('The CV file must not be empty.');
  if (file.size > CV_BYTES)
    return tr('The CV must be 5 MiB (5,242,880 bytes) or smaller.');
  if (
    file.name.length > 255 ||
    /[/\\]/u.test(file.name) ||
    Array.from(file.name).some((character) => character.charCodeAt(0) < 32)
  )
    return tr('The CV filename is not supported.');
  if (!(
    (/\.pdf$/iu.test(file.name) && file.type === 'application/pdf') ||
    (/\.docx$/iu.test(file.name) && file.type === DOCX_MIME)
  ))
    return tr(
      'Choose a PDF or DOCX with matching file extension and MIME metadata.',
    );
  return undefined;
}
export function jdBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}
export function validateJd(text: string): string | undefined {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        return tr(
          'The JD contains an unpaired Unicode surrogate. Please replace the invalid character.',
        );
    } else if (code >= 0xdc00 && code <= 0xdfff)
      return tr(
        'The JD contains an unpaired Unicode surrogate. Please replace the invalid character.',
      );
  }
  if (text.length > JD_UNITS)
    return tr('The JD must contain at most 12,000 UTF-16 units.');
  if (jdBytes(text) > JD_BYTES)
    return tr('The JD must contain at most 49,152 UTF-8 bytes.');
  if (!text.trim()) return tr('Enter a nonblank job description.');
  return undefined;
}
