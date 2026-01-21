import { defineStore } from 'pinia'
import { useSyncStoreService } from '@/composables/sync/useSyncStoreService'

export const useSyncStore = defineStore('sync', () => {
  return useSyncStoreService()
})
