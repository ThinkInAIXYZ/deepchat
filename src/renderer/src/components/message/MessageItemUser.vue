<template>
  <div
    v-show="!message.content.continue"
    :data-message-id="message.id"
    class="flex flex-row-reverse group pt-5 pl-11 gap-2 user-message-item"
  >
    <!-- 头像 -->
    <div class="w-5 h-5 bg-muted rounded-md overflow-hidden">
      <img v-if="message.avatar" :src="message.avatar" class="w-full h-full" :alt="message.role" />
      <div v-else class="w-full h-full flex items-center justify-center text-muted-foreground">
        <Icon icon="lucide:user" class="w-4 h-4" />
      </div>
    </div>
    <div class="flex flex-col w-full space-y-1.5 items-end">
      <MessageInfo
        class="flex-row-reverse"
        :name="message.name ?? 'user'"
        :timestamp="message.timestamp"
      />
      <!-- 消息内容 -->
      <div
        class="text-sm bg-muted dark:bg-muted rounded-lg p-2 border flex flex-col gap-1.5"
        data-message-content="true"
      >
        <div v-show="message.content.files.length > 0" class="flex flex-wrap gap-1.5">
          <ChatAttachmentItem
            v-for="(file, index) in message.content.files"
            :key="file.path || `${file.name}-${index}`"
            :file="file"
            @click="previewFile(file.path)"
          />
        </div>
        <div v-if="isEditMode" class="text-sm w-full min-w-[40vw] whitespace-pre-wrap break-all">
          <textarea
            ref="editTextarea"
            v-model="editedText"
            class="text-sm bg-muted dark:bg-muted rounded-lg p-2 border flex flex-col gap-1.5 resize-none overflow-y-auto overscroll-contain min-w-[40vw] w-full max-h-[60vh]"
            rows="1"
            @input="autoResize"
            @keydown.meta.enter.prevent="saveEdit"
            @keydown.ctrl.enter.prevent="saveEdit"
            @keydown.esc="cancelEdit"
          ></textarea>
        </div>
        <div v-else class="flex w-full min-w-0 flex-col items-end gap-1.5">
          <div
            data-user-message-content-body="true"
            :data-user-message-collapsible="String(isCollapsible)"
            :data-user-message-expanded="String(isExpanded)"
            class="relative w-full min-w-0"
          >
            <div
              class="w-full min-w-0"
              :class="{ 'user-message-content--clamped': shouldClampContent }"
            >
              <MessageContent
                v-if="message.content.content && message.content.content.length > 0"
                :content="message.content.content"
                @mention-click="handleMentionClick"
              />
              <MessageTextContent v-else :content="message.content.text || ''" />
            </div>
            <div
              v-if="showFadeMask"
              data-user-message-fade="true"
              class="pointer-events-none absolute inset-x-0 bottom-0 h-12 rounded-b-md bg-gradient-to-t from-muted via-muted/95 to-transparent"
            />
          </div>
          <button
            v-if="isCollapsible"
            type="button"
            data-user-message-toggle="true"
            class="text-xs leading-5 text-muted-foreground transition-colors hover:text-foreground"
            @click="toggleExpanded"
          >
            {{ isExpanded ? t('common.collapse') : t('common.expand') }}
          </button>
        </div>
      </div>
      <MessageToolbar
        class="flex-row-reverse"
        :usage="message.usage"
        :loading="false"
        :is-assistant="false"
        :is-edit-mode="isEditMode"
        :is-capturing-image="false"
        :is-read-only="isReadOnly"
        @retry="onRetryAction"
        @delete="handleAction('delete')"
        @copy="handleAction('copy')"
        @edit="startEdit"
        @save="saveEdit"
        @cancel="cancelEdit"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type {
  DisplayUserMessageCodeBlock,
  DisplayUserMessage,
  DisplayUserMessageTextBlock,
  DisplayUserMessageMentionBlock
} from '@/components/chat/messageListItems'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import MessageInfo from './MessageInfo.vue'
import ChatAttachmentItem from '../chat/ChatAttachmentItem.vue'
import MessageToolbar from './MessageToolbar.vue'
import MessageContent from './MessageContent.vue'
import MessageTextContent from './MessageTextContent.vue'
import { usePresenter } from '@/composables/usePresenter'
import { computed, ref, watch, nextTick } from 'vue'

const COLLAPSE_CHAR_THRESHOLD = 600
const COLLAPSE_EXPLICIT_LINE_THRESHOLD = 8

type DisplayUserMessageRichBlock =
  | DisplayUserMessageTextBlock
  | DisplayUserMessageMentionBlock
  | DisplayUserMessageCodeBlock

const getVisibleMentionLabel = (block: DisplayUserMessageMentionBlock) => {
  if (block.category === 'prompts') {
    return block.id || block.content
  }
  if (block.category === 'context') {
    return block.id || block.category
  }
  return block.content
}

const getVisibleBlockText = (block: DisplayUserMessageRichBlock) => {
  if (block.type === 'mention') {
    return getVisibleMentionLabel(block)
  }
  return block.content
}

const getVisibleMessageText = (message: DisplayUserMessage) => {
  const blocks = message.content.content
  if (blocks && blocks.length > 0) {
    return blocks.map((block) => getVisibleBlockText(block)).join('')
  }
  return message.content.text || ''
}

const windowPresenter = usePresenter('windowPresenter')
const { t } = useI18n()

const props = defineProps<{
  message: DisplayUserMessage
  isReadOnly?: boolean
}>()

const isEditMode = ref(false)
const editedText = ref('')
const editTextarea = ref<HTMLTextAreaElement | null>(null)
const isExpanded = ref(true)
const hasManualCollapsePreference = ref(false)
const visibleMessageText = computed(() => getVisibleMessageText(props.message))
const explicitLineCount = computed(() =>
  visibleMessageText.value ? visibleMessageText.value.split(/\r\n|\r|\n/).length : 0
)
const isCollapsible = computed(
  () =>
    visibleMessageText.value.length >= COLLAPSE_CHAR_THRESHOLD ||
    explicitLineCount.value >= COLLAPSE_EXPLICIT_LINE_THRESHOLD
)
const shouldClampContent = computed(() => isCollapsible.value && !isExpanded.value)
const showFadeMask = computed(() => shouldClampContent.value)

const emit = defineEmits<{
  fileClick: [fileName: string]
  retry: [messageId: string]
  delete: [messageId: string]
  editSave: [payload: { messageId: string; text: string }]
}>()

const previewFile = (filePath: string) => {
  windowPresenter.previewFile(filePath)
}

const toggleExpanded = () => {
  if (!isCollapsible.value) {
    return
  }

  isExpanded.value = !isExpanded.value
  hasManualCollapsePreference.value = true
}

const startEdit = () => {
  if (props.isReadOnly) {
    return
  }

  isEditMode.value = true
  if (props.message.content?.content && props.message.content.content.length > 0) {
    const textBlocks = props.message.content.content.filter((block) => block.type === 'text')
    editedText.value = textBlocks.map((block) => block.content).join('')
  } else {
    editedText.value = props.message.content.text || ''
  }
  nextTick(() => autoResize())
}

const saveEdit = async () => {
  if (props.isReadOnly) {
    return
  }

  const nextText = editedText.value.trim()
  if (!nextText) return

  try {
    emit('editSave', {
      messageId: props.message.id,
      text: nextText
    })

    // Exit edit mode
    isEditMode.value = false
  } catch (error) {
    console.error('Failed to save edit:', error)
  }
}

const onRetryAction = () => {
  if (props.isReadOnly) {
    return
  }
  emit('retry', props.message.id)
}

const getCopyText = () => {
  if (props.message.content?.content && props.message.content.content.length > 0) {
    return props.message.content.content
      .map((block) => {
        if (typeof block.content === 'string') {
          return block.content
        }
        return ''
      })
      .join('')
      .trim()
  }
  return props.message.content.text || ''
}

const cancelEdit = () => {
  isEditMode.value = false
}

const handleAction = (action: 'delete' | 'copy') => {
  if (action === 'delete') {
    if (props.isReadOnly) {
      return
    }
    emit('delete', props.message.id)
  } else if (action === 'copy') {
    window.api.copyText(getCopyText())
  }
}

const handleMentionClick = async (_block: DisplayUserMessageMentionBlock) => {
  return
}

const autoResize = () => {
  const el = editTextarea.value
  if (!el) return
  el.style.height = 'auto'
  const maxH = Math.max(120, Math.floor(window.innerHeight * 0.6))
  const scrollH = el.scrollHeight
  const target = Math.min(scrollH, maxH)
  el.style.height = target + 'px'
  if (scrollH > target) {
    el.style.overflowY = 'auto'
  } else {
    el.style.overflowY = 'hidden'
  }
}

watch(editedText, () => {
  if (isEditMode.value) nextTick(() => autoResize())
})

watch(
  () => [props.message.id, visibleMessageText.value, isCollapsible.value] as const,
  ([messageId, visibleText, collapsible], previousValue) => {
    if (!collapsible) {
      isExpanded.value = true
      hasManualCollapsePreference.value = false
      return
    }

    if (
      previousValue?.[0] !== messageId ||
      previousValue?.[1] !== visibleText ||
      !hasManualCollapsePreference.value
    ) {
      isExpanded.value = false
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.user-message-content--clamped {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 12;
}
</style>
