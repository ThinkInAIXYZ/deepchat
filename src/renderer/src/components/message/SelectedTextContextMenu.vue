<template>
  <div></div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

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
  window.electron.ipcRenderer.on(
    'context-menu-translate',
    (_: unknown, text: string, x?: number, y?: number) => {
      handleTranslate(text, x, y)
    }
  )
  window.electron.ipcRenderer.on('context-menu-ask-ai', (_: unknown, text: string) => {
    handleAskAI(text)
  })
})

onUnmounted(() => {
  window.electron.ipcRenderer.removeAllListeners('context-menu-translate')
  window.electron.ipcRenderer.removeAllListeners('context-menu-ask-ai')
})
</script>
