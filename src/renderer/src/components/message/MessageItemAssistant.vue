<template>
  <div
    :data-message-id="message.id"
    class="flex flex-row pl-4 pt-5 pr-11 group gap-2 w-full justify-start assistant-message-item"
  >
    <div class="shrink-0 w-5 h-5 flex items-center justify-center">
      <ModelIcon
        v-if="currentMessage.model_provider === 'acp'"
        :model-id="currentMessage.model_id"
        :is-dark="themeStore.isDark"
        custom-class="w-[18px] h-[18px]"
      />
      <ModelIcon
        v-else
        :model-id="currentMessage.model_provider"
        custom-class="w-[18px] h-[18px]"
        :is-dark="themeStore.isDark"
        :alt="currentMessage.role"
      />
    </div>

    <div class="flex flex-col w-full space-y-1.5">
      <MessageInfo :name="currentMessage.model_name" :timestamp="currentMessage.timestamp" />
      <Spinner v-if="currentContent.length === 0" class="size-3 text-muted-foreground" />
      <div v-else class="flex flex-col w-full gap-1.5" data-message-content="true">
        <template v-for="(block, idx) in currentContent" :key="`${message.id}-${idx}`">
          <MessageBlockContent
            v-if="block.type === 'content'"
            :block="block"
            :message-id="currentMessage.id"
            :session-id="currentSessionId"
            :is-search-result="isSearchResult"
          />
          <MessageBlockThink
            v-else-if="block.type === 'reasoning_content' && block.content"
            :block="block"
            :usage="message.usage"
            @toggle-collapse="handleCollapseToggle"
          />
          <MessageBlockPlan v-else-if="block.type === 'plan'" :block="block" />
          <MessageBlockSearch
            v-else-if="block.type === 'search'"
            :message-id="currentMessage.id"
            :block="block"
          />
          <MessageBlockToolCall
            v-else-if="block.type === 'tool_call'"
            :block="block"
            :message-id="currentMessage.id"
            :session-id="currentSessionId"
          />
          <template
            v-else-if="block.type === 'action' && block.action_type === 'tool_call_permission'"
          >
            <MessageBlockPermissionRequest
              v-if="block.extra?.needsUserAction"
              :block="block"
              :message-id="currentMessage.id"
              :session-id="currentSessionId"
            />
          </template>
          <MessageBlockQuestionRequest
            v-else-if="block.type === 'action' && block.action_type === 'question_request'"
            :block="block"
            :message-id="currentMessage.id"
            :conversation-id="currentThreadId"
          />
          <MessageBlockAction
            v-else-if="block.type === 'action'"
            :message-id="currentMessage.id"
            :session-id="currentSessionId"
            :block="block"
          />
          <MessageBlockMcpUi
            v-else-if="block.type === 'mcp_ui_resource'"
            :block="block"
            :message-id="currentMessage.id"
            :session-id="currentSessionId"
          />
          <MessageBlockAudio
            v-else-if="isAudioBlock(block)"
            :block="block"
            :message-id="currentMessage.id"
            :thread-id="currentThreadId"
          />
          <MessageBlockImage
            v-else-if="block.type === 'image'"
            :block="block"
            :message-id="currentMessage.id"
            :session-id="currentSessionId"
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
        :is-in-generating-thread="chatStore.generatingSessionIds.has(currentSessionId)"
        :is-capturing-image="isCapturingImage"
        @retry="handleAction('retry')"
        @delete="handleAction('delete')"
        @copy="handleAction('copy')"
        @copy-image="handleAction('copyImage')"
        @copy-image-from-top="handleAction('copyImageFromTop')"
        @prev="handleAction('prev')"
        @next="handleAction('next')"
        @fork="handleAction('fork')"
        @trace="handleAction('trace')"
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
import { ref, computed, watch } from 'vue'
import { AssistantMessage, AssistantMessageBlock } from '@shared/chat'
import MessageBlockContent from './MessageBlockContent.vue'
import MessageBlockThink from './MessageBlockThink.vue'
import MessageBlockSearch from './MessageBlockSearch.vue'
import MessageBlockToolCall from './MessageBlockToolCall.vue'
import MessageBlockError from './MessageBlockError.vue'
import MessageBlockPermissionRequest from './MessageBlockPermissionRequest.vue'
import MessageBlockQuestionRequest from './MessageBlockQuestionRequest.vue'
import MessageToolbar from './MessageToolbar.vue'
import MessageInfo from './MessageInfo.vue'
import { useChatStore } from '@/stores/chat'
import { useUiSettingsStore } from '@/stores/uiSettingsStore'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { Spinner } from '@shadcn/components/ui/spinner'
import MessageBlockAction from './MessageBlockAction.vue'
import { useI18n } from 'vue-i18n'
import MessageBlockImage from './MessageBlockImage.vue'
import MessageBlockAudio from './MessageBlockAudio.vue'
import MessageBlockMcpUi from './MessageBlockMcpUi.vue'
import MessageBlockPlan from './MessageBlockPlan.vue'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { Button } from '@shadcn/components/ui/button'
import { useThemeStore } from '@/stores/theme'
const props = defineProps<{
  message: AssistantMessage
  isCapturingImage: boolean
}>()

const themeStore = useThemeStore()
const chatStore = useChatStore()
const uiSettingsStore = useUiSettingsStore()
const { t } = useI18n()

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.webm']

const isAudioBlock = (block: AssistantMessageBlock): boolean => {
  if (block.type === 'audio') return true
  if (block.type !== 'image') return false
  const mimeType = block.image_data?.mimeType?.toLowerCase() || ''
  if (mimeType.startsWith('audio/')) return true
  const data = block.image_data?.data || ''
  if (data.startsWith('data:audio/')) return true
  if (data.startsWith('imgcache://') || data.startsWith('http://') || data.startsWith('https://')) {
    const lower = data.toLowerCase()
    return AUDIO_EXTENSIONS.some((ext) => lower.includes(ext))
  }
  return false
}

// 定义事件
const emit = defineEmits<{
  copyImage: [
    messageId: string,
    parentId: string | undefined,
    fromTop: boolean,
    modelInfo: { model_name: string; model_provider: string }
  ]
  variantChanged: [messageId: string]
  trace: [messageId: string]
}>()

// 获取当前会话ID
const currentSessionId = computed(() => chatStore.getActiveSessionId() || '')
const currentThreadId = computed(
  () => chatStore.activeThread?.id || chatStore.getActiveSessionId() || ''
)

// currentVariantIndex: 0 = 主消息, 1-N = 对应的变体索引
// Variant selection has been removed in Phase 6 (chatConfig removal)
const currentVariantIndex = computed(() => {
  return 0 // Always show main message (no variant selection)
})

// 获取当前显示的消息（根据变体索引）
const currentMessage = computed(() => {
  if (currentVariantIndex.value === 0) {
    return props.message
  }

  const variant = allVariants.value[currentVariantIndex.value - 1]
  return variant || props.message
})

// 计算当前消息的所有变体（包括缓存中的，过滤掉主消息本身）
const allVariants = computed(() => {
  const messageVariants = props.message.variants || []
  const variantsById = new Map<string, AssistantMessage>()

  // 只添加真正的变体（is_variant !== 0），过滤掉主消息本身
  messageVariants.forEach((variant) => {
    if (variant.is_variant !== 0) {
      variantsById.set(variant.id, variant as AssistantMessage)
    }
  })

  for (const [, cached] of chatStore.getGeneratingMessagesCache().entries()) {
    const msg = cached.message
    if (
      props.message.parentId &&
      msg.role === 'assistant' &&
      msg.is_variant &&
      msg.parentId === props.message.parentId
    ) {
      variantsById.set(msg.id, msg as AssistantMessage)
    }
  }

  return Array.from(variantsById.values())
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

// 监听 allVariants 长度变化，用于新变体生成时的自动切换和持久化
// Variant selection has been removed in Phase 6 (chatConfig removal)
watch(
  () => allVariants.value.length,
  (_newLength, _oldLength) => {
    // Variant auto-switch removed - no longer needed
  }
)

const isSearchResult = computed(() => {
  return Boolean(
    currentContent.value?.some((block) => block.type === 'search' && block.status === 'success')
  )
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
  | 'trace'

const handleCollapseToggle = () => {
  emit('variantChanged', props.message.id)
}

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
            !uiSettingsStore.copyWithCotEnabled
          ) {
            return false
          }
          return true
        })
        .map((block) => {
          const trimmedContent = (block.content ?? '').trim()
          if (
            (block.type === 'reasoning_content' || block.type === 'artifact-thinking') &&
            uiSettingsStore.copyWithCotEnabled
          ) {
            return `<think>\n${trimmedContent}\n</think>`
          }
          return trimmedContent
        })
        .join('\n')
        .trim()
    )
  } else if (action === 'prev' || action === 'next') {
    let newIndex = currentVariantIndex.value

    if (action === 'prev' && newIndex > 0) {
      newIndex--
    } else if (action === 'next' && newIndex < totalVariants.value - 1) {
      newIndex++
    }

    if (newIndex === currentVariantIndex.value) return

    // Variant selection has been removed in Phase 6 (chatConfig removal)
    // const selectedVariantId = newIndex > 0 ? allVariants.value[newIndex - 1]?.id : null
    // chatStore.updateSelectedVariant(props.message.id, selectedVariantId)
    emit('variantChanged', props.message.id)
  } else if (action === 'copyImage') {
    // 使用原始消息的ID，因为DOM中的data-message-id使用的是message.id
    emit('copyImage', props.message.id, currentMessage.value.parentId, false, {
      model_name: currentMessage.value.model_name,
      model_provider: currentMessage.value.model_provider
    })
  } else if (action === 'copyImageFromTop') {
    // 使用原始消息的ID，因为DOM中的data-message-id使用的是message.id
    emit('copyImage', props.message.id, currentMessage.value.parentId, true, {
      model_name: currentMessage.value.model_name,
      model_provider: currentMessage.value.model_provider
    })
  } else if (action === 'fork') {
    showForkDialog()
  } else if (action === 'trace') {
    emit('trace', currentMessage.value.id)
  }
}

// Expose the handleAction method to parent components
defineExpose({
  handleAction
})
</script>
