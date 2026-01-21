import { computed, ref } from 'vue'
import type { SystemPrompt } from '@shared/presenter'
import { useSystemPromptAdapter } from '@/composables/settings/useSystemPromptAdapter'

export const useSystemPromptStoreService = () => {
  const systemPromptAdapter = useSystemPromptAdapter()

  const prompts = ref<SystemPrompt[]>([])
  const defaultPromptId = ref<string>('default')

  const defaultPrompt = computed(
    () =>
      prompts.value.find((prompt) => prompt.isDefault) ??
      prompts.value.find((prompt) => prompt.id === defaultPromptId.value)
  )

  const loadPrompts = async () => {
    prompts.value = await systemPromptAdapter.getSystemPrompts()
    defaultPromptId.value = await systemPromptAdapter.getDefaultSystemPromptId()
  }

  const savePrompts = async (list: SystemPrompt[]) => {
    prompts.value = list
    await systemPromptAdapter.setSystemPrompts(list)
  }

  const setDefaultSystemPrompt = async (content: string) => {
    await systemPromptAdapter.setDefaultSystemPrompt(content)
  }

  const resetToDefaultPrompt = async () => {
    await systemPromptAdapter.resetToDefaultPrompt()
  }

  const clearSystemPrompt = async () => {
    await systemPromptAdapter.clearSystemPrompt()
  }

  const addSystemPrompt = async (prompt: SystemPrompt) => {
    await systemPromptAdapter.addSystemPrompt(prompt)
    await loadPrompts()
  }

  const updateSystemPrompt = async (promptId: string, updates: Partial<SystemPrompt>) => {
    await systemPromptAdapter.updateSystemPrompt(promptId, updates)
    await loadPrompts()
  }

  const deleteSystemPrompt = async (promptId: string) => {
    await systemPromptAdapter.deleteSystemPrompt(promptId)
    await loadPrompts()
  }

  const setDefaultSystemPromptId = async (promptId: string) => {
    await systemPromptAdapter.setDefaultSystemPromptId(promptId)
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
}
