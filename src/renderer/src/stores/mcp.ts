import { defineStore } from 'pinia'
import { useMcpStoreService } from '@/composables/mcp/useMcpStoreService'

export const useMcpStore = defineStore('mcp', () => {
  return useMcpStoreService()
})
