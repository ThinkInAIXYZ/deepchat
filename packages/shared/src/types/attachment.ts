export const ATTACHMENT_REPRESENTATION_PREFERENCES = [
  'auto',
  'image',
  'embedded_text',
  'ocr_text'
] as const
export type AttachmentRepresentationPreference =
  (typeof ATTACHMENT_REPRESENTATION_PREFERENCES)[number]

export const ATTACHMENT_UNAVAILABLE_REASONS = [
  'automatic_ocr_disabled',
  'document_limit_exceeded',
  'document_too_large',
  'image_dimensions_exceeded',
  'image_limit_exceeded',
  'image_payload_unavailable',
  'image_too_large',
  'ocr_cancelled',
  'ocr_empty',
  'ocr_failed',
  'ocr_queue_full',
  'ocr_resource_limited',
  'ocr_runtime_unavailable',
  'invalid_attachment_snapshot',
  'pdf_text_unavailable',
  'requested_image_requires_vision',
  'turn_ocr_budget_exhausted',
  'turn_image_bytes_exceeded',
  'user_skipped_attachment_content',
  'user_skipped_image_content',
  'unsupported_image_format'
] as const
export type AttachmentUnavailableReason = (typeof ATTACHMENT_UNAVAILABLE_REASONS)[number]

export const PDF_ROUTING_REVISION = 'pdf-text-coverage-v1'
export const PDF_SUBSTANTIVE_TEXT_MIN_CODE_POINTS = 64
export const PDF_AUTO_EMBEDDED_COVERAGE_PERCENT = 90
export const PDF_LOW_TEXT_PAGE_SAMPLE_LIMIT = 20
export const PDF_PAGE_COUNT_SANITY_LIMIT = 1_000_000
export const ATTACHMENT_PDF_OCR_MAX_TOKENS = 16_000
export const ATTACHMENT_PDF_OCR_MAX_PAGE_SPANS = 100

export interface PdfEmbeddedTextCoverage {
  routingRevision: string
  pageCount: number
  substantivePageCount: number
  lowTextPageCount: number
  lowTextPageSamples: number[]
  hasEmbeddedText: boolean
}

export interface AttachmentDocumentPageSpan {
  pageNumber: number
  start: number
  end: number
  complete: boolean
}

export interface AttachmentDocumentOcrSnapshot {
  pageSpans: AttachmentDocumentPageSpan[]
  sourcePageCountHint?: number
  includedThroughPage: number
  includedThroughPageComplete: boolean
  artifactTermination: 'request_complete' | 'stopped_by_output_limit' | 'resource_limited'
  generationOutputLimitReached: boolean
  embeddedTextCoverage?: PdfEmbeddedTextCoverage
}

export type AttachmentResolvedRepresentation =
  | { kind: 'image' }
  | { kind: 'embedded_text' }
  | {
      kind: 'ocr_text'
      text: string
      tokenCount: number
      truncated: boolean
      document?: AttachmentDocumentOcrSnapshot
    }
  | { kind: 'unavailable'; reason: AttachmentUnavailableReason }

export const ATTACHMENT_FALLBACK_POLICIES = ['auto', 'send_without_image_content'] as const
export type AttachmentFallbackPolicy = (typeof ATTACHMENT_FALLBACK_POLICIES)[number]

export const ATTACHMENT_PREPARATION_STATUSES = ['ready', 'degraded', 'needs_user_action'] as const
export type AttachmentPreparationStatus = (typeof ATTACHMENT_PREPARATION_STATUSES)[number]
export const ATTACHMENT_PREPARATION_MAX_ISSUES = 64

export const ATTACHMENT_PREPARATION_ACTIONS = [
  'retry',
  'send_without_image_content',
  'switch_to_vision_model'
] as const
export type AttachmentPreparationAction = (typeof ATTACHMENT_PREPARATION_ACTIONS)[number]

export interface AttachmentPreparationIssue {
  attachmentIndex: number
  reason: AttachmentUnavailableReason
}

/** Public, body-free result returned across IPC and persisted for blocked pending inputs. */
export interface AttachmentPreparationSummary {
  status: AttachmentPreparationStatus
  issues: AttachmentPreparationIssue[]
  suggestedActions: AttachmentPreparationAction[]
}

export const ATTACHMENT_OCR_MAX_TEXT_CHARACTERS = 128_000
export const ATTACHMENT_OCR_MAX_TOKENS = 8_000
