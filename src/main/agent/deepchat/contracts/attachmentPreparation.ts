import type { AttachmentPreparationSummary, SendMessageInput } from '@shared/types/agent-interface'

export interface AttachmentPreparationInput {
  content: SendMessageInput
  supportsVision: boolean
  signal?: AbortSignal
  reusePreparedAttachmentRepresentations?: boolean
  preserveResolvedRepresentations?: boolean
  emitDiagnostics?: boolean
}

export interface AttachmentPreparationResult {
  content: SendMessageInput
  summary: AttachmentPreparationSummary
}

/**
 * Attachment preparation surface the built-in kernel needs. The host OCR router implements it;
 * kernel modules receive this port instead of importing the host module.
 */
export interface AttachmentPreparationPort {
  prepare(input: AttachmentPreparationInput): Promise<AttachmentPreparationResult>
}
