<template>
  <div
    v-show="!message.content.continue"
    :data-message-id="message.id"
    class="flex flex-row-reverse group p-4 pl-11 gap-2 user-message-item"
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
      <div class="text-sm bg-[#EFF6FF] dark:bg-muted rounded-lg p-2 border flex flex-col gap-1.5">
        <div v-show="message.content.files.length > 0" class="flex flex-wrap gap-1.5">
          <FileItem
            v-for="file in message.content.files"
            :key="file.name"
            :file-name="file.name"
            :deletable="false"
            :tokens="file.token"
            :mime-type="file.mimeType"
            :thumbnail="file.thumbnail"
            @click="previewFile(file.path)"
          />
        </div>
        <div v-if="isEditMode" class="text-sm w-full min-w-[40vw] whitespace-pre-wrap break-all">
          <textarea
            v-model="editedText"
            class="text-sm bg-[#EFF6FF] dark:bg-muted rounded-lg p-2 border flex flex-col gap-1.5 resize min-w-[40vw] w-full"
            :style="{
              height: originalContentHeight + 18 + 'px',
              width: originalContentWidth + 20 + 'px'
            }"
            @keydown.enter.prevent="saveEdit"
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
import { UserMessage, UserMessageMentionBlock } from '@shared/chat'
import { Icon } from '@iconify/vue'
import MessageInfo from './MessageInfo.vue'
import FileItem from '../FileItem.vue'
import MessageToolbar from './MessageToolbar.vue'
import MessageContent from './MessageContent.vue'
import MessageTextContent from './MessageTextContent.vue'
import { useChatStore } from '@/stores/chat'
import { usePresenter } from '@/composables/usePresenter'
import { ref, watch, onMounted } from 'vue'

const chatStore = useChatStore()
const windowPresenter = usePresenter('windowPresenter')
const threadPresenter = usePresenter('threadPresenter')

const props = defineProps<{
  message: UserMessage
}>()

const isEditMode = ref(false)
const editedText = ref('')
const originalContent = ref(null)
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
  }
})

const emit = defineEmits<{
  fileClick: [fileName: string]
  retry: []
}>()

const previewFile = (filePath: string) => {
  windowPresenter.previewFile(filePath)
}

const startEdit = () => {
  isEditMode.value = true
  if (props.message.content?.content && props.message.content.content.length > 0) {
    const textBlocks = props.message.content.content.filter((block) => block.type === 'text')
    editedText.value = textBlocks.map((block) => block.content).join('')
    return
  }
  editedText.value = props.message.content.text || ''
}

const saveEdit = async () => {
  if (editedText.value.trim() === '') return

  try {
    // Create a new content object with the edited text
    let newContent = {
      ...props.message.content
    }
    if (newContent?.content && newContent.content.length > 0) {
      const nonTextBlocks = newContent.content.filter((block) => block.type !== 'text')
      newContent.content = [{ type: 'text', content: editedText.value }, ...nonTextBlocks]
    } else {
      newContent.text = editedText.value
    }
    // Update the message in the database using editMessage method
    await threadPresenter.editMessage(props.message.id, JSON.stringify(newContent))

    // Emit retry event for MessageItemAssistant to handle
    emit('retry')

    // Exit edit mode
    isEditMode.value = false
  } catch (error) {
    console.error('Failed to save edit:', error)
  }
}

const cancelEdit = () => {
  isEditMode.value = false
}

const handleAction = (action: 'delete' | 'copy') => {
  if (action === 'delete') {
    chatStore.deleteMessage(props.message.id)
  } else if (action === 'copy') {
    window.api.copyText(props.message.content.text)
  }
}

const handleMentionClick = (block: UserMessageMentionBlock) => {
  // 处理 mention 点击事件，可以根据需要实现具体逻辑
  console.log('Mention clicked:', block)
}
</script>
