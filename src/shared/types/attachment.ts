export const ATTACHMENT_REPRESENTATION_PREFERENCES = ['auto', 'image', 'ocr_text'] as const
export type AttachmentRepresentationPreference =
  (typeof ATTACHMENT_REPRESENTATION_PREFERENCES)[number]

export const ATTACHMENT_UNAVAILABLE_REASONS = [
  'automatic_ocr_disabled',
  'image_dimensions_exceeded',
  'image_limit_exceeded',
  'image_payload_unavailable',
  'image_too_large',
  'ocr_cancelled',
  'ocr_empty',
  'ocr_failed',
  'ocr_queue_full',
  'ocr_runtime_unavailable',
  'requested_image_requires_vision',
  'turn_image_bytes_exceeded',
  'user_skipped_image_content',
  'unsupported_image_format'
] as const
export type AttachmentUnavailableReason = (typeof ATTACHMENT_UNAVAILABLE_REASONS)[number]

export type AttachmentResolvedRepresentation =
  | { kind: 'image' }
  | { kind: 'ocr_text'; text: string; tokenCount: number; truncated: boolean }
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
