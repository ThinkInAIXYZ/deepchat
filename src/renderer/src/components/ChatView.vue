<template>
  <div class="flex flex-col overflow-hidden h-0 flex-1">
    <div class="flex flex-1 overflow-hidden">
      <!-- 消息列表区域 -->
      <div class="flex min-w-0 flex-1 overflow-hidden">
        <MessageList
          :key="chatStore.getActiveThreadId() ?? 'default'"
          ref="messageList"
          :messages="chatStore.getMessages()"
        />
      </div>

      <!-- ACP Workspace 面板 -->
      <Transition name="workspace-slide">
        <AcpWorkspaceView v-if="showAcpWorkspace" class="h-full flex-shrink-0" />
      </Transition>
    </div>

    <!-- 输入框区域 -->
    <div class="flex-none px-0 pb-0">
      <ChatInput
        ref="chatInput"
        variant="chat"
        :context-length="chatStore.chatConfig.contextLength"
        :disabled="!chatStore.getActiveThreadId() || isGenerating"
        @send="handleSend"
        @file-upload="handleFileUpload"
      />
    </div>
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
import AcpWorkspaceView from './acp-workspace/AcpWorkspaceView.vue'
import { useRoute } from 'vue-router'
import { UserMessageContent } from '@shared/chat'
import { STREAM_EVENTS, SHORTCUT_EVENTS } from '@/events'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'
import { useChatStore } from '@/stores/chat'
import { useAcpWorkspaceStore } from '@/stores/acpWorkspace'
import { useCleanDialog } from '@/composables/message/useCleanDialog'
import { useI18n } from 'vue-i18n'
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
const uiSettingsStore = useUiSettingsStore()
const chatStore = useChatStore()
const acpWorkspaceStore = useAcpWorkspaceStore()
const cleanDialog = useCleanDialog()

// Show workspace only in ACP mode and when open
const showAcpWorkspace = computed(() => acpWorkspaceStore.isAcpMode && acpWorkspaceStore.isOpen)

const messageList = ref()
const chatInput = ref()

const scrollToBottom = (smooth = true) => {
  messageList.value?.scrollToBottom(smooth)
}
const isGenerating = computed(() => {
  if (!chatStore.getActiveThreadId()) return false
  return chatStore.generatingThreadIds.has(chatStore.getActiveThreadId()!)
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

// 监听流式响应
onMounted(async () => {
  window.electron.ipcRenderer.on(STREAM_EVENTS.END, onStreamEnd)
  window.electron.ipcRenderer.on(STREAM_EVENTS.ERROR, onStreamError)
  window.electron.ipcRenderer.on(SHORTCUT_EVENTS.CLEAN_CHAT_HISTORY, onCleanChatHistory)

  if (route.query.modelId && route.query.providerId) {
    const threadId = await chatStore.createThread('新会话', {
      modelId: route.query.modelId as string,
      providerId: route.query.providerId as string,
      artifacts: uiSettingsStore.artifactsEffectEnabled ? 1 : 0
    })
    chatStore.setActiveThread(threadId)
  }
})

// 监听路由变化，创建新线程
watch(
  () => route.query,
  async () => {
    if (route.query.modelId && route.query.providerId) {
      const threadId = await chatStore.createThread('新会话', {
        modelId: route.query.modelId as string,
        providerId: route.query.providerId as string,
        artifacts: uiSettingsStore.artifactsEffectEnabled ? 1 : 0
      })
      chatStore.setActiveThread(threadId)
    }
  }
)

// 清理事件监听
onUnmounted(async () => {
  window.electron.ipcRenderer.removeAllListeners(STREAM_EVENTS.END)
  window.electron.ipcRenderer.removeAllListeners(STREAM_EVENTS.ERROR)
  window.electron.ipcRenderer.removeAllListeners(SHORTCUT_EVENTS.CLEAN_CHAT_HISTORY)
})

defineExpose({
  messageList
})
</script>

<style scoped>
.workspace-slide-enter-active,
.workspace-slide-leave-active {
  transition: all 0.2s ease;
}

.workspace-slide-enter-from,
.workspace-slide-leave-to {
  opacity: 0;
  transform: translateX(100%);
}

.workspace-slide-enter-to,
.workspace-slide-leave-from {
  opacity: 1;
  transform: translateX(0);
}
</style>
