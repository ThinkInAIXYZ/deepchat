<template>
  <div
    :data-message-id="message.id"
    class="flex flex-row py-4 pl-4 pr-11 group gap-2 w-full justify-start assistant-message-item"
  >
    <div
      class="flex-shrink-0 w-5 h-5 flex items-center justify-center bg-base-900/5 dark:bg-base-100/10 border border-input rounded-md"
    >
      <ModelIcon
        :model-id="currentMessage.model_provider"
        custom-class="w-3 h-3"
        :is-dark="themeStore.isDark"
        :alt="currentMessage.role"
      />
    </div>

    <div class="flex flex-col w-full space-y-1.5">
      <MessageInfo :name="currentMessage.model_name" :timestamp="currentMessage.timestamp" />
      <div
        v-if="currentContent.length === 0"
        class="flex flex-row items-center gap-2 text-xs text-muted-foreground"
      >
        <Icon icon="lucide:loader-circle" class="w-4 h-4 animate-spin" />
        {{ t('chat.messages.thinking') }}
      </div>
      <div v-else class="flex flex-col w-full space-y-2">
        <template v-for="(block, idx) in currentContent" :key="`${message.id}-${idx}`">
          <MessageBlockContent
            v-if="block.type === 'content'"
            :block="block"
            :message-id="currentMessage.id"
            :thread-id="currentThreadId"
            :is-search-result="isSearchResult"
          />
          <MessageBlockThink
            v-else-if="block.type === 'reasoning_content'"
            :block="block"
            :usage="message.usage"
          />
          <MessageBlockSearch
            v-else-if="block.type === 'search'"
            :message-id="currentMessage.id"
            :block="block"
          />
          <MessageBlockToolCall
            v-else-if="block.type === 'tool_call'"
            :block="block"
            :message-id="currentMessage.id"
            :thread-id="currentThreadId"
          />
          <MessageBlockPermissionRequest
            v-else-if="block.type === 'action' && block.action_type === 'tool_call_permission'"
            :block="block"
            :message-id="currentMessage.id"
            :conversation-id="currentThreadId"
          />
          <MessageBlockAction
            v-else-if="block.type === 'action'"
            :message-id="currentMessage.id"
            :conversation-id="currentThreadId"
            :block="block"
          />
          <MessageBlockImage
            v-else-if="block.type === 'image'"
            :block="block"
            :message-id="currentMessage.id"
            :thread-id="currentThreadId"
          />
          <MessageBlockError v-else-if="block.type === 'error'" :block="block" />
        </template>
      </div>
      <MessageToolbar
        :loading="message.status === 'pending'"
        :usage="message.usage"
        :is-assistant="true"
        :current-variant-index="currentVariantIndex"
        :total-variants="totalVariants"
        :is-in-generating-thread="chatStore.generatingThreadIds.has(currentThreadId)"
        :is-capturing-image="isCapturingImage"
        @retry="handleAction('retry')"
        @delete="handleAction('delete')"
        @copy="handleAction('copy')"
        @copy-image="handleAction('copyImage')"
        @copy-image-from-top="handleAction('copyImageFromTop')"
        @prev="handleAction('prev')"
        @next="handleAction('next')"
        @fork="handleAction('fork')"
      />
    </div>
  </div>

  <!-- 分支会话确认对话框 -->
  <Dialog v-model:open="isForkDialogOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ t('dialog.fork.title') }}</DialogTitle>
        <DialogDescription>
          {{ t('dialog.fork.description') }}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" @click="cancelFork">
          {{ t('dialog.cancel') }}
        </Button>
        <Button variant="default" @click="confirmFork">
          {{ t('dialog.fork.confirm') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { AssistantMessage, AssistantMessageBlock } from '@shared/chat'
import MessageBlockContent from './MessageBlockContent.vue'
import MessageBlockThink from './MessageBlockThink.vue'
import MessageBlockSearch from './MessageBlockSearch.vue'
import MessageBlockToolCall from './MessageBlockToolCall.vue'
import MessageBlockError from './MessageBlockError.vue'
import MessageBlockPermissionRequest from './MessageBlockPermissionRequest.vue'
import MessageToolbar from './MessageToolbar.vue'
import MessageInfo from './MessageInfo.vue'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { Icon } from '@iconify/vue'
import MessageBlockAction from './MessageBlockAction.vue'
import { useI18n } from 'vue-i18n'
import MessageBlockImage from './MessageBlockImage.vue'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useThemeStore } from '@/stores/theme'
const props = defineProps<{
  message: AssistantMessage
  isCapturingImage: boolean
}>()

const themeStore = useThemeStore()
const chatStore = useChatStore()
const settingsStore = useSettingsStore()
const currentVariantIndex = ref(0)
const { t } = useI18n()

// 定义事件
const emit = defineEmits<{
  copyImage: [
    messageId: string,
    parentId: string | undefined,
    fromTop: boolean,
    modelInfo: { model_name: string; model_provider: string }
  ]
  scrollToBottom: []
}>()

// 获取当前会话ID
const currentThreadId = computed(() => chatStore.getActiveThreadId() || '')

// 获取当前显示的消息（根据变体索引）
const currentMessage = computed(() => {
  if (currentVariantIndex.value === 0) {
    return props.message
  }

  const variant = allVariants.value[currentVariantIndex.value - 1]
  return variant || props.message
})

// 计算当前消息的所有变体（包括缓存中的）
const allVariants = computed(() => {
  const messageVariants = props.message.variants || []
  const combinedVariants = messageVariants.map((variant) => {
    const cachedVariant = Array.from(chatStore.getGeneratingMessagesCache().values()).find(
      (cached) => {
        const msg = cached.message as AssistantMessage
        return msg.is_variant && msg.id === variant.id
      }
    )
    return cachedVariant ? cachedVariant.message : variant
  })
  return combinedVariants
})

// 计算变体总数
const totalVariants = computed(() => allVariants.value.length + 1)

// 获取当前显示的内容
const currentContent = computed(() => {
  if (currentVariantIndex.value === 0) {
    return props.message.content as AssistantMessageBlock[]
  }

  const variant = allVariants.value[currentVariantIndex.value - 1]
  return (variant?.content || props.message.content) as AssistantMessageBlock[]
})

// 监听变体变化
watch(
  () => allVariants.value.length,
  (newLength, oldLength) => {
    // 如果当前没有选中任何变体，或者当前选中的是最后一个变体
    // 则自动跟随最新的变体
    if (currentVariantIndex.value === 0 || newLength > oldLength) {
      currentVariantIndex.value = newLength
    }
    // 如果当前选中的变体超出范围，调整到最后一个变体
    else if (currentVariantIndex.value > newLength) {
      currentVariantIndex.value = newLength
    }
  }
)

const isSearchResult = computed(() => {
  return Boolean(
    currentContent.value?.some((block) => block.type === 'search' && block.status === 'success')
  )
})

onMounted(async () => {
  currentVariantIndex.value = allVariants.value.length
})

// 分支会话对话框
const isForkDialogOpen = ref(false)

// 显示分支对话框
const showForkDialog = () => {
  isForkDialogOpen.value = true
}

// 取消分支
const cancelFork = () => {
  isForkDialogOpen.value = false
}

// 确认分支
const confirmFork = async () => {
  try {
    // 执行fork操作
    await chatStore.forkThread(currentMessage.value.id, t('dialog.fork.tag'))
    isForkDialogOpen.value = false
  } catch (error) {
    console.error('创建对话分支失败:', error)
  }
}

type HandleActionType =
  | 'retry'
  | 'delete'
  | 'copy'
  | 'prev'
  | 'next'
  | 'copyImage'
  | 'copyImageFromTop'
  | 'fork'

const handleAction = (action: HandleActionType) => {
  if (action === 'retry') {
    chatStore.retryMessage(currentMessage.value.id)
  } else if (action === 'delete') {
    chatStore.deleteMessage(currentMessage.value.id)
  } else if (action === 'copy') {
    window.api.copyText(
      currentContent.value
        .filter((block) => {
          if (
            (block.type === 'reasoning_content' || block.type === 'artifact-thinking') &&
            !settingsStore.copyWithCotEnabled
          ) {
            return false
          }
          return true
        })
        .map((block) => {
          const trimmedContent = (block.content ?? '').trim()
          if (
            (block.type === 'reasoning_content' || block.type === 'artifact-thinking') &&
            settingsStore.copyWithCotEnabled
          ) {
            return `<think>\n${trimmedContent}\n</think>`
          }
          return trimmedContent
        })
        .join('\n')
        .trim()
    )
  } else if (action === 'prev' || action === 'next') {
    switch (action) {
      case 'prev':
        currentVariantIndex.value > 0 && currentVariantIndex.value--
        break
      case 'next':
        currentVariantIndex.value < totalVariants.value - 1 && currentVariantIndex.value++
        break
    }

    emit('scrollToBottom')
  } else if (action === 'copyImage') {
    emit('copyImage', currentMessage.value.id, currentMessage.value.parentId, false, {
      model_name: currentMessage.value.model_name,
      model_provider: currentMessage.value.model_provider
    })
  } else if (action === 'copyImageFromTop') {
    emit('copyImage', currentMessage.value.id, currentMessage.value.parentId, true, {
      model_name: currentMessage.value.model_name,
      model_provider: currentMessage.value.model_provider
    })
  } else if (action === 'fork') {
    showForkDialog()
  }
}

// Expose the handleAction method to parent components
defineExpose({
  handleAction
})
</script>
