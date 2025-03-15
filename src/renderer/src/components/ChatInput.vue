<template>
  <div
    class="w-full max-w-5xl mx-auto"
    @dragenter.prevent="handleDragEnter"
    @dragover.prevent="handleDragOver"
    @drop.prevent="handleDrop"
    @dragleave.prevent="handleDragLeave"
  >
    <TooltipProvider>
      <div
        class="bg-card border border-border rounded-lg focus-within:border-primary p-2 flex flex-col gap-2 shadow-sm relative"
      >
        <!-- {{  t('chat.input.fileArea') }} -->
        <div v-if="selectedFiles.length > 0">
          <TransitionGroup
            name="file-list"
            tag="div"
            class="flex flex-wrap gap-1.5"
            enter-active-class="transition-all duration-300 ease-in-out"
            leave-active-class="transition-all duration-300 ease-in-out"
            enter-from-class="opacity-0 -translate-y-2"
            leave-to-class="opacity-0 -translate-y-2"
            move-class="transition-transform duration-300 ease-in-out"
          >
            <FileItem
              v-for="(file, idx) in selectedFiles"
              :key="file.metadata.fileName"
              :file-name="file.metadata.fileName"
              :deletable="true"
              :mime-type="file.mimeType"
              :tokens="file.token"
              @click="previewFile(file.path)"
              @delete="deleteFile(idx)"
            />
          </TransitionGroup>
        </div>
        <!-- {{ t('chat.input.inputArea') }} -->
        <Textarea
          ref="textareaRef"
          v-model="inputText"
          :auto-focus="true"
          :rows="rows"
          :max-rows="maxRows"
          :placeholder="t('chat.input.placeholder')"
          class="textarea-selector border-none max-h-[10rem] shadow-none p-2 focus-visible:ring-0 focus-within:ring-0 ring-0 outline-none focus-within:outline-none text-sm resize-none overflow-y-auto"
          @keydown.enter.exact.prevent="handleEnterKey"
          @input="adjustHeight"
        ></Textarea>

        <div class="flex items-center justify-between">
          <!-- {{ t('chat.input.functionSwitch') }} -->
          <div class="flex gap-1.5">
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="outline"
                  size="icon"
                  class="w-7 h-7 text-xs rounded-lg text-muted-foreground"
                  @click="openFilePicker"
                >
                  <Icon icon="lucide:paperclip" class="w-4 h-4" />
                  <input
                    ref="fileInput"
                    type="file"
                    class="hidden"
                    multiple
                    accept="application/json,application/javascript,text/plain,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet,application/vnd.ms-excel.sheet.binary.macroEnabled.12,application/vnd.apple.numbers,text/markdown,application/x-yaml,application/xml,application/typescript,application/x-sh,text/*,application/pdf,image/jpeg,image/jpg,image/png,image/gif,image/webp,image/bmp,image/*,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/html,text/css,application/xhtml+xml"
                    @change="handleFileSelect"
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{{ t('chat.input.fileSelect') }}</TooltipContent>
            </Tooltip>

            <!-- MCP 工具列表 -->

            <!-- <Tooltip v-show="false">
              <TooltipTrigger>
                <Button
                  variant="outline"
                  size="xs"
                  :class="[
                    'rounded-lg text-xs font-normal',
                    settings.deepThinking
                      ? '!bg-primary dark:!bg-primary border-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
                      : 'text-muted-foreground'
                  ]"
                  @click="onDeepThinkingClick"
                >
                  <Icon icon="lucide:sparkles" class="w-4 h-4" />
                  {{ t('chat.features.deepThinking') }}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{{ t('chat.features.deepThinking') }}</TooltipContent>
            </Tooltip> -->
            <Tooltip>
              <TooltipTrigger>
                <span
                  class="search-engine-select overflow-hidden flex items-center h-7 rounded-lg shadow-sm border border-border transition-all duration-300"
                >
                  <Button
                    variant="outline"
                    :class="[
                      'flex w-7 border-none rounded-none shadow-none items-center gap-1.5 px-2 h-full',
                      settings.webSearch
                        ? 'dark:!bg-primary bg-primary border-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
                        : 'text-muted-foreground'
                    ]"
                    size="icon"
                    @click="onWebSearchClick"
                  >
                    <Icon icon="lucide:globe" class="w-4 h-4" />
                  </Button>
                  <Select
                    v-model="selectedSearchEngine"
                    @update:model-value="onSearchEngineChange"
                    @update:open="handleSelectOpen"
                  >
                    <SelectTrigger
                      class="h-full rounded-none border-none shadow-none hover:bg-accent text-muted-foreground dark:hover:text-primary-foreground transition-all duration-300"
                      :class="{
                        'w-0 opacity-0 p-0 overflow-hidden':
                          !showSearchSettingsButton && !isSearchHovering && !isSelectOpen,
                        'w-24 max-w-28 px-2 opacity-100':
                          showSearchSettingsButton || isSearchHovering || isSelectOpen
                      }"
                    >
                      <div class="flex items-center gap-1">
                        <SelectValue class="text-xs font-bold truncate" />
                      </div>
                    </SelectTrigger>
                    <SelectContent align="start" class="w-64">
                      <SelectItem
                        v-for="engine in searchEngines"
                        :key="engine.id"
                        :value="engine.id"
                      >
                        {{ engine.name }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </span>
              </TooltipTrigger>
              <TooltipContent>{{ t('chat.features.webSearch') }}</TooltipContent>
            </Tooltip>

            <McpToolsList />
            <!-- {{ t('chat.input.fileSelect') }} -->
            <slot name="addon-buttons"></slot>
          </div>
          <div class="flex items-center gap-2">
            <div
              v-if="
                contextLength &&
                contextLength > 0 &&
                currentContextLength / (contextLength ?? 1000) > 0.5
              "
              class="text-xs text-muted-foreground"
              :class="[
                currentContextLength / (contextLength ?? 1000) > 0.9 ? ' text-red-600' : '',
                currentContextLength / (contextLength ?? 1000) > 0.8
                  ? ' text-yellow-600'
                  : 'text-muted-foreground'
              ]"
            >
              {{ currentContextLengthText }}
            </div>
            <Button
              variant="default"
              size="icon"
              class="w-7 h-7 text-xs rounded-lg"
              :disabled="disabledSend"
              @click="emitSend"
            >
              <Icon icon="lucide:arrow-up" class="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div v-if="isDragging" class="absolute inset-0 bg-black/40 rounded-lg">
          <div class="flex items-center justify-center h-full gap-1">
            <Icon icon="lucide:file-up" class="w-4 h-4 text-white" />
            <span class="text-sm text-white">Drop files here</span>
          </div>
        </div>
      </div>
    </TooltipProvider>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Icon } from '@iconify/vue'
import FileItem from './FileItem.vue'
import { useChatStore } from '@/stores/chat'
import { MessageFile, UserMessageContent } from '@shared/chat'
import { usePresenter } from '@/composables/usePresenter'
import { approximateTokenSize } from 'tokenx'
import { useSettingsStore } from '@/stores/settings'
import McpToolsList from './mcpToolsList.vue'

const { t } = useI18n()
const configPresenter = usePresenter('configPresenter')
const chatStore = useChatStore()
const settingsStore = useSettingsStore()
const inputText = ref('')
const fileInput = ref<HTMLInputElement>()
const filePresenter = usePresenter('filePresenter')
const windowPresenter = usePresenter('windowPresenter')
const settings = ref({
  deepThinking: false,
  webSearch: false
})
const selectedSearchEngine = ref('')
const searchEngines = computed(() => settingsStore.searchEngines)
const currentContextLength = computed(() => {
  return (
    approximateTokenSize(inputText.value) +
    selectedFiles.value.reduce((acc, file) => {
      return acc + file.token
    }, 0)
  )
})

const textareaRef = ref<HTMLTextAreaElement>()
const isDragging = ref(false)
const dragCounter = ref(0)
let dragLeaveTimer: number | null = null

const selectedFiles = ref<MessageFile[]>([])
const props = withDefaults(
  defineProps<{
    contextLength?: number
    maxRows?: number
    rows?: number
  }>(),
  {
    maxRows: 10,
    rows: 1
  }
)

const currentContextLengthText = computed(() => {
  return `${Math.round((currentContextLength.value / (props.contextLength ?? 1000)) * 100)}%`
})

const emit = defineEmits(['send', 'file-upload'])

const openFilePicker = () => {
  fileInput.value?.click()
}

const previewFile = (filePath: string) => {
  windowPresenter.previewFile(filePath)
}

const handleFileSelect = async (e: Event) => {
  const files = (e.target as HTMLInputElement).files

  if (files && files.length > 0) {
    for (const file of files) {
      const path = window.api.getPathForFile(file)
      try {
        const fileInfo: MessageFile = await filePresenter.prepareFile(path)
        if (fileInfo) {
          selectedFiles.value.push(fileInfo)
        }
      } catch (error) {
        console.error('文件准备失败:', error)
        return
      }
    }
    emit('file-upload', selectedFiles.value)
  }
}

const emitSend = () => {
  if (inputText.value.trim()) {
    const messageContent: UserMessageContent = {
      text: inputText.value.trim(),
      files: selectedFiles.value,
      links: [],
      search: settings.value.webSearch,
      think: settings.value.deepThinking
    }

    emit('send', messageContent)
    inputText.value = ''
  }
}

const adjustHeight = (e: Event) => {
  const target = e.target as HTMLTextAreaElement
  target.style.height = 'auto'
  target.style.height = `${target.scrollHeight}px`
}

const deleteFile = (idx: number) => {
  const deletedFile = selectedFiles.value[idx]
  selectedFiles.value.splice(idx, 1)
  if (fileInput.value) {
    fileInput.value.value = ''
  }
  if (deletedFile && deletedFile.path) {
    filePresenter.onFileRemoved(deletedFile.path).catch((err) => {
      console.error('移除文件适配器失败:', err)
    })
  }
}

const disabledSend = computed(() => {
  return (
    chatStore.generatingThreadIds.has(chatStore.activeThreadId ?? '') ||
    inputText.value.length <= 0 ||
    currentContextLength.value > (props.contextLength ?? 4096)
  )
})

const handleEnterKey = (e: KeyboardEvent) => {
  if (disabledSend.value) {
    return
  }
  if (!e.isComposing) {
    emitSend()
  }
}

const onWebSearchClick = async () => {
  settings.value.webSearch = !settings.value.webSearch
  await configPresenter.setSetting('input_webSearch', settings.value.webSearch)
}

// const onDeepThinkingClick = async () => {
//   settings.value.deepThinking = !settings.value.deepThinking
//   await configPresenter.setSetting('input_deepThinking', settings.value.deepThinking)
// }

const onSearchEngineChange = async (engineName: string) => {
  await settingsStore.setSearchEngine(engineName)
}

const initSettings = async () => {
  settings.value.deepThinking = Boolean(await configPresenter.getSetting('input_deepThinking'))
  settings.value.webSearch = Boolean(await configPresenter.getSetting('input_webSearch'))
  selectedSearchEngine.value = settingsStore.activeSearchEngine?.id ?? 'google'
}

const handleDragEnter = (e: DragEvent) => {
  dragCounter.value++
  isDragging.value = true

  // 确保目标是文件
  if (e.dataTransfer?.types.includes('Files')) {
    isDragging.value = true
  }
}

const handleDragOver = () => {
  // 防止默认行为并保持拖拽状态
  if (dragLeaveTimer) {
    clearTimeout(dragLeaveTimer)
    dragLeaveTimer = null
  }
}

const handleDragLeave = () => {
  dragCounter.value--

  // 只有当计数器归零时才隐藏拖拽状态，并添加小延迟防止闪烁
  if (dragCounter.value <= 0) {
    if (dragLeaveTimer) clearTimeout(dragLeaveTimer)

    dragLeaveTimer = window.setTimeout(() => {
      if (dragCounter.value <= 0) {
        isDragging.value = false
        dragCounter.value = 0
      }
      dragLeaveTimer = null
    }, 50)
  }
}

const handleDrop = async (e: DragEvent) => {
  isDragging.value = false
  dragCounter.value = 0

  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    for (const file of e.dataTransfer.files) {
      try {
        const path = window.api.getPathForFile(file)
        const fileInfo: MessageFile = await filePresenter.prepareFile(path)
        console.log('fileInfo', fileInfo)
        if (fileInfo) {
          selectedFiles.value.push(fileInfo)
        }
      } catch (error) {
        console.error('文件准备失败:', error)
        return
      }
    }
    emit('file-upload', selectedFiles.value)
  }
}

// Search engine selector variables
const showSearchSettingsButton = ref(false)
const isSearchHovering = ref(false)
const isSelectOpen = ref(false)

// Handle select open state
const handleSelectOpen = (isOpen: boolean) => {
  isSelectOpen.value = isOpen
}

// Mouse hover handlers for search engine selector
const handleSearchMouseEnter = () => {
  isSearchHovering.value = true
}

const handleSearchMouseLeave = () => {
  isSearchHovering.value = false
}

onMounted(() => {
  initSettings()

  // Add event listeners for search engine selector hover
  const searchElement = document.querySelector('.search-engine-select')
  if (searchElement) {
    searchElement.addEventListener('mouseenter', handleSearchMouseEnter)
    searchElement.addEventListener('mouseleave', handleSearchMouseLeave)
  }
})

onUnmounted(() => {
  // Remove event listeners for search engine selector hover
  const searchElement = document.querySelector('.search-engine-select')
  if (searchElement) {
    searchElement.removeEventListener('mouseenter', handleSearchMouseEnter)
    searchElement.removeEventListener('mouseleave', handleSearchMouseLeave)
  }
})
watch(
  () => settingsStore.activeSearchEngine?.id,
  async () => {
    selectedSearchEngine.value = settingsStore.activeSearchEngine?.id ?? 'google'
  }
)
</script>

<style scoped>
.transition-all {
  transition-property: all;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}

.duration-300 {
  transition-duration: 300ms;
}
</style>
