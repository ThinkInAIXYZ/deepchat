import { defineStore } from 'pinia'
import { useYoBrowserStoreService } from '@/composables/yo-browser/useYoBrowserStoreService'

export const useYoBrowserStore = defineStore('yoBrowser', () => {
  return useYoBrowserStoreService()
})
