import { computed } from 'vue'
import { defineStore } from 'pinia'
import { useIpcQuery } from '@/composables/useIpcQuery'
import { useIpcMutation } from '@/composables/useIpcMutation'
import { type EntryKey, type UseQueryReturn } from '@pinia/colada'
import type { Prompt } from '@shared/presenter'

export const usePromptsStore = defineStore('prompts', () => {
  const customPromptsKey: EntryKey = ['config', 'customPrompts'] as const

  const promptsQuery = useIpcQuery({
    presenter: 'configPresenter',
    method: 'getCustomPrompts',
    key: () => customPromptsKey,
    staleTime: 60_000,
    gcTime: 300_000
  }) as UseQueryReturn<Prompt[]>

  const prompts = computed(() => promptsQuery.data.value ?? [])

  const loadPrompts = async () => {
    try {
      await promptsQuery.refetch()
    } catch (error) {
      console.error('Failed to load custom prompts:', error)
    }
  }

  const invalidateCustomPrompts = (): EntryKey[] => [customPromptsKey]

  const savePromptsMutation = useIpcMutation({
    presenter: 'configPresenter',
    method: 'setCustomPrompts',
    invalidateQueries: () => invalidateCustomPrompts()
  })

  const savePrompts = async (newPrompts: Prompt[]) => {
    try {
      await savePromptsMutation.mutateAsync([newPrompts])
    } catch (error) {
      console.error('Failed to save custom prompts:', error)
      throw error
    }
  }

  const addPromptMutation = useIpcMutation({
    presenter: 'configPresenter',
    method: 'addCustomPrompt',
    invalidateQueries: () => invalidateCustomPrompts()
  })

  const addPrompt = async (prompt: Prompt) => {
    try {
      await addPromptMutation.mutateAsync([prompt])
    } catch (error) {
      console.error('Failed to add custom prompt:', error)
      throw error
    }
  }

  const updatePromptMutation = useIpcMutation({
    presenter: 'configPresenter',
    method: 'updateCustomPrompt',
    invalidateQueries: () => invalidateCustomPrompts()
  })

  const updatePrompt = async (promptId: string, updates: Partial<Prompt>) => {
    try {
      await updatePromptMutation.mutateAsync([promptId, updates])
    } catch (error) {
      console.error('Failed to update custom prompt:', error)
      throw error
    }
  }

  const deletePromptMutation = useIpcMutation({
    presenter: 'configPresenter',
    method: 'deleteCustomPrompt',
    invalidateQueries: () => invalidateCustomPrompts()
  })

  const deletePrompt = async (promptId: string) => {
    try {
      await deletePromptMutation.mutateAsync([promptId])
    } catch (error) {
      console.error('Failed to delete custom prompt:', error)
      throw error
    }
  }

  return {
    prompts,
    loadPrompts,
    savePrompts,
    addPrompt,
    updatePrompt,
    deletePrompt
  }
})
