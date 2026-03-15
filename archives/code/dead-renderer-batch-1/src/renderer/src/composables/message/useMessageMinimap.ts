import { ref, readonly, type DeepReadonly } from 'vue'
import type { ScrollInfo } from './types'

export function useMessageMinimap(scrollInfoRef: DeepReadonly<ScrollInfo>) {
  const hoveredMessageId = ref<string | null>(null)

  const handleHover = (messageId: string | null) => {
    hoveredMessageId.value = messageId
  }

  return {
    hoveredMessageId: readonly(hoveredMessageId),
    scrollInfo: scrollInfoRef,
    handleHover
  }
}
