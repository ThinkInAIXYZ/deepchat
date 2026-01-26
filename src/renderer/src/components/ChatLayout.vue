<template>
  <div class="w-full h-full flex flex-row justify-center">
    <div class="flex flex-col overflow-hidden h-full flex-shink-0 min-w-xl max-w-2xl">
      <div class="flex flex-1 overflow-hidden">
        <!-- 消息列表区域 -->
        <div class="flex min-w-0 flex-1 overflow-hidden">
          <MessageList
            :key="chatStore.getActiveSessionId() ?? 'default'"
            ref="messageList"
            :items="chatStore.messageItems"
          />
        </div>
      </div>

      <!-- 输入框区域 -->
      <div class="flex-none px-0 pb-0">
        <ChatInput
          ref="chatInput"
          variant="agent"
          :disabled="!chatStore.getActiveSessionId() || isGenerating"
          @send="handleSend"
          @file-upload="handleFileUpload"
        />
      </div>
    </div>
    <!-- 统一的侧边面板 (workspace + artifact) -->
    <SidePanel @append-file-path="handleAppendFilePath" />
  </div>
  <!-- Clean messages dialog -->
  <Dialog v-model:open="cleanDialog.isOpen.value">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t('dialog.cleanMessages.title') }}</DialogTitle>
        <DialogDescription>
          {{ t('dialog.cleanMessages.description') }}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" @click="cleanDialog.cancel">{{ t('dialog.cancel') }}</Button>
        <Button variant="destructive" @click="cleanDialog.confirm">{{
          t('dialog.cleanMessages.confirm')
        }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue'
import MessageList from './message/MessageList.vue'
import ChatInput from './chat-input/ChatInput.vue'
import SidePanel from './SidePanel.vue'
import { useRoute } from 'vue-router'
import { UserMessageContent } from '@shared/chat'
import { SHORTCUT_EVENTS } from '@/events'
import { AgenticEventType } from '@shared/types/presenters/agentic.presenter.d'
import { useChatStore } from '@/stores/chat'
import { useWorkspaceStoreLifecycle } from '@/composables/useWorkspaceStoreLifecycle'
import { useCleanDialog } from '@/composables/message/useCleanDialog'
import { useI18n } from 'vue-i18n'
import type { CategorizedData } from '@/components/editor/mention/suggestion'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@shadcn/components/ui/dialog'
import { Button } from '@shadcn/components/ui/button'

const { t } = useI18n()
const route = useRoute()
const chatStore = useChatStore()
const workspaceStore = useWorkspaceStoreLifecycle()
const cleanDialog = useCleanDialog()

const messageList = ref()
const chatInput = ref()

const scrollToBottom = (smooth = true) => {
  messageList.value?.scrollToBottom(smooth)
}

const isGenerating = computed(() => {
  if (!chatStore.getActiveSessionId()) return false
  return chatStore.generatingSessionIds.has(chatStore.getActiveSessionId()!)
})

const handleSend = async (msg: UserMessageContent) => {
  scrollToBottom()
  await chatStore.sendMessage(msg)
  setTimeout(() => {
    chatInput.value?.restoreFocus()
  }, 100)
}

const handleFileUpload = () => {
  scrollToBottom()
}

const formatFilePathForEditor = (filePath: string) =>
  window.api?.formatPathForInput?.(filePath) ?? (/\s/.test(filePath) ? `"${filePath}"` : filePath)

const toRelativePath = (filePath: string) => {
  const workspacePath = workspaceStore.currentWorkspacePath ?? undefined
  return window.api?.toRelativePath?.(filePath, workspacePath) ?? filePath
}

const handleAppendFilePath = (filePath: string) => {
  const relativePath = toRelativePath(filePath)
  const formattedPath = formatFilePathForEditor(relativePath)
  chatInput.value?.appendText(`${formattedPath} `)
  chatInput.value?.restoreFocus()
}

const onStreamEnd = (_, _msg) => {
  // 状态处理已移至 store
  // 当用户没有主动向上滚动时才自动滚动到底部
  nextTick(() => {
    if (messageList.value && !messageList.value.aboveThreshold) {
      scrollToBottom(false)
    }
  })
  setTimeout(() => {
    chatInput.value?.restoreFocus()
  }, 200)
}

const onStreamError = (_, _msg) => {
  // 状态处理已移至 store
  setTimeout(() => {
    chatInput.value?.restoreFocus()
  }, 200)
}

const onCleanChatHistory = () => {
  cleanDialog.open()
}

watch(
  () => [chatStore.activeContextMention, chatInput.value] as const,
  ([mention, input]) => {
    if (!mention || !input) return
    const activeSessionId = chatStore.getActiveSessionId()
    if (!activeSessionId) return
    const mentionData: CategorizedData = {
      id: mention.id,
      label: mention.label,
      category: mention.category,
      type: 'item',
      content: mention.content
    }
    const inserted = input.appendCustomMention?.(mentionData)
    if (inserted) {
      chatStore.consumeContextMention(activeSessionId)
    }
  },
  { immediate: true }
)

// 监听流式响应
onMounted(async () => {
  window.electron.ipcRenderer.on(AgenticEventType.MESSAGE_END, onStreamEnd)
  window.electron.ipcRenderer.on(AgenticEventType.ERROR, onStreamError)
  window.electron.ipcRenderer.on(SHORTCUT_EVENTS.CLEAN_CHAT_HISTORY, onCleanChatHistory)

  if (route.query.modelId && route.query.providerId) {
    const sessionId = await chatStore.createThread('新会话', {
      modelId: route.query.modelId as string,
      providerId: route.query.providerId as string
    })
    chatStore.setActiveThread(sessionId)
  }
})

// 监听路由变化，创建新线程
watch(
  () => route.query,
  async () => {
    if (route.query.modelId && route.query.providerId) {
      const sessionId = await chatStore.createThread('新会话', {
        modelId: route.query.modelId as string,
        providerId: route.query.providerId as string
      })
      chatStore.setActiveThread(sessionId)
    }
  }
)

// 清理事件监听
onUnmounted(async () => {
  window.electron.ipcRenderer.removeAllListeners(AgenticEventType.MESSAGE_END)
  window.electron.ipcRenderer.removeAllListeners(AgenticEventType.ERROR)
  window.electron.ipcRenderer.removeAllListeners(SHORTCUT_EVENTS.CLEAN_CHAT_HISTORY)
})

defineExpose({
  messageList
})
</script>
