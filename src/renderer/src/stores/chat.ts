import { defineStore } from 'pinia'
import { useChatStoreService } from '@/composables/chat/useChatStoreService'

export type { MessageListItem, WorkingStatus } from '@/composables/chat/useChatStoreService'

export const useChatStore = defineStore('chat', () => {
  return useChatStoreService()
})
