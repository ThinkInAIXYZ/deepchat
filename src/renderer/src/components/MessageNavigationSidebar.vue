<template>
  <div
    class="message-navigation-sidebar h-full w-full bg-background border-l border-border flex flex-col"
  >
    <!-- 头部 -->
    <div class="flex items-center justify-between p-4 border-b border-border">
      <h3 class="text-sm font-medium text-foreground">{{ t('chat.navigation.title') }}</h3>
      <Button variant="ghost" size="icon" class="h-6 w-6" @click="$emit('close')">
        <Icon icon="lucide:x" class="h-4 w-4" />
      </Button>
    </div>

    <!-- 搜索框 -->
    <div class="p-4 border-b border-border">
      <div class="relative">
        <Icon
          icon="lucide:search"
          class="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground"
        />
        <Input
          v-model="searchQuery"
          :placeholder="t('chat.navigation.searchPlaceholder')"
          class="pl-10 pr-8 h-8 text-sm"
        />
        <Button
          v-if="searchQuery.trim()"
          variant="ghost"
          size="icon"
          class="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6"
          @click="searchQuery = ''"
        >
          <Icon icon="lucide:x" class="h-3 w-3" />
        </Button>
      </div>

      <!-- 搜索结果计数 -->
      <div v-if="searchQuery.trim()" class="mt-2 text-xs text-muted-foreground">
        {{
          t('chat.navigation.searchResults', {
            count: filteredMessages.length,
            total: messages.length
          })
        }}
      </div>
    </div>

    <!-- 消息列表 -->
    <div ref="messagesContainer" class="flex-1 overflow-y-auto scroll-smooth relative">
      <div class="p-2 space-y-1">
        <div
          v-for="(message, index) in filteredMessages"
          :key="message.id"
          class="message-nav-item p-3 rounded-lg cursor-pointer transition-colors hover:bg-accent/50"
          :class="{
            'bg-accent': activeMessageId === message.id,
            'border-l-2 border-primary': activeMessageId === message.id
          }"
          @click="scrollToMessage(message.id)"
        >
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
              <div class="flex-shrink-0">
                <div
                  v-if="message.role === 'assistant'"
                  class="w-4 h-4 flex items-center justify-center bg-base-900/5 dark:bg-base-100/10 border border-input rounded-sm"
                >
                  <ModelIcon
                    :model-id="message.model_provider || 'default'"
                    class="w-2.5 h-2.5"
                    :is-dark="themeStore.isDark"
                  />
                </div>
                <div v-else class="w-4 h-4 bg-muted rounded-sm flex items-center justify-center">
                  <Icon icon="lucide:user" class="w-2.5 h-2.5 text-muted-foreground" />
                </div>
              </div>

              <span class="text-xs text-muted-foreground font-mono"> #{{ index + 1 }} </span>
            </div>

            <span class="text-xs text-muted-foreground">
              {{ formatTime(message.timestamp) }}
            </span>
          </div>

          <div class="text-sm text-foreground/80 line-clamp-2">
            <span v-html="highlightSearchQuery(getMessagePreview(message))"></span>
          </div>
        </div>
      </div>

      <div
        v-if="filteredMessages.length === 0"
        class="flex flex-col items-center justify-center h-32 text-muted-foreground"
      >
        <Icon icon="lucide:message-circle" class="h-8 w-8 mb-2" />
        <p class="text-sm">
          {{ searchQuery ? t('chat.navigation.noResults') : t('chat.navigation.noMessages') }}
        </p>
      </div>

      <!-- 滚动锚点 -->
      <div ref="scrollAnchor" class="h-2" />

      <!-- 滚动到底部按钮 -->
      <div v-if="showScrollToBottomButton && !searchQuery.trim()" class="absolute bottom-4 right-4">
        <Button
          variant="outline"
          size="icon"
          class="h-8 w-8 rounded-full shadow-lg bg-background border"
          @click="scrollToBottom"
        >
          <Icon icon="lucide:arrow-down" class="h-4 w-4" />
        </Button>
      </div>
    </div>

    <div class="p-4 border-t border-border">
      <div class="text-xs text-muted-foreground text-center">
        {{ t('chat.navigation.totalMessages', { count: messages.length }) }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { Icon } from '@iconify/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import type { Message } from '@shared/chat'

interface Props {
  messages: Message[]
  isOpen: boolean
  activeMessageId?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  close: []
  scrollToMessage: [messageId: string]
}>()

const { t } = useI18n()
const themeStore = useThemeStore()

const searchQuery = ref('')
const messagesContainer = ref<HTMLDivElement>()
const scrollAnchor = ref<HTMLDivElement>()
const showScrollToBottomButton = ref(false)

// 获取消息完整内容用于搜索
const getFullMessageContent = (message: Message): string => {
  if (message.role === 'user') {
    const userContent = message.content as import('@shared/chat').UserMessageContent
    return userContent.text || ''
  } else if (message.role === 'assistant') {
    const assistantMessage = message as import('@shared/chat').AssistantMessage
    let contentToDisplay =
      assistantMessage.content as import('@shared/chat').AssistantMessageBlock[]
    if (assistantMessage.variants && assistantMessage.variants.length > 0) {
      const latestVariant = assistantMessage.variants[assistantMessage.variants.length - 1]
      contentToDisplay = latestVariant.content as import('@shared/chat').AssistantMessageBlock[]
    }
    return contentToDisplay
      .filter((block: import('@shared/chat').AssistantMessageBlock) => block.type === 'content')
      .map((block: import('@shared/chat').AssistantMessageBlock) => block.content || '')
      .join(' ')
  }
  return ''
}

// 获取搜索匹配的上下文
const getSearchContext = (content: string, query: string, contextLength: number = 30): string => {
  const lowerContent = content.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const matchIndex = lowerContent.indexOf(lowerQuery)
  if (matchIndex === -1) return content.slice(0, 100)
  const start = Math.max(0, matchIndex - contextLength)
  const end = Math.min(content.length, matchIndex + query.length + contextLength)
  let result = content.slice(start, end)
  if (start > 0) result = '...' + result
  if (end < content.length) result = result + '...'
  return result
}

// 过滤消息
const filteredMessages = computed(() => {
  if (!searchQuery.value.trim()) {
    return props.messages
  }
  const query = searchQuery.value.toLowerCase()
  return props.messages.filter((message) => {
    const fullContent = getFullMessageContent(message).toLowerCase()
    return fullContent.includes(query)
  })
})

// 获取消息预览文本
const getMessagePreview = (message: Message): string => {
  const fullContent = getFullMessageContent(message)
  if (!fullContent) {
    if (message.role === 'user') {
      return t('chat.navigation.userMessage')
    } else if (message.role === 'assistant') {
      return t('chat.navigation.assistantMessage')
    }
    return t('chat.navigation.unknownMessage')
  }
  // 如果有搜索查询，显示搜索上下文
  if (searchQuery.value.trim()) {
    return getSearchContext(fullContent, searchQuery.value)
  }
  return fullContent.slice(0, 100) + (fullContent.length > 100 ? '...' : '')
}

// 格式化时间
const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  if (diff < 24 * 60 * 60 * 1000 && date.getDate() === now.getDate()) {
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    })
  }
  return date.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// 高亮搜索关键词
const highlightSearchQuery = (text: string): string => {
  if (!searchQuery.value.trim()) {
    return text
  }

  const query = searchQuery.value.trim()
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  return text.replace(
    regex,
    '<mark class="bg-yellow-200 dark:bg-yellow-800 px-1 rounded">$1</mark>'
  )
}

// 滚动到底部
const scrollToBottom = () => {
  nextTick(() => {
    scrollAnchor.value?.scrollIntoView({
      behavior: 'instant',
      block: 'end'
    })
  })
}

// 滚动到指定消息
const scrollToMessage = (messageId: string) => {
  emit('scrollToMessage', messageId)
}

watch(
  () => props.messages.length,
  (newLength, oldLength) => {
    // 只在新增消息时滚动，避免过度滚动
    if (newLength > oldLength && !searchQuery.value.trim()) {
      nextTick(() => {
        scrollToBottom()
      })
    }
  }
)

watch(
  () => props.isOpen,
  (newIsOpen) => {
    if (newIsOpen && !searchQuery.value.trim()) {
      nextTick(() => {
        scrollToBottom()
        setupScrollObserver()
      })
    } else if (newIsOpen) {
      nextTick(() => {
        setupScrollObserver()
      })
    }
  }
)

let intersectionObserver: IntersectionObserver | null = null

const setupScrollObserver = () => {
  if (intersectionObserver) {
    intersectionObserver.disconnect()
  }

  intersectionObserver = new IntersectionObserver(
    (entries) => {
      const entry = entries[0]
      showScrollToBottomButton.value = !entry.isIntersecting
    },
    {
      root: messagesContainer.value,
      rootMargin: '0px 0px 20px 0px',
      threshold: 0
    }
  )

  if (scrollAnchor.value) {
    intersectionObserver.observe(scrollAnchor.value)
  }
}

// 组件挂载时滚动到底部
onMounted(() => {
  if (props.isOpen && !searchQuery.value.trim()) {
    nextTick(() => {
      scrollToBottom()
      setupScrollObserver()
    })
  } else {
    nextTick(() => {
      setupScrollObserver()
    })
  }
})

// 清理观察器
onUnmounted(() => {
  if (intersectionObserver) {
    intersectionObserver.disconnect()
    intersectionObserver = null
  }
})
</script>

<style scoped>
.message-nav-item {
  transition: all 0.2s ease;
}

.message-nav-item:hover {
  transform: translateX(2px);
}

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
