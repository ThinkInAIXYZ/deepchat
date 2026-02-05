import { defineStore } from 'pinia'
import { useFloatingButtonStoreService } from '@/composables/floating-button/useFloatingButtonStoreService'

export const useFloatingButtonStore = defineStore('floatingButton', () => {
  return useFloatingButtonStoreService()
})
