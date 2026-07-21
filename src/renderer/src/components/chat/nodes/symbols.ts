import type { InjectionKey } from 'vue'
import type { AttachmentRepresentationPreference } from '@shared/types/attachment'

export interface InputNodeActions {
  prepareCommandFormSubmit: () => void
  removeSkill: (skillName: string) => void
  removeFile: (filePath: string) => void
  setFileRepresentation: (filePath: string, preference: AttachmentRepresentationPreference) => void
  submitCommandForm: (values: Record<string, string>) => void
  cancelCommandForm: () => void
}

export const INPUT_NODE_ACTIONS: InjectionKey<InputNodeActions> = Symbol('input-node-actions')
