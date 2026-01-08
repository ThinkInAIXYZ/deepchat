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
              :ref="retry.setAssistantRef(index)"
              :message="item.message"
              :is-capturing-image="capture.isCapturing.value"
              @copy-image="handleCopyImage"
              @variant-changed="scrollToMessage"
              @trace="handleTrace"
            />
            <MessageItemUser
              v-else-if="item.message?.role === 'user'"
              :message="item.message"
              @retry="handleRetry(index)"
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
      @bar-click="scrollToMessage"
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
import { useMessageRetry } from '@/composables/message/useMessageRetry'
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

// === Composable Integrations ===
// Scroll management
const scroll = useMessageScroll()
const {
  messagesContainer,
  scrollAnchor,
  aboveThreshold,
  scrollToBottom: scrollToBottomBase,
  scrollToMessage: scrollToMessageBase,
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
const loadedMessages = computed(() =>
  props.items.map((item) => item.message).filter((message): message is Message => Boolean(message))
)

const createPlaceholderMessage = (item: MessageListItem): Message => {
  return {
    id: item.id,
    role: 'user',
    conversationId: chatStore.getActiveThreadId() ?? '',
    content: { text: '', files: [], links: [], think: false, search: false },
    timestamp: Date.now()
  } as unknown as Message
}

const minimapMessages = computed(() => {
  const mapped = props.items.map((item) => item.message ?? createPlaceholderMessage(item))
  if (mapped.length > 0) return mapped
  const current = chatStore.getCurrentThreadMessages()
  if (current.length > 0) return current
  return chatStore.variantAwareMessages
})
const retry = useMessageRetry(loadedMessages)

// === Local State ===
const dynamicScrollerRef = ref<InstanceType<typeof DynamicScroller> | null>(null)
const visible = ref(false)
const shouldAutoFollow = ref(true)
const traceMessageId = ref<string | null>(null)
let highlightRefreshTimer: number | null = null
let pendingScrollTargetId: string | null = null

const getTextLength = (value?: string) => (typeof value === 'string' ? value.length : 0)

const getMessageSizeKey = (item: MessageListItem) => {
  const message = item.message
  if (!message) {
    return `placeholder:${item.id}`
  }
  if (message.role === 'assistant') {
    const blocks = (message as AssistantMessage).content
    if (Array.isArray(blocks)) {
      let contentLength = 0
      for (const block of blocks) {
        contentLength += getTextLength(block.content)
      }
      return `assistant:${blocks.length}:${contentLength}:${message.status ?? ''}`
    }
  }

  if (message.role === 'user') {
    const userContent = (message as UserMessage).content
    let contentLength = getTextLength(userContent.text)
    if (Array.isArray(userContent.content)) {
      for (const block of userContent.content) {
        contentLength += getTextLength(block.content)
      }
    }
    const fileCount = Array.isArray(userContent.files) ? userContent.files.length : 0
    const promptCount = Array.isArray(userContent.prompts) ? userContent.prompts.length : 0
    return `user:${contentLength}:${fileCount}:${promptCount}`
  }

  return `message:${message.id}`
}

const getVariantSizeKey = (item: MessageListItem) => {
  const message = item.message
  if (!message || message.role !== 'assistant') return ''
  return chatStore.selectedVariantsMap.get(message.id) ?? ''
}

let scrollRetryTimer: number | null = null
let scrollRetryToken = 0
const MAX_SCROLL_RETRIES = 8

const scrollToBottomImmediate = () => {
  const scroller = dynamicScrollerRef.value
  if (scroller && typeof scroller.scrollToBottom === 'function') {
    scroller.scrollToBottom()
    updateScrollInfo()
    return
  }
  scrollToBottomBase()
}

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
  const targets = [messageId, parentId].filter((id): id is string => Boolean(id))
  await chatStore.ensureMessagesLoadedByIds(targets)
  await nextTick()
  if (!chatStore.hasMessageDomInfo(messageId)) {
    scrollToMessage(messageId)
    await nextTick()
  }
  await capture.captureMessage({ messageId, parentId, fromTop, modelInfo })
}

const handleRetry = async (index: number) => {
  const triggered = await retry.retryFromUserMessage(index)
  if (triggered) {
    scrollToBottom(true)
  }
}

const getPlaceholderHeight = (messageId: string) => {
  const info = getMessageDomInfo(messageId)
  return info?.height
}

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
  if (highlight) {
    highlight.scrollIntoView({ block: 'center' })
    highlight.classList.add('selection-highlight-active')
    setTimeout(() => {
      highlight.classList.remove('selection-highlight-active')
    }, 2000)
    return true
  }

  const targetMessageId = Array.from(chatStore.childThreadsByMessageId.entries()).find(
    ([, children]) => children.some((child) => child.id === childConversationId)
  )?.[0]

  if (targetMessageId) {
    scrollToMessage(targetMessageId)
    nextTick(() => {
      scheduleSelectionHighlightRefresh()
      const refreshedHighlight = container.querySelector(
        `.${HIGHLIGHT_CLASS}[data-child-conversation-id="${childConversationId}"]`
      ) as HTMLElement | null
      if (refreshedHighlight) {
        refreshedHighlight.scrollIntoView({ block: 'center' })
        refreshedHighlight.classList.add('selection-highlight-active')
        setTimeout(() => {
          refreshedHighlight.classList.remove('selection-highlight-active')
        }, 2000)
      }
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
}, 80)

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
  const nodes = container.querySelectorAll('[data-message-id]')
  const entries: Array<{ id: string; top: number; height: number }> = []

  nodes.forEach((node) => {
    const messageId = node.getAttribute('data-message-id')
    if (!messageId) return
    const rect = (node as HTMLElement).getBoundingClientRect()

    // 过滤掉虚拟滚动中未真实渲染的元素
    // 这些元素通常有极端的位置值或在可见区域之外很远
    const absoluteTop = rect.top - containerRect.top + container.scrollTop

    // 只记录合理范围内的元素位置
    // 允许一定的缓冲区（上下各两个视口高度）
    const bufferZone = containerRect.height * 2
    const MAX_REASONABLE_HEIGHT = 2000 // 单条消息最大合理高度

    const isInReasonableRange =
      absoluteTop > -bufferZone &&
      absoluteTop < container.scrollHeight + bufferZone &&
      rect.height > 0 &&
      rect.height < MAX_REASONABLE_HEIGHT && // 更严格的高度限制
      rect.top < 100000 && // 过滤极端位置
      rect.top > -100000

    if (isInReasonableRange) {
      entries.push({
        id: messageId,
        top: absoluteTop,
        height: rect.height
      })
    }
  })
  if (entries.length) {
    chatStore.recordMessageDomInfo(entries)
  }
}

const scrollToMessage = (messageId: string) => {
  console.log('[ScrollDebug] scrollToMessage called for:', messageId)
  void chatStore.ensureMessagesLoadedByIds([messageId])
  const index = props.items.findIndex((msg) => msg.id === messageId)
  const scroller = dynamicScrollerRef.value

  console.log('[ScrollDebug] index:', index, 'scroller:', !!scroller)

  if (index === -1) {
    console.warn(`[ScrollDebug] Message ${messageId} not found in items`)
    return
  }

  if (!scroller || typeof scroller.scrollToItem !== 'function') {
    console.warn('[ScrollDebug] DynamicScroller not available, using fallback')
    scrollToMessageBase(messageId)
    return
  }

  pendingScrollTargetId = messageId

  const tryApplyCenterAndHighlight = () => {
    const currentContainer = messagesContainer.value
    if (!currentContainer) return false

    const target = currentContainer.querySelector(
      `[data-message-id="${messageId}"]`
    ) as HTMLElement | null

    if (!target) {
      console.log('[ScrollDebug] Target not yet rendered')
      return false
    }

    const targetRect = target.getBoundingClientRect()
    const containerRect = currentContainer.getBoundingClientRect()

    // 检查元素是否真实渲染（不在占位符状态）
    const targetTop = targetRect.top - containerRect.top + currentContainer.scrollTop
    if (targetTop < -5000 || targetTop > currentContainer.scrollHeight + 5000) {
      console.log('[ScrollDebug] Target in placeholder state, top:', targetTop)
      return false
    }

    console.log('[ScrollDebug] Target rendered! Scrolling to top, targetTop:', targetTop)

    // 使用 scrollIntoView 将消息定位到顶部
    target.scrollIntoView({ block: 'start', behavior: 'instant' })
    updateScrollInfo()

    // 高亮效果
    target.classList.add('message-highlight')
    setTimeout(() => {
      target.classList.remove('message-highlight')
    }, 2000)

    pendingScrollTargetId = null
    return true
  }

  // 清除之前的重试
  if (scrollRetryTimer) {
    clearTimeout(scrollRetryTimer)
    scrollRetryTimer = null
  }

  const currentToken = ++scrollRetryToken
  let retryCount = 0

  const attemptScroll = () => {
    if (currentToken !== scrollRetryToken) {
      console.log('[ScrollDebug] Aborted, newer scroll request')
      return
    }

    console.log('[ScrollDebug] Attempt', retryCount, '- calling scrollToItem')

    // 完全依赖 DynamicScroller 的 scrollToItem
    scroller.scrollToItem(index)

    // 等待虚拟滚动完成渲染后再尝试居中和高亮
    nextTick(() => {
      setTimeout(() => {
        if (tryApplyCenterAndHighlight()) {
          console.log('[ScrollDebug] Success!')
          return
        }

        retryCount++
        if (retryCount < MAX_SCROLL_RETRIES) {
          scrollRetryTimer = window.setTimeout(() => {
            scrollRetryTimer = null
            attemptScroll()
          }, 50) // 增加等待时间到 50ms
        } else {
          console.warn('[ScrollDebug] Max retries reached')
          pendingScrollTargetId = null
        }
      }, 50) // 初始等待 50ms 让虚拟滚动渲染
    })
  }

  attemptScroll()
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
  if (!pendingScrollTargetId) return
  const container = messagesContainer.value
  if (!container) return
  const target = container.querySelector(
    `[data-message-id="${pendingScrollTargetId}"]`
  ) as HTMLElement | null
  if (!target) return
  const messageId = pendingScrollTargetId
  pendingScrollTargetId = null
  scrollToMessageBase(messageId)
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
  scheduleScrollToBottom(true)
  nextTick(() => {
    visible.value = true
    setupScrollObserver()
    updateScrollInfo()
    recordVisibleDomInfo()
  })

  useResizeObserver(messagesContainer, () => {
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
    () => props.items.length,
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

  watch(
    () => {
      const lastMessage = props.items[props.items.length - 1]
      return lastMessage ? getMessageSizeKey(lastMessage) : ''
    },
    () => {
      scheduleScrollToBottom()
    },
    { flush: 'post' }
  )
})

onBeforeUnmount(() => {
  const container = messagesContainer.value
  if (container) {
    clearSelectionHighlights(container)
  }
  if (highlightRefreshTimer) {
    clearTimeout(highlightRefreshTimer)
    highlightRefreshTimer = null
  }
  if (scrollRetryTimer) {
    clearTimeout(scrollRetryTimer)
    scrollRetryTimer = null
  }
  pendingScrollTargetId = null
})

// === Expose ===
defineExpose({
  scrollToBottom,
  scrollToMessage,
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
