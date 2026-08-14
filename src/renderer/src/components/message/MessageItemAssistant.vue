<template>
  <ContextMenu>
    <component
      :is="useLegacyActions ? 'div' : ContextMenuTrigger"
      v-bind="useLegacyActions ? {} : { asChild: true }"
    >
      <div
        ref="rootRef"
        data-testid="chat-message-assistant"
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

        <div class="flex min-w-0 flex-col w-full space-y-1.5">
          <MessageInfo :name="currentMessage.model_name" :timestamp="currentMessage.timestamp" />
          <div class="flex flex-col w-full gap-1.5" data-message-content="true">
            <Spinner
              v-if="
                currentContent.length === 0 &&
                (currentMessage?.status ?? message.status) === 'pending'
              "
              class="size-3 text-muted-foreground"
            />
            <template v-for="item in currentRenderItems" :key="item.key">
              <MessageBlockActivityGroup
                v-if="item.kind === 'activity-group'"
                :blocks="item.blocks"
                :message-id="currentMessage.id"
                :thread-id="currentThreadId"
                :usage="currentMessage.usage"
                :duration-ms="item.durationMs"
                :reasoning-count="item.reasoningCount"
                :tool-call-count="item.toolCallCount"
                :read-only="isReadOnly"
                :permission-status-by-tool-call-id="permissionStatusByToolCallId"
                @toggle-collapse="handleCollapseToggle"
              />
              <MessageBlockToolCall
                v-else-if="item.kind === 'mcp-app'"
                :block="item.block"
                :message-id="currentMessage.id"
                :thread-id="currentThreadId"
                render-mode="app-only"
              />
              <MessageBlockContent
                v-else-if="item.block.type === 'content'"
                :block="item.block"
                :message-id="currentMessage.id"
                :thread-id="currentThreadId"
                :is-search-result="isSearchResult"
                :disable-markdown-virtualization="disableMarkdownVirtualization"
                :hidden-markdown-image-sources="promotedImageSources"
              />
              <MessageBlockThink
                v-else-if="
                  (item.block.type === 'reasoning_content' ||
                    item.block.type === 'artifact-thinking') &&
                  item.block.content
                "
                :block="item.block"
                :usage="currentMessage.usage"
                @toggle-collapse="handleCollapseToggle"
              />
              <MessageBlockSearch
                v-else-if="isProviderSearchBlock(item.block)"
                :block="item.block"
                :thread-id="currentThreadId"
              />
              <MessageBlockToolCall
                v-else-if="item.block.type === 'tool_call' && !isInternalToolCall(item.block)"
                :block="item.block"
                :message-id="currentMessage.id"
                :thread-id="currentThreadId"
                :read-only="isReadOnly"
                :render-mode="item.block.tool_call?.mcpResult?.app ? 'tool-only' : 'full'"
                :permission-status="
                  item.block.tool_call?.id
                    ? permissionStatusByToolCallId[item.block.tool_call.id]
                    : undefined
                "
              />
              <MessageBlockQuestionRequest
                v-else-if="
                  item.block.type === 'action' && item.block.action_type === 'question_request'
                "
                :block="item.block"
              />
              <MessageBlockAction
                v-else-if="item.block.type === 'action'"
                :message-id="currentMessage.id"
                :conversation-id="currentThreadId"
                :block="item.block"
                :is-read-only="isReadOnly"
                @continue="handleBlockContinue"
                @switch-provider="handleBlockSwitchProvider"
              />
              <MessageBlockAudio
                v-else-if="isAudioBlock(item.block)"
                :block="item.block"
                :message-id="currentMessage.id"
                :thread-id="currentThreadId"
              />
              <MessageBlockVideo
                v-else-if="isVideoBlock(item.block)"
                :block="item.block"
                :message-id="currentMessage.id"
                :thread-id="currentThreadId"
              />
              <MessageBlockImage
                v-else-if="item.block.type === 'image'"
                :block="item.block"
                :message-id="currentMessage.id"
                :thread-id="currentThreadId"
              />
              <MessageBlockError v-else-if="item.block.type === 'error'" :block="item.block" />
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
            :show-memory="memoryActivity.enabled && !isReadOnly"
            :is-read-only="isReadOnly"
            :copy-text="copyText"
            @retry="handleAction('retry')"
            @delete="handleAction('delete')"
            @copy="handleAction('copy')"
            @copy-image="handleAction('copyImage')"
            @copy-image-from-top="handleAction('copyImageFromTop')"
            @prev="handleAction('prev')"
            @next="handleAction('next')"
            @fork="handleAction('fork')"
            @trace="handleAction('trace')"
            @tape-inspector="handleAction('tapeInspector')"
            @memory="handleMemoryDetails"
          />
        </div>
      </div>
    </component>

    <ContextMenuContent v-if="!useLegacyActions" class="w-56">
      <template v-if="showSelectionMenu">
        <ContextMenuItem @select="handleSelectionCopy">
          {{ t('common.copy') }}
        </ContextMenuItem>
        <ContextMenuItem
          v-if="!isReadOnly && memoryActivity.enabled"
          @select="handleSelectionRemember"
        >
          {{ t('chat.memory.selection.remember') }}
        </ContextMenuItem>
        <ContextMenuItem @select="handleSelectionTranslate">
          {{ t('contextMenu.translate.title') }}
        </ContextMenuItem>
        <ContextMenuItem v-if="!isReadOnly" @select="handleSelectionAskAI">
          {{ t('contextMenu.askAI.title') }}
        </ContextMenuItem>
      </template>
      <template v-else>
        <ContextMenuItem @select="handleAction('copy')">
          {{ t('thread.toolbar.copy') }}
        </ContextMenuItem>
        <ContextMenuItem v-if="!isReadOnly" @select="handleAction('retry')">
          {{ t('thread.toolbar.retry') }}
        </ContextMenuItem>
        <ContextMenuItem
          v-if="!isReadOnly"
          :disabled="message.status === 'pending' || resolvedIsInGeneratingThread"
          @select="handleAction('fork')"
        >
          {{ t('thread.toolbar.fork') }}
        </ContextMenuItem>
        <ContextMenuSeparator v-if="!isReadOnly" />
        <ContextMenuItem v-if="!isReadOnly" @select="handleAction('delete')">
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
        <DcButton variant="outline" @click="cancelFork">
          {{ t('dialog.cancel') }}
        </DcButton>
        <DcButton variant="default" @click="confirmFork">
          {{ t('dialog.fork.confirm') }}
        </DcButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  type DisplayAssistantMessage,
  type DisplayAssistantMessageBlock,
  buildResolvedPermissionStatusByToolCallId,
  filterRenderableAssistantBlocks,
  getResolvedPermissionStatus,
  isInternalAssistantToolCallBlock
} from '@/features/chat-page/model/displayMessage'
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
import MessageBlockVideo from './MessageBlockVideo.vue'
import MessageBlockActivityGroup from './MessageBlockActivityGroup.vue'
import MessageBlockSearch from './MessageBlockSearch.vue'
import { buildAssistantRenderItems, isProviderSearchBlock } from './messageActivityGroups'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@shadcn/components/ui/dialog'
import { DcButton } from '@dc-ui/components/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@shadcn/components/ui/context-menu'
import { createDeviceClient } from '@api/DeviceClient'
import { useThemeStore } from '@/stores/theme'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import { useMemoryActivityStore } from '@/stores/ui/memoryActivity'
const props = defineProps<{
  message: DisplayAssistantMessage
  isCapturingImage: boolean
  useLegacyActions?: boolean
  isInGeneratingThread?: boolean
  isStreamingMessage?: boolean
  showTrace?: boolean
  isReadOnly?: boolean
  disableMarkdownVirtualization?: boolean
}>()

const themeStore = useThemeStore()
const deviceClient = createDeviceClient()
const uiSettingsStore = useUiSettingsStore()
const { t } = useI18n()
const memoryActivity = useMemoryActivityStore()

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus']
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv']

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

const isInternalToolCall = (block: DisplayAssistantMessageBlock): boolean => {
  return isInternalAssistantToolCallBlock(block)
}

const isVideoUrl = (value: string): boolean => {
  if (!value) return false

  try {
    const normalizedUrl = value.startsWith('imgcache://')
      ? new URL(value.replace('imgcache://', 'https://imgcache.local/'))
      : new URL(value)
    const pathname = normalizedUrl.pathname.toLowerCase()
    return VIDEO_EXTENSIONS.some((ext) => pathname.endsWith(ext))
  } catch {
    const lower = value.toLowerCase()
    return VIDEO_EXTENSIONS.some(
      (ext) => lower.endsWith(ext) || lower.includes(`${ext}?`) || lower.includes(`${ext}#`)
    )
  }
}

const getLegacyBlockData = (block: DisplayAssistantMessageBlock): string => {
  const content = block.content
  if (content && typeof content === 'object' && 'data' in content) {
    return String((content as { data?: unknown }).data ?? '')
  }

  return typeof content === 'string' ? content : ''
}

const isVideoBlock = (block: DisplayAssistantMessageBlock): boolean => {
  if (block.type === 'video') return true
  if (block.type !== 'image') return false
  const mimeType = block.image_data?.mimeType?.toLowerCase() || ''
  if (mimeType.startsWith('video/')) return true
  const data = block.image_data?.data || getLegacyBlockData(block)
  if (data.startsWith('data:video/')) return true
  if (data.startsWith('imgcache://') || data.startsWith('http://') || data.startsWith('https://')) {
    return isVideoUrl(data)
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
  tapeInspector: [messageId: string]
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
const isReadOnly = computed(() => props.isReadOnly === true)
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
  const blocks =
    currentVariantIndex.value === 0
      ? (props.message.content as DisplayAssistantMessageBlock[])
      : ((allVariants.value[currentVariantIndex.value - 1]?.content || props.message.content) as
          | DisplayAssistantMessageBlock[]
          | undefined)

  return filterRenderableAssistantBlocks(blocks ?? [])
})

const copyText = computed(() =>
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

const promotedImageSources = computed(() =>
  Array.from(
    new Set(
      currentContent.value
        .filter(
          (block) =>
            block.type === 'image' &&
            block.image_data?.mimeType?.toLowerCase().startsWith('image/') &&
            block.image_data.data.startsWith('imgcache://')
        )
        .map((block) => block.image_data!.data)
    )
  )
)

const shouldGroupActivity = computed(() => {
  // Row-level: only the actively streaming row stays ungrouped so its activity
  // renders live; thread-level generating must not ungroup settled history.
  if (props.isStreamingMessage) return false
  return currentMessage.value.status !== 'pending'
})

const permissionStatusByToolCallId = computed(() =>
  buildResolvedPermissionStatusByToolCallId(currentContent.value)
)

// Resolved permission outcomes merge into their tool card; the standalone
// action card only remains as a fallback when the tool card is missing.
const currentVisibleContent = computed(() =>
  currentContent.value.filter((block) => {
    const status = getResolvedPermissionStatus(block)
    const toolCallId = block.tool_call?.id
    return !(status && toolCallId && permissionStatusByToolCallId.value[toolCallId])
  })
)

const currentRenderItems = computed(() =>
  buildAssistantRenderItems({
    blocks: currentVisibleContent.value,
    messageId: currentMessage.value.id,
    messageUpdatedAt: currentMessage.value.updatedAt,
    shouldGroup: shouldGroupActivity.value,
    isInternalToolCall
  })
)

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
  | 'tapeInspector'

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
  deviceClient.copyText(text)
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
  if (isReadOnly.value) {
    return
  }

  const text = resolveSelectionText()
  if (!text) {
    return
  }
  window.dispatchEvent(new CustomEvent('context-menu-ask-ai', { detail: text }))
}

const handleSelectionRemember = async () => {
  if (isReadOnly.value || !memoryActivity.enabled) {
    return
  }
  const text = resolveSelectionText()
  if (!text) {
    return
  }
  const result = await memoryActivity.rememberSelection(text)
  notifyRenderer({
    kind: result ? 'success' : 'error',
    code: result ? 'chat.memory.remembered' : 'chat.memory.rememberFailed',
    title: result
      ? t(`chat.memory.toast.add.${result.action}`)
      : t('chat.memory.toast.rememberFailed')
  })
}

const handleMemoryDetails = () => {
  if (isReadOnly.value || !memoryActivity.enabled) {
    return
  }
  void memoryActivity.openTurnMemories(props.message.id)
}

const handleBlockContinue = (conversationId: string, messageId: string) => {
  if (isReadOnly.value) {
    return
  }
  emit('continue', conversationId, messageId)
}

const handleBlockSwitchProvider = () => {
  if (isReadOnly.value) {
    return
  }
  emit('switchProvider')
}

const handleAction = (action: HandleActionType) => {
  if (isReadOnly.value && (action === 'retry' || action === 'delete' || action === 'fork')) {
    return
  }

  if (action === 'retry') {
    emit('retry', currentMessage.value.id)
  } else if (action === 'delete') {
    emit('delete', currentMessage.value.id)
  } else if (action === 'copy') {
    deviceClient.copyText(copyText.value)
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
  } else if (action === 'tapeInspector') {
    emit('tapeInspector', currentMessage.value.id)
  }
}

// Expose the handleAction method to parent components
defineExpose({
  handleAction
})
</script>
