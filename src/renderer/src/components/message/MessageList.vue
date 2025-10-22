<template>
  <div class="w-full h-full relative min-h-0">
    <div
      ref="messagesContainer"
      class="message-list-container relative flex-1 scrollbar-hide overflow-y-auto w-full h-full pr-12 lg:pr-12"
      @scroll="handleScroll"
    >
      <div
        ref="messageList"
        class="w-full break-all transition-opacity duration-300 pt-4"
        :class="{ 'opacity-0': !visible }"
      >
        <div
          v-for="(msg, index) in messages"
          :key="msg.id"
          @mouseenter="minimap.handleHover(msg.id)"
          @mouseleave="minimap.handleHover(null)"
        >
          <MessageItemAssistant
            v-if="msg.role === 'assistant'"
            :ref="retry.setAssistantRef(index)"
            :message="msg as AssistantMessage"
            :is-capturing-image="capture.isCapturing.value"
            @copy-image="handleCopyImage"
            @variant-changed="scrollToMessage"
          />
          <MessageItemUser
            v-else-if="msg.role === 'user'"
            :message="msg as UserMessage"
            @retry="handleRetry(index)"
            @scroll-to-bottom="scrollToBottom"
          />
        </div>
      </div>
      <div ref="scrollAnchor" class="h-8" />
    </div>
    <template v-if="!capture.isCapturing.value">
      <MessageActionButtons
        :show-clean-button="!showCancelButton"
        :show-scroll-button="aboveThreshold"
        @clean="cleanDialog.open"
        @scroll-to-bottom="scrollToBottom(true)"
      />
    </template>
    <ReferencePreview
      class="pointer-events-none"
      :show="referenceStore.showPreview"
      :content="referenceStore.currentReference"
      :rect="referenceStore.previewRect"
    />
    <MessageMinimap
      v-if="messages.length > 0"
      :messages="messages"
      :hovered-message-id="minimap.hoveredMessageId.value"
      :scroll-info="minimap.scrollInfo"
      @bar-hover="minimap.handleHover"
      @bar-click="minimap.handleClick"
    />
  </div>
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
// === Vue Core ===
import { ref, onMounted, nextTick, watch, computed, toRef } from 'vue'

// === Types ===
import { AssistantMessage, UserMessage } from '@shared/chat'

// === Components ===
import MessageItemAssistant from './MessageItemAssistant.vue'
import MessageItemUser from './MessageItemUser.vue'
import MessageActionButtons from './MessageActionButtons.vue'
import ReferencePreview from './ReferencePreview.vue'
import MessageMinimap from './MessageMinimap.vue'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@shadcn/components/ui/dialog'
import { Button } from '@shadcn/components/ui/button'

// === Composables ===
import { useResizeObserver } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { useMessageScroll } from '@/composables/message/useMessageScroll'
import { useCleanDialog } from '@/composables/message/useCleanDialog'
import { useMessageMinimap } from '@/composables/message/useMessageMinimap'
import { useMessageCapture } from '@/composables/message/useMessageCapture'
import { useMessageRetry } from '@/composables/message/useMessageRetry'

// === Stores ===
import { useChatStore } from '@/stores/chat'
import { useReferenceStore } from '@/stores/reference'

// === Props & Emits ===
const { t } = useI18n()
const props = defineProps<{
  messages: Array<UserMessage | AssistantMessage>
}>()

// === Stores ===
const chatStore = useChatStore()
const referenceStore = useReferenceStore()

// === Composable Integrations ===
// Scroll management
const scroll = useMessageScroll()
const {
  messagesContainer,
  scrollAnchor,
  aboveThreshold,
  scrollToBottom: scrollToBottomImmediate,
  scrollToMessage,
  handleScroll,
  updateScrollInfo,
  setupScrollObserver
} = scroll

// Clean dialog
const cleanDialog = useCleanDialog()

// Minimap (needs scrollInfo from scroll composable)
const minimap = useMessageMinimap(scroll.scrollInfo)

// Screenshot capture
const capture = useMessageCapture()

// Message retry
const retry = useMessageRetry(toRef(props, 'messages'))

// === Local State ===
const messageList = ref<HTMLDivElement>()
const visible = ref(false)
const shouldAutoFollow = ref(true)

const scheduleScrollToBottom = (force = false) => {
  nextTick(() => {
    const container = messagesContainer.value
    if (!container) {
      scrollToBottomImmediate()
      shouldAutoFollow.value = true
      return
    }

    const shouldScroll = force || shouldAutoFollow.value

    if (!shouldScroll) {
      updateScrollInfo()
      return
    }

    scrollToBottomImmediate()
    if (force) {
      shouldAutoFollow.value = true
    }
  })
}

const scrollToBottom = (force = false) => {
  if (force) {
    shouldAutoFollow.value = true
  }
  scheduleScrollToBottom(force)
}

// === Event Handlers ===
const handleCopyImage = async (
  messageId: string,
  parentId?: string,
  fromTop: boolean = false,
  modelInfo?: { model_name: string; model_provider: string }
) => {
  await capture.captureMessage({ messageId, parentId, fromTop, modelInfo })
}

const handleRetry = async (index: number) => {
  const triggered = await retry.retryFromUserMessage(index)
  if (triggered) {
    scrollToBottom(true)
  }
}

// === Computed ===
const showCancelButton = computed(() => {
  return chatStore.generatingThreadIds.has(chatStore.getActiveThreadId() ?? '')
})

// === Lifecycle Hooks ===
onMounted(() => {
  // Initialize scroll and visibility
  scheduleScrollToBottom(true)
  nextTick(() => {
    visible.value = true
    setupScrollObserver()
    updateScrollInfo()
  })

  useResizeObserver(messageList, () => {
    scheduleScrollToBottom()
  })

  watch(
    () => aboveThreshold.value,
    (isAbove) => {
      shouldAutoFollow.value = !isAbove
    }
  )

  // Update scroll info when message count changes
  watch(
    () => props.messages.length,
    (length, prevLength) => {
      const isGrowing = length > prevLength
      const isReset = prevLength > 0 && length < prevLength

      if (!isGrowing && !isReset) {
        return
      }

      scheduleScrollToBottom(isReset)
    },
    { flush: 'post' }
  )
})

// === Expose ===
defineExpose({
  scrollToBottom,
  scrollToMessage,
  aboveThreshold
})
</script>

<style scoped>
.message-highlight {
  background-color: rgba(59, 130, 246, 0.1);
  border-left: 3px solid rgb(59, 130, 246);
  transition: all 0.3s ease;
}

.dark .message-highlight {
  background-color: rgba(59, 130, 246, 0.15);
}
</style>
