<template>
  <div></div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { createContextMenuClient } from '@api/ContextMenuClient'

const contextMenuClient = createContextMenuClient()
const cleanupContextMenuListeners: Array<() => void> = []

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

onMounted(() => {
  cleanupContextMenuListeners.push(
    contextMenuClient.onTranslateRequested((payload) => {
      handleTranslate(payload.text, payload.x, payload.y)
    }),
    contextMenuClient.onAskAiRequested((payload) => {
      handleAskAI(payload.text)
    })
  )
})

onUnmounted(() => {
  for (const cleanup of cleanupContextMenuListeners.splice(0)) {
    cleanup()
  }
})
</script>
