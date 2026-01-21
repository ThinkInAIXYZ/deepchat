import { defineStore } from 'pinia'
import { useModelStoreService } from '@/composables/model/useModelStoreService'

export const useModelStore = defineStore('model', () => {
  return useModelStoreService()
})
