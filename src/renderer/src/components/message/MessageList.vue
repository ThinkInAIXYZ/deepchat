<template>
  <div class="w-full h-full relative min-h-0">
    <div
      ref="messagesContainer"
      class="message-list-container relative flex-1 scrollbar-hide overflow-y-auto w-full h-full pr-12 lg:pr-12"
      @scroll="handleScroll"
    >
      <div
        ref="messageList"
        class="w-full break-all transition-opacity duration-300 pt-4"
        :class="{ 'opacity-0': !visible }"
      >
        <div
          v-for="(msg, index) in messages"
          :key="msg.id"
          @mouseenter="minimap.handleHover(msg.id)"
          @mouseleave="minimap.handleHover(null)"
        >
          <MessageItemAssistant
            v-if="msg.role === 'assistant'"
            :ref="retry.setAssistantRef(index)"
            :message="msg as AssistantMessage"
            :is-capturing-image="capture.isCapturing.value"
            @copy-image="handleCopyImage"
            @variant-changed="scrollToMessage"
            @trace="handleTrace"
          />
          <MessageItemUser
            v-else-if="msg.role === 'user'"
            :message="msg as UserMessage"
            @retry="handleRetry(index)"
            @scroll-to-bottom="scrollToBottom"
          />
        </div>
      </div>
      <div ref="scrollAnchor" class="h-8" />
    </div>
    <template v-if="!capture.isCapturing.value">
      <MessageActionButtons
        :show-clean-button="!showCancelButton"
        :show-scroll-button="aboveThreshold"
        :show-workspace-button="showWorkspaceButton"
        @clean="cleanDialog.open"
        @scroll-to-bottom="scrollToBottom(true)"
        @open-workspace="handleOpenWorkspace"
      />
    </template>
    <ReferencePreview
      class="pointer-events-none"
      :show="referenceStore.showPreview"
      :content="referenceStore.currentReference"
      :rect="referenceStore.previewRect"
    />
    <MessageMinimap
      v-if="messages.length > 0"
      :messages="messages"
      :hovered-message-id="minimap.hoveredMessageId.value"
      :scroll-info="minimap.scrollInfo"
      @bar-hover="minimap.handleHover"
      @bar-click="minimap.handleClick"
    />
    <TraceDialog
      :message-id="traceMessageId"
      :agent-id="chatStore.getActiveThreadId()"
      @close="traceMessageId = null"
    />
  </div>
</template>

<script setup lang="ts">
// === Vue Core ===
import { ref, onMounted, nextTick, watch, computed, toRef, onBeforeUnmount } from 'vue'

// === Types ===
import type { AssistantMessage, Message, UserMessage } from '@shared/chat'

// === Components ===
import MessageItemAssistant from './MessageItemAssistant.vue'
import MessageItemUser from './MessageItemUser.vue'
import MessageActionButtons from './MessageActionButtons.vue'
import ReferencePreview from './ReferencePreview.vue'
import MessageMinimap from './MessageMinimap.vue'
import TraceDialog from '../trace/TraceDialog.vue'

// === Composables ===
import { useResizeObserver, useEventListener } from '@vueuse/core'
import { useMessageScroll } from '@/composables/message/useMessageScroll'
import { useCleanDialog } from '@/composables/message/useCleanDialog'
import { useMessageMinimap } from '@/composables/message/useMessageMinimap'
import { useMessageCapture } from '@/composables/message/useMessageCapture'
import { useMessageRetry } from '@/composables/message/useMessageRetry'

// === Stores ===
import { useChatStore } from '@/stores/chat'
import { useReferenceStore } from '@/stores/reference'
import { useWorkspaceStore } from '@/stores/workspace'
import type { ParentSelection } from '@shared/presenter'

// === Props & Emits ===
const props = defineProps<{
  messages: Array<Message>
}>()

// === Stores ===
const chatStore = useChatStore()
const referenceStore = useReferenceStore()
const workspaceStore = useWorkspaceStore()

// === Composable Integrations ===
// Scroll management
const scroll = useMessageScroll()
const {
  messagesContainer,
  scrollAnchor,
  aboveThreshold,
  scrollToBottom: scrollToBottomImmediate,
  scrollToMessage,
  handleScroll,
  updateScrollInfo,
  setupScrollObserver
} = scroll

// Clean dialog
const cleanDialog = useCleanDialog()

// Minimap (needs scrollInfo from scroll composable)
const minimap = useMessageMinimap(scroll.scrollInfo)

// Screenshot capture
const capture = useMessageCapture()

// Message retry
const retry = useMessageRetry(toRef(props, 'messages'))

// === Local State ===
const messageList = ref<HTMLDivElement>()
const visible = ref(false)
const shouldAutoFollow = ref(true)
const traceMessageId = ref<string | null>(null)
let highlightRefreshTimer: number | null = null

const scheduleScrollToBottom = (force = false) => {
  nextTick(() => {
    const container = messagesContainer.value
    if (!container) {
      scrollToBottomImmediate()
      shouldAutoFollow.value = true
      return
    }

    const shouldScroll = force || shouldAutoFollow.value

    if (!shouldScroll) {
      updateScrollInfo()
      return
    }

    scrollToBottomImmediate()
    if (force) {
      shouldAutoFollow.value = true
    }
  })
}

const scrollToBottom = (force = false) => {
  if (force) {
    shouldAutoFollow.value = true
  }
  scheduleScrollToBottom(force)
}

// === Event Handlers ===
const handleCopyImage = async (
  messageId: string,
  parentId?: string,
  fromTop: boolean = false,
  modelInfo?: { model_name: string; model_provider: string }
) => {
  await capture.captureMessage({ messageId, parentId, fromTop, modelInfo })
}

const handleRetry = async (index: number) => {
  const triggered = await retry.retryFromUserMessage(index)
  if (triggered) {
    scrollToBottom(true)
  }
}

// === Computed ===
const showCancelButton = computed(() => {
  return chatStore.generatingThreadIds.has(chatStore.getActiveThreadId() ?? '')
})

// Show workspace button only in agent mode when workspace is closed
const showWorkspaceButton = computed(() => {
  return workspaceStore.isAgentMode && !workspaceStore.isOpen
})

const handleOpenWorkspace = () => {
  workspaceStore.setOpen(true)
}

const handleTrace = (messageId: string) => {
  traceMessageId.value = messageId
}

const HIGHLIGHT_CLASS = 'selection-highlight'

const hashText = (value: string) => {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return `${hash}`
}

const clearSelectionHighlights = (container: HTMLElement) => {
  const highlights = Array.from(container.querySelectorAll(`.${HIGHLIGHT_CLASS}`))
  for (const highlight of highlights) {
    const parent = highlight.parentNode
    if (!parent) continue
    while (highlight.firstChild) {
      parent.insertBefore(highlight.firstChild, highlight)
    }
    parent.removeChild(highlight)
    parent.normalize()
  }
}

const resolveSelectionOffsets = (fullText: string, selection: ParentSelection) => {
  const { startOffset, endOffset, selectedText, contextBefore, contextAfter } = selection
  if (
    Number.isFinite(startOffset) &&
    Number.isFinite(endOffset) &&
    startOffset >= 0 &&
    endOffset <= fullText.length &&
    endOffset > startOffset
  ) {
    const matchedText = fullText.slice(startOffset, endOffset)
    if (matchedText === selectedText) {
      return { startOffset, endOffset }
    }
  }

  const hasBefore = typeof contextBefore === 'string' && contextBefore.length > 0
  const hasAfter = typeof contextAfter === 'string' && contextAfter.length > 0

  if (selectedText && hasBefore && hasAfter) {
    const composite = `${contextBefore}${selectedText}${contextAfter}`
    const idx = fullText.indexOf(composite)
    if (idx !== -1) {
      const resolvedStart = idx + contextBefore.length
      return { startOffset: resolvedStart, endOffset: resolvedStart + selectedText.length }
    }
  }

  if (selectedText && hasBefore) {
    const composite = `${contextBefore}${selectedText}`
    const idx = fullText.indexOf(composite)
    if (idx !== -1) {
      const resolvedStart = idx + contextBefore.length
      return { startOffset: resolvedStart, endOffset: resolvedStart + selectedText.length }
    }
  }

  if (selectedText && hasAfter) {
    const composite = `${selectedText}${contextAfter}`
    const idx = fullText.indexOf(composite)
    if (idx !== -1) {
      const resolvedStart = idx
      return { startOffset: resolvedStart, endOffset: resolvedStart + selectedText.length }
    }
  }

  if (selectedText) {
    const idx = fullText.indexOf(selectedText)
    if (idx !== -1) {
      return { startOffset: idx, endOffset: idx + selectedText.length }
    }
  }

  return null
}

const applySelectionHighlight = (
  container: HTMLElement,
  selection: ParentSelection,
  childConversationId: string
) => {
  const fullText = container.textContent ?? ''
  if (!fullText) return
  if (selection.contentHash && selection.contentHash !== hashText(fullText)) {
    return
  }
  const offsets = resolveSelectionOffsets(fullText, selection)
  if (!offsets) return

  const { startOffset, endOffset } = offsets
  if (startOffset >= endOffset) return

  const textNodes: Array<{ node: Text; start: number; end: number }> = []
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let cursor = 0
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const length = node.nodeValue?.length ?? 0
    textNodes.push({ node, start: cursor, end: cursor + length })
    cursor += length
  }

  for (const entry of textNodes) {
    if (entry.end <= startOffset || entry.start >= endOffset) {
      continue
    }

    const node = entry.node
    const nodeText = node.nodeValue ?? ''
    const startInNode = Math.max(0, startOffset - entry.start)
    const endInNode = Math.min(nodeText.length, endOffset - entry.start)

    if (startInNode >= endInNode) {
      continue
    }

    const beforeText = nodeText.slice(0, startInNode)
    const highlightText = nodeText.slice(startInNode, endInNode)
    const afterText = nodeText.slice(endInNode)

    const fragment = document.createDocumentFragment()
    if (beforeText) {
      fragment.appendChild(document.createTextNode(beforeText))
    }

    const highlight = document.createElement('span')
    highlight.className = HIGHLIGHT_CLASS
    highlight.dataset.childConversationId = childConversationId
    highlight.textContent = highlightText
    fragment.appendChild(highlight)

    if (afterText) {
      fragment.appendChild(document.createTextNode(afterText))
    }

    node.parentNode?.replaceChild(fragment, node)
  }
}

const applySelectionHighlights = () => {
  const container = messagesContainer.value
  if (!container) return
  clearSelectionHighlights(container)

  for (const [messageId, children] of chatStore.childThreadsByMessageId.entries()) {
    const messageElement = container.querySelector(
      `[data-message-id="${messageId}"]`
    ) as HTMLElement | null
    if (!messageElement) continue
    const contentElement = messageElement.querySelector(
      '[data-message-content]'
    ) as HTMLElement | null
    const selectionContainer = contentElement ?? messageElement
    for (const child of children) {
      if (!child.parentSelection || typeof child.parentSelection !== 'object') continue
      applySelectionHighlight(selectionContainer, child.parentSelection, child.id)
    }
  }
}

const scheduleSelectionHighlightRefresh = () => {
  if (highlightRefreshTimer) {
    clearTimeout(highlightRefreshTimer)
    highlightRefreshTimer = null
  }
  nextTick(() => {
    if (!chatStore.childThreadsByMessageId.size) {
      const container = messagesContainer.value
      if (container) {
        clearSelectionHighlights(container)
      }
      return
    }
    applySelectionHighlights()
    highlightRefreshTimer = window.setTimeout(() => {
      highlightRefreshTimer = null
      applySelectionHighlights()
    }, 80)
  })
}

const handleHighlightClick = (event: MouseEvent) => {
  const target = event.target as HTMLElement | null
  const highlight = target?.closest(`.${HIGHLIGHT_CLASS}`) as HTMLElement | null
  if (!highlight) return
  const childConversationId = highlight.dataset.childConversationId
  if (!childConversationId) return
  event.preventDefault()
  chatStore.openThreadInNewTab(childConversationId)
}

const scrollToSelectionHighlight = (childConversationId: string) => {
  if (!childConversationId) return false
  const container = messagesContainer.value
  if (!container) return false
  const highlight = container.querySelector(
    `.${HIGHLIGHT_CLASS}[data-child-conversation-id="${childConversationId}"]`
  ) as HTMLElement | null
  if (!highlight) return false
  highlight.scrollIntoView({ block: 'center' })
  highlight.classList.add('selection-highlight-active')
  setTimeout(() => {
    highlight.classList.remove('selection-highlight-active')
  }, 2000)
  return true
}

useEventListener(messagesContainer, 'click', handleHighlightClick)

watch(
  () => [
    props.messages.length,
    chatStore.childThreadsByMessageId,
    chatStore.chatConfig.selectedVariantsMap
  ],
  () => {
    scheduleSelectionHighlightRefresh()
  },
  { immediate: true }
)

// === Lifecycle Hooks ===
onMounted(() => {
  // Initialize scroll and visibility
  scheduleScrollToBottom(true)
  nextTick(() => {
    visible.value = true
    setupScrollObserver()
    updateScrollInfo()
  })

  useResizeObserver(messageList, () => {
    scheduleScrollToBottom()
  })

  watch(
    () => aboveThreshold.value,
    (isAbove) => {
      shouldAutoFollow.value = !isAbove
    }
  )

  // Update scroll info when message count changes
  watch(
    () => props.messages.length,
    (length, prevLength) => {
      const isGrowing = length > prevLength
      const isReset = prevLength > 0 && length < prevLength

      if (!isGrowing && !isReset) {
        return
      }

      scheduleScrollToBottom(isReset)
    },
    { flush: 'post' }
  )
})

onBeforeUnmount(() => {
  const container = messagesContainer.value
  if (!container) return
  clearSelectionHighlights(container)
  if (highlightRefreshTimer) {
    clearTimeout(highlightRefreshTimer)
    highlightRefreshTimer = null
  }
})

// === Expose ===
defineExpose({
  scrollToBottom,
  scrollToMessage,
  scrollToSelectionHighlight,
  aboveThreshold
})
</script>

<style scoped>
.message-highlight {
  background-color: rgba(59, 130, 246, 0.1);
  border-left: 3px solid rgb(59, 130, 246);
  transition: all 0.3s ease;
}

.dark .message-highlight {
  background-color: rgba(59, 130, 246, 0.15);
}

:global(.selection-highlight) {
  background-color: rgba(250, 204, 21, 0.4);
  cursor: pointer;
  border-radius: 2px;
  padding: 0 1px;
}

:global(.selection-highlight:hover) {
  background-color: rgba(250, 204, 21, 0.6);
}

:global(.selection-highlight-active) {
  background-color: rgba(250, 204, 21, 0.7);
  box-shadow: 0 0 0 2px rgba(250, 204, 21, 0.5);
}
</style>
