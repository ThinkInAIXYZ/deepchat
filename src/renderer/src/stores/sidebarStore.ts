import { defineStore } from 'pinia'
import { useSidebarStoreService } from '@/composables/sidebar/useSidebarStoreService'
export type { ConversationMeta } from '@/composables/sidebar/useSidebarStoreService'

export const useSidebarStore = defineStore('sidebar', () => {
  return useSidebarStoreService()
})
