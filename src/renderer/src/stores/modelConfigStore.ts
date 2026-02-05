import { defineStore } from 'pinia'
import { useModelConfigStoreService } from '@/composables/model/useModelConfigStoreService'

export const useModelConfigStore = defineStore('modelConfig', () => {
  return useModelConfigStoreService()
})
