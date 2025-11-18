import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { SystemPrompt } from '@shared/presenter'
import { usePresenter } from '@/composables/usePresenter'

export const useSystemPromptStore = defineStore('systemPrompt', () => {
  const configP = usePresenter('configPresenter')

  const prompts = ref<SystemPrompt[]>([])
  const defaultPromptId = ref<string>('default')

  const defaultPrompt = computed(
    () =>
      prompts.value.find((prompt) => prompt.isDefault) ??
      prompts.value.find((prompt) => prompt.id === defaultPromptId.value)
  )

  const loadPrompts = async () => {
    prompts.value = await configP.getSystemPrompts()
    defaultPromptId.value = await configP.getDefaultSystemPromptId()
  }

  const savePrompts = async (list: SystemPrompt[]) => {
    prompts.value = list
    await configP.setSystemPrompts(list)
  }

  const setDefaultSystemPrompt = async (content: string) => {
    await configP.setDefaultSystemPrompt(content)
  }

  const resetToDefaultPrompt = async () => {
    await configP.resetToDefaultPrompt()
  }

  const clearSystemPrompt = async () => {
    await configP.clearSystemPrompt()
  }

  const addSystemPrompt = async (prompt: SystemPrompt) => {
    await configP.addSystemPrompt(prompt)
    await loadPrompts()
  }

  const updateSystemPrompt = async (promptId: string, updates: Partial<SystemPrompt>) => {
    await configP.updateSystemPrompt(promptId, updates)
    await loadPrompts()
  }

  const deleteSystemPrompt = async (promptId: string) => {
    await configP.deleteSystemPrompt(promptId)
    await loadPrompts()
  }

  const setDefaultSystemPromptId = async (promptId: string) => {
    await configP.setDefaultSystemPromptId(promptId)
    defaultPromptId.value = promptId
    await loadPrompts()
  }

  return {
    prompts,
    defaultPromptId,
    defaultPrompt,
    loadPrompts,
    savePrompts,
    setDefaultSystemPrompt,
    resetToDefaultPrompt,
    clearSystemPrompt,
    addSystemPrompt,
    updateSystemPrompt,
    deleteSystemPrompt,
    setDefaultSystemPromptId
  }
})
