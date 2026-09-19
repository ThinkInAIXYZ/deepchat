import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { SystemPrompt } from '@shared/types/prompt'
import { createConfigClient } from '../../api/ConfigClient'

export const useSystemPromptStore = defineStore('systemPrompt', () => {
  const configClient = createConfigClient()

  const prompts = ref<SystemPrompt[]>([])
  const defaultPromptId = ref<string>('default')

  const defaultPrompt = computed(
    () =>
      prompts.value.find((prompt) => prompt.isDefault) ??
      prompts.value.find((prompt) => prompt.id === defaultPromptId.value)
  )

  const applySystemPromptState = (state: { prompts: SystemPrompt[]; defaultPromptId: string }) => {
    prompts.value = state.prompts
    defaultPromptId.value = state.defaultPromptId
    return state
  }

  const loadPrompts = async () => {
    return applySystemPromptState(await configClient.getSystemPromptState())
  }

  const savePrompts = async (list: SystemPrompt[]) => {
    return applySystemPromptState(await configClient.setSystemPrompts(list))
  }

  const setDefaultSystemPrompt = async (content: string) => {
    await configClient.setDefaultSystemPrompt(content)
  }

  const resetToDefaultPrompt = async () => {
    return applySystemPromptState(await configClient.resetToDefaultPrompt())
  }

  const clearSystemPrompt = async () => {
    await configClient.clearSystemPrompt()
  }

  const addSystemPrompt = async (prompt: SystemPrompt) => {
    return applySystemPromptState(await configClient.addSystemPrompt(prompt))
  }

  const updateSystemPrompt = async (promptId: string, updates: Partial<SystemPrompt>) => {
    return applySystemPromptState(await configClient.updateSystemPrompt(promptId, updates))
  }

  const deleteSystemPrompt = async (promptId: string) => {
    return applySystemPromptState(await configClient.deleteSystemPrompt(promptId))
  }

  const setDefaultSystemPromptId = async (promptId: string) => {
    return applySystemPromptState(await configClient.setDefaultSystemPromptId(promptId))
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
