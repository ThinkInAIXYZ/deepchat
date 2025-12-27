<template>
  <div></div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChatStore } from '@/stores/chat'
import { usePresenter } from '@/composables/usePresenter'
import type { ParentSelection } from '@shared/presenter'

const chatStore = useChatStore()
const notificationP = usePresenter('notificationPresenter')
const { t } = useI18n()

// 处理翻译事件
const handleTranslate = (text: string, x?: number, y?: number) => {
  window.dispatchEvent(
    new CustomEvent('context-menu-translate-text', {
      detail: { text, x, y }
    })
  )
}

// 处理AI询问事件
const handleAskAI = (text: string) => {
  window.dispatchEvent(new CustomEvent('context-menu-ask-ai', { detail: text }))
}

const hashText = (value: string) => {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return `${hash}`
}

const resolveOffsets = (
  fullText: string,
  selectionText: string,
  range: Range | null,
  container: HTMLElement
) => {
  if (range && container.contains(range.startContainer) && container.contains(range.endContainer)) {
    const startRange = document.createRange()
    startRange.setStart(container, 0)
    startRange.setEnd(range.startContainer, range.startOffset)
    const endRange = document.createRange()
    endRange.setStart(container, 0)
    endRange.setEnd(range.endContainer, range.endOffset)

    const startOffset = startRange.toString().length
    const endOffset = endRange.toString().length
    if (endOffset > startOffset) {
      const matchedText = fullText.slice(startOffset, endOffset)
      if (!selectionText || matchedText === selectionText) {
        return { startOffset, endOffset }
      }
    }
  }

  if (selectionText) {
    const idx = fullText.indexOf(selectionText)
    if (idx !== -1) {
      return { startOffset: idx, endOffset: idx + selectionText.length }
    }
  }

  return null
}

const handleNewThreadFromSelection = async (text: string, x?: number, y?: number) => {
  const selection = window.getSelection()
  const selectionText = text || selection?.toString() || ''
  if (!selectionText.trim()) {
    return
  }

  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  let messageElement: HTMLElement | null = null
  let contentElement: HTMLElement | null = null

  if (range?.startContainer) {
    const startElement =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement
    messageElement = startElement?.closest('[data-message-id]') as HTMLElement | null
    contentElement = startElement?.closest('[data-message-content]') as HTMLElement | null
  }

  if (!messageElement && typeof x === 'number' && typeof y === 'number') {
    const elementAtPoint = document.elementFromPoint(x, y)
    messageElement = elementAtPoint?.closest('[data-message-id]') as HTMLElement | null
    contentElement = elementAtPoint?.closest('[data-message-content]') as HTMLElement | null
  }

  if (!messageElement) {
    console.warn('Context menu selection is not inside a message')
    return
  }

  const messageId = messageElement.getAttribute('data-message-id')
  if (!messageId) {
    return
  }

  const selectionContainer = contentElement ?? messageElement
  const fullText = selectionContainer.textContent ?? ''
  const offsets = resolveOffsets(fullText, selectionText, range, selectionContainer)
  if (!offsets) {
    console.warn('Failed to resolve selection offsets')
    return
  }

  const contextSize = 20
  const contextStart = Math.max(0, offsets.startOffset - contextSize)
  const contextEnd = Math.min(fullText.length, offsets.endOffset + contextSize)
  const parentSelection: ParentSelection = {
    selectedText: selectionText,
    startOffset: offsets.startOffset,
    endOffset: offsets.endOffset,
    contextBefore: fullText.slice(contextStart, offsets.startOffset),
    contextAfter: fullText.slice(offsets.endOffset, contextEnd),
    contentHash: hashText(fullText),
    version: 1
  }

  try {
    await chatStore.createChildThreadFromSelection({
      parentMessageId: messageId,
      parentSelection
    })
  } catch (error) {
    console.error('Failed to create child thread from selection:', error)
    await notificationP.showNotification({
      id: `child-thread-${messageId}`,
      title: t('common.error.createChatFailed'),
      body: t('common.error.operationFailed')
    })
  }
}

onMounted(() => {
  window.electron.ipcRenderer.on(
    'context-menu-translate',
    (_: unknown, text: string, x?: number, y?: number) => {
      handleTranslate(text, x, y)
    }
  )
  window.electron.ipcRenderer.on('context-menu-ask-ai', (_: unknown, text: string) => {
    handleAskAI(text)
  })
  window.electron.ipcRenderer.on(
    'context-menu-new-thread',
    (_: unknown, text: string, x?: number, y?: number) => {
      handleNewThreadFromSelection(text, x, y)
    }
  )
})

onUnmounted(() => {
  window.electron.ipcRenderer.removeAllListeners('context-menu-translate')
  window.electron.ipcRenderer.removeAllListeners('context-menu-ask-ai')
  window.electron.ipcRenderer.removeAllListeners('context-menu-new-thread')
})
</script>
