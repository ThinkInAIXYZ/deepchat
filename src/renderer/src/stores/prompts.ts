import { computed } from 'vue'
import { defineStore } from 'pinia'
import { useIpcQuery } from '@/composables/useIpcQuery'
import { useIpcMutation } from '@/composables/useIpcMutation'
import { type EntryKey, type UseQueryReturn } from '@pinia/colada'
import type { Prompt } from '@shared/types/prompt'
import { createConfigClient } from '../../api/ConfigClient'

export const usePromptsStore = defineStore('prompts', () => {
  const configClient = createConfigClient()
  const customPromptsKey: EntryKey = ['config', 'customPrompts'] as const

  const promptsQuery = useIpcQuery({
    key: () => customPromptsKey,
    query: () => configClient.getCustomPrompts(),
    staleTime: 60_000,
    gcTime: 300_000
  }) as UseQueryReturn<Prompt[]>

  const prompts = computed(() => promptsQuery.data.value ?? [])

  const loadPrompts = async (): Promise<Prompt[]> => {
    const state = await promptsQuery.refetch(true)
    if (state.status !== 'success') {
      throw state.error
    }
    return state.data
  }

  const invalidateCustomPrompts = (): EntryKey[] => [customPromptsKey]

  const savePromptsMutation = useIpcMutation({
    mutation: async (prompts: Prompt[]) => (await configClient.setCustomPrompts(prompts)).prompts,
    invalidateQueries: () => invalidateCustomPrompts()
  })

  const savePrompts = async (newPrompts: Prompt[]): Promise<Prompt[]> => {
    return (await savePromptsMutation.mutateAsync([newPrompts])) as Prompt[]
  }

  const addPromptMutation = useIpcMutation({
    mutation: async (prompt: Prompt) => (await configClient.addCustomPrompt(prompt)).prompts,
    invalidateQueries: () => invalidateCustomPrompts()
  })

  const addPrompt = async (prompt: Prompt): Promise<Prompt[]> => {
    return (await addPromptMutation.mutateAsync([prompt])) as Prompt[]
  }

  const updatePromptMutation = useIpcMutation({
    mutation: async (promptId: string, updates: Partial<Prompt>) =>
      (await configClient.updateCustomPrompt(promptId, updates)).prompts,
    invalidateQueries: () => invalidateCustomPrompts()
  })

  const updatePrompt = async (promptId: string, updates: Partial<Prompt>): Promise<Prompt[]> => {
    return (await updatePromptMutation.mutateAsync([promptId, updates])) as Prompt[]
  }

  const deletePromptMutation = useIpcMutation({
    mutation: async (promptId: string) => (await configClient.deleteCustomPrompt(promptId)).prompts,
    invalidateQueries: () => invalidateCustomPrompts()
  })

  const deletePrompt = async (promptId: string): Promise<Prompt[]> => {
    return (await deletePromptMutation.mutateAsync([promptId])) as Prompt[]
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
