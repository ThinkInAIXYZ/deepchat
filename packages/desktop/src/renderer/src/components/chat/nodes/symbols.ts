import type { ComputedRef, InjectionKey, Ref } from 'vue'
import type { OcrRuntimeStatus } from '@shared/contracts/routes/ocr.routes'
import type { AttachmentRepresentationPreference } from '@shared/types/attachment'

export interface InputNodeActions {
  prepareCommandFormSubmit: () => void
  removeSkill: (skillName: string) => void
  removeFile: (filePath: string) => void
  setFileRepresentation: (filePath: string, preference: AttachmentRepresentationPreference) => void
  switchToVisionModel: () => void
  submitCommandForm: (values: Record<string, string>) => void
  cancelCommandForm: () => void
}

export type AttachmentOcrAvailability = { status: 'unknown' } | OcrRuntimeStatus['availability']

export interface AttachmentNodeContext {
  isAcpSession: ComputedRef<boolean>
  supportsVision: ComputedRef<boolean | null>
  ocrAvailability: Readonly<Ref<AttachmentOcrAvailability>>
  refreshOcrAvailability: () => Promise<void>
}

export const INPUT_NODE_ACTIONS: InjectionKey<InputNodeActions> = Symbol('input-node-actions')
export const ATTACHMENT_NODE_CONTEXT: InjectionKey<AttachmentNodeContext> =
  Symbol('attachment-node-context')
