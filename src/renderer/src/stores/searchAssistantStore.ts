import { defineStore } from 'pinia'
import { useSearchAssistantStoreService } from '@/composables/search/useSearchAssistantStoreService'

export const useSearchAssistantStore = defineStore('searchAssistant', () => {
  return useSearchAssistantStoreService()
})
