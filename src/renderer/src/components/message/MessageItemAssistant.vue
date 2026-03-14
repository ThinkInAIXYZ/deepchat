<template>
  <ContextMenu>
    <component
      :is="useLegacyActions ? 'div' : ContextMenuTrigger"
      v-bind="useLegacyActions ? {} : { asChild: true }"
    >
      <div
        ref="rootRef"
        :data-message-id="message.id"
        class="flex flex-row pl-4 pt-5 pr-11 group gap-2 w-full justify-start assistant-message-item"
        @contextmenu.capture="handleContextMenuOpen"
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
                :thread-id="currentThreadId"
                :is-search-result="isSearchResult"
              />
              <MessageBlockThink
                v-else-if="block.type === 'reasoning_content' && block.content"
                :block="block"
                :usage="message.usage"
                @toggle-collapse="handleCollapseToggle"
              />
              <MessageBlockPlan v-else-if="block.type === 'plan'" :block="block" />
              <MessageBlockToolCall
                v-else-if="block.type === 'tool_call'"
                :block="block"
                :message-id="currentMessage.id"
                :thread-id="currentThreadId"
              />
              <MessageBlockQuestionRequest
                v-else-if="block.type === 'action' && block.action_type === 'question_request'"
                :block="block"
              />
              <MessageBlockAction
                v-else-if="block.type === 'action'"
                :message-id="currentMessage.id"
                :conversation-id="currentThreadId"
                :block="block"
                @continue="handleBlockContinue"
                @switch-provider="handleBlockSwitchProvider"
              />
              <MessageBlockMcpUi
                v-else-if="block.type === 'mcp_ui_resource'"
                :block="block"
                :message-id="currentMessage.id"
                :thread-id="currentThreadId"
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
            :is-in-generating-thread="resolvedIsInGeneratingThread"
            :is-capturing-image="isCapturingImage"
            :show-trace="showTrace"
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
    </component>

    <ContextMenuContent v-if="!useLegacyActions" class="w-56">
      <template v-if="showSelectionMenu">
        <ContextMenuItem @select="handleSelectionCopy">
          {{ t('common.copy') }}
        </ContextMenuItem>
        <ContextMenuItem @select="handleSelectionTranslate">
          {{ t('contextMenu.translate.title') }}
        </ContextMenuItem>
        <ContextMenuItem @select="handleSelectionAskAI">
          {{ t('contextMenu.askAI.title') }}
        </ContextMenuItem>
      </template>
      <template v-else>
        <ContextMenuItem @select="handleAction('copy')">
          {{ t('thread.toolbar.copy') }}
        </ContextMenuItem>
        <ContextMenuItem @select="handleAction('retry')">
          {{ t('thread.toolbar.retry') }}
        </ContextMenuItem>
        <ContextMenuItem
          :disabled="message.status === 'pending' || resolvedIsInGeneratingThread"
          @select="handleAction('fork')"
        >
          {{ t('thread.toolbar.fork') }}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem @select="handleAction('delete')">
          {{ t('thread.toolbar.delete') }}
        </ContextMenuItem>
      </template>
    </ContextMenuContent>
  </ContextMenu>

  <!-- 分支会话确认对话框 -->
  <Dialog v-if="useLegacyActions" v-model:open="isForkDialogOpen">
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
import type {
  DisplayAssistantMessage,
  DisplayAssistantMessageBlock
} from '@/components/chat/messageListItems'
import MessageBlockContent from './MessageBlockContent.vue'
import MessageBlockThink from './MessageBlockThink.vue'
import MessageBlockToolCall from './MessageBlockToolCall.vue'
import MessageBlockError from './MessageBlockError.vue'
import MessageBlockQuestionRequest from './MessageBlockQuestionRequest.vue'
import MessageToolbar from './MessageToolbar.vue'
import MessageInfo from './MessageInfo.vue'
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@shadcn/components/ui/context-menu'
import { useThemeStore } from '@/stores/theme'
const props = defineProps<{
  message: DisplayAssistantMessage
  isCapturingImage: boolean
  useLegacyActions?: boolean
  isInGeneratingThread?: boolean
  showTrace?: boolean
}>()

const themeStore = useThemeStore()
const uiSettingsStore = useUiSettingsStore()
const { t } = useI18n()

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.webm']

const isAudioBlock = (block: DisplayAssistantMessageBlock): boolean => {
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
  retry: [messageId: string]
  delete: [messageId: string]
  fork: [messageId: string]
  continue: [conversationId: string, messageId: string]
  switchProvider: []
}>()

// 获取当前会话ID
const currentThreadId = computed(() => props.message.conversationId || '')
const useLegacyActions = computed(() => props.useLegacyActions !== false)
const resolvedIsInGeneratingThread = computed(() => props.isInGeneratingThread ?? false)
const showTrace = computed(() => props.showTrace ?? false)
const rootRef = ref<HTMLElement | null>(null)
const showSelectionMenu = ref(false)
const lastSelectionText = ref('')
const contextMenuPosition = ref<{ x?: number; y?: number }>({})

// currentVariantIndex: 0 = 主消息, 1-N = 对应的变体索引
const selectedVariantId = ref<string | null>(null)

const currentVariantIndex = computed(() => {
  if (!useLegacyActions.value) return 0
  if (!selectedVariantId.value) return 0

  const variantIndex = allVariants.value.findIndex((v) => v.id === selectedVariantId.value)
  return variantIndex !== -1 ? variantIndex + 1 : 0
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
  const variantsById = new Map<string, DisplayAssistantMessage>()

  // 只添加真正的变体（is_variant !== 0），过滤掉主消息本身
  messageVariants.forEach((variant) => {
    if (variant.role === 'assistant' && variant.is_variant !== 0) {
      variantsById.set(variant.id, variant)
    }
  })

  return Array.from(variantsById.values())
})

// 计算变体总数
const totalVariants = computed(() => allVariants.value.length + 1)

// 获取当前显示的内容
const currentContent = computed(() => {
  if (currentVariantIndex.value === 0) {
    return props.message.content as DisplayAssistantMessageBlock[]
  }

  const variant = allVariants.value[currentVariantIndex.value - 1]
  return (variant?.content || props.message.content) as DisplayAssistantMessageBlock[]
})

// 监听 allVariants 长度变化，用于新变体生成时的自动切换和持久化
watch(
  () => allVariants.value.length,
  (newLength, oldLength) => {
    if (!useLegacyActions.value) {
      return
    }

    // 仅当新变体被添加时触发
    // 并且当前会话不是正在生成中的消息，避免在生成过程中频繁切换
    if (newLength > oldLength && !resolvedIsInGeneratingThread.value) {
      // 获取最后一个变体（数组最后一个元素）
      const lastVariant = allVariants.value[newLength - 1]

      // 只有当 lastVariant 存在时才调用 updateSelectedVariant，确保是有效的变体
      selectedVariantId.value = lastVariant?.id ?? null
      emit('variantChanged', props.message.id)
    }
  }
)

watch(
  [() => props.message.id, allVariants],
  () => {
    if (!selectedVariantId.value) return
    const exists = allVariants.value.some((variant) => variant.id === selectedVariantId.value)
    if (!exists) {
      selectedVariantId.value = null
    }
  },
  { immediate: true }
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
const confirmFork = () => {
  emit('fork', currentMessage.value.id)
  isForkDialogOpen.value = false
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

const getSelectionInCurrentMessage = () => {
  const selection = window.getSelection()
  const root = rootRef.value
  if (!selection || !root || selection.rangeCount === 0 || selection.isCollapsed) {
    return ''
  }

  const text = selection.toString().trim()
  if (!text) {
    return ''
  }

  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return ''
  }

  return text
}

const resolveSelectionText = () => getSelectionInCurrentMessage() || lastSelectionText.value

const handleContextMenuOpen = (event: MouseEvent) => {
  if (useLegacyActions.value) {
    return
  }

  contextMenuPosition.value = {
    x: event.clientX,
    y: event.clientY
  }
  const text = getSelectionInCurrentMessage()
  showSelectionMenu.value = !!text
  lastSelectionText.value = text
}

const handleSelectionCopy = () => {
  const text = resolveSelectionText()
  if (!text) {
    return
  }
  window.api.copyText(text)
}

const handleSelectionTranslate = () => {
  const text = resolveSelectionText()
  if (!text) {
    return
  }

  window.dispatchEvent(
    new CustomEvent('context-menu-translate-text', {
      detail: {
        text,
        x: contextMenuPosition.value.x,
        y: contextMenuPosition.value.y
      }
    })
  )
}

const handleSelectionAskAI = () => {
  const text = resolveSelectionText()
  if (!text) {
    return
  }
  window.dispatchEvent(new CustomEvent('context-menu-ask-ai', { detail: text }))
}

const handleBlockContinue = (conversationId: string, messageId: string) => {
  emit('continue', conversationId, messageId)
}

const handleBlockSwitchProvider = () => {
  emit('switchProvider')
}

const handleAction = (action: HandleActionType) => {
  if (action === 'retry') {
    emit('retry', currentMessage.value.id)
  } else if (action === 'delete') {
    emit('delete', currentMessage.value.id)
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
    if (!useLegacyActions.value) {
      return
    }

    let newIndex = currentVariantIndex.value

    if (action === 'prev' && newIndex > 0) {
      newIndex--
    } else if (action === 'next' && newIndex < totalVariants.value - 1) {
      newIndex++
    }

    if (newIndex === currentVariantIndex.value) return

    selectedVariantId.value = newIndex > 0 ? (allVariants.value[newIndex - 1]?.id ?? null) : null
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
    if (useLegacyActions.value) {
      showForkDialog()
    } else {
      emit('fork', currentMessage.value.id)
    }
  } else if (action === 'trace') {
    emit('trace', currentMessage.value.id)
  }
}

// Expose the handleAction method to parent components
defineExpose({
  handleAction
})
</script>
