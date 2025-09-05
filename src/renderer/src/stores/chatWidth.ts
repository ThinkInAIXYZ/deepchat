// src/renderer/src/stores/chatWidth.ts
import { usePresenter } from '@/composables/usePresenter'
import { defineStore } from 'pinia'
import { ref, onMounted, onUnmounted } from 'vue'
import { ChatWidthMode, CHAT_WIDTH_MODES_CYCLE } from '../../../constants/chatWidthModes'
import { CONFIG_EVENTS } from '../events'

export const useChatWidthStore = defineStore('chatWidth', () => {
  const configPresenter = usePresenter('configPresenter')
  const chatWidthMode = ref<ChatWidthMode>(ChatWidthMode.MEDIUM)

  const initChatWidth = async () => {
    const currentChatWidth = (await configPresenter.getChatWidth()) as ChatWidthMode
    chatWidthMode.value = currentChatWidth
    console.log('initChatWidth:', currentChatWidth)
  }

  initChatWidth()

  const handleChatWidthChange = (_event: Electron.IpcRendererEvent, mode: ChatWidthMode) => {
    console.log('handleChatWidthChange', mode)
    chatWidthMode.value = mode
  }

  onMounted(async () => {
    window.electron.ipcRenderer.on(CONFIG_EVENTS.CHAT_WIDTH_CHANGED, handleChatWidthChange)
  })

  onUnmounted(() => {
    window.electron.ipcRenderer.removeListener(
      CONFIG_EVENTS.CHAT_WIDTH_CHANGED,
      handleChatWidthChange
    )
  })

  const setChatWidthMode = async (newMode: ChatWidthMode) => {
    chatWidthMode.value = newMode
    await configPresenter.setChatWidth(newMode)
  }

  const cycleChatWidth = async () => {
    console.log('cycleChatWidth', chatWidthMode.value)
    const currentIndex = CHAT_WIDTH_MODES_CYCLE.indexOf(chatWidthMode.value)
    const nextIndex = (currentIndex + 1) % CHAT_WIDTH_MODES_CYCLE.length
    const newMode = CHAT_WIDTH_MODES_CYCLE[nextIndex]
    await setChatWidthMode(newMode)
  }

  return {
    chatWidthMode,
    cycleChatWidth
  }
})
