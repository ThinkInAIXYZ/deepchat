import { usePresenter } from '@/composables/usePresenter'
import type { SystemPrompt } from '@shared/presenter'

export type SystemPromptAdapter = {
  getSystemPrompts: () => Promise<SystemPrompt[]>
  getDefaultSystemPromptId: () => Promise<string>
  setSystemPrompts: (list: SystemPrompt[]) => Promise<void>
  setDefaultSystemPrompt: (content: string) => Promise<void>
  resetToDefaultPrompt: () => Promise<void>
  clearSystemPrompt: () => Promise<void>
  addSystemPrompt: (prompt: SystemPrompt) => Promise<void>
  updateSystemPrompt: (promptId: string, updates: Partial<SystemPrompt>) => Promise<void>
  deleteSystemPrompt: (promptId: string) => Promise<void>
  setDefaultSystemPromptId: (promptId: string) => Promise<void>
}

export function useSystemPromptAdapter(): SystemPromptAdapter {
  const configPresenter = usePresenter('configPresenter')

  return {
    getSystemPrompts: () => configPresenter.getSystemPrompts(),
    getDefaultSystemPromptId: () => configPresenter.getDefaultSystemPromptId(),
    setSystemPrompts: (list: SystemPrompt[]) => configPresenter.setSystemPrompts(list),
    setDefaultSystemPrompt: (content: string) => configPresenter.setDefaultSystemPrompt(content),
    resetToDefaultPrompt: () => configPresenter.resetToDefaultPrompt(),
    clearSystemPrompt: () => configPresenter.clearSystemPrompt(),
    addSystemPrompt: (prompt: SystemPrompt) => configPresenter.addSystemPrompt(prompt),
    updateSystemPrompt: (promptId: string, updates: Partial<SystemPrompt>) =>
      configPresenter.updateSystemPrompt(promptId, updates),
    deleteSystemPrompt: (promptId: string) => configPresenter.deleteSystemPrompt(promptId),
    setDefaultSystemPromptId: (promptId: string) =>
      configPresenter.setDefaultSystemPromptId(promptId)
  }
}
