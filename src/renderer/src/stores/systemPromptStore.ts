import { defineStore } from 'pinia'
import { useSystemPromptStoreService } from '@/composables/settings/useSystemPromptStoreService'

export const useSystemPromptStore = defineStore('systemPrompt', () => {
  return useSystemPromptStoreService()
})
