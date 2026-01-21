import { defineStore } from 'pinia'
import { useProviderStoreService } from '@/composables/provider/useProviderStoreService'

export const useProviderStore = defineStore('provider', () => {
  return useProviderStoreService()
})
