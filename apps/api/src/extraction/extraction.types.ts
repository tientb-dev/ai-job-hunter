import type { PdfLayout } from './pdf-layout.js';
export interface QuoteReference {
  readonly segmentId: string;
  readonly quote: string;
}
export interface EvidenceReference extends QuoteReference {
  readonly start: number;
  readonly end: number;
}
export interface Fact<E = EvidenceReference, V = string> {
  readonly value: V | null;
  readonly evidence: readonly E[];
}
export interface CvData<E = EvidenceReference> {
  readonly name: Fact<E>;
  readonly email: Fact<E>;
  readonly phone: Fact<E>;
  readonly location: Fact<E>;
  readonly skills: readonly {
    readonly name: Fact<E>;
    readonly experienceText: Fact<E>;
  }[];
  readonly experience: readonly {
    readonly employer: Fact<E>;
    readonly title: Fact<E>;
    readonly startDateText: Fact<E>;
    readonly endDateText: Fact<E>;
    readonly descriptionText: Fact<E>;
  }[];
  readonly education: readonly {
    readonly institution: Fact<E>;
    readonly qualification: Fact<E>;
    readonly dateText: Fact<E>;
  }[];
}
export interface JdData<E = EvidenceReference> {
  readonly title: Fact<E>;
  readonly company: Fact<E>;
  readonly location: Fact<E>;
  readonly employmentType: Fact<E>;
  readonly requirements: readonly {
    readonly text: Fact<E>;
    readonly priority: Fact<E, 'required' | 'preferred'>;
  }[];
  readonly responsibilities: readonly Fact<E>[];
  readonly compensationText: Fact<E>;
}
export interface SourceSegment {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly page: number | null;
}
export interface ExtractionSource {
  readonly format: 'pdf' | 'docx' | 'text';
  readonly text: string;
  readonly segments: readonly SourceSegment[];
}

export interface CvExtractionInput {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly mediaType: string;
}
export interface JdExtractionInput {
  readonly text: string;
}
export type ExtractionWarning =
  | { readonly code: 'IMAGE_CONTENT_NOT_INTERPRETED' }
  | { readonly code: 'PDF_RECOVERY_USED' }
  | { readonly code: 'PAGE_WITHOUT_TEXT'; readonly page: number }
  | { readonly code: 'DOCX_CONTENT_WARNING' }
  | { readonly code: 'EXTRACTION_COMPLETENESS_NOT_VERIFIED' };
interface ExtractionEnvelope<K, D> {
  readonly schemaVersion: '1';
  readonly kind: K;
  readonly source: ExtractionSource;
  readonly data: D;
  readonly warnings: readonly ExtractionWarning[];
}
export type CvExtractionResult = ExtractionEnvelope<'cv', CvData>;
export type JdExtractionResult = ExtractionEnvelope<'jd', JdData>;
export type ExtractionResult = CvExtractionResult | JdExtractionResult;

// Metadata available from the parse-only saved-CV flow; warnings are not returned.
export interface SavedCvProvenance {
  pdfLayout?: PdfLayout;
  kind: 'saved-text-bootstrap' | 'parsed-upload';
  format: 'pdf' | 'docx' | null;
  parser: string | null;
  segments: readonly SourceSegment[] | null;
  warnings: null;
  originalBytesRetained: false;
}
