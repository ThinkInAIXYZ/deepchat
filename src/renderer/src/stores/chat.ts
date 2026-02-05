import { defineStore } from 'pinia'
import { useAgenticSessionStore } from '@/composables/agentic/useAgenticSessionStore'

export type { MessageListItem, WorkingStatus } from '@/composables/agentic/useAgenticSessionStore'

export const useChatStore = defineStore('chat', () => {
  return useAgenticSessionStore()
})
