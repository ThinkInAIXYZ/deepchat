<template>
  <div
    class="w-full max-w-4xl mx-auto"
    @dragenter.prevent="handleDragEnter"
    @dragover.prevent="handleDragOver"
    @drop.prevent="handleDrop"
    @dragleave.prevent="handleDragLeave"
    @paste="handlePaste"
  >
    <TooltipProvider>
      <div
        :dir="langStore.dir"
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
              :thumbnail="file.thumbnail"
              :context="'input'"
              @click="previewFile(file.path)"
              @delete="deleteFile(idx)"
            />
          </TransitionGroup>
        </div>
        <!-- {{ t('chat.input.inputArea') }} -->
        <editor-content :editor="editor" class="p-2 text-sm" @keydown="onKeydown" />

        <div class="flex items-center justify-between">
          <!-- {{ t('chat.input.functionSwitch') }} -->
          <div class="flex gap-1.5">
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="outline"
                  size="icon"
                  class="w-7 h-7 text-xs rounded-lg"
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
                  class="search-engine-select overflow-hidden flex items-center h-7 rounded-lg shadow-sm border border-input transition-all duration-300"
                  :class="{
                    'border-primary': settings.webSearch
                  }"
                  :dir="langStore.dir"
                >
                  <Button
                    variant="outline"
                    :class="[
                      'flex w-7 border-none rounded-none shadow-none items-center gap-1.5 px-2 h-full',
                      settings.webSearch
                        ? 'dark:!bg-primary bg-primary border-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
                        : ''
                    ]"
                    :dir="langStore.dir"
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
              <span v-else-if="!canSendImmediately">
                {{ formatWaitTime() }}
              </span>
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
import FileItem from './FileItem.vue'
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
import McpToolsList from './mcpToolsList.vue'
import { useEventListener } from '@vueuse/core'
import { calculateImageTokens, getClipboardImageInfo, imageFileToBase64 } from '@/lib/image'
import { RATE_LIMIT_EVENTS } from '@/events'
import { Editor, EditorContent, JSONContent } from '@tiptap/vue-3'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { Mention } from './editor/mention/mention'
import suggestion, {
  mentionData,
  setPromptFilesHandler,
  getPromptFilesHandler
} from './editor/mention/suggestion'
import { mentionSelected } from './editor/mention/suggestion'
import Placeholder from '@tiptap/extension-placeholder'
import HardBreak from '@tiptap/extension-hard-break'
// import CodeBlock from '@tiptap/extension-code-block'
import History from '@tiptap/extension-history'
import { useMcpStore } from '@/stores/mcp'
import { ResourceListEntry } from '@shared/presenter'
import { searchHistory } from '@/lib/searchHistory'
import { useLanguageStore } from '@/stores/language'
import { useToast } from '@/components/ui/toast/use-toast'
import type { CategorizedData } from './editor/mention/suggestion'
import type { PromptListEntry } from '@shared/presenter'
import { sanitizeText } from '@/lib/sanitizeText'

const langStore = useLanguageStore()
const mcpStore = useMcpStore()
const { toast } = useToast()
const { t } = useI18n()
searchHistory.resetIndex()

// 历史记录placeholder相关变量需要在editor初始化之前定义
const currentHistoryPlaceholder = ref('')
const showHistoryPlaceholder = ref(false)

// 计算动态placeholder
const dynamicPlaceholder = computed(() => {
  if (currentHistoryPlaceholder.value) {
    // 当有历史记录时，只显示历史记录内容和提示
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
    Placeholder.configure({
      placeholder: () => {
        return dynamicPlaceholder.value
      }
    }),
    HardBreak.extend({
      addKeyboardShortcuts() {
        return {
          'Shift-Enter': () => {
            return this.editor.chain().setHardBreak().scrollIntoView().run()
          },
          'Alt-Enter': () => {
            return this.editor.chain().setHardBreak().scrollIntoView().run()
          }
        }
      }
    }).configure({
      keepMarks: true,
      HTMLAttributes: {
        class: 'line-break'
      }
    })
    // CodeBlock.extend({
    //   addStorage() {
    //     return {
    //       lastShiftEnterTime: 0
    //     }
    //   },
    //   addKeyboardShortcuts() {
    //     return {
    //       'Shift-Enter': () => {
    //         if (this.editor.isActive('codeBlock')) {
    //           const now = Date.now()
    //           const timeDiff = now - this.storage.lastShiftEnterTime

    //           // If Shift+Enter was pressed within 800ms, exit the code block
    //           if (timeDiff < 800) {
    //             this.editor.commands.exitCode()
    //             this.storage.lastShiftEnterTime = 0
    //             return true
    //           }

    //           // Otherwise, insert a newline and record the time
    //           this.editor.commands.insertContent('\n')
    //           this.storage.lastShiftEnterTime = now
    //           return true
    //         }
    //         return false
    //       }
    //     }
    //   }
    // }).configure({
    //   HTMLAttributes: {
    //     class: 'rounded-md bg-secondary dark:bg-zinc-800 p-2'
    //   }
    // })
  ],
  onUpdate: ({ editor }) => {
    inputText.value = editor.getText()

    // 如果用户开始输入且有历史记录placeholder，清除它
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

const isDragging = ref(false)
const dragCounter = ref(0)
let dragLeaveTimer: number | null = null

const selectedFiles = ref<MessageFile[]>([])

// capture-phase paste handler attached to the editor DOM
let editorPasteHandler: ((e: ClipboardEvent) => void) | null = null

const rateLimitStatus = ref<{
  config: { enabled: boolean; qpsLimit: number }
  currentQps: number
  queueLength: number
  lastRequestTime: number
} | null>(null)

const props = withDefaults(
  defineProps<{
    contextLength?: number
    maxRows?: number
    rows?: number
    disabled?: boolean
  }>(),
  {
    maxRows: 10,
    rows: 1,
    disabled: false
  }
)

const currentContextLengthText = computed(() => {
  return `${Math.round((currentContextLength.value / (props.contextLength ?? 1000)) * 100)}%`
})

const canSendImmediately = computed(() => {
  if (!rateLimitStatus.value?.config.enabled) return true

  const now = Date.now()
  const intervalMs = (1 / rateLimitStatus.value.config.qpsLimit) * 1000
  const timeSinceLastRequest = now - rateLimitStatus.value.lastRequestTime

  return timeSinceLastRequest >= intervalMs
})

const getRateLimitStatusIcon = () => {
  if (!rateLimitStatus.value?.config.enabled) return ''

  if (rateLimitStatus.value.queueLength > 0) {
    return 'lucide:clock'
  }

  return canSendImmediately.value ? 'lucide:check-circle' : 'lucide:timer'
}

const getRateLimitStatusClass = () => {
  if (!rateLimitStatus.value?.config.enabled) return ''

  if (rateLimitStatus.value.queueLength > 0) {
    return 'text-orange-500'
  }

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

const openFilePicker = () => {
  fileInput.value?.click()
}

const previewFile = (filePath: string) => {
  windowPresenter.previewFile(filePath)
}

const handlePaste = async (e: ClipboardEvent) => {
  // Avoid double-processing when we already handled the event in the
  // capture-phase editor listener.
  if ((e as any)?._deepchatHandled) return

  const files = e.clipboardData?.files
  if (files && files.length > 0) {
    for (const file of files) {
      try {
        if (file.type.startsWith('image/')) {
          // 处理图片文件
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
              // fileHash: string
              fileDescription: file.type,
              fileCreated: new Date(),
              fileModified: new Date()
            },
            token: calculateImageTokens(imageInfo.width, imageInfo.height),
            path: tempFilePath,
            thumbnail: imageInfo.compressedBase64 // 添加缩略图
          }
          if (fileInfo) {
            selectedFiles.value.push(fileInfo)
          }
        } else {
          // 处理其他类型的文件
          const path = window.api.getPathForFile(file)
          const mimeType = await filePresenter.getMimeType(path)
          const fileInfo: MessageFile = await filePresenter.prepareFile(path, mimeType)
          if (fileInfo) {
            selectedFiles.value.push(fileInfo)
          } else {
            console.error('File info is null:', file.name)
          }
        }
      } catch (error) {
        console.error('文件处理失败:', error)
        // 继续处理其他文件，不要中断整个流程
      }
    }
    if (selectedFiles.value.length > 0) {
      emit('file-upload', selectedFiles.value)
    }
  }
}

const handleFileSelect = async (e: Event) => {
  const files = (e.target as HTMLInputElement).files

  if (files && files.length > 0) {
    for (const file of files) {
      const path = window.api.getPathForFile(file)
      try {
        const mimeType = await filePresenter.getMimeType(path)
        const fileInfo: MessageFile = await filePresenter.prepareFile(path, mimeType)
        if (fileInfo) {
          selectedFiles.value.push(fileInfo)
        } else {
          console.error('File info is null:', file.name)
        }
      } catch (error) {
        console.error('文件准备失败:', error)
        // Don't return here, continue processing other files
      }
    }
    if (selectedFiles.value.length > 0) {
      emit('file-upload', selectedFiles.value)
    }
  }
  // Reset the input
  if (e.target) {
    ;(e.target as HTMLInputElement).value = ''
  }
}

const tiptapJSONtoMessageBlock = async (docJSON: JSONContent) => {
  const blocks: (UserMessageMentionBlock | UserMessageTextBlock | UserMessageCodeBlock)[] = []
  if (docJSON.type === 'doc') {
    for (const [idx, block] of (docJSON.content ?? []).entries()) {
      if (block.type === 'paragraph') {
        // console.log(block)
        for (const [index, subBlock] of (block.content ?? []).entries()) {
          if (subBlock.type === 'text') {
            blocks.push({
              type: 'text',
              content: subBlock.text ?? ''
            })
          } else if (subBlock.type === 'hardBreak') {
            if (index > 0 && block.content?.[index - 1]?.type === 'text') {
              blocks[blocks.length - 1].content += '\n'
            } else {
              blocks.push({
                type: 'text',
                content: '\n'
              })
            }
          } else if (subBlock.type === 'mention') {
            let content = subBlock.attrs?.label ?? ''
            try {
              if (subBlock.attrs?.category === 'resources' && subBlock.attrs?.content) {
                fetchingMcpEntry.value = true
                // console.log(subBlock.attrs?.content)
                const mcpEntry = JSON.parse(subBlock.attrs?.content) as ResourceListEntry

                const mcpEntryResult = await mcpStore.readResource(mcpEntry)

                if (mcpEntryResult.blob) {
                  // Convert blob to ArrayBuffer
                  const arrayBuffer = await new Blob([mcpEntryResult.blob], {
                    type: mcpEntryResult.mimeType
                  }).arrayBuffer()
                  // Write the blob content to a temporary file
                  const tempFilePath = await filePresenter.writeTemp({
                    name: mcpEntry.name ?? 'temp_resource', // Use resource name or a default
                    content: arrayBuffer
                  })
                  const mimeType = await filePresenter.getMimeType(tempFilePath)
                  const fileInfo: MessageFile = await filePresenter.prepareFile(
                    tempFilePath,
                    mimeType
                  )
                  if (fileInfo) {
                    selectedFiles.value.push(fileInfo)
                  }
                  console.log('MCP resource saved to temp file:', tempFilePath)
                  content = mcpEntry.name ?? 'temp_resource' // Placeholder content for the mention
                } else {
                  content = mcpEntryResult.text ?? ''
                }

                // console.log('fix ', mcpEntryResult)
              }
            } catch (error) {
              console.error('读取资源失败:', error)
            } finally {
              fetchingMcpEntry.value = false
            }

            if (subBlock.attrs?.category === 'prompts') {
              fetchingMcpEntry.value = true // Mimicking resource style
              try {
                const promptAttrContent = subBlock.attrs?.content as string
                if (promptAttrContent) {
                  // Assuming promptAttrContent is JSON.stringify(originalPromptObjectFromStore)
                  // And originalPromptObjectFromStore has a field 'content' with base64 data.
                  const promptObject = JSON.parse(promptAttrContent)
                  const prompResult = await mcpStore.getPrompt(
                    promptObject,
                    promptObject.argumentsValue
                  )
                  content = JSON.stringify(prompResult)
                } else {
                  console.warn('Prompt mention is missing "content" attribute.')
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
        console.log('push code block', block)
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
    console.log(JSON.stringify(blocks), JSON.stringify(messageContent.content))

    emit('send', messageContent)
    inputText.value = ''
    editor.chain().clearContent().run()

    // 清除历史记录placeholder
    clearHistoryPlaceholder()

    // 清理已上传的文件
    if (selectedFiles.value.length > 0) {
      // 清空文件列表
      selectedFiles.value = []
      // 重置文件输入控件
      if (fileInput.value) {
        fileInput.value.value = ''
      }
    }
    nextTick(() => {
      editor.commands.focus()
    })
  }
}

const deleteFile = (idx: number) => {
  selectedFiles.value.splice(idx, 1)
  if (fileInput.value) {
    fileInput.value.value = ''
  }
}

// 处理来自 Prompt 的文件
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
      // 检查文件是否已存在（基于文件名去重）
      const exists = selectedFiles.value.some((f) => f.name === fileItem.name)
      if (exists) {
        continue
      }

      // 转换 FileItem -> MessageFile
      const messageFile: MessageFile = {
        name: fileItem.name,
        content: fileItem.content || '', // 如果没有内容，尝试从路径读取
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

      // 如果没有内容但有路径，尝试读取文件
      if (!messageFile.content && fileItem.path) {
        try {
          const fileContent = await filePresenter.readFile(fileItem.path)
          messageFile.content = fileContent
          messageFile.token = approximateTokenSize(fileContent)
        } catch (error) {
          console.warn(`Failed to read file content: ${fileItem.path}`, error)
          // 如果读取失败，仍然添加文件但内容为空
        }
      }

      selectedFiles.value.push(messageFile)
      addedCount++
    } catch (error) {
      console.error('Failed to process prompt file:', fileItem, error)
      errorCount++
    }
  }

  // 显示结果反馈
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
  // If a mention was just selected, don't do anything
  if (mentionSelected.value) {
    return
  }

  // Only handle enter if there's no active suggestion popup
  const hasMentionSuggestion = editor.isActive('mention') || document.querySelector('.tippy-box')
  if (hasMentionSuggestion) {
    // Don't prevent default - let the mention suggestion handle it
    return
  }

  // For normal enter behavior (no mention suggestion active)
  e.preventDefault()

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
        if (file.type === '') {
          const isDirectory = await filePresenter.isDirectory(path)
          if (isDirectory) {
            const fileInfo: MessageFile = await filePresenter.prepareDirectory(path)
            if (fileInfo) {
              selectedFiles.value.push(fileInfo)
            }
          } else {
            const mimeType = await filePresenter.getMimeType(path)
            console.log('mimeType', mimeType)
            const fileInfo: MessageFile = await filePresenter.prepareFile(path, mimeType)
            console.log('fileInfo', fileInfo)
            if (fileInfo) {
              selectedFiles.value.push(fileInfo)
            }
          }
        } else {
          const mimeType = await filePresenter.getMimeType(path)
          const fileInfo: MessageFile = await filePresenter.prepareFile(path, mimeType)
          if (fileInfo) {
            selectedFiles.value.push(fileInfo)
          }
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

const loadRateLimitStatus = async () => {
  const currentProviderId = chatStore.chatConfig.providerId
  if (currentProviderId) {
    if (!isRateLimitEnabled()) {
      rateLimitStatus.value = null
      return
    }

    try {
      const status = await llmPresenter.getProviderRateLimitStatus(currentProviderId)
      rateLimitStatus.value = status
    } catch (error) {
      console.error('Failed to load rate limit status:', error)
    }
  }
}

const isRateLimitEnabled = () => {
  const currentProviderId = chatStore.chatConfig.providerId
  if (!currentProviderId) return false

  const provider = settingsStore.providers.find((p) => p.id === currentProviderId)
  return provider?.rateLimit?.enabled ?? false
}

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

let statusInterval: ReturnType<typeof setInterval> | null = null

const startRateLimitPolling = () => {
  if (statusInterval) {
    clearInterval(statusInterval)
  }
  if (isRateLimitEnabled()) {
    statusInterval = setInterval(loadRateLimitStatus, 1000)
  }
}

const stopRateLimitPolling = () => {
  if (statusInterval) {
    clearInterval(statusInterval)
    statusInterval = null
  }
}

onMounted(() => {
  initSettings()

  setPromptFilesHandler(handlePromptFiles)

  loadRateLimitStatus()

  const searchElement = document.querySelector('.search-engine-select')
  if (searchElement) {
    useEventListener(searchElement, 'mouseenter', handleSearchMouseEnter)
    useEventListener(searchElement, 'mouseleave', handleSearchMouseLeave)
  }

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

  // 只有在速率限制启用时才开始轮询
  startRateLimitPolling()

  // Attach a capture-phase paste listener directly to the editor DOM so we
  // can sanitize/handle clipboard data before TipTap inserts it.
  try {
    if (editor && editor.view && editor.view.dom) {
      editorPasteHandler = (e: ClipboardEvent) => {
        try {
          // mark event to avoid double-processing
          ;(e as any)._deepchatHandled = true

          const files = e.clipboardData?.files
          if (files && files.length > 0) {
            // Prevent TipTap from treating files as plain text
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

            // Replace current selection (or insert at cursor) with sanitized text
            editor.commands.insertContentAt({ from, to }, clean, { updateSelection: true })
            // keep the reactive inputText in sync
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

onUnmounted(() => {
  stopRateLimitPolling()
  window.electron.ipcRenderer.removeAllListeners(RATE_LIMIT_EVENTS.CONFIG_UPDATED)
  window.electron.ipcRenderer.removeAllListeners(RATE_LIMIT_EVENTS.REQUEST_EXECUTED)
  window.electron.ipcRenderer.removeAllListeners(RATE_LIMIT_EVENTS.REQUEST_QUEUED)

  // Remove capture-phase paste listener
  try {
    if (editorPasteHandler && editor && editor.view && editor.view.dom) {
      editor.view.dom.removeEventListener('paste', editorPasteHandler as EventListener, true)
      editorPasteHandler = null
    }
  } catch (err) {
    console.warn('Failed to remove editor paste handler', err)
  }
})

watch(
  () => settingsStore.activeSearchEngine?.id,
  async () => {
    selectedSearchEngine.value = settingsStore.activeSearchEngine?.id ?? 'google'
  }
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

// 监听 dynamicPlaceholder 变化并更新编辑器
watch(dynamicPlaceholder, () => {
  // 强制更新 TipTap 的 placeholder 显示
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

// 处理历史记录placeholder
const setHistoryPlaceholder = (text: string) => {
  currentHistoryPlaceholder.value = text
  showHistoryPlaceholder.value = true

  // 强制更新 TipTap 的 placeholder
  updatePlaceholder()
}

const clearHistoryPlaceholder = () => {
  currentHistoryPlaceholder.value = ''
  showHistoryPlaceholder.value = false

  // 强制更新 TipTap 的 placeholder
  updatePlaceholder()

  // 重置搜索历史索引
  searchHistory.resetIndex()
}

// 强制更新 TipTap 编辑器的 placeholder
const updatePlaceholder = () => {
  // 使用 nextTick 确保 Vue 的响应式更新完成后再更新编辑器
  nextTick(() => {
    // 强制重新渲染编辑器视图
    const { state } = editor
    editor.view.updateState(state)
  })
}

function onKeydown(e: KeyboardEvent) {
  if (e.code === 'Enter' && !e.shiftKey) {
    // 阻止默认行为，避免换行
    handleEditorEnter(e)
    e.preventDefault()
  }

  // 历史记录功能：只在输入框为空时生效
  const currentContent = editor.getText().trim()

  if (e.code === 'ArrowUp' && !currentContent) {
    const previousSearch = searchHistory.getPrevious()
    if (previousSearch !== null) {
      setHistoryPlaceholder(previousSearch)
    }
    e.preventDefault()
  } else if (e.code === 'ArrowDown' && !currentContent) {
    const nextSearch = searchHistory.getNext()
    if (nextSearch !== null) {
      setHistoryPlaceholder(nextSearch)
    }
    e.preventDefault()
  } else if (e.code === 'Tab' && currentHistoryPlaceholder.value) {
    // Tab 键确认填充历史记录
    e.preventDefault()
    editor.commands.setContent(currentHistoryPlaceholder.value)
    clearHistoryPlaceholder()
  } else if (e.code === 'Escape' && currentHistoryPlaceholder.value) {
    // Escape 键取消历史记录placeholder
    e.preventDefault()
    clearHistoryPlaceholder()
  } else if (currentHistoryPlaceholder.value && e.key.length === 1) {
    // 如果有历史记录placeholder且用户开始输入，清除placeholder
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
        }
      } catch (error) {
        console.warn('恢复焦点时出错:', error)
      }
    }
  })
}

// 通过名称查找mention数据
const findMentionByName = (name: string): CategorizedData | null => {
  // 在当前的mentionData中查找匹配的项目
  const foundMention = mentionData.value.find(
    (item) => item.type === 'item' && (item.label === name || item.id === name)
  )

  return foundMention || null
}

// 简化的插入mention到编辑器
const insertMentionToEditor = (mentionData: CategorizedData, position: number): boolean => {
  try {
    // 构建mention节点属性
    const mentionAttrs = {
      id: mentionData.id,
      label: mentionData.label,
      category: mentionData.category,
      content: mentionData.mcpEntry ? JSON.stringify(mentionData.mcpEntry) : ''
    }

    // 使用TipTap命令插入mention
    const success = editor
      .chain()
      .focus()
      .setTextSelection(position)
      .insertContent({
        type: 'mention',
        attrs: mentionAttrs
      })
      .insertContent(' ') // 默认添加空格
      .run()

    // 更新内部状态
    if (success) {
      inputText.value = editor.getText()
    }

    return success
  } catch (error) {
    console.error('Failed to insert mention to editor:', error)
    return false
  }
}
const handlePostInsertActions = async (mentionData: CategorizedData): Promise<void> => {
  // 处理Prompt类型的特殊逻辑
  if (mentionData.category === 'prompts' && mentionData.mcpEntry) {
    const promptEntry = mentionData.mcpEntry as PromptListEntry

    // 处理关联文件
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
      // 通过name在各个数据源中查找匹配的mention
      const mentionData = findMentionByName(name)

      if (!mentionData) {
        console.warn(`Mention not found: ${name}`)
        return false
      }

      // 计算插入位置（默认为光标位置）
      const insertPosition = editor.state.selection.anchor

      // 执行TipTap插入操作
      const insertSuccess = insertMentionToEditor(mentionData, insertPosition)

      // 处理后续操作（如文件关联、参数处理等）
      if (insertSuccess) {
        await handlePostInsertActions(mentionData)
      }

      return insertSuccess
    } catch (error) {
      console.error('Failed to append mention:', error)
      return false
    }
  },
  restoreFocus
})
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
<style>
.tiptap p.is-editor-empty:first-child::before {
  @apply text-muted-foreground;
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}
</style>
