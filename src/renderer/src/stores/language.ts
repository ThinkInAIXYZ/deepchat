import { defineStore } from 'pinia'
import { useLanguageStoreService } from '@/composables/settings/useLanguageStoreService'

export const useLanguageStore = defineStore('language', () => {
  return useLanguageStoreService()
})
