<template>
  <div
    data-testid="chat-message-user"
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
        :receipt="receipt"
        :receipt-label="receiptLabel"
      />
      <div
        v-if="standaloneActiveSkills.length"
        class="flex max-w-full flex-wrap justify-end gap-1.5 pr-1"
        data-chat-search-exclude="true"
        data-testid="user-message-active-skills"
      >
        <span
          v-for="skillName in standaloneActiveSkills"
          :key="skillName"
          class="inline-flex h-5 items-center gap-1 rounded-full border border-border/60 bg-background/70 px-2 text-[11px] leading-none text-muted-foreground shadow-sm dark:bg-background/40"
          data-testid="user-message-active-skill"
        >
          <Icon icon="lucide:sparkles" class="h-3 w-3 text-primary/70" />
          {{ skillName }}
        </span>
      </div>
      <!-- 消息内容 -->
      <div
        class="max-w-full text-sm bg-muted dark:bg-muted rounded-lg p-3 border flex flex-col gap-2"
        data-message-content="true"
      >
        <AttachmentShelf
          :files="standaloneFiles"
          class="border-0 p-0"
          data-chat-search-exclude="true"
          @file-click="previewFile"
        />
        <div v-if="isEditMode" class="w-full min-w-[40vw] text-sm">
          <ReferenceEditor
            ref="referenceEditor"
            :text="editText"
            :inline-items="message.content.content?.length ? [] : message.content.inlineItems"
            :ariaLabel="t('thread.toolbar.edit')"
            :editable="!isSavingEdit && !effectiveReadOnly"
            @save="submitEdit"
            @cancel="cancelEdit"
          />
        </div>
        <div v-else class="flex w-full min-w-0 flex-col items-end gap-1.5">
          <div
            data-user-message-content-body="true"
            :data-user-message-collapsible="String(isCollapsible)"
            :data-user-message-expanded="String(isExpanded)"
            class="relative w-full min-w-0"
          >
            <div
              ref="contentMeasureRef"
              class="w-full min-w-0"
              :class="{ 'user-message-content--clamped': shouldClampContent }"
              @focusin="shouldClampContent && toggleExpanded()"
            >
              <MessageContent
                v-if="visibleContentBlocks.length > 0"
                :content="visibleContentBlocks"
                @mention-click="handleMentionClick"
                @file-click="previewFile"
                @session-click="openSessionReference"
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
        :loading="isSavingEdit"
        :is-assistant="false"
        :is-edit-mode="isEditMode"
        :is-capturing-image="false"
        :is-read-only="effectiveReadOnly"
        :copy-text="copyText"
        @retry="onRetryAction"
        @delete="handleAction('delete')"
        @copy="handleAction('copy')"
        @edit="startEdit"
        @save="submitEdit"
        @cancel="cancelEdit"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type {
  DisplayUserMessage,
  DisplayUserMessageInlineBlock,
  DisplayUserMessageMentionBlock,
  UserMessageEdit
} from '@/features/chat-page/model/displayMessage'
import {
  collectVisibleUserMessageText,
  getVisibleUserContentBlocks
} from '@/features/chat-page/model/displayUserMessageText'
import { Icon } from '@iconify/vue'
import { useI18n } from 'vue-i18n'
import MessageInfo from './MessageInfo.vue'
import AttachmentShelf from '../chat/AttachmentShelf.vue'
import MessageToolbar from './MessageToolbar.vue'
import MessageContent from './MessageContent.vue'
import MessageTextContent from './MessageTextContent.vue'
import ReferenceEditor from '../chat/ReferenceEditor.vue'
import { createDeviceClient } from '@api/DeviceClient'
import { createWindowClient } from '@api/WindowClient'
import { getSessionReferenceText } from '@shared/sessionReferences'
import { useSessionStore } from '@/stores/ui/session'
import { notifyRenderer } from '@renderer-notifications/rendererNotificationPort'
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue'
import type { UserMessageInlineItem } from '@shared/types/agent-interface'

const COLLAPSE_HEIGHT_PX = 192
const READ_RECEIPT_VISIBLE_MS = 1500

type ReferenceEditorApi = {
  getValue: () => { text: string; inlineItems: UserMessageInlineItem[] }
  focus: () => void
}

const deviceClient = createDeviceClient()
const windowClient = createWindowClient()
const sessionStore = useSessionStore()
const { t } = useI18n()

const props = defineProps<{
  message: DisplayUserMessage
  isReadOnly?: boolean
  saveEdit?: (payload: UserMessageEdit) => Promise<boolean>
}>()

const isEditMode = ref(false)
const isSavingEdit = ref(false)
const referenceEditor = ref<ReferenceEditorApi | null>(null)
const contentMeasureRef = ref<HTMLElement | null>(null)
const renderedContentHeight = ref(0)
const isExpanded = ref(true)
const hasManualCollapsePreference = ref(false)
const receipt = ref<'unread' | 'read' | null>(null)
let receiptTimer: ReturnType<typeof setTimeout> | null = null

const effectiveReadOnly = computed(() => props.isReadOnly || props.message.status === 'pending')
const receiptLabel = computed(() =>
  props.message.inputReceipt?.delivery
    ? t(`chat.acpExtensions.steer_${props.message.inputReceipt.delivery}`)
    : receipt.value
      ? t(`chat.messageReceipt.${receipt.value}`)
      : undefined
)

const messageFileByKey = computed(() => {
  const files = new Map<string, (typeof props.message.content.files)[number]>()
  for (const file of props.message.content.files) {
    if (file.path) files.set(file.path, file)
    if (file.name) files.set(file.name, file)
  }
  return files
})

const visibleContentBlocks = computed<DisplayUserMessageInlineBlock[]>(() =>
  getVisibleUserContentBlocks(props.message.content).map((block) => {
    if (block.type !== 'file') return block
    const file =
      messageFileByKey.value.get(block.filePath) ?? messageFileByKey.value.get(block.fileName)
    return file ? { ...block, file } : block
  })
)
const visibleMessageText = computed(() => collectVisibleUserMessageText(props.message.content))
const editText = computed(() =>
  props.message.content.content?.length
    ? props.message.content.content
        .filter((block) => block.type === 'text')
        .map((block) => block.content)
        .join('')
    : props.message.content.text || ''
)

const inlineSkillNames = computed(
  () =>
    new Set(
      visibleContentBlocks.value
        .filter((block) => block.type === 'skill')
        .map((block) => block.skillName)
        .filter(Boolean)
    )
)

const inlineFileKeys = computed(
  () =>
    new Set(
      visibleContentBlocks.value
        .filter((block) => block.type === 'file')
        .map((block) => block.filePath || block.fileName)
        .filter(Boolean)
    )
)

const standaloneActiveSkills = computed(() =>
  (props.message.content.activeSkills ?? []).filter(
    (skillName) => isEditMode.value || !inlineSkillNames.value.has(skillName)
  )
)

const standaloneFiles = computed(() =>
  props.message.content.files.filter(
    (file) => isEditMode.value || !inlineFileKeys.value.has(file.path || file.name)
  )
)

const isCollapsible = computed(() => renderedContentHeight.value > COLLAPSE_HEIGHT_PX)
const shouldClampContent = computed(() => isCollapsible.value && !isExpanded.value)
const showFadeMask = computed(() => shouldClampContent.value)

const emit = defineEmits<{
  fileClick: [fileName: string]
  retry: [messageId: string]
  delete: [messageId: string]
}>()

const previewFile = (filePath: string) => {
  void windowClient.previewFile(filePath)
}

const openSessionReference = async (sessionId: string, tapeIncarnationId: string) => {
  try {
    await sessionStore.selectSession(sessionId, tapeIncarnationId)
  } catch {
    notifyRenderer({
      kind: 'error',
      code: 'chat.sessionReference.unavailable',
      title: t('chat.sessionReference.unavailableTitle'),
      description: t('chat.sessionReference.unavailableDescription')
    })
  }
}

const toggleExpanded = () => {
  if (!isCollapsible.value) {
    return
  }

  // MessageListRow measures the new height; the chat scroll controller owns anchoring.
  isExpanded.value = !isExpanded.value
  hasManualCollapsePreference.value = true
}

const startEdit = () => {
  if (effectiveReadOnly.value) {
    return
  }

  isEditMode.value = true
  void nextTick(() => referenceEditor.value?.focus())
}

const submitEdit = async () => {
  if (effectiveReadOnly.value || isSavingEdit.value || !props.saveEdit) {
    return
  }

  const value = referenceEditor.value?.getValue()
  if (
    !value ||
    (!value.text.trim() &&
      !value.inlineItems.some((item) => item.type === 'session') &&
      !props.message.content.files.length)
  )
    return

  try {
    isSavingEdit.value = true
    const saved = await props.saveEdit({
      messageId: props.message.id,
      text: value.text,
      ...(props.message.content.content?.length ? {} : { inlineItems: value.inlineItems })
    })

    if (saved) isEditMode.value = false
  } catch (error) {
    console.error('Failed to save edit:', error)
  } finally {
    isSavingEdit.value = false
  }
}

const onRetryAction = () => {
  if (effectiveReadOnly.value) {
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
  const blocks = visibleContentBlocks.value
  if (!blocks.length) return props.message.content.text || ''
  return blocks
    .map((block) => {
      if (block.type === 'text' || block.type === 'code' || block.type === 'mention')
        return block.content
      if (block.type === 'file-reference') return `@${block.relativePath}`
      if (block.type === 'session') return getSessionReferenceText([{ ...block, offset: 0 }])
      return ''
    })
    .join('')
}

const copyText = computed(() => getCopyText())

const cancelEdit = () => {
  if (isSavingEdit.value) return
  isEditMode.value = false
}

const handleAction = (action: 'delete' | 'copy') => {
  if (action === 'delete') {
    if (effectiveReadOnly.value) {
      return
    }
    emit('delete', props.message.id)
  } else if (action === 'copy') {
    deviceClient.copyText(getCopyText())
  }
}

const handleMentionClick = async (_block: DisplayUserMessageMentionBlock) => {
  return
}

let contentResizeObserver: ResizeObserver | null = null

const measureRenderedContent = () => {
  renderedContentHeight.value = contentMeasureRef.value?.scrollHeight ?? 0
}

watch(contentMeasureRef, (element) => {
  contentResizeObserver?.disconnect()
  measureRenderedContent()
  if (typeof ResizeObserver === 'undefined' || !element) return
  contentResizeObserver = new ResizeObserver(measureRenderedContent)
  contentResizeObserver.observe(element.firstElementChild ?? element)
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

watch(
  () => [props.message.id, props.message.status, props.message.inputReceipt?.readAt] as const,
  ([, status, readAt]) => {
    if (receiptTimer) {
      clearTimeout(receiptTimer)
      receiptTimer = null
    }
    if (!props.message.inputReceipt) {
      receipt.value = null
      return
    }
    if (status === 'error') {
      receipt.value = null
      return
    }
    if (readAt === null || readAt === undefined) {
      receipt.value = 'unread'
      return
    }

    const remaining = readAt + READ_RECEIPT_VISIBLE_MS - Date.now()
    if (remaining <= 0) {
      receipt.value = null
      return
    }
    receipt.value = 'read'
    receiptTimer = setTimeout(() => {
      receipt.value = null
      receiptTimer = null
    }, remaining)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  contentResizeObserver?.disconnect()
  if (receiptTimer) {
    clearTimeout(receiptTimer)
    receiptTimer = null
  }
})
</script>

<style scoped>
.user-message-content--clamped {
  overflow: hidden;
  max-height: 192px;
}
</style>
