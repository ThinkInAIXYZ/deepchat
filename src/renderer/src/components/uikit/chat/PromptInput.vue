<template>
  <div
    class="prompt-input-root w-full"
    @dragenter.prevent="handleDragEnter"
    @dragover.prevent="handleDragOver"
    @drop.prevent="handleDrop"
    @dragleave.prevent="handleDragLeave"
    @paste="handlePaste"
  >
    <TooltipProvider>
      <div :dir="langStore.dir" class="prompt-surface p-0 flex flex-col gap-0 relative w-full">
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
              :thumbnail="file.thumbnail"
              :context="'input'"
              @click="previewFile(file.path)"
              @delete="deleteFile(idx)"
            />
          </TransitionGroup>
        </div>

        <editor-content :editor="editor" class="editor p-0" @keydown="onKeydown" />

        <div class="bottom-bar flex items-center justify-between">
          <div class="flex gap-1.5 items-center">
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="outline"
                  size="icon"
                  class="icon-btn"
                  data-role="file-btn"
                  @click="openFilePicker"
                >
                  <Icon icon="lucide:paperclip" class="w-4 h-4" />
                  <input
                    ref="fileInput"
                    type="file"
                    class="hidden"
                    multiple
                    accept="application/json,application/javascript,text/plain,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet,application/vnd.ms-excel.sheet.binary.macroEnabled.12,application/vnd.apple.numbers,text/markdown,application/x-yaml,application/xml,application/typescript,text/typescript,text/x-typescript,application/x-typescript,application/x-sh,text/*,application/pdf,image/jpeg,image/jpg,image/png,image/gif,image/webp,image/bmp,image/*,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/html,text/css,application/xhtml+xml,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.cs,.go,.rb,.php,.rs,.swift,.kt,.scala,.pl,.lua,.sh,.json,.yaml,.yml,.xml,.html,.htm,.css,.md,audio/mp3,audio/wav,audio/mp4,audio/mpeg,.mp3,.wav,.m4a"
                    @change="handleFileSelect"
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{{ t('chat.input.fileSelect') }}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger>
                <span
                  class="search-engine-select overflow-hidden flex items-center rounded-lg transition-all duration-300 gap-0"
                  :class="{ active: settings.webSearch }"
                  :dir="langStore.dir"
                  @mouseenter="handleSearchMouseEnter()"
                  @mouseleave="handleSearchMouseLeave()"
                >
                  <Button
                    variant="outline"
                    :class="[
                      'flex w-7 h-[26px] border-none rounded-none shadow-none items-center justify-center p-0',
                      settings.webSearch
                        ? 'dark:!bg-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
                        : ''
                    ]"
                    :dir="langStore.dir"
                    size="icon"
                    @click="onWebSearchClick"
                  >
                    <Icon icon="lucide:globe" class="w-4 h-4" />
                  </Button>
                  <div
                    class="h-[26px] overflow-hidden transition-all duration-300"
                    :class="{
                      'w-0 opacity-0':
                        !showSearchSettingsButton && !isSearchHovering && !isSelectOpen,
                      'w-24 opacity-100':
                        showSearchSettingsButton || isSearchHovering || isSelectOpen
                    }"
                  >
                    <Select
                      v-model="selectedSearchEngine"
                      @update:model-value="onSearchEngineChange"
                      @update:open="handleSelectOpen"
                      class="w-full h-full"
                    >
                      <SelectTrigger
                        class="w-full h-full rounded-none border-none shadow-none hover:bg-accent text-muted-foreground dark:hover:text-primary-foreground relative justify-center"
                      >
                        <div
                          class="absolute inset-0 flex items-center justify-center pointer-events-none"
                        >
                          <SelectValue class="text-xs font-bold truncate text-center max-w-[70%]" />
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
                  </div>
                </span>
              </TooltipTrigger>
              <TooltipContent>{{ t('chat.features.webSearch') }}</TooltipContent>
            </Tooltip>

            <McpToolsList />
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

            <div
              v-if="rateLimitStatus?.config.enabled"
              class="flex items-center gap-1 text-xs"
              :class="getRateLimitStatusClass()"
              :title="getRateLimitStatusTooltip()"
            >
              <Icon
                :icon="getRateLimitStatusIcon()"
                class="w-3 h-3"
                :class="{ 'animate-pulse': rateLimitStatus.queueLength > 0 }"
              />
              <span v-if="rateLimitStatus.queueLength > 0">
                {{ t('chat.input.rateLimitQueue', { count: rateLimitStatus.queueLength }) }}
              </span>
              <span v-else-if="!canSendImmediately">{{ formatWaitTime() }}</span>
            </div>

            <Popover v-model:open="modelSelectOpen">
              <PopoverTrigger as-child>
                <Button
                  variant="outline"
                  class="model-chip border-none rounded-lg shadow-none items-center gap-1.5 px-2 h-[26px] flex-shrink-0"
                  size="sm"
                >
                  <ModelIcon
                    class="w-4 h-4"
                    :model-id="activeModel.providerId"
                    :is-dark="themeStore.isDark"
                  />
                  <span class="text-xs font-bold truncate max-w-[150px]">{{ name }}</span>
                  <Icon icon="lucide:chevron-right" class="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" class="p-0 w-80">
                <ModelSelect
                  :type="[ModelType.Chat, ModelType.ImageGeneration]"
                  @update:model="handleModelUpdate"
                />
              </PopoverContent>
            </Popover>

            <Button
              variant="default"
              size="icon"
              class="send-btn"
              data-role="send-btn"
              :disabled="disabledSend"
              @click="emitSend"
            >
              <Icon icon="lucide:send-horizontal" class="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div v-if="isDragging" class="drag-overlay">
          <div class="flex flex-col items-center justify-center h-full gap-2">
            <div class="flex items-center gap-1">
              <Icon icon="lucide:file-up" class="w-4 h-4 text-white" />
              <span class="text-sm text-white">{{ t('chat.input.dropFiles') }}</span>
            </div>
            <div class="flex items-center gap-1">
              <Icon icon="lucide:clipboard" class="w-3 h-3 text-white/80" />
              <span class="text-xs text-white/80">{{ t('chat.input.pasteFiles') }}</span>
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
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
import FileItem from '@/components/FileItem.vue'
import { useChatStore } from '@/stores/chat'
import {
  MessageFile,
  UserMessageCodeBlock,
  UserMessageContent,
  UserMessageMentionBlock,
  UserMessageTextBlock
} from '@shared/chat'
import { usePresenter } from '@/composables/usePresenter'
import { approximateTokenSize } from 'tokenx'
import { useSettingsStore } from '@/stores/settings'
import McpToolsList from '@/components/mcpToolsList.vue'
import { calculateImageTokens, getClipboardImageInfo, imageFileToBase64 } from '@/lib/image'
import { RATE_LIMIT_EVENTS } from '@/events'
import { Editor, EditorContent, JSONContent } from '@tiptap/vue-3'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { Mention } from '@/components/editor/mention/mention'
import suggestion, {
  mentionData,
  setPromptFilesHandler,
  getPromptFilesHandler
} from '@/components/editor/mention/suggestion'
import { mentionSelected } from '@/components/editor/mention/suggestion'
import Placeholder from '@tiptap/extension-placeholder'
import HardBreak from '@tiptap/extension-hard-break'
import History from '@tiptap/extension-history'
import { useMcpStore } from '@/stores/mcp'
import { ResourceListEntry } from '@shared/presenter'
import { searchHistory } from '@/lib/searchHistory'
import { useLanguageStore } from '@/stores/language'
import { useToast } from '@/components/ui/toast/use-toast'
import type { CategorizedData } from '@/components/editor/mention/suggestion'
import type { PromptListEntry } from '@shared/presenter'
import { sanitizeText } from '@/lib/sanitizeText'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import ModelSelect from '@/components/ModelSelect.vue'
import ModelIcon from '@/components/icons/ModelIcon.vue'
import { ModelType } from '@shared/model'
import { useThemeStore } from '@/stores/theme'
import type { MODEL_META } from '@shared/presenter'

defineOptions({ inheritAttrs: false })

const langStore = useLanguageStore()
const themeStore = useThemeStore()
const mcpStore = useMcpStore()
const { toast } = useToast()
const { t } = useI18n()
searchHistory.resetIndex()

const currentHistoryPlaceholder = ref('')
const showHistoryPlaceholder = ref(false)

const props = withDefaults(
  defineProps<{
    contextLength?: number
    maxRows?: number
    rows?: number
    disabled?: boolean
  }>(),
  { maxRows: 10, rows: 1, disabled: false }
)

// Define dynamicPlaceholder BEFORE editor initialization to avoid TDZ
const dynamicPlaceholder = computed(() => {
  if (currentHistoryPlaceholder.value) {
    return `${currentHistoryPlaceholder.value} ${t('chat.input.historyPlaceholder')}`
  }
  return t('chat.input.placeholder')
})

const editor = new Editor({
  editorProps: {
    attributes: {
      class:
        'outline-none focus:outline-none focus-within:outline-none min-h-[3rem] max-h-[7rem] overflow-y-auto'
    }
  },
  autofocus: true,
  extensions: [
    Document,
    Paragraph,
    Text,
    History,
    Mention.configure({
      HTMLAttributes: {
        class:
          'mention px-1.5 py-0.5 text-xs rounded-md bg-secondary text-foreground inline-block max-w-64 align-sub !truncate'
      },
      suggestion,
      deleteTriggerWithBackspace: true
    }),
    Placeholder.configure({ placeholder: () => dynamicPlaceholder.value }),
    HardBreak.extend({
      addKeyboardShortcuts() {
        return {
          'Shift-Enter': () => this.editor.chain().setHardBreak().scrollIntoView().run(),
          'Alt-Enter': () => this.editor.chain().setHardBreak().scrollIntoView().run()
        }
      }
    }).configure({ keepMarks: true, HTMLAttributes: { class: 'line-break' } })
  ],
  onUpdate: ({ editor }) => {
    inputText.value = editor.getText()
    if (inputText.value.trim() && currentHistoryPlaceholder.value) {
      clearHistoryPlaceholder()
    }
  }
})

const configPresenter = usePresenter('configPresenter')
const chatStore = useChatStore()
const settingsStore = useSettingsStore()
const inputText = ref('')
const fetchingMcpEntry = ref(false)
const fileInput = ref<HTMLInputElement>()
const filePresenter = usePresenter('filePresenter')
const windowPresenter = usePresenter('windowPresenter')
const llmPresenter = usePresenter('llmproviderPresenter')
const settings = ref({ deepThinking: false, webSearch: false })
const selectedSearchEngine = ref('')
const searchEngines = computed(() => settingsStore.searchEngines)

// model select state
const modelSelectOpen = ref(false)
const activeModel = ref({
  name: '',
  id: '',
  providerId: '',
  tags: [],
  type: ModelType.Chat
} as {
  name: string
  id: string
  providerId: string
  tags: string[]
  type: ModelType
})
const name = computed(() =>
  activeModel.value?.name ? activeModel.value.name.split('/').pop() : ''
)

const currentContextLength = computed(() => {
  return (
    approximateTokenSize(inputText.value) +
    selectedFiles.value.reduce((acc, file) => acc + file.token, 0)
  )
})

const currentContextLengthText = computed(() => {
  return `${Math.round((currentContextLength.value / (props.contextLength ?? 1000)) * 100)}%`
})

const isDragging = ref(false)
const dragCounter = ref(0)
let dragLeaveTimer: number | null = null

const selectedFiles = ref<MessageFile[]>([])
let editorPasteHandler: ((e: ClipboardEvent) => void) | null = null

const rateLimitStatus = ref<{
  config: { enabled: boolean; qpsLimit: number }
  currentQps: number
  queueLength: number
  lastRequestTime: number
} | null>(null)

const canSendImmediately = computed(() => {
  if (!rateLimitStatus.value?.config.enabled) return true
  const now = Date.now()
  const intervalMs = (1 / rateLimitStatus.value.config.qpsLimit) * 1000
  const timeSinceLastRequest = now - rateLimitStatus.value.lastRequestTime
  return timeSinceLastRequest >= intervalMs
})

const getRateLimitStatusIcon = () => {
  if (!rateLimitStatus.value?.config.enabled) return ''
  if (rateLimitStatus.value.queueLength > 0) return 'lucide:clock'
  return canSendImmediately.value ? 'lucide:check-circle' : 'lucide:timer'
}

const getRateLimitStatusClass = () => {
  if (!rateLimitStatus.value?.config.enabled) return ''
  if (rateLimitStatus.value.queueLength > 0) return 'text-orange-500'
  return canSendImmediately.value ? 'text-green-500' : 'text-yellow-500'
}

const getRateLimitStatusTooltip = () => {
  if (!rateLimitStatus.value?.config.enabled) return ''
  const intervalSeconds = 1 / rateLimitStatus.value.config.qpsLimit
  if (rateLimitStatus.value.queueLength > 0) {
    return t('chat.input.rateLimitQueueTooltip', {
      count: rateLimitStatus.value.queueLength,
      interval: intervalSeconds
    })
  }
  if (canSendImmediately.value) {
    return t('chat.input.rateLimitReadyTooltip', { interval: intervalSeconds })
  }
  const waitTime = Math.ceil(
    (rateLimitStatus.value.lastRequestTime + intervalSeconds * 1000 - Date.now()) / 1000
  )
  return t('chat.input.rateLimitWaitingTooltip', { seconds: waitTime, interval: intervalSeconds })
}

const formatWaitTime = () => {
  if (!rateLimitStatus.value?.config.enabled) return ''
  const intervalSeconds = 1 / rateLimitStatus.value.config.qpsLimit
  const waitTime = Math.ceil(
    (rateLimitStatus.value.lastRequestTime + intervalSeconds * 1000 - Date.now()) / 1000
  )
  return t('chat.input.rateLimitWait', { seconds: Math.max(0, waitTime) })
}

const emit = defineEmits(['send', 'file-upload'])

const openFilePicker = () => fileInput.value?.click()
const previewFile = (filePath: string) => windowPresenter.previewFile(filePath)

const handlePaste = async (e: ClipboardEvent) => {
  if ((e as any)?._deepchatHandled) return
  const files = e.clipboardData?.files
  if (files && files.length > 0) {
    for (const file of files) {
      try {
        if (file.type.startsWith('image/')) {
          const base64 = (await imageFileToBase64(file)) as string
          const imageInfo = await getClipboardImageInfo(file)
          const tempFilePath = await filePresenter.writeImageBase64({
            name: file.name ?? 'image',
            content: base64
          })
          const fileInfo: MessageFile = {
            name: file.name ?? 'image',
            content: base64,
            mimeType: file.type,
            metadata: {
              fileName: file.name ?? 'image',
              fileSize: file.size,
              fileDescription: file.type,
              fileCreated: new Date(),
              fileModified: new Date()
            },
            token: calculateImageTokens(imageInfo.width, imageInfo.height),
            path: tempFilePath
          }
          selectedFiles.value.push(fileInfo)
        }
      } catch (error) {
        console.error('粘贴文件处理失败:', error)
        return
      }
    }
    emit('file-upload', selectedFiles.value)
  }
}

const handleFileSelect = async (e: Event) => {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files || files.length === 0) return
  for (const file of files) {
    try {
      const path = window.api.getPathForFile(file)
      const mimeType = await filePresenter.getMimeType(path)
      const fileInfo: MessageFile = await filePresenter.prepareFile(path, mimeType)
      if (fileInfo) selectedFiles.value.push(fileInfo)
    } catch (error) {
      console.error('文件准备失败:', error)
      return
    }
  }
  emit('file-upload', selectedFiles.value)
  if (e.target) (e.target as HTMLInputElement).value = ''
}

const tiptapJSONtoMessageBlock = async (docJSON: JSONContent) => {
  const blocks: (UserMessageMentionBlock | UserMessageTextBlock | UserMessageCodeBlock)[] = []
  if (docJSON.type === 'doc') {
    for (const [idx, block] of (docJSON.content ?? []).entries()) {
      if (block.type === 'paragraph') {
        for (const [index, subBlock] of (block.content ?? []).entries()) {
          if (subBlock.type === 'text') {
            blocks.push({ type: 'text', content: subBlock.text ?? '' })
          } else if (subBlock.type === 'hardBreak') {
            if (index > 0 && block.content?.[index - 1]?.type === 'text') {
              blocks[blocks.length - 1].content += '\n'
            } else {
              blocks.push({ type: 'text', content: '\n' })
            }
          } else if (subBlock.type === 'mention') {
            let content = subBlock.attrs?.label ?? ''
            try {
              if (subBlock.attrs?.category === 'resources' && subBlock.attrs?.content) {
                fetchingMcpEntry.value = true
                const mcpEntry = JSON.parse(subBlock.attrs?.content) as ResourceListEntry
                const mcpEntryResult = await mcpStore.readResource(mcpEntry)
                if (mcpEntryResult.blob) {
                  const arrayBuffer = await new Blob([mcpEntryResult.blob], {
                    type: mcpEntryResult.mimeType
                  }).arrayBuffer()
                  const tempFilePath = await filePresenter.writeTemp({
                    name: mcpEntry.name ?? 'temp_resource',
                    content: arrayBuffer
                  })
                  const mimeType = await filePresenter.getMimeType(tempFilePath)
                  const fileInfo: MessageFile = await filePresenter.prepareFile(
                    tempFilePath,
                    mimeType
                  )
                  if (fileInfo) selectedFiles.value.push(fileInfo)
                  content = mcpEntry.name ?? 'temp_resource'
                } else {
                  content = mcpEntryResult.text ?? ''
                }
              }
            } catch (error) {
              console.error('读取资源失败:', error)
            } finally {
              fetchingMcpEntry.value = false
            }

            if (subBlock.attrs?.category === 'prompts') {
              fetchingMcpEntry.value = true
              try {
                const promptAttrContent = subBlock.attrs?.content as string
                if (promptAttrContent) {
                  const promptObject = JSON.parse(promptAttrContent)
                  const prompResult = await mcpStore.getPrompt(
                    promptObject,
                    promptObject.argumentsValue
                  )
                  content = JSON.stringify(prompResult)
                } else {
                  content = subBlock.attrs?.label || subBlock.attrs?.id || 'prompt'
                }
              } catch (error) {
                console.error('Error processing prompt mention:', error)
                content = subBlock.attrs?.label || subBlock.attrs?.id || 'prompt'
              } finally {
                fetchingMcpEntry.value = false
              }
            }

            const newBlock: UserMessageMentionBlock = {
              type: 'mention',
              id: subBlock.attrs?.id ?? '',
              content: content,
              category: subBlock.attrs?.category ?? ''
            }
            blocks.push(newBlock)
          }
        }
        if (idx < (docJSON.content?.length ?? 0) - 1 && idx > 0) {
          blocks.push({ type: 'text', content: '\n' })
        }
      } else if (block.type === 'codeBlock') {
        blocks.push({
          type: 'code',
          content: block.content?.[0]?.text ?? '',
          language: block.content?.[0]?.attrs?.language ?? 'text'
        })
      }
    }
  }
  return blocks
}

const emitSend = async () => {
  if (inputText.value.trim()) {
    searchHistory.addSearch(inputText.value.trim())
    const blocks = await tiptapJSONtoMessageBlock(editor.getJSON())
    const messageContent: UserMessageContent = {
      text: inputText.value.trim(),
      files: selectedFiles.value,
      links: [],
      search: settings.value.webSearch,
      think: settings.value.deepThinking,
      content: blocks
    }
    emit('send', messageContent)
    inputText.value = ''
    editor.chain().clearContent().run()
    clearHistoryPlaceholder()
    if (selectedFiles.value.length > 0) {
      selectedFiles.value = []
      if (fileInput.value) fileInput.value.value = ''
    }
    nextTick(() => {
      editor.commands.focus()
    })
  }
}

const deleteFile = (idx: number) => {
  selectedFiles.value.splice(idx, 1)
  if (fileInput.value) fileInput.value.value = ''
}

const handlePromptFiles = async (
  files: Array<{
    id: string
    name: string
    type: string
    size: number
    path: string
    description?: string
    content?: string
    createdAt: number
  }>
) => {
  if (!files || files.length === 0) return
  let addedCount = 0
  let errorCount = 0
  for (const fileItem of files) {
    try {
      const exists = selectedFiles.value.some((f) => f.name === fileItem.name)
      if (exists) continue
      const messageFile: MessageFile = {
        name: fileItem.name,
        content: fileItem.content || '',
        mimeType: fileItem.type || 'application/octet-stream',
        metadata: {
          fileName: fileItem.name,
          fileSize: fileItem.size || 0,
          fileDescription: fileItem.description || '',
          fileCreated: new Date(fileItem.createdAt || Date.now()),
          fileModified: new Date(fileItem.createdAt || Date.now())
        },
        token: approximateTokenSize(fileItem.content || ''),
        path: fileItem.path || fileItem.name
      }
      if (!messageFile.content && fileItem.path) {
        try {
          const fileContent = await filePresenter.readFile(fileItem.path)
          messageFile.content = fileContent
          messageFile.token = approximateTokenSize(fileContent)
        } catch (error) {
          console.warn(`Failed to read file content: ${fileItem.path}`, error)
        }
      }
      selectedFiles.value.push(messageFile)
      addedCount++
    } catch (error) {
      console.error('Failed to process prompt file:', fileItem, error)
      errorCount++
    }
  }
  if (addedCount > 0) {
    toast({
      title: t('chat.input.promptFilesAdded'),
      description: t('chat.input.promptFilesAddedDesc', { count: addedCount }),
      variant: 'default'
    })
    emit('file-upload', selectedFiles.value)
  }
  if (errorCount > 0) {
    toast({
      title: t('chat.input.promptFilesError'),
      description: t('chat.input.promptFilesErrorDesc', { count: errorCount }),
      variant: 'destructive'
    })
  }
}

const disabledSend = computed(() => {
  const activeThreadId = chatStore.getActiveThreadId()
  if (activeThreadId) {
    return (
      chatStore.generatingThreadIds.has(activeThreadId) ||
      inputText.value.length <= 0 ||
      currentContextLength.value > (props.contextLength ?? chatStore.chatConfig.contextLength)
    )
  }
  return false
})

const handleEditorEnter = (e: KeyboardEvent) => {
  if (mentionSelected.value) {
    return
  }
  e.preventDefault()
  if (disabledSend.value) return
  if (!e.isComposing) emitSend()
}

const onWebSearchClick = async () => {
  settings.value.webSearch = !settings.value.webSearch
  await configPresenter.setSetting('input_webSearch', settings.value.webSearch)
}

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
  if (e.dataTransfer?.types.includes('Files')) {
    isDragging.value = true
  }
}

const handleDragOver = () => {
  if (dragLeaveTimer) {
    clearTimeout(dragLeaveTimer)
    dragLeaveTimer = null
  }
}

const handleDragLeave = () => {
  dragCounter.value--
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
        if (file.type === '') {
          const isDirectory = await filePresenter.isDirectory(path)
          if (isDirectory) {
            const fileInfo: MessageFile = await filePresenter.prepareDirectory(path)
            if (fileInfo) selectedFiles.value.push(fileInfo)
          } else {
            const mimeType = await filePresenter.getMimeType(path)
            const fileInfo: MessageFile = await filePresenter.prepareFile(path, mimeType)
            if (fileInfo) selectedFiles.value.push(fileInfo)
          }
        } else {
          const mimeType = await filePresenter.getMimeType(path)
          const fileInfo: MessageFile = await filePresenter.prepareFile(path, mimeType)
          if (fileInfo) selectedFiles.value.push(fileInfo)
        }
      } catch (error) {
        console.error('文件准备失败:', error)
        return
      }
    }
    emit('file-upload', selectedFiles.value)
  }
}

const showSearchSettingsButton = ref(false)
const isSearchHovering = ref(false)
const isSelectOpen = ref(false)
const handleSelectOpen = (isOpen: boolean) => {
  isSelectOpen.value = isOpen
}
const handleSearchMouseEnter = () => {
  isSearchHovering.value = true
}
const handleSearchMouseLeave = () => {
  isSearchHovering.value = false
}

const loadRateLimitStatus = async () => {
  const currentProviderId = chatStore.chatConfig.providerId
  if (currentProviderId) {
    if (!isRateLimitEnabled()) {
      rateLimitStatus.value = null
      return
    }
    const status = await llmPresenter.getProviderRateLimitStatus(currentProviderId)
    rateLimitStatus.value = status
  }
}

const isRateLimitEnabled = () => {
  const currentProviderId = chatStore.chatConfig.providerId
  if (!currentProviderId) return false
  const provider = settingsStore.providers.find((p) => p.id === currentProviderId)
  if (!provider) return false
  return provider.rateLimit?.enabled ?? false
}

let statusInterval: ReturnType<typeof setInterval> | null = null
const startRateLimitPolling = () => {
  if (statusInterval) clearInterval(statusInterval)
  if (isRateLimitEnabled()) statusInterval = setInterval(loadRateLimitStatus, 1000)
}
const stopRateLimitPolling = () => {
  if (statusInterval) {
    clearInterval(statusInterval)
    statusInterval = null
  }
}

const updatePlaceholder = () => {
  nextTick(() => {
    const { state } = editor
    editor.view.updateState(state)
  })
}

const setHistoryPlaceholder = (text: string) => {
  currentHistoryPlaceholder.value = text
  showHistoryPlaceholder.value = true
  updatePlaceholder()
}
const clearHistoryPlaceholder = () => {
  currentHistoryPlaceholder.value = ''
  showHistoryPlaceholder.value = false
  updatePlaceholder()
  searchHistory.resetIndex()
}

function onKeydown(e: KeyboardEvent) {
  if (e.code === 'Enter' && !e.shiftKey) {
    handleEditorEnter(e)
    e.preventDefault()
  }
  const currentContent = editor.getText().trim()
  if (e.code === 'ArrowUp' && !currentContent) {
    const previousSearch = searchHistory.getPrevious()
    if (previousSearch !== null) setHistoryPlaceholder(previousSearch)
    e.preventDefault()
  } else if (e.code === 'ArrowDown' && !currentContent) {
    const nextSearch = searchHistory.getNext()
    if (nextSearch !== null) setHistoryPlaceholder(nextSearch)
    e.preventDefault()
  } else if (e.code === 'Tab' && currentHistoryPlaceholder.value) {
    e.preventDefault()
    editor.commands.setContent(currentHistoryPlaceholder.value)
    clearHistoryPlaceholder()
  } else if (e.code === 'Escape' && currentHistoryPlaceholder.value) {
    e.preventDefault()
    clearHistoryPlaceholder()
  } else if (currentHistoryPlaceholder.value && e.key.length === 1) {
    clearHistoryPlaceholder()
  }
}

const restoreFocus = () => {
  nextTick(() => {
    if (editor && !editor.isDestroyed && !props.disabled) {
      try {
        const editorElement = editor.view.dom
        if (editorElement && editorElement.offsetParent !== null) {
          editor.commands.focus()
          return
        }
      } catch {}
      try {
        const el = document.querySelector('[data-tiptap-editor]') as HTMLElement
        el?.focus()
      } catch {}
    }
  })
}

onMounted(() => {
  initSettings()
  ensureDefaultModel()
  setPromptFilesHandler(handlePromptFiles)
  loadRateLimitStatus()
  // hover handled via template events to avoid selector-timing issues
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  window.addEventListener('context-menu-ask-ai', (e: any) => {
    inputText.value = e.detail
    editor.commands.setContent(e.detail)
    editor.commands.focus()
  })
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      setTimeout(() => {
        restoreFocus()
      }, 100)
    }
  })
  window.electron.ipcRenderer.on(RATE_LIMIT_EVENTS.CONFIG_UPDATED, handleRateLimitEvent)
  window.electron.ipcRenderer.on(RATE_LIMIT_EVENTS.REQUEST_EXECUTED, handleRateLimitEvent)
  window.electron.ipcRenderer.on(RATE_LIMIT_EVENTS.REQUEST_QUEUED, handleRateLimitEvent)
  startRateLimitPolling()
  try {
    if (editor && editor.view && editor.view.dom) {
      editorPasteHandler = (e: ClipboardEvent) => {
        try {
          ;(e as any)._deepchatHandled = true
          const files = e.clipboardData?.files
          if (files && files.length > 0) {
            e.preventDefault()
            e.stopPropagation()
            void handlePaste(e)
            return
          }
          const text = e.clipboardData?.getData('text/plain') || ''
          if (text) {
            e.preventDefault()
            e.stopPropagation()
            const clean = sanitizeText(text)
            const sel = editor.state.selection
            const from = sel.from
            const to = sel.to
            const convertTextToNodes = (txt: string): JSONContent[] => {
              const lines = txt.replace(/\r/g, '').split('\n')
              const content: JSONContent[] = []
              for (let i = 0; i < lines.length; i++) {
                if (i > 0) content.push({ type: 'hardBreak' })
                const line = lines[i]
                if (line.length > 0) content.push({ type: 'text', text: line })
              }
              return content
            }
            editor
              .chain()
              .insertContentAt({ from, to }, convertTextToNodes(clean), { updateSelection: true })
              .scrollIntoView()
              .run()
            inputText.value = editor.getText()
          }
        } catch (err) {
          console.error('editor paste handler error', err)
        }
      }
      editor.view.dom.addEventListener('paste', editorPasteHandler as EventListener, true)
    }
  } catch (err) {
    console.warn('Failed to attach editor paste handler', err)
  }
})

const handleRateLimitEvent = (data: any) => {
  if (data.providerId === chatStore.chatConfig.providerId) {
    if (data.config && !data.config.enabled) {
      rateLimitStatus.value = null
    } else {
      loadRateLimitStatus()
    }
    startRateLimitPolling()
  }
}

onUnmounted(() => {
  stopRateLimitPolling()
  window.electron.ipcRenderer.removeAllListeners(RATE_LIMIT_EVENTS.CONFIG_UPDATED)
  window.electron.ipcRenderer.removeAllListeners(RATE_LIMIT_EVENTS.REQUEST_EXECUTED)
  window.electron.ipcRenderer.removeAllListeners(RATE_LIMIT_EVENTS.REQUEST_QUEUED)
  try {
    if (editorPasteHandler && editor && editor.view && editor.view.dom) {
      editor.view.dom.removeEventListener('paste', editorPasteHandler as EventListener, true)
      editorPasteHandler = null
    }
  } catch (err) {
    console.warn('Failed to remove editor paste handler', err)
  }
})

// choose a default model when chatConfig is empty
const ensureDefaultModel = async () => {
  if (chatStore.chatConfig.providerId && chatStore.chatConfig.modelId) return
  try {
    const preferred = (await configPresenter.getSetting('preferredModel')) as
      | { modelId: string; providerId: string }
      | undefined
    if (preferred) {
      const provider = settingsStore.enabledModels.find(
        (p) => p.providerId === preferred.providerId
      )
      const model = provider?.models.find((m) => m.id === preferred.modelId)
      if (provider && model) {
        chatStore.updateChatConfig({ modelId: model.id, providerId: provider.providerId })
        return
      }
    }
  } catch {}
  // fallback to first available chat or image model
  const first = settingsStore.enabledModels
    .flatMap((p) => p.models.map((m) => ({ ...m, providerId: p.providerId })))
    .find((m) => m.type === ModelType.Chat || m.type === ModelType.ImageGeneration)
  if (first) {
    chatStore.updateChatConfig({ modelId: first.id, providerId: first.providerId })
  }
}

watch(
  () => settingsStore.activeSearchEngine?.id,
  async () => {
    selectedSearchEngine.value = settingsStore.activeSearchEngine?.id ?? 'google'
  }
)

// initialize and keep active model in sync with current chat config
watch(
  () => [
    settingsStore.enabledModels,
    chatStore.chatConfig.providerId,
    chatStore.chatConfig.modelId
  ],
  () => {
    const providerId = chatStore.chatConfig.providerId
    const modelId = chatStore.chatConfig.modelId
    if (providerId && modelId) {
      const provider = settingsStore.enabledModels.find((p) => p.providerId === providerId)
      const model = provider?.models.find((m) => m.id === modelId)
      if (provider && model) {
        activeModel.value = {
          name: model.name,
          id: model.id,
          providerId: provider.providerId,
          tags: [],
          type: model.type ?? ModelType.Chat
        }
      }
    } else {
      ensureDefaultModel()
    }
  },
  { immediate: true, deep: true }
)

watch(
  () => chatStore.chatConfig.providerId,
  () => {
    loadRateLimitStatus()
    startRateLimitPolling()
  }
)

watch(
  () => settingsStore.providers,
  () => {
    loadRateLimitStatus()
    startRateLimitPolling()
  },
  { deep: true }
)

watch(
  () => chatStore.chatConfig.providerId,
  () => {
    loadRateLimitStatus()
  }
)

watch(
  () => selectedFiles.value,
  () => {
    mentionData.value = mentionData.value
      .filter((item) => item.type != 'item' || item.category != 'files')
      .concat(
        selectedFiles.value.map((file) => ({
          id: file.metadata.fileName,
          label: file.metadata.fileName,
          icon: file.mimeType?.startsWith('image/') ? 'lucide:image' : 'lucide:file',
          type: 'item',
          category: 'files'
        }))
      )
  },
  { deep: true }
)

watch(
  () => mcpStore.resources,
  () => {
    mentionData.value = mentionData.value
      .filter((item) => item.type != 'item' || item.category != 'resources')
      .concat(
        mcpStore.resources.map((resource) => ({
          id: `${resource.client.name}.${resource.name ?? ''}`,
          label: resource.name ?? '',
          icon: 'lucide:tag',
          type: 'item',
          category: 'resources',
          mcpEntry: resource
        }))
      )
  }
)

watch(
  () => mcpStore.tools,
  () => {
    mentionData.value = mentionData.value
      .filter((item) => item.type != 'item' || item.category != 'tools')
      .concat(
        mcpStore.tools.map((tool) => ({
          id: `${tool.server.name}.${tool.function.name ?? ''}`,
          label: `${tool.server.icons}${' '}${tool.function.name ?? ''}`,
          icon: undefined,
          type: 'item',
          category: 'tools',
          description: tool.function.description ?? ''
        }))
      )
  }
)

watch(
  () => mcpStore.prompts,
  () => {
    mentionData.value = mentionData.value
      .filter((item) => item.type != 'item' || item.category != 'prompts')
      .concat(
        mcpStore.prompts.map((prompt) => ({
          id: prompt.name,
          label: prompt.name,
          icon: undefined,
          type: 'item',
          category: 'prompts',
          mcpEntry: prompt
        }))
      )
  }
)

watch(dynamicPlaceholder, () => {
  updatePlaceholder()
})

watch(
  () => props.disabled,
  (newDisabled, oldDisabled) => {
    if (oldDisabled && !newDisabled) {
      setTimeout(() => {
        restoreFocus()
      }, 100)
    }
  }
)

defineExpose({
  clearContent: () => {
    inputText.value = ''
    editor.chain().clearContent().run()
    editor.view.updateState(editor.state)
  },
  appendText: (text: string) => {
    inputText.value += text
    nextTick(() => {
      editor.chain().insertContent(text).run()
      editor.view.updateState(editor.state)
      setTimeout(() => {
        const docSize = editor.state.doc.content.size
        editor.chain().focus().setTextSelection(docSize).run()
      }, 10)
    })
  },
  appendMention: async (name: string) => {
    try {
      const m = findMentionByName(name)
      if (!m) return false
      const insertPosition = editor.state.selection.anchor
      const ok = insertMentionToEditor(m, insertPosition)
      if (ok) await handlePostInsertActions(m)
      return ok
    } catch (error) {
      console.error('Failed to append mention:', error)
      return false
    }
  },
  restoreFocus
})

// mention helpers
const findMentionByName = (name: string): CategorizedData | null => {
  const foundMention = mentionData.value.find(
    (item) => item.type === 'item' && (item.label === name || item.id === name)
  )
  return foundMention || null
}
const insertMentionToEditor = (m: CategorizedData, position: number): boolean => {
  try {
    const mentionAttrs = {
      id: m.id,
      label: m.label,
      category: m.category,
      content: m.mcpEntry ? JSON.stringify(m.mcpEntry) : ''
    }
    const success = editor
      .chain()
      .focus()
      .setTextSelection(position)
      .insertContent({ type: 'mention', attrs: mentionAttrs })
      .insertContent(' ')
      .run()
    if (success) inputText.value = editor.getText()
    return success
  } catch (error) {
    console.error('Failed to insert mention to editor:', error)
    return false
  }
}
const handlePostInsertActions = async (m: CategorizedData): Promise<void> => {
  if (m.category === 'prompts' && m.mcpEntry) {
    const promptEntry = m.mcpEntry as PromptListEntry
    if (promptEntry.files && Array.isArray(promptEntry.files) && promptEntry.files.length > 0) {
      const handler = getPromptFilesHandler()
      if (handler) {
        await handler(promptEntry.files).catch((error) => {
          console.error('Failed to handle prompt files:', error)
        })
      }
    }
  }
}

// model select handlers
const handleModelUpdate = (model: MODEL_META, providerId: string) => {
  activeModel.value = {
    name: model.name,
    id: model.id,
    providerId,
    tags: [],
    type: model.type ?? ModelType.Chat
  }
  chatStore.updateChatConfig({ modelId: model.id, providerId })
  // remember preference for convenience
  configPresenter.setSetting('preferredModel', { modelId: model.id, providerId })
  modelSelectOpen.value = false
}
</script>

<style scoped>
/* Outer frame (input shell) */
.prompt-surface {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: 12px 16px 0 16px; /* match spec; bottom provided by bar */
  gap: 10px;
  min-height: 114px;
  box-sizing: border-box;
}

:global(.dark) .prompt-input-root .prompt-surface {
  background: #252525;
  border-style: solid;
  border-color: rgba(255, 255, 255, 0.1);
  border-width: 1px 0 1px 1px; /* top, bottom, left */
  border-top-width: 1px;
  border-top-color: rgba(255, 255, 255, 0.1);
  border-radius: 0 0 0 8px; /* bottom-left only */
}

/* Editor area typography */
.editor :deep([data-tiptap-editor]),
.editor :deep(.tiptap),
.editor :deep(.p-2.text-sm) {
  padding: 0 !important; /* padding comes from outer frame */
  font-size: 12px !important;
  line-height: 18px !important;
}
.editor :deep(.tiptap p.is-editor-empty:first-child::before) {
  font-size: 12px !important;
  line-height: 18px !important;
}

/* Text and placeholder tones (dark) */
:global(.dark) .editor :deep(.tiptap) {
  color: rgba(255, 255, 255, 0.85);
}
:global(.dark) .editor :deep(.tiptap p.is-editor-empty:first-child::before) {
  color: rgba(255, 255, 255, 0.5);
}

/* Bottom bar spacing */
.bottom-bar {
  padding: 0 0 8px 0; /* outer frame already has 16px sides */
}

/* Icon button sizes (file/search) */
.icon-btn,
.search-engine-select > button {
  width: 28px !important;
  height: 26px !important;
  padding: 4px 6px !important;
  border-radius: 6px !important;
}

/* Ensure search capsule aligns to 26px height and collapses cleanly */
.search-engine-select {
  height: 26px;
  gap: 0;
  display: inline-flex;
  align-items: center;
}

/* Remove borders on dark for controls */
:global(.dark) .prompt-input-root :deep(button[data-role='file-btn']) {
  background: transparent !important;
  border: none !important;
}
:global(.dark) .prompt-input-root :deep(.search-engine-select) {
  background: transparent !important;
  border: none !important;
}

/* Send button size */
.send-btn {
  width: 40px !important;
  height: 24px !important;
  padding: 4px 12px !important;
  border-radius: 6px !important;
}
:global(.dark) .model-chip {
  border: 1px solid rgba(255, 255, 255, 0.05) !important;
}
:global(.dark) .send-btn {
  background: #0088ff !important;
  color: #fff !important;
  border: none !important;
}
:global(.dark) .send-btn:disabled {
  background: rgba(0, 136, 255, 0.6) !important;
  color: rgba(255, 255, 255, 0.85) !important;
}

/* Drag overlay */
.drag-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 0;
}

/* Smooth transitions for file list */
.file-list-enter-active,
.file-list-leave-active {
  transition: all 0.2s ease;
}
</style>
<style>
.tiptap p.is-editor-empty:first-child::before {
  @apply text-muted-foreground;
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}
</style>
