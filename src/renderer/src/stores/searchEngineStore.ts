import { defineStore } from 'pinia'
import { useSearchEngineStoreService } from '@/composables/search/useSearchEngineStoreService'

export const useSearchEngineStore = defineStore('searchEngine', () => {
  return useSearchEngineStoreService()
})
