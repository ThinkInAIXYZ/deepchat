import { computed } from 'vue'
import { useChatStore } from '@/stores/chat'

export type ChatMode = 'chat' | 'agent'

/**
 * Minimal chat mode helper.
 *
 * We currently infer mode from the active thread's provider:
 * - `acp` provider is treated as agent-only
 * - everything else defaults to `chat`
 */
export function useChatMode() {
  const chatStore = useChatStore()

  const currentMode = computed<ChatMode>(() => {
    const providerId = chatStore.activeThread?.settings?.providerId
    return providerId === 'acp' ? 'agent' : 'chat'
  })

  return {
    currentMode
  }
}
