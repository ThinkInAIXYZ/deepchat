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
            class="text-sm bg-muted dark:bg-muted rounded-lg p-2 border flex flex-col gap-1.5 resize-none overflow-y-auto overscroll-contain min-w-[40vw] w-full"
            :style="{
              width: originalContentWidth + 20 + 'px',
              maxHeight: editMaxHeight ? editMaxHeight + 'px' : undefined
            }"
            rows="1"
            @input="autoResize"
            @keydown.meta.enter.prevent="saveEdit"
            @keydown.ctrl.enter.prevent="saveEdit"
            @keydown.esc="cancelEdit"
          ></textarea>
        </div>
        <div v-else ref="originalContent">
          <!-- 使用结构化内容渲染 -->
          <MessageContent
            v-if="message.content.content && message.content.content.length > 0"
            :content="message.content.content"
            @mention-click="handleMentionClick"
          />
          <!-- 使用纯文本渲染 -->
          <MessageTextContent v-else :content="message.content.text || ''" />
        </div>
        <!-- <div
          v-else-if="message.content.continue"
          class="text-sm whitespace-pre-wrap break-all flex flex-row flex-wrap items-center gap-2"
        >
          <Icon icon="lucide:info" class="w-4 h-4" />
          <span>用户选择继续对话</span>
        </div>
         -->
        <!-- disable for now -->
        <!-- <div class="flex flex-row gap-1.5 text-xs text-muted-foreground">
          <span v-if="message.content.search">联网搜索</span>
          <span v-if="message.content.reasoning_content">深度思考</span>
        </div> -->
      </div>
      <MessageToolbar
        class="flex-row-reverse"
        :usage="message.usage"
        :loading="false"
        :is-assistant="false"
        :is-edit-mode="isEditMode"
        :is-capturing-image="false"
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
  DisplayUserMessage,
  DisplayUserMessageMentionBlock
} from '@/components/chat/messageListItems'
import { Icon } from '@iconify/vue'
import MessageInfo from './MessageInfo.vue'
import ChatAttachmentItem from '../chat/ChatAttachmentItem.vue'
import MessageToolbar from './MessageToolbar.vue'
import MessageContent from './MessageContent.vue'
import MessageTextContent from './MessageTextContent.vue'
import { usePresenter } from '@/composables/usePresenter'
import { ref, watch, onMounted, nextTick, onBeforeUnmount } from 'vue'

const windowPresenter = usePresenter('windowPresenter')

const props = defineProps<{
  message: DisplayUserMessage
}>()

const isEditMode = ref(false)
const editedText = ref('')
const originalContent = ref(null)
const editTextarea = ref<HTMLTextAreaElement | null>(null)
const editMaxHeight = ref(0)
const originalContentHeight = ref(0)
const originalContentWidth = ref(0)

onMounted(() => {
  if (originalContent.value) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    originalContentHeight.value = (originalContent.value as any).offsetHeight
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    originalContentWidth.value = (originalContent.value as any).offsetWidth
  }
})

watch(isEditMode, (newValue) => {
  if (newValue && originalContent.value) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    originalContentHeight.value = (originalContent.value as any).offsetHeight
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    originalContentWidth.value = (originalContent.value as any).offsetWidth
    computeEditMaxHeight()
    nextTick(() => autoResize())
  }
})

const emit = defineEmits<{
  fileClick: [fileName: string]
  retry: [messageId: string]
  delete: [messageId: string]
  editSave: [payload: { messageId: string; text: string }]
}>()

const previewFile = (filePath: string) => {
  windowPresenter.previewFile(filePath)
}

const startEdit = () => {
  isEditMode.value = true
  if (props.message.content?.content && props.message.content.content.length > 0) {
    const textBlocks = props.message.content.content.filter((block) => block.type === 'text')
    editedText.value = textBlocks.map((block) => block.content).join('')
  } else {
    editedText.value = props.message.content.text || ''
  }
  computeEditMaxHeight()
  nextTick(() => autoResize())
}

const saveEdit = async () => {
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
  const computed = window.getComputedStyle(el)
  const maxH = parseFloat(computed.maxHeight || '')
  const scrollH = el.scrollHeight
  const target = Number.isFinite(maxH) && maxH > 0 ? Math.min(scrollH, maxH) : scrollH
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

const computeEditMaxHeight = () => {
  const container = document.querySelector('.message-list-container') as HTMLElement | null
  const base = container?.clientHeight || window.innerHeight
  editMaxHeight.value = Math.max(120, Math.floor(base * 0.6))
}

const handleWindowResize = () => {
  if (isEditMode.value) {
    computeEditMaxHeight()
    nextTick(() => autoResize())
  }
}

window.addEventListener('resize', handleWindowResize)
onBeforeUnmount(() => {
  window.removeEventListener('resize', handleWindowResize)
})
</script>
