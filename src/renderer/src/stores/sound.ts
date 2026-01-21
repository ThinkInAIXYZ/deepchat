import { defineStore } from 'pinia'
import { useSoundStoreService } from '@/composables/settings/useSoundStoreService'

export const useSoundStore = defineStore('sound', () => {
  return useSoundStoreService()
})
