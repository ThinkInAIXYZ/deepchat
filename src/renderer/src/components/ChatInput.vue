<template>
  <div
    class="w-full max-w-5xl mx-auto"
    @dragenter.prevent="handleDragEnterEvent"
    @dragover.prevent="handleDragOverEvent"
    @drop.prevent="handleDropEvent"
    @dragleave.prevent="handleDragLeaveEvent"
    @paste="handlePasteEvent"
  >
    <TooltipProvider>
      <div
        class="bg-card border border-border rounded-lg focus-within:border-primary p-2 flex flex-col gap-2 shadow-sm relative"
      >
                <div v-if="attachedFiles.length > 0">
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
              v-for="(file, index) in attachedFiles"
              :key="file.metadata.fileName"
              :file-name="file.metadata.fileName"
              :deletable="true"
              :mime-type="file.mimeType"
              :tokens="file.token"
              :thumbnail="file.thumbnail"
              @click="previewSelectedFile(file.path)"
              @delete="removeFile(index)"
            />
          </TransitionGroup>
        </div>
                <editor-content
          :editor="editorInstance"
          class="p-2 text-sm"
          @keydown.enter.exact="handleEditorEnterKey"
        />

        <div class="flex items-center justify-between">
                    <div class="flex gap-1.5">
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="outline"
                  size="icon"
                  class="w-7 h-7 text-xs rounded-lg text-muted-foreground"
                  @click="triggerFilePicker"
                >
                  <Icon icon="lucide:paperclip" class="w-4 h-4" />
                  <input
                    ref="hiddenFileInput"
                    type="file"
                    class="hidden"
                    multiple
                    accept="application/json,application/javascript,text/plain,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet,application/vnd.ms-excel.sheet.binary.macroEnabled.12,application/apple.numbers,text/markdown,application/x-yaml,application/xml,application/typescript,text/typescript,text/x-typescript,application/x-typescript,application/x-sh,text/*,application/pdf,image/jpeg,image/jpg,image/png,image/gif,image/webp,image/bmp,image/*,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/html,text/css,application/xhtml+xml,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.cs,.go,.rb,.php,.rs,.swift,.kt,.scala,.pl,.lua,.sh,.json,.yaml,.yml,.xml,.html,.htm,.css,.md,audio/mp3,audio/wav,audio/mp4,audio/mpeg,.mp3,.wav,.m4a"
                    @change="handleFileSelection"
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{{ t('chat.input.fileSelect') }}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger>
                <span
                  class="search-engine-select overflow-hidden flex items-center h-7 rounded-lg shadow-sm border border-border transition-all duration-300"
                  :class="{
                    'border-primary': appSettings.webSearch
                  }"
                  @mouseenter="handleSearchMouseEnter"
                  @mouseleave="handleSearchMouseLeave"
                >
                  <Button
                    variant="outline"
                    :class="[
                      'flex w-7 border-none rounded-none shadow-none items-center gap-1.5 px-2 h-full',
                      appSettings.webSearch
                        ? 'dark:!bg-primary bg-primary border-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground'
                        : 'text-muted-foreground'
                    ]"
                    size="icon"
                    @click="toggleWebSearch"
                  >
                    <Icon icon="lucide:globe" class="w-4 h-4" />
                  </Button>
                  <Select
                    v-model="activeSearchEngineId"
                    @update:model-value="updateSearchEngine"
                    @update:open="handleSelectDropdownOpen"
                  >
                    <SelectTrigger
                      class="h-full rounded-none border-none shadow-none hover:bg-accent text-muted-foreground dark:hover:text-primary-foreground transition-all duration-300"
                      :class="{
                        'w-0 opacity-0 p-0 overflow-hidden':
                          !displaySearchSettings && !isSearchHovered && !isSelectDropdownOpen,
                        'w-24 max-w-28 px-2 opacity-100':
                          displaySearchSettings || isSearchHovered || isSelectDropdownOpen
                      }"
                    >
                      <div class="flex items-center gap-1">
                        <SelectValue class="text-xs font-bold truncate" />
                      </div>
                    </SelectTrigger>
                    <SelectContent align="start" class="w-64">
                      <SelectItem
                        v-for="engine in availableSearchEngines"
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
                        <slot name="addon-buttons"></slot>
          </div>
          <div class="flex items-center gap-2">
            <div
              v-if="
                maxContextLength &&
                maxContextLength > 0 &&
                currentContextTokens / (maxContextLength ?? 1000) > 0.5
              "
              class="text-xs text-muted-foreground"
              :class="[
                currentContextTokens / (maxContextLength ?? 1000) > 0.9 ? ' text-red-600' : '',
                currentContextTokens / (maxContextLength ?? 1000) > 0.8
                  ? ' text-yellow-600'
                  : 'text-muted-foreground'
              ]"
            >
              {{ contextTokenPercentage }}
            </div>
            <Button
              variant="default"
              size="icon"
              class="w-7 h-7 text-xs rounded-lg"
              :disabled="isSendButtonDisabled"
              @click="handleSendMessage"
            >
              <Icon icon="lucide:arrow-up" class="w-4 h-4" />
            </Button>
          </div>
        </div>
        <div v-if="showDraggingOverlay" class="absolute inset-0 bg-black/40 rounded-lg">
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
import { computed, onMounted, ref, watch } from 'vue'
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
import { Editor, EditorContent, JSONContent } from '@tiptap/vue-3'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { Mention } from './editor/mention/mention'
import suggestion, { mentionSelected } from './editor/mention/suggestion'
import Placeholder from '@tiptap/extension-placeholder'
import HardBreak from '@tiptap/extension-hard-break'
import { useMcpStore } from '@/stores/mcp'
import { ResourceListEntryWithClient } from '@shared/presenter'
const mcpStore = useMcpStore()
const { t } = useI18n()
const editorInstance = new Editor({
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
    Mention.configure({
      HTMLAttributes: {
        class:
          'mention px-1.5 py-0.5 text-xs rounded-md bg-secondary text-foreground inline-block max-w-64 align-sub !truncate'
      },
      suggestion
    }),
    Placeholder.configure({
      placeholder: () => t('chat.input.placeholder')
    }),
    HardBreak.extend({
      addKeyboardShortcuts() {
        return {
          'Shift-Enter': () => this.editor.commands.setHardBreak()
        }
      }
    }).configure({
      keepMarks: true,
      HTMLAttributes: {
        class: 'line-break'
      }
    })
  ],
  onUpdate: ({ editor }) => {
    currentInputText.value = editor.getText()
  }
})

const configPresenter = usePresenter('configPresenter')
const chatStore = useChatStore()
const settingsStore = useSettingsStore()
const currentInputText = ref('')
const isFetchingMcpEntry = ref(false)
const hiddenFileInput = ref<HTMLInputElement>()
const filePresenter = usePresenter('filePresenter')
const windowPresenter = usePresenter('windowPresenter')
const appSettings = ref({
  deepThinking: false,
  webSearch: false
})
const activeSearchEngineId = ref('')
const availableSearchEngines = computed(() => settingsStore.searchEngines)
const currentContextTokens = computed(() => {
  return (
    approximateTokenSize(currentInputText.value) +
    attachedFiles.value.reduce((acc, file) => {
      return acc + file.token
    }, 0)
  )
})

const showDraggingOverlay = ref(false)
const dragEventCounter = ref(0)
let dragLeaveTimeoutId: number | null = null

const attachedFiles = ref<MessageFile[]>([])
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

const maxContextLength = computed(() => props.contextLength ?? chatStore.chatConfig.contextLength)

const contextTokenPercentage = computed(() => {
  return `${Math.round((currentContextTokens.value / (maxContextLength.value ?? 1000)) * 100)}%`
})

const emit = defineEmits(['send', 'file-upload'])

const triggerFilePicker = () => {
  hiddenFileInput.value?.click()
}

const previewSelectedFile = (filePath: string) => {
  windowPresenter.previewFile(filePath)
}

const handlePasteEvent = async (e: ClipboardEvent) => {
  const files = e.clipboardData?.files
  if (files && files.length > 0) {
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const base64 = (await imageFileToBase64(file)) as string
        const imageInfo = await getClipboardImageInfo(file)

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
          path: ''
        }
        if (fileInfo) {
          attachedFiles.value.push(fileInfo)
        }
      }
    }
    if (attachedFiles.value.length > 0) {
      emit('file-upload', attachedFiles.value)
    }
  }
}

const handleFileSelection = async (e: Event) => {
  const files = (e.target as HTMLInputElement).files

  if (files && files.length > 0) {
    for (const file of files) {
      const path = window.api.getPathForFile(file)
      try {
        const mimeType = await filePresenter.getMimeType(path)
        const fileInfo: MessageFile = await filePresenter.prepareFile(path, mimeType)
        if (fileInfo) {
          attachedFiles.value.push(fileInfo)
        } else {
          console.error('File info is null:', file.name)
        }
      } catch (error) {
        console.error('文件准备失败:', error)
        // Don't return here, continue processing other files
      }
    }
    if (attachedFiles.value.length > 0) {
      emit('file-upload', attachedFiles.value)
    }
  }
  // Reset the input
  if (e.target) {
    ;(e.target as HTMLInputElement).value = ''
  }
}

const parseEditorContentToBlocks = async (docJSON: JSONContent) => {
  const blocks: (UserMessageMentionBlock | UserMessageTextBlock)[] = []
  if (docJSON.type === 'doc') {
    for (const [idx, block] of (docJSON.content ?? []).entries()) {
      if (block.type === 'paragraph') {
        for (const subBlock of block.content ?? []) {
          if (subBlock.type === 'text') {
            blocks.push({
              type: 'text',
              content: subBlock.text ?? ''
            })
          } else if (subBlock.type === 'mention') {
            let content = subBlock.attrs?.label ?? ''
            try {
              if (subBlock.attrs?.category === 'resources' && subBlock.attrs?.content) {
                isFetchingMcpEntry.value = true
                console.log(subBlock.attrs?.content)
                const mcpEntry = JSON.parse(subBlock.attrs?.content) as ResourceListEntryWithClient
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
                    attachedFiles.value.push(fileInfo)
                  }
                  console.log('MCP resource saved to temp file:', tempFilePath)
                  content = mcpEntry.name ?? 'temp_resource' // Placeholder content for the mention
                } else {
                  content = mcpEntryResult.text ?? ''
                }

                console.log('fix ', mcpEntryResult)
              }
            } catch (error) {
              console.error('读取资源失败:', error)
            } finally {
              isFetchingMcpEntry.value = false
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
      }
    }
  }
  return blocks
}

const handleSendMessage = async () => {
  if (currentInputText.value.trim()) {
    const blocks = await parseEditorContentToBlocks(editorInstance.getJSON())
    const messageContent: UserMessageContent = {
      text: currentInputText.value.trim(),
      files: attachedFiles.value,
      links: [],
      search: appSettings.value.webSearch,
      think: appSettings.value.deepThinking,
      content: blocks
    }
    // console.log(messageContent)

    emit('send', messageContent)
    currentInputText.value = ''
    editorInstance.chain().clearContent().blur().run()

    // 清理已上传的文件
    if (attachedFiles.value.length > 0) {
      // 清空文件列表
      attachedFiles.value = []
      // 重置文件输入控件
      if (hiddenFileInput.value) {
        hiddenFileInput.value.value = ''
      }
    }
  }
}

const removeFile = (index: number) => {
  attachedFiles.value.splice(index, 1)
  if (hiddenFileInput.value) {
    hiddenFileInput.value.value = ''
  }
}

const isSendButtonDisabled = computed(() => {
  return (
    chatStore.generatingThreadIds.has(chatStore.activeThreadId ?? '') ||
    currentInputText.value.length <= 0 ||
    currentContextTokens.value > (maxContextLength.value ?? 0)
  )
})

const handleEditorEnterKey = (e: KeyboardEvent) => {
  // If a mention was just selected, don't do anything
  if (mentionSelected.value) {
    return
  }

  // Only handle enter if there's no active suggestion popup
  if (editorInstance.isActive('mention') || document.querySelector('.tippy-box')) {
    // Don't prevent default - let the mention suggestion handle it
    return
  }

  // For normal enter behavior (no mention suggestion active)
  e.preventDefault()

  if (isSendButtonDisabled.value) {
    return
  }

  if (!e.isComposing) {
    handleSendMessage()
  }
}

const toggleWebSearch = async () => {
  appSettings.value.webSearch = !appSettings.value.webSearch
  await configPresenter.setSetting('input_webSearch', appSettings.value.webSearch)
}

// const onDeepThinkingClick = async () => {
//   appSettings.value.deepThinking = !appSettings.value.deepThinking
//   await configPresenter.setSetting('input_deepThinking', appSettings.value.deepThinking)
// }

const updateSearchEngine = async (engineName: string) => {
  await settingsStore.setSearchEngine(engineName)
}

const initializeSettings = async () => {
  appSettings.value.deepThinking = Boolean(await configPresenter.getSetting('input_deepThinking'))
  appSettings.value.webSearch = Boolean(await configPresenter.getSetting('input_webSearch'))
  activeSearchEngineId.value = settingsStore.activeSearchEngine?.id ?? 'google'
}

const handleDragEnterEvent = (e: DragEvent) => {
  dragEventCounter.value++
  showDraggingOverlay.value = true

  // 确保目标是文件
  if (e.dataTransfer?.types.includes('Files')) {
    showDraggingOverlay.value = true
  }
}

const handleDragOverEvent = () => {
  // 防止默认行为并保持拖拽状态
  if (dragLeaveTimeoutId) {
    clearTimeout(dragLeaveTimeoutId)
    dragLeaveTimeoutId = null
  }
}

const handleDragLeaveEvent = () => {
  dragEventCounter.value--

  // 只有当计数器归零时才隐藏拖拽状态，并添加小延迟防止闪烁
  if (dragEventCounter.value <= 0) {
    if (dragLeaveTimeoutId) clearTimeout(dragLeaveTimeoutId)

    dragLeaveTimeoutId = window.setTimeout(() => {
      if (dragEventCounter.value <= 0) {
        showDraggingOverlay.value = false
        dragEventCounter.value = 0
      }
      dragLeaveTimeoutId = null
    }, 50)
  }
}

const handleDropEvent = async (e: DragEvent) => {
  showDraggingOverlay.value = false
  dragEventCounter.value = 0

  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    for (const file of e.dataTransfer.files) {
      try {
        const path = window.api.getPathForFile(file)
        if (file.type === '') {
          const isDirectory = await filePresenter.isDirectory(path)
          if (isDirectory) {
            const fileInfo: MessageFile = await filePresenter.prepareDirectory(path)
            if (fileInfo) {
              attachedFiles.value.push(fileInfo)
            }
          } else {
            const mimeType = await filePresenter.getMimeType(path)
            console.log('mimeType', mimeType)
            const fileInfo: MessageFile = await filePresenter.prepareFile(path, mimeType)
            console.log('fileInfo', fileInfo)
            if (fileInfo) {
              attachedFiles.value.push(fileInfo)
            }
          }
        } else {
          const mimeType = await filePresenter.getMimeType(path)
          const fileInfo: MessageFile = await filePresenter.prepareFile(path, mimeType)
          if (fileInfo) {
            attachedFiles.value.push(fileInfo)
          }
        }
      } catch (error) {
        console.error('文件准备失败:', error)
        return
      }
    }
    emit('file-upload', attachedFiles.value)
  }
}

// Search engine selector variables
const displaySearchSettings = ref(false) // Renamed from showSearchSettingsButton
const isSearchHovered = ref(false) // Renamed from isSearchHovering
const isSelectDropdownOpen = ref(false) // Renamed from isSelectOpen

// Handle select open state
const handleSelectDropdownOpen = (isOpen: boolean) => {
  isSelectDropdownOpen.value = isOpen
}

// Mouse hover handlers for search engine selector
const handleSearchMouseEnter = () => {
  isSearchHovered.value = true
}

const handleSearchMouseLeave = () => {
  isSearchHovered.value = false
}

onMounted(() => {
  initializeSettings()

  // Add event listeners for search engine selector hover with auto remove
  const searchElement = document.querySelector('.search-engine-select')
  if (searchElement) {
    useEventListener(searchElement, 'mouseenter', handleSearchMouseEnter)
    useEventListener(searchElement, 'mouseleave', handleSearchMouseLeave)
  }
})

watch(
  () => settingsStore.activeSearchEngine?.id,
  async () => {
    activeSearchEngineId.value = settingsStore.activeSearchEngine?.id ?? 'google'
  }
)

watch(
  () => attachedFiles.value,
  () => {
    suggestion.items = suggestion.items.filter((item: any) => item.type != 'item' || item.category != 'files') // Adjusted to access suggestion.items
      .concat(
        attachedFiles.value.map((file) => ({
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
    suggestion.items = suggestion.items.filter((item: any) => item.type != 'item' || item.category != 'resources') // Adjusted to access suggestion.items
      .concat(
        mcpStore.resources.map((resource) => ({
          id: `${resource.clientName}.${resource.name ?? ''}`,
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
    suggestion.items = suggestion.items.filter((item: any) => item.type != 'item' || item.category != 'tools') // Adjusted to access suggestion.items
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

defineExpose({
  setText: (text: string) => {
    currentInputText.value = text
  }
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
