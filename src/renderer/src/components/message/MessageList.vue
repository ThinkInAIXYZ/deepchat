<template>
  <div class="w-full h-full relative min-h-0">
    <DynamicScroller
      ref="dynamicScrollerRef"
      class="message-list-container relative flex-1 scrollbar-hide overflow-y-auto w-full h-full pr-12 lg:pr-12 transition-opacity duration-300"
      :class="{ 'opacity-0': !visible }"
      :items="items"
      list-class="w-full pt-4"
      :min-item-size="48"
      :buffer="200"
      :emit-update="true"
      key-field="id"
      @update="handleVirtualUpdate"
    >
      <template v-slot="{ item, index, active }">
        <DynamicScrollerItem
          :item="item"
          :active="active"
          :size-dependencies="[getMessageSizeKey(item), getVariantSizeKey(item)]"
          :data-index="index"
          class="w-full break-all"
        >
          <div @mouseenter="minimap.handleHover(item.id)" @mouseleave="minimap.handleHover(null)">
            <MessageItemAssistant
              v-if="item.message?.role === 'assistant'"
              :message="item.message"
              :is-capturing-image="capture.isCapturing.value"
              @copy-image="handleCopyImage"
              @variant-changed="wrapScrollToMessage"
              @trace="handleTrace"
            />
            <MessageItemUser
              v-else-if="item.message?.role === 'user'"
              :message="item.message"
              @retry="handleRetry(item.message?.id)"
              @scroll-to-bottom="scrollToBottom"
            />
            <MessageItemPlaceholder
              v-else
              :message-id="item.id"
              :height="getPlaceholderHeight(item.id)"
            />
          </div>
        </DynamicScrollerItem>
      </template>
      <template #after>
        <div ref="scrollAnchor" class="h-8" />
      </template>
    </DynamicScroller>
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
      v-if="minimapMessages.length > 0"
      :messages="minimapMessages"
      :hovered-message-id="minimap.hoveredMessageId.value"
      :scroll-info="minimap.scrollInfo"
      @bar-hover="minimap.handleHover"
      @bar-click="wrapScrollToMessage"
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
import { ref, onMounted, nextTick, watch, computed, onBeforeUnmount } from 'vue'

// === Types ===
import type { AssistantMessage, Message, UserMessage } from '@shared/chat'
import type { MessageListItem } from '@/stores/chat'

// === Components ===
import MessageItemAssistant from './MessageItemAssistant.vue'
import MessageItemUser from './MessageItemUser.vue'
import MessageItemPlaceholder from './MessageItemPlaceholder.vue'
import MessageActionButtons from './MessageActionButtons.vue'
import ReferencePreview from './ReferencePreview.vue'
import MessageMinimap from './MessageMinimap.vue'
import TraceDialog from '../trace/TraceDialog.vue'

// === Composables ===
import { useResizeObserver, useEventListener, useDebounceFn } from '@vueuse/core'
import { useMessageScroll } from '@/composables/message/useMessageScroll'
import { useCleanDialog } from '@/composables/message/useCleanDialog'
import { useMessageMinimap } from '@/composables/message/useMessageMinimap'
import { useMessageCapture } from '@/composables/message/useMessageCapture'
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'
import { getAllMessageDomInfo, getMessageDomInfo } from '@/lib/messageRuntimeCache'

// === Stores ===
import { useChatStore } from '@/stores/chat'
import { useReferenceStore } from '@/stores/reference'
import { useWorkspaceStore } from '@/stores/workspace'
import type { ParentSelection } from '@shared/presenter'

// === Props & Emits ===
const props = defineProps<{
  items: Array<MessageListItem>
}>()

// === Stores ===
const chatStore = useChatStore()
const referenceStore = useReferenceStore()
const workspaceStore = useWorkspaceStore()

// === Local State (需要先声明,因为 useMessageScroll 需要引用) ===
const dynamicScrollerRef = ref<InstanceType<typeof DynamicScroller> | null>(null)
const scrollAnchor = ref<HTMLDivElement>()
const visible = ref(false)
const shouldAutoFollow = ref(true)
const traceMessageId = ref<string | null>(null)
let highlightRefreshTimer: number | null = null

// === Composable Integrations ===
// Scroll management
const scroll = useMessageScroll({
  dynamicScrollerRef,
  shouldAutoFollow,
  scrollAnchor
})
const {
  messagesContainer,
  aboveThreshold,
  scrollToBottom,
  scrollToMessage,
  handleScroll,
  updateScrollInfo,
  setupScrollObserver,
  handleVirtualScrollUpdate
} = scroll

// Clean dialog
const cleanDialog = useCleanDialog()

// Minimap (needs scrollInfo from scroll composable)
const minimap = useMessageMinimap(scroll.scrollInfo)

// Screenshot capture
const capture = useMessageCapture()

// Message retry

const minimapMessages = computed(() => {
  const mapped = props.items.map((item) => {
    if (item.message) return item.message
    return {
      id: item.id,
      role: 'user',
      conversationId: chatStore.getActiveThreadId() ?? '',
      content: { text: '', files: [], links: [], think: false, search: false },
      timestamp: Date.now()
    } as unknown as Message
  })
  if (mapped.length > 0) return mapped
  const current = chatStore.getCurrentThreadMessages()
  if (current.length > 0) return current
  return chatStore.variantAwareMessages
})

// === Constants ===
const HIGHLIGHT_CLASS = 'selection-highlight'
const HIGHLIGHT_ACTIVE_CLASS = 'selection-highlight-active'
const HIGHLIGHT_REFRESH_DELAY = 80
const HIGHLIGHT_DURATION = 2000
const MAX_REASONABLE_HEIGHT = 2000
const BUFFER_ZONE_MULTIPLIER = 2
const EXTREME_POSITION_THRESHOLD = 100000

// === Helper Functions ===
const getTextLength = (value?: string) => value?.length ?? 0

const getMessageSizeKey = (item: MessageListItem) => {
  const message = item.message
  if (!message) return `placeholder:${item.id}`

  if (message.role === 'assistant') {
    const blocks = (message as AssistantMessage).content
    if (Array.isArray(blocks)) {
      const contentLength = blocks.reduce((sum, block) => sum + getTextLength(block.content), 0)
      return `assistant:${blocks.length}:${contentLength}:${message.status ?? ''}`
    }
  }

  if (message.role === 'user') {
    const userContent = (message as UserMessage).content
    let contentLength = getTextLength(userContent.text)
    if (Array.isArray(userContent.content)) {
      contentLength += userContent.content.reduce(
        (sum, block) => sum + getTextLength(block.content),
        0
      )
    }
    const fileCount = userContent.files?.length ?? 0
    const promptCount = userContent.prompts?.length ?? 0
    return `user:${contentLength}:${fileCount}:${promptCount}`
  }

  return `message:${message.id}`
}

const getVariantSizeKey = (item: MessageListItem) => {
  const message = item.message
  if (!message || message.role !== 'assistant') return ''
  return chatStore.selectedVariantsMap[message.id] ?? ''
}

// === Event Handlers ===
const handleCopyImage = async (
  messageId: string,
  parentId?: string,
  fromTop: boolean = false,
  modelInfo?: { model_name: string; model_provider: string }
) => {
  const targets = [messageId, parentId].filter(Boolean) as string[]
  await chatStore.ensureMessagesLoadedByIds(targets)
  await nextTick()

  if (!chatStore.hasMessageDomInfo(messageId)) {
    wrapScrollToMessage(messageId)
    await nextTick()
  }

  await capture.captureMessage({ messageId, parentId, fromTop, modelInfo })
}

const handleRetry = async (messageId?: string) => {
  if (!messageId) return
  if (await chatStore.retryFromUserMessage(messageId)) {
    scrollToBottom(true)
  }
}

const getPlaceholderHeight = (messageId: string) => getMessageDomInfo(messageId)?.height

const getAnchorList = () => {
  const domEntries = getAllMessageDomInfo()
  const idSet = new Set(props.items.map((item) => item.id))
  return domEntries.filter((entry) => idSet.has(entry.id))
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

const hashText = (value: string) => {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return `${hash}`
}

const clearSelectionHighlights = (container: HTMLElement) => {
  container.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((highlight) => {
    const parent = highlight.parentNode
    if (!parent) return

    while (highlight.firstChild) {
      parent.insertBefore(highlight.firstChild, highlight)
    }
    parent.removeChild(highlight)
    parent.normalize()
  })
}

const resolveSelectionOffsets = (fullText: string, selection: ParentSelection) => {
  const { startOffset, endOffset, selectedText, contextBefore, contextAfter } = selection

  // Try exact offsets first
  if (
    Number.isFinite(startOffset) &&
    Number.isFinite(endOffset) &&
    startOffset >= 0 &&
    endOffset <= fullText.length &&
    endOffset > startOffset &&
    fullText.slice(startOffset, endOffset) === selectedText
  ) {
    return { startOffset, endOffset }
  }

  if (!selectedText) return null

  const hasBefore = contextBefore && contextBefore.length > 0
  const hasAfter = contextAfter && contextAfter.length > 0

  // Try different context combinations
  const searchStrategies = [
    hasBefore && hasAfter && `${contextBefore}${selectedText}${contextAfter}`,
    hasBefore && `${contextBefore}${selectedText}`,
    hasAfter && `${selectedText}${contextAfter}`,
    selectedText
  ].filter(Boolean) as string[]

  for (const strategy of searchStrategies) {
    const idx = fullText.indexOf(strategy)
    if (idx !== -1) {
      const offset = strategy.startsWith(contextBefore!) ? contextBefore!.length : 0
      const resolvedStart = idx + offset
      return { startOffset: resolvedStart, endOffset: resolvedStart + selectedText.length }
    }
  }

  return null
}

const collectTextNodes = (container: HTMLElement) => {
  const textNodes: Array<{ node: Text; start: number; end: number }> = []
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let cursor = 0

  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const length = node.nodeValue?.length ?? 0
    textNodes.push({ node, start: cursor, end: cursor + length })
    cursor += length
  }

  return textNodes
}

const applySelectionHighlight = (
  container: HTMLElement,
  selection: ParentSelection,
  childConversationId: string
) => {
  const fullText = container.textContent ?? ''
  if (!fullText || (selection.contentHash && selection.contentHash !== hashText(fullText))) return

  const offsets = resolveSelectionOffsets(fullText, selection)
  if (!offsets || offsets.startOffset >= offsets.endOffset) return

  const { startOffset, endOffset } = offsets
  const textNodes = collectTextNodes(container)

  for (const { node, start, end } of textNodes) {
    if (end <= startOffset || start >= endOffset) continue

    const nodeText = node.nodeValue ?? ''
    const startInNode = Math.max(0, startOffset - start)
    const endInNode = Math.min(nodeText.length, endOffset - start)
    if (startInNode >= endInNode) continue

    const fragment = document.createDocumentFragment()
    const beforeText = nodeText.slice(0, startInNode)
    const highlightText = nodeText.slice(startInNode, endInNode)
    const afterText = nodeText.slice(endInNode)

    if (beforeText) fragment.appendChild(document.createTextNode(beforeText))

    const highlight = document.createElement('span')
    highlight.className = HIGHLIGHT_CLASS
    highlight.dataset.childConversationId = childConversationId
    highlight.textContent = highlightText
    fragment.appendChild(highlight)

    if (afterText) fragment.appendChild(document.createTextNode(afterText))

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
  if (highlightRefreshTimer) clearTimeout(highlightRefreshTimer)
  highlightRefreshTimer = null

  nextTick(() => {
    const container = messagesContainer.value
    if (!container) return

    if (!chatStore.childThreadsByMessageId.size) {
      clearSelectionHighlights(container)
      return
    }

    applySelectionHighlights()
    highlightRefreshTimer = window.setTimeout(() => {
      highlightRefreshTimer = null
      applySelectionHighlights()
    }, HIGHLIGHT_REFRESH_DELAY)
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

const activateHighlight = (highlight: HTMLElement) => {
  highlight.scrollIntoView({ block: 'center' })
  highlight.classList.add(HIGHLIGHT_ACTIVE_CLASS)
  setTimeout(() => highlight.classList.remove(HIGHLIGHT_ACTIVE_CLASS), HIGHLIGHT_DURATION)
}

const findHighlight = (container: HTMLElement, childConversationId: string) => {
  return container.querySelector(
    `.${HIGHLIGHT_CLASS}[data-child-conversation-id="${childConversationId}"]`
  ) as HTMLElement | null
}

const scrollToSelectionHighlight = (childConversationId: string) => {
  if (!childConversationId) return false
  const container = messagesContainer.value
  if (!container) return false

  const highlight = findHighlight(container, childConversationId)
  if (highlight) {
    activateHighlight(highlight)
    return true
  }

  // Find parent message
  const targetMessageId = Array.from(chatStore.childThreadsByMessageId.entries()).find(
    ([, children]) => children.some((child) => child.id === childConversationId)
  )?.[0]

  if (targetMessageId) {
    wrapScrollToMessage(targetMessageId)
    nextTick(() => {
      scheduleSelectionHighlightRefresh()
      const refreshedHighlight = findHighlight(container, childConversationId)
      if (refreshedHighlight) activateHighlight(refreshedHighlight)
    })
    return true
  }

  return false
}

useEventListener(messagesContainer, 'click', handleHighlightClick)

watch(
  () => [
    props.items.length,
    chatStore.childThreadsByMessageId,
    chatStore.chatConfig.selectedVariantsMap
  ],
  () => {
    scheduleSelectionHighlightRefresh()
  },
  { immediate: true }
)

// === Lifecycle Hooks ===
const handleScrollUpdate = useDebounceFn(() => {
  if (chatStore.childThreadsByMessageId.size) {
    scheduleSelectionHighlightRefresh()
  }
  recordVisibleDomInfo()
}, HIGHLIGHT_REFRESH_DELAY)

useEventListener(messagesContainer, 'scroll', () => {
  handleScroll()
  handleScrollUpdate()
})

const bindScrollContainer = () => {
  const scrollerEl = dynamicScrollerRef.value?.$el as HTMLDivElement | undefined
  if (scrollerEl && messagesContainer.value !== scrollerEl) {
    messagesContainer.value = scrollerEl
  }
}

const recordVisibleDomInfo = () => {
  const container = messagesContainer.value
  if (!container) return

  const containerRect = container.getBoundingClientRect()
  const bufferZone = containerRect.height * BUFFER_ZONE_MULTIPLIER
  const entries: Array<{ id: string; top: number; height: number }> = []

  container.querySelectorAll('[data-message-id]').forEach((node) => {
    const messageId = node.getAttribute('data-message-id')
    if (!messageId) return

    const rect = (node as HTMLElement).getBoundingClientRect()
    const absoluteTop = rect.top - containerRect.top + container.scrollTop

    const isInReasonableRange =
      absoluteTop > -bufferZone &&
      absoluteTop < container.scrollHeight + bufferZone &&
      rect.height > 0 &&
      rect.height < MAX_REASONABLE_HEIGHT &&
      Math.abs(rect.top) < EXTREME_POSITION_THRESHOLD

    if (isInReasonableRange) {
      entries.push({ id: messageId, top: absoluteTop, height: rect.height })
    }
  })

  if (entries.length) chatStore.recordMessageDomInfo(entries)
}

const refreshVirtualScroller = async (messageId?: string) => {
  await nextTick()
  await new Promise((resolve) => requestAnimationFrame(resolve))

  const scroller = dynamicScrollerRef.value
  if (messageId && scroller?.scrollToItem) {
    const index = props.items.findIndex((item) => item.id === messageId)
    if (index !== -1) {
      scroller.scrollToItem(index)
    }
  }

  scroller?.updateVisibleItems?.(true)
}

const wrapScrollToMessage = async (messageId: string) => {
  void chatStore.ensureMessagesLoadedByIds([messageId])
  scrollToMessage(messageId, () => props.items)
  await refreshVirtualScroller(messageId)
}

const handleVirtualUpdate = (
  startIndex: number,
  endIndex: number,
  visibleStartIndex?: number,
  visibleEndIndex?: number
) => {
  const resolvedStart = visibleStartIndex ?? startIndex
  const resolvedEnd = visibleEndIndex ?? endIndex
  const safeStart = Number.isFinite(resolvedStart) ? resolvedStart : 0
  const safeEnd = Number.isFinite(resolvedEnd) ? resolvedEnd : safeStart
  void chatStore.prefetchMessagesForRange(safeStart, safeEnd)
  recordVisibleDomInfo()
  handleVirtualScrollUpdate()
}

watch(
  dynamicScrollerRef,
  () => {
    bindScrollContainer()
  },
  { immediate: true }
)

onMounted(() => {
  bindScrollContainer()
  // Initialize scroll and visibility
  scrollToBottom(true)
  nextTick(() => {
    visible.value = true
    setupScrollObserver()
    updateScrollInfo()
    recordVisibleDomInfo()
  })

  useResizeObserver(messagesContainer, () => {
    scrollToBottom()
  })

  watch(
    () => aboveThreshold.value,
    (isAbove) => {
      shouldAutoFollow.value = !isAbove
    }
  )

  // Update scroll info when message count changes
  watch(
    () => props.items.length,
    (length, prevLength) => {
      const isGrowing = length > prevLength
      const isReset = prevLength > 0 && length < prevLength

      if (!isGrowing && !isReset) {
        return
      }

      scrollToBottom(isReset)
    },
    { flush: 'post' }
  )

  watch(
    () => {
      const lastMessage = props.items[props.items.length - 1]
      return lastMessage ? getMessageSizeKey(lastMessage) : ''
    },
    () => {
      scrollToBottom()
    },
    { flush: 'post' }
  )
})

onBeforeUnmount(() => {
  const container = messagesContainer.value
  if (container) clearSelectionHighlights(container)

  if (highlightRefreshTimer) clearTimeout(highlightRefreshTimer)

  highlightRefreshTimer = null
})

// === Expose ===
defineExpose({
  scrollToBottom,
  scrollToMessage: wrapScrollToMessage,
  scrollToSelectionHighlight,
  aboveThreshold,
  getAnchorList
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
