import type { InjectionKey } from 'vue'

export interface InputNodeActions {
  removeSkill: (skillName: string) => void
  removeFile: (filePath: string) => void
  submitCommandForm: (values: Record<string, string>) => void
  cancelCommandForm: () => void
}

export const INPUT_NODE_ACTIONS: InjectionKey<InputNodeActions> = Symbol('input-node-actions')
