import { defineStore } from 'pinia'
import { useAgentModelStoreService } from '@/composables/model/useAgentModelStoreService'

export const useAgentModelStore = defineStore('agent-model', () => {
  return useAgentModelStoreService()
})
