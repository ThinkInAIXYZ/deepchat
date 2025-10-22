<template>
  <div
    :data-message-id="message.id"
    class="flex flex-row pl-4 pr-11 group gap-2 w-full justify-start assistant-message-item"
  >
    <div class="shrink-0 w-5 h-5 flex items-center justify-center">
      <ModelIcon
        :model-id="currentMessage.model_provider"
        custom-class="w-[18px] h-[18px]"
        :is-dark="themeStore.isDark"
        :alt="currentMessage.role"
      />
    </div>

    <div class="flex flex-col w-full space-y-1.5">
      <MessageInfo :name="currentMessage.model_name" :timestamp="currentMessage.timestamp" />
      <Spinner v-if="currentContent.length === 0" class="size-3 text-muted-foreground" />
      <div v-else class="flex flex-col w-full gap-1.5">
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
import { ref, computed, watch } from 'vue'
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
import { Spinner } from '@shadcn/components/ui/spinner'
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
} from '@shadcn/components/ui/dialog'
import { Button } from '@shadcn/components/ui/button'
import { useThemeStore } from '@/stores/theme'
const props = defineProps<{
  message: AssistantMessage
  isCapturingImage: boolean
}>()

const themeStore = useThemeStore()
const chatStore = useChatStore()
const settingsStore = useSettingsStore()
const { t } = useI18n()

// 定义事件
const emit = defineEmits<{
  copyImage: [
    messageId: string,
    parentId: string | undefined,
    fromTop: boolean,
    modelInfo: { model_name: string; model_provider: string }
  ]
  variantChanged: [messageId: string]
}>()

// 获取当前会话ID
const currentThreadId = computed(() => chatStore.getActiveThreadId() || '')

// 将 currentVariantIndex 从 ref 改造为 computed 属性
// 这确保了其值总是与 Pinia store 中的状态同步，从根本上消除了竞态条件。
const currentVariantIndex = computed(() => {
  const selectedVariantId = chatStore.selectedVariantsMap.get(props.message.id)

  // 如果 store 中没有记录，则显示主消息 (索引 0)
  if (!selectedVariantId) {
    return 0
  }

  // 在所有变体中查找已选择的 ID
  const variantIndex = allVariants.value.findIndex((v) => v.id === selectedVariantId)

  // 如果找到了，返回其索引 + 1 (因为索引 0 是主消息)
  // 如果没找到 (数据过时或已删除)，则安全地回退到主消息
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

// 监听 allVariants 长度变化，用于新变体生成时的自动切换和持久化
watch(
  () => allVariants.value.length,
  (newLength, oldLength) => {
    // 仅当新变体被添加时触发
    // 并且当前会话不是正在生成中的消息，避免在生成过程中频繁切换
    if (newLength > oldLength && !chatStore.generatingThreadIds.has(currentThreadId.value)) {
      const newVariantIndex = newLength // 新变体的索引

      const mainMessageId = props.message.id
      // newVariantIndex 此时至少为 1
      const selectedVariant = allVariants.value[newVariantIndex - 1]

      // 只有当 selectedVariant 存在时才调用 updateSelectedVariant，确保是有效的变体
      chatStore.updateSelectedVariant(mainMessageId, selectedVariant ? selectedVariant.id : null)
    }
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
    // 修改 prev/next 逻辑以遵循单向数据流
    let newIndex = currentVariantIndex.value // 获取当前计算出的索引

    switch (action) {
      case 'prev':
        if (newIndex > 0) newIndex--
        break
      case 'next':
        if (newIndex < totalVariants.value - 1) newIndex++
        break
    }

    // 如果计算出的新索引与当前索引相同，则不执行任何操作
    if (newIndex === currentVariantIndex.value) return

    const mainMessageId = props.message.id
    // 如果 newIndex 是 0，则 selectedVariant 为 null，表示选择主消息
    const selectedVariant = newIndex > 0 ? allVariants.value[newIndex - 1] : null
    const selectedVariantId = selectedVariant ? selectedVariant.id : null

    // 不再直接修改本地 state，而是调用 store 的 action 来更新全局状态
    // store 的更新会通过 computed 属性自动反馈到 UI
    chatStore.updateSelectedVariant(mainMessageId, selectedVariantId)

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
  }
}

// Expose the handleAction method to parent components
defineExpose({
  handleAction
})
</script>
