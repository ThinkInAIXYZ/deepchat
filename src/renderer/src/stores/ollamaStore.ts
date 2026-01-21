import { defineStore } from 'pinia'
import { useOllamaStoreService } from '@/composables/ollama/useOllamaStoreService'

export const useOllamaStore = defineStore('ollama', () => {
  return useOllamaStoreService()
})
