import { ref, readonly, type DeepReadonly } from 'vue'
import type { ScrollInfo } from './types'
import { useChatStore } from '@/stores/chat'
import { useArtifactStore } from '@/stores/artifact'

export function useMessageMinimap(scrollInfoRef: DeepReadonly<ScrollInfo>) {
  const chatStore = useChatStore()
  const artifactStore = useArtifactStore()

  const hoveredMessageId = ref<string | null>(null)

  const handleHover = (messageId: string | null) => {
    hoveredMessageId.value = messageId
  }

  const handleClick = () => {
    // Toggle message navigation sidebar
    if (artifactStore.isOpen) {
      artifactStore.isOpen = false
      chatStore.isMessageNavigationOpen = true
    } else {
      chatStore.isMessageNavigationOpen = !chatStore.isMessageNavigationOpen
    }
  }

  return {
    hoveredMessageId: readonly(hoveredMessageId),
    scrollInfo: scrollInfoRef,
    handleHover,
    handleClick
  }
}
