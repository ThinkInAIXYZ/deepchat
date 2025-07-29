<template>
  <div class="w-full h-full relative min-h-0">
    <div
      ref="messagesContainer"
      class="message-list-container relative flex-1 overflow-y-auto scroll-smooth w-full h-full"
      @scroll="handleScroll"
    >
      <div
        ref="messageList"
        class="w-full break-all max-w-4xl mx-auto transition-opacity duration-300"
        :class="{ 'opacity-0': !visible }"
      >
        <template v-for="(msg, index) in messages" :key="msg.id">
          <MessageItemAssistant
            v-if="msg.role === 'assistant'"
            :key="index"
            :ref="setAssistantRef(index)"
            :message="msg as AssistantMessage"
            :is-capturing-image="isCapturingImage"
            @copy-image="handleCopyImage"
            @scroll-to-bottom="scrollToBottom"
          />
          <MessageItemUser
            v-if="msg.role === 'user'"
            :key="index"
            :message="msg as UserMessage"
            @retry="handleRetry(index)"
            @scroll-to-bottom="scrollToBottom"
          />
        </template>
      </div>
      <div ref="scrollAnchor" class="h-8" />
    </div>
    <template v-if="!isCapturingImage">
      <div v-if="showCancelButton" class="absolute bottom-2 left-1/2 -translate-x-1/2">
        <Button variant="outline" size="sm" class="rounded-lg" @click="handleCancel">
          <Icon
            icon="lucide:square"
            class="w-6 h-6 bg-red-500 p-1 text-primary-foreground rounded-full"
          />
          <span class="">{{ t('common.cancel') }}</span>
        </Button>
      </div>
      <div
        v-else
        class="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center"
        :class="[aboveThreshold ? 'w-36' : ' w-24']"
        :style="{
          transition: 'width 300ms ease-in-out'
        }"
      >
        <Button variant="outline" size="sm" class="rounded-lg shrink-0" @click="createNewThread">
          <Icon icon="lucide:plus" class="w-6 h-6 text-muted-foreground" />
          <span class="">{{ t('common.newChat') }}</span>
        </Button>
        <transition
          enter-active-class="transition-all duration-300 ease-out"
          enter-from-class="opacity-0 translate-y-2"
          enter-to-class="opacity-100 translate-y-0"
          leave-active-class="transition-all duration-300 ease-in"
          leave-from-class="opacity-100 translate-y-0"
          leave-to-class="opacity-0 translate-y-2"
        >
          <Button
            v-if="aboveThreshold"
            variant="outline"
            size="icon"
            class="w-8 h-8 ml-2 shrink-0 rounded-lg"
            @click="scrollToBottom"
          >
            <Icon icon="lucide:arrow-down" class="w-5 h-5 text-muted-foreground" />
          </Button>
        </transition>
      </div>
    </template>
    <ReferencePreview
      class="pointer-events-none"
      :show="referenceStore.showPreview"
      :content="referenceStore.currentReference"
      :rect="referenceStore.previewRect"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, watch, computed, reactive } from 'vue'
import MessageItemAssistant from './MessageItemAssistant.vue'
import MessageItemUser from './MessageItemUser.vue'
import { AssistantMessage, UserMessage } from '@shared/chat'
import { useElementBounding, useDebounceFn } from '@vueuse/core'
import { Button } from '@/components/ui/button'
import { Icon } from '@iconify/vue'
import { useChatStore } from '@/stores/chat'
import { useI18n } from 'vue-i18n'
import { useReferenceStore } from '@/stores/reference'
import ReferencePreview from './ReferencePreview.vue'
import { useThemeStore } from '@/stores/theme'
import { usePageCapture } from '@/composables/usePageCapture'
import { usePresenter } from '@/composables/usePresenter'

const { t } = useI18n()
const props = defineProps<{
  messages: UserMessage[] | AssistantMessage[]
}>()
const themeStore = useThemeStore()
const referenceStore = useReferenceStore()
const chatStore = useChatStore()

const devicePresenter = usePresenter('devicePresenter')
const appVersion = ref('')

// 截图相关功能
const { isCapturing: isCapturingImage, captureAndCopy } = usePageCapture()

const messagesContainer = ref<HTMLDivElement>()
const messageList = ref<HTMLDivElement>()
const scrollAnchor = ref<HTMLDivElement>()
const visible = ref(false)

// Store refs as Record to avoid type checking issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const assistantRefs = reactive<Record<number, any>>({})

// Helper function to set refs
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const setAssistantRef = (index: number) => (el: any) => {
  if (el) {
    assistantRefs[index] = el
  }
}

/**
 * 查找用户消息DOM元素
 * 通过parentId查找对应的用户消息
 */
const findUserMessageElement = (parentId: string): HTMLElement | null => {
  if (!parentId) return null

  // 在DOM中查找包含用户消息ID的元素
  const userMessageSelector = `[data-message-id="${parentId}"]`
  return document.querySelector(userMessageSelector) as HTMLElement
}

/**
 * 计算包含用户消息和助手消息的整体范围
 */
const calculateMessageGroupRect = (
  messageId: string,
  parentId?: string
): {
  x: number
  y: number
  width: number
  height: number
} | null => {
  const userMessageElement = parentId ? findUserMessageElement(parentId) : null
  const assistantMessageElement = document.querySelector(
    `[data-message-id="${messageId}"]`
  ) as HTMLElement

  if (!userMessageElement || !assistantMessageElement) {
    // 如果找不到用户消息，只截取当前助手消息
    if (assistantMessageElement) {
      const rect = assistantMessageElement.getBoundingClientRect()
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    }
    return null
  }

  const userRect = userMessageElement.getBoundingClientRect()
  const assistantRect = assistantMessageElement.getBoundingClientRect()

  const left = Math.min(userRect.left, assistantRect.left)
  const top = Math.min(userRect.top, assistantRect.top)
  const right = Math.max(userRect.right, assistantRect.right)
  const bottom = Math.max(userRect.bottom, assistantRect.bottom)

  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top)
  }
}

/**
 * 计算从会话顶部到当前消息的整体范围
 */
const calculateFromTopToCurrentRect = (
  messageId: string
): {
  x: number
  y: number
  width: number
  height: number
} | null => {
  const currentMessageElement = document.querySelector(
    `[data-message-id="${messageId}"]`
  ) as HTMLElement
  if (!currentMessageElement) return null

  const container = document.querySelector('.message-list-container')
  if (!container) return null

  // 获取容器内的所有消息元素
  const allMessages = container.querySelectorAll('[data-message-id]')
  if (allMessages.length === 0) return null

  // 找到第一条消息和当前消息
  const firstMessage = allMessages[0] as HTMLElement
  const currentRect = currentMessageElement.getBoundingClientRect()
  const firstRect = firstMessage.getBoundingClientRect()

  // 计算范围
  const left = Math.min(firstRect.left, currentRect.left)
  const top = Math.min(firstRect.top, currentRect.top)
  const right = Math.max(firstRect.right, currentRect.right)
  const bottom = Math.max(firstRect.bottom, currentRect.bottom)

  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top)
  }
}

/**
 * 处理复制图片操作
 * @param messageId 消息ID
 * @param parentId 父消息ID（用户消息ID）
 * @param fromTop 是否从会话顶部开始截取到当前消息，默认为 false
 * @param modelInfo 模型信息
 */
const handleCopyImage = async (
  messageId: string,
  parentId?: string,
  fromTop: boolean = false,
  modelInfo?: { model_name: string; model_provider: string }
) => {
  const getTargetRect = fromTop
    ? () => calculateFromTopToCurrentRect(messageId)
    : () => calculateMessageGroupRect(messageId, parentId)

  const success = await captureAndCopy({
    container: '.message-list-container',
    getTargetRect,
    watermark: {
      isDark: themeStore.isDark,
      version: appVersion.value,
      texts: {
        brand: 'DeepChat',
        tip: t('common.watermarkTip'),
        model: modelInfo?.model_name,
        provider: modelInfo?.model_provider
      }
    }
  })

  if (!success) {
    console.error('截图复制失败')
  }
}

const scrollToBottom = () => {
  nextTick(() => {
    scrollAnchor.value?.scrollIntoView({
      behavior: 'instant',
      block: 'end'
    })
  })
}

onMounted(() => {
  // 获取应用版本
  devicePresenter.getAppVersion().then((version) => {
    appVersion.value = version
  })

  setTimeout(() => {
    scrollToBottom()
    nextTick(() => {
      visible.value = true
    })
  }, 100)

  const { height } = useElementBounding(messageList.value)
  watch(
    () => height.value,
    () => {
      const lastMessage = props.messages[props.messages.length - 1]
      if (lastMessage?.status === 'pending' && !aboveThreshold.value) {
        scrollToBottom()
      }
    }
  )
})

const aboveThreshold = ref(false)
const SCROLL_THRESHOLD = 20
const handleScroll = useDebounceFn((event) => {
  const rect = messageList.value?.getBoundingClientRect()
  const container = event.target
  if (rect?.height) {
    const scrollBottom = container.scrollHeight - (container.scrollTop + container.clientHeight)
    aboveThreshold.value = scrollBottom > SCROLL_THRESHOLD
  }
}, 100)

const showCancelButton = computed(() => {
  return chatStore.generatingThreadIds.has(chatStore.getActiveThreadId() ?? '')
})

const handleCancel = () => {
  if (!chatStore.getActiveThreadId()) return
  chatStore.cancelGenerating(chatStore.getActiveThreadId()!)
}

// Handle retry event from MessageItemUser
const handleRetry = (index: number) => {
  // Find the next assistant message after this user message
  for (let i = index + 1; i < props.messages.length; i++) {
    if (props.messages[i].role === 'assistant') {
      try {
        const assistantRef = assistantRefs[i]
        if (assistantRef && typeof assistantRef.handleAction === 'function') {
          assistantRef.handleAction('retry')
          break
        }
      } catch (error) {
        console.error('Failed to trigger retry action:', error)
      }
    }
  }
}
// 创建新会话
const createNewThread = async () => {
  try {
    await chatStore.clearActiveThread()
  } catch (error) {
    console.error(t('common.error.createChatFailed'), error)
  }
}
defineExpose({
  scrollToBottom,
  aboveThreshold
})
</script>
