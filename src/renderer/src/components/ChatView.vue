<template>
  <div class="flex h-full flex-1 flex-col overflow-hidden">
    <Card class="flex h-full w-full flex-row bg-[color:var(--window-inner-border)]/0 border-none shadow-none">
      <div class="flex h-full flex-1 flex-col gap-0 overflow-hidden rounded-[8px] bg-[color:var(--card)]/80 backdrop-blur-md">
        <CardHeader class="flex items-center gap-3 border-b border-border/10 px-4 py-2">
          <slot name="title" />
        </CardHeader>
        <Separator class="bg-border/10" />
        <CardContent class="flex flex-1 flex-col gap-0 px-0 py-0">
          <ScrollArea class="flex-1">
            <MessageList
              :key="chatStore.getActiveThreadId() ?? 'default'"
              ref="messageList"
              :messages="chatStore.getMessages()"
              class="px-2 py-4 sm:px-4"
              @scroll-bottom="scrollToBottom"
            />
          </ScrollArea>
          <Separator class="bg-border/10" />
          <div class="flex flex-col gap-3 px-4 py-4">
            <p class="text-xs text-secondary-foreground">
              {{ t('chat.composer.footerHint') }}
            </p>
            <ChatComposer
              ref="chatInput"
              :disabled="!chatStore.getActiveThreadId() || isGenerating"
              @send="handleSend"
              @file-upload="handleFileUpload"
            />
          </div>
        </CardContent>
      </div>
      <Separator orientation="vertical" class="mx-2 hidden bg-border/10 lg:block" />
      <aside class="hidden w-[228px] flex-none flex-col rounded-[8px] border border-border/10 bg-[color:var(--sidebar-background)]/60 backdrop-blur-md lg:flex">
        <header class="flex items-center gap-2 border-b border-border/10 px-4 py-3">
          <Button variant="ghost" size="icon" class="h-8 w-8 rounded-lg">
            <Icon icon="lucide:panel-left-close" class="h-4 w-4" />
          </Button>
          <h2 class="text-sm font-medium text-foreground">{{ t('chat.workspace.title') }}</h2>
          <Button variant="ghost" size="icon" class="ml-auto h-8 w-8 rounded-lg">
            <Icon icon="lucide:logs" class="h-4 w-4" />
          </Button>
        </header>
        <ScrollArea class="flex-1">
          <div class="flex flex-col gap-4 px-4 py-4 text-xs">
            <section class="space-y-2">
              <header class="flex items-center justify-between text-secondary-foreground">
                <span>{{ t('chat.workspace.todos') }}</span>
                <span>1/2</span>
              </header>
              <ul class="space-y-2 text-foreground">
                <li class="flex items-center gap-2">
                  <Icon icon="lucide:list-todo" class="h-4 w-4" />
                  <span>{{ t('chat.workspace.todoList') }}</span>
                </li>
              </ul>
            </section>
            <section class="space-y-2">
              <header class="flex items-center justify-between text-secondary-foreground">
                <span>{{ t('chat.workspace.files') }}</span>
                <Button variant="ghost" size="icon" class="h-6 w-6 rounded-md">
                  <Icon icon="lucide:plus" class="h-3 w-3" />
                </Button>
              </header>
              <ul class="space-y-2 text-foreground">
                <li class="flex items-center gap-2">
                  <Icon icon="lucide:folder-closed" class="h-4 w-4" />
                  <span>backup</span>
                </li>
                <li class="flex items-center gap-2">
                  <Icon icon="lucide:folder-closed" class="h-4 w-4" />
                  <span>todo</span>
                </li>
                <li class="flex items-center gap-2">
                  <Icon icon="lucide:file-box" class="h-4 w-4" />
                  <span>space.md</span>
                </li>
                <li class="flex items-center gap-2">
                  <Icon icon="lucide:file-box" class="h-4 w-4" />
                  <span>design.md</span>
                </li>
                <li class="flex items-center gap-2">
                  <Icon icon="lucide:file-video" class="h-4 w-4" />
                  <span>record.mp4</span>
                </li>
                <li class="flex items-center gap-2">
                  <Icon icon="lucide:presentation" class="h-4 w-4" />
                  <span>presentation.pptx</span>
                </li>
              </ul>
            </section>
            <section class="space-y-2">
              <header class="text-secondary-foreground">
                <span>{{ t('chat.workspace.processes') }}</span>
              </header>
              <ul class="space-y-2 text-foreground">
                <li class="flex items-center gap-2">
                  <Icon icon="lucide:terminal" class="h-4 w-4" />
                  <span>curl -i ...</span>
                  <Icon icon="lucide:circle" class="ml-auto h-2 w-2 text-green-500" />
                </li>
                <li class="flex items-center gap-2">
                  <Icon icon="lucide:terminal" class="h-4 w-4" />
                  <span>ls -la</span>
                  <Icon icon="lucide:circle" class="ml-auto h-2 w-2 text-green-500" />
                </li>
                <li class="flex items-center gap-2">
                  <Icon icon="lucide:compass" class="h-4 w-4" />
                  <span>Browser</span>
                  <Icon icon="lucide:circle" class="ml-auto h-2 w-2 text-green-500" />
                </li>
              </ul>
            </section>
            <section class="space-y-2">
              <header class="text-secondary-foreground">
                <span>{{ t('chat.workspace.agents') }}</span>
              </header>
              <ul class="space-y-2 text-foreground">
                <li class="flex items-center gap-2">
                  <Icon icon="lucide:bot" class="h-4 w-4" />
                  <span>MiniCPM</span>
                </li>
                <li class="flex items-center gap-2">
                  <Icon icon="lucide:bot" class="h-4 w-4" />
                  <span>QwenSearcher</span>
                </li>
                <li class="flex items-center gap-2">
                  <Icon icon="lucide:bot" class="h-4 w-4" />
                  <span>ChatGPT</span>
                </li>
                <li class="flex items-center gap-2">
                  <Icon icon="lucide:bot" class="h-4 w-4" />
                  <span>GrokWriter</span>
                </li>
              </ul>
            </section>
          </div>
        </ScrollArea>
      </aside>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue'
import { Icon } from '@iconify/vue'
import { Card, CardContent, CardHeader } from '@shadcn/components/ui/card'
import { ScrollArea } from '@shadcn/components/ui/scroll-area'
import { Separator } from '@shadcn/components/ui/separator'
import { Button } from '@shadcn/components/ui/button'
import MessageList from './message/MessageList.vue'
import ChatComposer from './ChatComposer.vue'
import { useRoute } from 'vue-router'
import { UserMessageContent } from '@shared/chat'
import { STREAM_EVENTS } from '@/events'
import { useSettingsStore } from '@/stores/settings'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const route = useRoute()
const settingsStore = useSettingsStore()

const messageList = ref<InstanceType<typeof MessageList> | null>(null)
const chatInput = ref<InstanceType<typeof ChatComposer> | null>(null)

import { useChatStore } from '@/stores/chat'

const chatStore = useChatStore()

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

// 监听流式响应
onMounted(async () => {
  window.electron.ipcRenderer.on(STREAM_EVENTS.RESPONSE, (_, msg) => {
    // console.log('stream-response', msg)
    chatStore.handleStreamResponse(msg)
  })

  window.electron.ipcRenderer.on(STREAM_EVENTS.END, (_, msg) => {
    chatStore.handleStreamEnd(msg)
    // 当用户没有主动向上滚动时才自动滚动到底部
    nextTick(() => {
      if (messageList.value && !messageList.value.aboveThreshold) {
        scrollToBottom(false)
      }
    })
    setTimeout(() => {
      chatInput.value?.restoreFocus()
    }, 200)
  })

  window.electron.ipcRenderer.on(STREAM_EVENTS.ERROR, (_, msg) => {
    chatStore.handleStreamError(msg)
    setTimeout(() => {
      chatInput.value?.restoreFocus()
    }, 200)
  })

  if (route.query.modelId && route.query.providerId) {
    const threadId = await chatStore.createThread('新会话', {
      modelId: route.query.modelId as string,
      providerId: route.query.providerId as string,
      artifacts: settingsStore.artifactsEffectEnabled ? 1 : 0
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
        artifacts: settingsStore.artifactsEffectEnabled ? 1 : 0
      })
      chatStore.setActiveThread(threadId)
    }
  }
)

// 清理事件监听
onUnmounted(async () => {
  window.electron.ipcRenderer.removeAllListeners(STREAM_EVENTS.RESPONSE)
  window.electron.ipcRenderer.removeAllListeners(STREAM_EVENTS.END)
  window.electron.ipcRenderer.removeAllListeners(STREAM_EVENTS.ERROR)
})

defineExpose({
  messageList
})

</script>
