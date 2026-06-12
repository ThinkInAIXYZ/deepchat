import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { SystemPrompt } from '@shared/presenter'
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

  const loadPrompts = async () => {
    prompts.value = await configClient.getSystemPrompts()
    defaultPromptId.value = await configClient.getDefaultSystemPromptId()
  }

  const savePrompts = async (list: SystemPrompt[]) => {
    prompts.value = list
    await configClient.setSystemPrompts(list)
  }

  const setDefaultSystemPrompt = async (content: string) => {
    await configClient.setDefaultSystemPrompt(content)
  }

  const resetToDefaultPrompt = async () => {
    await configClient.resetToDefaultPrompt()
  }

  const clearSystemPrompt = async () => {
    await configClient.clearSystemPrompt()
  }

  const addSystemPrompt = async (prompt: SystemPrompt) => {
    await configClient.addSystemPrompt(prompt)
    await loadPrompts()
  }

  const updateSystemPrompt = async (promptId: string, updates: Partial<SystemPrompt>) => {
    await configClient.updateSystemPrompt(promptId, updates)
    await loadPrompts()
  }

  const deleteSystemPrompt = async (promptId: string) => {
    await configClient.deleteSystemPrompt(promptId)
    await loadPrompts()
  }

  const setDefaultSystemPromptId = async (promptId: string) => {
    await configClient.setDefaultSystemPromptId(promptId)
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
