import { defineStore } from 'pinia'
import { useMcpSamplingStoreService } from '@/composables/mcp/useMcpSamplingStoreService'

export const useMcpSamplingStore = defineStore('mcpSampling', () => {
  return useMcpSamplingStoreService()
})
